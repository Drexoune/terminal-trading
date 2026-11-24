// /api/rates/* — écran Taux (plan P2, étape R2) : lecture de l'état publié par l'Edge Function
// p2-jobs (p2_state, rate_quotes, rate_history, rate_decisions) avec la clé secrète, côté serveur.
// Données publiques seulement (marchés de prédiction, taux du BIS, calendriers et votes officiels).
//
//   GET /api/rates/state                         8 banques (état de la dernière minute), flux, décisions
//                                                et votes, contrôle de la porte (cotes de la Fed sur 30 min)
//   GET /api/rates/history?bank=&meeting=&days=  évolution des probabilités d'une réunion (60 jours au plus)
//                                                et publications américaines clés (NFP, IPC) à marquer
//
// Aucune valeur n'est calculée ici hors de l'échantillonnage des séries.

import { HttpError, json, NO_STORE, readQuery, respond } from './http.js';
import type { FetchFn } from './okx.js';
import type { Context } from './routes.js';
import { rest, supabaseConfig, type SupabaseConfig } from './supabase.js';

export const BANKS = ['FED', 'BCE', 'BOE', 'BOJ', 'BNS', 'BOC', 'RBA', 'RBNZ'] as const;
export const OUTCOMES = ['m50', 'm25', 'hold', 'p25', 'p50'] as const;
export const FEED_KEYS = ['feed:polymarket', 'feed:kalshi', 'feed:bis'] as const;
export const GATE_WINDOW_MS = 30 * 60_000;
export const HISTORY_MAX_DAYS = 60;
export const SERIES_MAX = 360;               // points par source et par issue renvoyés au front
const PAGE = 1000;
const MAX_PAGES = 15;
const DAY = 86_400_000;
const MEETING = /^\d{4}-\d{2}-\d{2}$/;
/** Publications marquées sur la courbe : titre du calendrier officiel du BLS -> libellé court. */
export const MARKED_RELEASES: Record<string, string> = { 'Employment Situation': 'NFP', 'Consumer Price Index': 'IPC' };

type Q = (table: string, params: Record<string, string>) => Promise<unknown[]>;

function query(cfg: SupabaseConfig, fetchFn: FetchFn): Q {
  return (table, params) => rest(cfg, fetchFn, 'GET', table, params, false).then((r) => r.rows);
}

/** Lecture paginée (max_rows de Supabase : 1 000 lignes par réponse). */
async function all(q: Q, table: string, params: Record<string, string>): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await q(table, { ...params, limit: String(PAGE), offset: String(page * PAGE) });
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface StateRow { key: string; value: unknown; updated_ms: number }

export async function ratesState(cfg: SupabaseConfig, fetchFn: FetchFn, now: number) {
  const q = query(cfg, fetchFn);
  const [stateRows, decisions] = await Promise.all([
    q('p2_state', { select: 'key,value,updated_ms', key: `in.(${['rates:state', 'history:last', ...FEED_KEYS].map((k) => `"${k}"`).join(',')})` }),
    q('rate_decisions', { select: 'bank,decision_date,change_bp,rate_text,vote,quote,source_url,ts_recv', order: 'decision_date.desc', limit: '80' }),
  ]);
  const byKey = new Map((stateRows as StateRow[]).map((r) => [r.key, r]));
  const st = byKey.get('rates:state');
  const value = (st?.value ?? null) as { banks?: Record<string, { next?: { date?: string } | null }> } | null;
  // Porte de P2 : une cote de la prochaine réunion de la Fed chaque minute (Polymarket et Kalshi).
  const fedNext = value?.banks?.FED?.next?.date ?? null;
  let gate = null;
  if (fedNext && MEETING.test(fedNext)) {
    const since = new Date(now - GATE_WINDOW_MS).toISOString();
    const rows = await q('rate_quotes', { select: 'source,ts', bank: 'eq.FED', meeting: `eq.${fedNext}`, ts: `gte.${since}`, order: 'ts.asc', limit: '200' }) as
      { source: string; ts: string }[];
    const count = (s: string) => rows.filter((r) => r.source === s).length;
    gate = { meeting: fedNext, window_min: GATE_WINDOW_MS / 60_000, polymarket: count('polymarket'), kalshi: count('kalshi'),
      last_ms: rows.length ? Date.parse(rows[rows.length - 1].ts) : null };
  }
  const latest: Record<string, unknown> = {};
  for (const d of decisions as { bank: string }[]) latest[d.bank] ??= d;   // ordre décroissant : la plus récente gagne
  return {
    configured: true,
    state: value, state_ms: st?.updated_ms ?? null,
    feeds: FEED_KEYS.map((k) => byKey.get(k)?.value ?? null).filter(Boolean),
    history_job: byKey.get('history:last')?.value ?? null,
    decisions: latest,
    gate,
    computed_ms: now,
  };
}

export interface Point { t: number; p: number }

