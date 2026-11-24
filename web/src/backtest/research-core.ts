// Cœur de la recherche autonome (section Backtest, S4, T-064) : évaluation d'une variante sur les
// marchés d'un plan (moteur PineTS, mesures, coupure dans / hors échantillon, sociétés de
// financement) et rejeu complet d'une recherche. Point d'entrée du paquet de bt-jobs :
// web/scripts/build-research-core.mjs le regroupe, PineTS et Gemini compris, dans
// supabase/functions/bt-jobs/research-core.gen.js. L'écran l'importe pour rejouer un rapport.

import { runStrategy, scriptInputs, type RunError } from './engine';
import { barsPerYear, computeMetrics, trialStats, type Candle, type OpenTrade, type Trade } from './metrics';
import { firmInput, firms, rollingStarts, splitSample, type FirmRules } from './diagnostics';
import {
  criteria, oosCheck, scoreOf, summarize, fingerprint, numericInputs,
  type AttemptRow, type LoopSpec, type MarketEval, type MarketSpec,
} from './research';

export * from './research';
export { runStrategy, scriptInputs } from './engine';
export { callGemini, GeminiError, GEMINI, MODEL, DAILY_CALLS, parisDay } from '../../../api/_lib/gemini-pine';

export interface MarketData { asset: string; tf: string; candles: Candle[]; splitBar: number }
export interface Cols { t: number[] | null; o: number[] | null; h: number[] | null; l: number[] | null; c: number[] | null }

/** Bougies d'un marché du plan : bornes [from, to] fixées à la création (rejouable), coupure à `split`. */
export function sliceMarket(m: MarketSpec, cols: Cols): MarketData {
  const candles: Candle[] = [];
  const n = Math.min(cols.t?.length ?? 0, cols.o?.length ?? 0, cols.h?.length ?? 0, cols.l?.length ?? 0, cols.c?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const t = Number(cols.t![i]);
    if (t >= m.from && t <= m.to) candles.push({ t, o: cols.o![i], h: cols.h![i], l: cols.l![i], c: cols.c![i] });
  }
  let splitBar = candles.findIndex((c) => c.t >= m.split);
  if (splitBar < 0) splitBar = candles.length;
  return { asset: m.asset, tf: m.tf, candles, splitBar };
}

export type Evaluation =
  | { ok: true; ms: number; per: MarketEval[]; score: number; is_pass: boolean; oos_pass: boolean; oos_reasons: string[]; sr_bars: (number | null)[] }
  | { ok: false; ms: number; error: string; line: number | null };

/** Taux de réussite des évaluations d'une société (départs mensuels) sur les barres [lo, hi). */
function firmRate(rules: FirmRules, candles: Candle[], equity: number[], trades: Trade[], open: OpenTrade[], capital: number, lo: number, hi: number): number | null {
  if (hi - lo < 2) return null;
  const step = candles.length > 1 ? candles[1].t - candles[0].t : 86_400_000;
  const shift = <T extends { entry_bar: number }>(x: T): T => ({ ...x, entry_bar: x.entry_bar - lo, ...('exit_bar' in x ? { exit_bar: (x as unknown as Trade).exit_bar - lo } : {}) });
  const tr = trades.filter((t) => t.entry_bar >= lo && t.entry_bar < hi).map(shift);
  const op = open.filter((o) => o.entry_bar >= lo && o.entry_bar < hi).map(shift);
  const fi = firmInput(candles.slice(lo, hi).map((c) => c.t), step, equity.slice(lo, hi), tr, op, capital);
  const rs = rollingStarts(rules, fi);
  return rs.starts ? Math.round((rs.passed / rs.starts) * 1e6) / 1e6 : null;
}

/**
 * Évalue une variante sur chaque marché. `prior[i]` : Sharpe par barre (dans l'échantillon) des
 * essais précédents sur le marché i, pour le Sharpe déflaté (N = essais de la recherche).
 */
