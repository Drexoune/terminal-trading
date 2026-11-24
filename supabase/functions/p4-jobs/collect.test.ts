// @vitest-environment node
// Tâches de collecte de P4 (S1) sur la base simulée, réponses réelles du 24/11/2026 : lignes
// écrites, état des séries et des flux, erreurs visibles sans effacer l'acquis, clé jamais recopiée.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { type CollectDeps, runCloses, runCot, runCrowding, runLiquidity } from './collect.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 10, 24, 22, 30);
const KEY = 'tiingo-cle-de-test-123456';
const TIINGO_EOD = '[{"date":"2026-11-20T00:00:00.000Z","close":700,"adjClose":699},{"date":"2026-11-23T00:00:00.000Z","close":722.29,"adjClose":722.29}]';
const TIINGO_FX = '[{"date":"2026-11-22T00:00:00.000Z","close":105.1},{"date":"2026-11-23T00:00:00.000Z","close":105.4}]';

function respond(url: string): [number, string] {
  if (url.includes('cboe.com')) return [200, fx('cboe-vix-2026-11-24.csv')];
  if (url.includes('fred') && url.includes('VIXCLS')) return [200, fx('fred-vixcls-2026-11-24.csv')];
  if (url.includes('fred') && url.includes('WALCL')) return [200, fx('fred-walcl-2026-11-24.csv')];
  if (url.includes('fred') && url.includes('RRPONTSYD')) return [200, fx('fred-rrpontsyd-2026-11-24.csv')];
  if (url.includes('fred')) return [200, 'observation_date,X\n2026-11-18,892310\n2026-11-20,3.76\n'];
  if (url.includes('tiingo/fx')) return [200, TIINGO_FX];
  if (url.includes('tiingo')) return [200, TIINGO_EOD];
  if (url.includes('history-candles')) return [200, fx('okx-candles-btc-2026-11-24.json')];
  if (url.includes('publicreporting.cftc.gov')) return [200, fx('cftc-tff-futures-2026-11-24.json')];
  if (url.includes('premiumIndex')) return [200, fx('binance-premium-btc-2026-11-24.json')];
  if (url.includes('fapi.binance.com')) return [200, fx('binance-global-account-btc-2026-11-24.json')];
  if (url.includes('funding-rate')) return [200, fx('okx-funding-btc-2026-11-24.json')];
  if (url.includes('rubik')) return [200, fx('okx-ratio-contract-btc-2026-11-24.json')];
  if (url.includes('tickers')) return [200, fx('bybit-ticker-btc-2026-11-24.json')];
  if (url.includes('bybit')) return [200, fx('bybit-account-ratio-btc-2026-11-24.json')];
  return [404, 'inconnu'];
}

function deps(rest: MemRest, opts: { key?: string; fail?: (url: string) => boolean; seen?: string[] } = {}): CollectDeps {
  return {
    rest, now: () => NOW, sleep: async () => {},
    env: (n) => (n === 'TIINGO_API_KEY' ? (opts.key ?? KEY) || undefined : undefined),
    fetch: async (url, init) => {
      opts.seen?.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
      const [status, body] = opts.fail?.(url) ? [500, `panne ${KEY}`] : respond(url);
      return { status, text: async () => body };
    },
  };
}

const series = (rest: MemRest, id: string) => rest.rows('sentiment_series').filter((r) => r.series_id === id);
const state = (rest: MemRest, key: string) => rest.rows('p4_state').find((r) => r.key === key)?.value as Record<string, unknown>;

