// Routes /api/bourse/* (étape B0, docs/plan-b0.md § 5) : une seule fonction
// Vercel (api/bourse.ts) et ce routeur interne. Le plan Hobby limite le nombre
// de fonctions par déploiement : une fonction par route l'épuiserait.
//
// Chemin reçu : /api/bourse/<route> (développement, et Vercel si la réécriture
// garde l'adresse d'origine) ou /api/bourse?path=<route> (réécriture de
// vercel.json). Les deux formes sont acceptées ; le paramètre « path » n'est
// jamais confondu avec un paramètre de la route.
//
// Toute route exige la session, sauf GET et POST /session. Réponses jamais
// mises en cache (données personnelles).

import { clip, HttpError, json, NO_STORE, readQuery, respond, type Env } from '../http.js';
import type { Context } from '../routes.js';
import { supabaseConfig } from '../supabase.js';
import {
  addressKey, clearedCookie, clientAddress, COOKIE_NAME, MAX_PASSWORD_LENGTH, MIN_SECRET_LENGTH, parsePasswordHash,
  readCookie, sameOriginJson, SESSION_DAYS, sessionCookie, signSession, verifyPassword, verifySession,
  type PasswordHash,
} from './auth.js';
import { createBourseDb, type BourseDb } from './db.js';
import { parseRows, resolveRows, toDbRow, type RawRow, type RefListing } from './importer.js';
import { buildReport, DEFAULT_PERF_START, loadData, parisDate } from './report.js';

export const ROUTES = ['session', 'sources', 'quote', 'instruments', 'portfolio', 'transactions', 'import'] as const;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

/** Tâches planifiées : miroir de supabase/cron-bourse.sql (heures UTC). */
export const SCHEDULES = [
  { job: 'ecb-fx', label: 'Cours de référence BCE', source: 'BCE', runs: [{ minute: 30, hour: 16, days: [1, 2, 3, 4, 5] }] },
  { job: 'us-close', label: 'Clôtures US', source: 'Massive', runs: [{ minute: 15, hour: 6, days: [2, 3, 4, 5, 6] }] },
  { job: 'us-backfill', label: 'Historique US', source: 'Tiingo', runs: [{ minute: 20, hour: 6, days: [2, 3, 4, 5, 6] }] },
  { job: 'eu-close', label: 'Clôtures européennes', source: 'Alpha Vantage',
    runs: [{ minute: 30, hour: 6, days: [2, 3, 4, 5, 6] }, { minute: 45, hour: 6, days: [2, 3, 4, 5, 6] }] },
  { job: 'ref-sec', label: 'Sociétés américaines', source: 'SEC', runs: [{ minute: 0, hour: 5, days: [0] }] },
] as const;

/** Prochain passage (ISO) après `nowMs` parmi des créneaux hebdomadaires UTC. */
export function nextRun(runs: readonly { minute: number; hour: number; days: readonly number[] }[], nowMs: number): string {
  let best = Infinity;
  const day0 = Math.floor(nowMs / DAY_MS) * DAY_MS;
  for (let d = 0; d <= 7; d++) {
    const day = day0 + d * DAY_MS;
    const dow = new Date(day).getUTCDay();
    for (const r of runs) {
      if (!r.days.includes(dow)) continue;
      const t = day + r.hour * 3_600_000 + r.minute * 60_000;
      if (t > nowMs && t < best) best = t;
    }
  }
  return new Date(best).toISOString();
}

/**
 * Route demandée, et une requête GET portant seulement les paramètres de la
 * route (sans « path ») pour readQuery. Méthode, en-têtes et corps se lisent
 * sur la requête d'origine.
 */
export function routeOf(request: Request): { route: string; query: Request } {
  const url = new URL(request.url);
  let route = '';
  const m = /^\/api\/bourse\/([a-z0-9-]+)\/?$/.exec(url.pathname);
  if (m) {
    // Sur Vercel, la fonction reçoit le chemin d'origine ET le « path » ajouté
    // par la réécriture de vercel.json : on le retire pour que readQuery ne le
    // prenne pas pour un paramètre de la route.
    route = m[1];
    if (url.searchParams.get('path') === route) url.searchParams.delete('path');
  } else if (url.pathname.replace(/\/$/, '') === '/api/bourse') {
    route = url.searchParams.get('path') ?? '';
    url.searchParams.delete('path');
  }
  return { route, query: new Request(url) };
}