export async function evaluate(code: string, inputs: Record<string, unknown>, data: MarketData[], spec: LoopSpec, prior: (number | null)[][],
  now: () => number = () => performance.now()): Promise<Evaluation> {
  const t0 = now();
  const per: MarketEval[] = [], srs: (number | null)[] = [], reasons: string[] = [];
  const rules = spec.mode === 'firm' && spec.firm ? firms().find((f) => f.id === spec.firm!.id) ?? null : null;
  const capital = spec.settings.capital;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const r = await runStrategy(code, d.candles, d.tf, spec.settings, inputs, now);
    if (!r.ok) return { ok: false, ms: Math.round(now() - t0), error: (r as RunError).error, line: (r as RunError).line };
    const bpy = barsPerYear(d.asset, d.tf);
    const full = computeMetrics(d.candles, r.trades, r.open, capital, bpy);
    const sp0 = splitSample(r.trades, full.equity, d.splitBar, capital, bpy);
    if (!sp0) return { ok: false, ms: Math.round(now() - t0), error: `coupure impossible sur ${d.asset} ${d.tf} (${d.candles.length} bougies)`, line: null };
    const sr = sp0.is.sharpe_bar;
    const trials = trialStats([...(prior[i] ?? []), sr].filter((x): x is number => x !== null && Number.isFinite(x)));
    const sp = splitSample(r.trades, full.equity, d.splitBar, capital, bpy, trials)!;
    let fr: number | null = null, frOos: number | null = null;
    if (rules) {
      fr = firmRate(rules, d.candles, full.equity, r.trades, r.open, capital, 0, d.splitBar);
      frOos = firmRate(rules, d.candles, full.equity, r.trades, r.open, capital, d.splitBar, d.candles.length);
    }
    const cs = criteria(sp.is, spec, fr);
    per.push({ asset: d.asset, tf: d.tf, score: scoreOf(cs), criteria: cs, is: summarize(sp.is), firm_rate: fr });
    srs.push(sr === null ? null : Math.round(sr * 1e12) / 1e12);
    const why = oosCheck(sp.is, sp.oos, spec.oos_min_ratio, rules ? { is: fr, oos: frOos, target: spec.firm!.min_pass_rate } : null);
    reasons.push(...why.map((w) => `${d.asset} ${d.tf} : ${w}`));
  }
  const score = Math.round((per.reduce((s, p) => s + p.score, 0) / per.length) * 1e6) / 1e6;
  return { ok: true, ms: Math.round(now() - t0), per, score, is_pass: per.every((p) => p.criteria.every((c) => c.pass)), oos_pass: reasons.length === 0,
    oos_reasons: reasons, sr_bars: srs };
}

/** Le script a-t-il des paramètres numériques à faire varier ? */
export function hasNumericInputs(code: string | null): boolean {
  if (!code) return false;
  const m = scriptInputs(code);
  return Array.isArray(m) && numericInputs(m).length > 0;
}

export interface Replayed { n: number; ok: boolean; score: number | null; is_pass: boolean; oos_pass: boolean | null; same: boolean }

/**
 * Rejoue une recherche : chaque essai réévalué dans l'ordre (mêmes bougies, mêmes réglages, même N
 * pour le Sharpe déflaté). Renvoie l'empreinte recalculée et les essais qui diffèrent.
 */
export async function replay(spec: LoopSpec, attempts: AttemptRow[], data: MarketData[], onStep?: (k: number) => Promise<void> | void):
  Promise<{ fingerprint: string; rows: Replayed[]; differs: number[] }> {
  const prior: (number | null)[][] = data.map(() => []);
  const rows: Replayed[] = [];
  const again: Pick<AttemptRow, 'n' | 'code' | 'inputs' | 'ok' | 'score' | 'is_pass' | 'oos_pass'>[] = [];
  for (const a of attempts) {
    let r: Replayed;
    if (!a.code) r = { n: a.n, ok: false, score: null, is_pass: false, oos_pass: null, same: !a.ok };
    else {
      const e = await evaluate(a.code, a.inputs, data, spec, prior);
      if (e.ok) {
        e.sr_bars.forEach((s, i) => prior[i].push(s));
        const oos = e.is_pass ? e.oos_pass : null;
        r = { n: a.n, ok: true, score: e.score, is_pass: e.is_pass, oos_pass: oos,
          same: a.ok && a.score !== null && Math.abs(a.score - e.score) < 1e-4 && a.is_pass === e.is_pass && a.oos_pass === oos };
      } else r = { n: a.n, ok: false, score: null, is_pass: false, oos_pass: null, same: !a.ok };
    }
    rows.push(r);
    again.push({ n: a.n, code: a.code, inputs: a.inputs, ok: r.ok, score: r.score, is_pass: r.is_pass, oos_pass: r.oos_pass });
    await onStep?.(rows.length);
  }
  return { fingerprint: fingerprint(again), rows, differs: rows.filter((r) => !r.same).map((r) => r.n) };
}
