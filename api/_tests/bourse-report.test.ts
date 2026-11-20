// Rapport du portefeuille (B1.6) sur un portefeuille synthétique : lignes,
// liquidités, performances contre benchmarks, allocation ventilée, risques,
// dividendes, et filtre par enveloppe.
import { describe, expect, it } from 'vitest';
import { buildReport, parisDate, previousWeekday } from '../_lib/bourse/report.js';
import { syntheticData } from './portfolio-fixture.js';

const NOW = Date.parse('2026-11-20T16:00:00Z');

describe('rapport du portefeuille', () => {
  const r = buildReport(syntheticData(), null, NOW);

  it('date de Paris et jour ouvré précédent', () => {
    expect(parisDate(Date.parse('2026-11-20T23:30:00Z'))).toBe('2026-11-21');
    expect(previousWeekday('2026-11-23')).toBe('2026-11-20');
  });

  it('lignes et liquidités : valeur complète, somme cohérente', () => {
    expect(r.summary.complete).toBe(true);
    expect(r.lines.map((l) => l.symbol).sort()).toEqual(['AAPL', 'CW8', 'TTE']);
    const sum = r.lines.reduce((s, l) => s + Number(l.value), 0) + r.cash.reduce((s, c) => s + Number(c.value_eur), 0);
    // Total arrondi une fois, lignes arrondies chacune au centime : écart de quelques centimes au plus.
    expect(Math.abs(Number(r.summary.value) - sum)).toBeLessThan(0.05);
    expect(r.lines.reduce((s, l) => s + (l.weight ?? 0), 0)).toBeLessThan(1);
    const cw8 = r.lines.find((l) => l.symbol === 'CW8')!;
    expect(cw8.quantity).toBe('4');
    expect(cw8.close).toMatchObject({ date: '2026-11-19', source: 'Alpha Vantage', stale: false });
    // TTE : 20 × 55,10 + 3,31 de taxes → PRU 55,2655.
    expect(r.lines.find((l) => l.symbol === 'TTE')!.pru).toBe('55.2655');
    expect(r.summary.day_change_date).toBe('2026-11-19');
  });

  it('performances : origine au 28/09, périodes plus longues que l’historique refusées', () => {
    const byKey = Object.fromEntries(r.performance.periods.map((p) => [p.key, p]));
    expect(byKey.ORIGIN.from).toBe('2026-09-28');
    expect(byKey.ORIGIN.twr).not.toBeNull();
    expect(byKey.ORIGIN.irr_annualized).toBe(false);
    expect(byKey['1M'].twr).not.toBeNull();
    expect(byKey['3M']).toMatchObject({ twr: null, reason: 'historique plus court que la période' });
    expect(byKey.ORIGIN.benchmarks.map((b) => b.key)).toEqual(['msci-world', 'sp500']);
    const msci = r.performance.benchmarks.find((b) => b.key === 'msci-world')!;
    expect(msci.series[0]).toEqual({ date: '2026-09-27', index: 100 });
    expect(r.performance.chart[0]).toMatchObject({ date: '2026-09-27', index: 100 });
  });

  it('allocation : ventilation des fiches, siège des actions, part non ventilée, liquidités', () => {
    const country = Object.fromEntries(r.allocation.country.map((b) => [b.label, b.pct]));
    expect(Object.keys(country)).toEqual(expect.arrayContaining(['États-Unis', 'Japon', 'France', 'Non ventilé', 'Liquidités']));
    expect(r.allocation.country.reduce((s, b) => s + b.pct, 0)).toBeCloseTo(1, 4);
    expect(r.allocation.sector.reduce((s, b) => s + b.pct, 0)).toBeCloseTo(1, 4);
    expect(r.allocation.sources).toEqual([{ instrument: 'Amundi MSCI World Swap UCITS ETF EUR Acc', as_of: '2026-10-31',
      url: 'https://www.amundietf.fr/', label: 'fiche mensuelle', stale: false }]);
  });

  it('risques : historique trop court, raison donnée ; dividendes reçus', () => {
    expect(r.risk.volatility).toBeNull();
    expect(r.risk.reason).toMatch(/historique trop court : \d+ jour\(s\) ouvré\(s\), 60 au moins/);
    expect(r.risk.max_drawdown!.value).toBeLessThanOrEqual(0);
    expect(r.dividends).toMatchObject({ total: 15.8, by_month: [{ month: '2026-10', net: 15.8 }] });
  });

  it('filtre par enveloppe', () => {
    const cto = buildReport(syntheticData(), 2, NOW);
    expect(cto.lines.map((l) => l.symbol)).toEqual(['AAPL']);
    expect(cto.summary.transactions).toBe(3);
    expect(cto.summary.income).toBe(0.42);
  });

  it('cours manquant : valeur totale « — », valeur partielle et raison', () => {
    const data = syntheticData();
    data.prices = data.prices.filter((p) => p.listing_id !== 3);
    const x = buildReport(data, null, NOW);
    expect(x.summary).toMatchObject({ value: null, complete: false });
    expect(x.lines.find((l) => l.symbol === 'AAPL')).toMatchObject({ value: null, missing_reason: 'aucune clôture relevée pour cette cotation' });
  });
});
