// /api/p1/* — P1 en Mode Online (plan « Tout en ligne », T-042) : lecture de l'état publié
// par l'Edge Function p1-jobs (table p1_state), sous les mêmes clés que le bus de la
// passerelle du Mac. Données publiques seulement (agenda, calendrier officiel, état des
// flux ; chiffres captés à l'étape O3), lues avec la clé secrète côté serveur.
//
//   GET /api/p1/state               semaine en cours, calendrier officiel, flux, chiffres captés
//                                   et réactions du BTC des 40 derniers jours, état de la capture,
//                                   titres du fil d'actus des 48 dernières heures (O6)
//   GET /api/p1/calendar?week=…     une semaine de l'archive (« AAAA-Wnn »)
//   GET /api/p1/watch               Markets Watch : watchlist hors crypto (T-051, T-052)
//   POST /api/p1/highlights         mots surlignés du fil d'actus (T-050), derrière le mot de passe
//   POST /api/p1/displayed          heure d'affichage d'un chiffre capté (porte P1), la première
//                                   seulement, dans la minute qui suit sa publication

import { HttpError, json, NO_STORE, readQuery, respond } from './http.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';
import type { FetchFn } from './okx.js';
import { sameOriginJson } from './bourse/auth.js';
import { watchState } from './watch.js';
import { sessionProblem } from './bourse/routes.js';
import { handleAssistant } from './assistant.js';

/** Mots surlignés du fil d'actus (T-050) : 1 à 200 mots ou expressions, 40 caractères au plus. */
export const HIGHLIGHT_MAX = 200;
const HIGHLIGHT_WORD = /^[\p{L}\p{N}][\p{L}\p{N} &.'’+\-/]{0,39}$/u;

export function validHighlights(body: unknown): string[] {
  const words = (body as { words?: unknown } | null)?.words;
  if (!Array.isArray(words)) throw new HttpError(400, 'words : liste de mots attendue');
  const seen = new Set<string>();
  const clean = words.map((w) => String(w).trim().replace(/\s+/g, ' '))
    .filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()));   // première graphie gardée
  if (clean.length > HIGHLIGHT_MAX) throw new HttpError(400, `${HIGHLIGHT_MAX} mots au plus`);
  const bad = clean.find((w) => !HIGHLIGHT_WORD.test(w));
  if (bad !== undefined) throw new HttpError(400, `mot refusé : « ${bad.slice(0, 40)} » (lettres, chiffres, espaces et & . ' + - / ; 40 caractères au plus)`);
  return clean;
}

async function saveHighlights(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, words: string[]) {
  const r = await fetchFn(`${cfg.url}/rest/v1/p1_state?on_conflict=key`, {
    method: 'POST',
    headers: { ...cfg.headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ key: 'news:highlight', value: { words, updated_ms: now }, updated_ms: now }]),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new HttpError(502, `Supabase indisponible : HTTP ${r.status} sur p1_state`);
  return { words, updated_ms: now };
}

export const STATE_KEYS = ['calendar:official', 'feed:calendar', 'feed:bls-calendar', 'feed:news', 'feed:toa', 'news:feeds', 'news:highlight', 'release:state', 'release:last'] as const;
/** Titres du fil d'actus (O6) relus au chargement : 48 dernières heures, 400 au plus. */
export const NEWS_MS = 48 * 3_600_000;
export const NEWS_MAX = 400;
/** Chiffres captés et réactions du BTC des 40 derniers jours (même fenêtre que la passerelle). */
export const RECENT_MS = 40 * 86_400_000;
const WEEK = /^\d{4}-W\d{2}$/;
const RELEASE_KEY = /^release:us-[a-z0-9-]+:\d{4}-(?:\d{2}|Q[1-4])(?::(?:Preliminary|Revised))?$/;
export const DISPLAY_CLOCK_MS = 60_000;   // horloge du navigateur à ±1 min de celle de la fonction
export const DISPLAY_WINDOW_MS = 60_000;  // un affichage compte s'il suit la publication de moins d'1 min

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
  const news = await rest(cfg, fetchFn, 'GET', 'p1_state', {
    select: 'key,value,updated_ms', key: 'like.news:item:*', updated_ms: `gte.${now - NEWS_MS}`, order: 'updated_ms.desc',
    limit: String(NEWS_MAX) }, false);
  // Réels de l'agenda tirés du fil d'actus (T-048) : deux semaines.
  const actuals = await rest(cfg, fetchFn, 'GET', 'p1_state', {
    select: 'key,value,updated_ms', key: 'like.calendar:actual:*', updated_ms: `gte.${now - 14 * 86_400_000}`, limit: '1000' }, false);
  const items = [...(week ? [week] : []), ...(rows as StateRow[]), ...(recent.rows as StateRow[]), ...(news.rows as StateRow[]),
    ...(actuals.rows as StateRow[])]
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

