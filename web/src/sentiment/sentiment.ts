// Écrans de P4 (sentiment et liquidité) : types des réponses de /api/sentiment/*, clés du store,
// mise en forme et fraîcheur. Fonctions pures, testées par Vitest. Les chiffres viennent tous de
// l'état publié par p4-jobs ; rien n'est calculé ici hormis la mise en forme.

import { fmtNumber, fmtSigned, MINUS, NBSP } from '../lib/format';
import { fmtHm, zonedParts } from '../lib/time';

export const PARIS = 'Europe/Paris';
export const ROUTES = ['risk', 'cot', 'banks', 'crowding', 'liquidity'] as const;
export type Route = (typeof ROUTES)[number];
export const sentimentKey = (r: Route) => `sentiment:${r}`;
/** Flux de chaque route, recopiés dans le store sous feed:<nom> (barre de flux). */
export const FEED_OF: Record<Route, string> = { risk: 'closes', cot: 'cot', banks: 'cot', crowding: 'crowding', liquidity: 'liquidity' };

export interface FeedState {
  name: string; label?: string; status: string; last_message_ms: number | null; last_error: string | null;
  late_after_ms: number; stale_after_ms: number;
}
export interface SeriesStatus { label?: string; source?: string; last_date?: string; last_ok_ms?: number; error?: string | null }

export interface Reply<T> {
  configured: boolean; route: Route; reason?: string | null; computed_ms: number;
  published_ms?: number | null; feed: FeedState | null; data: T | null;
  series?: Record<string, SeriesStatus | null>;
}

// --- Indice de risque ----------------------------------------------------------------------------

export interface Zone { id: string; label: string; from: number; to: number }
export interface Component {
  id: string; label: string; description: string; unit: '%' | 'pts'; source: string;
  raw: number | null; percentile: number | null; reason: string | null; last_dates: Record<string, string | null>;
}
export interface Risk {
  date: string; index: number | null; zone: string | null; components_used: number; computed_ms: number;
  week_ago: { date: string; value: number | null } | null; month_ago: { date: string; value: number | null } | null;
  components: Component[]; history: { date: string; value: number }[];
  spy: { date: string; value: number }[]; vix: { date: string; value: number }[];
  zones: Zone[]; window: number; min_components: number;
}

export const ZONES: Zone[] = [
  { id: 'risk_off_strong', label: 'Risk-off fort', from: 0, to: 25 },
  { id: 'risk_off', label: 'Risk-off', from: 25, to: 45 },
  { id: 'neutral', label: 'Neutre', from: 45, to: 55 },
  { id: 'risk_on', label: 'Risk-on', from: 55, to: 75 },
  { id: 'risk_on_strong', label: 'Risk-on fort', from: 75, to: 100 },
];
export const zoneOf = (v: number): Zone => ZONES.find((z) => v < z.to) ?? ZONES[ZONES.length - 1];
/** Pastille de l'indice : RISK-OFF sous 45, RISK-ON au-dessus de 55, NEUTRAL entre les deux. */
export const biasOf = (v: number): 'RISK-OFF' | 'RISK-ON' | 'NEUTRAL' => (v < 45 ? 'RISK-OFF' : v >= 55 ? 'RISK-ON' : 'NEUTRAL');
/** Classe de couleur d'un percentile : corail sous 45, cyan à partir de 55. */
export const pctTone = (p: number): 'dn' | 'up' | 'nt' => (p < 45 ? 'dn' : p >= 55 ? 'up' : 'nt');

/** Valeur brute d'une composante : « 20,0 », « +1,58 % », « +5,63 pts ». */
export function fmtRaw(c: Pick<Component, 'id' | 'raw' | 'unit'>): string {
  if (c.raw === null) return '—';
  if (c.id === 'vix') return fmtNumber(c.raw, 1);
  return `${fmtSigned(c.raw, 2)}${NBSP}${c.unit}`;
}

/** Variation de l'indice (« ▼ 31 »), ou null si l'une des deux valeurs manque. */
export function indexMove(now: number | null, before: number | null | undefined): { text: string; dir: 'up' | 'dn' | 'nt' } | null {
  if (now === null || before == null) return null;
  const d = Math.round(now) - Math.round(before);
  return { text: `${d > 0 ? '▲' : d < 0 ? '▼' : '='} ${Math.abs(d)}`, dir: d > 0 ? 'up' : d < 0 ? 'dn' : 'nt' };
}

/** Fenêtre de l'historique (1 M, 3 M, 1 A) en séances. */
export const PERIODS = { '1M': 21, '3M': 63, '1A': 252 } as const;
export type Period = keyof typeof PERIODS;

// --- COT, banques, ratios, liquidité --------------------------------------------------------------

export interface CotCategory { long: number; short: number; net: number; net_change_1w: number | null; net_pct_oi: number; percentile_3y: number | null; weeks: number }
export interface CotMarket { code: string; label: string; group: string; date: string; open_interest: number; categories: Record<string, CotCategory>;
  history: { dates: string[]; net: Record<string, number[]> } }
