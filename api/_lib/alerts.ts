// /api/alerts/* — alertes en Mode Online (plan « Tout en ligne », O4 ; T-031, T-043).
// Toutes les routes exigent la session du mot de passe d'application (même cookie que le
// module Bourse) : les règles et l'historique des alertes sont des données personnelles.
//
//   GET    /api/alerts/state           règles, 50 dernières alertes, résumé (clés alert:… de p1_state)
//   POST   /api/alerts/rules           créer une règle            { kind, params, channels }
//   PATCH  /api/alerts/rules/<id>      état et canaux             { state?, channels?, params? }
//   DELETE /api/alerts/rules/<id>      supprimer avec son historique
//   POST   /api/alerts/ack             acquitter                  { ids? }
//   POST   /api/alerts/test-telegram   message d'essai
//
// Mêmes chemins et mêmes réponses que la passerelle du Mac (gateway/terminal_gateway/app.py) :
// l'écran /alertes ne change pas d'un mode à l'autre. Les écritures sont relayées à l'Edge
// Function p1-jobs (tâche alerts-cmd, en-tête x-jobs-secret) : validation, base et Telegram y
// restent ; le jeton Telegram n'est jamais dans Vercel.

import { sessionProblem } from './bourse/routes.js';
import { sameOriginJson } from './bourse/auth.js';
import { HttpError, json, NO_STORE, respond, type Env } from './http.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';
import type { FetchFn } from './okx.js';

export const FIRED_SHOWN = 50;
const MIN_SECRET = 32;
const CMD_TIMEOUT_MS = 25_000;   // essai Telegram : jusqu'à 3 tentatives de 10 s au pire, coupées ici

/** Route demandée : chemin d'origine (/api/alerts/rules/12) ou « path » de la réécriture. */
export function alertRoute(request: Request): { route: string; id: number | null } {
  const url = new URL(request.url);
  const m = /^\/api\/alerts\/(.+?)\/?$/.exec(url.pathname);
  const raw = m ? m[1] : url.pathname.replace(/\/$/, '') === '/api/alerts' ? url.searchParams.get('path') ?? '' : '';
  const r = /^(state|rules|ack|test-telegram)(?:\/(\d{1,9}))?$/.exec(raw);
  if (!r) return { route: '', id: null };
  return { route: r[1], id: r[2] ? Number(r[2]) : null };
}

export async function alertState(cfg: SupabaseConfig, fetchFn: FetchFn, now: number) {
  const q = (params: Record<string, string>) => rest(cfg, fetchFn, 'GET', 'p1_state', { select: 'key,value', ...params }, false);
  const [rules, fired, summary, oracle] = await Promise.all([
    q({ key: 'like.alert:rule:*', order: 'key.asc', limit: '500' }),
    q({ key: 'like.alert:fired:*', order: 'value->fired_ms.desc', limit: String(FIRED_SHOWN) }),
    q({ key: 'eq.alert:summary', limit: '1' }),
    q({ key: 'eq.alert:oracle', limit: '1' }),          // battement de cœur de la machine Oracle (T-071)
  ]);
  const items = [...rules.rows, ...fired.rows, ...summary.rows, ...oracle.rows].map((r) => {
    const row = r as { key: string; value: unknown };
    return [row.key, row.value] as [string, unknown];
  });
  return { configured: true, items, computed_ms: now };
}

/** DELETE sans corps : l'en-tête Origin, s'il est présent, doit être celui de la requête. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get('x-forwarded-host') ?? request.headers.get('host'));
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'JSON illisible');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'objet JSON attendu');
  return body as Record<string, unknown>;
}

/** Commande relayée à p1-jobs ; ses erreurs 400/404 reviennent telles quelles à l'écran. */
export async function forward(cfg: SupabaseConfig, fetchFn: FetchFn, env: Env, cmd: Record<string, unknown>): Promise<unknown> {
  const secret = env.P1_JOBS_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET) throw new HttpError(503, 'P1_JOBS_SECRET absente des variables de Vercel (même valeur que dans Supabase)');
  let r: Response;
  try {
    r = await fetchFn(`${cfg.url}/functions/v1/p1-jobs?job=alerts-cmd`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-jobs-secret': secret }, body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(CMD_TIMEOUT_MS),
    });
  } catch (e) {
    throw new HttpError(502, `moteur d’alertes injoignable : ${(e as Error).name}`);
  }
  const body = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;   // null : corps non JSON
  if (r.status === 400 || r.status === 404) throw new HttpError(r.status, String(body?.error ?? `HTTP ${r.status}`).slice(0, 300));
  if (!r.ok) throw new HttpError(502, `moteur d’alertes : HTTP ${r.status}${body?.error ? ` (${String(body.error).slice(0, 200)})` : ''}`);
  return body;
}

export function handleAlerts(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/alerts', async () => {
    const { route, id } = alertRoute(request);
    if (!route) throw new HttpError(404, 'route inconnue (attendues : state, rules, rules/<id>, ack, test-telegram)');
    const m = request.method;
    const problem = await sessionProblem(request, ctx.env, ctx.deps.now());
    if (problem) throw new HttpError(problem.status, problem.reason);
    const cfg = supabaseConfig(ctx.env);
    if (!cfg.ok) throw new HttpError(503, `non configuré : ${cfg.reason}`);
    const c = cfg.config;
    const f = ctx.deps.fetch;
    if (route === 'state') {
      if (m !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
      return json(await alertState(c, f, ctx.deps.now()), NO_STORE);
    }
    // Écritures : même origine ; corps JSON sauf pour DELETE (sans corps).
    if (m === 'DELETE') {
      if (!sameOrigin(request)) throw new HttpError(403, 'requête refusée : même origine exigée');
    } else if (!sameOriginJson(request)) {
      throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
    }
    let cmd: Record<string, unknown>;
    if (route === 'rules' && id === null && m === 'POST') {
      const b = await readJson(request);
      cmd = { op: 'create', kind: b.kind, params: b.params ?? {}, channels: b.channels ?? [] };
    } else if (route === 'rules' && id !== null && m === 'PATCH') {
      const b = await readJson(request);
      cmd = { op: 'update', id, state: b.state, channels: b.channels, params: b.params };
    } else if (route === 'rules' && id !== null && m === 'DELETE') {
      cmd = { op: 'delete', id };
    } else if (route === 'ack' && id === null && m === 'POST') {
      const b = await readJson(request);
      cmd = { op: 'ack', ids: b.ids };
    } else if (route === 'test-telegram' && id === null && m === 'POST') {
      await readJson(request);
      cmd = { op: 'test' };
    } else {
      throw new HttpError(405, `méthode ${m.slice(0, 10)} non autorisée sur ${route}`);
    }
    return json(await forward(c, f, ctx.env, cmd), NO_STORE);
  });
}
