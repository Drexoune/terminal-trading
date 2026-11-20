// Moteur du portefeuille (B1) : décimal exact, registre des opérations,
// valorisation, TWR, Dietz modifié, TRI (XIRR d'Excel), risques.
import { describe, expect, it } from 'vitest';
import { add, dec, div, mul, toNumber, toText } from '../_lib/bourse/decimal.js';
import {
  betaCorrelation, buildSeries, investorFlows, lastAtOrBefore, maxDrawdown, modifiedDietz, type Market,
  MIN_DAYS_FOR_RISK, toEur, type Txn, volatility, weekdayReturns, xirr,
} from '../_lib/bourse/portfolio.js';

const d = (s: string) => dec(s)!;

describe('décimal exact', () => {
  it('lecture, opérations et arrondi', () => {
    expect(toText(add(d('0.1'), d('0.2')), 2)).toBe('0.30');
    expect(toText(add(d('0.1'), d('0.2')), 10)).toBe('0.3000000000');
    expect(toText(mul(d('29.6571'), d('58.75')), 4)).toBe('1742.3546');
    expect(toText(div(d('1'), d('3')), 6)).toBe('0.333333');
    expect(toText(d('-1234.565'), 2)).toBe('-1234.57');
    expect(toText(d('2.005'), 2)).toBe('2.01');
    expect(dec('1e3')).toBeNull();
    expect(dec('1,5')).toBeNull();
    expect(dec(12.5)).toBe(d('12.5'));
    expect(toNumber(d('1234.5'))).toBe(1234.5);
  });
});

describe('TRI : XIRR d’Excel', () => {
  it('exemple de la documentation Microsoft (37,34 %)', () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 }, { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 }, { date: '2009-02-15', amount: 3250 }, { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).toBeCloseTo(0.373362535, 6);
  });

  it('un an exact à +10 %, perte, et TRI non défini', () => {
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 110 }])).toBeCloseTo(0.1, 9);
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 80 }])).toBeCloseTo(-0.2, 9);
    expect(xirr([{ date: '2025-01-01', amount: -100 }, { date: '2025-06-01', amount: -50 }])).toBeNull();
  });
});

// Marché d'essai : cotation 1 en EUR, cotation 2 en USD, change EUR/USD.
function market(closes: Record<number, [string, string][]>, fx: [string, string][] = []): Market {
  return {
    listings: new Map([[1, { id: 1, currency: 'EUR' }], [2, { id: 2, currency: 'USD' }]]),
    closes: new Map(Object.entries(closes).map(([k, v]) => [Number(k), v.map(([date, close]) => ({ date, close }))])),
    fx: new Map([['USD', fx.map(([date, per_eur]) => ({ date, per_eur }))]]),
  };
}

let nextId = 1;
function tx(trade_date: string, kind: Txn['kind'], over: Partial<Txn> = {}): Txn {
  return { id: nextId++, envelope_id: 1, trade_date, kind, listing_id: null, quantity: null, price: null, amount: null,
    fees: '0', taxes: '0', currency: 'EUR', fx_rate: null, target_currency: null, ratio_new: null, ratio_old: null, ...over };
}

