// @vitest-environment node
// Tâches macro et fx (M1) : base simulée, réseau rejoué depuis les captures du 24/11/2026.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { SERIES } from './catalog.ts';
import { runFx, runMacro, type HttpFetch } from './macro.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 10, 24, 6, 0);

function fakeFetch(fail: (url: string) => boolean = () => false) {
  const calls: string[] = [];
  const f: HttpFetch = async (url) => {
    calls.push(url);
    if (fail(url)) return { status: 503, text: async () => 'indisponible' };
    const dbn: Record<string, string> = { 'ONS/MM23/D7G7.M': 'dbnomics-ONS_MM23_D7G7.M-2026-11-24.json', 'RBA/G1/GCPIAGYP': 'dbnomics-RBA_G1_GCPIAGYP-2026-11-24.json',
      'STATJP/CPIm/001': 'dbnomics-STATJP_CPIm_001-2026-11-24.json', 'ONS/QNA/IHYR.Q': 'dbnomics-ONS_QNA_IHYR.Q-2026-11-24.json', 'ONS/PN2/IHYR.Q': 'dbnomics-ONS_PN2_IHYR.Q-2026-11-24.json' };
    const key = Object.keys(dbn).find((k) => url.includes(k));
    const body = url.includes('db.nomics') ? (key ? fx(dbn[key]) : '{"series":{"docs":[]}}')
      : url.includes('statcan') ? fx('statcan-5-vectors-2026-11-24.json')
        : url.includes('snb.ch') ? fx(`snb-${url.split('/cube/')[1].split('/')[0]}-2026-11-24.csv`)
          : url.includes('NAEXKP01NZ') ? fx('fred-naexkp01nzq657s-2026-11-24.csv')
            : url.includes('stats.bis.org') ? fx('bis-monthly-2026-11-24.csv')
      : url.includes('ecb.europa.eu') ? (url.includes('MNA') ? fx('ecb-gdp-2026-11-24.csv') : fx('ecb-hicp-2026-11-24.csv'))
        : url.includes('GDPC1') ? fx('fred-gdpc1-2026-11-24.csv')
          : url.includes('DEX') ? fx('fred-dexuseu-2026-11-24.csv') : fx('fred-cpiaucsl-30-2026-11-24.csv');
    return { status: 200, text: async () => body };
  };
  return { f, calls };
}

describe('tâche macro', () => {
  it('toutes les sources du catalogue relevées ; jamais l’OCDE ; série vide : erreur sur sa ligne', async () => {
    const rest = new MemRest();
    const { f, calls } = fakeFetch();
    const r = await runMacro({ fetch: f, now: () => NOW, rest });
    expect(calls.some((u) => u.includes('oecd.org'))).toBe(false);
    expect(calls.filter((u) => u.includes('stats.bis.org'))).toHaveLength(1);
    expect(r.done).toMatchObject({ 'US:cpi': '2026-09', 'EA:cpi': '2026-10', 'EA:gdp': '2026-Q3', 'US:policy': '2026-10', 'JP:policy': '2026-10',
      'GB:cpi': '2026-10', 'GB:gdp': '2026-Q3', 'AU:cpi': '2026-Q3', 'CH:cpi': '2026-10', 'CH:gdp': '2026-Q2', 'CA:unemployment': '2026-10',
      'CA:gdp': '2026-Q2', 'NZ:gdp': '2026-Q2' });
    expect(calls.filter((u) => u.includes('statcan'))).toHaveLength(1);
    expect(rest.rows('macro_series')).toHaveLength(SERIES.length);
    // Série DBnomics absente du rejeu : erreur lisible sur sa ligne, les autres continuent.
    expect(rest.rows('macro_series').find((x) => x.id === 'AU:unemployment')).toMatchObject({ last_error: 'aucune observation chiffrée' });
    const us = rest.rows('macro_observations').filter((x) => x.series_id === 'US:cpi');
    expect(us.at(-1)).toMatchObject({ period: '2026-09', period_end: '2026-09-30' });
    expect((rest.rows('p3_state').find((x) => x.key === 'feed:macro')!.value as { status: string }).status).toBe('connected');
  });

  it('une source en panne : erreur sur ses séries, les autres continuent ; deuxième passage sans doublon', async () => {
    const rest = new MemRest();
    await runMacro({ fetch: fakeFetch().f, now: () => NOW, rest });
    const n = rest.rows('macro_observations').length;
    const r = await runMacro({ fetch: fakeFetch((u) => u.includes('ecb.europa.eu')).f, now: () => NOW + 86_400_000, rest });
    expect(r.ok).toBe(false);
    expect(rest.rows('macro_series').find((x) => x.id === 'EA:cpi')).toMatchObject({ last_error: 'HTTP 503', last_period: '2026-10' });
    expect(rest.rows('macro_series').find((x) => x.id === 'US:cpi')).toMatchObject({ last_error: null, last_ok_ms: NOW + 86_400_000 });
    expect(rest.rows('macro_observations')).toHaveLength(n);
  });
});

describe('tâche fx', () => {
  it('fin de mois, en dollars par unité (yen, franc et dollar canadien inversés)', async () => {
    const rest = new MemRest();
    const r = await runFx({ fetch: fakeFetch().f, now: () => NOW, rest });
    expect(r).toMatchObject({ ok: true, done: { EA: '2026-11', JP: '2026-11' } });
    const eur = rest.rows('macro_observations').filter((x) => x.series_id === 'FX:EA').at(-1)!;
    const jpy = rest.rows('macro_observations').filter((x) => x.series_id === 'FX:JP').at(-1)!;
    expect(eur.value).toBe(1.0981);
    expect(jpy.value).toBeCloseTo(1 / 1.0981, 6);   // même capture rejouée : seule l'inversion compte ici
  });
});
