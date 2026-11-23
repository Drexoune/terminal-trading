// Tâche « capture » de p1-jobs (plan « Tout en ligne », étape O3) : capture des chiffres du
// BLS à l'heure H, depuis Supabase. Portage de gateway/terminal_gateway/release_service.py
// dans les limites d'une Edge Function (150 s par appel) : pg_cron l'appelle CHAQUE MINUTE,
// et chaque appel fait ce que l'heure demande, pour chaque publication suivie annoncée par
// le dernier calendrier du BLS (official_releases) :
//
//   T-90 s < maintenant <= T   rafale : une requête à T-60 s (référence), puis une par seconde
//                               de T-3 s à T+60 s, une seule en vol ; verrou en base (une seule
//                               rafale même si deux appels se chevauchent)
//   T+60 s < maintenant <= T+5 min   une requête toutes les 10 s si rien n'est capté
//   T+10 min ->                 rattrapage (T-040) : communiqué relu (.nr0, page complète, copie
//                               archivée), puis API v1 si la page reste illisible
//   T+31 min ->                 réaction du BTC (table okx_candles_1m)
//   T+15 min, T+60 min, 12:00 New York   API v1 : révisions et chiffres à compléter (T-041)
//
// Mêmes règles que sur le Mac : nouveauté jugée sur la date d'embargo, première publication
// jamais écrasée, 403 ou 429 = arrêt sans contournement, une requête par seconde au plus.
// État publié dans p1_state sous les clés du bus : release:<indicateur>:<période>[:<édition>],
// release:last, release:state, reaction:<publication>:<jour>.

import { API_V1, DAILY_MAX, DERIVATIONS, derive, parseResponse, requestBody, sameValue, shift, type ApiData, type Derived } from './bls_api.ts';
import { BLS, BY_TITLE, classify, parsePage, RELEASES, type Figure, type Parsed, type Release } from './bls_release.ts';
import { INDICATORS, NEW_YORK, civilDate, zonedToUtc } from './calendar.ts';
import { latestOfficial } from './calendar_job.ts';
import type { HeadersLike } from './explore.ts';
import { BEFORE_MS, btcReaction, DUE_AFTER_MS, FINAL_AFTER_MS, INST } from './reaction.ts';
import type { Json, Rest, Row } from './rest.ts';
import { rawSurprise, zScore, Z_FIRM_N } from './surprise.ts';

export const MACHINE = 'supabase';
const MIN = 60_000;
const DAY = 86_400_000;
export const BURST_LEAD_MS = 90_000;
const WALL_MS = 140_000;                // marge sous les 150 s d'une Edge Function (offre gratuite)
const LATE_SLACK_MS = 500;
const TAIL_END_MS = 5 * MIN + 10_000;
const CATCHUP_FROM_MS = 10 * MIN;
const CATCHUP_WINDOW_MS = 35 * DAY;
const CATCHUP_PER_RUN = 2;
const API_FALLBACK_AFTER_MS = 60 * MIN;
const API_CHECKS: [number, string][] = [[15 * MIN, 'révisions T+15min'], [60 * MIN, 'révisions T+60min']];
const REVISION_GRACE_MS = 7 * DAY;
const OKX_TIME = 'https://eea.okx.com/api/v5/public/time';
const LABELS = new Map(INDICATORS.map((i) => [i.id, i]));

export interface CapResponse { status: number; headers: HeadersLike; arrayBuffer(): Promise<ArrayBuffer> }
export type CapFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<CapResponse>;

export interface CaptureDeps {
  fetch: CapFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  env: (name: string) => string | undefined;
  rest: Rest;
}

export interface Scheduled { release: Release; local_date: string; local_time: string; utc_ms: number }

interface Got { status: number | null; headers: HeadersLike; body: Uint8Array; send_ms: number; first_byte_ms: number | null; done_ms: number; error: string | null }

const NO_HEADERS: HeadersLike = { get: () => null };

// --- outils -------------------------------------------------------------------------------

export function archiveUrl(rel: Release, localDate: string): string {
  const [y, m, d] = localDate.split('-');
  return `${BLS}/news.release/archives/${rel.key}_${m}${d}${y}.htm`;
}

export function releaseKey(indicator: string, period: string, edition: string | null): string {
  return `release:${indicator}:${period}${edition ? `:${edition}` : ''}`;
}

const utcDayStart = (ms: number) => ms - (ms % DAY);

async function putState(rest: Rest, entries: [string, unknown][], now: number): Promise<void> {
  if (entries.length) await rest.upsert('p1_state', entries.map(([key, value]) => ({ key, value: value as Json, updated_ms: now })), 'key');
}