describe('registre et valorisation', () => {
  // Lundi 05/10/2026 : versement de 1 000 €, achat de 10 titres à 50 € + 1 € de frais.
  const txns = [
    tx('2026-10-05', 'depot', { amount: '1000' }),
    tx('2026-10-05', 'achat', { listing_id: 1, quantity: '10', price: '50', fees: '1' }),
    tx('2026-10-07', 'vente', { listing_id: 1, quantity: '4', price: '60', fees: '1' }),
  ];
  const m = market({ 1: [['2026-10-02', '49'], ['2026-10-05', '52'], ['2026-10-06', '55'], ['2026-10-07', '60']] });

  it('positions, liquidités, PRU au coût moyen, plus-value réalisée', () => {
    const s = buildSeries(txns, m, '2026-10-05', '2026-10-07');
    const p = s.ledger.positions.get(1)!;
    expect(toText(p.qty, 4)).toBe('6.0000');
    // Coût 501 € pour 10 titres → 300,60 € pour les 6 restants : PRU inchangé (50,10 €).
    expect(toText(p.cost, 2)).toBe('300.60');
    // Vente : 240 − 1 = 239 € nets, moins 200,40 € de coût → 38,60 €.
    expect(toText(p.realized, 2)).toBe('38.60');
    expect(toText(s.ledger.cash.get('EUR')!, 2)).toBe('738.00');
  });

  it('valeur quotidienne et TWR à flux en début de journée', () => {
    const s = buildSeries(txns, m, '2026-10-05', '2026-10-07');
    expect(s.points.map((p) => [p.date, p.value, p.flow])).toEqual([
      ['2026-10-04', 0, 0],
      ['2026-10-05', 1019, 1000],      // 499 € d'espèces + 10 × 52
      ['2026-10-06', 1049, 0],         // 499 + 10 × 55
      ['2026-10-07', 1098, 0],         // 738 + 6 × 60
    ]);
    const idx = s.points.map((p) => p.index);
    expect(idx[1]).toBeCloseTo(101.9, 10);
    expect(idx[2]).toBeCloseTo(101.9 * 1049 / 1019, 10);
    expect(idx[3]).toBeCloseTo(109.8, 10);   // 1 098 / 1 000 : aucun flux après le versement
  });

  it('Dietz modifié et TRI sur la même période', () => {
    const s = buildSeries(txns, m, '2026-10-05', '2026-10-07');
    // V0 = 0, apport de 1 000 € le premier jour (poids 3/3), V = 1 098 € → 9,8 %.
    expect(modifiedDietz(s.points, '2026-10-05', '2026-10-07')).toBeCloseTo(0.098, 12);
    const flows = investorFlows(s.points, '2026-10-05', '2026-10-07')!;
    expect(flows).toEqual([
      { date: '2026-10-04', amount: -0 }, { date: '2026-10-05', amount: -1000 }, { date: '2026-10-07', amount: 1098 },
    ]);
    // Sur la période de 3 jours (base = 3) : 1 000 / (1 + r)^(1/3) = 1 098 / (1 + r) → r = 1,098^1,5 − 1.
    expect(xirr(flows, 3)).toBeCloseTo(1.098 ** 1.5 - 1, 9);
  });

  it('cours manquant : journée incomplète, indice interrompu, rien d’inventé', () => {
    const s = buildSeries(txns, market({ 1: [['2026-10-06', '55']] }), '2026-10-05', '2026-10-07');
    expect(s.points[1]).toMatchObject({ date: '2026-10-05', value: null, index: null });
    expect(s.points[1].missing).toEqual(['cours de la cotation 1']);
    expect(s.points[3].index).toBeNull();
  });

  it('fin de semaine : dernière clôture connue, rendement nul', () => {
    const s = buildSeries([tx('2026-10-09', 'depot', { amount: '100' }), tx('2026-10-09', 'achat', { listing_id: 1, quantity: '1', price: '100' })],
      market({ 1: [['2026-10-09', '100'], ['2026-10-12', '110']] }), '2026-10-09', '2026-10-12');
    expect(s.points.map((p) => p.value)).toEqual([0, 100, 100, 100, 110]);
    expect(s.points.at(-1)!.index).toBeCloseTo(110, 10);
  });

  it('titre en dollars : achat avec taux, valorisation au cours BCE', () => {
    // 1 USD = 0,9 EUR à l'achat ; BCE : 1 EUR = 1,10 USD puis 1,20 USD.
    const s = buildSeries([
      tx('2026-11-02', 'depot', { amount: '1000' }),
      tx('2026-11-02', 'achat', { listing_id: 2, quantity: '5', price: '100', fx_rate: '0.9' }),
    ], market({ 2: [['2026-11-02', '100'], ['2026-11-03', '110']] }, [['2026-11-02', '1.1'], ['2026-11-03', '1.2']]), '2026-11-02', '2026-11-03');
    expect(toText(s.ledger.positions.get(2)!.cost, 2)).toBe('450.00');
    expect(s.points.at(-1)!.value).toBeCloseTo(550 + 550 / 1.2, 8);
    expect(toEur(d('110'), 'USD', '2026-11-01', market({}, [['2026-11-02', '1.1']]))).toBeNull();
  });

  it('division, actions gratuites, dividende net, intérêts, taxes et change', () => {
    const s = buildSeries([
      tx('2026-10-01', 'depot', { amount: '500' }),
      tx('2026-10-01', 'achat', { listing_id: 1, quantity: '2', price: '100' }),
      tx('2026-10-02', 'split', { listing_id: 1, ratio_new: '10', ratio_old: '1' }),
      tx('2026-10-02', 'actions_gratuites', { listing_id: 1, quantity: '1' }),
      tx('2026-10-05', 'dividende', { listing_id: 1, amount: '10', taxes: '1.28' }),
      tx('2026-10-05', 'interets', { amount: '-0.5' }),
      tx('2026-10-05', 'taxes', { amount: '-2' }),
      tx('2026-10-05', 'change', { amount: '100', target_currency: 'USD', fx_rate: '1.1' }),
    ], market({ 1: [['2026-10-01', '100'], ['2026-10-05', '10']] }, [['2026-10-01', '1.1']]), '2026-10-01', '2026-10-05');
    expect(toText(s.ledger.positions.get(1)!.qty, 0)).toBe('21');
    expect(toText(s.ledger.positions.get(1)!.cost, 2)).toBe('200.00');
    expect(toText(s.ledger.cash.get('EUR')!, 2)).toBe('210.22');   // 500 − 200 + 8,72 − 0,5 + 2 − 100
    expect(toText(s.ledger.cash.get('USD')!, 2)).toBe('110.00');
    expect(s.dividends).toEqual([{ date: '2026-10-05', listing_id: 1, net: 8.72 }]);
    expect(s.points.at(-1)!.value).toBeCloseTo(210 + 210.22 + 100, 8);
  });

  it('sans gestion des liquidités : les achats et les ventes sont les flux', () => {
    const s = buildSeries([
      tx('2026-10-05', 'achat', { listing_id: 1, quantity: '10', price: '50' }),
    ], market({ 1: [['2026-10-05', '50'], ['2026-10-06', '55']] }), '2026-10-05', '2026-10-06');
    expect(s.ledger.cashTracked).toBe(false);
    expect(s.points.map((p) => [p.value, p.flow])).toEqual([[0, 0], [500, 500], [550, 0]]);
    expect(s.points.at(-1)!.index).toBeCloseTo(110, 10);
  });
});

