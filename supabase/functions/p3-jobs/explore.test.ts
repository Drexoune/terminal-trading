// @vitest-environment node
// Sonde M0 de p3-jobs : lecture des réponses réelles du 24/11/2026 (OCDE, BCE, FRED), une ligne par
// source, appel protégé par le secret.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvFields, dbnomicsLast, explore, fredLast, lastByArea, type ExploreDeps } from './explore.ts';
import { createHandler } from './handler.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('lecture des réponses réelles', () => {
  it('CSV : guillemets, virgules et guillemets doublés', () => {
    expect(csvFields('a,"b, c","d ""e"""')).toEqual(['a', 'b, c', 'd "e"']);
  });
  it('OCDE : dernière période par économie (chômage mensuel ou trimestriel)', () => {
    const last = lastByArea(fx('oecd-unemployment-2026-11-24.csv'));
    expect(last).toMatchObject({ USA: '2026-Q3', CAN: '2026-Q3', NZL: '2026-Q3', CHE: '2026-Q2' });
    expect(Object.keys(last).sort()).toEqual(['AUS', 'CAN', 'CHE', 'GBR', 'JPN', 'NZL', 'USA']);   // zone euro : BCE
  });
  it('BCE : libellés entre guillemets avec virgules ; FRED ; DBnomics', () => {
    expect(lastByArea(fx('ecb-hicp-2026-11-24.csv'))).toEqual({ U2: '2026-10' });
    expect(fredLast(fx('fred-cpiaucsl-2026-11-24.csv'))).toBe('2026-10-01');
    expect(dbnomicsLast('{"series":{"docs":[{"period":["2026-04","2026-05"],"indexed_at":"2026-06-16T03:00:00Z"}]}}'))
      .toEqual({ period: '2026-05', indexed_at: '2026-06-16T03:00:00Z' });
  });
});

describe('sonde M0', () => {
  const deps = (status: number): ExploreDeps => {
    let t = 0;
    return {
      now: () => 1_795_500_000_000, perf: () => (t += 5), sleep: async () => {}, env: (n) => (n === 'SB_REGION' ? 'eu-central-2' : undefined),
      fetch: async (url) => ({
        status, headers: { get: (k: string) => (k === 'cf-cache-status' ? 'DYNAMIC' : null) },
        text: async () => url.includes('ecb') ? fx('ecb-hicp-2026-11-24.csv') : url.includes('fred') ? fx('fred-cpiaucsl-2026-11-24.csv')
          : url.includes('db.nomics') ? '{"series":{"docs":[]}}' : fx('oecd-unemployment-2026-11-24.csv'),
      }),
    };
  };
  it('une ligne par source, rien d’écrit, échec visible', async () => {
    const r = await explore(deps(200)) as { ok: boolean; region: string; lines: { label: string; status: number; extract: unknown }[] };
    expect(r.ok).toBe(true);
    expect(r.region).toBe('eu-central-2');
    expect(r.lines.map((l) => l.label)).toEqual(['oecd-cpi-2018', 'oecd-unemployment', 'oecd-unemployment-accept', 'oecd-structure', 'ecb-hicp', 'fred-cpi', 'bis-monthly', 'dbnomics-oecd-cpi-usa']);
    expect(r.lines.find((l) => l.label === 'fred-cpi')!.extract).toEqual({ last: '2026-10-01' });
    expect((await explore(deps(403)) as { ok: boolean }).ok).toBe(false);
  });
  it('appel protégé par x-jobs-secret, tâche connue seulement', async () => {
    const secret = 's'.repeat(40);
    const h = createHandler((n) => (n === 'P1_JOBS_SECRET' ? secret : undefined), { ...deps(200), run: async () => ({ ok: true }) });
    const post = (job: string, s = secret) => h(new Request(`https://x/p3-jobs?job=${job}`, { method: 'POST', headers: { 'x-jobs-secret': s } }));
    expect((await post('explore')).status).toBe(200);
    expect((await post('explore', 'faux')).status).toBe(401);
    expect((await post('inconnue')).status).toBe(400);
  });
});
