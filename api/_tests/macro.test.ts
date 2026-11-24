// @vitest-environment node
// /api/macro/probe (P3, M0, T-057) : secret exigé, deux requêtes à l'OCDE, lecture du CSV réel.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleMacro, lastByArea, sameSecret } from '../_lib/macro.js';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';

const SECRET = 'x'.repeat(40);
const UNE = readFileSync(new URL('../../supabase/functions/p3-jobs/fixtures/oecd-unemployment-2026-11-24.csv', import.meta.url), 'utf8');

function ctx(status: number, env: Record<string, string> = { P1_JOBS_SECRET: SECRET }) {
  const urls: string[] = [];
  const fetch: FetchFn = async (url) => {
    urls.push(url);
    return new Response(status === 200 ? UNE : 'Internal server error', { status, headers: { 'cf-cache-status': 'MISS' } });
  };
  return { urls, ctx: createContext({ fetch, now: () => 0, monotonic: () => 0, sleep: async () => {} }, env) };
}
const req = (secret?: string) => new Request('https://x/api/macro?path=probe', { headers: secret ? { 'x-jobs-secret': secret } : {} });
const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };

describe('/api/macro/probe', () => {
  it('sans le secret : 401, et aucune requête à l’OCDE', async () => {
    const { ctx: c, urls } = ctx(200);
    expect((await handleMacro(req('faux'), c)).status).toBe(401);
    expect((await handleMacro(req(), c)).status).toBe(401);
    expect(urls).toEqual([]);
    expect((await handleMacro(req(SECRET), ctx(200, {}).ctx)).status).toBe(503);
  });
  it('avec le secret : deux requêtes, dernière période par économie, refus de l’OCDE visible', async () => {
    const { ctx: c, urls } = ctx(200);
    const b = await (await handleMacro(req(SECRET), c)).json() as { ok: boolean; lines: { label: string; last: Record<string, string> }[] };
    expect(b.ok).toBe(true);
    expect(urls.every((u) => u.startsWith('https://sdmx.oecd.org/public/rest/data/'))).toBe(true);
    expect(b.lines[1].last).toMatchObject({ USA: '2026-Q3', CHE: '2026-Q2' });
    const refused = await (await handleMacro(req(SECRET), ctx(500).ctx)).json() as { ok: boolean; lines: { status: number; last: string }[] };
    expect(refused).toMatchObject({ ok: false, lines: [{ status: 500, last: 'Internal server error' }, { status: 500 }] });
  });
  it('outils : secret à temps constant, CSV de l’OCDE', async () => {
    expect(await sameSecret(SECRET, SECRET)).toBe(true);
    expect(await sameSecret(`${SECRET}y`, SECRET)).toBe(false);
    expect(Object.keys(lastByArea(UNE)).length).toBe(7);
  });
});

describe('/api/macro/state et /api/macro/series', () => {
  function supa(tables: Record<string, (p: URLSearchParams) => unknown[]>) {
    const urls: string[] = [];
    const fetch: FetchFn = async (url) => {
      urls.push(url);
      const u = new URL(url);
      return new Response(JSON.stringify(tables[u.pathname.split('/').pop()!]?.(u.searchParams) ?? []), { status: 200 });
    };
    return { urls, ctx: createContext({ fetch, now: () => Date.parse('2026-11-24T08:00:00Z'), monotonic: () => 0, sleep: async () => {} }, ENV) };
  }
  it('état : scores, fiches, backtest, flux, taux de l’écran Taux en lecture', async () => {
    const { ctx } = supa({
      p3_state: () => [{ key: 'scores', value: { date: '2026-11-24', rows: [] }, updated_ms: 1 }, { key: 'backtest', value: { proven: false }, updated_ms: 1 }],
      p2_state: () => [{ value: { banks: { BOJ: { name: 'Banque du Japon', policy: { display: 1.25 }, next: { date: '2026-12-18', days: 24 } } } }, updated_ms: 1 }],
      macro_series: () => [{ id: 'JP:cpi', source: 'dbnomics', last_period: '2026-10', last_ok_ms: 1, last_error: null }],
    });
    const b = await (await handleMacro(new Request('https://x/api/macro?path=state'), ctx)).json() as Record<string, unknown>;
    expect(b).toMatchObject({ configured: true, scores: { date: '2026-11-24' }, backtest: { proven: false }, sheets: null,
      rates: { JP: { bank: 'BOJ', policy: { display: 1.25 }, next: { date: '2026-12-18' } }, US: null }, series: [{ id: 'JP:cpi' }] });
  });
  it('série : fenêtre en années, paramètres contrôlés', async () => {
    const { ctx, urls } = supa({ macro_observations: (p) => (p.get('series_id') === 'eq.JP:cpi' ? [{ period: '2026-10', value: '2.3' }] : []) });
    const b = await (await handleMacro(new Request('https://x/api/macro?path=series&economy=JP&indicator=cpi&years=10'), ctx)).json() as { points: unknown[] };
    expect(b.points).toEqual([{ period: '2026-10', value: 2.3 }]);
    expect(new URL(urls[0]).searchParams.get('period_end')).toBe('gte.2016-11-24');
    for (const [path, status] of [['series&economy=XX&indicator=cpi', 400], ['series&economy=JP&indicator=pib', 400], ['series&economy=JP&indicator=cpi&years=7', 400],
      ['state&economy=JP', 400], ['nope', 404]] as const) {
      expect((await handleMacro(new Request(`https://x/api/macro?path=${path}`), ctx)).status, path).toBe(status);
    }
  });
});