describe('tâche closes', () => {
  it('10 séries écrites, dates à la source, état par série et flux', async () => {
    const rest = new MemRest();
    const seen: string[] = [];
    const r = await runCloses(deps(rest, { seen }));
    expect(r.ok).toBe(true);
    expect(Object.keys(r.done as object).sort()).toEqual(['AUDJPY', 'BTC', 'CPER', 'ETH', 'GLD', 'HY_OAS', 'SPY', 'TLT', 'VIX', 'VIX_FRED']);
    expect(series(rest, 'VIX').at(-1)).toMatchObject({ date: '2026-11-23', value: 26.62, source: 'cboe' });
    expect(series(rest, 'SPY').find((x) => x.date === '2026-11-20')).toMatchObject({ value: 700, adj: 699 });
    expect(series(rest, 'AUDJPY').map((x) => x.date)).toEqual(['2026-11-23']);   // dimanche 22/11 retiré
    expect(series(rest, 'BTC').some((x) => x.date === '2026-11-24')).toBe(false);   // bougie en cours
    expect((state(rest, 'series').VIX as { last_date: string }).last_date).toBe('2026-11-23');
    expect(state(rest, 'feed:closes')).toMatchObject({ status: 'connected', last_error: null, last_message_ms: NOW });
    // OKX : 12 pages au premier passage, une seule ensuite.
    expect(seen.filter((s) => s.includes('history-candles') && s.includes('BTC')).length).toBeGreaterThan(1);
    seen.length = 0;
    await runCloses(deps(rest, { seen }));
    expect(seen.filter((s) => s.includes('history-candles') && s.includes('BTC')).length).toBe(1);
    // Clé envoyée en en-tête, jamais dans l'URL.
    expect(seen.filter((s) => s.includes(KEY)).every((s) => s.includes('api.tiingo.com') && !s.split(' ')[0].includes(KEY))).toBe(true);
  });
  it('panne de Tiingo : erreur visible, dernière date gardée, clé jamais recopiée', async () => {
    const rest = new MemRest();
    await runCloses(deps(rest));
    const r = await runCloses(deps(rest, { fail: (u) => u.includes('tiingo') }));
    expect(r.ok).toBe(false);
    const spy = state(rest, 'series').SPY as { last_date: string; error: string };
    expect(spy).toMatchObject({ last_date: '2026-11-23', error: 'HTTP 500' });
    expect(series(rest, 'SPY').length).toBe(2);
    expect(JSON.stringify(rest.tables.get('p4_state'))).not.toContain(KEY);
    expect(state(rest, 'feed:closes').status).toBe('connected');   // les autres sources ont répondu
  });
  it('sans clé Tiingo : séries Tiingo en erreur, aucune requête vers Tiingo', async () => {
    const rest = new MemRest();
    const seen: string[] = [];
    const r = await runCloses(deps(rest, { key: '', seen }));
    expect((r.problems as string[]).filter((p) => p.includes('TIINGO_API_KEY absente')).length).toBe(5);
    expect(seen.some((s) => s.includes('tiingo'))).toBe(false);
  });
});

describe('tâche liquidity', () => {
  it('trois séries FRED, unités brutes de la source', async () => {
    const rest = new MemRest();
    const r = await runLiquidity(deps(rest));
    expect(r.ok).toBe(true);
    expect(series(rest, 'WALCL').at(-1)).toMatchObject({ date: '2026-11-18', value: 6741452 });
    expect(series(rest, 'RRP').at(-1)).toMatchObject({ date: '2026-11-23', value: 0.35 });
    expect(state(rest, 'feed:liquidity').status).toBe('connected');
  });
});

describe('tâche cot', () => {
  it('3 ans au premier passage, 5 semaines ensuite ; marchés absents signalés', async () => {
    const rest = new MemRest();
    const seen: string[] = [];
    const r = await runCot(deps(rest, { seen }));
    expect(r.last_report).toBe('2026-11-17');
    expect(r.from).toBe('2023-09-26');
    expect(decodeURIComponent(seen[0])).toMatch(/cftc_contract_market_code in\('[^)]*'099741'/);
    const eur = rest.rows('cot_positions').filter((x) => x.market_code === '099741' && x.date === '2026-11-17');
    expect(eur.length).toBe(5);
    // La capture ne contient que l'euro, le S&P 500 et le bitcoin : les autres marchés sont signalés.
    expect((r.problems as string[])[0]).toMatch(/absents du rapport du 2026-11-17 : .*097741/);
    const again = await runCot(deps(rest));
    expect(again.from).toBe('2026-10-13');
  });
});

describe('tâche crowding', () => {
  it('rattrapage au premier passage, 4 points ensuite ; financement à chaque passage', async () => {
    const rest = new MemRest();
    const seen: string[] = [];
    const r = await runCrowding(deps(rest, { seen }));
    expect(r.ok).toBe(true);
    expect(seen.some((s) => s.includes('globalLongShortAccountRatio') && s.includes('limit=500'))).toBe(true);
    expect(seen.filter((s) => s.includes('rubik') && s.includes('BTC') && s.includes('top-trader?')).length).toBeGreaterThan(0);
    const rows = rest.rows('crowding');
    expect(new Set(rows.map((x) => `${x.exchange}|${x.metric}`))).toEqual(new Set(['binance|account', 'binance|top_account', 'binance|top_position',
      'okx|account', 'okx|top_account', 'okx|top_position', 'bybit|account', 'binance|funding', 'okx|funding', 'bybit|funding']));
    expect(state(rest, 'feed:crowding')).toMatchObject({ status: 'connected', late_after_ms: 45 * 60_000 });
  });
  it('OKX rubik : 500 ms entre deux requêtes (limite de 5 par 2 s)', async () => {
    const rest = new MemRest();
    const waits: number[] = [];
    await runCrowding({ ...deps(rest), sleep: async (ms) => { waits.push(ms); } });
    expect(waits.filter((w) => w === 500).length).toBeGreaterThanOrEqual(6);
  });
  it('points de plus de 45 jours effacés', async () => {
    const rest = new MemRest();
    rest.rows('crowding').push({ exchange: 'okx', symbol: 'BTC', metric: 'account', ts: '2026-09-01T00:00:00.000Z', value: 1, long_share: 0.5, ts_recv: 'x' });
    await runCrowding(deps(rest));
    expect(rest.rows('crowding').some((x) => x.ts === '2026-09-01T00:00:00.000Z')).toBe(false);
  });
});
