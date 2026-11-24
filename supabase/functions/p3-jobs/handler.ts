// Requête HTTP de l'Edge Function p3-jobs (plan P3, macro et heatmap) : contrôle de l'appel, choix
// de la tâche (?job=…), réponse JSON. Module pur, testé par Vitest ; index.ts le branche sur Deno.serve.
//
// Fonction distincte de p1-jobs et p2-jobs (décision T-053) : leurs paquets ne changent pas.
// Même protection : en-tête x-jobs-secret comparé à temps constant à P1_JOBS_SECRET (même secret
// dans Vault, aucun nouveau secret).

import { MIN_SECRET_LENGTH, secretKeyFrom, secretMatches } from '../okx-collector/handler.ts';
import type { FetchLike } from '../okx-collector/postgrest.ts';
import { createRest, type Rest } from '../p1-jobs/rest.ts';
import { explore, type ExploreDeps } from './explore.ts';
import { runBacktestJob, runScores } from './jobs.ts';
import { runFx, runMacro, type MacroDeps } from './macro.ts';

// explore : sonde M0 des sources (OCDE, BCE, FRED, BIS, DBnomics), sans écriture ;
// macro et fx (chaque jour) : séries FRED, BCE, BIS et changes ; scores (chaque jour et toutes les
// 10 min) : matrice et scores ; backtest (chaque mois) : porte de P3.
export const JOBS = ['explore', 'macro', 'fx', 'scores', 'backtest'] as const;
export type Job = (typeof JOBS)[number];

export interface RunDeps extends ExploreDeps { rest: Rest | null }

export interface HandlerDeps extends Omit<ExploreDeps, 'env'> {
  run?: (job: Job, deps: RunDeps) => Promise<unknown>;   // remplaçable en test
  rest?: Rest;                                            // base simulée en test
}

async function defaultRun(job: Job, d: RunDeps): Promise<unknown> {
  if (job === 'explore') return explore(d);
  if (!d.rest) throw new Error('SUPABASE_URL ou clé secrète Supabase absente');
  const md: MacroDeps = { fetch: d.fetch as unknown as MacroDeps['fetch'], now: d.now, rest: d.rest };
  if (job === 'macro') return runMacro(md);
  if (job === 'fx') return runFx(md);
  if (job === 'scores') return runScores(md);
  return runBacktestJob(md);
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function createHandler(env: (name: string) => string | undefined, deps: HandlerDeps): (req: Request) => Promise<Response> {
  const run = deps.run ?? defaultRun;
  return async (req) => {
    if (req.method !== 'POST') return json(405, { ok: false, error: 'méthode non autorisée : POST attendu' }, { Allow: 'POST' });
    const expected = env('P1_JOBS_SECRET') ?? '';
    if (expected.length < MIN_SECRET_LENGTH) {
      return json(500, { ok: false, error: `P1_JOBS_SECRET absent ou trop court (${MIN_SECRET_LENGTH} caractères au moins)` });
    }
    if (!(await secretMatches(req.headers.get('x-jobs-secret') ?? '', expected))) return json(401, { ok: false, error: 'secret d’appel invalide' });
    const job = new URL(req.url).searchParams.get('job') ?? '';
    if (!(JOBS as readonly string[]).includes(job)) return json(400, { ok: false, error: `tâche inconnue (attendues : ${JOBS.join(', ')})` });
    try {
      const url = env('SUPABASE_URL');
      const key = secretKeyFrom(env as Parameters<typeof secretKeyFrom>[0]);
      const rest = deps.rest ?? (url && key ? createRest(url, key, deps.fetch as unknown as FetchLike) : null);
      const report = await run(job as Job, { ...deps, env, rest });
      const failed = typeof report === 'object' && report !== null && (report as { ok?: boolean }).ok === false;
      return json(failed ? 502 : 200, { ok: !failed, report });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  };
}
