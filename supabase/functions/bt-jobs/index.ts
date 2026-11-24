// Edge Function bt-jobs (Supabase, Deno) : point d'entrée seulement.
// La logique vit dans handler.ts et candles.ts, testés par Vitest (section Backtest, T-061).
//
// Déploiement : supabase functions deploy bt-jobs.
// Appel : POST /functions/v1/bt-jobs?job=candles avec l'en-tête x-jobs-secret.

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
