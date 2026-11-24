// Diagnostics (section Backtest, porte de l'étape S2) : règles des sociétés de financement sur des
// suites construites à la main (journées dans le fuseau de chaque société, changements d'heure
// compris), Monte Carlo reproductible avec une graine, coupure dans et hors échantillon.
import { describe, expect, it } from 'vitest';
import {
  dayKey, evaluateFirm, firmInput, firms, monteCarlo, percentiles, rng, rollingStarts, splitSample, tradeReturns, type FirmInput, type FirmRules,
} from './diagnostics';
import type { Trade } from './metrics';

const H = 3_600_000, D = 24 * H;
const T = (eb: number, xb: number, pnl: number, entry_time = 0): Trade =>
  ({ side: 'long', entry_bar: eb, entry_time, entry_price: 100, exit_bar: xb, exit_time: 0, exit_price: 100, size: 1, pnl, commission: 0, entry_id: 'L', exit_id: 'S' });

/** Barres à heure fixe UTC, une par jour ; equity et balance donnés, positions plates sauf indiqué. */
function input(startUtc: number, equity: number[], balance: number[], trades: Trade[], capital: number, busy: number[] = []): FirmInput {
  return { closeTimes: equity.map((_, i) => startUtc + i * D), equity, balance, flat: equity.map((_, i) => !busy.includes(i)), trades, capital };
}
const rule = (id: string, o: Parameters<typeof firms>[0] = {}) => firms(o).find((f) => f.id === id) as FirmRules;

describe('journées des sociétés', () => {
  it('FTMO : minuit à Prague, passage à l’heure d’été du 29/03/2026', () => {
    expect(dayKey(Date.parse('2026-03-28T22:30:00Z'), 'Europe/Prague', 0)).toBe('2026-03-28');   // 23:30 CET
    expect(dayKey(Date.parse('2026-03-28T23:30:00Z'), 'Europe/Prague', 0)).toBe('2026-03-29');   // 00:30 CET
    expect(dayKey(Date.parse('2026-03-29T21:59:00Z'), 'Europe/Prague', 0)).toBe('2026-03-29');   // 23:59 CEST
    expect(dayKey(Date.parse('2026-03-29T22:00:00Z'), 'Europe/Prague', 0)).toBe('2026-03-30');   // 00:00 CEST
  });
  it('Lucid : séance de 18:00 à 16:45 à New York, heure d’hiver et d’été', () => {
    expect(dayKey(Date.parse('2026-11-24T22:59:00Z'), 'America/New_York', 6)).toBe('2026-11-24');   // 17:59 EST
    expect(dayKey(Date.parse('2026-11-24T23:00:00Z'), 'America/New_York', 6)).toBe('2026-11-25');   // 18:00 EST
    expect(dayKey(Date.parse('2026-07-01T21:59:00Z'), 'America/New_York', 6)).toBe('2026-07-01');   // 17:59 EDT
    expect(dayKey(Date.parse('2026-07-01T22:00:00Z'), 'America/New_York', 6)).toBe('2026-07-02');   // 18:00 EDT
  });
});

