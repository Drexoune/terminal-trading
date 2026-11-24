// Recherche autonome (section Backtest, étape S4, T-064) : logique pure de la boucle, sans moteur.
// Partagée par l'écran (formulaire, rapport) et par bt-jobs (Supabase), qui la reçoit regroupée
// avec le moteur dans research-core.gen.js.
//
// - Essai : une variante (code Pine + valeurs des input.*) évaluée sur chaque marché du plan.
// - Note partielle : chaque critère rapporte un crédit de 0 à 1 (1 = seuil tenu) ; la note d'un
//   essai est la moyenne des crédits, sur 100, moyennée sur les marchés. Seuls les chiffres dans
//   l'échantillon servent à la note et à l'IA.
// - Hors échantillon à l'aveugle : consulté seulement pour un essai qui passe tous les critères
//   dans l'échantillon, réduit à réussi / échoué, et montré seulement quand la recherche est finie.
// - Hybride (T-064) : Gemini réécrit la logique tous les `rewrite_every` essais ; entre deux, la
//   boucle fait varier les paramètres numériques du meilleur essai, sans IA, avec une graine fixe.

import { rng } from './diagnostics';
import type { Settings, ScriptInput } from './engine';
import type { FirmId } from './diagnostics';
import type { Metrics } from './metrics';

export const ENGINE = 'pinets 0.13.1';
export const OOS_MIN_TRADES = 5;

export interface MarketSpec { asset: string; tf: string; from: number; to: number; split: number }
export interface Thresholds { min_trades: number; sharpe: number; t_stat: number; dsr: number; max_dd_pct: number; profit_factor: number }
export const DEFAULT_THRESHOLDS: Thresholds = { min_trades: 30, sharpe: 1, t_stat: 2, dsr: 0.95, max_dd_pct: 30, profit_factor: 1.3 };

export type LoopStart =
  | { kind: 'code'; title: string; code: string; inputs: Record<string, unknown> }
  | { kind: 'prompt'; prompt: string };

export interface LoopSpec {
  v: 1;
  title: string;
  markets: MarketSpec[];
  mode: 'thresholds' | 'firm';
  thresholds: Thresholds;
  firm: { id: FirmId; min_pass_rate: number } | null;   // taux de réussite des départs mensuels (0 à 1)
  oos_min_ratio: number;                                 // Sharpe hors échantillon ≥ ratio × Sharpe dans l'échantillon
  settings: Settings;
  max_attempts: number;
  max_gemini: number;
  rewrite_every: number;
  seed: number;
  start: LoopStart;
  goal: string;
}

// --- Critères et note partielle --------------------------------------------------------------------

export interface Criterion { key: string; label: string; value: number | null; target: number; dir: 'min' | 'max'; credit: number; pass: boolean }

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function credit(value: number | null, target: number, dir: 'min' | 'max'): number {
  if (value === null || !Number.isFinite(value)) return 0;
  if (dir === 'max') return value <= target ? 1 : target > 0 ? r6(target / value) : 0;
  if (value >= target) return 1;
  if (target <= 0 || value <= 0) return 0;
  return r6(value / target);
}

/** Facteur de profit sans perte : plafonné à 99 (la mesure n'existe pas, le critère est tenu). */
const pf = (m: Pick<Metrics, 'profit_factor' | 'gross_win'>) => m.profit_factor ?? (m.gross_win > 0 ? 99 : null);

