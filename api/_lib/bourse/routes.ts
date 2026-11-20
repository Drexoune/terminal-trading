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

export const ROUTES = ['session', 'sources', 'quote', 'instruments'] as const;
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

/** Tâches planifiées : miroir de supabase/cron-bourse.sql (heures UTC). */
export const SCHEDULES = [
  { job: 'ecb-fx', label: 'Cours de référence BCE', source: 'BCE', runs: [{ minute: 30, hour: 16, days: [1, 2, 3, 4, 5] }] },
  { job: 'us-close', label: 'Clôtures US', source: 'Massive', runs: [{ minute: 15, hour: 6, days: [2, 3, 4, 5, 6] }] },
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
    if (method !== 'GET') throw new HttpError(405, 'méthode non autorisée (GET attendu)');
    const auth = authConfig(ctx.env);
    if (typeof auth === 'string') throw new HttpError(503, `module Bourse non configuré : ${auth}`);
    if ((await sessionExp(request, auth, ctx.deps.now())) === null) throw new HttpError(401, 'session requise');
    if (route === 'sources') return sources(query, ctx);
    if (route === 'quote') return quote(query, ctx);
    return instruments(query, ctx);
  });
}
