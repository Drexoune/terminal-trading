// Écran Taux (plan P2, R3) : forme des données de /api/rates/* et logique d'affichage pure, testée.
// Données : clé de store « rates:state » (état des 8 banques, flux, décisions, porte) et
// « rates:history:<BANQUE>:<AAAA-MM-JJ> » (évolution des probabilités d'une réunion).

import { zonedParts } from '../lib/time';
import { fmtNumber, MINUS, NBSP } from '../lib/format';

export const RATES_KEY = 'rates:state';
export const historyKey = (bank: string, meeting: string) => `rates:history:${bank}:${meeting}`;

export const BANKS = ['FED', 'BCE', 'BOE', 'BOJ', 'BNS', 'BOC', 'RBA', 'RBNZ'] as const;
export type Bank = (typeof BANKS)[number];
export const OUTCOMES = ['m50', 'm25', 'hold', 'p25', 'p50'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = { m50: `${MINUS}50${NBSP}pb et +`, m25: `${MINUS}25${NBSP}pb`, hold: 'Statu quo', p25: `+25${NBSP}pb`, p50: `+50${NBSP}pb et +` };
export const SOURCES = ['futures', 'polymarket', 'kalshi'] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = { futures: 'Futures', polymarket: 'Polymarket', kalshi: 'Kalshi' };
/** Seuil d'écart affiché à côté de l'écart maximal (points) ; l'alerte a son propre seuil (R5). */
export const GAP_DISPLAY_THRESHOLD = 5;
/** Nom court du comité, en-tête du panneau « prochaine réunion ». */
export const COMMITTEE: Record<Bank, string> = { FED: 'FOMC', BCE: 'Conseil des gouverneurs', BOE: 'MPC', BOJ: 'Policy Board', BNS: 'Direction générale',
  BOC: 'Conseil de direction', RBA: 'Monetary Policy Board', RBNZ: 'MPC' };
/** Code ISO du drapeau (design/assets/flags) par banque. */
export const FLAG: Record<Bank, string> = { FED: 'us', BCE: 'eu', BOE: 'gb', BOJ: 'jp', BNS: 'ch', BOC: 'ca', RBA: 'au', RBNZ: 'nz' };

export interface Quote { p: number | null; bid: number | null; ask: number | null; last: number | null; wide: boolean; vol24: number | null }
export interface SourceBlock {
  probs?: Partial<Record<Outcome, Quote>>; total?: number | null; sum_ok?: boolean | null; expected_bp?: number | null;
  ts_source?: number | null; ts_recv?: number; ref?: string; title?: string; missing?: string;
}
export interface Meeting { date: string; days: number; sources: Partial<Record<Source, SourceBlock>>; gap: { pts: number; outcome: Outcome; sources: [string, string] } | null }
export interface Policy {
  rate?: number; date?: string; last_change?: { date: string; from: number; to: number } | null; since?: string; ts_recv?: number;
  label?: string; display?: number; range?: [number, number] | null; basis?: string | null; missing?: string;
}
export interface PathPoint { meeting: string; rate: number; delta_bp: number }
export interface Path { source?: string; base?: number; points?: PathPoint[]; end?: number; note?: string; truncated?: boolean; missing?: string }
export interface BankState {
  bank: Bank; name: string; currency: string; tz: string; time: string | null;
  calendar: { source: 'officielle' | 'marchés'; url: string; read_on: string; until: string | null; note: string | null };
  policy: Policy; next: Meeting | null; meetings: Meeting[]; path: Path;
}
export interface Vote { kind: 'nominatif' | 'non nominatif' | 'non publié' | 'consensus' | 'lien'; for?: number; against?: number; unanimous?: boolean;
  dissents?: { name: string; preferred: string }[]; note?: string }
export interface Decision { bank: Bank; decision_date: string; change_bp: number | null; rate_text: string | null; vote: Vote; quote: string | null; source_url: string; ts_recv: string }
export interface FeedState { name: string; label?: string; status: string; last_message_ms: number | null; last_error: string | null; late_after_ms: number; stale_after_ms: number }
export interface RatesReply {
  configured: boolean; reason?: string;
  state: { computed_ms: number; minute_ms: number; banks: Record<Bank, BankState>; unmatched: string[] } | null;
  state_ms: number | null; feeds: FeedState[]; decisions: Partial<Record<Bank, Decision>>;
  gate: { meeting: string; window_min: number; polymarket: number; kalshi: number; last_ms: number | null } | null;
  computed_ms: number;
}
export interface HistoryReply {
  bank: Bank; meeting: string; days: number;
  series: Partial<Record<'polymarket' | 'kalshi', Partial<Record<Outcome, { t: number; p: number }[]>>>>;
  markers: { label: string; title: string; date: string; t: number; source: string }[];
  computed_ms: number;
}

// --- formats ---------------------------------------------------------------------------------

const PARIS = 'Europe/Paris';
const pad = (n: number) => String(n).padStart(2, '0');

/** « 2026-12-09 » -> « 09/12/2026 ». */
export const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** Instant -> « 09/12 » (Paris). */
export function fmtDayMonth(ms: number): string {
  const p = zonedParts(ms, PARIS);
  return `${pad(p.d)}/${pad(p.m)}`;
}
const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];
/** « 2026-12-09 » -> « DÉC. 26 » (axe de la trajectoire). */
export const fmtMonthYear = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
/** Probabilité 0–1 -> « 86,5 » (en %, une décimale). */
export const fmtProb = (p: number | null | undefined) => (typeof p === 'number' ? fmtNumber(p * 100, 1) : '—');
/** Taux -> « 4,00 % ». */
export const fmtRate = (r: number | null | undefined, decimals = 2) => (typeof r === 'number' ? `${fmtNumber(r, decimals)}${NBSP}%` : '—');

