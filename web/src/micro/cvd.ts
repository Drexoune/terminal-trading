// CVD spot contre perpétuel sur 4 h (P5, docs/ecrans.md § 7, T-065, T-067).
//
// Delta d'une minute = volume des achats agressifs − volume des ventes agressives (BTC).
// Chaque flux (plateforme × marché) découpe le temps en tranches (`unit`) : 1 min pour Binance
// (bougies 1 min), 5 min pour OKX (statistique rubik). Une tranche est :
// - « live » si le flux était connecté sans interruption du début à la fin de la tranche : on
//   garde les deltas par minute calculés sur les trades reçus ;
// - un « trou » sinon (avant l'ouverture du terminal, coupure, reconnexion) : elle est rattrapée
//   par le REST de la plateforme une fois close, son delta étalé sur ses minutes.
// OKX spot n'est lu que par le REST (différé de 5 à 10 min) : sa statistique couvre tous les
// marchés spot BTC d'OKX, le direct seulement BTC-USDT ; les mélanger changerait la définition.
// Les courbes ne comptent que les flux rattrapables (spot : Binance + OKX ; perp : Binance + OKX),
// pour que leur composition ne change jamais en cours de courbe ; les autres (Bybit,
// Hyperliquid, Coinbase) s'affichent à part, en delta depuis leur première connexion.
//
// Divergence : sur la fenêtre, delta net de chaque courbe rapporté au volume preneur de son
// marché (r ∈ [−1, 1]). Divergence si les signes diffèrent et |r| ≥ 2 % des deux côtés.

import type { Market, MicroTrade, Venue } from './types';

export const MIN = 60_000;
export const CVD_WINDOW_MS = 4 * 3_600_000;
export const DIVERGENCE_MIN = 0.02;

export type StreamId = `${Venue}:${Market}`;
export interface Fill { unit: number; buy: number; sell: number }      // tranche rattrapée (BTC)

type UnitState = 'live' | 'rest' | 'hole';

/** Flux rattrapable : deltas par minute, état de chaque tranche. */
export class CvdStream {
  private live = new Map<number, { buy: number; sell: number }>();   // minute → volumes du direct
  private rest = new Map<number, { buy: number; sell: number }>();   // tranche → volumes rattrapés
  private units = new Map<number, UnitState>();
  private liveFrom: number | null = null;   // début de la connexion continue en cours
  private finalized: number;                // première tranche pas encore close

  /** restOnly : jamais de direct (OKX spot : la statistique couvre tous les marchés spot BTC, le direct seulement BTC-USDT). */
  constructor(readonly id: StreamId, readonly unitMs: number, start: number, readonly restOnly = false) {
    this.finalized = this.floor(start - CVD_WINDOW_MS);
  }

  floor(t: number): number { return Math.floor(t / this.unitMs) * this.unitMs; }

  connected(at: number): void { if (this.liveFrom === null) this.liveFrom = at; }
  disconnected(now: number): void { this.tick(now); this.liveFrom = null; }

  trade(t: MicroTrade): void {
    this.connected(t.recv);
    const m = Math.floor(t.ts / MIN) * MIN;
    const b = this.live.get(m) ?? { buy: 0, sell: 0 };
    b[t.side] += t.sz;
    this.live.set(m, b);
  }

  /** Ferme les tranches terminées : live si la connexion couvrait toute la tranche, sinon trou. */
  tick(now: number): void {
    const end = this.floor(now);                       // tranche en cours : pas encore close
    for (let u = this.finalized; u < end; u += this.unitMs) {
      if (!this.units.has(u)) this.units.set(u, this.liveFrom !== null && this.liveFrom <= u ? 'live' : 'hole');
    }
    this.finalized = Math.max(this.finalized, end);
    const cut = this.floor(now - CVD_WINDOW_MS);
    for (const k of this.units.keys()) if (k < cut) { this.units.delete(k); this.rest.delete(k); }
    for (const k of this.live.keys()) if (k < cut) this.live.delete(k);
  }

