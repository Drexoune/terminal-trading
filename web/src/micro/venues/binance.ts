// Binance pour la microstructure (P5, T-065, T-067).
//
// USDⓈ-M : chemins routés obligatoires depuis 2026 (« Important WebSocket Change Notice ») :
// - `/public` : diff de carnet 100 ms. Synchronisation selon la doc « How to manage a local order
//   book correctly » : événements mis de côté, instantané REST (`fapi/v1/depth`, 1 000 niveaux),
//   événements u < lastUpdateId écartés, le premier doit couvrir lastUpdateId (U ≤ id ≤ u), puis
//   chaque `pu` doit égaler le `u` précédent ; sinon resynchronisation, trou journalisé.
// - `/market` : aggTrade (m = acheteur teneur de marché → vente agressive), forceOrder (S = SELL :
//   position longue liquidée ; une liquidation par symbole et par seconde au plus : plancher),
//   markPrice@1s (marque, indice, funding, prochaine échéance).
// Spot : aggTrade de BTCUSDT. Le serveur envoie les pings ; le navigateur répond seul.

import { LocalBook, levels, type Level } from '../book';
import { VenueStream, type MessageResult } from '../stream';
import { num, type VenueAdapter, type VenueCtx } from './ctx';

export const BINANCE_PUBLIC = 'wss://fstream.binance.com/public/stream?streams=btcusdt@depth@100ms';
export const BINANCE_MARKET = 'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder/btcusdt@markPrice@1s';
export const BINANCE_SPOT = 'wss://stream.binance.com:9443/stream?streams=btcusdt@aggTrade';
export const BINANCE_DEPTH = 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000';
export const BINANCE_FUNDING_INFO = 'https://fapi.binance.com/fapi/v1/fundingInfo';
const BUFFER_MAX = 600;                         // 60 s de diffs en attente de l'instantané

interface Diff { U: number; u: number; pu: number; E: number; T: number; b: string[][]; a: string[][] }

