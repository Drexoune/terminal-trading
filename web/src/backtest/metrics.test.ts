// @vitest-environment node
// Mesures du backtest : porte de l'étape S1 (moteur et mesures contre la référence Python
// indépendante, au centime près), Sharpe déflaté contre l'exemple numérique de Bailey et López de
// Prado (2014), et cas faits à la main.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, runStrategy } from './engine';
import {
  barsPerYear, computeMetrics, deflatedSharpe, equityCurve, expectedMaxSharpe, GRADED, moments, normCdf, normInv, trialStats, type Candle, type Trade,
} from './metrics';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const BTC = fx('okx-btc-1d-2024-09-16_2026-11-23.json') as Candle[];
const REF = fx('reference-sma-20-50-btc-1d.json') as { trades: Record<string, number>[]; open: Record<string, number>[]; metrics: Record<string, number> };

const SMA = `//@version=6
strategy("SMA 20/50", overlay=true)
fast = ta.sma(close, 20)
slow = ta.sma(close, 50)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("S", strategy.short)
`;

describe('porte S1 : moteur et mesures contre la référence Python', () => {
  it('mêmes transactions, mêmes mesures, au centime près', async () => {
    const r = await runStrategy(SMA, BTC, '1D', { ...DEFAULT_SETTINGS, slippageTicks: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.trades.length).toBe(REF.trades.length);
    r.trades.forEach((t, i) => {
      const x = REF.trades[i];
      expect([t.entry_bar, t.exit_bar, t.entry_price, t.exit_price]).toEqual([x.entry_bar, x.exit_bar, x.entry_price, x.exit_price]);
      expect(t.size).toBeCloseTo(x.size, 9);
      expect(t.pnl).toBeCloseTo(x.pnl, 2);
    });
    expect(r.open.map((o) => [o.entry_bar, o.entry_price])).toEqual(REF.open.map((o) => [o.entry_bar, o.entry_price]));
    const m = computeMetrics(BTC, r.trades, r.open, 10_000, 365);
    const ref = REF.metrics;
    expect(m.trades).toBe(ref.trades);
    expect(m.wins).toBe(ref.wins);
    for (const k of ['total_pnl', 'max_dd', 'final_equity'] as const) expect(m[k], k).toBeCloseTo(ref[k], 2);
    for (const k of ['winrate', 'rr', 'ex_pnl', 'ex_ret_pct', 'max_dd_pct', 'sharpe', 't_stat', 'dsr', 'profit_factor'] as const) {
      expect(m[k], k).toBeCloseTo(ref[k], 6);
    }
    // Contrôle croisé avec l'émulateur : son PnL net retire déjà la commission d'entrée de la
    // position encore ouverte (taille × prix × 0,05 %).
    const openComm = r.open.reduce((s, o) => s + Math.abs(o.size) * o.entry_price * 0.0005, 0);
    expect(r.emulator.netprofit).toBeCloseTo(m.total_pnl - openComm, 2);
  });
});

describe('Sharpe déflaté', () => {
  it('exemple de Bailey et López de Prado : SR annuel 2,5, 5 ans, γ3 = −3, γ4 = 10, N = 100, V = 1/2 → SR0 ≈ 0,1132, DSR ≈ 0,90', () => {
    const sr = 2.5 / Math.sqrt(250), v = 0.5 / 250;
    const sr0 = expectedMaxSharpe(100, v);
    expect(sr0).toBeCloseTo(0.1132, 4);
    expect(deflatedSharpe(sr, sr0, 1250, -3, 10)).toBeCloseTo(0.9004, 2);
  });
  it('un seul essai : seuil nul (Sharpe probabiliste) ; dénominateur négatif : rien', () => {
    expect(expectedMaxSharpe(1, 0.5)).toBe(0);
    expect(deflatedSharpe(0, 0, 100, 0, 3)).toBeCloseTo(0.5, 12);
    expect(deflatedSharpe(2, 0, 100, 5, 3)).toBeNull();
  });
  it('loi normale : répartition et quantiles', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 12);
    expect(normCdf(1.959963985)).toBeCloseTo(0.975, 8);
    expect(normInv(0.975)).toBeCloseTo(1.959963985, 7);
    expect(normInv(0.01)).toBeCloseTo(-2.326347874, 7);
    for (const p of [0.001, 0.2, 0.5, 0.8, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 8);
  });
  it('essais : nombre et variance des Sharpe', () => {
    expect(trialStats([])).toEqual({ n: 1, srVariance: 0 });
    expect(trialStats([0.1])).toEqual({ n: 1, srVariance: 0 });
    expect(trialStats([0.1, 0.3])).toMatchObject({ n: 2 });
    expect(trialStats([0.1, 0.3]).srVariance).toBeCloseTo(0.02, 12);
  });
});

