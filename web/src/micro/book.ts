// Carnet local d'une plateforme (P5) : niveaux par prix, instantané puis mises à jour (taille 0 =
// niveau retiré). Les règles de continuité (seqId d'OKX, pu de Binance, u de Bybit) vivent dans
// chaque adaptateur ; ce module ne fait que tenir les niveaux et les lire triés.

import type { BookSide, BookView, Venue } from './types';

export type Level = [px: number, sz: number];

export class LocalBook {
  readonly bids = new Map<number, number>();
  readonly asks = new Map<number, number>();
  ts = 0;
  recv = 0;
  synced = false;

  private lo = -Infinity;
  private hi = Infinity;

  /**
   * scale : contrats → BTC (OKX : 0,01). maxLevels : profondeur publiée par la plateforme (OKX
   * 400, Bybit 1 000) ; un niveau sorti de cette profondeur n'est pas toujours retiré par le flux.
   * bounded (Binance) : le flux de diffs couvre tout le carnet, mais seuls les prix compris dans
   * l'instantané sont complets ; au-delà, seuls les niveaux modifiés depuis existent.
   */
  constructor(readonly venue: Venue, private readonly scale = 1, private readonly opts: { maxLevels?: number; bounded?: boolean } = {}) {}

  reset(): void {
    this.bids.clear(); this.asks.clear(); this.synced = false; this.ts = 0; this.lo = -Infinity; this.hi = Infinity;
  }

  snapshot(bids: Level[], asks: Level[], ts: number, recv: number): void {
    this.bids.clear(); this.asks.clear();
    this.apply(bids, asks, ts, recv);
    if (this.opts.bounded) {
      this.lo = bids.length ? Math.min(...bids.map((l) => l[0])) : -Infinity;
      this.hi = asks.length ? Math.max(...asks.map((l) => l[0])) : Infinity;
    }
    this.synced = true;
  }

  apply(bids: Level[], asks: Level[], ts: number, recv: number): void {
    for (const [p, s] of bids) { if (s > 0) this.bids.set(p, s * this.scale); else this.bids.delete(p); }
    for (const [p, s] of asks) { if (s > 0) this.asks.set(p, s * this.scale); else this.asks.delete(p); }
    this.ts = ts; this.recv = recv;
  }

  bestBid(): number | null { let b = -Infinity; for (const p of this.bids.keys()) if (p > b) b = p; return b === -Infinity ? null : b; }
  bestAsk(): number | null { let a = Infinity; for (const p of this.asks.keys()) if (p < a) a = p; return a === Infinity ? null : a; }

  /** Niveaux triés du meilleur au plus éloigné. */
  view(): BookView {
    const n = this.opts.maxLevels ?? Infinity;
    const side = (m: Map<number, number>, desc: boolean): BookSide => {
      const px = [...m.keys()].filter((p) => p >= this.lo && p <= this.hi).sort((a, b) => (desc ? b - a : a - b)).slice(0, n);
      return { px, sz: px.map((p) => m.get(p)!) };
    };
    return { venue: this.venue, ts: this.ts, recv: this.recv, bids: side(this.bids, true), asks: side(this.asks, false), synced: this.synced };
  }

  /** Un carnet croisé (meilleur achat ≥ meilleure vente) trahit une mise à jour manquée. */
  crossed(): boolean {
    const b = this.bestBid(), a = this.bestAsk();
    return b !== null && a !== null && b >= a;
  }
}

export const levels = (rows: (string | number)[][] | undefined): Level[] => (rows ?? []).map((r) => [Number(r[0]), Number(r[1])]);