  /** Tranches closes encore à rattraper. */
  holes(): number[] {
    return [...this.units].filter(([, s]) => s === 'hole').map(([u]) => u).sort((a, b) => a - b);
  }

  /** Rattrapage : seules les tranches en trou sont remplies ; une tranche live n'est jamais écrasée. */
  fill(rows: Fill[]): number {
    let n = 0;
    for (const r of rows) {
      if (this.units.get(r.unit) !== 'hole') continue;
      this.rest.set(r.unit, { buy: r.buy, sell: r.sell });
      this.units.set(r.unit, 'rest');
      n++;
    }
    return n;
  }

  /** Volumes par minute sur [from, to) : direct pour les tranches live et la tranche en cours, rattrapage étalé sinon. */
  minutes(from: number, to: number): Map<number, { buy: number; sell: number }> {
    const out = new Map<number, { buy: number; sell: number }>();
    for (let m = from; m < to; m += MIN) {
      const u = this.floor(m);
      const st = this.units.get(u);
      if (st === 'rest') {
        const r = this.rest.get(u)!, k = this.unitMs / MIN;
        out.set(m, { buy: r.buy / k, sell: r.sell / k });
      } else if (st === 'live' || (st === undefined && u >= this.finalized && this.liveFrom !== null && this.liveFrom <= u)) {
        out.set(m, this.live.get(m) ?? { buy: 0, sell: 0 });
      }
    }
    return out;
  }

  state(u: number): UnitState | undefined { return this.units.get(u); }
}

export interface CvdSeries { t: number[]; perp: number[]; spot: number[] }
export interface CvdOther { venue: Venue; market: Market; delta: number; since: number }
export interface CvdState {
  from: number; to: number;
  series: CvdSeries;                         // cumul en BTC, une valeur par minute
  perp: number | null; spot: number | null;  // delta net sur la fenêtre
  perp_venues: Venue[]; spot_venues: Venue[];
  holes: { id: StreamId; from: number; to: number }[];   // tranches pas encore rattrapées
  divergence: boolean; ratio_perp: number | null; ratio_spot: number | null;
  sentence: string;
  others: CvdOther[];
  ready: boolean;
}

/** Rapport delta / volume, null si le volume est nul. */
export const flowRatio = (delta: number, volume: number) => (volume > 0 ? delta / volume : null);

export function divergence(rp: number | null, rs: number | null, min = DIVERGENCE_MIN): boolean {
  if (rp === null || rs === null) return false;
  return Math.sign(rp) !== Math.sign(rs) && Math.abs(rp) >= min && Math.abs(rs) >= min;
}

