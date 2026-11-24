// @vitest-environment node
// Calculs de P4 (S2) : percentile sur 252 séances, inversion du VIX et du crédit, zones, composantes
// manquantes ou arrêtées, COT sur 3 ans, écart des ratios à leur moyenne, liquidité nette.
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { COT_MARKETS } from './catalog.ts';
import { publishAll } from './publish.ts';
import { asOf, computeRisk, cotSummary, crowdingSummary, netLiquidity, type Obs, percentileRank, WINDOW, zoneOf } from './sentiment.ts';

/** Jours de semaine à partir du lundi 02/01/2023. */
function weekdays(n: number): string[] {
  const out: string[] = [];
  for (let t = Date.UTC(2023, 0, 2); out.length < n; t += 86_400_000) {
    const d = new Date(t).getUTCDay();
    if (d >= 1 && d <= 5) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const mk = (dates: string[], f: (i: number) => number, adj = false): Obs[] => dates.map((date, i) => ({ date, value: f(i), ...(adj ? { adj: f(i) } : {}) }));

/** 700 séances ; chaque composante monte de plus en plus vite : percentile 100 (0 pour VIX et crédit, inversés). */
function market(n = 700): Record<string, Obs[]> {
  const d = weekdays(n);
  const accel = (base: number) => (i: number) => base * Math.exp(1e-6 * i * i);
  return {
    SPY: mk(d, accel(400), true), TLT: mk(d, () => 90, true), CPER: mk(d, accel(25), true), GLD: mk(d, () => 180, true),
    VIX: mk(d, (i) => 12 + i / 50), HY_OAS: mk(d, (i) => 3 + 1e-5 * i * i), AUDJPY: mk(d, accel(95)),
    BTC: mk(d, accel(20000)), ETH: mk(d, accel(1500)),
  };
}

describe('outils', () => {
  it('percentile : part des autres valeurs inférieures, égalités pour moitié', () => {
    expect(percentileRank([1, 2, 3, 4, 5])).toBe(100);
    expect(percentileRank([5, 4, 3, 2, 1])).toBe(0);
    expect(percentileRank([1, 3, 2])).toBe(50);
    expect(percentileRank([2, 2, 2])).toBe(50);
    expect(percentileRank([1, 3, 2, 3])).toBeCloseTo((100 * (2 + 0.5)) / 3);
  });
  it('zones de la maquette : bornes basses incluses', () => {
    expect([0, 24.9, 25, 44.9, 45, 55, 74.9, 75, 100].map((v) => zoneOf(v).id)).toEqual(
      ['risk_off_strong', 'risk_off_strong', 'risk_off', 'risk_off', 'neutral', 'risk_on', 'risk_on', 'risk_on_strong', 'risk_on_strong']);
  });
  it('valeur à la séance : dernière observation, 7 jours au plus', () => {
    const obs = [{ date: '2026-11-02', value: 1 }, { date: '2026-11-04', value: 2 }];
    expect(asOf(['2026-11-01', '2026-11-03', '2026-11-11', '2026-11-12'], obs)).toEqual([null, 1, 2, null]);
  });
});

describe('indice de risque', () => {
  it('7 composantes, inversions, indice et zone, variations sur 1 semaine et 1 mois', () => {
    const r = computeRisk(market())!;
    expect(r.components_used).toBe(7);
    const p = Object.fromEntries(r.components.map((c) => [c.id, c.percentile]));
    expect(p).toEqual({ vix: 0, trend: 100, credit: 0, audjpy: 100, copper_gold: 100, stocks_bonds: 100, crypto: 100 });
    expect(r.index).toBeCloseTo(500 / 7, 1);
    expect(r.zone).toBe('risk_on');
    const d = weekdays(700);
    expect(r.date).toBe(d[699]);
    expect(r.week_ago!.date).toBe(d[694]);
    expect(r.month_ago!.date).toBe(d[678]);
    expect(r.history.length).toBe(WINDOW);
    expect(r.spy.length).toBe(WINDOW);
    expect(r.vix.at(-1)!.value).toBeCloseTo(12 + 699 / 50);
    expect(r.components.find((c) => c.id === 'credit')!.raw).toBeCloseTo(1e-5 * (699 ** 2 - 679 ** 2), 2);
  });
  it('VIX de Cboe complété par FRED', () => {
    const m = market();
    const vix = m.VIX;
    m.VIX = vix.slice(0, -3);
    m.VIX_FRED = vix.slice(-3).map((o) => ({ ...o, value: o.value }));
    expect(computeRisk(m)!.components.find((c) => c.id === 'vix')!.percentile).toBe(0);
  });
  it('série absente, série arrêtée, historique court : composante exclue avec sa raison', () => {
    const m = market();
    delete (m as Partial<typeof m>).HY_OAS;
    m.AUDJPY = m.AUDJPY.slice(0, -10);
    m.BTC = m.BTC.slice(-200);
    const r = computeRisk(m)!;
    const why = Object.fromEntries(r.components.map((c) => [c.id, c.reason]));
    expect(why.credit).toBe('série HY_OAS absente');
    expect(why.audjpy).toMatch(/^série AUDJPY arrêtée au \d{4}-\d{2}-\d{2}$/);
    expect(why.crypto).toBe(`historique insuffisant (${200 - 20} séances sur ${WINDOW})`);
    expect(r.components_used).toBe(4);
    expect(r.index).toBeCloseTo((0 + 100 + 100 + 100) / 4, 1);
  });
  it('moins de 4 composantes : pas d’indice', () => {
    const m = market();
    for (const k of ['HY_OAS', 'AUDJPY', 'BTC', 'CPER'] as const) delete (m as Partial<typeof m>)[k];
    const r = computeRisk(m)!;
    expect(r.components_used).toBe(3);
    expect(r.index).toBeNull();
    expect(r.zone).toBeNull();
  });
  it('sans séance : rien', () => {
    expect(computeRisk({})).toBeNull();
  });
});

describe('COT', () => {
  const rows = (weeks: number) => weekdays(weeks * 5).filter((_, i) => i % 5 === 1).flatMap((date, i) => [
    { market_code: '099741', date, category: 'lev_money', long: 1000 + i * 10, short: 1000, open_interest: 10000 },
    { market_code: '099741', date, category: 'dealer', long: 500, short: 500 + i, open_interest: 10000 },
  ]);
  it('net, variation sur une semaine, part de l’intérêt ouvert, percentile sur 3 ans', () => {
    const s = cotSummary(rows(200), COT_MARKETS);
    const eur = s.markets.find((m) => m.code === '099741')!;
    expect(eur.categories.lev_money).toMatchObject({ net: 1990, net_change_1w: 10, net_pct_oi: 19.9, percentile_3y: 100, weeks: 156 });
    expect(eur.categories.dealer.percentile_3y).toBe(0);
    expect(eur.history.dates.length).toBe(156);
    expect(s.report_date).toBe(eur.date);
    expect(s.markets.length).toBe(1);   // marchés sans ligne : absents, pas inventés
  });
  it('moins d’un an de rapports : percentile absent', () => {
    expect(cotSummary(rows(30), COT_MARKETS).markets[0].categories.lev_money.percentile_3y).toBeNull();
  });
});

describe('sentiment retail', () => {
  const NOW = Date.UTC(2026, 10, 24, 12);
  const hourly = (h: number, f: (i: number) => number, metric = 'account') => Array.from({ length: h }, (_, i) => ({
    exchange: 'binance', symbol: 'BTC', metric, ts: new Date(NOW - (h - 1 - i) * 3_600_000).toISOString(), value: f(i), long_share: null }));
  it('écart à la moyenne sur 30 jours ; historique partiel signalé', () => {
    const s = crowdingSummary(hourly(500, (i) => (i === 499 ? 3 : 2)), NOW).BTC.binance.account;
    expect(s.last).toBe(3);
    expect(s.avg_30d).toBeCloseTo((499 * 2 + 3) / 500, 4);
    expect(s.deviation_pct).toBeCloseTo((3 / ((499 * 2 + 3) / 500) - 1) * 100, 1);
    expect(s.partial).toBe(true);
    expect(s.spark.length).toBe(72);
    const full = crowdingSummary(hourly(800, () => 2), NOW).BTC.binance.account;
    expect(full).toMatchObject({ partial: false, deviation_pct: 0 });
    expect(full.days_covered).toBeLessThanOrEqual(30);
  });
  it('financement : dernier taux, sans moyenne', () => {
    const f = crowdingSummary(hourly(3, (i) => 0.0001 * (i + 1), 'funding'), NOW).BTC.binance.funding;
    expect(f.last).toBeCloseTo(0.0003, 10);
    expect(f).toMatchObject({ avg_30d: null, deviation_pct: null });
  });
});

describe('liquidité nette', () => {
  it('mercredis, reverse repo en milliards converti, variations', () => {
    const wed = ['2026-11-04', '2026-11-11', '2026-11-18'];
    const r = netLiquidity(wed.map((date, i) => ({ date, value: 6_741_452 + i * 1000 })),
      [...wed.map((date) => ({ date, value: 892_310 })), { date: '2026-11-19', value: 1 }],
      [{ date: '2026-11-03', value: 0.5 }, { date: '2026-11-10', value: 0.4 }, { date: '2026-11-17', value: 0.35 }]);
    expect(r.last).toEqual({ date: '2026-11-18', walcl: 6_743_452, tga: 892_310, rrp: 350, net: 6_743_452 - 892_310 - 350 });
    expect(r.history.length).toBe(3);
    expect(r.changes.w1).toBe(1000 + 50);
    expect(r.changes.w4).toBeNull();
  });
  it('reverse repo manquant une semaine : point retiré, aucune variation calculée sur un autre écart', () => {
    const wed = ['2026-11-04', '2026-11-11', '2026-11-18'];
    const r = netLiquidity(wed.map((date) => ({ date, value: 100 })), wed.map((date) => ({ date, value: 10 })),
      [{ date: '2026-11-03', value: 0 }, { date: '2026-11-17', value: 0 }]);
    expect(r.history.map((p) => p.date)).toEqual(['2026-11-04', '2026-11-18']);
    expect(r.changes.w1).toBeNull();
  });
});

describe('publication', () => {
  it('quatre états écrits depuis les tables ; indice avec ses composantes', async () => {
    const rest = new MemRest();
    const NOW = Date.UTC(2025, 8, 15);
    for (const [id, obs] of Object.entries(market())) {
      for (const o of obs) rest.rows('sentiment_series').push({ series_id: id, date: o.date, value: o.value, adj: o.adj ?? null, source: 'test', ts_recv: 'x' });
    }
    const r = await publishAll(rest, NOW);
    expect((r.risk as { used: number }).used).toBe(7);
    const keys = rest.rows('p4_state').map((x) => x.key).sort();
    expect(keys).toEqual(['cot', 'crowding', 'liquidity', 'risk']);
    const risk = rest.rows('p4_state').find((x) => x.key === 'risk')!.value as { computed_ms: number; zone: string };
    expect(risk).toMatchObject({ computed_ms: NOW, zone: 'risk_on' });
  });
});
