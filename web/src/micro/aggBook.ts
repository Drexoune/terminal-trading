// Carnet agrégé des perpétuels (P5, docs/ecrans.md § 7) : carnets d'OKX, Binance, Bybit et
// Hyperliquid regroupés par tranches de prix (10 $ par défaut), tailles additionnées en BTC.
// Achats : tranche = prix arrondi vers le bas ; ventes : vers le haut (une tranche ne mélange
// jamais les deux côtés). Déséquilibre sur N niveaux = (Σ achats − Σ ventes) / (Σ achats + Σ ventes).

import type { BookView, Venue } from './types';

export interface AggLevel { px: number; sz: number; cum: number; venues: Partial<Record<Venue, number>> }
export interface AggBook {
  step: number; levels: number;
  bids: AggLevel[]; asks: AggLevel[];
  best_bid: number | null; best_ask: number | null; spread: number | null; crossed: boolean;
  imbalance: number | null;                     // > 0 : plus d'achats ; < 0 : plus de ventes
  venues: Venue[];                              // carnets synchronisés qui ont compté
  missing: { venue: Venue; reason: string }[];
  ts: number;
}

const bucket = (px: number, step: number, side: 'bid' | 'ask') => {
  const k = px / step;
  return Math.round((side === 'bid' ? Math.floor(k + 1e-9) : Math.ceil(k - 1e-9)) * step * 1e6) / 1e6;
};

/** Tranches d'un côté sur l'ensemble des carnets, triées du meilleur au plus éloigné. */
export function binSide(books: BookView[], side: 'bid' | 'ask', step: number, from: number | null, n: number): AggLevel[] {
  const m = new Map<number, AggLevel>();
  for (const b of books) {
    const s = side === 'bid' ? b.bids : b.asks;
    for (let i = 0; i < s.px.length; i++) {
      const k = bucket(s.px[i], step, side);
      if (from !== null && (side === 'bid' ? k > from : k < from)) continue;
      const l = m.get(k) ?? { px: k, sz: 0, cum: 0, venues: {} };
      l.sz += s.sz[i];
      l.venues[b.venue] = (l.venues[b.venue] ?? 0) + s.sz[i];
      m.set(k, l);
    }
  }
  const out = [...m.values()].sort((a, b) => (side === 'bid' ? b.px - a.px : a.px - b.px)).slice(0, n);
  let cum = 0;
  for (const l of out) { cum += l.sz; l.cum = cum; }
  return out;
}

export function aggregate(views: BookView[], step = 10, n = 10, now = 0): AggBook {
  const ok = views.filter((v) => v.synced && v.bids.px.length && v.asks.px.length);
  const missing = views.filter((v) => !ok.includes(v)).map((v) => ({ venue: v.venue, reason: v.synced ? 'carnet vide' : 'carnet en cours de synchronisation' }));
  const bestBid = ok.length ? Math.max(...ok.map((v) => v.bids.px[0])) : null;
  const bestAsk = ok.length ? Math.min(...ok.map((v) => v.asks.px[0])) : null;
  const crossed = bestBid !== null && bestAsk !== null && bestBid >= bestAsk;
  // Point de départ : la tranche du meilleur achat et celle de la meilleure vente.
  const bids = binSide(ok, 'bid', step, null, n), asks = binSide(ok, 'ask', step, null, n);
  const sb = bids.reduce((s, l) => s + l.sz, 0), sa = asks.reduce((s, l) => s + l.sz, 0);
  return {
    step, levels: n, bids, asks, best_bid: bestBid, best_ask: bestAsk,
    spread: bestBid !== null && bestAsk !== null ? Math.round((bestAsk - bestBid) * 1e6) / 1e6 : null, crossed,
    imbalance: sb + sa > 0 ? (sb - sa) / (sb + sa) : null,
    venues: ok.map((v) => v.venue), missing, ts: now,
  };
}
