// Portefeuille synthétique (B1) : titres génériques, cours déterministes. Sert
// au test du rapport et à la fausse réponse de l'écran Portefeuille dans
// Playwright (web/e2e/fixtures/portfolio.json). Aucune donnée réelle.

import type { LoadedData } from '../_lib/bourse/report.js';
import { addDays, isWeekday } from '../_lib/bourse/portfolio.js';

/** Cours déterministe : marche pseudo-aléatoire reproductible. */
function walk(seed: number, start: number, from: string, to: string, drift = 0.0004): { date: string; close: string }[] {
  let x = seed;
  let p = start;
  const out: { date: string; close: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    x = (x * 16807) % 2147483647;
    p *= 1 + drift + ((x / 2147483647) - 0.5) * 0.024;
    out.push({ date: d, close: p.toFixed(4) });
  }
  return out;
}

export function syntheticData(): LoadedData {
  const from = '2026-07-01';
  const to = '2026-11-19';
  const inst = (id: number, name: string, isin: string, kind: string, hq: string | null, pea: boolean) =>
    ({ id, name, isin, kind, hq_country: hq, pea_eligible: pea, pea_reason: pea ? 'exemple éligible' : 'siège hors UE' });
  const listings = [
    { id: 1, symbol: 'TTE', mic: 'XPAR', currency: 'EUR', price_source: 'alphavantage', source_symbol: 'TTE.PAR', tracked: true, instruments: inst(1, 'TotalEnergies', 'FR0000120271', 'action', 'FR', true) },
    { id: 2, symbol: 'CW8', mic: 'XPAR', currency: 'EUR', price_source: 'alphavantage', source_symbol: 'CW8.PAR', tracked: true, instruments: inst(2, 'Amundi MSCI World Swap UCITS ETF EUR Acc', 'LU1681043599', 'etf', null, true) },
    { id: 3, symbol: 'AAPL', mic: 'XNAS', currency: 'USD', price_source: 'massive', source_symbol: 'AAPL', tracked: true, instruments: inst(3, 'Apple', 'US0378331005', 'action', 'US', false) },
    { id: 4, symbol: 'SPX5', mic: 'XPAR', currency: 'EUR', price_source: 'alphavantage', source_symbol: 'SPX5.PAR', tracked: true, instruments: inst(4, 'ETF S&P 500 de référence', 'FR0011550185', 'etf', null, true) },
  ];
  const prices = [
    ...walk(7, 55, from, to).map((p) => ({ listing_id: 1, value_date: p.date, close: p.close, source: 'Alpha Vantage', received_at: `${addDays(p.date, 1)}T06:30:05Z` })),
    ...walk(11, 560, from, to).map((p) => ({ listing_id: 2, value_date: p.date, close: p.close, source: 'Alpha Vantage', received_at: `${addDays(p.date, 1)}T06:30:07Z` })),
    ...walk(13, 210, from, to, 0.0008).map((p) => ({ listing_id: 3, value_date: p.date, close: p.close, source: 'Massive', received_at: `${addDays(p.date, 1)}T06:15:03Z` })),
    ...walk(17, 33, from, to).map((p) => ({ listing_id: 4, value_date: p.date, close: p.close, source: 'Alpha Vantage', received_at: `${addDays(p.date, 1)}T06:30:09Z` })),
  ];
  const fx = walk(19, 1.08, from, to, 0).map((p) => ({ value_date: p.date, currency: 'USD', per_eur: Number(p.close).toFixed(4) }));
  let id = 1;
  const t = (envelope_id: number, trade_date: string, kind: string, o: Record<string, string | number | null> = {}) => ({
    id: id++, envelope_id, trade_date, kind, listing_id: null, quantity: null, price: null, amount: null, fees: '0', taxes: '0',
    currency: 'EUR', fx_rate: null, target_currency: null, ratio_new: null, ratio_old: null, ...o,
  }) as LoadedData['txns'][number];
  const txns = [
    t(1, '2026-09-21', 'depot', { amount: '3000' }),
    t(1, '2026-09-22', 'achat', { listing_id: 1, quantity: '20', price: '55.10', taxes: '3.31' }),
    t(1, '2026-09-23', 'achat', { listing_id: 2, quantity: '3', price: '561.20', fees: '1' }),
    t(1, '2026-10-20', 'dividende', { listing_id: 1, amount: '15.80', taxes: '0' }),
    t(1, '2026-11-12', 'depot', { amount: '500' }),
    t(1, '2026-11-12', 'achat', { listing_id: 2, quantity: '1', price: '575' }),
    t(2, '2026-09-18', 'depot', { amount: '400' }),
    t(2, '2026-10-03', 'interets', { amount: '0.42' }),
    t(2, '2026-11-11', 'achat', { listing_id: 3, quantity: '1', price: '215', fx_rate: '0.86' }),
  ];
  return {
    envelopes: [
      { id: 1, kind: 'PEA', broker: 'Courtier', name: 'PEA · Courtier', currency: 'EUR', perf_start: '2026-09-28' },
      { id: 2, kind: 'CTO', broker: 'Courtier', name: 'CTO · Courtier', currency: 'EUR', perf_start: '2026-09-28' },
    ],
    txns,
    listings,
    prices,
    fx,
    exposures: [
      { instrument_id: 2, axis: 'pays', bucket: 'États-Unis', weight: '71.2', as_of: '2026-10-31', source_url: 'https://www.amundietf.fr/', source_label: 'fiche mensuelle' },
      { instrument_id: 2, axis: 'pays', bucket: 'Japon', weight: '5.4', as_of: '2026-10-31', source_url: 'https://www.amundietf.fr/', source_label: 'fiche mensuelle' },
      { instrument_id: 2, axis: 'secteur', bucket: 'Technologie', weight: '26.1', as_of: '2026-10-31', source_url: 'https://www.amundietf.fr/', source_label: 'fiche mensuelle' },
    ],
  };
}
