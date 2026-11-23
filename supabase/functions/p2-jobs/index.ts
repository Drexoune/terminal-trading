// Edge Function p2-jobs (Supabase, Deno) : point d'entrée seulement.
// La logique vit dans handler.ts et explore.ts, testés par Vitest.
//
// Déploiement : supabase functions deploy p2-jobs (plan P2, étape R0).
// Appel : POST /functions/v1/p2-jobs?job=explore avec l'en-tête x-jobs-secret.

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
