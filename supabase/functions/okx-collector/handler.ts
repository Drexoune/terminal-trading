// Requête HTTP de l'Edge Function okx-collector : contrôle de l'appel, lecture
// de la configuration, passage du collecteur, réponse JSON courte.
// Module pur (Request, Response et crypto.subtle sont des API web standard,
// présentes dans Deno comme dans Node), testé par Vitest ; index.ts ne fait
// que le brancher sur Deno.serve.
//
// L'appelant légitime est pg_cron (via pg_net, supabase/cron.sql). La fonction
// est déployée sans vérification de JWT (verify_jwt = false dans config.toml) :
// l'en-tête x-collector-secret, comparé à COLLECTOR_SECRET, est la seule
// protection. Sans lui, n'importe qui pourrait faire tourner le collecteur et
// consommer les limites OKX de l'adresse IP de la fonction.

import { DEFAULT_INSTRUMENTS, OKX_EEA_REST, runCollector, type CollectorDeps, type RunResult } from './collector.ts';
import { createPostgrest, type FetchLike } from './postgrest.ts';

/** Variables lues par la fonction (Edge Function secrets). */
export const ENV_NAMES = [
  'COLLECTOR_SECRET',           // posé par « supabase secrets set »
  'SUPABASE_URL',               // fournies par la plateforme (à vérifier au déploiement)
  'SUPABASE_SECRET_KEYS',       // nouvelles clés : JSON {"default": "sb_secret_…"}
  'SUPABASE_SERVICE_ROLE_KEY',  // ancienne clé service_role (JWT), en repli
  'OKX_INSTRUMENTS',            // facultatif : BTC-USDT-SWAP,ETH-USDT-SWAP par défaut
] as const;

export type EnvGetter = (name: (typeof ENV_NAMES)[number]) => string | undefined;

/** Longueur minimale du secret d'appel (openssl rand -hex 32 en donne 64). */
export const MIN_SECRET_LENGTH = 32;

const MAX_INSTRUMENTS = 10;
const INSTRUMENT_ID = /^[A-Z0-9]+-[A-Z0-9]+-SWAP$/;

export interface HandlerDeps {
  fetch: FetchLike;
  now: () => number;
  run?: (deps: CollectorDeps) => Promise<RunResult>;   // remplaçable en test
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/**
 * Égalité de secrets à temps constant : on compare les empreintes SHA-256
 * (même longueur quelle que soit l'entrée, donc rien ne fuit par la durée),
 * octet par octet sans sortie anticipée.
 */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && expected.length > 0;
}

/** Clé secrète Supabase : nouvelle clé `default` de SUPABASE_SECRET_KEYS, sinon service_role. */
export function secretKeyFrom(env: EnvGetter): string | null {
  const raw = env('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const key = (JSON.parse(raw) as Record<string, unknown>).default;
      if (typeof key === 'string' && key) return key;
    } catch { /* format inattendu : repli sur l'ancienne clé */ }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY') || null;
}

/** Liste d'instruments de OKX_INSTRUMENTS, ou erreur ; liste par défaut si absente. */
export function instrumentsFrom(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) return DEFAULT_INSTRUMENTS;
  const list = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
  const bad = list.filter((s) => !INSTRUMENT_ID.test(s));
  if (bad.length) throw new Error(`OKX_INSTRUMENTS : identifiant(s) invalide(s) : ${bad.join(', ')}`);
  if (list.length > MAX_INSTRUMENTS) throw new Error(`OKX_INSTRUMENTS : ${MAX_INSTRUMENTS} instruments au plus`);
  return list;
}

export function createHandler(env: EnvGetter, deps: HandlerDeps): (req: Request) => Promise<Response> {
  const run = deps.run ?? runCollector;
  return async (req) => {
    if (req.method !== 'POST') {
      return json(405, { ok: false, error: 'méthode non autorisée : POST attendu' }, { Allow: 'POST' });
    }

    // Jamais ouverte par défaut : sans secret configuré, tout appel est refusé.
    const expected = env('COLLECTOR_SECRET') ?? '';
    if (expected.length < MIN_SECRET_LENGTH) {
      return json(500, { ok: false, error: `COLLECTOR_SECRET absent ou trop court (${MIN_SECRET_LENGTH} caractères au moins)` });
    }
    if (!(await secretMatches(req.headers.get('x-collector-secret') ?? '', expected))) {
      return json(401, { ok: false, error: 'secret d’appel invalide' });
    }

    const url = env('SUPABASE_URL');
    const key = secretKeyFrom(env);
    if (!url || !key) {
      return json(500, { ok: false, error: 'SUPABASE_URL ou clé secrète Supabase absente' });
    }

    try {
      const db = createPostgrest({ url, key, fetch: deps.fetch });
      const result = await run({
        fetch: deps.fetch, now: deps.now, db,
        instruments: instrumentsFrom(env('OKX_INSTRUMENTS')),
        okxBase: OKX_EEA_REST,
      });
      // Passage journalisé ; 500 s'il a rencontré des erreurs, pour qu'elles se
      // voient aussi dans net._http_response.
      return json(result.ok ? 200 : 500, result);
    } catch (e) {
      // Configuration refusée ou journal impossible à écrire.
      return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}
