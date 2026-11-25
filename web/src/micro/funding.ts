// Funding et open interest des perpétuels (P5, docs/ecrans.md § 7, T-067).
// - Funding ramené à 8 h : taux × 8 / intervalle (Hyperliquid paie toutes les heures : × 8).
// - OI en BTC (contrats convertis) et en dollars (valeur publiée, sinon OI × marque).
// - Variation 24 h de l'OI, en BTC (sans effet de prix) : OI courant contre le point d'historique
//   le plus proche d'il y a 24 h (à 90 min près). Hyperliquid n'a pas d'historique public : « — ».
// - Prime perp / spot = (marque − indice) / indice (Hyperliquid : oracle).
// - Total : OI additionnés ; funding et prime pondérés par l'OI en dollars ; variation 24 h sur
//   les seules plateformes qui ont un historique (nommées).

import { PERP_VENUES, type FundingView, type OiView, type PremiumView, type Venue } from './types';

export const OI_TOLERANCE_MS = 90 * 60_000;
export const DAY_MS = 86_400_000;
export const NO_OI_HISTORY: Partial<Record<Venue, string>> = { hyperliquid: 'aucun historique public de l’OI' };

export interface OiPoint { ts: number; oi_btc: number }

export interface FundingRow {
  venue: Venue;
  rate: number | null; interval_h: number | null; rate_8h: number | null; next_ms: number | null;
  oi_btc: number | null; oi_usd: number | null;
  oi_24h: number | null; oi_24h_reason: string | null;
  premium: number | null;
  ts: number | null;                                  // dernière mise à jour (heure de la plateforme)
}
export interface FundingState {
  rows: FundingRow[];
  total: { rate_8h: number | null; oi_btc: number | null; oi_usd: number | null; oi_24h: number | null; oi_24h_venues: Venue[]; premium: number | null; venues: Venue[] };
}

/** Point d'historique le plus proche de `at`, à `tol` près. */
export function nearest(points: OiPoint[], at: number, tol = OI_TOLERANCE_MS): OiPoint | null {
  let best: OiPoint | null = null;
  for (const p of points) if (Math.abs(p.ts - at) <= tol && (!best || Math.abs(p.ts - at) < Math.abs(best.ts - at))) best = p;
  return best;
}

export const rate8h = (rate: number, intervalH: number) => (rate * 8) / intervalH;

export class FundingBoard {
  private funding = new Map<Venue, FundingView>();
  private oi = new Map<Venue, OiView>();
  private premium = new Map<Venue, PremiumView>();
  private history = new Map<Venue, OiPoint[]>();
  private historyError = new Map<Venue, string>();

  setFunding(f: FundingView): void { this.funding.set(f.venue, f); }
  setOi(o: OiView): void { this.oi.set(o.venue, o); }
  setPremium(p: PremiumView): void { this.premium.set(p.venue, p); }
  setHistory(v: Venue, pts: OiPoint[]): void { this.history.set(v, [...pts].sort((a, b) => a.ts - b.ts)); this.historyError.delete(v); }
  historyFailed(v: Venue, reason: string): void { if (!this.history.has(v)) this.historyError.set(v, reason); }

  row(v: Venue, now: number): FundingRow {
    const f = this.funding.get(v), o = this.oi.get(v), p = this.premium.get(v);
    const usd = o ? (o.oi_usd ?? (p ? o.oi_btc * p.mark : null)) : null;
    let oi24: number | null = null, why: string | null = NO_OI_HISTORY[v] ?? null;
    if (!why) {
      const h = this.history.get(v);
      const past = h ? nearest(h, now - DAY_MS) : null;
      if (!o) why = 'OI pas encore reçu';
      else if (!h) why = this.historyError.get(v) ?? 'historique en cours de chargement';
      else if (!past) why = 'aucun point d’historique il y a 24 h';
      else oi24 = o.oi_btc / past.oi_btc - 1;
    }
    return {
      venue: v,
      rate: f?.rate ?? null, interval_h: f?.interval_h ?? null, rate_8h: f ? rate8h(f.rate, f.interval_h) : null, next_ms: f?.next_ms ?? null,
      oi_btc: o?.oi_btc ?? null, oi_usd: usd, oi_24h: oi24, oi_24h_reason: oi24 === null ? why : null,
      premium: p && p.index > 0 ? (p.mark - p.index) / p.index : null,
      ts: Math.max(f?.ts ?? 0, o?.ts ?? 0, p?.ts ?? 0) || null,
    };
  }

  state(now: number): FundingState {
    const rows = PERP_VENUES.map((v) => this.row(v, now));
    const weighted = (pick: (r: FundingRow) => number | null) => {
      let s = 0, w = 0;
      for (const r of rows) { const x = pick(r); if (x !== null && r.oi_usd) { s += x * r.oi_usd; w += r.oi_usd; } }
      return w > 0 ? s / w : null;
    };
    const withOi = rows.filter((r) => r.oi_btc !== null);
    const with24 = rows.filter((r) => r.oi_24h !== null && r.oi_btc !== null);
    const past = with24.reduce((s, r) => s + r.oi_btc! / (1 + r.oi_24h!), 0);
    return {
      rows,
      total: {
        rate_8h: weighted((r) => r.rate_8h),
        oi_btc: withOi.length ? withOi.reduce((s, r) => s + r.oi_btc!, 0) : null,
        oi_usd: rows.some((r) => r.oi_usd !== null) ? rows.reduce((s, r) => s + (r.oi_usd ?? 0), 0) : null,
        oi_24h: with24.length ? with24.reduce((s, r) => s + r.oi_btc!, 0) / past - 1 : null,
        oi_24h_venues: with24.map((r) => r.venue),
        premium: weighted((r) => r.premium),
        venues: withOi.map((r) => r.venue),
      },
    };
  }
}