export interface Cot { report_date: string | null; report: string; markets: CotMarket[]; computed_ms: number }
export const COT_CATEGORY_LABEL: Record<string, string> = {
  lev_money: 'Fonds spéculatifs', asset_mgr: 'Gérants d’actifs', dealer: 'Dealers', other_rept: 'Autres déclarants', nonrept: 'Non déclarants',
};
export const COT_CATEGORIES = ['lev_money', 'asset_mgr', 'dealer', 'other_rept', 'nonrept'] as const;

export interface BankMarket { code: string; label: string; group: string; date: string; open_interest: number; dealer: CotCategory | null;
  history: { dates: string[]; net: number[] } }
export interface BprMarket { market: string; label: string; group: string; date: string; banks: number | null; long: number; short: number; net: number;
  long_pct: number; short_pct: number; net_pct_oi: number; open_interest: number; net_change_1m: number | null; history: { date: string; net: number }[] }
export interface Bpr { report_date: string | null; markets: BprMarket[]; source: string; computed_ms: number }
export interface BanksReply extends Reply<{ report_date: string | null; label: string; markets: BankMarket[] }> {
  bpr: Bpr | null; bpr_reason: string | null; bpr_feed: FeedState | null; bpr_published_ms: number | null;
}

export interface CrowdMetric { last: number; ts: string; long_share: number | null; avg_30d: number | null; deviation_pct: number | null;
  days_covered: number; partial: boolean; spark: number[] }
export interface Crowding { assets: Record<string, Record<string, Record<string, CrowdMetric>>>; days: number; computed_ms: number }
export const EXCHANGES = ['binance', 'okx', 'bybit'] as const;
export const EXCHANGE_LABEL: Record<string, string> = { binance: 'Binance', okx: 'OKX', bybit: 'Bybit' };
export const CROWD_METRICS = ['account', 'top_account', 'top_position'] as const;
export const CROWD_METRIC_LABEL: Record<string, string> = { account: 'Comptes', top_account: 'Gros comptes', top_position: 'Gros comptes · positions' };

export interface LiquidityPoint { date: string; net: number; walcl: number; tga: number; rrp: number }
export interface Liquidity { last: LiquidityPoint | null; changes: Record<'w1' | 'w4' | 'w13' | 'w52', number | null>; history: LiquidityPoint[];
  unit: string; formula: string; computed_ms: number }

// --- Mise en forme ---------------------------------------------------------------------------------

/** « 23/11 » ou « 23/11/2026 ». */
export const fmtDay = (d: string | null | undefined, year = false) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}${year ? `/${d.slice(0, 4)}` : ''}` : '—');
/** Millions de dollars -> « 5 849 Md$ ». */
export const fmtBn = (musd: number | null | undefined, signed = false) =>
  (musd == null ? '—' : `${signed ? fmtSigned(musd / 1000, 0) : fmtNumber(musd / 1000, 0)}${NBSP}Md$`);
/** Contrats : « −76 587 », avec signe. */
export const fmtContracts = (n: number | null | undefined, signed = true) => (n == null ? '—' : signed ? fmtSigned(n, 0) : fmtNumber(n, 0));
/** Taux de financement par période (8 h) : « 0,0046 % ». */
export const fmtFunding = (r: number) => `${r < 0 ? MINUS : ''}${fmtNumber(Math.abs(r) * 100, 4)}${NBSP}%`;
/** Étiquette de mois court : « oct. 25 ». */
export function monthLabel(date: string): string {
  const m = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][Number(date.slice(5, 7)) - 1];
  return `${m} ${date.slice(2, 4)}`;
}
/** Cinq repères de dates également espacés sur une série. */
export function dateTicks(dates: string[], n = 5): string[] {
  if (!dates.length) return [];
  if (dates.length < n) return dates.map(monthLabel);
  return Array.from({ length: n }, (_, i) => monthLabel(dates[Math.round((i / (n - 1)) * (dates.length - 1))]));
}

export type Fresh = 'live' | 'late' | 'stale' | 'down';
/** Fraîcheur d'un flux selon ses seuils : connecté, en retard, périmé, ou rien reçu. */
export function feedFresh(feed: FeedState | null | undefined, now: number): Fresh {
  if (!feed || feed.last_message_ms == null) return 'down';
  const age = now - feed.last_message_ms;
  if (age > feed.stale_after_ms) return 'stale';
  if (age > feed.late_after_ms || feed.status !== 'connected') return 'late';
  return 'live';
}
/** Texte de la puce de fraîcheur : « Source · relevé 22:30 », « · périmé » au-delà du seuil. */
export function freshText(source: string, feed: FeedState | null | undefined, now: number): string {
  const f = feedFresh(feed, now);
  if (f === 'down') return `${source} · —`;
  const p = zonedParts(feed!.last_message_ms!, PARIS);
  const today = zonedParts(now, PARIS);
  const day = p.d === today.d && p.m === today.m ? '' : `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')} `;
  return `${source} · relevé ${day}${fmtHm(feed!.last_message_ms!, PARIS)}${f === 'stale' ? ' · périmé' : ''}`;
}
