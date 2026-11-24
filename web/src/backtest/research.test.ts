// Recherche autonome (S4, T-064) : note partielle, contrôle hors échantillon, variantes voisines
// (graine fixe), choix du pas suivant (hybride : Gemini tous les 5 essais), demande de réécriture
// sans hors échantillon, rapport et empreinte.
import { describe, expect, it } from 'vitest';
import type { Metrics } from './metrics';
import type { ScriptInput } from './engine';
import {
  attemptRng, buildReport, credit, criteria, DEFAULT_THRESHOLDS, evolvePrompt, fingerprint, mutateInputs, nextAction, oosCheck, scoreOf,
  variantOf, type AttemptRow, type LoopSpec,
} from './research';

const M = (o: Partial<Metrics>): Metrics => ({
  trades: 40, wins: 22, losses: 18, winrate: 0.55, total_pnl: 2000, total_pnl_pct: 20, rr: 1.2, ex_pnl: 50, ex_ret_pct: 0.5,
  max_dd_pct: 15, max_dd: 1500, sharpe: 1.2, sharpe_bar: 0.06, t_stat: 2.5, dsr: 0.97, sr0_bar: 0, trials: 1, skew: 0, kurtosis: 3, bars: 700,
  profit_factor: 1.5, gross_win: 6000, gross_loss: 4000, final_equity: 12000, ...o,
});

const SPEC: LoopSpec = {
  v: 1, title: 'Test', markets: [{ asset: 'BTC', tf: '1D', from: 0, to: 1, split: 0.5 }], mode: 'thresholds', thresholds: DEFAULT_THRESHOLDS, firm: null,
  oos_min_ratio: 0.5, settings: { capital: 10_000, commissionPct: 0.05, slippageTicks: 1, qtyPct: 100, margin: false },
  max_attempts: 50, max_gemini: 12, rewrite_every: 5, seed: 7, start: { kind: 'code', title: 'SMA', code: 'strategy()', inputs: {} }, goal: '',
};

const att = (n: number, o: Partial<AttemptRow> = {}): AttemptRow => ({
  n, kind: 'params', parent: null, title: 'x', code: `c${n}`, inputs: {}, change: null, gemini_calls: 0, ok: true, error: null,
  score: 50, is_pass: false, oos_pass: null, detail: null, sr_bars: [0.01], ms: 10, ...o,
});

describe('note partielle', () => {
  it('crédit : proportionnel sous le seuil, 1 au-delà ; plafond inversé pour le drawdown ; 0 sans valeur', () => {
    expect(credit(1, 2, 'min')).toBe(0.5);
    expect(credit(3, 2, 'min')).toBe(1);
    expect(credit(-1, 2, 'min')).toBe(0);
    expect(credit(null, 2, 'min')).toBe(0);
    expect(credit(40, 20, 'max')).toBe(0.5);
    expect(credit(10, 20, 'max')).toBe(1);
  });
  it('seuils : six critères, tous tenus → 100 ; un manque proche donne une note partielle', () => {
    const ok = criteria(M({}), SPEC);
    expect(ok.map((c) => c.key)).toEqual(['min_trades', 'sharpe', 't_stat', 'dsr', 'max_dd_pct', 'profit_factor']);
    expect(scoreOf(ok)).toBe(100);
    const near = criteria(M({ t_stat: 1.5 }), SPEC);
    expect(near.find((c) => c.key === 't_stat')).toMatchObject({ credit: 0.75, pass: false });
    expect(scoreOf(near)).toBeCloseTo((5 + 0.75) / 6 * 100, 4);
  });
  it('facteur de profit sans perte : critère tenu', () => {
    expect(criteria(M({ profit_factor: null, gross_loss: 0 }), SPEC).find((c) => c.key === 'profit_factor')!.pass).toBe(true);
  });
  it('mode société de financement : trades, taux d’évaluations réussies, drawdown', () => {
    const cs = criteria(M({}), { ...SPEC, mode: 'firm', firm: { id: 'ftmo2_p1', min_pass_rate: 0.5 } }, 0.25);
    expect(cs.map((c) => [c.key, c.credit])).toEqual([['min_trades', 1], ['firm_rate', 0.5], ['max_dd_pct', 1]]);
  });
});

describe('hors échantillon', () => {
  it('réussi : assez de trades, PnL positif, Sharpe ≥ ratio × Sharpe dans l’échantillon', () => {
    expect(oosCheck(M({}), M({ trades: 12, sharpe: 0.7 }), 0.5)).toEqual([]);
    expect(oosCheck(M({}), M({ trades: 3, total_pnl: -5, sharpe: 0.1 }), 0.5)).toEqual(['moins de 5 trades', 'PnL négatif ou nul', 'Sharpe sous le seuil']);
  });
});

