// Edge Function p4-jobs (Supabase, Deno) : point d'entrée seulement.
// La logique vit dans handler.ts et explore.ts, testés par Vitest (plan P4).
//
// Déploiement : supabase functions deploy p4-jobs (plan P4, étape S0).
// Appel : POST /functions/v1/p4-jobs?job=explore avec l'en-tête x-jobs-secret.

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