interface Auth { secret: string; hash: PasswordHash }

function authConfig(env: Env): Auth | string {
  const secret = env.BOURSE_SESSION_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return `BOURSE_SESSION_SECRET absente ou trop courte (${MIN_SECRET_LENGTH} caractères au moins)`;
  const hash = parsePasswordHash(env.BOURSE_PASSWORD_HASH);
  return typeof hash === 'string' ? hash : { secret, hash };
}

function database(ctx: Context): BourseDb {
  const cfg = supabaseConfig(ctx.env);
  if (!cfg.ok) throw new HttpError(503, `module Bourse non configuré : ${cfg.reason}`);
  return createBourseDb(cfg.config, ctx.deps.fetch);
}

async function sessionExp(request: Request, auth: Auth, now: number): Promise<number | null> {
  return verifySession(readCookie(request.headers.get('cookie'), COOKIE_NAME), auth.secret, now);
}

// --- session -------------------------------------------------------------------------

async function getSession(request: Request, query: Request, ctx: Context): Promise<Response> {
  readQuery(query, []);
  const auth = authConfig(ctx.env);
  if (typeof auth === 'string') return json({ authenticated: false, configured: false, reason: auth }, NO_STORE);
  const exp = await sessionExp(request, auth, ctx.deps.now());
  return json({ authenticated: exp !== null, configured: true, expires_at: exp ? new Date(exp * 1000).toISOString() : null }, NO_STORE);
}

async function login(request: Request, query: Request, ctx: Context): Promise<Response> {
  readQuery(query, []);
  const auth = authConfig(ctx.env);
  if (typeof auth === 'string') throw new HttpError(503, `module Bourse non configuré : ${auth}`);
  if (!sameOriginJson(request)) throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
  const text = await request.text();
  if (text.length > 1024) throw new HttpError(413, 'corps trop long');
  let password: unknown;
  try { password = (JSON.parse(text) as { password?: unknown }).password; } catch { throw new HttpError(400, 'corps JSON illisible'); }
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) throw new HttpError(400, 'mot de passe attendu');

  // Compteur d'essais : sans base, pas de connexion (on n'ouvre jamais sans limite).
  const db = database(ctx);
  const now = ctx.deps.now();
  const key = await addressKey(clientAddress(request), auth.secret);
  const since = new Date(now - FAILURE_WINDOW_MS).toISOString();
  const failures = await db.count('auth_failures', { key_hash: `eq.${key}`, at: `gte.${since}` });
  if (failures >= MAX_FAILURES) {
    return json({ detail: 'trop d’essais : réessayer dans 15 minutes', retry_at: new Date(now + FAILURE_WINDOW_MS).toISOString() },
      NO_STORE, 429, { 'Retry-After': String(FAILURE_WINDOW_MS / 1000) });
  }
  if (!(await verifyPassword(password, auth.hash))) {
    await db.insert('auth_failures', [{ key_hash: key }]);
    throw new HttpError(401, 'mot de passe refusé');
  }
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86_400;
  return json({ authenticated: true, expires_at: new Date(exp * 1000).toISOString() }, NO_STORE, 200,
    { 'Set-Cookie': sessionCookie(await signSession(exp, auth.secret), SESSION_DAYS * 86_400) });
}

function logout(request: Request, query: Request): Response {
  readQuery(query, []);
  if (!sameOriginJson(request) && request.headers.get('origin')) throw new HttpError(403, 'requête refusée : même origine exigée');
  return json({ authenticated: false }, NO_STORE, 200, { 'Set-Cookie': clearedCookie() });
}

// --- données -------------------------------------------------------------------------

interface RunRow { job: string; started_at: string; finished_at: string; ok: boolean; error: string | null; rows: number; requests: number; note: string | null }
interface PriceRow { value_date: string; close: string | number; source: string; received_at: string; currency: string }
interface ListingRow {
  id: number; symbol: string; currency: string; price_source: string; source_symbol: string;
  instruments: { name: string; isin: string | null; kind: string; pea_eligible: boolean | null; pea_reason: string | null } | null;
  prices: PriceRow[];
}