describe('risques', () => {
  it('volatilité : null sous 60 jours, valeur connue au-delà', () => {
    expect(volatility(Array(MIN_DAYS_FOR_RISK - 1).fill(0.01))).toBeNull();
    const alt = Array.from({ length: 60 }, (_, k) => (k % 2 ? 0.01 : -0.01));
    // Écart-type d'échantillon de ±1 % : 0,01 × √(60/59).
    expect(volatility(alt)).toBeCloseTo(0.01 * Math.sqrt(60 / 59) * Math.sqrt(252), 12);
  });

  it('perte maximale', () => {
    const levels = [100, 120, 90, 110, 80, 130].map((level, k) => ({ date: `2026-10-0${k + 1}`, level }));
    expect(maxDrawdown(levels)).toEqual({ value: 80 / 120 - 1, peak: '2026-10-02', trough: '2026-10-05' });
  });

  it('bêta 2 et corrélation 1 quand le portefeuille vaut deux fois le benchmark', () => {
    const bench = new Map<string, number>();
    const port = new Map<string, number>();
    for (let k = 0; k < 60; k++) { const r = Math.sin(k) / 100; bench.set(`d${k}`, r); port.set(`d${k}`, 2 * r); }
    const r = betaCorrelation(port, bench)!;
    expect(r.beta).toBeCloseTo(2, 12);
    expect(r.correlation).toBeCloseTo(1, 12);
    expect(betaCorrelation(new Map([...port].slice(0, 59)), bench)).toBeNull();
  });

  it('rendements des jours ouvrés seulement', () => {
    const r = weekdayReturns([
      { date: '2026-10-09', level: 100 }, { date: '2026-10-10', level: 100 }, { date: '2026-10-12', level: 110 },
    ]);
    expect([...r]).toEqual([['2026-10-12', 0.10000000000000009]]);
  });

  it('dernier point ≤ date', () => {
    const pts = [{ date: '2026-10-01' }, { date: '2026-10-05' }, { date: '2026-10-09' }];
    expect(lastAtOrBefore(pts, '2026-09-30')).toBeNull();
    expect(lastAtOrBefore(pts, '2026-10-07')).toEqual({ date: '2026-10-05' });
    expect(lastAtOrBefore(pts, '2026-10-09')).toEqual({ date: '2026-10-09' });
  });
});
