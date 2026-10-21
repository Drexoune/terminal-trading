// Routes /api/* du Mode Online. Chaque fichier api/<nom>.ts se contente
// d'appeler ici la route avec le contexte réel ; les tests passent un contexte
// simulé (fetch, horloges, environnement).
//
// Une instance de fonction peut servir plusieurs requêtes (Vercel « Fluid
// compute », à vérifier au déploiement) : le client OKX (espacement des appels)
// et le cache des graphiques sont donc partagés au niveau du module.

import { buildChart, ChartCache, isRange } from './chart.js';
import {
  CACHE_CHART, CACHE_INSTRUMENTS, clip, HttpError, json, NO_STORE, processEnv, readQuery, respond,
  type Env,
} from './http.js';
import { ALLOWED_INSTRUMENTS, OkxRest, realOkxDeps, type OkxDeps } from './okx.js';
import { collectorHealth, notConfigured, supabaseConfig } from './supabase.js';

export const APP_NAME = 'TERMINAL';
export const DEFAULT_INST = 'BTC-USDT-SWAP';
export const DEFAULT_RANGE = '1D';

export interface Context {
  env: Env;
  deps: OkxDeps;     // fetch, heure murale, horloge monotone, attente
  okx: OkxRest;
  charts: ChartCache;
}

export function createContext(deps: OkxDeps, env: Env): Context {
  return { env, deps, okx: new OkxRest(deps), charts: new ChartCache() };
}

let shared: { okx: OkxRest; charts: ChartCache } | null = null;

/** Contexte réel : environnement lu à chaque requête, client OKX et cache partagés. */
export function defaultContext(): Context {
  shared ??= { okx: new OkxRest(realOkxDeps), charts: new ChartCache() };
  return { env: processEnv(), deps: realOkxDeps, ...shared };
}

/**
 * Instrument de la liste blanche, sinon 404. Même statut et même texte que la
 * passerelle (qui l'entoure en plus des guillemets de KeyError).
 */
function allowedInstrument(inst: string): string {
  if (!ALLOWED_INSTRUMENTS.includes(inst)) throw new HttpError(404, `instrument non suivi : ${clip(inst)}`);
  return inst;
}

/** GET /api/chart?inst=BTC-USDT-SWAP&range=1D|5D|1M — même JSON que la passerelle. */
export function handleChart(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/chart', async () => {
    const q = readQuery(request, ['inst', 'range']);
    const inst = allowedInstrument(q.get('inst') ?? DEFAULT_INST);
    const range = q.get('range') ?? DEFAULT_RANGE;
    if (!isRange(range)) throw new HttpError(404, `période inconnue : ${clip(range)}`);
    const chart = await ctx.charts.get(`${inst}|${range}`, ctx.deps.monotonic(),
      () => buildChart(ctx.okx, inst, range, ctx.deps.now));
    return json(chart, CACHE_CHART);
  });
}

/** GET /api/instruments?inst= — paramètres de contrat lus sur OKX. */
export function handleInstruments(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/instruments', async () => {
    const q = readQuery(request, ['inst']);
    const raw = q.get('inst');
    if (raw === undefined) throw new HttpError(400, 'paramètre inst manquant');
    return json(await ctx.okx.instrument(allowedInstrument(raw)), CACHE_INSTRUMENTS);
  });
}

/** GET /api/okx-time — heure OKX, heure de la fonction, aller-retour. Jamais mis en cache. */
export function handleOkxTime(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/okx-time', async () => {
    readQuery(request, []);
    return json(await ctx.okx.time(), NO_STORE);
  });
}

/** GET /api/health — réponse immédiate, sans appel extérieur. */
export function handleHealth(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/health', async () => {
    readQuery(request, []);
    return json({
      app: APP_NAME, mode: 'online',
      // VERCEL vaut « 1 » sur la plateforme ; sinon, middleware de Vite en développement.
      host: ctx.env.VERCEL ? 'vercel' : 'vite-dev',
      region: 'eea',
      // Région réelle de la fonction (cdg1 attendu, vercel.json) : contrôle du déploiement.
      fn_region: ctx.env.VERCEL_REGION ?? null,
      ts: ctx.deps.now(),
    }, NO_STORE);
  });
}

/** GET /api/collector-health — journal du collecteur Supabase ; configured: false sans variables. */
export function handleCollectorHealth(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/collector-health', async () => {
    readQuery(request, []);
    const cfg = supabaseConfig(ctx.env);
    if (!cfg.ok) return json(notConfigured(cfg.reason), NO_STORE);
    return json(await collectorHealth(cfg.config, ctx.deps.fetch, ctx.deps.now(), ctx.env), NO_STORE);
  });
}
