// Middleware de développement : sert les fonctions Vercel du Mode Online
// (api/<nom>.ts à la racine du dépôt) depuis le serveur de Vite, pour que
// `npm run dev` suffise, sans `vercel dev`.
//
// /api/<nom>  ->  GET exporté par api/<nom>.ts, chargé par ssrLoadModule (le
// module est rechargé quand le fichier change). Les modules de NESTED reçoivent
// aussi /api/<nom>/<route> (module Bourse : une seule fonction, routeur
// interne, comme la réécriture de vercel.json) et, s'ils les exportent, les
// méthodes POST et DELETE avec leur corps. La requête Node est convertie
// en Request, la Response renvoyée en réponse Node : le code des fonctions est
// exactement celui qui tourne sur Vercel.
//
// Les variables du fichier .env (envDir) sans préfixe VITE_ sont copiées dans
// process.env du serveur de Vite, comme Vercel les fournit aux fonctions
// (SUPABASE_URL, SUPABASE_SECRET_KEY…). Elles restent côté serveur : seules les
// variables VITE_ entrent dans le bundle du front.
//
// Absent du build (apply: 'serve') et inactif sous Vitest.

import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';

/**
 * Nom de route accepté : pas de « _ » initial (api/_lib, api/_tests) ; un sous-chemin pour
 * NESTED seulement, suivi au besoin d'un identifiant numérique (/api/alerts/rules/12).
 */
const ROUTE = /^\/api\/([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*)(?:\/\d{1,9})?)?\/?$/;
/** Fonctions à routeur interne (api/<nom>.ts sert /api/<nom>/<route>). */
const NESTED = new Set(['bourse', 'p1', 'alerts', 'rates', 'macro', 'sentiment']);
const BODY_METHODS = ['POST', 'DELETE', 'PATCH'];
const MAX_BODY = 64 * 1024;

type Handler = (request: Request) => Promise<Response> | Response;
type Next = (err?: unknown) => void;

export interface ApiMiddlewareOptions {
  apiDir: string;
  /** Charge un module (ssrLoadModule en développement, import direct dans les tests). */
  load(file: string): Promise<Record<string, unknown>>;
  logError(message: string): void;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

/** En-têtes Node -> Headers (les pseudo-en-têtes HTTP/2 « :authority »… sont ignorés). */
export function toHeaders(raw: IncomingMessage['headers']): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined || name.startsWith(':')) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return headers;
}

/** Requête Node -> Request. GET et HEAD sans corps (HEAD est servi par le GET). */
export function toRequest(req: IncomingMessage, signal?: AbortSignal, body?: string): Request {
  const host = req.headers.host ?? 'localhost';
  const method = req.method && BODY_METHODS.includes(req.method) ? req.method : 'GET';
  return new Request(new URL(req.url ?? '/', `http://${host}`), {
    method, headers: toHeaders(req.headers), signal, ...(method !== 'GET' && body !== undefined ? { body } : {}),
  });
}

/** Corps de la requête Node, borné à MAX_BODY octets. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('corps trop long')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Response -> réponse Node. */
export async function sendResponse(res: ServerResponse, response: Response, head = false): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  const body = new Uint8Array(await response.arrayBuffer());
  res.end(head ? undefined : body);
}

export function createApiMiddleware(opts: ApiMiddlewareOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const url = req.url ?? '';
    if (url !== '/api' && !url.startsWith('/api/') && !url.startsWith('/api?')) return next();
    const path = url.split('?')[0];
    const m = ROUTE.exec(path);
    const file = m && (!m[2] || NESTED.has(m[1])) ? join(opts.apiDir, `${m[1]}.ts`) : null;
    if (!file || !existsSync(file)) {
      sendJson(res, 404, { detail: `route inconnue : ${path.slice(0, 60)}` });
      return;
    }
    const method = req.method ?? 'GET';
    const nested = NESTED.has(m![1]);
    if (method !== 'GET' && method !== 'HEAD' && !(nested && BODY_METHODS.includes(method))) {
      sendJson(res, 405, { detail: 'méthode non autorisée (GET attendu)' }, { Allow: 'GET, HEAD' });
      return;
    }
    // Client parti : la requête est annulée (signal de la Request).
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
    try {
      const mod = await opts.load(file);
      const exported = method === 'HEAD' ? 'GET' : method;
      const handler = mod[exported] as Handler | undefined;
      if (typeof handler !== 'function') {
        sendJson(res, 405, { detail: `méthode non autorisée (aucun ${exported} exporté)` });
        return;
      }
      const body = BODY_METHODS.includes(method) ? await readBody(req) : undefined;
      const response = await handler(toRequest(req, ctl.signal, body));
      await sendResponse(res, response, req.method === 'HEAD');
    } catch (e) {
      opts.logError(`[api-dev] ${path} : ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      if (!res.headersSent) sendJson(res, 500, { detail: 'erreur interne de la fonction (voir le terminal de Vite)' });
      else res.end();
    }
  };
}

/** Copie dans process.env les variables du .env sans préfixe VITE_, sans écraser l'existant. */
function loadServerEnv(mode: string, envDir: string): void {
  const env = loadEnv(mode, envDir, '');
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('VITE_') && process.env[key] === undefined) process.env[key] = value;
  }
}

export function apiDev(options: { apiDir?: string } = {}): Plugin {
  return {
    name: 'terminal-api-dev',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return; // les tests appellent les routes directement
      const { config } = server;
      const apiDir = options.apiDir ?? resolve(config.root, '..', 'api');
      if (config.envDir !== false) loadServerEnv(config.mode, config.envDir);
      // Ajouté avant les middlewares internes : /api/* n'atteint jamais le repli SPA.
      server.middlewares.use(createApiMiddleware({
        apiDir,
        load: (file) => server.ssrLoadModule(file),
        logError: (message) => config.logger.error(message, { timestamp: true }),
      }));
    },
  };
}
