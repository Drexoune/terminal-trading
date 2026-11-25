// Moteur de la microstructure (P5, T-065) : relie les adaptateurs de plateforme, les carnets, les
// agrégations et les rattrapages REST, et publie l'état sous des clés `micro:*`. Tourne dans le
// worker dédié (micro.worker.ts), identique dans les trois modes ; dépendances injectées pour les
// tests (fausses WebSockets, faux fetch, horloge simulée).
//
// Rythmes : carnet agrégé et funding publiés au plus à chaque lot (10 Hz) ; relevé de la carte
// toutes les 5 s (colonne toutes les 40 s, avec le carnet profond d'OKX) ; CVD toutes les 2 s ;
// trous de la CVD rattrapés dès que la tranche est close ; OI de Binance toutes les 30 s ;
// historique de l'OI toutes les heures ; liquidations d'OKX rattrapées à chaque (re)connexion.

import type { FetchLike, Item, WebSocketCtor } from '../data/protocol';
import { aggregate } from './aggBook';
import {
  BINANCE_OI, BINANCE_OI_HIST, BYBIT_OI_HIST, binanceKlinesUrl, OKX_BOOKS_FULL, OKX_LIQ_HIST, OKX_STATS_NO_CORS, okxOiHistUrl, okxTakerPerpUrl, okxTakerSpotUrl,
  parseBinanceKlines, parseBinanceOi, parseBinanceOiHist, parseBybitOiHist, parseOkxBooksFull, parseOkxLiqHist, parseOkxOiHist, parseOkxTaker,
} from './backfill';
import { LocalBook } from './book';
import { BACKFILLED, Cvd, MIN, type Fill, type StreamId } from './cvd';
import { DepthMap } from './depth';
import { FundingBoard, type OiPoint } from './funding';
import { Liquidations } from './liqs';
import type { MicroFeedState } from './stream';
import type { BookSide, BookView, MicroEvent, Venue } from './types';
import { createBinance } from './venues/binance';
import { createBybit } from './venues/bybit';
import { createCoinbase } from './venues/coinbase';
import { createHyperliquid } from './venues/hyperliquid';
import { createOkx } from './venues/okx';
import type { VenueAdapter, VenueCtx } from './venues/ctx';

export const SAMPLE_MS = 5_000;
export const DEEP_MS = 40_000;
export const CVD_PUBLISH_MS = 2_000;
export const BINANCE_OI_MS = 30_000;
export const OI_HIST_MS = 3_600_000;
export const BACKFILL_CHECK_MS = 10_000;

export interface EngineDeps {
  WebSocket: WebSocketCtor; fetch: FetchLike; now: () => number; random: () => number;
  /** Base des statistiques `rubik` d'OKX (relais acceptant le navigateur). Absente : OKX hors des
   *  courbes de CVD (ses trades restent comptés « depuis l'ouverture ») et sans variation 24 h de l'OI. */
  okxStatsBase?: string | null;
}

/** État d'un appel REST (rattrapage, historique) : affiché avec la source de chaque panneau. */
export interface RestState { name: string; label: string; ok: boolean | null; at: number | null; error: string | null }

/** Flux temps réel → flux de CVD dont il porte les trades. */
const FEED_CVD: Record<string, StreamId> = { 'okx-micro': 'okx:perp', 'binance-perp': 'binance:perp', 'binance-spot': 'binance:spot' };

/** Carnet proche (WebSocket) complété au-delà de sa portée par un carnet profond (REST). */
export function overlay(near: BookView, far: BookView | null): BookView {
  if (!far || !near.synced || !near.bids.px.length || !near.asks.px.length) return near;
  const lowBid = near.bids.px[near.bids.px.length - 1], highAsk = near.asks.px[near.asks.px.length - 1];
  const extend = (n: BookSide, f: BookSide, beyond: (p: number) => boolean): BookSide => {
    const px = [...n.px], sz = [...n.sz];
    for (let i = 0; i < f.px.length; i++) if (beyond(f.px[i])) { px.push(f.px[i]); sz.push(f.sz[i]); }
    return { px, sz };
  };
  return { ...near, bids: extend(near.bids, far.bids, (p) => p < lowBid), asks: extend(near.asks, far.asks, (p) => p > highAsk) };
}