async function getState<T>(rest: Rest, key: string): Promise<T | null> {
  const rows = await rest.select<{ value: T }>('p1_state', { select: 'value', key: `eq.${key}`, limit: '1' });
  return rows[0]?.value ?? null;
}

async function lock(rest: Rest, key: string, now: number): Promise<boolean> {
  const made = await rest.insertIgnore('p1_state', [{ key, value: { at: now }, updated_ms: now }], 'key', 'key');
  return made.length > 0;
}

async function get(deps: CaptureDeps, url: string, headers: Record<string, string>, init: { method?: string; body?: string } = {}): Promise<Got> {
  const send = deps.now();
  try {
    const r = await deps.fetch(url, { ...init, headers, signal: AbortSignal.timeout(10_000) });
    const fb = deps.now();
    const body = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, body, send_ms: send, first_byte_ms: fb, done_ms: deps.now(), error: null };
  } catch (e) {
    return { status: null, headers: NO_HEADERS, body: new Uint8Array(), send_ms: send, first_byte_ms: null, done_ms: deps.now(),
      error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

function userAgent(deps: CaptureDeps): Record<string, string> | null {
  const email = deps.env('BLS_CONTACT_EMAIL')?.trim();
  return email ? { 'User-Agent': `terminal-trading/0.1 (${email})`, 'Accept-Encoding': 'gzip' } : null;
}

async function logPoll(rest: Rest, s: Scheduled, label: string, url: string, got: Got, parsed: Parsed | null, verdict: string | null): Promise<void> {
  let zeros = 0;
  for (const b of got.body) if (b === 0) zeros++;
  await rest.insert('release_polls', [{
    release: s.release.key, scheduled_ms: s.utc_ms, label, url, send_ms: got.send_ms, first_byte_ms: got.first_byte_ms,
    done_ms: got.done_ms, status: got.status, size: got.body.length, null_bytes: zeros, period: parsed?.period ?? null,
    embargo_date: parsed?.embargo_date ?? null, verdict, error: got.error,
  }]);
}

/** Écart horloge OKX - horloge de la fonction (ms), mesuré au milieu de l'aller-retour. */
async function okxOffset(deps: CaptureDeps): Promise<number | null> {
  const got = await get(deps, OKX_TIME, {});
  if (got.status !== 200) return null;
  try {
    const ts = Number((JSON.parse(new TextDecoder().decode(got.body)) as { data?: { ts?: string }[] }).data?.[0]?.ts);
    return Number.isFinite(ts) ? Math.round(ts - (got.send_ms + got.done_ms) / 2) : null;
  } catch {
    return null;
  }
}

export async function scheduled(rest: Rest, from: number, to: number): Promise<Scheduled[]> {
  return (await latestOfficial(rest))
    .filter((r) => BY_TITLE[r.title] && r.utc_ms >= from && r.utc_ms <= to)
    .map((r) => ({ release: BY_TITLE[r.title], local_date: r.local_date, local_time: r.local_time, utc_ms: r.utc_ms }));
}

async function captured(rest: Rest, s: Scheduled): Promise<boolean> {
  const rows = await rest.select('releases', { select: 'id', release: `eq.${s.release.key}`, ny_date: `eq.${s.local_date}`, limit: '1' });
  return rows.length > 0;
}

async function publishState(rest: Rest, s: Scheduled | null, phase: string | null, now: number, extra: Record<string, unknown> = {}): Promise<void> {
  await putState(rest, [['release:state', {
    phase, release: s?.release.key ?? null, title: s?.release.title ?? null, scheduled_ms: s?.utc_ms ?? null,
    ny_date: s?.local_date ?? null, polls: 0, baseline_read: null, reason: null, problems: [], computed_ms: now, machine: MACHINE, ...extra,
  }]], now);
}

// --- enregistrement -------------------------------------------------------------------------

async function forecastFor(rest: Rest, ind: string, nyDate: string, t: number): Promise<{ forecast?: string | null; forecast_raw?: string | null; seen_ms?: number | null }> {
  const rows = await rest.select<{ forecast: string | null; forecast_raw: string | null }>('calendar_events', {
    select: 'forecast,forecast_raw', indicator_id: `eq.${ind}`, identity: `like.*|${nyDate}|*`, first_seen_ms: `lte.${t}`, order: 'id.desc', limit: '1' });
  if (!rows.length) return {};
  const seen = await rest.select<{ received_ms: number }>('calendar_snapshots', {
    select: 'received_ms', source: 'eq.ForexFactory', status: 'in.(200,304)', received_ms: `lte.${t}`, order: 'received_ms.desc', limit: '1' });
  return { ...rows[0], seen_ms: seen[0]?.received_ms ?? null };
}

async function history(rest: Rest, ind: string, before: number): Promise<string[]> {
  const rows = await rest.select<{ surprise: string }>('releases', {
    select: 'surprise', indicator_id: `eq.${ind}`, surprise: 'not.is.null', regular: 'eq.1', scheduled_ms: `lt.${before}`, order: 'scheduled_ms.asc', limit: '1000' });
  return rows.map((r) => r.surprise);
}

export function payload(row: Row, provisional: boolean, offset: number | null, revisions: Row[] = []): Record<string, unknown> {
  const ind = LABELS.get(String(row.indicator_id));
  const nature = String(row.nature ?? 'officielle');
  const fb = nature === 'officielle' ? (row.first_byte_ms as number | null) : null;
  return {
    indicator: row.indicator_id, label_fr: ind?.label_fr ?? null, unit: ind?.unit ?? null, release: row.release,
    period: row.period, edition: row.edition, ny_date: row.ny_date, value: row.value, reason: row.reason, part: row.part,
    excerpt: row.excerpt, flags: JSON.parse(String(row.flags ?? '[]')), timing: row.timing, nature, source: 'BLS',
    url: row.url, machine: row.machine, scheduled_ms: row.scheduled_ms, embargo_ms: row.embargo_ms,
    first_byte_ms: fb, received_ms: row.received_ms,
    capture_delay_ms: fb ? Math.round(fb + (offset ?? 0) - (row.scheduled_ms as number)) : null,
    clock_corrected: offset !== null, forecast: row.forecast, forecast_raw: row.forecast_raw,
    forecast_age_ms: row.forecast_seen_ms ? (row.scheduled_ms as number) - (row.forecast_seen_ms as number) : null,
    surprise: row.surprise, z: row.z, z_n: row.z_n, z_provisional: provisional, z_reason: row.z_reason,
    regular: !!row.regular, display_ms: row.display_ms ?? null, revisions, filled_ms: row.filled_ms ?? null,
  };
}

interface RecordCtx { lastWithout: number | null; offset: number | null }

async function record(deps: CaptureDeps, s: Scheduled, parsed: Parsed, got: Got, verdict: string, url: string,
  nature: string, ctx: RecordCtx): Promise<string[]> {
  const { rest } = deps;
  const parsedMs = deps.now();
  const entries: [string, unknown][] = [];
  const keys: string[] = [];
  const busMs = deps.now();
  for (const [ind, f] of Object.entries(parsed.figures)) {
    const fc = await forecastFor(rest, ind, s.local_date, s.utc_ms);
    const surprise = rawSurprise(f.value, fc.forecast ?? null);
    const irregular = f.value === null && (f.reason ?? '').startsWith('publication irrég');
    const hist = await history(rest, ind, s.utc_ms);
    const z = f.value !== null ? zScore(surprise, hist, f.value) : { z: null, n: hist.length, provisional: false, reason: 'chiffre non lu' };
    const row: Row = {
      indicator_id: ind, release: s.release.key, period: parsed.period!, edition: parsed.edition ?? '', ny_date: s.local_date,
      value: f.value, reason: f.reason, part: f.part, excerpt: f.excerpt, flags: JSON.stringify(f.flags), timing: verdict,
      scheduled_ms: s.utc_ms, embargo_ms: parsed.embargo_ms, first_byte_ms: got.first_byte_ms, received_ms: got.done_ms,
      url, machine: MACHINE, forecast: fc.forecast ?? null, forecast_raw: fc.forecast_raw ?? null,
      forecast_seen_ms: fc.seen_ms ?? null, surprise, z: z.z, z_n: z.n, z_reason: z.reason,
      regular: irregular || verdict !== 'attendue' ? 0 : 1, nature,
    };
    await rest.insertIgnore('releases', [row], 'indicator_id,period,edition', 'id');
    const p = { ...payload(row, z.provisional, ctx.offset), bus_ms: busMs, parsed_ms: parsedMs, last_without_ms: ctx.lastWithout,
      date_header: got.headers.get('date') };
    const key = releaseKey(ind, parsed.period!, parsed.edition);
    keys.push(key);
    entries.push([key, p]);
  }
  if (nature === 'officielle') {
    await rest.insertIgnore('release_timings', [{
      release: s.release.key, period: parsed.period!, edition: parsed.edition ?? '', scheduled_ms: s.utc_ms,
      last_without_ms: ctx.lastWithout, first_send_ms: got.send_ms, first_byte_ms: got.first_byte_ms, parsed_ms: parsedMs,
      bus_ms: busMs, okx_offset_ms: ctx.offset, date_header: got.headers.get('date'),
    }], 'release,period,edition', 'id');
  }
  entries.push(['release:last', { release: s.release.key, title: s.release.title, period: parsed.period, edition: parsed.edition,
    ny_date: s.local_date, keys, timing: verdict, scheduled_ms: s.utc_ms, bus_ms: busMs, nature }]);
  await putState(rest, entries, deps.now());
  return keys;
}

// --- rafale et suite -----------------------------------------------------------------------------

export function burstPlan(t: number): [number, string][] {
  const plan: [number, string][] = [[t - 60_000, 'T-60s']];
  for (let s = -3; s <= 60; s++) plan.push([t + s * 1000 + 50, 'rafale']);
  return plan;
}

interface PollLoop { phase: string; polls: number; reason: string | null; problems: string[]; keys?: string[] }

/** Suite de requêtes : capture dès que la page montre la publication attendue. */
async function pollLoop(deps: CaptureDeps, s: Scheduled, plan: [number, string][], started: number, ctx: RecordCtx,
  baselineFirst: boolean): Promise<PollLoop> {
  const ua = userAgent(deps)!;
  const rel = s.release;
  const out: PollLoop = { phase: 'rafale', polls: 0, reason: null, problems: [] };
  let baseline: [string | null, string | null] | null = null;
  let fallback = false;
  for (const [at, label] of plan) {
    if (deps.now() - started > WALL_MS) break;
    const now = deps.now();
    if (now > at + LATE_SLACK_MS) continue;     // en retard : sautée, jamais rattrapée
    if (at > now) await deps.sleep(at - now);
    const url = fallback ? rel.fallback : rel.url;
    const got = await get(deps, url, ua);
    out.polls++;
    if (got.status === 403 || got.status === 429) {
      await logPoll(deps.rest, s, label, url, got, null, null);
      return { ...out, phase: 'bloqué', reason: `HTTP ${got.status} du BLS : capture arrêtée, aucun contournement` };
    }
    const parsed = got.status === 200 ? parsePage(rel.key, got.body) : null;
    let verdict: string | null = null;
    if (parsed) {
      if (parsed.page === 'vide' || parsed.page === 'octets nuls') {
        fallback = !fallback;
        out.problems.push(`${label} : page ${parsed.page}, page complète ensuite`);
      } else {
        fallback = false;
        verdict = classify(parsed, s.local_date, baseline);
        if (verdict === null && baseline === null && baselineFirst && parsed.page === 'ok') baseline = [parsed.period, parsed.embargo_date];
      }
    }
    const same = parsed && baseline && parsed.period === baseline[0] && parsed.embargo_date === baseline[1];
    await logPoll(deps.rest, s, label, url, got, parsed, verdict ?? (same ? 'référence' : null));
    if (verdict !== null && parsed) {
      const keys = await record(deps, s, parsed, got, verdict, url, 'officielle', ctx);
      return { ...out, phase: 'capté', keys };
    }
    if (parsed?.page === 'ok') ctx.lastWithout = got.send_ms;
  }
  return { ...out, phase: 'non capté' };
}

export async function runBurst(deps: CaptureDeps, s: Scheduled): Promise<Record<string, unknown>> {
  const started = deps.now();
  if (!(await lock(deps.rest, `lock:burst:${s.release.key}:${s.utc_ms}`, started))) {
    return { step: 'rafale', release: s.release.key, skipped: 'rafale déjà lancée par un autre appel' };
  }
  const ctx: RecordCtx = { lastWithout: null, offset: await okxOffset(deps) };
  await publishState(deps.rest, s, 'rafale', deps.now());
  const r = await pollLoop(deps, s, burstPlan(s.utc_ms), started, ctx, true);
  const reason = r.reason ?? (r.phase === 'non capté' ? 'rien de nouveau jusqu’à T+60 s : une requête toutes les 10 s jusqu’à T+5 min' : null);
  await publishState(deps.rest, s, r.phase, deps.now(), { polls: r.polls, reason, problems: r.problems.slice(-5), okx_offset_ms: ctx.offset });
  return { step: 'rafale', release: s.release.key, phase: r.phase, polls: r.polls, keys: r.keys ?? [] };
}

export async function runTail(deps: CaptureDeps, s: Scheduled): Promise<Record<string, unknown>> {
  const now = deps.now();
  const minute = Math.floor((now - s.utc_ms) / MIN);
  if (!(await lock(deps.rest, `lock:tail:${s.release.key}:${s.utc_ms}:${minute}`, now))) {
    return { step: 'suite', release: s.release.key, skipped: 'déjà en cours' };
  }
  const plan: [number, string][] = [];
  for (let at = s.utc_ms + Math.ceil((now - s.utc_ms) / 10_000) * 10_000; at <= s.utc_ms + 5 * MIN && at < now + 55_000; at += 10_000) plan.push([at, 'fin']);
  const ctx: RecordCtx = { lastWithout: null, offset: await okxOffset(deps) };
  const r = await pollLoop(deps, s, plan, now, ctx, false);
  const last = deps.now() > s.utc_ms + 5 * MIN;
  if (r.phase !== 'non capté' || last) {
    await publishState(deps.rest, s, r.phase, deps.now(), { polls: r.polls, reason: r.reason ?? (r.phase === 'non capté' ? 'aucune nouvelle publication jusqu’à T+5 min : rattrapage à partir de T+10 min' : null) });
  }
  return { step: 'suite', release: s.release.key, phase: r.phase, polls: r.polls };
}

// --- rattrapage (T-040) ------------------------------------------------------------------------

async function expectedPeriod(rest: Rest, rel: Release): Promise<[string | null, string, string | null]> {
  const rows = await rest.select<{ period: string; edition: string }>('releases', {
    select: 'period,edition', release: `eq.${rel.key}`, order: 'scheduled_ms.desc', limit: '1' });
  if (!rows.length) return [null, '', 'période attendue inconnue : aucune publication enregistrée avant'];
  const { period, edition } = rows[0];
  if (rel.quarterly) {
    if (edition === 'Preliminary') return [null, '', "communiqué révisé : l'API ne dit pas si la valeur publiée est déjà la révisée"];
    return [shift(period, 1), 'Preliminary', null];
  }
  return [shift(period, 1), '', null];
}

export async function runCatchUp(deps: CaptureDeps, s: Scheduled): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const rel = s.release;
  const now = deps.now();
  const last = await rest.select<{ send_ms: number; status: number | null }>('release_polls', {
    select: 'send_ms,status', release: `eq.${rel.key}`, scheduled_ms: `eq.${s.utc_ms}`, label: 'in.(rattrapage,rattrapage API)',
    order: 'send_ms.desc', limit: '1' });
  const blocked = last[0]?.status === 403 || last[0]?.status === 429;
  const wait = blocked || now - s.utc_ms >= DAY ? 6 * 3_600_000 : 30 * MIN;
  if (last[0] && now - last[0].send_ms < wait) return { step: 'rattrapage', release: rel.key, skipped: 'prochain essai plus tard' };
  const ua = userAgent(deps)!;
  const urls = [rel.url, rel.fallback, archiveUrl(rel, s.local_date)];
  let unreadable = true;
  let note: string | null = null;
  for (let i = 0; i < urls.length; i++) {
    if (i) await deps.sleep(1000);              // jamais plus d'une requête par seconde au BLS
    const url = urls[i];
    const got = await get(deps, url, ua);
    if (got.status === 403 || got.status === 429) {
      await logPoll(rest, s, 'rattrapage', url, got, null, null);
      return { step: 'rattrapage', release: rel.key, phase: 'bloqué', note: `HTTP ${got.status} du BLS : rattrapage suspendu 6 h` };
    }
    const parsed = got.status === 200 ? parsePage(rel.key, got.body) : null;
    const verdict = parsed ? classify(parsed, s.local_date, null) : null;
    await logPoll(rest, s, 'rattrapage', url, got, parsed, verdict);
    if (verdict === 'attendue' && parsed) {
      const keys = await record(deps, s, parsed, got, verdict, url, 'rattrapage', { lastWithout: null, offset: null });
      return { step: 'rattrapage', release: rel.key, phase: 'rattrapé', keys };
    }
    if (parsed?.page === 'ok' && parsed.embargo_date) {
      unreadable = false;
      if (parsed.embargo_date < s.local_date) return { step: 'rattrapage', release: rel.key, note: `communiqué du ${s.local_date} pas encore en ligne` };
      if (i === 2) break;
      i = 1;                                       // page plus récente : la copie archivée à la date
      continue;
    }
  }
  if (unreadable && now - s.utc_ms >= API_FALLBACK_AFTER_MS) return catchUpApi(deps, s);
  note = unreadable ? `communiqué du ${s.local_date} illisible : API v1 à partir de T+1 h` : `copie archivée du ${s.local_date} introuvable`;
  return { step: 'rattrapage', release: rel.key, note };
}

async function catchUpApi(deps: CaptureDeps, s: Scheduled): Promise<Record<string, unknown>> {
  const rel = s.release;
  const [period, edition, why] = await expectedPeriod(deps.rest, rel);
  if (period === null) return { step: 'rattrapage', release: rel.key, note: `page illisible ; API v1 écartée : ${why}` };
  const series = [...new Set(rel.indicators.filter((i) => DERIVATIONS[i]).map((i) => DERIVATIONS[i][0]))].sort();
  const call = await apiCall(deps, series, 'rattrapage API', s.utc_ms, Number(period.slice(0, 4)) - 1);
  if (!call) return { step: 'rattrapage', release: rel.key, note: 'page illisible ; API v1 indisponible ou quota atteint' };
  const latest = new Set(series.map((sid) => call.data.latest[sid]));
  if (latest.size !== 1 || !latest.has(period)) {
    return { step: 'rattrapage', release: rel.key, note: `page illisible ; API v1 pas à jour (attendue ${period})` };
  }
  const figures: Record<string, Figure> = {};
  for (const ind of rel.indicators) {
    const d = derive(ind, period, call.data);
    figures[ind] = { indicator: ind, value: d?.value ?? null, reason: d ? null : "aucune série de l'API v1 retenue pour cet indicateur",
      part: d ? 'API v1 (recalculé)' : null, excerpt: d?.excerpt ?? null, flags: d ? ['recalculé'] : [] };
  }
  const parsed: Parsed = { release: rel.key, page: 'ok', title: null, period, edition: edition || null, embargo_text: null,
    embargo_ms: null, embargo_date: null, figures, problems: [] };
  const keys = await record(deps, s, parsed, call.got, 'inconnue', API_V1, 'rattrapage API', { lastWithout: null, offset: null });
  return { step: 'rattrapage', release: rel.key, phase: 'rattrapé (API)', keys };
}

// --- API v1 : quota, révisions, chiffres à compléter ---------------------------------------------

async function apiCall(deps: CaptureDeps, series: string[], label: string, scheduledMs: number, startYear: number):
  Promise<{ data: ApiData; got: Got; pollId: number } | null> {
  const { rest } = deps;
  const now = deps.now();
  const ua = userAgent(deps);
  if (!ua || !series.length) return null;
  const blocked = await getState<{ until: number }>(rest, 'release:api-blocked');
  if (blocked && now < blocked.until) return null;
  const used = await rest.select('release_polls', { select: 'id', url: `eq.${API_V1}`, send_ms: `gte.${utcDayStart(now)}`, limit: '100' });
  if (used.length >= DAILY_MAX) return null;
  const body = requestBody(series, startYear, Number(civilDate(now, NEW_YORK).slice(0, 4)));
  const got = await get(deps, API_V1, { ...ua, 'Content-Type': 'application/json' }, { method: 'POST', body: JSON.stringify(body) });
  let data: ApiData | null = null;
  let verdict: string | null = null;
  let error = got.error;
  if (got.status === 429) {
    await putState(rest, [['release:api-blocked', { until: utcDayStart(now) + DAY }]], now);
    error = "HTTP 429 : quota de l'API v1 épuisé, reprise demain (UTC)";
  } else if (got.status === 200) {
    try {
      data = parseResponse(new TextDecoder().decode(got.body));
      verdict = `périodes : ${Object.entries(data.latest).sort().map(([sid, p]) => `${sid} ${p}`).join(', ')}`;
    } catch (e) {
      error = `API v1 : ${(e as Error).message}`.slice(0, 200);
    }
  } else if (got.status !== null) {
    error = `API v1 : HTTP ${got.status}`;
  }
  const [row] = await rest.insert<{ id: number }>('release_polls', [{
    release: 'api-v1', scheduled_ms: scheduledMs, label, url: API_V1, send_ms: got.send_ms, first_byte_ms: got.first_byte_ms,
    done_ms: got.done_ms, status: got.status, size: got.body.length, null_bytes: 0, verdict, error: data ? null : error,
  }], 'id');
  return data ? { data, got, pollId: row.id } : null;
}

async function republish(deps: CaptureDeps, triples: [string, string, string][]): Promise<void> {
  const { rest } = deps;
  const entries: [string, unknown][] = [];
  for (const [ind, period, edition] of triples) {
    const rows = await rest.select<Row>('releases', { select: '*', indicator_id: `eq.${ind}`, period: `eq.${period}`, edition: `eq.${edition}`, limit: '1' });
    if (!rows.length) continue;
    const revs = await rest.select<Row>('release_revisions', {
      select: 'kind,previous,value,source,series,excerpt,seen_ms', indicator_id: `eq.${ind}`, period: `eq.${period}`, order: 'seen_ms.asc', limit: '100' });
    const r = rows[0];
    entries.push([releaseKey(ind, period, edition || null), payload(r, ((r.z_n as number) ?? 0) < Z_FIRM_N, null, revs)]);
  }
  await putState(rest, entries, deps.now());
}

export async function checkRevisions(deps: CaptureDeps, label: string, scheduledMs: number): Promise<number> {
  const { rest } = deps;
  const every = (await rest.select<Row & { id: number }>('releases', {
    select: 'id,indicator_id,period,edition,value,regular,scheduled_ms,forecast', order: 'scheduled_ms.asc', limit: '5000' }))
    .filter((r) => DERIVATIONS[String(r.indicator_id)]);
  const rows = every.filter((r) => r.value !== null);
  const empty = every.filter((r) => r.value === null && r.regular);
  if (!rows.length && !empty.length) return 0;
  const latest = new Map<string, Row & { id: number }>();
  const known = new Map<string, string[]>();
  for (const r of rows) {
    const k = `${r.indicator_id}|${r.period}`;
    latest.set(k, r);
    known.set(k, [...(known.get(k) ?? []), String(r.value)]);
  }
  for (const r of await rest.select<Row>('release_revisions', { select: 'indicator_id,period,value', order: 'seen_ms.asc', limit: '5000' })) {
    const k = `${r.indicator_id}|${r.period}`;
    known.set(k, [...(known.get(k) ?? []), String(r.value)]);
  }
  const wanted = [...latest.values(), ...empty];
  const series = [...new Set(wanted.map((r) => DERIVATIONS[String(r.indicator_id)][0]))].sort();
  const start = Math.min(...wanted.map((r) => Number(String(r.period).slice(0, 4)))) - 1;
  const call = await apiCall(deps, series, label, scheduledMs, start);
  if (!call) return 0;
  const now = deps.now();
  const changed: [string, string, string][] = [];
  let filled = 0;
  for (const r of empty) {
    const d = derive(String(r.indicator_id), String(r.period), call.data);
    if (!d) continue;
    await fill(deps, r, d, now);
    changed.push([String(r.indicator_id), String(r.period), String(r.edition)]);
    filled++;
  }
  for (const [k, r] of latest) {
    const d = derive(String(r.indicator_id), String(r.period), call.data);
    const values = known.get(k)!;
    if (!d || sameValue(d.value, values[values.length - 1])) continue;
    const recent = now - (r.scheduled_ms as number) < REVISION_GRACE_MS;
    if (recent && values.slice(0, -1).some((v) => sameValue(d.value, v))) continue;   // API en retard
    await rest.insert('release_revisions', [{
      indicator_id: r.indicator_id, period: r.period, edition: r.edition, kind: recent ? 'écart' : 'révision',
      previous: values[values.length - 1], value: d.value, source: 'BLS API v1', series: d.series, excerpt: d.excerpt,
      seen_ms: now, poll_id: call.pollId,
    }]);
    changed.push([String(r.indicator_id), String(r.period), String(r.edition)]);
  }
  if (changed.length) await republish(deps, changed);
  return changed.length;
}

async function fill(deps: CaptureDeps, row: Row & { id: number }, d: Derived, now: number): Promise<void> {
  const { rest } = deps;
  const full = (await rest.select<Row>('releases', { select: '*', id: `eq.${row.id}`, limit: '1' }))[0];
  if (!full || full.value !== null) return;
  const surprise = rawSurprise(d.value, (row.forecast as string | null) ?? null);
  const z = zScore(surprise, await history(rest, String(row.indicator_id), row.scheduled_ms as number), d.value);
  await rest.upsert('releases', [{ ...full, value: d.value, reason: null, part: 'API v1 (recalculé)', excerpt: d.excerpt,
    flags: JSON.stringify(['recalculé', "complété par l'API v1"]), surprise, z: z.z, z_n: z.n, z_reason: z.reason, filled_ms: now }], 'id');
}

async function apiChecks(deps: CaptureDeps, list: Scheduled[], now: number): Promise<string | null> {
  const due: [number, string][] = [];
  for (const s of list.filter((x) => x.utc_ms <= now && now - x.utc_ms <= 5 * 3_600_000)) {
    for (const [after, label] of API_CHECKS) if (now >= s.utc_ms + after) due.push([s.utc_ms + after, label]);
  }
  const today = civilDate(now, NEW_YORK);
  const [y, m, d] = today.split('-').map(Number);
  const noon = zonedToUtc(y, m, d, 12, 0, NEW_YORK);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (weekday >= 1 && weekday <= 5 && now >= noon) due.push([noon, 'révisions quotidiennes']);
  for (const [dueMs, label] of due.sort((a, b) => a[0] - b[0])) {
    const done = await deps.rest.select('release_polls', { select: 'id', release: 'eq.api-v1', label: 'like.révisions*', send_ms: `gte.${dueMs}`, limit: '1' });
    if (!done.length) {
      const n = await checkRevisions(deps, label, dueMs);
      return `${label} : ${n} révision(s), écart(s) ou complément(s)`;
    }
  }
  return null;
}

// --- réaction du BTC -------------------------------------------------------------------------------

export async function runReaction(deps: CaptureDeps, s: Scheduled): Promise<Record<string, unknown> | null> {
  const { rest } = deps;
  const exists = await rest.select('release_reactions', { select: 'id', release: `eq.${s.release.key}`, ny_date: `eq.${s.local_date}`, limit: '1' });
  if (exists.length) return null;
  const now = deps.now();
  const rows = await rest.select<{ t: string; o: number; h: number; l: number; c: number }>('okx_candles_1m', {
    select: 't,o,h,l,c', inst: `eq.${INST}`, t: `gte.${new Date(s.utc_ms - BEFORE_MS).toISOString()}`, order: 't.asc', limit: '40' });
  const r = btcReaction(rows.map((x) => ({ t: Date.parse(x.t), o: x.o, h: x.h, l: x.l, c: x.c })), s.utc_ms);
  if (r.reason && now < s.utc_ms + FINAL_AFTER_MS) return { step: 'réaction', release: s.release.key, note: 'bougie pas encore relevée' };
  const row: Row = { release: s.release.key, ny_date: s.local_date, scheduled_ms: s.utc_ms, inst: r.inst,
    source: 'OKX EEA · okx_candles_1m', candles: JSON.stringify(r.candles), ref_price: r.ref_price, end_price: r.end_price,
    change_pct: r.change_pct, missing: JSON.stringify(r.missing), reason: r.reason, received_ms: now };
  await rest.insertIgnore('release_reactions', [row], 'release,ny_date', 'id');
  await putState(rest, [[`reaction:${s.release.key}:${s.local_date}`, {
    release: s.release.key, title: s.release.title, indicators: s.release.indicators, ny_date: s.local_date,
    scheduled_ms: s.utc_ms, inst: r.inst, source: row.source, candles: r.candles, ref_price: r.ref_price,
    end_price: r.end_price, change_pct: r.change_pct, missing: r.missing, reason: r.reason, received_ms: now }]], now);
  return { step: 'réaction', release: s.release.key, change_pct: r.change_pct, reason: r.reason };
}

// --- tâche ------------------------------------------------------------------------------------------

export async function runCapture(deps: CaptureDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  if (!userAgent(deps)) {
    await publishState(rest, null, 'arrêté', now, { reason: 'BLS_CONTACT_EMAIL absente des secrets : capture à la source arrêtée (T-023)' });
    return { job: 'capture', ok: false, error: 'BLS_CONTACT_EMAIL absente des secrets' };
  }
  const list = await scheduled(rest, now - CATCHUP_WINDOW_MS, now + 2 * MIN);
  // 1. Rafale : la publication tombe dans les 90 s. Elle occupe tout l'appel.
  const burst = list.find((s) => s.utc_ms - BURST_LEAD_MS < now && now <= s.utc_ms);
  if (burst && !(await captured(rest, burst))) return { job: 'capture', ok: true, ...(await runBurst(deps, burst)) };
  const steps: unknown[] = [];
  // 2. Suite : de T+60 s à T+5 min, si rien n'est capté.
  for (const s of list.filter((x) => x.utc_ms + 60_000 < now && now <= x.utc_ms + TAIL_END_MS)) {
    if (!(await captured(rest, s))) steps.push(await runTail(deps, s));
  }
  // 3. Réaction du BTC, à T+31 min.
  for (const s of list.filter((x) => now >= x.utc_ms + DUE_AFTER_MS)) {
    const r = await runReaction(deps, s);
    if (r) steps.push(r);
  }
  // 4. Rattrapage, à partir de T+10 min (deux publications au plus par appel).
  let n = 0;
  for (const s of list.filter((x) => now >= x.utc_ms + CATCHUP_FROM_MS)) {
    if (n >= CATCHUP_PER_RUN) break;
    if (await captured(rest, s)) continue;
    steps.push(await runCatchUp(deps, s));
    n++;
  }
  // 5. API v1 : révisions et chiffres à compléter.
  const api = await apiChecks(deps, list, deps.now());
  if (api) steps.push({ step: 'api', note: api });
  // État d'attente : prochaine publication suivie.
  const next = (await scheduled(rest, now, now + 40 * DAY))[0] ?? null;
  const current = await getState<{ phase: string; scheduled_ms: number }>(rest, 'release:state');
  if (!current || current.phase === 'attente' || current.phase === 'arrêté' || (current.scheduled_ms ?? 0) + 30 * MIN < now) {
    await publishState(rest, next, next ? 'attente' : null, deps.now(),
      next ? {} : { reason: 'aucune publication suivie annoncée par le calendrier du BLS' });
  }
  return { job: 'capture', ok: true, steps };
}

export { RELEASES };
