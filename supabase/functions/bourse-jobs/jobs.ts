// Tâches planifiées du module Bourse (étape B0, docs/plan-b0.md § 7). Logique
// pure : fetch, horloge, attente et base sont injectés, d'où les tests Vitest.
//
//   ecb-fx    cours de référence de la BCE des 10 derniers jours (upsert)
//   us-close  clôtures de la veille de tous les titres US en un appel (Massive),
//             seules les cotations suivies sont gardées
//   eu-close  une requête Alpha Vantage par cotation suivie, dans le budget du
//             jour (25 requêtes sur la clé gratuite) ; reprise au passage suivant
//   ref-sec   liste des sociétés et mnémoniques de la SEC (une fois par semaine)
//   explore   une réponse de chaque source, renvoyée telle quelle (tronquée,
//             clés masquées) : exploration B0.1, à lancer à la main
//
// Chaque passage est journalisé dans bourse_runs. Une clôture absente n'est
// jamais recopiée : la cotation garde sa dernière clôture connue, avec sa date.

import type { Db, FetchLike, Row } from '../okx-collector/postgrest.ts';
import {
  parseAlphaDaily, parseEcbCsv, parseMassiveGrouped, parseSecTickers,
} from './parse.ts';

export const JOBS = ['ecb-fx', 'us-close', 'eu-close', 'ref-sec', 'explore'] as const;
export type Job = (typeof JOBS)[number];

export const ECB_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D..EUR.SP00.A';
export const MASSIVE_BASE = 'https://api.massive.com';
export const ALPHA_URL = 'https://www.alphavantage.co/query';
export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const TIINGO_BASE = 'https://api.tiingo.com';
export const OPENFIGI_URL = 'https://api.openfigi.com/v3/mapping';

/** Budget quotidien Alpha Vantage par défaut : 20 sur 25, la réserve sert aux essais à la main. */
export const ALPHA_DEFAULT_MAX = 20;
/** Cotations Alpha Vantage traitées au plus par passage (durée bornée d'une Edge Function). */
export const ALPHA_PER_RUN = 8;
/** Écart entre deux appels Alpha Vantage. */
export const ALPHA_SPACING_MS = 2_000;
const ECB_DAYS = 10;
const SEC_BATCH = 1_000;
const EXPLORE_CHARS = 1_500;
const ERROR_MAX_CHARS = 2_000;

export interface Rpc { (fn: string, args: Record<string, unknown>): Promise<unknown> }

export interface JobDeps {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  db: Db;
  rpc: Rpc;
  env: (name: string) => string | undefined;
}

export interface JobResult {
  ok: boolean;
  job: Job;
  started_at: string;
  finished_at: string;
  rows: number;
  requests: number;
  note: string | null;
  errors: string[];
  report?: unknown;          // tâche explore seulement
}

// --- dates ---------------------------------------------------------------------------

/** Date civile (AAAA-MM-JJ) d'un instant dans un fuseau IANA. */
export function civilDate(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Jour ouvré précédant la date civile donnée (samedi et dimanche sautés ; fériés non connus). */
export function previousWeekday(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- outils --------------------------------------------------------------------------

/** Retire d'un texte toute valeur de clé lue dans l'environnement. */
export function redactWith(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('***');
  return out;
}

async function getText(deps: JobDeps, url: string, headers: Record<string, string> = {}, timeoutMs = 20_000)
  : Promise<{ status: number; text: string }> {
  const r = await deps.fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) });
  return { status: r.status, text: await r.text() };
}

function jsonOf(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${source} : réponse non JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
  }
}

