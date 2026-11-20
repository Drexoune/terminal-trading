// @vitest-environment node
/// <reference types="node" />
// Relevés du module Bourse : lecture des réponses réelles (BCE du 19/11/2026 ;
// Massive, Alpha Vantage et SEC relevées par la tâche explore le 20/11/2026,
// depuis Supabase), passages complets sur base simulée, budget Alpha Vantage,
// journal, concordance avec la migration. Les cas limites (clôture nulle,
// lignes invalides) sont ajoutés aux réponses réelles dans les tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Db, FetchLike, ResponseLike, Row } from '../okx-collector/postgrest.ts';
import {
  ALPHA_PER_RUN, ALPHA_URL, ECB_URL, MASSIVE_BASE, SEC_TICKERS_URL, civilDate, previousWeekday, redactWith,
  runJob, type JobDeps,
} from './jobs.ts';
import { decimalText, parseAlphaDaily, parseCsv, parseEcbCsv, parseMassiveGrouped, parseSecTickers } from './parse.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
const ECB = read('./fixtures/ecb-exr-2026-11-19.csv');
const MASSIVE = JSON.parse(read('./fixtures/massive-grouped-2026-11-19.json'));
const ALPHA = JSON.parse(read('./fixtures/alpha-daily-CW8.PAR-2026-11-19.json'));
const ALPHA_QUOTA = JSON.parse(read('./fixtures/alpha-quota.documented.json'));
const SEC = JSON.parse(read('./fixtures/sec-tickers-exchange-2026-11-18.json'));
const MIGRATION = read('../../migrations/20261119120000_bourse_b0.sql');

// Jeudi 19/11/2026 06:30 UTC.
const NOW = Date.parse('2026-11-19T06:30:00Z');
// Vendredi 20/11/2026 06:15 UTC : relevé US de la séance du 19/11 (celle de la réponse Massive).
const NOW_US = Date.parse('2026-11-20T06:15:00Z');

function response(status: number, body: unknown): ResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

class MemoryDb implements Db {
  writes: { op: string; table: string; rows: Row[]; onConflict?: string }[] = [];
  selects: { table: string; query: Record<string, string> }[] = [];
  constructor(private tables: Record<string, Row[]> = {}) {}
  async insert(table: string, rows: Row[]) { this.writes.push({ op: 'insert', table, rows }); }
  async upsert(table: string, rows: Row[], onConflict: string) { this.writes.push({ op: 'upsert', table, rows, onConflict }); }
  async select<T>(table: string, query: Record<string, string>): Promise<T[]> {
    this.selects.push({ table, query });
    let rows = this.tables[table] ?? [];
    if (query.price_source) rows = rows.filter((r) => `eq.${r.price_source}` === query.price_source);
    return rows as T[];
  }
  rows(table: string): Row[] { return this.writes.filter((w) => w.table === table).flatMap((w) => w.rows); }
}

const LISTINGS: Row[] = [
  { id: 1, source_symbol: 'YPF', currency: 'USD', price_source: 'massive' },
  { id: 2, source_symbol: 'NVDA', currency: 'USD', price_source: 'massive' },
  { id: 3, source_symbol: 'CW8.PAR', currency: 'EUR', price_source: 'alphavantage' },
  { id: 4, source_symbol: 'ESE.PAR', currency: 'EUR', price_source: 'alphavantage' },
];

function deps(over: Partial<JobDeps> & { fetch: FetchLike }, env: Record<string, string> = {}): JobDeps & { slept: number[]; quota: number[] } {
  const slept: number[] = [];
  const quota: number[] = [];
  let used = 0;
  return {
    now: () => NOW,
    sleep: async (ms) => { slept.push(ms); },
    db: new MemoryDb({ instrument_listings: LISTINGS }),
    rpc: async (_fn, args) => { quota.push(args.p_max as number); used++; return used <= 2; },
    env: (name) => ({ MASSIVE_API_KEY: 'massive-key-123', ALPHA_VANTAGE_API_KEY: 'alpha-key-456', SEC_CONTACT_EMAIL: 'terminal@exemple.org', ...env })[name],
    slept, quota,
    ...over,
  };
}

