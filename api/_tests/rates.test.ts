// @vitest-environment node
// /api/rates/* (P2, R2) : état publié, contrôle de la porte, historique (sources puis nos
// instantanés), marqueurs NFP et IPC, validation des paramètres.
import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../_lib/okx.js';
import { handleRates, thin } from '../_lib/rates.js';
import { createContext } from '../_lib/routes.js';

const NOW = Date.parse('2026-11-23T21:16:30Z');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };

function fakeSupabase(tables: Record<string, (params: URLSearchParams) => unknown[]>) {
  const urls: string[] = [];
  const fetch: FetchFn = async (url, init) => {
    urls.push(url);
    expect((init?.headers as Record<string, string>).apikey).toBe(ENV.SUPABASE_SECRET_KEY);
    const u = new URL(url);
    const rows = tables[u.pathname.split('/').pop()!]?.(u.searchParams) ?? [];
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, urls, ctx: createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, ENV) };
}

const get = (ctx: ReturnType<typeof createContext>, path: string) => handleRates(new Request(`https://x${path}`), ctx);

describe('/api/rates/state', () => {
  it('état de la minute, flux, dernière décision par banque, cotes de la Fed sur 30 min', async () => {
    const { ctx, urls } = fakeSupabase({
      p2_state: () => [
        { key: 'rates:state', value: { banks: { FED: { next: { date: '2026-12-09' } } } }, updated_ms: NOW - 20_000 },
        { key: 'feed:polymarket', value: { name: 'polymarket', status: 'connected' }, updated_ms: NOW },
      ],
      rate_decisions: () => [
        { bank: 'FED', decision_date: '2026-10-28', vote: { kind: 'nominatif' } },
        { bank: 'FED', decision_date: '2026-09-16', vote: { kind: 'nominatif' } },
      ],
      rate_quotes: (p) => {
        expect(p.get('meeting')).toBe('eq.2026-12-09');
        return Array.from({ length: 30 }, (_, i) => ({ source: i % 2 ? 'kalshi' : 'polymarket', ts: iso(NOW - (30 - i) * MIN) }));
      },
    });
    const r = await get(ctx, '/api/rates?path=state');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const b = await r.json() as Record<string, unknown>;
    expect(b).toMatchObject({ configured: true, state_ms: NOW - 20_000, feeds: [{ name: 'polymarket' }],
      decisions: { FED: { decision_date: '2026-10-28' } }, gate: { meeting: '2026-12-09', polymarket: 15, kalshi: 15, window_min: 30 } });
    expect(urls.every((u) => u.startsWith('https://ref.supabase.co/rest/v1/'))).toBe(true);
  });

  it('sans Supabase : « non configuré » avec la raison, jamais de valeur', async () => {
    const ctx = createContext({ fetch: async () => { throw new Error('pas d’appel'); }, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, {});
    const b = await (await get(ctx, '/api/rates?path=state')).json() as Record<string, unknown>;
    expect(b).toMatchObject({ configured: false, state: null, gate: null });
    expect(String(b.reason)).toMatch(/SUPABASE_URL/);
  });
});

describe('/api/rates/history', () => {
  it('historique des sources, puis nos instantanés après le dernier point ; NFP et IPC passés', async () => {
    const { ctx } = fakeSupabase({
      rate_history: (p) => (p.get('offset') === '0' ? [
        { source: 'polymarket', outcome: 'hold', t: iso(NOW - 3 * 3_600_000), p: '0.05' },
        { source: 'polymarket', outcome: 'hold', t: iso(NOW - 2 * 3_600_000), p: '0.04' },
      ] : []),
      rate_quotes: (p) => (p.get('hourly') === 'is.true'
        ? [{ source: 'polymarket', ts: iso(NOW - 2 * 3_600_000), probs: { hold: { p: 0.99 } } },   // déjà couvert par la source
          { source: 'polymarket', ts: iso(NOW - 3_600_000), probs: { hold: { p: 0.035 }, p25: { p: 0.93 } } }]
        : [{ source: 'polymarket', ts: iso(NOW - 30_000), probs: { hold: { p: 0.0325 } } }]),
      official_releases: () => [
        { title: 'Employment Situation', local_date: '2026-11-06', utc_ms: Date.parse('2026-11-06T13:30:00Z') },
        { title: 'Consumer Price Index', local_date: '2026-12-10', utc_ms: Date.parse('2026-12-10T13:30:00Z') },
      ],
    });
    const r = await get(ctx, '/api/rates?path=history&bank=FED&meeting=2026-12-09&days=60');
    expect(r.status).toBe(200);
    const b = await r.json() as { series: Record<string, Record<string, { t: number; p: number }[]>>; markers: unknown[] };
    expect(b.series.polymarket.hold.map((x) => x.p)).toEqual([0.05, 0.04, 0.035, 0.0325]);
    expect(b.series.polymarket.p25).toEqual([{ t: NOW - 3_600_000, p: 0.93 }]);
    expect(b.markers).toEqual([{ label: 'NFP', title: 'Employment Situation', date: '2026-11-06', t: Date.parse('2026-11-06T13:30:00Z'), source: 'BLS' }]);
  });

  it('paramètres contrôlés', async () => {
    const { ctx } = fakeSupabase({});
    for (const [path, status] of [
      ['/api/rates?path=history&bank=ECB&meeting=2026-12-17', 400],
      ['/api/rates?path=history&bank=BCE&meeting=17/12/2026', 400],
      ['/api/rates?path=history&bank=BCE&meeting=2026-12-17&days=90', 400],
      ['/api/rates?path=history&bank=BCE&meeting=2026-12-17&x=1', 400],
      ['/api/rates?path=state&bank=FED', 400],
      ['/api/rates?path=nope', 404],
    ] as const) expect((await get(ctx, path)).status, path).toBe(status);
    expect((await handleRates(new Request('https://x/api/rates?path=state', { method: 'POST' }), ctx)).status).toBe(405);
  });

  it('échantillonnage : premier et dernier points gardés', () => {
    const s = thin(Array.from({ length: 1000 }, (_, i) => ({ t: i, p: i })), 100);
    expect(s).toHaveLength(100);
    expect([s[0].t, s[99].t]).toEqual([0, 999]);
  });
});
