// Lecture du journal du collecteur Supabase (Mode Online) par PostgREST.
//
// Le front n'appelle jamais Supabase : seule la fonction Vercel lit la base,
// avec la clé secrète gardée côté serveur (SUPABASE_URL, SUPABASE_SECRET_KEY).
// Les tables ont la RLS activée sans aucune politique : seule une clé secrète
// les lit.
//
// Deux formes de clé secrète (doc Supabase « API keys », à vérifier au déploiement) :
// - nouvelle clé `sb_secret_…` : en-tête `apikey` SEUL ; elle n'est pas un JWT,
//   et l'envoyer aussi en `Authorization: Bearer` provoque « Invalid JWT » ;
// - ancienne clé `service_role` (JWT) : `apikey` + `Authorization: Bearer`.
//
// Tables lues (migration supabase/migrations/…_online_mode.sql) :
//   collector_runs(id, started_at, finished_at, ok, error, rows, okx_offset_ms, rtt_ms)
//   collector_gaps(id, inst, from_t, to_t, missing, detected_at)

import { redact, UpstreamError, type Env } from './http.js';
import type { FetchFn } from './okx.js';

export const SUPABASE_TIMEOUT_MS = 4000; // sous le délai de 5 s de la sonde du front
export const PAGE_ROWS = 1000;           // max_rows par défaut de Supabase
export const MAX_PAGES = 20;             // borne de sécurité (≈ 20 000 trous en 24 h)
export const ERROR_MAX_CHARS = 300;
const DAY_MS = 86_400_000;

export class SupabaseError extends UpstreamError {
  constructor(message: string, detail = '') {
    super('Supabase', message, detail);
    this.name = 'SupabaseError';
  }
}

export interface SupabaseConfig { url: string; headers: Record<string, string> }

export type ConfigResult = { ok: true; config: SupabaseConfig } | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Rôle porté par une clé JWT (lu sans vérifier la signature : seul Supabase la vérifie). */
function jwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** En-têtes d'authentification selon la forme de la clé, ou la raison du refus. */
export function authHeaders(key: string): { ok: true; headers: Record<string, string> } | { ok: false; reason: string } {
  if (key.startsWith('sb_secret_')) return { ok: true, headers: { apikey: key } };
  if (key.startsWith('sb_publishable_')) {
    return { ok: false, reason: 'SUPABASE_SECRET_KEY contient une clé publique (sb_publishable_…) : la clé secrète est attendue' };
  }
  const role = jwtRole(key);
  if (role === 'service_role') return { ok: true, headers: { apikey: key, Authorization: `Bearer ${key}` } };
  if (role !== null) {
    return {
      ok: false,
      reason: `SUPABASE_SECRET_KEY est une clé JWT de rôle ${role.replace(/[^a-z_]/gi, '').slice(0, 20)} : la clé service_role est attendue`,
    };
  }
  return { ok: false, reason: 'SUPABASE_SECRET_KEY : format non reconnu (sb_secret_… ou JWT service_role attendu)' };
}

/** Configuration Supabase lue dans l'environnement, ou la raison pour laquelle elle manque. */
export function supabaseConfig(env: Env): ConfigResult {
  const rawUrl = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  const missing = [!rawUrl && 'SUPABASE_URL', !key && 'SUPABASE_SECRET_KEY'].filter(Boolean);
  if (missing.length) return { ok: false, reason: `variable(s) absente(s) : ${missing.join(', ')}` };
  let u: URL;
  try {
    u = new URL(rawUrl!);
  } catch {
    return { ok: false, reason: 'SUPABASE_URL invalide (https://<projet>.supabase.co attendu)' };
  }
  // https partout ; http seulement vers la machine elle-même (supabase start).
  const httpsOk = u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname));
  if (!httpsOk || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    return { ok: false, reason: 'SUPABASE_URL invalide (https://<projet>.supabase.co attendu)' };
  }
  const auth = authHeaders(key!);
  if (!auth.ok) return auth;
  return { ok: true, config: { url: u.origin, headers: auth.headers } };
}

interface RestResult { rows: unknown[]; total: number | null }