describe('FTMO', () => {
  const noon = Date.parse('2026-11-02T11:00:00Z');   // 12:00 à Prague
  it('2-Step : objectif de 10 % atteint le 4e jour de trading, à plat', () => {
    const bal = [100_000, 102_500, 105_000, 107_500, 110_000];
    const trades = [1, 2, 3, 4].map((i) => T(i, i, 2500, noon + (i - 1) * D));
    const v = evaluateFirm(rule('ftmo2_p1'), input(noon, bal, bal, trades, 100_000));
    expect(v).toMatchObject({ status: 'passed', at: '2026-11-06', trading_days: 4 });
  });
  it('2-Step : objectif en 2 jours mais 4 jours de trading exigés → en cours', () => {
    const bal = [100_000, 105_000, 110_000, 110_000];
    const v = evaluateFirm(rule('ftmo2_p1'), input(noon, bal, bal, [T(1, 1, 5000, noon), T(2, 2, 5000, noon + D)], 100_000));
    expect(v).toMatchObject({ status: 'running', reason: expect.stringMatching(/4 jours de trading/) });
  });
  it('perte journalière de 5 % sous le solde de début de journée → échec', () => {
    const v = evaluateFirm(rule('ftmo2_p1'), input(noon, [100_000, 96_000, 94_900], [100_000, 100_000, 100_000], [T(1, 3, 0, noon)], 100_000, [1, 2]));
    expect(v).toMatchObject({ status: 'failed', at: '2026-11-04', reason: expect.stringMatching(/perte journalière/) });
  });
  it('mise à l’échelle : backtest à 10 000, compte de 100 000 (× 10)', () => {
    const v = evaluateFirm(rule('ftmo2_p1'), input(noon, [10_000, 9_490], [10_000, 10_000], [T(1, 3, 0, noon)], 10_000, [1]));
    expect(v).toMatchObject({ status: 'failed', scale: 10, reason: expect.stringMatching(/perte journalière franchie : capital 94900 sous 95000/) });
  });
  it('1-Step : perte maximale suiveuse en fin de journée (plus haut solde de minuit − 10 %)', () => {
    const eq = [100_000, 104_000, 94_500, 93_900];
    const bal = [100_000, 104_000, 104_000, 104_000];
    const v = evaluateFirm(rule('ftmo1'), input(noon, eq, bal, [T(1, 1, 4000, noon), T(2, 9, 0, noon + D)], 100_000, [2, 3]));
    // Jour 3 : seuil de 94 000 (104 000 − 10 000) ; la perte journalière de 3 % (sous 101 000) tombe d'abord.
    expect(v).toMatchObject({ status: 'failed', at: '2026-11-04', reason: expect.stringMatching(/perte journalière/) });
    const loose = { ...rule('ftmo1'), dailyLoss: null };
    expect(evaluateFirm(loose, input(noon, eq, bal, [T(1, 1, 4000, noon)], 100_000, [2, 3]))).toMatchObject({ status: 'failed', at: '2026-11-05',
      reason: expect.stringMatching(/perte maximale.*94000/) });
  });
});

describe('LucidFlex 25K', () => {
  const close = Date.parse('2026-11-02T20:00:00Z');   // 15:00 à New York
  it('seuil suiveur figé à 25 100 une fois le solde de fin de journée à 26 100', () => {
    const bal = [25_000, 26_100, 26_100, 26_100];
    const eq = [25_000, 26_100, 25_150, 25_099];
    const v = evaluateFirm(rule('lucid25'), input(close, eq, bal, [T(1, 1, 1100, close)], 25_000, [2, 3]));
    expect(v).toMatchObject({ status: 'failed', at: '2026-11-05', reason: expect.stringMatching(/25099 sous le seuil de 25100/) });
  });
  it('constance de 40 % : objectif atteint, réussite seulement quand le meilleur jour pèse 40 % au plus', () => {
    const steps = [1000, 300, 500, 700];
    const bal = [25_000]; for (const s of steps) bal.push(bal[bal.length - 1] + s);
    const trades = steps.map((s, i) => T(i + 1, i + 1, s, close + i * D));
    const v = evaluateFirm(rule('lucid25'), input(close, bal, bal, trades, 25_000));
    expect(v).toMatchObject({ status: 'passed', at: '2026-11-06' });
    expect(v.best_day_pct).toBeCloseTo(40, 6);
    const stop = evaluateFirm(rule('lucid25'), input(close, bal.slice(0, 3), bal.slice(0, 3), trades.slice(0, 2), 25_000));
    expect(stop).toMatchObject({ status: 'running', reason: 'objectif atteint mais règle de constance non tenue' });
  });
  it('DLL de 600 $ si activée : séance bloquée, pas d’échec ; positions gardées après 16:45 comptées', () => {
    const v = evaluateFirm(rule('lucid25', { lucidDll: true }), input(close, [25_000, 24_350, 24_900], [25_000, 25_000, 25_000], [T(1, 2, -100, close)], 25_000, [1]));
    expect(v).toMatchObject({ status: 'running', dll_days: 1, session_holds: 1 });
    expect(evaluateFirm(rule('lucid25'), input(close, [25_000, 24_350], [25_000, 25_000], [], 25_000, [1])).dll_days).toBe(0);
  });
  it('départs mensuels : un départ par mois', () => {
    const n = 70, bal = Array.from({ length: n }, () => 25_000);
    expect(rollingStarts(rule('lucid25'), input(Date.parse('2026-01-01T20:00:00Z'), bal, bal, [], 25_000))).toMatchObject({ starts: 3, running: 3 });
  });
});