const LISTING_SELECT = 'id,symbol,currency,price_source,source_symbol,'
  + 'instruments(name,isin,kind,pea_eligible,pea_reason),prices(value_date,close,source,received_at,currency)';

function listingOut(l: ListingRow) {
  const last = l.prices[0];
  return {
    id: l.id, name: l.instruments?.name ?? l.symbol, isin: l.instruments?.isin ?? null, kind: l.instruments?.kind ?? null,
    symbol: l.symbol, currency: l.currency, price_source: l.price_source, source_symbol: l.source_symbol,
    pea_eligible: l.instruments?.pea_eligible ?? null, pea_reason: l.instruments?.pea_reason ?? null,
    // Clôture en texte décimal : le front la formate sans passer par un calcul.
    last: last ? { value_date: last.value_date, close: String(last.close), currency: last.currency, source: last.source, received_at: last.received_at } : null,
  };
}

async function sources(query: Request, ctx: Context): Promise<Response> {
  readQuery(query, []);
  const db = database(ctx);
  const now = ctx.deps.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const [runs, quota, fx, listings] = await Promise.all([
    db.select<RunRow>('bourse_runs', { select: 'job,started_at,finished_at,ok,error,rows,requests,note', order: 'started_at.desc', limit: '60' }),
    db.select<{ used: number; max: number }>('api_quota', { select: 'used,max', source: 'eq.alphavantage', day: `eq.${today}` }),
    db.select<{ value_date: string; per_eur: string | number; received_at: string; source: string }>('fx_rates', {
      select: 'value_date,per_eur,received_at,source', currency: 'eq.USD', order: 'value_date.desc', limit: '1' }),
    db.select<ListingRow>('instrument_listings', {
      select: LISTING_SELECT, tracked: 'is.true', order: 'id.asc', 'prices.order': 'value_date.desc', 'prices.limit': '1' }),
  ]);
  return json({
    generated_at: new Date(now).toISOString(),
    jobs: SCHEDULES.map((s) => ({
      job: s.job, label: s.label, source: s.source, next_run: nextRun(s.runs, now),
      last_run: runs.find((r) => r.job === s.job) ?? null,
    })),
    quota: { source: 'Alpha Vantage', day: today, used: quota[0]?.used ?? 0, max: quota[0]?.max ?? null },
    fx: fx[0] ? { pair: 'EUR/USD', per_eur: String(fx[0].per_eur), value_date: fx[0].value_date, received_at: fx[0].received_at, source: fx[0].source } : null,
    listings: listings.map(listingOut),
  }, NO_STORE);
}

async function quote(query: Request, ctx: Context): Promise<Response> {
  const q = readQuery(query, ['listing']);
  const id = q.get('listing');
  if (!id || !/^\d{1,12}$/.test(id)) throw new HttpError(400, 'paramètre listing : identifiant numérique attendu');
  const rows = await database(ctx).select<ListingRow>('instrument_listings', {
    select: LISTING_SELECT, id: `eq.${id}`, 'prices.order': 'value_date.desc', 'prices.limit': '1' });
  if (!rows.length) throw new HttpError(404, `cotation inconnue : ${clip(id)}`);
  return json(listingOut(rows[0]), NO_STORE);
}