export function criteria(m: Metrics, spec: Pick<LoopSpec, 'mode' | 'thresholds' | 'firm'>, firmRate: number | null = null): Criterion[] {
  const t = spec.thresholds;
  const c = (key: string, label: string, value: number | null, target: number, dir: 'min' | 'max'): Criterion => {
    const cr = credit(value, target, dir);
    return { key, label, value: value === null ? null : r6(value), target, dir, credit: cr, pass: cr >= 1 };
  };
  const trades = c('min_trades', 'Trades', m.trades, t.min_trades, 'min');
  if (spec.mode === 'firm' && spec.firm) {
    return [trades, c('firm_rate', 'Évaluations réussies', firmRate, spec.firm.min_pass_rate, 'min'),
      c('max_dd_pct', 'Drawdown maximal (%)', m.max_dd_pct, t.max_dd_pct, 'max')];
  }
  return [
    trades,
    c('sharpe', 'Sharpe', m.sharpe, t.sharpe, 'min'),
    c('t_stat', 't-stat', m.t_stat, t.t_stat, 'min'),
    c('dsr', 'Sharpe déflaté', m.dsr, t.dsr, 'min'),
    c('max_dd_pct', 'Drawdown maximal (%)', m.max_dd_pct, t.max_dd_pct, 'max'),
    c('profit_factor', 'Facteur de profit', pf(m), t.profit_factor, 'min'),
  ];
}

export const scoreOf = (cs: Criterion[]) => (cs.length ? r6((cs.reduce((s, x) => s + x.credit, 0) / cs.length) * 100) : 0);

/** Contrôle hors échantillon d'un marché : réussi ou échoué, avec les raisons (gardées jusqu'à la fin). */
export function oosCheck(is: Metrics, oos: Metrics, ratio: number, firm: { is: number | null; oos: number | null; target: number } | null = null): string[] {
  const why: string[] = [];
  if (oos.trades < OOS_MIN_TRADES) why.push(`moins de ${OOS_MIN_TRADES} trades`);
  if (!(oos.total_pnl > 0)) why.push('PnL négatif ou nul');
  if (firm) {
    if (firm.oos === null || firm.oos < firm.target * ratio) why.push('évaluations réussies sous le seuil');
  } else if (oos.sharpe === null || is.sharpe === null || oos.sharpe < ratio * is.sharpe) {
    why.push('Sharpe sous le seuil');
  }
  return why;
}

/** Résumé compact des mesures d'un segment (stocké, montré, transmis à l'IA pour l'échantillon). */
export interface Summary { trades: number; winrate: number | null; total_pnl_pct: number; sharpe: number | null; t_stat: number | null; dsr: number | null;
  max_dd_pct: number; profit_factor: number | null; rr: number | null; ex_ret_pct: number | null; trials: number }
export function summarize(m: Metrics): Summary {
  const o = (x: number | null) => (x === null || !Number.isFinite(x) ? null : r6(x));
  return { trades: m.trades, winrate: o(m.winrate), total_pnl_pct: r6(m.total_pnl_pct), sharpe: o(m.sharpe), t_stat: o(m.t_stat), dsr: o(m.dsr),
    max_dd_pct: r6(m.max_dd_pct), profit_factor: o(m.profit_factor), rr: o(m.rr), ex_ret_pct: o(m.ex_ret_pct), trials: m.trials };
}

// --- Variantes ------------------------------------------------------------------------------------

/** Empreinte FNV-1a sur 32 bits (stable d'un moteur JavaScript à l'autre). */
export function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const canon = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
export const variantOf = (code: string, inputs: Record<string, unknown>) => fnv(`${code}\u0000${canon(inputs)}`);

export const numericInputs = (meta: ScriptInput[]) =>
  meta.filter((p) => !p.options && typeof p.value === 'number' && /int|float/.test(p.type));

/** Une variante voisine : un ou deux paramètres numériques déplacés de ±40 % au plus, bornes tenues. */
export function mutateInputs(meta: ScriptInput[], current: Record<string, unknown>, rnd: () => number): Record<string, unknown> {
  const nums = numericInputs(meta);
  if (!nums.length) return { ...current };
  const out = { ...current };
  const k = Math.min(nums.length, rnd() < 0.4 ? 2 : 1);
  const pool = [...nums];
  for (let j = 0; j < k; j++) {
    const p = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const isInt = p.type.includes('int');
    const base = Number(out[p.id] ?? p.value);
    const step = p.step ?? (isInt ? 1 : 0.1);
    let v: number;
    if (Math.abs(base) < 1e-9) v = step * (1 + Math.floor(rnd() * 3));
    else v = base * (1 + (rnd() * 0.8 - 0.4));
    if (isInt) {
      v = Math.round(v);
      if (v === base) v = base + (rnd() < 0.5 ? -1 : 1);
    } else {
      v = p.step ? Math.round(v / p.step) * p.step : Math.round(v * 100) / 100;
      v = r6(v);
    }
    if (p.min !== undefined) v = Math.max(p.min, v);
    if (p.max !== undefined) v = Math.min(p.max, v);
    if (base > 0 && v <= 0) v = isInt ? 1 : r6(base / 2);
    out[p.id] = v;
  }
  return out;
}

