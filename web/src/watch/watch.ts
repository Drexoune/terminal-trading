// Markets Watch (T-051, T-052) : définition des actifs hors crypto, état de leur marché, variation.
// Données : GET /api/p1/watch (Supabase), clé de store « watch:state ». Logique pure, testée.

import { exchange, marketStatus } from '../hours/exchanges';
import { zonedParts } from '../lib/time';

export const WATCH_KEY = 'watch:state';

export interface WatchPoint { t: number; price: number }
export interface WatchAsset {
  asset: string;
  source: string | null;
  last: { price: number; bid: number | null; ask: number | null; ts_source: number; ts_recv: number } | null;
  ref: { price: number; ts: number; kind: '24h' | 'veille' } | null;
  series: WatchPoint[];
  currency?: string;
}
export interface WatchState { configured: boolean; reason?: string; feed: { status?: string; last_error?: string | null } | null; assets: WatchAsset[]; computed_ms: number }

export type Market = 'fx' | 'ny' | 'paris' | 'daily';

export interface AssetDef {
  id: string;
  name: string;
  sub: string;
  decimals: number;
  unit?: '%' | '€';
  change: 'pct' | 'bp';            // variation en pourcentage, ou en points de base (taux)
  market: Market;
  source: string;                  // libellé de la source
  late_ms: number;                 // au-delà, la valeur est en retard (marché ouvert)
  note?: string;
}

const MIN = 60_000;
export const ASSETS: AssetDef[] = [
  { id: 'qqq', name: 'NASDAQ 100', sub: 'QQQ · IEX, substitut', decimals: 2, change: 'pct', market: 'ny', source: 'Tiingo · IEX', late_ms: 10 * MIN,
    note: 'prix de référence IEX de l’ETF QQQ (Tiingo), pas le future : aucune source gratuite pour les futures (T-051)' },
  { id: 'spy', name: 'S&P 500', sub: 'SPY · IEX, substitut', decimals: 2, change: 'pct', market: 'ny', source: 'Tiingo · IEX', late_ms: 10 * MIN,
    note: 'prix de référence IEX de l’ETF SPY (Tiingo), pas le future' },
  { id: 'usd-broad', name: 'Dollar (Fed)', sub: 'Indice large · quotidien', decimals: 2, change: 'pct', market: 'daily', source: 'FRED · DTWEXBGS', late_ms: 12 * 86_400_000,
    note: 'indice large du dollar de la Réserve fédérale, publié avec environ une semaine de retard ; pas le DXY de l’ICE (T-052)' },
  { id: 'us10y', name: 'US 10 ans', sub: 'Rendement · quotidien', decimals: 2, unit: '%', change: 'bp', market: 'daily', source: 'FRED · DGS10', late_ms: 5 * 86_400_000 },
  { id: 'xauusd', name: 'Or', sub: 'XAU/USD', decimals: 2, change: 'pct', market: 'fx', source: 'Tiingo · change', late_ms: 10 * MIN },
  { id: 'eurusd', name: 'EUR/USD', sub: 'Spot', decimals: 4, change: 'pct', market: 'fx', source: 'Tiingo · change', late_ms: 10 * MIN },
  { id: 'usdjpy', name: 'USD/JPY', sub: 'Spot', decimals: 2, change: 'pct', market: 'fx', source: 'Tiingo · change', late_ms: 10 * MIN },
  { id: 'pust', name: 'ETF Nasdaq 100', sub: 'PEA · Paris · clôture', decimals: 2, unit: '€', change: 'pct', market: 'paris', source: 'Bourse · Alpha Vantage', late_ms: 4 * 86_400_000 },
  { id: 'ese', name: 'ETF S&P 500', sub: 'PEA · Paris · clôture', decimals: 2, unit: '€', change: 'pct', market: 'paris', source: 'Bourse · Alpha Vantage', late_ms: 4 * 86_400_000 },
];

/** Lignes sans source (Markets Watch) : jamais un chiffre inventé. */
export const UNAVAILABLE = [
  { name: 'Future Nasdaq 100', sub: 'NQ · CME', reason: 'aucune source gratuite pour les futures (T-051)' },
  { name: 'Future S&P 500', sub: 'ES · CME', reason: 'aucune source gratuite pour les futures (T-051)' },
  { name: 'DXY', sub: 'Indice dollar ICE', reason: 'indice propriétaire de l’ICE, formule non utilisable sans accord (T-052)' },
];

/** Marché des changes ouvert : du dimanche 17:00 au vendredi 17:00, heure de New York. */
export function fxOpen(ms: number): boolean {
  const p = zonedParts(ms, 'America/New_York');
  const mins = p.h * 60 + p.mi;
  if (p.wd === 6) return false;
  if (p.wd === 7 || p.wd === 0) return mins >= 17 * 60;
  if (p.wd === 5) return mins < 17 * 60;
  return true;
}

export function marketLabel(m: Market, now: number): { text: string; open: boolean } {
  if (m === 'daily') return { text: 'Quotidien', open: false };
  if (m === 'fx') { const o = fxOpen(now); return { text: o ? 'Ouvert' : 'Fermé', open: o }; }
  const st = marketStatus(exchange(m === 'ny' ? 'NY' : 'PAR'), now);
  return { text: st.state === 'ouvert' ? 'Ouvert' : st.holiday ? 'Férié' : st.state === 'pause' ? 'Pause' : 'Fermé', open: st.state === 'ouvert' };
}

/** Variation : % (ou points de base pour un taux) contre la référence ; null sans référence. */
export function change(def: AssetDef, a: WatchAsset | undefined): number | null {
  if (!a?.last || !a.ref || a.ref.price === 0) return null;
  return def.change === 'bp' ? (a.last.price - a.ref.price) * 100 : a.last.price / a.ref.price - 1;
}

export function refLabel(a: WatchAsset | undefined): string {
  if (!a?.ref) return 'variation : référence absente (série trop courte)';
  return a.ref.kind === '24h' ? 'variation sur 24 h' : 'variation depuis la clôture (ou l’observation) précédente';
}

/** Valeur en retard : marché ouvert (ou série quotidienne) et dernier cours plus vieux que le seuil. */
export function isLate(def: AssetDef, a: WatchAsset | undefined, now: number): boolean {
  if (!a?.last) return false;
  const open = def.market === 'daily' || marketLabel(def.market, now).open;
  return open && now - a.last.ts_source > def.late_ms;
}
