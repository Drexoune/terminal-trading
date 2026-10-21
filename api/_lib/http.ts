// Outils HTTP communs aux fonctions Vercel du Mode Online (api/*.ts).
//
// Format « Web standard » du runtime Node.js de Vercel : chaque fichier
// api/<nom>.ts exporte `GET(request: Request): Promise<Response>` (référence
// « Functions API » de Vercel, à vérifier au déploiement). Le même code tourne en
// développement derrière le middleware de Vite (web/vite-plugins/api-dev.ts).
// Les fichiers et dossiers préfixés « _ » (api/_lib, api/_tests) ne deviennent
// pas des fonctions (à vérifier au déploiement).
//
// Règles : réponses JSON servies à la même origine que le front (aucun en-tête
// CORS) ; aucun secret dans une réponse ni dans un message d'erreur ; une
// erreur n'est jamais mise en cache par le CDN.

export const CACHE_CHART = 'public, max-age=0, s-maxage=15, stale-while-revalidate=15';
export const CACHE_INSTRUMENTS = 'public, max-age=0, s-maxage=3600';
export const NO_STORE = 'no-store';

export type Env = Record<string, string | undefined>;

/** Variables d'environnement du process (Vercel, ou .env chargé par le middleware de Vite). */
export function processEnv(): Env {
  // Sans dépendre des types de Node : le code d'api/ est aussi vérifié par le tsconfig du front.
  const p = (globalThis as { process?: { env?: Env } }).process;
  return p?.env ?? {};
}

/** Erreur de la requête elle-même (paramètre inconnu, instrument hors liste) : 400 ou 404. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Service amont en échec (OKX, Supabase) : 502. `message` est construit par
 * nous (statut HTTP, code d'erreur) et peut partir dans la réponse ; `detail`
 * ne va qu'au journal de la fonction.
 */
export class UpstreamError extends Error {
  constructor(readonly service: string, message: string, readonly detail = '') {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function json(body: unknown, cache: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...headers },
  });
}

// Formes de clés reconnaissables, masquées même si leur valeur n'est pas dans l'environnement.
const SECRET_PATTERNS = [
  /sb_(secret|publishable)_[A-Za-z0-9_-]+/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, // JWT (clés Supabase historiques)
];
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE/i;

/** Retire d'un texte toute valeur de variable secrète et toute forme de clé connue. */
export function redact(text: string, env: Env): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_NAME.test(name)) out = out.split(value).join('***');
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, '***');
  return out;
}

export function errorResponse(status: number, message: string, env: Env): Response {
  // Même forme que la passerelle FastAPI ({"detail": …}) : l'écran affiche l'une ou l'autre.
  return json({ detail: redact(message, env) }, NO_STORE, status);
}

/** Valeur reçue, réduite pour un message d'erreur (caractères de contrôle retirés, 40 au plus). */
export function clip(value: string, max = 40): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Paramètres de la requête, validés strictement : un paramètre inconnu ou
 * répété est refusé (400) plutôt qu'ignoré, pour qu'une faute de frappe ne
 * passe pas pour la valeur par défaut.
 */
export function readQuery(request: Request, allowed: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of new URL(request.url).searchParams) {
    if (!allowed.includes(key)) {
      throw new HttpError(400, allowed.length
        ? `paramètre inconnu : ${clip(key)} (attendus : ${allowed.join(', ')})`
        : `paramètre inconnu : ${clip(key)} (cette route n’en prend aucun)`);
    }
    if (out.has(key)) throw new HttpError(400, `paramètre répété : ${key}`);
    if (value === '') throw new HttpError(400, `paramètre ${key} vide`);
    out.set(key, value);
  }
  return out;
}

/**
 * Exécute une route et convertit ses erreurs en réponses JSON : 400/404 pour
 * la requête, 502 pour un service amont, 500 sinon. Le détail technique va au
 * journal de la fonction (sans secret), jamais dans la réponse.
 */
export async function respond(env: Env, route: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.status, e.message, env);
    if (e instanceof UpstreamError) {
      console.warn(redact(`${route} : ${e.service} : ${e.message}${e.detail ? ` (${e.detail})` : ''}`, env));
      return errorResponse(502, `${e.service} indisponible : ${e.message}`, env);
    }
    console.error(redact(`${route} : erreur interne : ${e instanceof Error ? e.stack ?? e.message : String(e)}`, env));
    return errorResponse(500, 'erreur interne de la fonction', env);
  }
}