async function write(cfg: SupabaseConfig, fetchFn: FetchFn, table: string, filters: Record<string, string>, body: unknown): Promise<number> {
  const r = await fetchFn(`${cfg.url}/rest/v1/${table}?${new URLSearchParams(filters)}`, {
    method: 'PATCH',
    headers: { ...cfg.headers, 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new HttpError(502, `Supabase indisponible : HTTP ${r.status} sur ${table}`);
  const rows = await r.json() as unknown[];
  return rows.length;
}

export async function p1Displayed(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, body: unknown) {
  const b = (body ?? {}) as { key?: unknown; display_ms?: unknown };
  if (typeof b.key !== 'string' || !RELEASE_KEY.test(b.key)) throw new HttpError(400, 'key : clé de chiffre capté attendue (release:us-…)');
  if (typeof b.display_ms !== 'number' || !Number.isFinite(b.display_ms)) throw new HttpError(400, 'display_ms : nombre attendu');
  const display = Math.round(b.display_ms);
  if (Math.abs(display - now) > DISPLAY_CLOCK_MS) throw new HttpError(400, 'display_ms trop éloigné de l’heure de la fonction');
  const { rows } = await rest(cfg, fetchFn, 'GET', 'p1_state', { select: 'value', key: `eq.${b.key}`, limit: '1' }, false);
  const v = (rows[0] as { value?: Record<string, unknown> } | undefined)?.value;
  if (!v) throw new HttpError(404, `chiffre inconnu : ${b.key}`);
  if (typeof v.display_ms === 'number') return { ok: false, already: true, display_ms: v.display_ms };
  if (typeof v.bus_ms !== 'number' || display - v.bus_ms > DISPLAY_WINDOW_MS) {
    return { ok: false, reason: 'affiché plus d’une minute après la publication : ne compte pas pour la porte' };
  }
  const scheduled = v.scheduled_ms as number;
  const fb = v.first_byte_ms as number | null;
  const value = { ...v, display_ms: display, display_delay_ms: display - scheduled,
    display_after_capture_ms: typeof fb === 'number' ? display - fb : null };
  // Première heure seulement : la ligne n'est modifiée que si display_ms y est encore absent.
  const n = await write(cfg, fetchFn, 'p1_state', { key: `eq.${b.key}`, 'value->>display_ms': 'is.null' }, { value, updated_ms: now });
  if (!n) return { ok: false, already: true };
  await write(cfg, fetchFn, 'release_timings', { release: `eq.${v.release}`, period: `eq.${v.period}`, edition: `eq.${v.edition ?? ''}`, display_ms: 'is.null' }, { display_ms: display });
  return { ok: true, display_delay_ms: value.display_delay_ms, display_after_capture_ms: value.display_after_capture_ms };
}

export function handleP1(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/p1', async () => {
    const q = readQuery(request, ['path', 'week']);
    const path = q.get('path') ?? '';
    const cfg = supabaseConfig(ctx.env);
    if (path === 'displayed') {
      if (request.method !== 'POST') throw new HttpError(405, 'méthode non autorisée : POST attendu');
      if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) throw new HttpError(415, 'corps JSON attendu');
      if (!cfg.ok) throw new HttpError(503, `non configuré : ${cfg.reason}`);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new HttpError(400, 'JSON illisible');
      }
      return json(await p1Displayed(cfg.config, ctx.deps.fetch, ctx.deps.now(), body), NO_STORE);
    }
    if (path === 'highlights') {
      // Écriture derrière le mot de passe d'application (T-031) ; la lecture passe par /state.
      if (request.method !== 'POST') throw new HttpError(405, 'méthode non autorisée : POST attendu');
      if (!sameOriginJson(request)) throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
      const problem = await sessionProblem(request, ctx.env, ctx.deps.now());
      if (problem) throw new HttpError(problem.status, problem.reason);
      if (!cfg.ok) throw new HttpError(503, `non configuré : ${cfg.reason}`);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new HttpError(400, 'JSON illisible');
      }
      return json(await saveHighlights(cfg.config, ctx.deps.fetch, ctx.deps.now(), validHighlights(body)), NO_STORE);
    }
    if (path === 'assistant' || path === 'translate') {
      // Assistant de P6 (T-074) : session, plafond par usage, contrôle des nombres.
      if (request.method !== 'POST') throw new HttpError(405, 'méthode non autorisée : POST attendu');
      if (!cfg.ok) throw new HttpError(503, `non configuré : ${cfg.reason}`);
      return handleAssistant(request, ctx.env, ctx.deps.fetch, cfg.config, ctx.deps.now(), path === 'assistant' ? 'ask' : 'translate');
    }
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    if (path === 'state') {
      if (q.has('week')) throw new HttpError(400, 'paramètre inconnu : week (cette route n’en prend aucun)');
      if (!cfg.ok) return json({ configured: false, reason: cfg.reason, items: [], computed_ms: ctx.deps.now() }, NO_STORE);
      return json(await p1State(cfg.config, ctx.deps.fetch, ctx.deps.now()), NO_STORE);
    }
    if (path === 'watch') {
      if (q.has('week')) throw new HttpError(400, 'paramètre inconnu : week (cette route n’en prend aucun)');
      if (!cfg.ok) return json({ configured: false, reason: cfg.reason, assets: [], computed_ms: ctx.deps.now() }, NO_STORE);
      return json(await watchState(cfg.config, ctx.deps.fetch, ctx.deps.now()), NO_STORE);
    }
    if (path === 'calendar') {
      const week = q.get('week');
      if (!week || !WEEK.test(week)) throw new HttpError(400, 'paramètre week attendu sous la forme AAAA-Wnn');
      if (!cfg.ok) throw new HttpError(503, `agenda en ligne non configuré : ${cfg.reason}`);
      return json(await p1Week(cfg.config, ctx.deps.fetch, week), NO_STORE);
    }
    throw new HttpError(404, 'route inconnue (attendues : /api/p1/state, /api/p1/watch, /api/p1/calendar?week=)');
  });
}