const SEARCH = /^[\p{L}\p{N} .&'-]{1,40}$/u;

async function instruments(query: Request, ctx: Context): Promise<Response> {
  const q = (readQuery(query, ['q']).get('q') ?? '').trim();
  if (!SEARCH.test(q)) throw new HttpError(400, 'paramètre q : 1 à 40 lettres, chiffres, espaces ou . & \' -');
  const db = database(ctx);
  const like = `"*${q}*"`;
  const upper = q.toUpperCase();
  const [tracked, sec] = await Promise.all([
    db.select<Record<string, unknown>>('instruments', {
      select: 'id,name,isin,kind,pea_eligible', or: `(name.ilike.${like},isin.eq."${upper}")`, limit: '10' }),
    db.select<{ cik: number; ticker: string; name: string; exchange: string | null }>('sec_companies', {
      select: 'cik,ticker,name,exchange', or: `(ticker.eq."${upper}",name.ilike.${like})`, order: 'ticker.asc', limit: '10' }),
  ]);
  return json({ query: q, instruments: tracked, sec: sec.map((s) => ({ ...s, source: 'SEC' })) }, NO_STORE);
}

// --- routeur -------------------------------------------------------------------------

export function handleBourse(request: Request, ctx: Context): Promise<Response> {
  const { route, query } = routeOf(request);
  return respond(ctx.env, `/api/bourse/${route}`, async () => {
    if (!(ROUTES as readonly string[]).includes(route)) throw new HttpError(404, `route inconnue : ${clip(route)}`);
    const method = request.method;
    if (route === 'session') {
      if (method === 'GET') return getSession(request, query, ctx);
      if (method === 'POST') return login(request, query, ctx);
      if (method === 'DELETE') return logout(request, query);
      throw new HttpError(405, 'méthode non autorisée (GET, POST ou DELETE)');
    }
    const writes = route === 'import' ? ['POST', 'DELETE'] : [];
    if (method !== 'GET' && !writes.includes(method)) {
      throw new HttpError(405, `méthode non autorisée (${['GET', ...writes].join(', ')} attendu)`);
    }
    if (route === 'import' && method === 'GET') throw new HttpError(405, 'méthode non autorisée (POST ou DELETE attendu)');
    const auth = authConfig(ctx.env);
    if (typeof auth === 'string') throw new HttpError(503, `module Bourse non configuré : ${auth}`);
    if ((await sessionExp(request, auth, ctx.deps.now())) === null) throw new HttpError(401, 'session requise');
    if (method !== 'GET' && !sameOriginJson(request)) throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
    if (route === 'sources') return sources(query, ctx);
    if (route === 'quote') return quote(query, ctx);
    if (route === 'portfolio') return portfolio(query, ctx);
    if (route === 'transactions') return transactions(query, ctx);
    if (route === 'import') return method === 'POST' ? importBatch(request, query, ctx) : deleteBatch(query, ctx);
    return instruments(query, ctx);
  });
}

// --- portefeuille (B1) -----------------------------------------------------------------

const ENVELOPE_KINDS = ['PEA', 'PEA-PME', 'CTO', 'AV', 'livret', 'compte'] as const;
const BROKER = /^[\p{L}\p{N} .&'-]{1,40}$/u;
const MAX_IMPORT_BYTES = 2_000_000;

function envelopeParam(q: Map<string, string>): number | null {
  const v = q.get('envelope');
  if (!v || v === 'all') return null;
  if (!/^\d{1,12}$/.test(v)) throw new HttpError(400, 'paramètre envelope : identifiant numérique ou « all » attendu');
  return Number(v);
}

async function portfolio(query: Request, ctx: Context): Promise<Response> {
  const env = envelopeParam(readQuery(query, ['envelope']));
  const data = await loadData(database(ctx));
  if (env !== null && !data.envelopes.some((e) => e.id === env)) throw new HttpError(404, `enveloppe inconnue : ${env}`);
  return json(buildReport(data, env, ctx.deps.now()), NO_STORE);
}

interface TxnListRow {
  id: number; envelope_id: number; trade_date: string; kind: string; listing_id: number | null; quantity: string | null;
  price: string | null; amount: string | null; fees: string; taxes: string; currency: string; fx_rate: string | null;
  reference: string | null; batch_id: number | null; source: string;
  instrument_listings: { symbol: string; instruments: { name: string } | null } | null;
}

async function transactions(query: Request, ctx: Context): Promise<Response> {
  const env = envelopeParam(readQuery(query, ['envelope']));
  const db = database(ctx);
  const filter: Record<string, string> = env === null ? {} : { envelope_id: `eq.${env}` };
  const [rows, batches] = await Promise.all([
    db.select<TxnListRow>('transactions', {
      select: 'id,envelope_id,trade_date,kind,listing_id,quantity,price,amount,fees,taxes,currency,fx_rate,reference,batch_id,source,'
        + 'instrument_listings(symbol,instruments(name))',
      ...filter, order: 'trade_date.desc,id.desc', limit: '2000' }),
    db.select<Record<string, unknown>>('import_batches', {
      select: 'id,envelope_id,source,file_name,rows,inserted,imported_at', ...filter, order: 'imported_at.desc', limit: '50' }),
  ]);
  return json({
    transactions: rows.map(({ instrument_listings: l, ...t }) => ({
      ...t, quantity: t.quantity === null ? null : String(t.quantity), price: t.price === null ? null : String(t.price),
      amount: t.amount === null ? null : String(t.amount), fees: String(t.fees), taxes: String(t.taxes),
      symbol: l?.symbol ?? null, name: l?.instruments?.name ?? null,
    })),
    batches,
  }, NO_STORE);
}

interface ImportBody { kind?: unknown; broker?: unknown; file_name?: unknown; file_sha256?: unknown; rows?: unknown; dry?: unknown }

async function importBatch(request: Request, query: Request, ctx: Context): Promise<Response> {
  readQuery(query, []);
  const text = await request.text();
  if (text.length > MAX_IMPORT_BYTES) throw new HttpError(413, 'fichier trop volumineux (2 Mo au plus)');
  let body: ImportBody;
  try { body = JSON.parse(text) as ImportBody; } catch { throw new HttpError(400, 'corps JSON illisible'); }
  const kind = body.kind;
  if (typeof kind !== 'string' || !(ENVELOPE_KINDS as readonly string[]).includes(kind)) {
    throw new HttpError(400, `enveloppe : un type parmi ${ENVELOPE_KINDS.join(', ')}`);
  }
  if (typeof body.broker !== 'string' || !BROKER.test(body.broker.trim())) throw new HttpError(400, 'courtier : 1 à 40 lettres ou chiffres');
  const broker = body.broker.trim();
  const fileName = typeof body.file_name === 'string' ? body.file_name.slice(0, 200) : null;
  const sha = typeof body.file_sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.file_sha256) ? body.file_sha256 : null;
  if (!Array.isArray(body.rows) || body.rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
    throw new HttpError(400, 'rows : liste de lignes (objets) attendue');
  }

  const db = database(ctx);
  const today = parisDate(ctx.deps.now());
  const parsed = parseRows(body.rows as RawRow[], today);
  const refRows = await db.select<{ id: number; symbol: string; mic: string | null; currency: string; tracked: boolean; instruments: { isin: string | null; name: string } | null }>(
    'instrument_listings', { select: 'id,symbol,mic,currency,tracked,instruments(isin,name)', order: 'id.asc' });
  const ref: RefListing[] = refRows.map((r) => ({ id: r.id, symbol: r.symbol, mic: r.mic, currency: r.currency, tracked: r.tracked,
    isin: r.instruments?.isin ?? null, name: r.instruments?.name ?? r.symbol }));
  const resolved = resolveRows(parsed.rows, ref, 'EUR');
  const errors = [...parsed.errors, ...resolved.errors].sort((a, b) => a.line - b.line);
  const preview = resolved.rows.map((r) => ({
    line: r.line, trade_date: r.trade_date, kind: r.kind, listing: r.listing_label, quantity: r.quantity, price: r.price,
    amount: r.amount, fees: r.fees, taxes: r.taxes, currency: r.currency, reference: r.reference,
  }));
  const report = { envelope: `${kind} · ${broker}`, rows: preview.length, errors, warnings: resolved.warnings, preview };
  if (errors.length) return json(report, NO_STORE, 422);
  if (body.dry === true) return json({ ...report, dry: true }, NO_STORE);
  if (!preview.length) throw new HttpError(400, 'aucune opération dans le fichier');
  const result = await db.rpc<{ envelope_id: number; batch_id: number | null; rows: number; inserted: number }>('bourse_import', {
    p_kind: kind, p_broker: broker, p_name: `${kind} · ${broker}`, p_perf_start: DEFAULT_PERF_START,
    p_file_name: fileName, p_file_sha256: sha, p_rows: resolved.rows.map(toDbRow),
  });
  return json({ ...report, result }, NO_STORE);
}

async function deleteBatch(query: Request, ctx: Context): Promise<Response> {
  const id = readQuery(query, ['batch']).get('batch');
  if (!id || !/^\d{1,12}$/.test(id)) throw new HttpError(400, 'paramètre batch : identifiant numérique attendu');
  const n = await database(ctx).remove('import_batches', { id: `eq.${id}` });
  if (!n) throw new HttpError(404, `lot d’import inconnu : ${id}`);
  return json({ deleted: Number(id) }, NO_STORE);
}
