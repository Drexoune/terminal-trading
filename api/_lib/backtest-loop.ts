// Recherche autonome de la section Backtest (étape S4, T-064), côté Vercel : création, lecture et
// arrêt d'une recherche. Les essais tournent dans bt-jobs (Supabase, tâche loop, pg_cron chaque
// minute) ; cette fonction ne lance aucun calcul et n'appelle pas Gemini.
//
//   GET  /api/backtest/loops          dernières recherches (état, progression, budget consommé)
//   GET  /api/backtest/loop?id=       une recherche et ses essais ; verdicts hors échantillon
//                                     masqués tant qu'elle n'est pas finie
//   POST /api/backtest/loop-create    plan : marchés, période, critères ou société, budget, départ
//   POST /api/backtest/loop-stop      { id } : arrêt demandé, rapport écrit au passage suivant
// Session exigée partout (code des stratégies, appels comptés) ; même origine pour les POST.

import { createBourseDb, type BourseDb } from './bourse/db.js';
import { sameOriginJson } from './bourse/auth.js';
import { sessionProblem } from './bourse/routes.js';
import { HttpError, json, NO_STORE, type Env } from './http.js';
import type { FetchFn } from './okx.js';
import type { SupabaseConfig } from './supabase.js';

export const MAX_ATTEMPTS = 200;
export const MAX_GEMINI = 40;
const MAX_BODY = 200_000;
const ACTIVE = 'in.(running,waiting,stopping)';
const FINISHED = ['done', 'stopped', 'failed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const YEAR = 365.25 * 86_400_000;

const MARKETS: Record<string, string[]> = { BTC: ['1D', '4H', '1H'], ETH: ['1D', '4H', '1H'], QQQ: ['1D'], SPY: ['1D'] };
const PERIODS: Record<string, number | null> = { all: null, '5y': 5, '3y': 3, '1y': 1 };
const FIRMS = ['ftmo2_p1', 'ftmo2_p2', 'ftmo1', 'lucid25'];
const DEFAULT_THRESHOLDS = { min_trades: 30, sharpe: 1, t_stat: 2, dsr: 0.95, max_dd_pct: 30, profit_factor: 1.3 };

export interface CreateBody {
  title?: string; goal?: string;
  markets?: { asset?: string; tf?: string }[];
  period?: string; is_share?: number;
  mode?: string; thresholds?: Record<string, unknown>; firm?: { id?: string; min_pass_rate?: number } | null; oos_min_ratio?: number;
  settings?: Record<string, unknown>;
  max_attempts?: number; max_gemini?: number; rewrite_every?: number; seed?: number;
  start?: { kind?: string; title?: string; code?: string; inputs?: Record<string, unknown>; prompt?: string };
}

const num = (v: unknown, lo: number, hi: number, name: string, dflt?: number): number => {
  const x = v === undefined || v === null ? dflt : Number(v);
  if (x === undefined || !Number.isFinite(x) || x < lo || x > hi) throw new HttpError(400, `${name} : nombre entre ${lo} et ${hi} attendu`);
  return x;
};

/** Plan validé, sans les bornes des marchés (lues dans bt_candles ensuite). */
export function validatePlan(b: CreateBody) {
  const markets = (b.markets ?? []).map((m) => ({ asset: String(m.asset ?? '').toUpperCase(), tf: String(m.tf ?? '').toUpperCase() }));
  if (!markets.length || markets.length > 4) throw new HttpError(400, 'marchés : 1 à 4');
  for (const m of markets) if (!MARKETS[m.asset]?.includes(m.tf)) throw new HttpError(400, `marché inconnu : ${m.asset} ${m.tf}`);
  if (new Set(markets.map((m) => `${m.asset}:${m.tf}`)).size !== markets.length) throw new HttpError(400, 'marché en double');
  const period = b.period ?? 'all';
  if (!(period in PERIODS)) throw new HttpError(400, `période attendue parmi ${Object.keys(PERIODS).join(', ')}`);
  const mode = b.mode === 'firm' ? 'firm' : 'thresholds';
  const t = b.thresholds ?? {};
  const thresholds = {
    min_trades: num(t.min_trades, 1, 10_000, 'trades minimum', DEFAULT_THRESHOLDS.min_trades),
    sharpe: num(t.sharpe, -5, 10, 'Sharpe', DEFAULT_THRESHOLDS.sharpe),
    t_stat: num(t.t_stat, -5, 20, 't-stat', DEFAULT_THRESHOLDS.t_stat),
    dsr: num(t.dsr, 0, 1, 'Sharpe déflaté', DEFAULT_THRESHOLDS.dsr),
    max_dd_pct: num(t.max_dd_pct, 1, 100, 'drawdown maximal', DEFAULT_THRESHOLDS.max_dd_pct),
    profit_factor: num(t.profit_factor, 0, 20, 'facteur de profit', DEFAULT_THRESHOLDS.profit_factor),
  };
  let firm: { id: string; min_pass_rate: number } | null = null;
  if (mode === 'firm') {
    if (!b.firm?.id || !FIRMS.includes(b.firm.id)) throw new HttpError(400, `société attendue parmi ${FIRMS.join(', ')}`);
    firm = { id: b.firm.id, min_pass_rate: num(b.firm.min_pass_rate, 0.01, 1, 'taux de réussite minimal', 0.5) };
  }
  const s = b.settings ?? {};
  const settings = {
    capital: num(s.capital, 100, 1e9, 'capital', 10_000), commissionPct: num(s.commissionPct, 0, 5, 'commission', 0.05),
    slippageTicks: num(s.slippageTicks, 0, 1000, 'glissement', 1), qtyPct: num(s.qtyPct, 1, 100, 'taille', 100), margin: s.margin === true,
  };
  const st = b.start ?? {};
  let start;
  if (st.kind === 'prompt') {
    const prompt = String(st.prompt ?? '').trim();
    if (!prompt) throw new HttpError(400, 'départ : description vide');
    start = { kind: 'prompt' as const, prompt: prompt.slice(0, 4000) };
  } else {
    const code = String(st.code ?? '');
    if (!/strategy\s*\(/.test(code)) throw new HttpError(400, 'départ : script avec une déclaration strategy() attendu');
    if (code.length > 50_000) throw new HttpError(400, 'départ : script trop long');
    const inputs = st.inputs && typeof st.inputs === 'object' ? st.inputs : {};
    start = { kind: 'code' as const, title: String(st.title ?? 'Stratégie').slice(0, 120), code, inputs };
  }
  const max_gemini = Math.round(num(b.max_gemini, 0, MAX_GEMINI, 'budget Gemini', 12));
  if (start.kind === 'prompt' && max_gemini < 1) throw new HttpError(400, 'départ en texte : au moins un appel à Gemini');
  return {
    title: String(b.title ?? '').trim().slice(0, 120) || (start.kind === 'code' ? start.title : 'Recherche'),
    goal: String(b.goal ?? '').slice(0, 1000), markets, period, is_share: num(b.is_share, 0.5, 0.9, 'part dans l’échantillon', 0.7),
    mode, thresholds, firm, oos_min_ratio: num(b.oos_min_ratio, 0, 1, 'ratio hors échantillon', 0.5), settings,
    max_attempts: Math.round(num(b.max_attempts, 1, MAX_ATTEMPTS, 'budget d’essais', 50)), max_gemini,
    rewrite_every: Math.round(num(b.rewrite_every, 2, 20, 'réécriture tous les', 5)),
    seed: Math.round(num(b.seed, 0, 2 ** 31 - 1, 'graine', 1 + Math.floor(Math.random() * 1e6))),
    start,
  };
}

async function bounds(db: BourseDb, asset: string, tf: string): Promise<{ first: number; last: number } | null> {
  const q = (order: string) => db.select<{ ts: string }>('bt_candles', { select: 'ts', asset: `eq.${asset}`, tf: `eq.${tf === '4H' ? '1H' : tf}`, order, limit: '1' });
  const [a, z] = await Promise.all([q('ts.asc'), q('ts.desc')]);
  if (!a[0] || !z[0]) return null;
  const first = Date.parse(a[0].ts), last = Date.parse(z[0].ts);
  // 4H agrégé depuis le 1H : dernière tranche complète seulement (sinon un rejeu verrait une barre de plus).
  const H = 3_600_000;
  return tf === '4H' ? { first, last: Math.floor((last + H) / (4 * H)) * 4 * H - 4 * H } : { first, last };
}

const LIST = 'id,created_at,updated_at,status,title,attempts,gemini_calls,best_score,best_n,verdict,note,next_run_at,finished_at,spec';
const ATTEMPT = 'n,created_at,kind,parent,title,code,inputs,change,gemini_calls,ok,error,score,is_pass,oos_pass,oos_reasons,detail,ms';

export async function handleLoop(request: Request, env: Env, fetchFn: FetchFn, cfg: SupabaseConfig, now: number, path: string): Promise<Response> {
  const problem = await sessionProblem(request, env, now);
  if (problem) throw new HttpError(problem.status, problem.reason);
  const db = createBourseDb(cfg, fetchFn);

  if (request.method === 'GET') {
    if (path === 'loops') {
      const rows = await db.select<Record<string, unknown>>('bt_loops', { select: LIST, order: 'created_at.desc', limit: '20' });
      return json({ loops: rows.map(({ spec, ...r }) => ({ ...r, max_attempts: (spec as { max_attempts?: number })?.max_attempts ?? null,
        max_gemini: (spec as { max_gemini?: number })?.max_gemini ?? null, markets: (spec as { markets?: unknown })?.markets ?? [] })), computed_ms: now }, NO_STORE);
    }
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!UUID.test(id)) throw new HttpError(400, 'id de recherche attendu');
    const [loop] = await db.select<Record<string, unknown>>('bt_loops', { select: `${LIST},report`, id: `eq.${id}`, limit: '1' });
    if (!loop) throw new HttpError(404, 'recherche introuvable');
    const attempts = await db.select<Record<string, unknown>>('bt_attempts', { select: ATTEMPT, loop_id: `eq.${id}`, order: 'n.asc' });
    const finished = FINISHED.includes(String(loop.status));
    // Hors échantillon à l'aveugle : rien ne sort tant que la recherche tourne.
    const shown = finished ? attempts : attempts.map((a) => ({ ...a, oos_pass: null, oos_reasons: null }));
    return json({ loop, attempts: shown, oos_hidden: !finished, computed_ms: now }, NO_STORE);
  }

  if (!sameOriginJson(request)) throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'plan trop long');
  let body: CreateBody & { id?: string };
  try { body = JSON.parse(raw) as CreateBody & { id?: string }; } catch { throw new HttpError(400, 'corps JSON illisible'); }

  if (path === 'loop-stop') {
    if (!UUID.test(body.id ?? '')) throw new HttpError(400, 'id de recherche attendu');
    const n = await db.update('bt_loops', { id: `eq.${body.id}`, status: ACTIVE }, { status: 'stopping', next_run_at: new Date(now).toISOString() });
    if (!n) throw new HttpError(409, 'recherche déjà finie ou introuvable');
    return json({ ok: true, id: body.id, status: 'stopping' }, NO_STORE);
  }

  const plan = validatePlan(body);
  if (await db.count('bt_loops', { status: ACTIVE })) throw new HttpError(409, 'une recherche tourne déjà : l’arrêter ou attendre sa fin');
  const markets = [];
  for (const m of plan.markets) {
    const b = await bounds(db, m.asset, m.tf);
    if (!b) throw new HttpError(409, `aucune bougie pour ${m.asset} ${m.tf} (tâche bt-jobs)`);
    const years = PERIODS[plan.period];
    const from = years ? Math.max(b.first, b.last - years * YEAR) : b.first;
    markets.push({ asset: m.asset, tf: m.tf, from, to: b.last, split: Math.round(from + plan.is_share * (b.last - from)) });
  }
  const id = crypto.randomUUID();
  const { period: _p, is_share: _s, ...rest } = plan;
  const spec = { v: 1, ...rest, markets, period: plan.period, is_share: plan.is_share };
  await db.insert('bt_loops', [{ id, title: plan.title, spec, status: 'running', next_run_at: new Date(now).toISOString() }]);
  return json({ ok: true, id, spec }, NO_STORE, 201);
}
