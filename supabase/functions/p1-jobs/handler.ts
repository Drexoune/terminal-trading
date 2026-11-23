// Requête HTTP de l'Edge Function p1-jobs (plan « Tout en ligne », T-042) : contrôle de
// l'appel, choix de la tâche (?job=…), réponse JSON. Module pur, testé par Vitest ;
// index.ts le branche sur Deno.serve.
//
// Appelants légitimes : pg_cron (étapes suivantes) et Clément à la main pour « explore ».
// Déployée sans vérification de JWT : l'en-tête x-jobs-secret, comparé à P1_JOBS_SECRET
// à temps constant, est la seule protection (mêmes règles que bourse-jobs).

import { MIN_SECRET_LENGTH, secretKeyFrom, secretMatches } from '../okx-collector/handler.ts';
import type { FetchLike } from '../okx-collector/postgrest.ts';
import { runBlsCalendar, runFfCalendar, type HttpFetch } from './calendar_job.ts';
import { explore, type ExploreDeps } from './explore.ts';
import { createRest, type Rest } from './rest.ts';

// explore : sonde O0 ; ff-calendar (hh:45, hh:55) et bls-calendar (06:10, 06:40 UTC) : agenda O2.
export const JOBS = ['explore', 'ff-calendar', 'bls-calendar'] as const;
export type Job = (typeof JOBS)[number];

export interface RunDeps extends ExploreDeps { rest: Rest | null; force: boolean }

export interface HandlerDeps extends Omit<ExploreDeps, 'env'> {
  run?: (job: Job, deps: RunDeps) => Promise<unknown>;   // remplaçable en test
  rest?: Rest;                                           // base simulée en test
}

async function defaultRun(job: Job, d: RunDeps): Promise<unknown> {
  if (job === 'explore') return explore(d);
  if (!d.rest) throw new Error('SUPABASE_URL ou clé secrète Supabase absente');
  const deps = { fetch: d.fetch as unknown as HttpFetch, now: d.now, env: d.env, rest: d.rest };
  return job === 'ff-calendar' ? runFfCalendar(deps, d.force) : runBlsCalendar(deps, d.force);
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function createHandler(env: (name: string) => string | undefined, deps: HandlerDeps):
  (req: Request) => Promise<Response> {
  const run = deps.run ?? defaultRun;
  return async (req) => {
    if (req.method !== 'POST') {
      return json(405, { ok: false, error: 'méthode non autorisée : POST attendu' }, { Allow: 'POST' });
    }
    const expected = env('P1_JOBS_SECRET') ?? '';
    if (expected.length < MIN_SECRET_LENGTH) {
      return json(500, { ok: false, error: `P1_JOBS_SECRET absent ou trop court (${MIN_SECRET_LENGTH} caractères au moins)` });
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
    try {
      const rest = deps.rest ?? (url && key ? createRest(url, key, deps.fetch as unknown as FetchLike) : null);
      const force = new URL(req.url).searchParams.get('force') === '1';
      const report = await run(job as Job, { ...deps, env, rest, force });
      const failed = typeof report === 'object' && report !== null && (report as { ok?: boolean }).ok === false;
      return json(failed ? 502 : 200, { ok: !failed, report });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  };
}