/** Graine d'un essai : la même pour un même plan et un même rang. */
export const attemptRng = (seed: number, n: number) => rng((Math.imul(seed >>> 0, 2654435761) ^ n) >>> 0);

// --- Essais et choix du suivant ----------------------------------------------------------------------

export interface MarketEval { asset: string; tf: string; score: number; criteria: Criterion[]; is: Summary; firm_rate: number | null }
export interface AttemptRow {
  n: number; kind: 'start' | 'generate' | 'rewrite' | 'params'; parent: number | null;
  title: string | null; code: string | null; inputs: Record<string, unknown>; change: string | null;
  gemini_calls: number; ok: boolean; error: string | null;
  score: number | null; is_pass: boolean; oos_pass: boolean | null;
  detail: MarketEval[] | null; sr_bars: (number | null)[] | null; ms: number | null;
}

export type Action =
  | { kind: 'start' } | { kind: 'generate' }
  | { kind: 'rewrite'; parent: number } | { kind: 'params'; parent: number }
  | { kind: 'finish'; reason: string };

/** Meilleur essai valable : note la plus haute, le plus ancien à égalité. */
export function bestAttempt(attempts: AttemptRow[]): AttemptRow | null {
  let best: AttemptRow | null = null;
  for (const a of attempts) if (a.ok && a.score !== null && (!best || a.score > (best.score ?? -1))) best = a;
  return best;
}

export function nextAction(spec: LoopSpec, attempts: AttemptRow[], geminiUsed: number, hasParams: (a: AttemptRow) => boolean): Action {
  const n = attempts.length + 1;
  if (attempts.length >= spec.max_attempts) return { kind: 'finish', reason: `budget de ${spec.max_attempts} essais atteint` };
  const canGemini = geminiUsed < spec.max_gemini;
  if (n === 1) {
    if (spec.start.kind === 'code') return { kind: 'start' };
    return canGemini ? { kind: 'generate' } : { kind: 'finish', reason: 'budget Gemini nul : aucune stratégie de départ' };
  }
  const best = bestAttempt(attempts);
  if (!best) {
    if (canGemini) return spec.start.kind === 'prompt' ? { kind: 'generate' } : { kind: 'finish', reason: 'la stratégie de départ ne s’exécute pas' };
    return { kind: 'finish', reason: 'aucun essai valable et budget Gemini épuisé' };
  }
  if ((n - 1) % spec.rewrite_every === 0 && canGemini) return { kind: 'rewrite', parent: best.n };
  if (hasParams(best)) return { kind: 'params', parent: best.n };
  if (canGemini) return { kind: 'rewrite', parent: best.n };
  return { kind: 'finish', reason: 'aucun paramètre numérique à faire varier et budget Gemini épuisé' };
}

// --- Demande de réécriture ------------------------------------------------------------------------

const fmtC = (c: Criterion) => `${c.label}: ${c.value === null ? 'n/a' : c.value} (target ${c.dir === 'min' ? '>=' : '<='} ${c.target}, credit ${c.credit})`;

