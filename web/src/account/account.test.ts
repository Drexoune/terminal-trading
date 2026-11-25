// @vitest-environment node
// Compte (P6, S5) : validation des trades, résultats et R, statistiques et tailles calculées à la
// main, règles des sociétés de financement franchies signalées.
import { describe, expect, it } from 'vitest';
import { JournalError, validateTrade, type JournalTrade } from '../../../api/_lib/journal-core';
import { firms } from '../backtest/diagnostics';
import { firmCheck, journalStats, pnl, positionSize, rMultiple, SizeError } from './account';

const NOW = Date.parse('2026-11-25T20:00:00Z');
const T = (o: Partial<JournalTrade>): JournalTrade => ({ id: 1, opened_ms: NOW - 3_600_000, closed_ms: NOW, asset: 'BTC', side: 'long', qty: 0.5, entry: 60_000, exit: 61_000, stop: 59_500, fees: 20, setup: null, notes: null, ...o });

describe('validation', () => {
  it('trade complet accepté, virgule décimale lue', () => {
    expect(validateTrade({ asset: 'BTC', side: 'short', opened_ms: NOW - 1, qty: '0,25', entry: 60000, stop: 60500 }, NOW))
      .toMatchObject({ side: 'short', qty: 0.25, exit: null, closed_ms: null, fees: 0 });
  });
  it.each([
    [{ asset: 'BTC', side: 'long', opened_ms: NOW, qty: 1, entry: 60000, stop: 60100 }, 'stop du mauvais côté de l’entrée pour un long'],
    [{ asset: 'BTC', side: 'long', opened_ms: NOW, qty: 1, entry: 60000, exit: 61000 }, 'sortie : prix et date ensemble, ou aucun des deux'],
    [{ asset: 'BTC', side: 'long', opened_ms: NOW, closed_ms: NOW - 5, qty: 1, entry: 60000, exit: 61000 }, 'sortie avant l’entrée'],
    [{ asset: 'BTC', side: 'acheteur', opened_ms: NOW, qty: 1, entry: 1 }, 'sens : long ou short'],
    [{ asset: 'BTC', side: 'long', opened_ms: NOW + 3_600_000, qty: 1, entry: 1 }, 'date d’entrée dans le futur'],
    [{ asset: '', side: 'long', opened_ms: NOW, qty: 1, entry: 1 }, 'actif manquant'],
  ])('refus %#', (raw, msg) => {
    expect(() => validateTrade(raw, NOW)).toThrow(JournalError);
    expect(() => validateTrade(raw, NOW)).toThrow(msg);
  });
});

describe('résultats et statistiques', () => {
  it('long et short, frais déduits, R', () => {
    expect(pnl(T({}))).toBe(480);                                     // (61 000 − 60 000) × 0,5 − 20
    expect(rMultiple(T({}))).toBeCloseTo(480 / 250, 12);              // risque (60 000 − 59 500) × 0,5
    expect(pnl(T({ side: 'short', exit: 59_000, stop: 60_400 }))).toBe(480);
    expect(pnl(T({ exit: null, closed_ms: null }))).toBeNull();
  });
  it('taux de réussite, profit factor, espérance en R, pire série, courbe', () => {
    const ts = [
      T({ id: 1, closed_ms: NOW - 4000, exit: 61_000 }),               // +480, +1,92 R
      T({ id: 2, closed_ms: NOW - 3000, exit: 59_500 }),               // −270, −1,08 R
      T({ id: 3, closed_ms: NOW - 2000, exit: 59_600, stop: null }),   // −220, sans R
      T({ id: 4, closed_ms: NOW - 1000, exit: 60_800 }),               // +380, +1,52 R
      T({ id: 5, exit: null, closed_ms: null }),                       // ouvert
    ];
    const s = journalStats(ts);
    expect([s.trades, s.closed, s.open, s.wins, s.losses]).toEqual([5, 4, 1, 2, 2]);
    expect(s.winRate).toBe(0.5);
    expect(s.total).toBe(370);
    expect(s.profitFactor).toBeCloseTo(860 / 490, 12);
    expect(s.expectancyR).toBeCloseTo((1.92 - 1.08 + 1.52) / 3, 12);
    expect(s.worstStreak).toBe(2);
    expect(s.curve.map((p) => p.cum)).toEqual([480, 210, -10, 370]);
    expect(journalStats([]).winRate).toBeNull();
  });
});

describe('calculateur', () => {
  it('1 % de 10 000 $, stop à 500 $ : 0,2 BTC, contrats OKX arrondis vers le bas', () => {
    const r = positionSize({ capital: 10_000, riskPct: 1, riskAmount: null, entry: 60_000, stop: 59_500, ctVal: 0.01, lotSz: 0.01 });
    expect([r.side, r.risk, r.distance, r.contracts, r.qty, r.notional, r.lossAtStop]).toEqual(['long', 100, 500, 20, 0.2, 12_000, 100]);
    expect(r.leverage).toBeCloseTo(1.2, 12);
    expect(r.warnings).toEqual([]);
    const odd = positionSize({ capital: 10_000, riskPct: null, riskAmount: 73, entry: 60_000, stop: 59_500, ctVal: 0.01, lotSz: 0.01 });
    expect(odd.contracts).toBe(14.6);                                // 0,146 BTC
    expect(odd.lossAtStop).toBeCloseTo(73, 9);
  });
  it('short, levier excessif signalé, saisies refusées', () => {
    const r = positionSize({ capital: 1_000, riskPct: 2, riskAmount: null, entry: 60_000, stop: 60_060, ctVal: null, lotSz: null });
    expect(r.side).toBe('short');
    expect(r.warnings[0]).toMatch(/levier de 20/);
    expect(() => positionSize({ capital: 1000, riskPct: 1, riskAmount: null, entry: 1, stop: 1, ctVal: null, lotSz: null })).toThrow(SizeError);
  });
  it('règles FTMO : perte journalière restante et marge avant la perte maximale', () => {
    const ftmo = firms().find((f) => f.id === 'ftmo2_p1')!;          // 100 000 : 5 000 par jour, 10 000 au total
    expect(firmCheck(ftmo, 1_000, -3_000, 96_000)).toMatchObject({ ok: true });
    const c = firmCheck(ftmo, 2_500, -3_000, 94_000);                 // marge 4 000 > 2 500 ; reste du jour 2 000 < 2 500
    expect(c.ok).toBe(false);
    expect(c.lines.map((l) => [l.label, l.ok])).toEqual([['Perte journalière', false], ['Perte maximale', true]]);
  });
});
