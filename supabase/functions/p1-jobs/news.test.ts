// @vitest-environment node
// Tâche « news » (E6/O6) : captures réelles servies par un faux réseau, base simulée.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MemRest } from './_memrest.ts';
import { runAlertCommand } from './alerts.ts';
import { fastBanks, runNews, type NewsDeps } from './news.ts';
import { FEEDS } from './news_rules.ts';

const RECV = 1795186369759;   // 20/11/2026 14:52:49 UTC
const body = (id: string) => readFileSync(fileURLToPath(new URL(`../../../gateway/tests/fixtures/news/${id}.xml`, import.meta.url)));

function setup(over: Partial<Record<string, (n: number) => { status: number; body?: string | Buffer; etag?: string }>> = {}) {
  const rest = new MemRest();
  let now = RECV;
  const hits: Record<string, { n: number; headers: Record<string, string>[] }> = {};
  const deps: NewsDeps = {
    rest, now: () => now, sleep: async (ms) => { now += ms; }, env: () => undefined,
    fetch: async (url, init) => {
      const f = FEEDS.find((x) => x.url === url)!;
      const h = (hits[f.id] ??= { n: 0, headers: [] });
      h.n++;
      h.headers.push(init?.headers ?? {});
      const r = over[f.id]?.(h.n) ?? { status: 200, body: body(f.id), etag: `"${f.id}-1"` };
      const bytes = typeof r.body === 'string' ? new TextEncoder().encode(r.body) : new Uint8Array(r.body ?? []);
      return { status: r.status, headers: { get: (n: string) => (n === 'etag' ? r.etag ?? null : n === 'content-type' ? 'application/rss+xml' : null) },
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
    },
  };
  return { rest, deps, hits, at: (t: number) => { now = t; } };
}

const items = (rest: MemRest) => rest.rows('p1_state').filter((r) => String(r.key).startsWith('news:item:')).map((r) => r.value as Record<string, unknown>);

describe('tâche news', () => {
  it('premier passage : titres des 7 derniers jours, sans doublon, tous en arriéré ; flux connecté', async () => {
    const { rest, deps } = setup();
    const r = await runNews(deps);
    expect(r.ok).toBe(true);
    const got = items(rest);
    expect(got.length).toBeGreaterThan(60);
    expect(got.every((i) => i.backfill === true)).toBe(true);
    expect(new Set(got.map((i) => i.url)).size).toBe(got.length);
    // Rubriques récurrentes écartées et comptées ; la Fed en double (press_all / press_monetary) une seule fois.
    expect(got.some((i) => /Implied Volatility|FJElite/.test(String(i.title)))).toBe(false);
    const feeds = rest.rows('p1_state').find((x) => x.key === 'news:feeds')!.value as Record<string, { noise: number; etag: string }>;
    expect(feeds.financialjuice.noise).toBe(25);
    expect((rest.rows('p1_state').find((x) => x.key === 'feed:news')!.value as { status: string }).status).toBe('connected');
    const fomc = got.filter((i) => i.title === 'Minutes of the Federal Open Market Committee, October 27-28, 2026');
    expect(fomc).toHaveLength(1);
    expect(fomc[0]).toMatchObject({ urgent: true, rule: 'decision:FED', category: 'banque-centrale', kind: 'officielle' });
  });

  it('passage suivant : GET conditionnel, aucun nouveau titre ; un nouveau titre FJ part avec alerte mot-clé', async () => {
    const fj = body('financialjuice').toString('utf8');
    const fresh = fj.replace('<item>', `<item><title>FinancialJuice: Powell: Rates on hold for now</title><link>https://www.financialjuice.com/News/1/Powell.aspx?xy=rss</link><guid>1</guid><pubDate>Fri, 20 Nov 2026 14:53:30 GMT</pubDate></item><item>`);
    const { rest, deps, hits, at } = setup({ financialjuice: (n) => (n === 1 ? { status: 200, body: fj, etag: '"a"' } : { status: 200, body: fresh, etag: '"b"' }),
      'fed-all': (n) => (n === 1 ? { status: 200, body: body('fed-all'), etag: '"f1"' } : { status: 304 }) });
    await runAlertCommand({ ...deps, fetch: async () => { throw new Error('pas de Telegram ici'); } } as never,
      { op: 'create', kind: 'keyword', params: { words: ['Powell'] }, channels: ['voix'] });
    await runNews(deps);
    const n1 = items(rest).length;
    at(RECV + 60_000);
    const r = await runNews(deps);
    expect(hits['fed-all'].headers[1]['If-None-Match']).toBe('"f1"');
    expect(r.added).toBe(1);
    const added = items(rest).slice(n1);
    expect(added).toEqual([expect.objectContaining({ title: 'Powell: Rates on hold for now', backfill: false, category: 'banque-centrale',
      url: 'https://www.financialjuice.com/News/1/Powell.aspx', published_ms: Date.UTC(2026, 10, 20, 14, 53, 30), received_ms: RECV + 60_000 })]);
    expect(rest.rows('alert_events')).toEqual([expect.objectContaining({ title: '« Powell » : Powell: Rates on hold for now', dedupe: `news:${added[0].id}` })]);
  });

  it('réel de l’agenda : chiffre FinancialJuice rattaché une fois, jamais remplacé', async () => {
    const T = Date.UTC(2026, 10, 20, 14, 55);
    const title = 'FinancialJuice: US Existing Home Sales Actual 4.10M (Forecast 4.05M, Previous 4.06M)';
    const fj = body('financialjuice').toString('utf8').replace('<item>',
      `<item><title>${title}</title><link>https://www.financialjuice.com/News/2/X.aspx?xy=rss</link><guid>2</guid><pubDate>Fri, 20 Nov 2026 14:55:04 GMT</pubDate></item><item>`);
    const { rest, deps } = setup({ financialjuice: () => ({ status: 200, body: fj }) });
    await rest.upsert('p1_state', [{ key: 'calendar:week:2026-W47', updated_ms: 0, value: { events: [
      { id: '12-us-existing-home-sales|USD|2026-11-20|1', title: 'Existing Home Sales', currency: 'USD', time_ms: T, forecast_raw: '4.05M' }] } }], 'key');
    const r = await runNews(deps);
    expect(r.actuals).toEqual(['calendar:actual:12-us-existing-home-sales|USD|2026-11-20|1']);
    const v = rest.rows('p1_state').find((x) => x.key === (r.actuals as string[])[0])!.value;
    expect(v).toMatchObject({ actual: '4.10', unit: 'M', source: 'FinancialJuice', delay_ms: 4000 });
    expect((await runNews(deps)).actuals).toEqual([]);
  });

  it('403 : flux en pause une heure, les autres continuent', async () => {
    const { rest, deps, hits, at } = setup({ 'rbnz-news': () => ({ status: 403 }) });
    await runNews(deps);
    at(RECV + 120_000);
    await runNews(deps);
    expect(hits['rbnz-news'].n).toBe(1);
    const feeds = rest.rows('p1_state').find((x) => x.key === 'news:feeds')!.value as Record<string, { status: string; last_error: string }>;
    expect(feeds['rbnz-news']).toMatchObject({ status: 'bloqué', last_error: expect.stringContaining('403') });
    expect(feeds['fed-all'].status).toBe('ok');
  });

  it('fenêtre de décision : flux de la banque relus toutes les 3 s pendant la minute', async () => {
    const T = RECV + 30_000;
    expect([...fastBanks([{ time_ms: T, impact: 'High', currency: 'USD', title: 'FOMC Statement' }], RECV)]).toEqual(['FED']);
    expect([...fastBanks([{ time_ms: T, impact: 'Medium', currency: 'USD', title: 'FOMC Statement' }], RECV)]).toEqual([]);
    expect([...fastBanks([{ time_ms: T + 20 * 60_000, impact: 'High', currency: 'USD', title: 'FOMC Statement' }], RECV)]).toEqual([]);
    const { rest, deps, hits } = setup();
    await rest.upsert('p1_state', [{ key: 'calendar:week:2026-W47', updated_ms: 0, value: { events: [{ time_ms: T, impact: 'High', currency: 'USD', title: 'FOMC Statement' }] } }], 'key');
    const r = await runNews(deps);
    expect(r.fast).toEqual(['FED']);
    expect(r.fast_polls).toBeGreaterThanOrEqual(15);
    expect(hits['fed-monetary'].n).toBe(1 + Number(r.fast_polls));
    expect(hits['ecb-press'].n).toBe(1);
  });
});