describe('cas faits à la main', () => {
  const C = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: i * 86_400_000, o: c, h: c, l: c, c }));
  const T = (side: 'long' | 'short', eb: number, ep: number, xb: number, xp: number, size: number, pnl: number): Trade =>
    ({ side, entry_bar: eb, entry_time: 0, entry_price: ep, exit_bar: xb, exit_time: 0, exit_price: xp, size, pnl, commission: 0, entry_id: '', exit_id: null });
  it('capital marqué à chaque clôture : latent, puis réalisé à la sortie', () => {
    const c = C([100, 110, 120, 90]);
    expect(equityCurve(c, [T('long', 1, 110, 2, 120, 1, 10)], [{ side: 'short', entry_bar: 2, entry_price: 120, size: -1 }], 1000))
      .toEqual([1000, 1000, 1010, 1040]);
  });
  it('taux de réussite, RR, E[X], facteur de profit, drawdown', () => {
    const c = C([100, 100, 100, 100, 100]);
    const trades = [T('long', 0, 100, 1, 110, 1, 10), T('long', 1, 100, 2, 95, 1, -5), T('short', 2, 100, 3, 80, -1, 20), T('long', 3, 100, 4, 90, 1, -10)];
    const m = computeMetrics(c, trades, [], 1000, 365);
    expect(m).toMatchObject({ trades: 4, wins: 2, winrate: 0.5, total_pnl: 15, total_pnl_pct: 1.5, profit_factor: 2, gross_win: 30, gross_loss: 15 });
    expect(m.rr).toBeCloseTo(15 / 7.5, 12);
    expect(m.ex_pnl).toBeCloseTo(3.75, 12);
    expect(m.ex_ret_pct).toBeCloseTo(3.75, 12);   // notionnel de 100 par trade
    expect(m.equity).toEqual([1000, 1010, 1005, 1025, 1015]);
    expect(m.max_dd).toBeCloseTo(10, 12);
    expect(m.max_dd_pct).toBeCloseTo((10 / 1025) * 100, 12);
  });
  it('aucune transaction : mesures absentes, pas inventées', () => {
    const m = computeMetrics(C([1, 2, 3]), [], [], 1000, 365);
    expect(m).toMatchObject({ trades: 0, winrate: null, rr: null, ex_pnl: null, t_stat: null, profit_factor: null, total_pnl: 0 });
  });
  it('moments : loi symétrique, aplatissement non centré', () => {
    const mo = moments([-1, 0, 1, -1, 0, 1])!;
    expect(mo.skew).toBeCloseTo(0, 12);
    expect(mo.kurt).toBeCloseTo(1.5, 12);
  });
  it('barres par an ; tuiles notées dans l’ordre E → S', () => {
    expect([barsPerYear('BTC', '1D'), barsPerYear('ETH', '1H'), barsPerYear('BTC', '4H'), barsPerYear('SPY', '1D')]).toEqual([365, 8760, 2190, 252]);
    expect(GRADED.map((g) => g.grade).join('')).toBe('EDCBBAAS');
  });
});