describe('variantes voisines', () => {
  const meta: ScriptInput[] = [
    { id: 'dir', title: 'Sens', type: 'string', value: 'Long', options: ['Long', 'Short'] },
    { id: 'fast', title: 'Rapide', type: 'int', value: 20, min: 2 },
    { id: 'slow', title: 'Lente', type: 'int', value: 50, min: 3, max: 200 },
    { id: 'sl', title: 'Stop (%)', type: 'float', value: 0, step: 0.5 },
  ];
  it('même graine, même rang : même variante ; bornes, entiers et pas tenus ; options intactes', () => {
    const a = mutateInputs(meta, {}, attemptRng(7, 3)), b = mutateInputs(meta, {}, attemptRng(7, 3));
    expect(a).toEqual(b);
    for (let n = 2; n < 200; n++) {
      const v = mutateInputs(meta, { fast: 20, slow: 50, sl: 0 }, attemptRng(7, n));
      expect(v.dir).toBeUndefined();
      expect(Number.isInteger(v.fast) && (v.fast as number) >= 2).toBe(true);
      expect(Number.isInteger(v.slow) && (v.slow as number) >= 3 && (v.slow as number) <= 200).toBe(true);
      expect(((v.sl as number) / 0.5) % 1).toBeCloseTo(0, 9);
      expect(variantOf('c', v)).not.toBe(variantOf('c', { fast: 20, slow: 50, sl: 0 }));
    }
  });
  it('empreinte de variante : indépendante de l’ordre des clés', () => {
    expect(variantOf('c', { a: 1, b: 2 })).toBe(variantOf('c', { b: 2, a: 1 }));
  });
});

describe('pas suivant (hybride, T-064)', () => {
  const run = (geminiUsed: number, k: number, hasParams = true) => nextAction(SPEC, Array.from({ length: k }, (_, i) => att(i + 1, { score: i })), geminiUsed, () => hasParams);
  it('départ, puis paramètres ; Gemini réécrit aux essais 6, 11, 16… à partir du meilleur', () => {
    expect(nextAction(SPEC, [], 0, () => true)).toEqual({ kind: 'start' });
    expect(run(0, 1)).toEqual({ kind: 'params', parent: 1 });
    expect(run(0, 4)).toEqual({ kind: 'params', parent: 4 });
    expect(run(0, 5)).toEqual({ kind: 'rewrite', parent: 5 });
    expect(run(1, 10)).toEqual({ kind: 'rewrite', parent: 10 });
    const kinds = Array.from({ length: 50 }, (_, k) => (k === 0 ? 'start' : run(0, k).kind));
    expect(kinds.filter((x) => x === 'rewrite').length).toBe(9);   // 50 essais ≈ 10 appels avec le départ et les réparations
  });
  it('budget Gemini épuisé : paramètres seulement ; sans paramètres : fin ; budget d’essais : fin', () => {
    expect(run(12, 5)).toEqual({ kind: 'params', parent: 5 });
    expect(run(12, 5, false).kind).toBe('finish');
    expect(run(0, 3, false)).toEqual({ kind: 'rewrite', parent: 3 });
    expect(run(0, 50).kind).toBe('finish');
  });
  it('départ en texte : Gemini génère ; budget nul : fin', () => {
    const s = { ...SPEC, start: { kind: 'prompt' as const, prompt: 'x' } };
    expect(nextAction(s, [], 0, () => true)).toEqual({ kind: 'generate' });
    expect(nextAction({ ...s, max_gemini: 0 }, [], 0, () => true).kind).toBe('finish');
  });
});

describe('demande de réécriture', () => {
  it('meilleur essai, critères dans l’échantillon, historique ; jamais de verdict hors échantillon', () => {
    const parent = att(4, { title: 'SMA', code: '//@version=6\nstrategy("SMA")', inputs: { fast: 18 }, score: 70, is_pass: true, oos_pass: false,
      detail: [{ asset: 'BTC', tf: '1D', score: 70, firm_rate: null, is: {} as never, criteria: criteria(M({ t_stat: 1.5 }), SPEC) }] });
    const p = evolvePrompt(SPEC, parent, [att(1), att(2, { ok: false, error: 'boom', score: null }), parent]);
    expect(p).toContain('t-stat: 1.5 (target >= 2, credit 0.75)');
    expect(p).toContain('{"fast":18}');
    expect(p).toContain('#2 params failed: boom');
    expect(p).not.toMatch(/oos|out-of-sample|hors/i);
  });
});

describe('rapport', () => {
  it('progression, candidats, gagnant, empreinte stable et sensible aux résultats', () => {
    const rows = [att(1, { kind: 'start', score: 40 }), att(2, { score: 60, is_pass: true, oos_pass: false }), att(3, { ok: false, score: null, error: 'x' }),
      att(4, { kind: 'rewrite', score: 80, is_pass: true, oos_pass: true })];
    const r = buildReport(SPEC, rows, 'done', 'fin', 3);
    expect(r).toMatchObject({ verdict: 'passed', winner: 4, attempts: 4, rewrites: 1, params: 2, errors: 1, best: { n: 4, score: 80 } });
    expect(r.candidates).toEqual([{ n: 2, title: 'x', score: 60, oos_pass: false }, { n: 4, title: 'x', score: 80, oos_pass: true }]);
    expect(r.progression.map((p) => p.best)).toEqual([40, 60, 60, 80]);
    expect(fingerprint(rows)).toBe(r.fingerprint);
    expect(fingerprint(rows.map((a) => (a.n === 2 ? { ...a, score: 61 } : a)))).not.toBe(r.fingerprint);
  });
});
