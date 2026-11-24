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