const btc = (x: number) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x)).toLocaleString('fr-FR')} BTC`;

/** Phrase de lecture (gabarit, sans IA) : uniquement les chiffres calculés. */
export function cvdSentence(perp: number | null, spot: number | null, div: boolean, hours: number): string {
  if (perp === null || spot === null) return 'Lecture indisponible : rattrapage de l’historique en cours.';
  const h = `${hours} dernières heures`;
  if (!div) {
    return Math.sign(perp) === Math.sign(spot)
      ? `Spot et perpétuel vont dans le même sens sur les ${h} (perp ${btc(perp)}, spot ${btc(spot)}).`
      : `Pas de divergence nette sur les ${h} (perp ${btc(perp)}, spot ${btc(spot)}) : l’un des deux flux reste proche de l’équilibre.`;
  }
  return perp > 0
    ? `Le perpétuel achète (${btc(perp)}), le spot vend (${btc(spot)}) : sur les ${h}, la pression acheteuse vient des dérivés, pas du comptant.`
    : `Le spot achète (${btc(spot)}), le perpétuel vend (${btc(perp)}) : sur les ${h}, la demande vient du comptant, les dérivés vendent.`;
}

/** Flux de la CVD : rattrapables (dans les courbes) et direct seul (à part). */
export const BACKFILLED: { id: StreamId; unitMs: number; restOnly?: boolean }[] = [
  { id: 'binance:perp', unitMs: MIN }, { id: 'okx:perp', unitMs: 5 * MIN },
  { id: 'binance:spot', unitMs: MIN }, { id: 'okx:spot', unitMs: 5 * MIN, restOnly: true },
];

export class Cvd {
  readonly streams = new Map<StreamId, CvdStream>();
  private others = new Map<StreamId, CvdOther>();
  private ready = new Set<StreamId>();      // premier rattrapage reçu

  constructor(start: number, private readonly backfilled = BACKFILLED) {
    for (const s of backfilled) this.streams.set(s.id, new CvdStream(s.id, s.unitMs, start, s.restOnly));
  }

  trade(t: MicroTrade): void {
    const s = this.streams.get(`${t.venue}:${t.market}`);
    if (s) { if (!s.restOnly) s.trade(t); return; }
    const id = `${t.venue}:${t.market}` as StreamId;
    const o = this.others.get(id) ?? { venue: t.venue, market: t.market, delta: 0, since: t.recv };
    o.delta += t.side === 'buy' ? t.sz : -t.sz;
    this.others.set(id, o);
  }

  disconnected(id: StreamId, now: number): void { this.streams.get(id)?.disconnected(now); }
  tick(now: number): void { for (const s of this.streams.values()) s.tick(now); }
  fill(id: StreamId, rows: Fill[]): number { this.ready.add(id); return this.streams.get(id)?.fill(rows) ?? 0; }
  /** Rattrapage impossible (REST refusé) : le flux sort des courbes, avec la raison affichée ailleurs. */
  isReady(id: StreamId): boolean { return this.ready.has(id); }

  state(now: number): CvdState {
    const to = Math.floor(now / MIN) * MIN + MIN;
    const from = to - CVD_WINDOW_MS;
    const t: number[] = [];
    for (let m = from; m < to; m += MIN) t.push(m);
    const curve = (market: Market) => {
      const ids = this.backfilled.filter((s) => s.id.endsWith(market) && this.ready.has(s.id)).map((s) => s.id);
      const per = ids.map((id) => this.streams.get(id)!.minutes(from, to));
      let cum = 0, vol = 0;
      const vals = t.map((m) => {
        for (const p of per) { const x = p.get(m); if (x) { cum += x.buy - x.sell; vol += x.buy + x.sell; } }
        return Math.round(cum * 1000) / 1000;
      });
      return { ids, vals, delta: ids.length ? cum : null, vol };
    };
    const p = curve('perp'), s = curve('spot');
    const rp = p.delta !== null ? flowRatio(p.delta, p.vol) : null, rs = s.delta !== null ? flowRatio(s.delta, s.vol) : null;
    const div = divergence(rp, rs);
    const holes: CvdState['holes'] = [];
    for (const st of this.streams.values()) {
      for (const u of st.holes()) {
        const last = holes[holes.length - 1];
        if (last && last.id === st.id && last.to === u) last.to = u + st.unitMs;
        else holes.push({ id: st.id, from: u, to: u + st.unitMs });
      }
    }
    const ready = p.ids.length > 0 && s.ids.length > 0;
    return {
      from, to, series: { t, perp: p.vals, spot: s.vals },
      perp: p.delta, spot: s.delta,
      perp_venues: p.ids.map((id) => id.split(':')[0] as Venue), spot_venues: s.ids.map((id) => id.split(':')[0] as Venue),
      holes, divergence: div, ratio_perp: rp, ratio_spot: rs,
      sentence: cvdSentence(ready ? p.delta : null, ready ? s.delta : null, div, CVD_WINDOW_MS / 3_600_000),
      others: [...this.others.values()], ready,
    };
  }
}