/** Colonnes d'une table de la migration. */
function migrationColumns(table: string): string[] {
  const block = MIGRATION.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!block) throw new Error(`table ${table} absente de la migration`);
  return block[1].split('\n')
    .map((line) => line.trim().match(/^([a-z_0-9]+)\s+(text|timestamptz|boolean|integer|numeric|bigint|date)\b/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

describe('lecture des réponses', () => {
  it('CSV avec champs entre guillemets et virgules internes', () => {
    expect(parseCsv('a,b\n"x, y","il dit ""oui"""\r\n3,4')).toEqual([['a', 'b'], ['x, y', 'il dit "oui"'], ['3', '4']]);
  });

  it('BCE réelle : 20 cours, valeurs en texte décimal', () => {
    const { rates, skipped } = parseEcbCsv(ECB);
    expect(skipped).toBe(0);
    expect(rates).toHaveLength(20);
    expect(rates).toContainEqual({ value_date: '2026-11-18', currency: 'GBP', per_eur: '0.8329' });
    expect(new Set(rates.map((r) => r.currency))).toEqual(new Set(['CHF', 'GBP', 'JPY', 'USD']));
  });

  it('BCE : colonne manquante refusée', () => {
    expect(() => parseEcbCsv('KEY,CURRENCY\nx,y')).toThrow(/TIME_PERIOD/);
  });

  it('nombres : texte décimal positif seulement', () => {
    expect(decimalText('614.2500')).toBe('614.2500');
    expect(decimalText(229.31)).toBe('229.31');
    for (const bad of ['0.0000', '-1', 'abc', '', null, Number.NaN, '1,5']) expect(decimalText(bad)).toBeNull();
  });

  it('Massive réelle : statut DELAYED accepté, clôtures par symbole', () => {
    expect(MASSIVE.status).toBe('DELAYED');
    const { closes, count } = parseMassiveGrouped(MASSIVE);
    expect(count).toBe(20);
    expect(closes.size).toBe(20);
    expect(closes.get('YPF')).toEqual({ symbol: 'YPF', close: '33.28', source_ts: '2026-11-19T21:00:00.000Z' });
    expect(closes.get('POMG')?.close).toBe('26.1537');
  });

  it('Massive : ligne sans clôture écartée, erreur reconnue', () => {
    const withBad = { ...MASSIVE, results: [...MASSIVE.results, { T: 'BAD', v: 1, o: 1, c: null, h: 1, l: 1, t: 1795122000000 }] };
    const { closes, count } = parseMassiveGrouped(withBad);
    expect(count).toBe(21);
    expect(closes.has('BAD')).toBe(false);
    expect(() => parseMassiveGrouped({ status: 'ERROR', error: 'Unknown API Key' })).toThrow(/Unknown API Key/);
  });

  it('Alpha Vantage réelle : série triée ; clôture nulle écartée ; quota et erreur reconnus', () => {
    const r = parseAlphaDaily(ALPHA);
    expect(r.kind).toBe('series');
    if (r.kind !== 'series') return;
    expect(r.rows.map((x) => x.value_date)).toEqual(['2026-07-03', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    expect(r.rows.at(-1)).toEqual({ value_date: '2026-11-19', close: '688.7200' });
    expect(r.refreshed).toBe('2026-11-19');
    expect(r.timezone).toBe('US/Eastern');
    const series = { ...ALPHA['Time Series (Daily)'], '2026-11-16': { ...ALPHA['Time Series (Daily)']['2026-11-16'], '4. close': '0.0000' } };
    const zero = parseAlphaDaily({ ...ALPHA, 'Time Series (Daily)': series });
    expect(zero.kind === 'series' && zero.rows.map((x) => x.value_date)).not.toContain('2026-11-16');
    expect(parseAlphaDaily(ALPHA_QUOTA).kind).toBe('quota');
    expect(parseAlphaDaily({ Note: 'Thank you for using Alpha Vantage!' }).kind).toBe('quota');
    expect(parseAlphaDaily({ 'Error Message': 'Invalid API call.' })).toEqual({ kind: 'error', message: 'Invalid API call.' });
    expect(parseAlphaDaily({}).kind).toBe('error');
  });

  it('SEC réelle : « data » avant « fields », place OTC gardée', () => {
    expect(Object.keys(SEC).filter((k) => k !== '_doc')).toEqual(['data', 'fields']);
    const { companies, skipped } = parseSecTickers(SEC);
    expect(skipped).toBe(0);
    expect(companies).toHaveLength(48);
    expect(companies[0]).toEqual({ cik: 320193, ticker: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq' });
    expect(companies.at(-1)).toEqual({ cik: 2163910, ticker: 'MZTFF', name: 'Mizrahi Tefahot Bank Ltd/ADR', exchange: 'OTC' });
  });

  it('SEC : doublons et lignes invalides écartés, place absente gardée à null', () => {
    const data = [...SEC.data, SEC.data[0], ['x', 'Ligne invalide', 'BAD', null], [12345, 'Hors cote', 'OTCX', null]];
    const { companies, skipped } = parseSecTickers({ ...SEC, data });
    expect(skipped).toBe(2);
    expect(companies).toHaveLength(49);
    expect(companies.at(-1)).toEqual({ cik: 12345, ticker: 'OTCX', name: 'Hors cote', exchange: null });
  });
});

describe('dates', () => {
  it('date civile dans un fuseau, jour ouvré précédent', () => {
    expect(civilDate(Date.parse('2026-11-19T03:00:00Z'), 'America/New_York')).toBe('2026-11-18');
    expect(civilDate(Date.parse('2026-11-19T03:00:00Z'), 'Europe/Paris')).toBe('2026-11-19');
    expect(previousWeekday('2026-11-19')).toBe('2026-11-18');
    expect(previousWeekday('2026-11-23')).toBe('2026-11-20');   // lundi → vendredi
    expect(previousWeekday('2026-11-22')).toBe('2026-11-20');   // dimanche → vendredi
  });

  it('masquage des clés', () => {
    expect(redactWith('url?apikey=alpha-key-456&x=1', ['alpha-key-456', undefined, 'abc'])).toBe('url?apikey=***&x=1');
  });
});

describe('ecb-fx', () => {
  it('upsert des cours et journal', async () => {
    const calls: string[] = [];
    const d = deps({ fetch: async (url) => { calls.push(url); return response(200, ECB); } });
    const r = await runJob('ecb-fx', d);
    expect(r).toMatchObject({ ok: true, rows: 20, requests: 1, note: 'dernier fixing 2026-11-18' });
    expect(calls).toEqual([`${ECB_URL}?startPeriod=2026-11-09&format=csvdata`]);
    const db = d.db as MemoryDb;
    const upsert = db.writes.find((w) => w.table === 'fx_rates')!;
    expect(upsert.onConflict).toBe('value_date,currency');
    expect(upsert.rows[0]).toMatchObject({ source: 'BCE', received_at: '2026-11-19T06:30:00.000Z' });
    expect(Object.keys(upsert.rows[0]).sort()).toEqual(migrationColumns('fx_rates').sort());
    const run = db.rows('bourse_runs')[0];
    expect(Object.keys(run).sort()).toEqual(migrationColumns('bourse_runs').filter((c) => c !== 'id').sort());
    expect(run).toMatchObject({ job: 'ecb-fx', ok: true, rows: 20, error: null });
  });

  it('HTTP 503 : passage en échec, journalisé', async () => {
    const d = deps({ fetch: async () => response(503, 'indisponible') });
    const r = await runJob('ecb-fx', d);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(['BCE : HTTP 503']);
    expect((d.db as MemoryDb).rows('bourse_runs')[0]).toMatchObject({ ok: false, error: 'BCE : HTTP 503' });
  });
});

describe('us-close', () => {
  it('garde les cotations suivies, signale celles sans clôture, clé en en-tête', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const d = deps({ now: () => NOW_US, fetch: async (url, init) => { seen.push({ url, headers: init?.headers ?? {} }); return response(200, MASSIVE); } });
    const r = await runJob('us-close', d);
    expect(seen).toEqual([{ url: `${MASSIVE_BASE}/v2/aggs/grouped/locale/us/market/stocks/2026-11-19?adjusted=false`,
      headers: { Authorization: 'Bearer massive-key-123' } }]);
    expect(r).toMatchObject({ ok: true, rows: 1, note: 'sans clôture le 2026-11-19 : NVDA' });
    const price = (d.db as MemoryDb).rows('prices')[0];
    expect(price).toEqual({ listing_id: 1, value_date: '2026-11-19', close: '33.28', adj_close: null, currency: 'USD',
      source: 'Massive', source_ts: '2026-11-19T21:00:00.000Z', received_at: '2026-11-20T06:15:00.000Z' });
    expect(Object.keys(price).sort()).toEqual(migrationColumns('prices').sort());
  });

  it('jour sans séance : rien écrit, noté', async () => {
    const d = deps({ fetch: async () => response(200, { status: 'OK', resultsCount: 0, results: [] }) });
    expect(await runJob('us-close', d)).toMatchObject({ ok: true, rows: 0, note: 'aucune séance le 2026-11-18 (férié ?)' });
  });

  it('sans clé : échec explicite, aucun appel', async () => {
    const d = deps({ fetch: async () => { throw new Error('aucun appel attendu'); } }, { MASSIVE_API_KEY: '' });
    expect((await runJob('us-close', d)).errors).toEqual(['MASSIVE_API_KEY absente']);
  });

  it('erreur Massive : la clé n’apparaît pas dans le message', async () => {
    const d = deps({ fetch: async () => response(401, '{"error":"bad key massive-key-123"}') });
    const r = await runJob('us-close', d);
    expect(r.errors[0]).toContain('HTTP 401');
    expect(r.errors[0]).not.toContain('massive-key-123');
  });
});

describe('eu-close', () => {
  it('une requête par cotation, quota réservé avant, espacement, arrêt quand le budget est épuisé', async () => {
    const urls: string[] = [];
    const listings = [...LISTINGS, { id: 5, source_symbol: 'PUST.PAR', currency: 'EUR', price_source: 'alphavantage' }];
    const d = deps({
      fetch: async (url) => { urls.push(url); return response(200, ALPHA); },
      db: new MemoryDb({ instrument_listings: listings, prices: [] }),
    });
    const r = await runJob('eu-close', d);
    expect(urls).toHaveLength(2);   // le faux budget accorde 2 réservations
    expect(urls[0].startsWith(`${ALPHA_URL}?function=TIME_SERIES_DAILY&symbol=CW8.PAR&outputsize=compact&apikey=`)).toBe(true);
    expect(d.quota).toEqual([20, 20, 20]);
    expect(d.slept).toEqual([2000]);
    expect(r).toMatchObject({ ok: true, rows: 12, requests: 2, note: 'quota atteint' });
    const rows = (d.db as MemoryDb).rows('prices');
    expect(rows.map((p) => p.listing_id)).toEqual([3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4]);
    expect(rows.filter((p) => p.value_date === '2026-11-19').map((p) => [p.listing_id, p.close])).toEqual([
      [3, '688.7200'], [4, '688.7200'],
    ]);
  });

  it('cotations déjà relevées aujourd’hui sautées', async () => {
    const urls: string[] = [];
    const d = deps({
      fetch: async (url) => { urls.push(url); return response(200, ALPHA); },
      db: new MemoryDb({ instrument_listings: LISTINGS, prices: [{ listing_id: 3 }] }),
    });
    await runJob('eu-close', d);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('symbol=ESE.PAR');
    const sel = (d.db as MemoryDb).selects.find((s) => s.table === 'prices')!;
    expect(sel.query).toMatchObject({ source: 'eq.Alpha Vantage', received_at: 'gte.2026-11-19T00:00:00Z' });
  });

  it('réponse de quota dépassé : arrêt immédiat, noté, rien écrit', async () => {
    const d = deps({ fetch: async () => response(200, ALPHA_QUOTA) });
    const r = await runJob('eu-close', d);
    expect(r.ok).toBe(true);
    expect(r.requests).toBe(1);
    expect(r.note).toMatch(/^quota atteint/);
    expect((d.db as MemoryDb).rows('prices')).toEqual([]);
  });

  it('budget configuré hors bornes refusé', async () => {
    const d = deps({ fetch: async () => response(200, ALPHA) }, { ALPHA_VANTAGE_DAILY_MAX: '50' });
    expect((await runJob('eu-close', d)).errors[0]).toMatch(/1 à 25/);
  });

  it(`au plus ${ALPHA_PER_RUN} cotations par passage`, async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: 10 + i, source_symbol: `X${i}.PAR`, currency: 'EUR', price_source: 'alphavantage' }));
    const urls: string[] = [];
    const d = deps({
      fetch: async (url) => { urls.push(url); return response(200, ALPHA); },
      db: new MemoryDb({ instrument_listings: many, prices: [] }),
      rpc: async () => true,
    });
    const r = await runJob('eu-close', d);
    expect(urls).toHaveLength(ALPHA_PER_RUN);
    expect(r.note).toBe('4 cotation(s) au passage suivant');
  });
});

describe('ref-sec', () => {
  it('User-Agent avec contact, upsert par lots', async () => {
    const seen: Record<string, string>[] = [];
    const d = deps({ fetch: async (url, init) => { expect(url).toBe(SEC_TICKERS_URL); seen.push(init?.headers ?? {}); return response(200, SEC); } });
    const r = await runJob('ref-sec', d);
    expect(seen[0]['User-Agent']).toBe('terminal-trading/0.1 (terminal@exemple.org)');
    expect(r).toMatchObject({ ok: true, rows: 48, note: null });
    const row = (d.db as MemoryDb).rows('sec_companies')[0];
    expect(Object.keys(row).sort()).toEqual(migrationColumns('sec_companies').sort());
  });

  it('sans adresse de contact : aucun appel', async () => {
    const d = deps({ fetch: async () => { throw new Error('aucun appel attendu'); } }, { SEC_CONTACT_EMAIL: 'pas-une-adresse' });
    expect((await runJob('ref-sec', d)).errors[0]).toMatch(/SEC_CONTACT_EMAIL/);
  });
});

describe('explore', () => {
  it('une réponse par source, clés masquées, rien écrit en base', async () => {
    const d = deps({ fetch: async (url) => response(200, `réponse de ${url}`) }, { TIINGO_API_KEY: 'tiingo-key-789' });
    const r = await runJob('explore', d);
    const report = r.report as { name: string; body?: string; skipped?: string }[];
    expect(report.map((p) => p.name)).toEqual(['ecb', 'sec-tickers', 'sec-companyfacts', 'massive-grouped', 'alpha-daily', 'tiingo-daily', 'openfigi']);
    expect(JSON.stringify(report)).not.toMatch(/alpha-key-456|massive-key-123|tiingo-key-789/);
    expect(report.find((p) => p.name === 'alpha-daily')!.body).toContain('apikey=***');
    expect((d.db as MemoryDb).writes).toEqual([]);
  });

  it('réponse longue : début et fin renvoyés, clés masquées dans les deux', async () => {
    const long = `{"results":[${'1,'.repeat(2_000)}1],"status":"OK","key":"massive-key-123"}`;
    const d = deps({ fetch: async () => response(200, long) });
    const report = (await runJob('explore', d)).report as { name: string; body?: string; tail?: string }[];
    const m = report.find((p) => p.name === 'massive-grouped')!;
    expect(m.body).toHaveLength(1_500);
    expect(m.tail).toMatch(/"status":"OK","key":"\*\*\*"}$/);
    expect(m.tail!.length).toBeLessThanOrEqual(800);
    expect(report.find((p) => p.name === 'openfigi')!.tail).toBeDefined();
  });
});
