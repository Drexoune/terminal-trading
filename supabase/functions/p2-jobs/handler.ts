// Requête HTTP de l'Edge Function p2-jobs (plan P2, écran Taux) : contrôle de l'appel, choix de
// la tâche (?job=…), réponse JSON. Module pur, testé par Vitest ; index.ts le branche sur Deno.serve.
//
// Fonction distincte de p1-jobs (décision T-049) : rien du paquet de la capture de P1 ne change.
// Même protection : en-tête x-jobs-secret comparé à temps constant à P1_JOBS_SECRET (même secret
// dans Vault, aucun nouveau secret).

import { MIN_SECRET_LENGTH, secretMatches } from '../okx-collector/handler.ts';
import { explore, type ExploreDeps } from './explore.ts';

// explore : sonde R0 des sources (Polymarket, Kalshi, BIS, pages officielles), sans écriture.
export const JOBS = ['explore'] as const;
export type Job = (typeof JOBS)[number];

export interface HandlerDeps extends Omit<ExploreDeps, 'env'> {
  run?: (job: Job, deps: ExploreDeps) => Promise<unknown>;   // remplaçable en test
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export function createHandler(env: (name: string) => string | undefined, deps: HandlerDeps): (req: Request) => Promise<Response> {
  const run = deps.run ?? ((_job: Job, d: ExploreDeps) => explore(d));
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
      const report = await run(job as Job, { ...deps, env });
      const failed = typeof report === 'object' && report !== null && (report as { ok?: boolean }).ok === false;
      return json(failed ? 502 : 200, { ok: !failed, report });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  };
}
