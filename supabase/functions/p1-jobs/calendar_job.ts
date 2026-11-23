// Tâches « ff-calendar » et « bls-calendar » de p1-jobs (plan « Tout en ligne », O2) :
// portage du service calendar de la passerelle (gateway/terminal_gateway/calendar_service.py).
//
// - ForexFactory : une requête conditionnelle (ETag, Last-Modified) par heure, à hh:45 ;
//   second passage à hh:55, sauté si le relevé de hh:45 a réussi. Chaque relevé est archivé
//   (calendar_snapshots, archive privée T-018) ; chaque nouvelle version d'un événement
//   devient une ligne de calendar_events.
// - BLS : bls.ics une fois par jour (06:10 UTC, nouvel essai à 06:40), adresse de contact
//   dans le User-Agent (T-023) ; une date annoncée avant et absente du calendrier du jour est
//   « déplacée ».
// - État publié dans p1_state, sous les mêmes clés que le bus de la passerelle :
//   calendar:week:<AAAA-Wnn>, calendar:official, feed:calendar, feed:bls-calendar. La semaine
//   précédente est archivée (dernière version de chaque événement) si elle manque.
//
// Module pur : réseau, horloge et base injectés, testé par Vitest.

import {
  attachOfficial, eventDict, INDICATORS, parseBlsIcs, parseFfXml, parseValue, TRACKED_RELEASES, weekBounds, weekId,
  type FfEvent, type OfficialRelease,
} from './calendar.ts';
import type { HeadersLike } from './explore.ts';
import { fromBytea, sha256Hex, toBytea, type Json, type Rest, type Row } from './rest.ts';

export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
export const BLS_ICS_URL = 'https://www.bls.gov/schedule/news_release/bls.ics';
export const FF_FRESH_MS = 20 * 60_000;           // relevé réussi depuis moins : passage sauté
export const BLS_FRESH_MS = 20 * 3_600_000;
const DAY_MS = 86_400_000;
const EVENTS_LOOKBACK_MS = 14 * DAY_MS;

export const FF_FEED = { name: 'calendar', label: 'Agenda', late_after_ms: 75 * 60_000, stale_after_ms: 3 * 3_600_000 };
export const BLS_FEED = { name: 'bls-calendar', label: 'Calendrier BLS', late_after_ms: 26 * 3_600_000, stale_after_ms: 50 * 3_600_000 };

export interface HttpResponse { status: number; headers: HeadersLike; arrayBuffer(): Promise<ArrayBuffer> }
export type HttpFetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<HttpResponse>;

export interface CalendarDeps {
  fetch: HttpFetch;
  now: () => number;
  env: (name: string) => string | undefined;
  rest: Rest;
}

export interface CalendarResult {
  job: 'ff-calendar' | 'bls-calendar';
  ok: boolean;
  skipped?: string;
  status?: number | null;
  events?: number;
  week?: string | null;
  moved?: number;
  error?: string;
}

// --- état publié -------------------------------------------------------------------------

export interface FeedState {
  name: string; label: string; late_after_ms: number; stale_after_ms: number; status: string;
  connected_since_ms: number | null; last_message_ms: number | null; reconnects: number;
  outages: unknown[]; last_error: string | null;
}

async function getState<T>(rest: Rest, key: string): Promise<T | null> {
  const rows = await rest.select<{ value: T }>('p1_state', { select: 'value', key: `eq.${key}`, limit: '1' });
  return rows[0]?.value ?? null;
}

async function putState(rest: Rest, entries: [string, unknown][], now: number): Promise<void> {
  await rest.upsert('p1_state', entries.map(([key, value]) => ({ key, value: value as Json, updated_ms: now })), 'key');
}

export function feedOk(base: typeof FF_FEED, prev: FeedState | null, t: number): FeedState {
  const wasOk = prev?.status === 'connected';
  return { ...base, status: 'connected', connected_since_ms: wasOk ? prev!.connected_since_ms : t, last_message_ms: t,
    reconnects: prev?.reconnects ?? 0, outages: [], last_error: null };
}

