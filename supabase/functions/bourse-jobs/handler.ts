// Requête HTTP de l'Edge Function bourse-jobs : contrôle de l'appel, choix de
// la tâche (?job=…), passage, réponse JSON. Module pur, testé par Vitest ;
// index.ts le branche sur Deno.serve.
//
// Appelants légitimes : pg_cron (via pg_net, supabase/cron-bourse.sql) et
// Clément à la main pour la tâche « explore ». Déployée sans vérification de
// JWT : l'en-tête x-jobs-secret, comparé à BOURSE_JOBS_SECRET, est la seule
// protection (mêmes règles que okx-collector).

import { MIN_SECRET_LENGTH, secretKeyFrom, secretMatches } from '../okx-collector/handler.ts';
import { authHeaders, createPostgrest, type FetchLike } from '../okx-collector/postgrest.ts';
import { JOBS, runJob, type Job, type JobDeps, type JobResult, type Rpc } from './jobs.ts';

/** Variables lues par la fonction (Edge Function secrets). */
export const ENV_NAMES = [
  'BOURSE_JOBS_SECRET',         // secret d'appel, 32 caractères au moins
  'SUPABASE_URL', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY',   // fournies par la plateforme
  'MASSIVE_API_KEY', 'ALPHA_VANTAGE_API_KEY', 'ALPHA_VANTAGE_DAILY_MAX',
  'TIINGO_API_KEY', 'OPENFIGI_API_KEY', 'SEC_CONTACT_EMAIL',
] as const;

export type EnvGetter = (name: string) => string | undefined;

export interface HandlerDeps {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  run?: (job: Job, deps: JobDeps) => Promise<JobResult>;   // remplaçable en test
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Appel d'une fonction SQL exposée par PostgREST (/rest/v1/rpc/<nom>). */
export function createRpc(url: string, key: string, fetchFn: FetchLike): Rpc {
  const base = `${url.replace(/\/+$/, '')}/rest/v1/rpc`;
  const auth = authHeaders(key);
  return async (fn, args) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`rpc : nom invalide ${JSON.stringify(fn)}`);
    const r = await fetchFn(`${base}/${fn}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`rpc ${fn} : HTTP ${r.status} ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`rpc ${fn} : réponse non JSON`);
    }
  };
}

export function createHandler(env: EnvGetter, deps: HandlerDeps): (req: Request) => Promise<Response> {
  const run = deps.run ?? runJob;
  return async (req) => {
    if (req.method !== 'POST') {
      return json(405, { ok: false, error: 'méthode non autorisée : POST attendu' }, { Allow: 'POST' });
    }
    const expected = env('BOURSE_JOBS_SECRET') ?? '';
    if (expected.length < MIN_SECRET_LENGTH) {
      return json(500, { ok: false, error: `BOURSE_JOBS_SECRET absent ou trop court (${MIN_SECRET_LENGTH} caractères au moins)` });
    }
    if (!(await secretMatches(req.headers.get('x-jobs-secret') ?? '', expected))) {
      return json(401, { ok: false, error: 'secret d’appel invalide' });
    }
    const job = new URL(req.url).searchParams.get('job') ?? '';
    if (!(JOBS as readonly string[]).includes(job)) {
      return json(400, { ok: false, error: `tâche inconnue (attendues : ${JOBS.join(', ')})` });
    }
    const url = env('SUPABASE_URL');
    const key = secretKeyFrom(env as Parameters<typeof secretKeyFrom>[0]);
    if (!url || !key) return json(500, { ok: false, error: 'SUPABASE_URL ou clé secrète Supabase absente' });
    try {
      const db = createPostgrest({ url, key, fetch: deps.fetch });
      const result = await run(job as Job, {
        fetch: deps.fetch, now: deps.now, sleep: deps.sleep, db, rpc: createRpc(url, key, deps.fetch), env,
      });
      return json(result.ok ? 200 : 500, result);
    } catch (e) {
      return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}