describe('Monte Carlo', () => {
  const trades = [120, -80, 60, -40, 200, -150, 90, -30, 50, -20].map((p, i) => T(i, i + 1, p));
  it('même graine, même résultat ; autre graine, autre tirage', () => {
    expect(monteCarlo(trades, 1000, { seed: 7 })).toEqual(monteCarlo(trades, 1000, { seed: 7 }));
    expect(monteCarlo(trades, 1000, { seed: 7 })!.bootstrap.final_pct).not.toEqual(monteCarlo(trades, 1000, { seed: 8 })!.bootstrap.final_pct);
    const a = rng(1), b = rng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('permutation : même rendement final, drawdowns différents', () => {
    const mc = monteCarlo(trades, 1000, { iterations: 500 })!;
    const r = tradeReturns(trades, 1000);
    const final = (r.reduce((e, x) => e * (1 + x), 1) - 1) * 100;
    expect(mc.original.final_pct).toBeCloseTo(final, 9);
    expect(final).toBeCloseTo(20, 9);   // somme des PnL 200 sur 1 000
    expect(mc.shuffle.dd_pct.p5).toBeLessThanOrEqual(mc.shuffle.dd_pct.p95);
    expect(mc.bootstrap.p_ruin).toBe(0);   // jamais 50 % de baisse avec ces trades
  });
  it('trades tous gagnants : ni perte ni drawdown ; moins de 2 trades : rien', () => {
    const mc = monteCarlo([T(0, 1, 10), T(1, 2, 20)], 1000)!;
    expect(mc.bootstrap.p_loss).toBe(0);
    expect(mc.bootstrap.dd_pct.p95).toBe(0);
    expect(monteCarlo([T(0, 1, 10)], 1000)).toBeNull();
  });
  it('centiles par interpolation linéaire', () => {
    expect(percentiles([1, 2, 3, 4, 5])).toEqual({ p5: 1.2, p25: 2, p50: 3, p75: 4, p95: 4.8 });
  });
});

describe('dans et hors échantillon', () => {
  it('trades répartis par entrée, capital de départ du segment hors échantillon', () => {
    const eq = [1000, 1010, 1020, 1030, 1020, 1010, 1000, 990];
    const trades = [T(0, 3, 30), T(4, 7, -30)];
    const s = splitSample(trades, eq, 4, 1000, 365)!;
    expect([s.is.trades, s.oos.trades]).toEqual([1, 1]);
    expect(s.is.total_pnl).toBe(30);
    expect(s.oos.total_pnl_pct).toBeCloseTo((-30 / 1030) * 100, 9);
    expect(s.oos.max_dd_pct).toBeCloseTo((40 / 1030) * 100, 9);
    expect(splitSample(trades, eq, 1, 1000, 365)).toBeNull();
  });
  it('données des évaluations : solde réalisé et positions à plat', () => {
    const x = firmInput([0, D, 2 * D, 3 * D], D, [100, 110, 120, 120], [T(1, 2, 20)], [], 100);
    expect(x.balance).toEqual([100, 100, 120, 120]);
    expect(x.flat).toEqual([true, false, true, true]);
    expect(x.closeTimes[0]).toBe(D - 1);
  });
});