/** Une requête PostgREST (GET, ou HEAD pour un simple décompte). */
async function rest(cfg: SupabaseConfig, fetchFn: FetchFn, method: 'GET' | 'HEAD', table: string,
                    params: Record<string, string>, count: boolean): Promise<RestResult> {
  const url = `${cfg.url}/rest/v1/${table}?${new URLSearchParams(params)}`;
  let r: Response;
  try {
    r = await fetchFn(url, {
      method,
      headers: { ...cfg.headers, Accept: 'application/json', ...(count ? { Prefer: 'count=exact' } : {}) },
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new SupabaseError('injoignable ou délai dépassé', `${table} : ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!r.ok) {
    // Seul le code d'erreur PostgREST ou Postgres (PGRST301, 42P01…) part dans la réponse.
    const text = method === 'GET' ? await r.text().catch(() => '') : '';
    let code = '';
    try {
      const c = (JSON.parse(text) as { code?: unknown }).code;
      if (typeof c === 'string' && /^[A-Z0-9]{3,10}$/.test(c)) code = c;
    } catch { /* corps vide ou non JSON */ }
    throw new SupabaseError(`HTTP ${r.status}${code ? ` (code ${code})` : ''}`, `${table} : ${text.slice(0, 200)}`);
  }
  let total: number | null = null;
  if (count) {
    // Content-Range: 0-24/25, ou */0 quand rien ne correspond.
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
    if (!m) throw new SupabaseError('décompte absent de la réponse', `${table} : Content-Range ${r.headers.get('content-range')}`);
    total = Number(m[1]);
  }
  if (method === 'HEAD') return { rows: [], total };
  let rows: unknown;
  try {
    rows = await r.json();
  } catch {
    throw new SupabaseError('réponse illisible', `${table} : pas du JSON`);
  }
  if (!Array.isArray(rows)) throw new SupabaseError('réponse illisible', `${table} : tableau attendu`);
  return { rows, total };
}

/** Somme des minutes manquantes des trous détectés depuis `sinceIso`, page par page. */
async function missingMinutes(cfg: SupabaseConfig, fetchFn: FetchFn, sinceIso: string): Promise<number> {
  let sum = 0;
  let fetched = 0;
  let total: number | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await rest(cfg, fetchFn, 'GET', 'collector_gaps', {
      select: 'missing', detected_at: `gte.${sinceIso}`, order: 'id.asc',
      offset: String(fetched), limit: String(PAGE_ROWS),
    }, page === 0);
    if (page === 0) total = res.total;
    for (const row of res.rows) {
      const m = (row as { missing?: unknown }).missing;
      if (typeof m === 'number' && Number.isFinite(m) && m > 0) sum += m;
    }
    fetched += res.rows.length;
    // Le décompte pilote la pagination : max_rows peut être réglé sous PAGE_ROWS.
    if (!res.rows.length || total === null || fetched >= total) return sum;
  }
  throw new SupabaseError('trop de trous à compter', `plus de ${MAX_PAGES * PAGE_ROWS} lignes en 24 h`);
}

export interface LastRun { started_at: string; finished_at: string; ok: boolean; error: string | null; rows: number | null }

/** Réponse de GET /api/collector-health. Sans configuration, les décomptes valent null (inconnus). */
export type CollectorHealthReply =
  | {
      configured: true; last_run: LastRun | null; age_ms: number | null;
      runs_24h: number; failures_24h: number; gaps_24h: number; source: 'Supabase';
    }
  | {
      configured: false; reason: string; last_run: null; age_ms: null;
      runs_24h: null; failures_24h: null; gaps_24h: null; source: 'Supabase';
    };

export function notConfigured(reason: string): CollectorHealthReply {
  return {
    configured: false, reason, last_run: null, age_ms: null,
    runs_24h: null, failures_24h: null, gaps_24h: null, source: 'Supabase',
  };
}

function lastRunFrom(row: unknown, env: Env): LastRun {
  const r = (row ?? {}) as Record<string, unknown>;
  if (typeof r.started_at !== 'string' || typeof r.finished_at !== 'string') {
    throw new SupabaseError('réponse illisible', 'collector_runs : horodatages absents');
  }
  const error = typeof r.error === 'string' && r.error
    ? redact(r.error, env).slice(0, ERROR_MAX_CHARS) : null;
  return {
    started_at: r.started_at,
    finished_at: r.finished_at,
    ok: r.ok === true,
    error,
    rows: typeof r.rows === 'number' && Number.isFinite(r.rows) ? r.rows : null,
  };
}

/**
 * État du collecteur : dernier passage TERMINÉ (un passage en cours n'a pas
 * encore de verdict), passages et échecs sur 24 h, minutes manquantes
 * détectées sur 24 h (somme de collector_gaps.missing).
 */
export async function collectorHealth(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, env: Env): Promise<CollectorHealthReply> {
  const since = new Date(now - DAY_MS).toISOString();
  const [last, runs, failures, gaps] = await Promise.all([
    rest(cfg, fetchFn, 'GET', 'collector_runs', {
      select: 'started_at,finished_at,ok,error,rows', finished_at: 'not.is.null',
      order: 'started_at.desc', limit: '1',
    }, false),
    rest(cfg, fetchFn, 'HEAD', 'collector_runs', { select: 'id', started_at: `gte.${since}` }, true),
    rest(cfg, fetchFn, 'HEAD', 'collector_runs', { select: 'id', started_at: `gte.${since}`, ok: 'is.false' }, true),
    missingMinutes(cfg, fetchFn, since),
  ]);
  const lastRun = last.rows.length ? lastRunFrom(last.rows[0], env) : null;
  let ageMs: number | null = null;
  if (lastRun) {
    const finished = Date.parse(lastRun.finished_at);
    if (!Number.isFinite(finished)) throw new SupabaseError('réponse illisible', `finished_at : ${lastRun.finished_at}`);
    ageMs = Math.max(0, now - finished);
  }
  return {
    configured: true, last_run: lastRun, age_ms: ageMs,
    runs_24h: runs.total ?? 0, failures_24h: failures.total ?? 0, gaps_24h: gaps, source: 'Supabase',
  };
}