/** Réduit une série à `max` points en gardant le premier et le dernier (pas régulier). */
export function thin(points: Point[], max = SERIES_MAX): Point[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

export async function ratesHistory(cfg: SupabaseConfig, fetchFn: FetchFn, now: number, bank: string, meeting: string, days: number) {
  const q = query(cfg, fetchFn);
  const since = now - days * DAY;
  const sinceIso = new Date(since).toISOString();
  const [hist, quotes, releases] = await Promise.all([
    all(q, 'rate_history', { select: 'source,outcome,t,p', bank: `eq.${bank}`, meeting: `eq.${meeting}`, t: `gte.${sinceIso}`, order: 't.asc' }),
    // Nos instantanés : la minute 0 de chaque heure, puis la dernière minute.
    all(q, 'rate_quotes', { select: 'source,ts,probs', bank: `eq.${bank}`, meeting: `eq.${meeting}`, ts: `gte.${sinceIso}`, hourly: 'is.true', order: 'ts.asc' }),
    q('official_releases', { select: 'title,local_date,utc_ms', source: 'eq.BLS', title: `in.(${Object.keys(MARKED_RELEASES).map((t) => `"${t}"`).join(',')})`,
      utc_ms: `gte.${since}`, order: 'utc_ms.asc', limit: '50' }),
  ]);
  const latest = await q('rate_quotes', { select: 'source,ts,probs', bank: `eq.${bank}`, meeting: `eq.${meeting}`, order: 'ts.desc', limit: '2' });
  const series: Record<string, Record<string, Point[]>> = {};
  const add = (source: string, outcome: string, t: number, p: number) => {
    if (!Number.isFinite(t) || !Number.isFinite(p)) return;
    ((series[source] ??= {})[outcome] ??= []).push({ t, p });
  };
  const lastHist: Record<string, number> = {};
  for (const r of hist as { source: string; outcome: string; t: string; p: number | string }[]) {
    const t = Date.parse(r.t);
    add(r.source, r.outcome, t, Number(r.p));
    lastHist[r.source] = Math.max(lastHist[r.source] ?? 0, t);
  }
  const ours = [...quotes, ...[...latest].reverse()] as { source: string; ts: string; probs: Record<string, { p?: number | null }> }[];
  const seen = new Set<string>();
  for (const r of ours) {
    const t = Date.parse(r.ts);
    if (t <= (lastHist[r.source] ?? 0) || seen.has(`${r.source}|${t}`)) continue;   // l'historique de la source passe d'abord
    seen.add(`${r.source}|${t}`);
    for (const o of OUTCOMES) { const p = r.probs?.[o]?.p; if (typeof p === 'number') add(r.source, o, t, p); }
  }
  for (const s of Object.values(series)) for (const o of Object.keys(s)) s[o] = thin(s[o].sort((a, b) => a.t - b.t));
  return {
    bank, meeting, days, series,
    markers: (releases as { title: string; local_date: string; utc_ms: number }[]).filter((r) => r.utc_ms <= now)
      .map((r) => ({ label: MARKED_RELEASES[r.title], title: r.title, date: r.local_date, t: Number(r.utc_ms), source: 'BLS' })),
    computed_ms: now,
  };
}

export function handleRates(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/rates', async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    const q = readQuery(request, ['path', 'bank', 'meeting', 'days']);
    const path = q.get('path') ?? '';
    const cfg = supabaseConfig(ctx.env);
    const now = ctx.deps.now();
    if (path === 'state') {
      if (q.has('bank') || q.has('meeting') || q.has('days')) throw new HttpError(400, 'cette route ne prend aucun paramètre');
      if (!cfg.ok) return json({ configured: false, reason: cfg.reason, state: null, feeds: [], decisions: {}, gate: null, computed_ms: now }, NO_STORE);
      return json(await ratesState(cfg.config, ctx.deps.fetch, now), NO_STORE);
    }
    if (path === 'history') {
      const bank = q.get('bank') ?? '';
      const meeting = q.get('meeting') ?? '';
      const days = Number(q.get('days') ?? HISTORY_MAX_DAYS);
      if (!(BANKS as readonly string[]).includes(bank)) throw new HttpError(400, `bank attendu parmi ${BANKS.join(', ')}`);
      if (!MEETING.test(meeting) || !Number.isFinite(Date.parse(`${meeting}T00:00:00Z`))) throw new HttpError(400, 'meeting attendu sous la forme AAAA-MM-JJ');
      if (!Number.isInteger(days) || days < 1 || days > HISTORY_MAX_DAYS) throw new HttpError(400, `days : entier de 1 à ${HISTORY_MAX_DAYS}`);
      if (!cfg.ok) throw new HttpError(503, `écran Taux non configuré : ${cfg.reason}`);
      return json(await ratesHistory(cfg.config, ctx.deps.fetch, now, bank, meeting, days), NO_STORE);
    }
    throw new HttpError(404, 'route inconnue (attendues : /api/rates/state, /api/rates/history?bank=&meeting=&days=)');
  });
}
