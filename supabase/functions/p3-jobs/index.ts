// Edge Function p3-jobs (Supabase, Deno) : point d'entrée seulement.
// La logique vit dans handler.ts et explore.ts, testés par Vitest (plan P3).
//
// Déploiement : supabase functions deploy p3-jobs (plan P3, étape M0).
// Appel : POST /functions/v1/p3-jobs?job=explore avec l'en-tête x-jobs-secret.

import { createHandler } from './handler.ts';

interface DenoLike {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
}
const deno = (globalThis as unknown as { Deno: DenoLike }).Deno;

deno.serve(createHandler(
  (name) => deno.env.get(name),
  {
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    perf: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
));
