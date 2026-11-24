// @vitest-environment node
// /api/sentiment/* (P4, S3) : états publiés par p4-jobs avec leur flux et l'état des séries,
// positions des banques tirées des dealers du TFF, sonde du BPR protégée par le secret, lecture
// des pages réelles du Bank Participation Report (24/11/2026).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';
import { BPR_REASON_NONE, bprFuturesPages, bprRows, handleSentiment } from '../_lib/sentiment.js';

const fx = (name: string) => readFileSync(new URL(`../../supabase/functions/p4-jobs/fixtures/${name}`, import.meta.url), 'utf8');
const SECRET = 'x'.repeat(40);
const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij', P1_JOBS_SECRET: SECRET };
const NOW = Date.parse('2026-11-24T14:00:00Z');

const STATE = [
  { key: 'risk', value: { date: '2026-11-23', index: 5.6, zone: 'risk_off_strong' }, updated_ms: 10 },
  { key: 'feed:closes', value: { name: 'closes', status: 'connected', last_message_ms: 9 }, updated_ms: 9 },
  { key: 'series', value: { VIX: { last_date: '2026-11-23', last_ok_ms: 9 }, WALCL: { last_date: '2026-11-18' } }, updated_ms: 9 },
  { key: 'cot', value: { report_date: '2026-11-17', markets: [{ code: '099741', label: 'EUR', group: 'fx', date: '2026-11-17', open_interest: 866032,
    categories: { dealer: { net: -118393 }, lev_money: { net: -76587 } }, history: { dates: ['2026-11-10', '2026-11-17'], net: { dealer: [-1, -118393], lev_money: [0, -76587] } } }] }, updated_ms: 8 },
  { key: 'feed:cot', value: { name: 'cot', status: 'connected' }, updated_ms: 8 },
];

function supa(rows = STATE) {
  const urls: string[] = [];
  const fetch: FetchFn = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const wanted = (u.searchParams.get('key') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, ''));
    return new Response(JSON.stringify(u.pathname.endsWith('/p4_state') ? rows.filter((r) => wanted.includes(r.key)) : []), { status: 200 });
  };
  return { urls, ctx: createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, ENV) };
}
const get = async (c: ReturnType<typeof supa>['ctx'], path: string) => (await handleSentiment(new Request(`https://x/api/sentiment?path=${path}`), c));

describe('/api/sentiment/<route>', () => {
  it('risk : état, flux et état des séries de chaque composante', async () => {
    const { ctx, urls } = supa();
    const b = await (await get(ctx, 'risk')).json() as Record<string, unknown>;
    expect(b).toMatchObject({ configured: true, route: 'risk', published_ms: 10, data: { index: 5.6 }, feed: { status: 'connected' },
      series: { VIX: { last_date: '2026-11-23' }, HY_OAS: null }, reason: null });
    expect(Object.keys(b.series as object)).not.toContain('WALCL');
    expect(new URL(urls[0]).searchParams.get('key')).toBe('in.("risk","feed:closes","series")');
  });
  it('banks : dealers seulement, BPR « — » avec la raison', async () => {
    const { ctx } = supa();
    const b = await (await get(ctx, 'banks')).json() as { data: { label: string; markets: Record<string, unknown>[] }; bpr: unknown; bpr_reason: string; feed: unknown };
    expect(b.data.label).toMatch(/Dealers/);
    expect(b.data.markets[0]).toEqual({ code: '099741', label: 'EUR', group: 'fx', date: '2026-11-17', open_interest: 866032,
      dealer: { net: -118393 }, history: { dates: ['2026-11-10', '2026-11-17'], net: [-1, -118393] } });
    expect(b).toMatchObject({ bpr: null, bpr_reason: BPR_REASON_NONE, feed: { name: 'cot' } });
  });
  it('état pas encore calculé : données nulles avec la raison, jamais de valeur de maquette', async () => {
    const { ctx } = supa([]);
    for (const r of ['risk', 'cot', 'banks', 'crowding', 'liquidity']) {
      expect(await (await get(ctx, r)).json(), r).toMatchObject({ data: null, reason: 'pas encore calculé', feed: null, published_ms: null });
    }
  });
  it('sans Supabase configuré : configured false ; route inconnue : 404 ; paramètre en trop : 400', async () => {
    const c = createContext({ fetch: async () => new Response('[]'), now: () => NOW, monotonic: () => 0, sleep: async () => {} }, {});
    expect(await (await get(c, 'risk')).json()).toMatchObject({ configured: false, data: null });
    const { ctx } = supa();
    expect((await get(ctx, 'nope')).status).toBe(404);
    expect(await (await handleSentiment(new Request('https://x/api/sentiment/risk'), ctx)).json()).toMatchObject({ route: 'risk', data: { index: 5.6 } });
    expect((await handleSentiment(new Request('https://x/api/sentiment?path=risk&x=1'), ctx)).status).toBe(400);
    expect((await handleSentiment(new Request('https://x/api/sentiment?path=risk', { method: 'POST' }), ctx)).status).toBe(405);
  });
});