export function feedFail(base: typeof FF_FEED, prev: FeedState | null, why: string, stop = false): FeedState {
  return { ...base, status: stop ? 'stopped' : 'reconnecting', connected_since_ms: prev?.connected_since_ms ?? null,
    last_message_ms: prev?.last_message_ms ?? null, reconnects: (prev?.reconnects ?? 0) + (stop ? 0 : 1), outages: [],
    last_error: why.slice(0, 200) };
}

function httpMs(v: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// --- lectures en base ------------------------------------------------------------------------

interface SnapshotRow { id: number; body: string | null; etag: string | null; source_ts_ms: number | null; received_ms: number }

async function lastSnapshot(rest: Rest, source: string, statuses: string, withBody = false): Promise<SnapshotRow | null> {
  const rows = await rest.select<SnapshotRow>('calendar_snapshots', {
    select: withBody ? 'id,body,etag,source_ts_ms,received_ms' : 'id,etag,source_ts_ms,received_ms',
    source: `eq.${source}`, status: `in.(${statuses})`, order: 'id.desc', limit: '1',
  });
  return rows[0] ?? null;
}

/** Publications du dernier calendrier du BLS relevé (celles qu'il annonce encore). */
export async function latestOfficial(rest: Rest): Promise<OfficialRelease[]> {
  const top = await rest.select<{ last_seen_ms: number }>('official_releases', {
    select: 'last_seen_ms', source: 'eq.BLS', order: 'last_seen_ms.desc', limit: '1' });
  if (!top.length) return [];
  return rest.select<OfficialRelease>('official_releases', {
    select: 'title,local_date,local_time,tz,utc_ms', source: 'eq.BLS', last_seen_ms: `eq.${top[0].last_seen_ms}`,
    order: 'utc_ms.asc', limit: '5000' });
}

// --- charges publiées (mêmes formes que la passerelle) -------------------------------------------

export function weekPayload(events: FfEvent[], official: OfficialRelease[], ff: { source_ts_ms: number | null; received_ms: number | null },
  bls: { source_ts_ms: number | null; received_ms: number | null } | null): Record<string, unknown> | null {
  if (!events.length) return null;
  const week = weekId(events[0].ny_date);
  const off = attachOfficial(events, official);
  const list = events.map((e) => eventDict(e, off.get(e.identity)))
    .sort((a, b) => String(a.ny_date).localeCompare(String(b.ny_date)) || ((a.time_ms as number | null) ?? -1) - ((b.time_ms as number | null) ?? -1));
  const [from, to] = weekBounds(week);
  return { week, from, to, events: list, archive: false, forexfactory: ff, bls: official.length ? bls : null };
}

export function officialPayload(official: OfficialRelease[], moved: unknown[], meta: { source_ts_ms: number | null; received_ms: number | null }, now: number) {
  const upcoming = official.filter((r) => TRACKED_RELEASES.includes(r.title) && r.utc_ms > now).sort((a, b) => a.utc_ms - b.utc_ms);
  return { releases: upcoming.slice(0, 12), moved, source_ts_ms: meta.source_ts_ms, received_ms: meta.received_ms };
}

const LABEL_FR = new Map(INDICATORS.map((i) => [i.id, i.label_fr]));

/** Semaine passée depuis l'archive : dernière version de chaque événement (calendar_service.week). */
export async function archiveWeek(rest: Rest, week: string): Promise<Record<string, unknown> | null> {
  const [from, to] = weekBounds(week);
  const rows = await rest.select<Row & { id: number; identity: string }>('calendar_events', {
    select: '*', first_seen_ms: `gte.${Date.parse(`${from}T00:00:00Z`) - EVENTS_LOOKBACK_MS}`, order: 'id.asc', limit: '10000' });
  const latest = new Map<string, Row & { id: number; identity: string }>();
  for (const r of rows) latest.set(r.identity, r);   // ordre croissant : la dernière version gagne
  const events = [...latest.values()].filter((r) => {
    const d = r.identity.split('|')[2];
    return from <= d && d <= to;
  }).map((r) => {
    const [forecast, unit] = parseValue(r.forecast_raw as string | null);
    const [previous] = parseValue(r.previous_raw as string | null);
    const tOff = r.official_time_ms as number | null;
    const ff = r.ff_time_ms as number | null;
    return {
      id: r.identity, title: r.title, title_fr: r.indicator_id ? LABEL_FR.get(r.indicator_id as string) ?? null : null,
      indicator: r.indicator_id, capture: r.indicator_id !== null, currency: r.currency, impact: r.impact,
      ny_date: r.identity.split('|')[2], time_ms: tOff ?? ff, time_source: tOff !== null ? 'BLS' : 'ForexFactory',
      time_kind: tOff !== null ? 'officielle' : (ff !== null ? 'indicative' : r.ff_time_kind),
      ff_time_ms: ff, time_mismatch: tOff !== null && ff !== null && tOff !== ff,
      official: tOff !== null ? { local_time: r.official_local, tz: r.official_tz } : null,
      forecast_raw: r.forecast_raw || null, forecast, previous_raw: r.previous_raw || null, previous, unit,
      actual: null, series: r.identity.split('|')[0], last_seen_ms: r.last_seen_ms,
    };
  }).sort((a, b) => String(a.ny_date).localeCompare(String(b.ny_date)) || ((a.time_ms as number | null) ?? -1) - ((b.time_ms as number | null) ?? -1));
  if (!events.length) return null;
  return { week, from, to, events, archive: true,
    forexfactory: { source_ts_ms: null, received_ms: Math.max(...events.map((e) => e.last_seen_ms as number)) }, bls: null };
}

// --- écritures ------------------------------------------------------------------------------

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Nouvelle version d'un événement seulement si prévision, précédent ou heure changent. */
export async function storeEvents(rest: Rest, events: FfEvent[], official: OfficialRelease[], received: number, snapId: number): Promise<{ updated: number; inserted: number }> {
  const existing = await rest.select<Row & { id: number }>('calendar_events', {
    select: '*', status: 'eq.prévu', first_seen_ms: `gte.${received - EVENTS_LOOKBACK_MS}`, order: 'id.desc', limit: '10000' });
  const off = attachOfficial(events, official);
  const updates: Row[] = [];
  const inserts: Row[] = [];
  for (const ev of events) {
    const o = off.get(ev.identity);
    const officialCols = { official_time_ms: o ? o.utc_ms : null, official_local: o ? o.local_time : null, official_tz: o ? o.tz : null };
    const match = existing.find((r) => r.identity === ev.identity && same(r.forecast_raw, ev.forecast_raw)
      && same(r.previous_raw, ev.previous_raw) && same(r.ff_time_ms, ev.time_ms));
    if (match) {
      updates.push({ ...match, last_seen_ms: received, snapshot_id: snapId, ...officialCols });
    } else {
      inserts.push({
        identity: ev.identity, indicator_id: ev.indicator ? ev.indicator.id : null, title: ev.title, currency: ev.currency,
        ff_time_ms: ev.time_ms, ff_time_kind: ev.time_ms !== null ? 'exacte' : ev.time_raw, ...officialCols,
        impact: ev.impact, forecast_raw: ev.forecast_raw, forecast: parseValue(ev.forecast_raw)[0], previous_raw: ev.previous_raw,
        status: 'prévu', first_seen_ms: received, last_seen_ms: received, snapshot_id: snapId,
      });
    }
  }
  await rest.upsert('calendar_events', updates, 'id');
  await rest.insert('calendar_events', inserts);
  return { updated: updates.length, inserted: inserts.length };
}

/** Publications du BLS : première vue gardée ; une date à venir absente du jour est « déplacée ». */
export async function storeOfficial(rest: Rest, releases: OfficialRelease[], received: number): Promise<Row[]> {
  const known = await rest.select<{ id: number; title: string; local_date: string; local_time: string; first_seen_ms: number }>(
    'official_releases', { select: 'id,title,local_date,local_time,first_seen_ms', source: 'eq.BLS', limit: '10000' });
  const byKey = new Map(known.map((k) => [`${k.title}|${k.local_date}|${k.local_time}`, k]));
  const updates: Row[] = [];
  const inserts: Row[] = [];
  for (const r of releases) {
    const k = byKey.get(`${r.title}|${r.local_date}|${r.local_time}`);
    const row = { source: 'BLS', title: r.title, local_date: r.local_date, local_time: r.local_time, tz: r.tz, utc_ms: r.utc_ms, last_seen_ms: received };
    if (k) updates.push({ id: k.id, ...row, first_seen_ms: k.first_seen_ms });
    else inserts.push({ ...row, first_seen_ms: received });
  }
  await rest.upsert('official_releases', updates, 'id');
  await rest.insert('official_releases', inserts);
  const gone = await rest.select<Row & { title: string }>('official_releases', {
    select: 'title,local_date,local_time,tz,utc_ms,last_seen_ms', source: 'eq.BLS', last_seen_ms: `lt.${received}`,
    utc_ms: `gt.${received}`, limit: '1000' });
  return gone.filter((m) => TRACKED_RELEASES.includes(m.title));
}

async function insertSnapshot(rest: Rest, source: string, url: string, status: number, h: HeadersLike | null, received: number,
  body: Uint8Array | null): Promise<number> {
  const [row] = await rest.insert<{ id: number }>('calendar_snapshots', [{
    source, url, status, source_ts_ms: h ? httpMs(h.get('last-modified')) : null, received_ms: received,
    etag: h?.get('etag') ?? null, sha256: body ? await sha256Hex(body) : null, body: body ? toBytea(body) : null,
  }], 'id');
  return row.id;
}

/** Semaine en cours (depuis le dernier XML), calendrier officiel, flux : tout l'état de l'agenda. */
async function publishCalendar(rest: Rest, now: number, extra: [string, unknown][] = []): Promise<string | null> {
  const ok = await lastSnapshot(rest, 'ForexFactory', '200', true);
  const lastSeen = await lastSnapshot(rest, 'ForexFactory', '200,304');
  const blsOk = await lastSnapshot(rest, 'BLS', '200,304');
  const blsBody = await lastSnapshot(rest, 'BLS', '200');
  const official = await latestOfficial(rest);
  const events = ok ? parseFfXml(fromBytea(ok.body) ?? new Uint8Array()) : [];
  const payload = weekPayload(events, official,
    { source_ts_ms: ok?.source_ts_ms ?? null, received_ms: lastSeen?.received_ms ?? null },
    blsOk ? { source_ts_ms: blsBody?.source_ts_ms ?? null, received_ms: blsOk.received_ms } : null);
  const entries: [string, unknown][] = [...extra];
  if (payload) entries.push([`calendar:week:${payload.week}`, payload]);
  const prev = await getState<{ moved?: unknown[] }>(rest, 'calendar:official');
  entries.push(['calendar:official', officialPayload(official, prev?.moved ?? [],
    { source_ts_ms: blsBody?.source_ts_ms ?? null, received_ms: blsOk?.received_ms ?? null }, now)]);
  const week = payload ? String(payload.week) : null;
  if (week) {
    const [from] = weekBounds(week);
    const before = weekId(new Date(Date.parse(`${from}T12:00:00Z`) - DAY_MS).toISOString().slice(0, 10));
    if (!(await getState(rest, `calendar:week:${before}`))) {
      const archived = await archiveWeek(rest, before);
      if (archived) entries.push([`calendar:week:${before}`, archived]);
    }
  }
  await putState(rest, entries, now);
  return week;
}

// --- tâches -----------------------------------------------------------------------------------

export async function runFfCalendar(deps: CalendarDeps, force = false): Promise<CalendarResult> {
  const { rest } = deps;
  const now = deps.now();
  const seen = await lastSnapshot(rest, 'ForexFactory', '200,304');
  if (!force && seen && now - seen.received_ms < FF_FRESH_MS) {
    return { job: 'ff-calendar', ok: true, skipped: 'relevé réussi il y a moins de 20 min' };
  }
  const prevFeed = await getState<FeedState>(rest, 'feed:calendar');
  const last = await lastSnapshot(rest, 'ForexFactory', '200');
  const headers: Record<string, string> = { 'User-Agent': 'terminal-trading/0.1', Accept: 'application/xml' };
  if (last?.etag) headers['If-None-Match'] = last.etag;
  if (last?.source_ts_ms) headers['If-Modified-Since'] = new Date(last.source_ts_ms).toUTCString();
  let r: HttpResponse;
  try {
    r = await deps.fetch(FF_URL, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    const why = `ForexFactory injoignable : ${e instanceof Error ? e.message : String(e)}`;
    await putState(rest, [['feed:calendar', feedFail(FF_FEED, prevFeed, why)]], now);
    return { job: 'ff-calendar', ok: false, status: null, error: why };
  }
  const body = r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : null;
  const snapId = await insertSnapshot(rest, 'ForexFactory', FF_URL, r.status, r.headers, now, body);
  if (r.status !== 200 && r.status !== 304) {
    const why = `ForexFactory : HTTP ${r.status}`;
    await putState(rest, [['feed:calendar', feedFail(FF_FEED, prevFeed, why)]], now);
    return { job: 'ff-calendar', ok: false, status: r.status, error: why };
  }
  let n = 0;
  if (body) {
    const events = parseFfXml(body);
    n = events.length;
    await storeEvents(rest, events, await latestOfficial(rest), now, snapId);
  }
  const week = await publishCalendar(rest, now, [['feed:calendar', feedOk(FF_FEED, prevFeed, now)]]);
  return { job: 'ff-calendar', ok: true, status: r.status, events: n, week };
}

export async function runBlsCalendar(deps: CalendarDeps, force = false): Promise<CalendarResult> {
  const { rest } = deps;
  const now = deps.now();
  const prevFeed = await getState<FeedState>(rest, 'feed:bls-calendar');
  const email = deps.env('BLS_CONTACT_EMAIL')?.trim();
  if (!email) {
    const why = 'BLS_CONTACT_EMAIL absente des secrets : heure officielle indisponible';
    await putState(rest, [['feed:bls-calendar', feedFail(BLS_FEED, prevFeed, why, true)]], now);
    return { job: 'bls-calendar', ok: false, error: why };
  }
  const seen = await lastSnapshot(rest, 'BLS', '200,304');
  if (!force && seen && now - seen.received_ms < BLS_FRESH_MS) {
    return { job: 'bls-calendar', ok: true, skipped: 'calendrier relevé il y a moins de 20 h' };
  }
  const last = await lastSnapshot(rest, 'BLS', '200');
  const headers: Record<string, string> = { 'User-Agent': `terminal-trading/0.1 (${email})`, Accept: 'text/calendar' };
  if (last?.etag) headers['If-None-Match'] = last.etag;
  let r: HttpResponse;
  try {
    r = await deps.fetch(BLS_ICS_URL, { headers, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    const why = `BLS injoignable : ${e instanceof Error ? e.message : String(e)}`.split(email).join('<contact>');
    await putState(rest, [['feed:bls-calendar', feedFail(BLS_FEED, prevFeed, why)]], now);
    return { job: 'bls-calendar', ok: false, status: null, error: why };
  }
  const body = r.status === 200 ? new Uint8Array(await r.arrayBuffer()) : null;
  await insertSnapshot(rest, 'BLS', BLS_ICS_URL, r.status, r.headers, now, body);
  if (r.status !== 200 && r.status !== 304) {
    const why = `BLS : HTTP ${r.status}${r.status === 403 ? ' (contact refusé ou débit dépassé)' : ''}`;
    await putState(rest, [['feed:bls-calendar', feedFail(BLS_FEED, prevFeed, why)]], now);
    return { job: 'bls-calendar', ok: false, status: r.status, error: why };
  }
  const extra: [string, unknown][] = [['feed:bls-calendar', feedOk(BLS_FEED, prevFeed, now)]];
  let moved: Row[] | null = null;
  if (body) {
    const [releases] = parseBlsIcs(new TextDecoder('utf-8').decode(body));
    moved = await storeOfficial(rest, releases, now);
    // L'état calendar:official est recalculé par publishCalendar ; la liste des dates
    // déplacées y est gardée d'un passage à l'autre.
    await putState(rest, [['calendar:official', { moved }]], now);
  }
  const week = await publishCalendar(rest, now, extra);
  return { job: 'bls-calendar', ok: true, status: r.status, week, moved: moved?.length ?? 0 };
}