/** J-n à partir de la date du jour dans le fuseau de la banque. */
export function daysTo(date: string, tz: string, now: number): number {
  const p = zonedParts(now, tz);
  const today = Date.UTC(p.y, p.m - 1, p.d);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86_400_000);
}
export function fmtCountdown(days: number): string {
  if (days === 0) return 'aujourd’hui';
  if (days < 0) return `J+${-days}`;
  return `J-${days}`;
}

/** Variation en points de base -> « +25 pb », « −25 pb », « Statu quo ». */
export function fmtMove(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—';
  if (bp === 0) return 'Statu quo';
  return `${bp > 0 ? '+' : MINUS}${fmtNumber(Math.abs(bp), Number.isInteger(bp) ? 0 : 1)}${NBSP}pb`;
}
export const moveClass = (bp: number | null | undefined) => (!bp ? '' : bp > 0 ? 'up' : 'dn');

// --- prochaine réunion -------------------------------------------------------------------------

/** Issues montrées : statu quo, ±25 pb, et les ±50 pb dès qu'une source leur donne 2 % ou plus. */
export function shownOutcomes(m: Meeting | null): Outcome[] {
  const big = (o: Outcome) => SOURCES.some((s) => (m?.sources[s]?.probs?.[o]?.p ?? 0) >= 0.02);
  return OUTCOMES.filter((o) => o === 'm25' || o === 'hold' || o === 'p25' || big(o));
}

/** Source de référence d'une réunion : Polymarket (8 banques), sinon Kalshi. */
export function primarySource(m: Meeting | null): 'polymarket' | 'kalshi' | null {
  if (m?.sources.polymarket?.probs) return 'polymarket';
  if (m?.sources.kalshi?.probs) return 'kalshi';
  return null;
}

/** Principale alternative au statu quo : l'issue la plus probable hors statu quo (source de référence). */
export function mainAlternative(m: Meeting | null): Outcome {
  const src = primarySource(m);
  const probs = src ? m!.sources[src]!.probs! : {};
  let best: Outcome = 'p25', bestP = -1;
  for (const o of OUTCOMES) {
    if (o === 'hold') continue;
    const p = probs[o]?.p ?? -1;
    if (p > bestP) { best = o; bestP = p; }
  }
  return best;
}

// --- échelles ----------------------------------------------------------------------------------

/** Bornes de l'axe des taux : marge d'un quart de l'étendue (6 pb au moins), repères aux multiples de 0,25. */
export function rateAxis(values: number[]): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = Math.max(0.06, (hi - lo) * 0.26);
  const min = lo - pad, max = hi + pad;
  const step = max - min > 2 ? 0.5 : 0.25;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100 || 0);   // jamais « −0 »
  return { min, max, ticks };
}

/** Points d'une série en coordonnées 0–1000 × 0–h, entre deux instants. */
export function seriesPath(pts: { t: number; p: number }[], from: number, to: number, h: number): string {
  const span = Math.max(1, to - from);
  return pts.filter((x) => x.t >= from && x.t <= to)
    .map((x, i) => `${i ? 'L' : 'M'}${(((x.t - from) / span) * 1000).toFixed(1)} ${(h - x.p * h).toFixed(1)}`).join('');
}

// --- comités -----------------------------------------------------------------------------------

const PREFERRED: Record<string, string> = { hausse: 'pour une hausse', baisse: 'pour une baisse', 'statu quo': 'pour le statu quo' };

/** Résumé du vote : « 10–2 · 2 pour une hausse », « Non publié », « Consensus · non publié ». */
export function voteSummary(v: Vote | undefined | null): string {
  if (!v) return '—';
  if (v.kind === 'non publié') return 'Non publié';
  if (v.kind === 'consensus') return 'Consensus · non publié';
  if (v.kind === 'lien') return v.note ?? 'Communiqué en lien';
  if (v.unanimous) return 'Unanimité';
  if (v.for === undefined || v.against === undefined) return v.kind === 'non nominatif' ? 'Vote non nominatif' : '—';
  const head = `${v.for}–${v.against}`;
  if (!v.against) return `${head} · unanimité`;
  const prefs = [...new Set((v.dissents ?? []).map((d) => d.preferred))];
  const pref = prefs.length === 1 && PREFERRED[prefs[0]] ? ` ${PREFERRED[prefs[0]]}` : '';
  return `${head} · ${v.against}${pref}${v.kind === 'non nominatif' ? ' · vote non nominatif' : ''}`;
}

/** Fraîcheur d'un horodatage : « il y a 12 s », « il y a 3 min ». */
export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `il y a ${s}${NBSP}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m}${NBSP}min`;
  const h = Math.round(m / 60);
  return h < 48 ? `il y a ${h}${NBSP}h` : `il y a ${Math.round(h / 24)}${NBSP}j`;
}

/** Cotes de chaque minute : périmées au-delà de 3 min (deux passages manqués). */
export const QUOTE_STALE_MS = 3 * 60_000;
