// Edge Function okx-collector (Supabase, Deno) : point d'entrée seulement.
// La logique vit dans handler.ts, collector.ts et postgrest.ts, modules purs
// testés par Vitest (supabase/functions/okx-collector/*.test.ts).
//
// Déploiement : supabase functions deploy okx-collector (voir supabase/README.md).
// Appel : POST /functions/v1/okx-collector avec l'en-tête x-collector-secret,
// chaque minute par pg_cron (supabase/cron.sql).

import { createHandler } from './handler.ts';

// Accès typé au global Deno sans dépendre de ses déclarations : ce fichier est
// aussi vérifié par le tsc du front (web/tsconfig.json inclut supabase/functions).
interface DenoLike {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
}
const deno = (globalThis as unknown as { Deno: DenoLike }).Deno;

// Variables lues à chaque requête, jamais copiées dans le module ni renvoyées.
deno.serve(createHandler(
  (name) => deno.env.get(name),
  { fetch: (url, init) => fetch(url, init), now: () => Date.now() },
));
