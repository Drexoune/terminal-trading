// @vitest-environment node
// Règles d'alerte en ligne (O4) contre le fichier doré de Python (alert_rules.py).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe as group, expect, it } from 'vitest';
import * as ar from './alert_rules.ts';

const G = JSON.parse(readFileSync(fileURLToPath(new URL('../../../gateway/tests/fixtures/alerts_golden.json', import.meta.url)), 'utf8'));
const INST = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];

group('règles d’alerte en ligne : portage de alert_rules.py', () => {
  it('validation, canaux et libellés', () => {
    for (const [kind, params, chans, want] of G.rules) {
      let got: unknown;
      try {
        const [p, c] = ar.validate(kind, params, chans, INST);
        got = { params: p, channels: c, describe: ar.describe(kind, p) };
      } catch (e) {
        got = { error: (e as Error).message };
      }
      expect(got, `${kind} ${JSON.stringify(params)}`).toEqual(want);
    }
  });

  it('nombres à la française', () => {
    for (const [x, d, s, want] of G.fr_num) expect(ar.frNum(x, d, s), String(x)).toBe(want);
  });

  it('conditions de déclenchement', () => {
    for (const [p, prev, px, want] of G.price_crossed) expect(ar.priceCrossed(p, prev, px)).toBe(want);
    for (const [p, r, want] of G.funding_hit) expect(ar.fundingHit(p, r), `${r}`).toBe(want);
    for (const [p, e, want] of G.event_matches) expect(ar.eventMatches(p, e)).toBe(want);
    for (const [w, t, want] of G.keyword_hit) expect(ar.keywordHit({ words: w }, t)).toBe(want);
    for (const [p, f, want] of G.surprise_hit) expect(ar.surpriseHit(p, f)).toBe(want);
    for (const [p, i, want] of G.news_category_hit) expect(ar.newsCategoryHit(p, i)).toBe(want);
    for (const [p, g, want] of G.rate_gap_hit) expect(ar.rateGapHit(p, g)).toBe(want);
  });

  it('messages, au caractère près', () => {
    const m = G.messages;
    const FIG = { indicator: 'us-cpi-mm', label_fr: 'IPC (m/m)', unit: '%', value: '0.6', forecast: '0.3', surprise: '0.3', z: '2.1' };
    const sp = { minutes: 5, captured_only: true, impacts: [], currencies: [] };
    expect(ar.priceMessage({ inst: 'BTC-USDT-SWAP', level: '110000' }, 109999.5, 110000.5)).toEqual(m.price);
    expect(ar.fundingMessage({ inst: 'BTC-USDT-SWAP', threshold_pct: '0.02', side: 'au-dessus' }, 0.000312)).toEqual(m.funding);
    expect(ar.eventMessage(sp, { capture: true, currency: 'USD', title: 'CPI m/m', title_fr: 'IPC (m/m)', forecast_raw: '0.3%' }, '14:30')).toEqual(m.event);
    expect(ar.eventMessage(sp, { capture: false, currency: 'EUR', title: 'Flash PMI', title_fr: null, forecast_raw: null }, '10:00')).toEqual(m.event_no_fc);
    expect(ar.releaseMessage({ title: 'Consumer Price Index', period: '2026-11', edition: null, nature: 'officielle' },
      [FIG, { ...FIG, indicator: 'us-cpi-yy', label_fr: 'IPC (sur un an)', value: null, reason: 'non publié' }])).toEqual(m.release);
    expect(ar.releaseMessage({ title: 'Productivity and Costs', period: '2026-Q3', edition: 'Revised', nature: 'rattrapage' }, [])).toEqual(m.release_catchup);
    expect(ar.surpriseMessage(FIG)).toEqual(m.surprise);
    expect(ar.keywordMessage('Powell', { title: 'Powell speaks', source: 'Fed' })).toEqual(m.keyword);
    const EW = { event_id: '552-us-flash-manufacturing-pmi|USD|2026-11-23|1', title: 'Flash Manufacturing PMI', currency: 'USD', time_ms: 1795409100000 };
    expect(ar.eventWatchMessage(EW, { title: 'Flash Manufacturing PMI', title_fr: null, forecast_raw: '54.5', previous_raw: '54.9' },
      '54,5', 'FinancialJuice (fil d’actus)')).toEqual(m.event_watch);
    expect(ar.eventWatchMessage(EW, { title: 'CPI m/m', title_fr: 'IPC (m/m)', forecast_raw: null, previous_raw: '0.3%' }, '0,6\u00a0%', 'BLS')).toEqual(m.event_watch_fr);
    expect(ar.eventMissingMessage(EW, { title: 'Flash Manufacturing PMI' }, '15:45')).toEqual(m.event_missing);
    const GAP = { bank: 'FED', meeting: '2026-12-09', pts: '6.2', outcome: 'Statu quo', sources: ['Polymarket', 'Kalshi'], values: ['86.5', '80.3'] };
    expect(ar.rateGapMessage({ bank: 'FED', threshold_pts: '5' }, GAP)).toEqual(m.rate_gap);
    expect(ar.newsCategoryMessage({ category: 'crypto', urgent_only: false }, { title: 'Spot bitcoin ETFs', source: 'FinancialJuice', urgent: true })).toEqual(m.news_category);
  });
});