function secUserAgent(env: JobDeps['env']): string {
  const email = (env('SEC_CONTACT_EMAIL') ?? '').trim();
  if (!/^[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+$/.test(email)) {
    throw new Error('SEC_CONTACT_EMAIL absente ou invalide : la SEC refuse les requêtes sans adresse de contact');
  }
  return `terminal-trading/0.1 (${email})`;
}

interface TrackedListing { id: number; source_symbol: string; currency: string }

async function trackedListings(db: Db, source: string): Promise<TrackedListing[]> {
  return db.select<TrackedListing>('instrument_listings', {
    select: 'id,source_symbol,currency', tracked: 'is.true', price_source: `eq.${source}`, order: 'id.asc',
  });
}

// --- tâches --------------------------------------------------------------------------

interface Outcome { rows: number; requests: number; note: string | null; errors: string[]; report?: unknown }

async function ecbFx(deps: JobDeps): Promise<Outcome> {
  const start = addDays(civilDate(deps.now(), 'Europe/Berlin'), -ECB_DAYS);
  const { status, text } = await getText(deps, `${ECB_URL}?${new URLSearchParams({ startPeriod: start, format: 'csvdata' })}`,
    { Accept: 'text/csv' });
  if (status !== 200) throw new Error(`BCE : HTTP ${status}`);
  const { rates } = parseEcbCsv(text);
  if (!rates.length) return { rows: 0, requests: 1, note: 'aucun cours publié sur la période', errors: [] };
  const receivedAt = new Date(deps.now()).toISOString();
  await deps.db.upsert('fx_rates', rates.map((r) => ({ ...r, source: 'BCE', received_at: receivedAt })), 'value_date,currency');
  const last = rates.reduce((m, r) => (r.value_date > m ? r.value_date : m), '');
  return { rows: rates.length, requests: 1, note: `dernier fixing ${last}`, errors: [] };
}

async function usClose(deps: JobDeps): Promise<Outcome> {
  const key = deps.env('MASSIVE_API_KEY');
  if (!key) throw new Error('MASSIVE_API_KEY absente');
  const listings = await trackedListings(deps.db, 'massive');
  if (!listings.length) return { rows: 0, requests: 0, note: 'aucune cotation US suivie', errors: [] };
  const date = previousWeekday(civilDate(deps.now(), 'America/New_York'));
  const url = `${MASSIVE_BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=false`;
  const { status, text } = await getText(deps, url, { Authorization: `Bearer ${key}` });
  if (status === 429) return { rows: 0, requests: 1, note: 'limite de débit Massive atteinte', errors: ['Massive : HTTP 429'] };
  if (status !== 200) throw new Error(`Massive : HTTP ${status} ${redactWith(text.slice(0, 120), [key])}`);
  const { closes, count } = parseMassiveGrouped(jsonOf(text, 'Massive'));
  if (count === 0) return { rows: 0, requests: 1, note: `aucune séance le ${date} (férié ?)`, errors: [] };
  const receivedAt = new Date(deps.now()).toISOString();
  const rows: Row[] = [];
  const missing: string[] = [];
  for (const l of listings) {
    const c = closes.get(l.source_symbol);
    if (!c) { missing.push(l.source_symbol); continue; }
    rows.push({ listing_id: l.id, value_date: date, close: c.close, adj_close: null, currency: l.currency,
      source: 'Massive', source_ts: c.source_ts, received_at: receivedAt });
  }
  await deps.db.upsert('prices', rows, 'listing_id,value_date,source');
  return {
    rows: rows.length, requests: 1,
    note: missing.length ? `sans clôture le ${date} : ${missing.join(', ')}` : `clôtures du ${date}`,
    errors: [],
  };
}

async function euClose(deps: JobDeps): Promise<Outcome> {
  const key = deps.env('ALPHA_VANTAGE_API_KEY');
  if (!key) throw new Error('ALPHA_VANTAGE_API_KEY absente');
  const max = Number(deps.env('ALPHA_VANTAGE_DAILY_MAX') ?? ALPHA_DEFAULT_MAX);
  if (!Number.isInteger(max) || max <= 0 || max > 25) throw new Error('ALPHA_VANTAGE_DAILY_MAX : entier de 1 à 25 attendu');
  const listings = await trackedListings(deps.db, 'alphavantage');
  if (!listings.length) return { rows: 0, requests: 0, note: 'aucune cotation européenne suivie', errors: [] };

  // Cotations déjà relevées aujourd'hui : sautées (le passage suivant reprend les autres).
  const today = new Date(deps.now()).toISOString().slice(0, 10);
  const done = await deps.db.select<{ listing_id: number }>('prices', {
    select: 'listing_id', source: 'eq.Alpha Vantage', received_at: `gte.${today}T00:00:00Z`,
  });
  const doneIds = new Set(done.map((d) => d.listing_id));
  const todo = listings.filter((l) => !doneIds.has(l.id)).slice(0, ALPHA_PER_RUN);
  if (!todo.length) return { rows: 0, requests: 0, note: 'toutes les cotations sont à jour', errors: [] };

  let rows = 0;
  let requests = 0;
  const errors: string[] = [];
  const notes: string[] = [];
  for (const l of todo) {
    const granted = await deps.rpc('bourse_reserve_quota', { p_source: 'alphavantage', p_day: today, p_max: max });
    if (granted !== true) { notes.push('quota atteint'); break; }
    if (requests > 0) await deps.sleep(ALPHA_SPACING_MS);
    requests++;
    const url = `${ALPHA_URL}?${new URLSearchParams({ function: 'TIME_SERIES_DAILY', symbol: l.source_symbol, outputsize: 'compact', apikey: key })}`;
    let parsed;
    try {
      const { status, text } = await getText(deps, url);
      if (status !== 200) { errors.push(`${l.source_symbol} : HTTP ${status}`); continue; }
      parsed = parseAlphaDaily(jsonOf(text, 'Alpha Vantage'));
    } catch (e) {
      errors.push(`${l.source_symbol} : ${redactWith(e instanceof Error ? e.message : String(e), [key])}`);
      continue;
    }
    if (parsed.kind === 'quota') { notes.push(`quota atteint (${parsed.message.slice(0, 80)})`); break; }
    if (parsed.kind === 'error') { errors.push(`${l.source_symbol} : ${parsed.message}`); continue; }
    const receivedAt = new Date(deps.now()).toISOString();
    const batch = parsed.rows.map((r) => ({ listing_id: l.id, value_date: r.value_date, close: r.close, adj_close: null,
      currency: l.currency, source: 'Alpha Vantage', source_ts: null, received_at: receivedAt }));
    await deps.db.upsert('prices', batch, 'listing_id,value_date,source');
    rows += batch.length;
  }
  const left = listings.length - doneIds.size - requests;
  if (left > 0 && !notes.length) notes.push(`${left} cotation(s) au passage suivant`);
  return { rows, requests, note: notes.join(' ; ') || null, errors };
}

async function refSec(deps: JobDeps): Promise<Outcome> {
  const { status, text } = await getText(deps, SEC_TICKERS_URL, { 'User-Agent': secUserAgent(deps.env), Accept: 'application/json' }, 30_000);
  if (status !== 200) throw new Error(`SEC : HTTP ${status}${status === 403 ? ' (adresse de contact refusée ou débit dépassé)' : ''}`);
  const { companies, skipped } = parseSecTickers(jsonOf(text, 'SEC'));
  const updatedAt = new Date(deps.now()).toISOString();
  for (let i = 0; i < companies.length; i += SEC_BATCH) {
    await deps.db.upsert('sec_companies', companies.slice(i, i + SEC_BATCH).map((c) => ({ ...c, updated_at: updatedAt })), 'cik,ticker');
  }
  return { rows: companies.length, requests: 1, note: skipped ? `${skipped} ligne(s) écartée(s)` : null, errors: [] };
}

/** Une réponse de chaque source, tronquée, clés masquées : exploration B0.1. */
async function explore(deps: JobDeps): Promise<Outcome> {
  const keys = ['MASSIVE_API_KEY', 'ALPHA_VANTAGE_API_KEY', 'TIINGO_API_KEY', 'OPENFIGI_API_KEY', 'SEC_CONTACT_EMAIL'].map((n) => deps.env(n));
  const [massive, alpha, tiingo, figi] = keys;
  const date = previousWeekday(civilDate(deps.now(), 'America/New_York'));
  const probes: { name: string; url: string; headers?: Record<string, string>; method?: string; body?: string; skip?: string }[] = [
    { name: 'ecb', url: `${ECB_URL}?startPeriod=${addDays(date, -3)}&format=csvdata` },
    { name: 'sec-tickers', url: SEC_TICKERS_URL, skip: keys[4] ? undefined : 'SEC_CONTACT_EMAIL absente' },
    { name: 'sec-companyfacts', url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', skip: keys[4] ? undefined : 'SEC_CONTACT_EMAIL absente' },
    { name: 'massive-grouped', url: `${MASSIVE_BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=false`,
      headers: { Authorization: `Bearer ${massive}` }, skip: massive ? undefined : 'MASSIVE_API_KEY absente' },
    { name: 'alpha-daily', url: `${ALPHA_URL}?function=TIME_SERIES_DAILY&symbol=CW8.PAR&outputsize=compact&apikey=${alpha}`,
      skip: alpha ? undefined : 'ALPHA_VANTAGE_API_KEY absente' },
    { name: 'tiingo-daily', url: `${TIINGO_BASE}/tiingo/daily/SPY/prices?startDate=${addDays(date, -7)}`,
      headers: { Authorization: `Token ${tiingo}` }, skip: tiingo ? undefined : 'TIINGO_API_KEY absente' },
    { name: 'openfigi', url: OPENFIGI_URL, method: 'POST', body: JSON.stringify([{ idType: 'ID_ISIN', idValue: 'LU1681043599' }]),
      headers: { 'Content-Type': 'application/json', ...(figi ? { 'X-OPENFIGI-APIKEY': figi } : {}) } },
  ];
  const report: unknown[] = [];
  let requests = 0;
  for (const p of probes) {
    if (p.skip) { report.push({ name: p.name, skipped: p.skip }); continue; }
    if (p.name === 'alpha-daily') {
      const granted = await deps.rpc('bourse_reserve_quota', { p_source: 'alphavantage', p_day: new Date(deps.now()).toISOString().slice(0, 10), p_max: 25 });
      if (granted !== true) { report.push({ name: p.name, skipped: 'quota du jour atteint' }); continue; }
    }
    const headers = { ...(p.headers ?? {}), ...(p.name.startsWith('sec') ? { 'User-Agent': secUserAgent(deps.env) } : {}) };
    const t0 = deps.now();
    requests++;
    try {
      const r = await deps.fetch(p.url, { method: p.method ?? 'GET', headers, body: p.body, signal: AbortSignal.timeout(20_000) });
      const text = await r.text();
      report.push({
        name: p.name, status: r.status, ms: deps.now() - t0, size: text.length,
        headers: 'headers' in r ? pickHeaders((r as unknown as { headers: Headers }).headers) : null,
        body: redactWith(text.slice(0, EXPLORE_CHARS), keys),
      });
    } catch (e) {
      report.push({ name: p.name, error: redactWith(e instanceof Error ? e.message : String(e), keys) });
    }
    await deps.sleep(1_000);
  }
  return { rows: 0, requests, note: null, errors: [], report };
}

const HEADERS_KEPT = ['date', 'last-modified', 'etag', 'cache-control', 'content-type', 'x-ratelimit-limit',
  'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'server'];

function pickHeaders(h: Headers | undefined): Record<string, string> | null {
  if (!h || typeof h.get !== 'function') return null;
  const out: Record<string, string> = {};
  for (const name of HEADERS_KEPT) { const v = h.get(name); if (v !== null) out[name] = v; }
  return out;
}

const RUNNERS: Record<Job, (deps: JobDeps) => Promise<Outcome>> = {
  'ecb-fx': ecbFx, 'us-close': usClose, 'eu-close': euClose, 'ref-sec': refSec, explore,
};

/** Lance une tâche et la journalise dans bourse_runs (sauf explore, qui n'écrit rien). */
export async function runJob(job: Job, deps: JobDeps): Promise<JobResult> {
  const started = deps.now();
  let outcome: Outcome;
  try {
    outcome = await RUNNERS[job](deps);
  } catch (e) {
    outcome = { rows: 0, requests: 0, note: null, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const secrets = ['MASSIVE_API_KEY', 'ALPHA_VANTAGE_API_KEY', 'TIINGO_API_KEY', 'OPENFIGI_API_KEY'].map((n) => deps.env(n));
  const errors = outcome.errors.map((m) => redactWith(m, secrets));
  const result: JobResult = {
    ok: errors.length === 0, job,
    started_at: new Date(started).toISOString(), finished_at: new Date(deps.now()).toISOString(),
    rows: outcome.rows, requests: outcome.requests, note: outcome.note, errors,
    ...(outcome.report !== undefined ? { report: outcome.report } : {}),
  };
  if (job !== 'explore') {
    await deps.db.insert('bourse_runs', [{
      job, started_at: result.started_at, finished_at: result.finished_at, ok: result.ok,
      error: errors.length ? errors.join(' | ').slice(0, ERROR_MAX_CHARS) : null,
      rows: result.rows, requests: result.requests, note: result.note,
    }]);
  }
  return result;
}