describe('Bank Participation Report', () => {
  it('index : pages futures par mois, la plus récente en dernier', () => {
    const p = bprFuturesPages(fx('cftc-bpr-index-2026-11-24.html'));
    expect(p.at(-1)).toEqual({ month: '2026-11', page: 'deanov26f' });
    expect(p.at(-2)!.month).toBe('2026-10');
  });
  it('page de novembre : ligne totale par marché, banques masquées sous 4', () => {
    const rows = bprRows(fx('cftc-bpr-deanov26f-2026-11-24.html'));
    const by = Object.fromEntries(rows.map((r) => [r.market, r]));
    expect(by['CME EURO FX']).toEqual({ market: 'CME EURO FX', date: '2026-11-03', banks: 12, long: 10361, long_pct: 1.2, short: 161790, short_pct: 18.5, open_interest: 876122 });
    expect(by['CME BITCOIN']).toMatchObject({ banks: 5, long: 0, short: 704, open_interest: 17527 });
    expect(by['CME E-MINI S&P 500']).toMatchObject({ banks: 26, long: 55308, short: 345453 });
    expect(by['CME JAPANESE YEN']).toMatchObject({ long: 5339, short: 108157 });
    expect(rows.length).toBeGreaterThan(50);
  });
  it('sonde : secret exigé ; refus de Cloudflare visible ; page lue sinon', async () => {
    const urls: string[] = [];
    const make = (status: number) => createContext({ now: () => 0, monotonic: () => 0, sleep: async () => {}, fetch: async (url) => {
      urls.push(url);
      if (status !== 200) return new Response('<!DOCTYPE html><title>Just a moment...</title>', { status });
      return new Response(url.endsWith('index.htm') ? fx('cftc-bpr-index-2026-11-24.html') : fx('cftc-bpr-deanov26f-2026-11-24.html'), { status: 200 });
    } }, ENV);
    const probe = (c: ReturnType<typeof make>, s?: string) => handleSentiment(new Request('https://x/api/sentiment?path=probe', { headers: s ? { 'x-jobs-secret': s } : {} }), c);
    expect((await probe(make(200), 'faux')).status).toBe(401);
    expect(urls).toEqual([]);
    const ok = await (await probe(make(200), SECRET)).json() as { ok: boolean; months: string[]; rows: number; sample: { market: string }[] };
    expect(ok.ok).toBe(true);
    expect(ok.months.at(-1)).toBe('2026-11');
    expect(ok.sample.map((r) => r.market).sort()).toEqual(['CME BITCOIN', 'CME E-MINI S&P 500', 'CME EURO FX', 'CME JAPANESE YEN']);
    const refused = await (await probe(make(403), SECRET)).json() as { ok: boolean; lines: { status: number; challenge: boolean }[] };
    expect(refused).toMatchObject({ ok: false, lines: [{ status: 403, challenge: true }] });
  });
});
