// Requête HTTP de l'Edge Function bt-jobs (section Backtest, T-061) : contrôle de l'appel, choix
// de la tâche (?job=…), réponse JSON. Module pur, testé par Vitest ; index.ts le branche sur
// Deno.serve. Fonction distincte des fonctions p1 à p4 : leurs paquets ne changent pas. Même
// protection : en-tête x-jobs-secret comparé à temps constant à P1_JOBS_SECRET.

import { MIN_SECRET_LENGTH, secretKeyFrom, secretMatches } from '../okx-collector/handler.ts';
import type { FetchLike } from '../okx-collector/postgrest.ts';
import { createRest, type Rest } from '../p1-jobs/rest.ts';
import { type CandleDeps, runCandles } from './candles.ts';

// candles : bougies OKX et Tiingo (collecte et rattrapage de l'historique).
export const JOBS = ['candles'] as const;
export type Job = (typeof JOBS)[number];

export interface HandlerDeps {
  fetch: CandleDeps['fetch']; now: () => number; sleep: (ms: number) => Promise<void>;
  run?: (job: Job, deps: CandleDeps) => Promise<unknown>;   // remplaçable en test
  rest?: Rest;                                              // base simulée en test
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function createHandler(env: (name: string) => string | undefined, deps: HandlerDeps): (req: Request) => Promise<Response> {
  const run = deps.run ?? ((_job: Job, d: CandleDeps) => runCandles(d));
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
      if (!rest) throw new Error('SUPABASE_URL ou clé secrète Supabase absente');
      const report = await run(job as Job, { fetch: deps.fetch, now: deps.now, sleep: deps.sleep, rest, env });
      const failed = typeof report === 'object' && report !== null && (report as { ok?: boolean }).ok === false;
      return json(failed ? 502 : 200, { ok: !failed, report });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  };
}
