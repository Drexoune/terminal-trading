// Carte de profondeur (P5, docs/ecrans.md § 7) : 60 min × prix.
//
// - Toutes les 5 s, le carnet fusionné des perpétuels est regroupé en tranches de `step` $ sur
//   ±range_pct autour du milieu ; toutes les 40 s, ce relevé devient une colonne de la carte.
//   Chaque plateforme ne compte que sur la plage que son carnet couvre (bornes publiées).
// - Prix : dernier trade des perpétuels, toutes les 5 s. Bulles : volume agressif d'achat et de
//   vente par tranche de 5 s, au-delà d'un seuil (taille = volume).
// - « Mur retiré » : une tranche ≥ seuil de mur qui perd plus de 70 % entre deux relevés alors que
//   les trades n'y expliquent pas 20 % de la baisse. Changement observé du carnet, jamais un stop
//   supposé ; il peut aussi s'agir d'un ordre déplacé.
// - Niveaux d'or : quantiles 50, 80, 93 et 98 % des cellules non vides de la carte (légende en BTC).

import type { BookView, MicroTrade, Venue } from './types';

export interface DepthColumn { t: number; mid: number; px: number[]; sz: number[] }
export interface Bubble { t: number; px: number; sz: number; side: 'buy' | 'sell' }
export interface Wall { t: number; px: number; sz: number; side: 'bid' | 'ask'; left: number }
export interface Coverage { venue: Venue; down: number; up: number }
export interface DepthState {
  step: number; range_pct: number; column_ms: number; window_ms: number; from: number | null;
  columns: DepthColumn[]; price: [number, number][]; bubbles: Bubble[]; walls: Wall[];
  levels: number[]; coverage: Coverage[];
}

export interface DepthOptions { windowMs: number; columnMs: number; sampleMs: number; rangePct: number; rows: number; bubbleMinBtc: number; wallMinBtc: number }
export const DEPTH_DEFAULTS: DepthOptions = { windowMs: 3_600_000, columnMs: 40_000, sampleMs: 5_000, rangePct: 0.5, rows: 30, bubbleMinBtc: 5, wallMinBtc: 40 };

const NICE = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
/** Pas « rond » pour couvrir ±rangePct en `rows` tranches. */
export function niceStep(px: number, rangePct: number, rows: number): number {
  const raw = (px * rangePct * 2) / 100 / rows;
  return NICE.find((n) => n >= raw) ?? 1000;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

export class DepthMap {
  readonly o: DepthOptions;
  step = 0;
  private columns: DepthColumn[] = [];
  private price: [number, number][] = [];
  private bubbles: Bubble[] = [];
  private walls: Wall[] = [];
  private last: number | null = null;
  private bucketStart = 0;
  private acc = { buy: { v: 0, n: 0 }, sell: { v: 0, n: 0 } };
  private tradedAt = new Map<number, number>();            // volume échangé par tranche depuis le dernier relevé
  private prev: Map<number, number> | null = null;
  private lastColumn = 0;
  private coverage: Coverage[] = [];
  private from: number | null = null;

  constructor(o: Partial<DepthOptions> = {}) { this.o = { ...DEPTH_DEFAULTS, ...o }; }

  private key(px: number): number { return Math.round(Math.floor(px / this.step) * this.step * 1e6) / 1e6; }

  onTrade(t: MicroTrade): void {
    if (t.market !== 'perp') return;
    this.last = t.px;
    const a = this.acc[t.side];
    a.v += t.sz; a.n += t.sz * t.px;
    if (this.step) { const k = this.key(t.px); this.tradedAt.set(k, (this.tradedAt.get(k) ?? 0) + t.sz); }
  }

  /** Relevé toutes les `sampleMs` : prix, bulles, carnet fusionné, murs retirés, colonne. */
  sample(now: number, views: BookView[]): void {
    const live = views.filter((v) => v.synced && v.bids.px.length && v.asks.px.length);
    if (!live.length) return;
    const mid = (Math.max(...live.map((v) => v.bids.px[0])) + Math.min(...live.map((v) => v.asks.px[0]))) / 2;
    if (!this.step) { this.step = niceStep(mid, this.o.rangePct, this.o.rows); this.from = now; this.bucketStart = now; }
    if (this.last !== null) this.price.push([now, this.last]);
    for (const side of ['buy', 'sell'] as const) {
      const a = this.acc[side];
      if (a.v >= this.o.bubbleMinBtc) this.bubbles.push({ t: this.bucketStart, px: a.n / a.v, sz: a.v, side });
    }
    this.acc = { buy: { v: 0, n: 0 }, sell: { v: 0, n: 0 } };
    this.bucketStart = now;

    // Carnet fusionné, chaque plateforme sur sa propre plage.
    const lo = mid * (1 - this.o.rangePct / 100), hi = mid * (1 + this.o.rangePct / 100);
    const cells = new Map<number, number>();
    const sides = new Map<number, 'bid' | 'ask'>();
    this.coverage = [];
    for (const v of live) {
      for (const [s, side] of [[v.bids, 'bid'], [v.asks, 'ask']] as const) {
        for (let i = 0; i < s.px.length; i++) {
          const p = s.px[i];
          if (p < lo || p > hi) continue;
          const k = this.key(p);
          cells.set(k, (cells.get(k) ?? 0) + s.sz[i]);
          sides.set(k, side);
        }
      }
      this.coverage.push({ venue: v.venue, down: Math.round((mid - v.bids.px[v.bids.px.length - 1]) * 100) / 100, up: Math.round((v.asks.px[v.asks.px.length - 1] - mid) * 100) / 100 });
    }
    // Murs retirés : forte baisse d'une tranche que les trades n'expliquent pas.
    if (this.prev) {
      for (const [k, before] of this.prev) {
        if (before < this.o.wallMinBtc) continue;
        const after = cells.get(k) ?? 0;
        const drop = before - after;
        if (after < before * 0.3 && (this.tradedAt.get(k) ?? 0) < drop * 0.2 && k >= lo && k <= hi) {
          this.walls.push({ t: now, px: k, sz: Math.round(before * 100) / 100, side: sides.get(k) ?? (k < mid ? 'bid' : 'ask'), left: Math.round(after * 100) / 100 });
        }
      }
    }
    this.prev = cells;
    this.tradedAt.clear();
    if (now - this.lastColumn >= this.o.columnMs) {
      const keys = [...cells.keys()].sort((a, b) => a - b);
      this.columns.push({ t: now, mid, px: keys, sz: keys.map((k) => Math.round(cells.get(k)! * 1000) / 1000) });
      this.lastColumn = now;
    }
    const cut = now - this.o.windowMs;
    while (this.columns.length && this.columns[0].t < cut) this.columns.shift();
    while (this.price.length && this.price[0][0] < cut) this.price.shift();
    while (this.bubbles.length && this.bubbles[0].t < cut) this.bubbles.shift();
    while (this.walls.length && this.walls[0].t < cut) this.walls.shift();
  }

  state(): DepthState {
    const all = this.columns.flatMap((c) => c.sz).filter((x) => x > 0).sort((a, b) => a - b);
    return {
      step: this.step, range_pct: this.o.rangePct, column_ms: this.o.columnMs, window_ms: this.o.windowMs, from: this.from,
      columns: this.columns, price: this.price, bubbles: this.bubbles, walls: this.walls,
      levels: [0.5, 0.8, 0.93, 0.98].map((q) => Math.round(quantile(all, q) * 100) / 100), coverage: this.coverage,
    };
  }
}
