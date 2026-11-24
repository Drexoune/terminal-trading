// Mise en forme des résultats, chargement des bougies et décompte des essais (section Backtest).
import { describe, expect, it } from 'vitest';
import { toCandles } from '../data/online/backtest';
import type { Metrics } from './metrics';
import { recordTrial, resetTrials, variantHash } from './trials';
import { exitReason, tiles } from './view';

const M: Metrics = {
  trades: 16, wins: 10, losses: 6, winrate: 0.625, total_pnl: 4168.3, total_pnl_pct: 41.683, rr: 1.19, ex_pnl: 260.5, ex_ret_pct: 2.69,
  max_dd_pct: 23.2, max_dd: 2554, sharpe: 0.9, sharpe_bar: 0.047, t_stat: 1.03, dsr: 0.911, sr0_bar: 0, trials: 1, skew: 0.1, kurtosis: 5, bars: 798,
  profit_factor: 1.98, gross_win: 8400, gross_loss: 4240, final_equity: 17665,
};

describe('tuiles notées', () => {
  it('ordre E → S, valeurs au format fr-FR, notes fixes', () => {
    const t = tiles(M, 'USDT');
    expect(t.map((x) => x.grade).join('')).toBe('EDCBBAAS');
    expect(t[0]).toMatchObject({ value: '62,5 %', sub: '10 gagnants sur 16 trades' });
    expect(t[1].value).toMatch(/^\+4\s168\u00a0USDT$/);
    expect(t.find((x) => x.key === 'max_dd')!.value).toBe('−23,2 %');
    expect(t.find((x) => x.key === 'dsr')).toMatchObject({ value: '91,1 %', sub: expect.stringMatching(/^N = 1 essai/) });
    expect(t.find((x) => x.key === 't_stat')!.sub).toMatch(/en deçà du seuil de 2/);
  });
  it('aucune transaction : « — » avec la raison, jamais un chiffre inventé', () => {
    const empty: Metrics = { ...M, trades: 0, wins: 0, losses: 0, winrate: null, rr: null, ex_pnl: null, ex_ret_pct: null, t_stat: null, dsr: null, total_pnl: 0, total_pnl_pct: 0 };
    const t = tiles(empty, 'USD');
    for (const k of ['winrate', 'rr', 'ex', 't_stat', 'dsr']) {
      const x = t.find((y) => y.key === k)!;
      expect(x.value, k).toBe('—');
      expect(x.missing, k).toBeTruthy();
    }
  });
  it('cause des sorties', () => {
    expect([exitReason('XL', 'long'), exitReason('S', 'long'), exitReason('L', 'short'), exitReason('Close entry(s) order L', 'long'), exitReason(null, 'long')])
      .toEqual(['stop ou objectif', 'retournement', 'retournement', 'sortie sur signal', '—']);
  });
});

describe('bougies et essais', () => {
  it('colonnes -> barres, longueur la plus courte', () => {
    expect(toCandles({ configured: true, asset: 'BTC', tf: '1D', n: 2, t: [1, 2], o: [1, 2], h: [2, 3], l: [0, 1], c: [1.5], computed_ms: 0 }))
      .toEqual([{ t: 1, o: 1, h: 2, l: 0, c: 1.5 }]);
  });
  it('variantes distinctes comptées une fois ; remise à zéro', () => {
    resetTrials('BTC', '1D', 'all');
    const h1 = variantHash(['code', { fastLen: 20 }]), h2 = variantHash(['code', { fastLen: 10 }]);
    expect(h1).not.toBe(h2);
    expect(recordTrial('BTC', '1D', 'all', h1, 0.05).n).toBe(1);
    expect(recordTrial('BTC', '1D', 'all', h1, 0.05).n).toBe(1);
    const r = recordTrial('BTC', '1D', 'all', h2, 0.03);
    expect(r).toMatchObject({ n: 2, stored: true });
    expect(r.srVariance).toBeCloseTo(0.0002, 12);
    resetTrials('BTC', '1D', 'all');
    expect(recordTrial('BTC', '1D', 'all', h1, 0.05).n).toBe(1);
  });
});
