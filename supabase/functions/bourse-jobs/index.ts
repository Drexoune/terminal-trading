// Edge Function bourse-jobs (Supabase, Deno) : point d'entrée seulement.
// La logique vit dans handler.ts, jobs.ts et parse.ts, testés par Vitest.
//
// Déploiement : supabase functions deploy bourse-jobs (voir supabase/README.md).
// Appel : POST /functions/v1/bourse-jobs?job=<tâche> avec l'en-tête
// x-jobs-secret, par pg_cron (supabase/cron-bourse.sql) ou à la main.

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
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
));