export class MicroEngine {
  readonly adapters: Record<Venue, VenueAdapter>;
  readonly depth = new DepthMap();
  readonly cvd: Cvd;
  readonly liqs = new Liquidations();
  readonly board = new FundingBoard();
  private deep: LocalBook = new LocalBook('okx', 0.01);   // books-full d'OKX (contrats → BTC)
  private feeds = new Map<string, MicroFeedState>();
  private rest = new Map<string, RestState>();
  private dirty = new Set<string>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private inflight = new Set<string>();
  private nextTry = new Map<string, number>();
  private failures = new Map<string, number>();
  private last: { px: number; ts: number; venue: Venue } | null = null;
  private lastCvd = 0;
  private lastFull = 0;
  private running = false;
  private readonly okxStats: string | null;

  constructor(private readonly deps: EngineDeps) {
    this.okxStats = deps.okxStatsBase ?? null;
    this.cvd = new Cvd(deps.now(), this.okxStats ? BACKFILLED : BACKFILLED.filter((s) => !s.id.startsWith('okx')));
    if (!this.okxStats) this.board.historyFailed('okx', `${OKX_STATS_NO_CORS} : historique de l’OI indisponible`);
    const ctx: VenueCtx = {
      deps: { WebSocket: deps.WebSocket, now: deps.now, random: deps.random, fetch: deps.fetch },
      emit: (e) => this.onEvent(e),
      onFeed: (s) => this.onFeed(s),
    };
    this.adapters = { okx: createOkx(ctx), binance: createBinance(ctx), bybit: createBybit(ctx), hyperliquid: createHyperliquid(ctx), coinbase: createCoinbase(ctx) };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const a of Object.values(this.adapters)) for (const s of a.streams) s.start();
    const every = (ms: number, f: () => void) => this.timers.push(setInterval(() => { try { f(); } catch (e) { console.error('micro', e); } }, ms));
    every(SAMPLE_MS, () => this.sample());
    every(DEEP_MS, () => void this.loadDeep());
    every(BACKFILL_CHECK_MS, () => void this.backfillCvd());
    every(BINANCE_OI_MS, () => void this.loadBinanceOi());
    every(OI_HIST_MS, () => void this.loadOiHistory());
    void this.loadDeep();
    void this.loadBinanceOi();
    void this.loadOiHistory();
    void this.loadOkxLiqs();
    // Premier rattrapage dès l'ouverture : 4 h de CVD avant la première connexion.
    this.cvd.tick(this.deps.now());
    void this.backfillCvd();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const a of Object.values(this.adapters)) for (const s of a.streams) s.stop();
  }

  // --- Entrées --------------------------------------------------------------------------------

  private onEvent(e: MicroEvent): void {
    switch (e.kind) {
      case 'trade':
        this.cvd.trade(e.t);
        this.depth.onTrade(e.t);
        if (e.t.market === 'perp') this.last = { px: e.t.px, ts: e.t.ts, venue: e.t.venue };
        break;
      case 'liq': if (this.liqs.add(e.l)) this.dirty.add('liqs'); break;
      case 'funding': this.board.setFunding(e.f); break;
      case 'oi': this.board.setOi(e.o); break;
      case 'premium': this.board.setPremium(e.p); break;
    }
  }

  private onFeed(s: MicroFeedState): void {
    const prev = this.feeds.get(s.name);
    this.feeds.set(s.name, s);
    this.dirty.add(`feed:${s.name}`);
    const now = this.deps.now();
    if (s.status !== 'connected') {
      const id = FEED_CVD[s.name];
      if (id) this.cvd.disconnected(id, now);
    } else if (prev?.status !== 'connected') {
      // Début d'observation des liquidations ; OKX : rattrapage de l'heure (comble une coupure).
      if (s.name === 'okx-micro') { this.liqs.observe('okx', now); if (prev) void this.loadOkxLiqs(); }
      if (s.name === 'binance-perp') this.liqs.observe('binance', now);
      if (s.name === 'bybit') this.liqs.observe('bybit', now);
    }
  }

  // --- REST ------------------------------------------------------------------------------------

  private setRest(name: string, label: string, ok: boolean, error: string | null = null): void {
    this.rest.set(name, { name, label, ok, at: this.deps.now(), error });
    this.dirty.add('rest');
  }

  private async getJson(url: string): Promise<unknown> {
    const r = await this.deps.fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  private async loadDeep(): Promise<void> {
    try {
      const b = parseOkxBooksFull(await this.getJson(OKX_BOOKS_FULL));
      this.deep.snapshot(b.bids, b.asks, b.ts, this.deps.now());
      this.setRest('okx-deep', 'OKX carnet profond (www)', true);
    } catch (e) {
      this.deep.reset();
      this.setRest('okx-deep', 'OKX carnet profond (www)', false, (e as Error).message);
    }
  }

  private async loadBinanceOi(): Promise<void> {
    try {
      const o = parseBinanceOi(await this.getJson(BINANCE_OI));
      this.board.setOi({ venue: 'binance', ts: o.ts, oi_btc: o.oi_btc, oi_usd: null });
      this.setRest('binance-oi', 'Binance OI', true);
    } catch (e) { this.setRest('binance-oi', 'Binance OI', false, (e as Error).message); }
  }

  private async loadOiHistory(): Promise<void> {
    const jobs: [Venue, string, (b: unknown) => OiPoint[]][] = [
      ['binance', BINANCE_OI_HIST, parseBinanceOiHist], ['bybit', BYBIT_OI_HIST, parseBybitOiHist]];
    if (this.okxStats) jobs.push(['okx', okxOiHistUrl(this.okxStats), parseOkxOiHist]);
    await Promise.all(jobs.map(async ([v, url, parse]) => {
      const name = `${v}-oi-hist`, label = `${v === 'okx' ? 'OKX' : v === 'bybit' ? 'Bybit' : 'Binance'} historique OI`;
      try { this.board.setHistory(v, parse(await this.getJson(url))); this.setRest(name, label, true); } catch (e) {
        const msg = (e as Error).message;
        this.board.historyFailed(v, `historique de l’OI indisponible : ${msg}`);
        this.setRest(name, label, false, msg);
      }
    }));
  }

  private async loadOkxLiqs(): Promise<void> {
    try {
      const now = this.deps.now();
      const rows = parseOkxLiqHist(await this.getJson(OKX_LIQ_HIST), now);
      let added = 0;
      for (const l of rows) if (l.ts >= now - 3_600_000 && this.liqs.add(l)) added++;
      // Les 100 dernières couvrent l'heure si la plus ancienne la précède ; sinon, l'observation commence à la plus ancienne.
      const oldest = rows.length ? Math.min(...rows.map((l) => l.ts)) : now - 3_600_000;
      this.liqs.observe('okx', Math.max(oldest, now - 3_600_000));
      if (added) this.dirty.add('liqs');
      this.setRest('okx-liq', 'OKX liquidations (www)', true);
    } catch (e) { this.setRest('okx-liq', 'OKX liquidations (www)', false, (e as Error).message); }
  }

  /** Rattrape les tranches closes en trou, flux par flux, avec un délai de publication et un délai croissant en cas d'échec. */
  async backfillCvd(): Promise<void> {
    const now = this.deps.now();
    this.cvd.tick(now);
    await Promise.all([...this.cvd.streams.values()].map(async (s) => {
      if (this.inflight.has(s.id) || (this.nextTry.get(s.id) ?? 0) > now) return;
      const okx = s.id.startsWith('okx');
      const delay = okx ? 60_000 : 2_000;                       // publication de la statistique d'OKX
      const holes = s.holes().filter((u) => u + s.unitMs + delay <= now);
      if (!holes.length && this.cvd.isReady(s.id)) return;
      const label = `${okx ? 'OKX' : 'Binance'} volume preneur ${s.id.endsWith('perp') ? 'perp' : 'spot'}`;
      const name = `cvd-${s.id.replace(':', '-')}`;
      this.inflight.add(s.id);
      try {
        let rows: Fill[];
        if (okx) rows = parseOkxTaker(await this.getJson((s.id === 'okx:perp' ? okxTakerPerpUrl : okxTakerSpotUrl)(this.okxStats!)), now);
        else {
          const from = holes[0] ?? Math.floor(now / MIN) * MIN - MIN, to = (holes[holes.length - 1] ?? from) + MIN - 1;
          rows = parseBinanceKlines(await this.getJson(binanceKlinesUrl(s.id === 'binance:perp' ? 'perp' : 'spot', from, to)), now);
        }
        this.cvd.fill(s.id, rows);
        this.failures.delete(s.id);
        this.nextTry.set(s.id, now + (okx ? 60_000 : 5_000));
        this.setRest(name, label, true);
        this.dirty.add('cvd');
      } catch (e) {
        const n = (this.failures.get(s.id) ?? 0) + 1;
        this.failures.set(s.id, n);
        this.nextTry.set(s.id, now + Math.min(300_000, 10_000 * 2 ** (n - 1)));
        this.setRest(name, label, false, (e as Error).message);
      } finally { this.inflight.delete(s.id); }
    }));
  }

  // --- Agrégations -----------------------------------------------------------------------------

  /** Carnets des perpétuels pour le carnet agrégé : OKX (WS), Binance, Bybit, Hyperliquid (pas de 10 $). */
  perpViews(): BookView[] {
    return [this.adapters.okx.books[0], this.adapters.binance.books[0], this.adapters.bybit.books[0], this.adapters.hyperliquid.books[0]].map((b) => b.view());
  }

  sample(now = this.deps.now()): void {
    const views = this.perpViews();
    const deep = this.deep.synced ? this.deep.view() : null;
    // OKX : 400 niveaux en direct (±0,09 %), complétés au-delà par books-full (±1,4 %, relevé toutes les 40 s).
    this.depth.sample(now, [overlay(views[0], deep), ...views.slice(1)], views);
    this.liqs.prune(now);
    this.dirty.add('depth');
    this.dirty.add('liqs');
  }

  /** Lot à publier : carnet et funding à chaque appel, le reste quand il a changé. */
  publish(now = this.deps.now()): Item[] {
    const out: Item[] = [];
    const book = aggregate(this.perpViews(), 10, 10, now);
    out.push(['micro:book', { ...book, last: this.last }]);
    out.push(['micro:funding', { ...this.board.state(now), ts: now }]);
    if (now - this.lastCvd >= CVD_PUBLISH_MS || this.dirty.has('cvd')) {
      this.lastCvd = now;
      this.cvd.tick(now);
      out.push(['micro:cvd', this.cvd.state(now)]);
    }
    // Tout l'état chaque seconde : le store est vidé à un changement de mode (data/store.ts).
    if (now - this.lastFull >= 1_000) {
      this.lastFull = now;
      // États des flux relus à la source : l'heure du dernier message avance sans changement d'état.
      for (const a of Object.values(this.adapters)) for (const st of a.streams) this.feeds.set(st.spec.name, st.snapshot());
      for (const k of ['depth', 'liqs', 'rest', ...[...this.feeds.keys()].map((n) => `feed:${n}`)]) this.dirty.add(k);
    }
    for (const k of this.dirty) {
      if (k === 'depth') out.push(['micro:depth', this.depth.state()]);
      else if (k === 'liqs') out.push(['micro:liqs', this.liqs.state(now)]);
      else if (k === 'rest') out.push(['micro:rest', [...this.rest.values()]]);
      else if (k.startsWith('feed:')) out.push([`micro:${k}`, this.feeds.get(k.slice(5))]);
    }
    this.dirty.clear();
    return out;
  }
}
