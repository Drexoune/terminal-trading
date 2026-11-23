// Agenda économique (étape E2) : types publiés par le service « calendar » de la
// passerelle (gateway/terminal_gateway/calendar_service.py) et logique pure de
// l'écran : jours à Paris, états, filtres, semaines, impact. Testée par Vitest.

import { DASH, MINUS, NBSP } from '../lib/format';
import { tzOffsetMs, zonedParts } from '../lib/time';

export const PARIS = 'Europe/Paris';

export interface CalendarEvent {
  id: string;
  title: string;                 // VO ForexFactory (T-019)
  title_fr: string | null;       // indicateurs captés seulement
  indicator: string | null;
  capture: boolean;
  currency: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday' | string;
  ny_date: string;
  time_ms: number | null;        // heure officielle si connue, sinon ForexFactory
  time_source: 'BLS' | 'ForexFactory';
  time_kind: string;             // « officielle », « indicative », « Tentative », « All Day »…
  ff_time_ms: number | null;
  time_mismatch: boolean;
  official: { local_date?: string; local_time: string; tz: string; release?: string } | null;
  forecast_raw: string | null;
  forecast: string | null;
  previous_raw: string | null;
  previous: string | null;
  unit: string | null;
  actual: string | null;
  series: string | null;
}

/**
 * Réel tiré du fil d'actus (T-048) : chiffre structuré de FinancialJuice rattaché à l'événement
 * par la tâche « news » (clé calendar:actual:<id>). Jamais à la place d'un chiffre capté au BLS.
 */
export interface CalendarActual {
  event_id: string;
  actual: string | null;
  actual_raw: string;
  unit: string | null;
  source: 'FinancialJuice';
  nature: string;
  news_id: number;
  news_title: string;
  published_ms: number;
  event_time_ms: number;
  delay_ms: number;
}

/** Infobulle du réel tiré du fil d'actus : source, délai, titre d'origine. */
export function actualSourceText(a: CalendarActual): string {
  const s = Math.round(a.delay_ms / 1000);
  return `Fil d’actus · ${a.source} · titre lu ${s >= 0 ? `${s}\u00a0s après` : `${-s}\u00a0s avant`} l’heure prévue · « ${a.news_title} »`;
}

export interface SourceStamp { source_ts_ms: number | null; received_ms: number | null }

export interface CalendarWeek {
  week: string;                  // « 2026-W47 »
  from: string;                  // dimanche (New York)
  to: string;                    // samedi
  events: CalendarEvent[];
  archive: boolean;
  forexfactory: SourceStamp;
  bls: SourceStamp | null;
}

export interface CalendarNext { events: CalendarEvent[]; computed_ms: number; week: string | null; forexfactory: SourceStamp | null }

/** Cinq prochains événements Fort ou Moyen (même règle que calendar_service.next_events). */
export function nextEvents(week: CalendarWeek | null | undefined, now: number, count = 5): CalendarNext {
  const events = (week?.events ?? [])
    .filter((e) => (e.impact === 'High' || e.impact === 'Medium') && e.time_ms !== null && e.time_ms > now)
    .sort((a, b) => (a.time_ms as number) - (b.time_ms as number));
  return { events: events.slice(0, count), computed_ms: now, week: week?.week ?? null, forexfactory: week?.forexfactory ?? null };
}

// --- devises et impact -----------------------------------------------------------------

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'] as const;
const FLAG: Record<string, string> = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CAD: 'ca', AUD: 'au', NZD: 'nz', CHF: 'ch', CNY: 'cn' };
export const flagCode = (currency: string): string | null => FLAG[currency] ?? null;

export type ImpactLevel = 3 | 2 | 1 | 0;
export const IMPACTS = [{ key: 'High', label: 'Fort' }, { key: 'Medium', label: 'Moyen' }, { key: 'Low', label: 'Faible' }] as const;
export function impactLevel(impact: string): ImpactLevel {
  return impact === 'High' ? 3 : impact === 'Medium' ? 2 : impact === 'Low' ? 1 : 0;
}

// --- jours et heures à Paris ------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Jour d'un événement à Paris (AAAA-MM-JJ) ; sans heure, son jour à New York. */
export function parisDay(ev: CalendarEvent): string {
  if (ev.time_ms === null) return ev.ny_date;
  const p = zonedParts(ev.time_ms, PARIS);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function todayParis(now: number): string {
  const p = zonedParts(now, PARIS);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });

/** « lundi 16 novembre » pour un jour AAAA-MM-JJ. */
export function dayLabel(day: string): string {
  return DAY_FMT.format(new Date(`${day}T12:00:00Z`));
}

/** « mar. 20 oct. » pour le panneau de la Vue d'ensemble. */
export function shortDay(day: string): string {
  return SHORT_FMT.format(new Date(`${day}T12:00:00Z`));
}