export function createBinance(ctx: VenueCtx): VenueAdapter {
  const book = new LocalBook('binance', 1, { bounded: true, maxLevels: 1000 });
  let lastU: number | null = null;              // u du dernier diff appliqué (ou lastUpdateId de l'instantané)
  let needFirst = false;                        // aucun diff appliqué depuis l'instantané : règle U ≤ id ≤ u
  let buffer: Diff[] = [];
  let fetching = false;
  let staleTries = 0;                           // instantanés successifs plus anciens que les diffs
  let intervalH = 8;
  const lastAgg = { perp: null as number | null, spot: null as number | null };
  let pub: VenueStream;

  async function loadSnapshot() {
    if (fetching) return;
    fetching = true;
    try {
      const r = await ctx.deps.fetch(BINANCE_DEPTH, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const s = await r.json() as { lastUpdateId: number; E: number; bids: string[][]; asks: string[][] };
      const id = s.lastUpdateId;
      const pending = buffer.filter((d) => d.u >= id);
      buffer = [];
      if (pending.length && !(pending[0].U <= id && pending[0].u >= id)) {
        // Instantané plus ancien que les diffs reçus (REST en retard) : nouvel essai dans 500 ms.
        // Un seul trou journalisé par resynchronisation ; nouvel essai à délai croissant (0,5 à 10 s).
        buffer = pending;
        if (staleTries === 0) pub.gap('instantané REST plus ancien que les diffs : nouvel essai');
        const wait = Math.min(10_000, 500 * 2 ** staleTries++);
        setTimeout(() => { fetching = false; void loadSnapshot(); }, wait);
        return;
      }
      book.snapshot(levels(s.bids), levels(s.asks), s.E, ctx.deps.now());
      lastU = id;
      needFirst = true;
      staleTries = 0;
      for (const d of pending) applyDiff(d, ctx.deps.now());
    } catch (e) {
      pub.gap(`instantané du carnet impossible : ${(e as Error).message}`);
      setTimeout(() => { fetching = false; void loadSnapshot(); }, 2_000);
      return;
    }
    fetching = false;
  }

  function resync(why: string) {
    book.reset(); lastU = null; buffer = []; needFirst = false; staleTries = 0;
    pub.gap(`carnet resynchronisé : ${why}`);
    void loadSnapshot();
  }

  function applyDiff(d: Diff, recv: number) {
    if (lastU === null) return;
    if (needFirst) {
      // Premier diff après l'instantané (le tampon peut être entièrement plus ancien que lui) :
      // diffs antérieurs écartés, puis U ≤ lastUpdateId ≤ u, sinon des mises à jour manquent.
      if (d.u < lastU) return;
      if (d.U > lastU) { resync(`premier diff U ${d.U} après l’instantané ${lastU}`); return; }
      needFirst = false;
    } else if (d.pu !== lastU) { resync(`pu ${d.pu} au lieu de ${lastU}`); return; }
    book.apply(levels(d.b) as Level[], levels(d.a) as Level[], d.T, recv);
    lastU = d.u;
  }

  function onPublic(raw: string, recv: number): MessageResult {
    const m = JSON.parse(raw) as { stream?: string; data?: Diff };
    if (!m.data) return 'ignore';
    if (lastU === null) {
      buffer.push(m.data);
      if (buffer.length > BUFFER_MAX) buffer.shift();
      void loadSnapshot();
      return 'data';
    }
    applyDiff(m.data, recv);
    // Prix sorti de la moitié de la portée de l'instantané : nouvel instantané (pas un trou de données).
    if (!fetching && book.drifted()) { book.reset(); lastU = null; buffer = []; needFirst = false; staleTries = 0; void loadSnapshot(); }
    return 'data';
  }

  function aggTrade(market: 'perp' | 'spot', d: Record<string, unknown>, recv: number, s: VenueStream) {
    const a = num(d.a);
    const prev = lastAgg[market];
    if (prev !== null && a > prev + 1) s.gap(`${a - prev - 1} trade(s) agrégé(s) manquant(s)`);
    lastAgg[market] = Math.max(a, prev ?? a);
    ctx.emit({ kind: 'trade', t: { venue: 'binance', market, ts: num(d.T), recv, px: num(d.p), sz: num(d.q), side: d.m ? 'sell' : 'buy' } });
  }

  function onMarket(raw: string, recv: number): MessageResult {
    const m = JSON.parse(raw) as { stream?: string; data?: Record<string, unknown> };
    const d = m.data;
    if (!d) return 'ignore';
    if (d.e === 'aggTrade') aggTrade('perp', d, recv, market);
    else if (d.e === 'forceOrder') {
      const o = d.o as Record<string, unknown>;
      if (o.s !== 'BTCUSDT') return 'data';
      const sz = num(o.z ?? o.q), px = num(o.ap ?? o.p);
      ctx.emit({ kind: 'liq', l: { venue: 'binance', ts: num(o.T), recv, side: o.S === 'SELL' ? 'long' : 'short', px, sz, usd: sz * px, floor: true } });
    } else if (d.e === 'markPriceUpdate') {
      const ts = num(d.E);
      ctx.emit({ kind: 'funding', f: { venue: 'binance', ts, rate: num(d.r), interval_h: intervalH, next_ms: num(d.T) } });
      ctx.emit({ kind: 'premium', p: { venue: 'binance', ts, mark: num(d.p), index: num(d.i) } });
    }
    return 'data';
  }

  function onSpot(raw: string, recv: number): MessageResult {
    const m = JSON.parse(raw) as { data?: Record<string, unknown> };
    if (m.data?.e === 'aggTrade') aggTrade('spot', m.data, recv, spot);
    return m.data ? 'data' : 'ignore';
  }

  // Intervalle de funding (8 h par défaut ; fundingInfo ne liste que les symboles ajustés).
  void ctx.deps.fetch(BINANCE_FUNDING_INFO).then(async (r) => {
    const rows = r.ok ? await r.json() as { symbol: string; fundingIntervalHours: number }[] : [];
    const x = rows.find((y) => y.symbol === 'BTCUSDT');
    if (x) intervalH = x.fundingIntervalHours;
  }).catch(() => { /* 8 h par défaut, documenté */ });

  pub = new VenueStream({ name: 'binance-book', label: 'Binance WS (carnet)', venue: 'binance', url: BINANCE_PUBLIC, quietMs: 30_000,
    subscribe: () => [], onOpen: () => { book.reset(); lastU = null; buffer = []; needFirst = false; }, onMessage: onPublic }, ctx.deps, ctx.onFeed);
  const market = new VenueStream({ name: 'binance-perp', label: 'Binance WS (perp)', venue: 'binance', url: BINANCE_MARKET, quietMs: 30_000,
    subscribe: () => [], onOpen: () => { lastAgg.perp = null; }, onMessage: onMarket }, ctx.deps, ctx.onFeed);
  const spot = new VenueStream({ name: 'binance-spot', label: 'Binance WS (spot)', venue: 'binance', url: BINANCE_SPOT, quietMs: 60_000,
    subscribe: () => [], onOpen: () => { lastAgg.spot = null; }, onMessage: onSpot }, ctx.deps, ctx.onFeed);
  return { streams: [pub, market, spot], books: [book] };
}