/** Demande envoyée à Gemini : meilleur essai, critères dans l'échantillon, historique court. Jamais le hors échantillon. */
export function evolvePrompt(spec: LoopSpec, parent: AttemptRow, history: AttemptRow[]): string {
  const markets = spec.markets.map((m) => `${m.asset} ${m.tf}`).join(', ');
  const per = (parent.detail ?? []).map((d) => `- ${d.asset} ${d.tf} (score ${d.score}/100):\n${d.criteria.map((c) => `    ${fmtC(c)}`).join('\n')}`).join('\n');
  const hist = history.slice(-8).map((a) => `#${a.n} ${a.kind}${a.ok ? ` score ${a.score}` : ` failed: ${a.error ?? ''}`}${a.change ? ` — ${a.change}` : ''}${
    a.kind === 'params' ? ` inputs ${JSON.stringify(a.inputs)}` : ''}`).join('\n');
  return [
    `Markets: ${markets}. In-sample data only.`,
    spec.goal ? `Goal from the user: ${spec.goal.slice(0, 1000)}` : '',
    spec.mode === 'firm' && spec.firm ? `Mode: prop-firm evaluation ${spec.firm.id}; pass rate of monthly starts must reach ${spec.firm.min_pass_rate}.` : 'Mode: metric thresholds.',
    `Current best attempt #${parent.n} "${parent.title ?? ''}", score ${parent.score}/100:\n${per}`,
    Object.keys(parent.inputs).length ? `Its tuned input values (use them as new defaults if useful): ${JSON.stringify(parent.inputs)}` : '',
    `Script:\n${(parent.code ?? '').slice(0, 20_000)}`,
    hist ? `Recent attempts:\n${hist}` : '',
  ].filter(Boolean).join('\n\n');
}

// --- Rapport ---------------------------------------------------------------------------------------

export interface LoopReport {
  v: 1; status: string; verdict: 'passed' | 'none'; reason: string;
  attempts: number; gemini_calls: number; rewrites: number; params: number; errors: number;
  best: { n: number; score: number; title: string | null } | null;
  winner: number | null;
  candidates: { n: number; title: string | null; score: number; oos_pass: boolean | null }[];
  progression: { n: number; score: number | null; best: number | null }[];
  markets: MarketSpec[]; engine: string; seed: number; fingerprint: string;
}

/** Empreinte des résultats : rang, sorte, variante, note, verdicts. Rejouer les essais doit la redonner. */
export function fingerprint(attempts: Pick<AttemptRow, 'n' | 'code' | 'inputs' | 'ok' | 'score' | 'is_pass' | 'oos_pass'>[]): string {
  return fnv(JSON.stringify(attempts.map((a) => [a.n, a.code ? variantOf(a.code, a.inputs) : null, a.ok, a.score === null ? null : Math.round(a.score * 1e4),
    a.is_pass, a.oos_pass])));
}

export function buildReport(spec: LoopSpec, attempts: AttemptRow[], status: string, reason: string, geminiCalls: number): LoopReport {
  let best: number | null = null;
  const progression = attempts.map((a) => {
    if (a.ok && a.score !== null) best = best === null ? a.score : Math.max(best, a.score);
    return { n: a.n, score: a.ok ? a.score : null, best };
  });
  const b = bestAttempt(attempts);
  const winner = attempts.find((a) => a.is_pass && a.oos_pass === true) ?? null;
  return {
    v: 1, status, verdict: winner ? 'passed' : 'none', reason,
    attempts: attempts.length, gemini_calls: geminiCalls,
    rewrites: attempts.filter((a) => a.kind === 'rewrite' || a.kind === 'generate').length,
    params: attempts.filter((a) => a.kind === 'params').length,
    errors: attempts.filter((a) => !a.ok).length,
    best: b ? { n: b.n, score: b.score!, title: b.title } : null,
    winner: winner?.n ?? null,
    candidates: attempts.filter((a) => a.is_pass).map((a) => ({ n: a.n, title: a.title, score: a.score!, oos_pass: a.oos_pass })),
    progression, markets: spec.markets, engine: ENGINE, seed: spec.seed, fingerprint: fingerprint(attempts),
  };
}

/** Une recherche est-elle finie (hors échantillon montrable) ? */
export const isFinished = (status: string) => status === 'done' || status === 'stopped' || status === 'failed';