/** Heure affichée à Paris, ou la nature de l'heure quand ForexFactory n'en donne pas. */
export function timeLabel(ev: CalendarEvent): string {
  if (ev.time_ms === null) return ev.time_kind === 'All Day' ? 'Journée' : ev.time_kind === 'Tentative' ? 'Non fixée' : ev.time_kind;
  const p = zonedParts(ev.time_ms, PARIS);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** Décalage de Paris à l'instant donné : « UTC+1 », « UTC+2 » (jamais écrit en dur). */
export function parisOffsetLabel(now: number): string {
  const h = tzOffsetMs(now, PARIS) / 3_600_000;
  return `UTC${h >= 0 ? '+' : MINUS}${Math.abs(h)}`;
}

/** Groupes par jour de Paris, dans l'ordre chronologique. */
export function groupByDay(events: CalendarEvent[]): { day: string; events: CalendarEvent[] }[] {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const d = parisDay(ev);
    const list = map.get(d) ?? [];
    list.push(ev);
    map.set(d, list);
  }
  return [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, evs]) => ({
    day, events: evs.sort((x, y) => (x.time_ms ?? -1) - (y.time_ms ?? -1)),
  }));
}

// --- état d'une ligne -------------------------------------------------------------------

/** Fenêtre « En attente » : l'heure de publication approche. */
export const PENDING_MS = 60 * 60_000;
/** « Nouveau » : 15 minutes après une publication captée (E3). */
export const NEW_MS = 15 * 60_000;

export type RowState =
  | { kind: 'upcoming' }
  | { kind: 'pending'; remainingMs: number }
  | { kind: 'new' }
  | { kind: 'past' };

export function rowState(ev: CalendarEvent, now: number): RowState {
  if (ev.time_ms === null) return { kind: 'upcoming' };
  const dt = ev.time_ms - now;
  if (dt > PENDING_MS) return { kind: 'upcoming' };
  if (dt > 0) return { kind: 'pending', remainingMs: dt };
  if (ev.actual !== null && -dt < NEW_MS) return { kind: 'new' };
  return { kind: 'past' };
}

/** « 00:23:56 ». */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** « J-3 », « Aujourd'hui », « Demain ». */
export function daysUntil(day: string, now: number): string {
  const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${todayParis(now)}T00:00:00Z`)) / 86_400_000);
  return n <= 0 ? 'Aujourd’hui' : n === 1 ? 'Demain' : `J-${n}`;
}

/** Raison d'un réel absent (jamais une valeur inventée). */
export function actualReason(ev: CalendarEvent, now: number): string {
  if (ev.time_ms !== null && ev.time_ms > now) return 'pas encore publié';
  return ev.capture ? 'chiffre réel non capté : passerelle du Mac arrêtée, service release inactif ou BLS_CONTACT_EMAIL absente'
    : 'chiffre réel non capté : ForexFactory ne publie pas le réel, et aucun titre FinancialJuice rattaché';
}

// --- valeurs ------------------------------------------------------------------------------

/** « 0.4 » + « % » → « 0,4 % » ; « 198 » + « K » → « 198 k » ; texte brut sinon. */
export function fmtValue(value: string | null, unit: string | null, raw: string | null): string {
  if (value === null) return raw ?? DASH;
  const n = value.replace('-', MINUS).replace('.', ',');
  const u = unit === '%' ? `${NBSP}%` : unit === 'K' ? `${NBSP}k` : unit === 'M' ? `${NBSP}M` : unit === 'B' ? `${NBSP}Md` : unit === 'T' ? `${NBSP}T` : '';
  return `${n}${u}`;
}

// --- filtres et semaines -----------------------------------------------------------------

export interface Filters { currencies: Set<string>; impacts: Set<string>; query: string }

export function applyFilters(events: CalendarEvent[], f: Filters): CalendarEvent[] {
  const q = f.query.trim().toLowerCase();
  return events.filter((e) => f.currencies.has(e.currency)
    && (f.impacts.has(e.impact) || (e.impact === 'Holiday' && f.impacts.has('Low')))
    && (!q || e.title.toLowerCase().includes(q) || (e.title_fr ?? '').toLowerCase().includes(q)));
}

/** « 2026-W47 » ± n semaines (semaines ISO). */
export function shiftWeek(week: string, n: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return week;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const monday = jan4 - (((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000) + (Number(m[2]) - 1 + n) * 7 * 86_400_000;
  const d = new Date(monday + 3 * 86_400_000);   // jeudi : il donne l'année ISO
  const y = d.getUTCFullYear();
  const j4 = Date.UTC(y, 0, 4);
  const w1 = j4 - (((new Date(j4).getUTCDay() + 6) % 7) * 86_400_000);
  return `${y}-W${pad(Math.floor((monday - w1) / (7 * 86_400_000)) + 1)}`;
}

const RANGE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** « 15 – 21 nov. 2026 » (dimanche → samedi, comme ForexFactory). */
export function weekRangeLabel(from: string, to: string): string {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} – ${RANGE_FMT.format(b)}`
    : `${RANGE_FMT.format(a).replace(/ \d{4}$/, '')} – ${RANGE_FMT.format(b)}`;
}
