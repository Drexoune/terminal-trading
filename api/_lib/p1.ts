// /api/p1/* — P1 en Mode Online (plan « Tout en ligne », T-042) : lecture de l'état publié
// par l'Edge Function p1-jobs (table p1_state), sous les mêmes clés que le bus de la
// passerelle du Mac. Données publiques seulement (agenda, calendrier officiel, état des
// flux ; chiffres captés à l'étape O3), lues avec la clé secrète côté serveur.
//
//   GET /api/p1/state               semaine en cours, calendrier officiel, flux, chiffres captés
//                                   et réactions du BTC des 40 derniers jours, état de la capture
//   GET /api/p1/calendar?week=…     une semaine de l'archive (« AAAA-Wnn »)

import { HttpError, json, NO_STORE, readQuery, respond } from './http.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';
import type { FetchFn } from './okx.js';

export const STATE_KEYS = ['calendar:official', 'feed:calendar', 'feed:bls-calendar', 'release:state', 'release:last'] as const;
/** Chiffres captés et réactions du BTC des 40 derniers jours (même fenêtre que la passerelle). */
export const RECENT_MS = 40 * 86_400_000;
const WEEK = /^\d{4}-W\d{2}$/;

interface StateRow { key: string; value: unknown; updated_ms: number }

async function latestWeek(cfg: SupabaseConfig, fetchFn: FetchFn): Promise<StateRow | null> {
  const { rows } = await rest(cfg, fetchFn, 'GET', 'p1_state',
    { select: 'key,value,updated_ms', key: 'like.calendar:week:*', order: 'key.desc', limit: '1' }, false);
  return (rows[0] as StateRow | undefined) ?? null;
}

export async function p1State(cfg: SupabaseConfig, fetchFn: FetchFn, now: number) {
  const week = await latestWeek(cfg, fetchFn);
  const { rows } = await rest(cfg, fetchFn, 'GET', 'p1_state',
    { select: 'key,value,updated_ms', key: `in.(${STATE_KEYS.map((k) => `"${k}"`).join(',')})` }, false);
  const recent = await rest(cfg, fetchFn, 'GET', 'p1_state', {
    select: 'key,value,updated_ms', or: '(key.like.release:us-*,key.like.reaction:*)', updated_ms: `gte.${now - RECENT_MS}`,
    order: 'key.asc', limit: '400' }, false);
  const items = [...(week ? [week] : []), ...(rows as StateRow[]), ...(recent.rows as StateRow[])]
    .map((r) => [r.key, r.value] as [string, unknown]);
  return { configured: true, items, computed_ms: now };
}

export async function p1Week(cfg: SupabaseConfig, fetchFn: FetchFn, week: string) {
  const { rows } = await rest(cfg, fetchFn, 'GET', 'p1_state',
    { select: 'key,value', key: `eq.calendar:week:${week}`, limit: '1' }, false);
  const row = rows[0] as StateRow | undefined;
  if (!row) throw new HttpError(404, `semaine ${week} absente de l’archive en ligne`);
  const latest = await latestWeek(cfg, fetchFn);
  // Une semaine enregistrée comme « en cours » devient une archive quand une plus récente existe.
  return { ...(row.value as Record<string, unknown>), archive: latest?.key !== row.key };
}

export function handleP1(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/p1', async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    const q = readQuery(request, ['path', 'week']);
    const path = q.get('path') ?? '';
    const cfg = supabaseConfig(ctx.env);
    if (path === 'state') {
      if (q.has('week')) throw new HttpError(400, 'paramètre inconnu : week (cette route n’en prend aucun)');
      if (!cfg.ok) return json({ configured: false, reason: cfg.reason, items: [], computed_ms: ctx.deps.now() }, NO_STORE);
      return json(await p1State(cfg.config, ctx.deps.fetch, ctx.deps.now()), NO_STORE);
    }
    if (path === 'calendar') {
      const week = q.get('week');
      if (!week || !WEEK.test(week)) throw new HttpError(400, 'paramètre week attendu sous la forme AAAA-Wnn');
      if (!cfg.ok) throw new HttpError(503, `agenda en ligne non configuré : ${cfg.reason}`);
      return json(await p1Week(cfg.config, ctx.deps.fetch, week), NO_STORE);
    }
    throw new HttpError(404, 'route inconnue (attendues : /api/p1/state, /api/p1/calendar?week=)');
  });
}
