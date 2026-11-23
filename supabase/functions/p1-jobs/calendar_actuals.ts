// Réel des événements de l'agenda tiré du fil d'actus (décision T-048, 23/11/2026) :
// ForexFactory ne publie pas le réel dans son fichier hebdomadaire ; FinancialJuice publie
// chaque chiffre en titre structuré (« UK Retail Sales MoM Actual 0.7% (Forecast 0%, …) »),
// 10 à 20 s après la publication. Le chiffre est rattaché à un événement de l'agenda et
// affiché comme réel « fil d'actus · FinancialJuice », jamais à la place d'un chiffre capté
// au BLS (T-022).
//
// Rattachement strict — un réel faux est pire qu'un « — » :
// - même pays (code du pays dans l'identifiant ForexFactory : us, ez, ge, fr, uk, jn…) ;
// - mêmes mots une fois retirés le pays, les éditeurs (S&P, HCOB…) et les mots d'édition
//   (flash, prelim, final…), « MoM » et « m/m » étant le même mot ;
// - titre lu entre T-2 min et T+30 min de l'heure de l'événement ;
// - un seul candidat ; s'il y en a plusieurs, le consensus identique départage, sinon rien.

import { parseValue } from './calendar.ts';

export interface CalendarActual {
  event_id: string;
  actual: string | null;
  actual_raw: string;
  unit: string | null;
  source: 'FinancialJuice';
  nature: 'fil d’actus';
  news_id: number;
  news_title: string;
  published_ms: number;
  event_time_ms: number;
  delay_ms: number;
}

export interface FigureItem {
  id: number;
  title: string;
  published_ms: number | null;
  received_ms: number;
  figure: { name: string; actual: string | null; forecast: string | null } | null;
}

interface Ev { id: string; title: string; currency: string; time_ms: number | null; forecast_raw: string | null; capture?: boolean }

/** Pays du titre FinancialJuice -> code pays des identifiants ForexFactory. */
const COUNTRY: [RegExp, string][] = [
  [/^(?:US|USA|U\.S\.)\b/i, 'us'], [/^(?:Eurozone|Euro Zone|Euro Area|EZ)\b/i, 'ez'], [/^(?:German|Germany)\b/i, 'ge'],
  [/^(?:French|France)\b/i, 'fr'], [/^(?:Italian|Italy)\b/i, 'it'], [/^(?:Spanish|Spain)\b/i, 'sp'], [/^(?:UK|British)\b/i, 'uk'],
  [/^(?:Japan|Japanese)\b/i, 'jn'], [/^(?:Swiss|Switzerland)\b/i, 'sz'], [/^(?:Canadian|Canada)\b/i, 'ca'],
  [/^(?:Australian|Australia)\b/i, 'au'], [/^(?:New Zealand|NZ)\b/i, 'nz'], [/^(?:China|Chinese)\b/i, 'ch'], [/^(?:Belgian|Belgium)\b/i, 'be'],
];
/** Adjectif de pays en tête d'un titre ForexFactory de la zone euro (« German Flash Services PMI »). */
const FF_COUNTRY_WORD = /^(?:German|French|Italian|Spanish|Belgian)\s+/i;
const SOFT = new Set(['flash', 'prelim', 'preliminary', 'final', 'advance', 'sa', 'nsa', 's', 'p', 'hcob', 'jibun', 'au', 'bank', 'judo', 'caixin', 'ratingdog']);
const ALIAS: Record<string, string> = { mom: 'mm', yoy: 'yy', qoq: 'qq' };
const WINDOW_BEFORE_MS = 2 * 60_000;
const WINDOW_AFTER_MS = 30 * 60_000;

export function countryOf(fjName: string): [string, string] | null {
  for (const [rx, code] of COUNTRY) {
    const m = rx.exec(fjName);
    if (m) return [code, fjName.slice(m[0].length).trim()];
  }
  return null;
}

export function words(title: string): string {
  return title.toLowerCase().replace(/\b([mqy])\/([mqy])\b/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .map((w) => ALIAS[w] ?? w).filter((w) => w && !SOFT.has(w)).sort().join(' ');
}

const ffCountry = (id: string) => /^\d+-([a-z]{2})-/.exec(id)?.[1] ?? null;
const sameNumber = (a: string | null, b: string | null) => {
  const [x] = parseValue(a);
  const [y] = parseValue(b);
  return x !== null && y !== null && Number(x) === Number(y);
};

/** Événement de l'agenda auquel rattacher un chiffre FinancialJuice, ou null. */
export function matchFigure(item: FigureItem, events: Ev[]): Ev | null {
  if (!item.figure || item.figure.actual === null) return null;
  const c = countryOf(item.figure.name);
  if (!c) return null;
  const [code, rest] = c;
  const key = words(rest);
  const t = item.published_ms ?? item.received_ms;
  const cands = events.filter((e) => e.time_ms !== null && ffCountry(e.id) === code
    && t >= e.time_ms - WINDOW_BEFORE_MS && t <= e.time_ms + WINDOW_AFTER_MS
    && words(e.title.replace(FF_COUNTRY_WORD, '')) === key);
  if (cands.length === 1) return cands[0];
  const byForecast = cands.filter((e) => sameNumber(e.forecast_raw, item.figure!.forecast));
  return byForecast.length === 1 ? byForecast[0] : null;
}

export function actualFor(item: FigureItem, ev: Ev): CalendarActual {
  const raw = item.figure!.actual!;
  const [value, unit] = parseValue(raw);
  const t = item.published_ms ?? item.received_ms;
  return { event_id: ev.id, actual: value, actual_raw: raw, unit: unit || null, source: 'FinancialJuice', nature: 'fil d’actus',
    news_id: item.id, news_title: item.title, published_ms: t, event_time_ms: ev.time_ms!, delay_ms: t - ev.time_ms! };
}
