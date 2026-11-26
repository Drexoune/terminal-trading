// @vitest-environment node
// Service des analyses de P7 (T-075) : base et réseau simulés. Bougies d'OKX lues (bougie en cours
// exclue), semaines agrégées, saisonnalité paginée depuis bt_candles, heatmap avec « — » motivés,
// flux réel d'ING (25/11/2026) : titre, lien, résumé, sans texte d'article ; rythme des passes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../../supabase/functions/p1-jobs/_memrest';
import { AnalysisService, mergeResearch, okxBars, researchItems, weekly, type TechAsset } from './main';

const XML = readFileSync(new URL('./fixtures/ing-think-2026-11-25.xml', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-26T10:05:00Z');
const DAY = 86_400_000;

function okxReply(n: number, step: number) {
  const rows = Array.from({ length: n }, (_, i) => { const t = NOW - (n - i) * step, c = 100 + i; return [String(t), String(c - 0.5), String(c + 1), String(c - 1), String(c), '1', '1', '1', i === n - 1 ? '0' : '1']; });
  return { code: '0', data: rows.reverse() };
}

function setup() {
  const rest = new MemRest();
  for (const asset of ['BTC', 'SPY']) {
    for (let i = 0; i < 2_500; i++) {
      const t = Date.parse('2019-12-31T00:00:00Z') + i * DAY;
      rest.rows('bt_candles').push({ asset, tf: '1D', ts: new Date(t).toISOString(), open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i });
    }
  }
  const urls: string[] = [];
  const fetch = async (u: string) => {
    urls.push(u);
    if (u.startsWith('https://think.ing.com/')) return new Response(XML, { status: 200 });
    const bar = new URL(u).searchParams.get('bar')!;
    const step = bar === '1H' ? 3_600_000 : bar === '4H' ? 4 * 3_600_000 : bar === '1Dutc' ? DAY : 7 * DAY;
    return new Response(JSON.stringify(okxReply(300, step)), { status: 200 });
  };
  let now = NOW;
  const svc = new AnalysisService({ rest, fetch, now: () => now });
  return { rest, svc, urls, at: (ms: number) => { now = ms; } };
}

const state = async <T>(rest: MemRest, key: string) => (await rest.select<{ value: T }>('p1_state', { select: 'value', key: `eq.${key}` }))[0]?.value;

describe('briques', () => {
  it('bougies OKX triées, bougie en cours exclue ; semaines du lundi', () => {
    const b = okxBars(okxReply(5, DAY));
    expect(b).toHaveLength(4);
    expect(b[0].t).toBeLessThan(b[3].t);
    const w = weekly([{ t: Date.parse('2026-11-23T00:00:00Z'), o: 1, h: 5, l: 1, c: 2 }, { t: Date.parse('2026-11-27T00:00:00Z'), o: 2, h: 3, l: 0.5, c: 4 }, { t: Date.parse('2026-11-30T00:00:00Z'), o: 4, h: 4, l: 4, c: 4 }]);
    expect(w).toEqual([{ t: Date.parse('2026-11-23T00:00:00Z'), o: 1, h: 5, l: 0.5, c: 4 }, { t: Date.parse('2026-11-30T00:00:00Z'), o: 4, h: 4, l: 4, c: 4 }]);
  });
  it('flux réel d’ING : 10 articles, liens d’ING, résumé sans balise, date lue ; fusion sans doublon', () => {
    const items = researchItems(XML, NOW);
    expect(items).toHaveLength(10);
    expect(items[0].title).toBe('Strong growth and elevated inflation signal more Fed tightening');
    expect(items.every((i) => i.link.startsWith('https://think.ing.com/') && !/[<>]/.test(i.summary ?? '') && (i.summary ?? '').length <= 600)).toBe(true);
    expect(items[0].published_ms).toBe(Date.parse('2026-11-25T14:15:00Z'));
    const merged = mergeResearch(items.slice(0, 3).map((i) => ({ ...i, seen_ms: 1 })), items);
    expect(merged).toHaveLength(10);
    expect(merged.find((i) => i.id === items[0].id)!.seen_ms).toBe(1);
  });
});

describe('passes', () => {
  it('saisonnalité paginée (2 500 jours lus en 3 pages) et heatmap avec raisons', async () => {
    const { rest, svc, urls } = setup();
    await svc.tick();
    const btc = await state<{ bars_daily: number; months: unknown[] }>(rest, 'analysis:season:BTC');
    expect(btc.bars_daily).toBe(2_500);
    expect(btc.months).toHaveLength(12);
    expect(await state(rest, 'analysis:season:ETH')).toBeUndefined();      // aucune bougie : rien d'écrit
    const tech = await state<{ assets: TechAsset[] }>(rest, 'analysis:tech');
    const b = tech.assets.find((a) => a.asset === 'BTC')!;
    expect(b.cells.map((c) => [c.tf, c.bars, c.snap?.trend])).toEqual([['1H', 299, 'up'], ['4H', 299, 'up'], ['1D', 299, 'up'], ['1W', 299, 'up']]);
    const spy = tech.assets.find((a) => a.asset === 'SPY')!;
    expect(spy.cells[0].reason).toMatch(/intrajournalières/);
    expect(spy.cells[2].bars).toBeGreaterThan(2_000);
    expect(tech.assets.find((a) => a.asset === 'EURUSD')!.cells.every((c) => c.snap === null && /T-051/.test(c.reason!))).toBe(true);
    expect(urls.filter((u) => u.includes('okx.com'))).toHaveLength(8);
    const res = await state<{ ok: boolean; items: unknown[] }>(rest, 'research:ing');
    expect(res.ok).toBe(true);
    expect(res.items).toHaveLength(10);
  });
  it('rythme : ING toutes les 15 min, heatmap une fois par heure après 2 min, saisonnalité toutes les 20 h', async () => {
    const { svc, urls, at } = setup();
    await svc.tick();
    const n = () => [urls.filter((u) => u.includes('ing.com')).length, urls.filter((u) => u.includes('okx.com')).length];
    expect(n()).toEqual([1, 8]);
    at(NOW + 5 * 60_000); await svc.tick();
    expect(n()).toEqual([1, 8]);
    at(NOW + 16 * 60_000); await svc.tick();
    expect(n()).toEqual([2, 8]);
    at(Date.parse('2026-11-26T11:01:00Z')); await svc.tick();             // nouvelle heure, avant 2 min
    expect(n()[1]).toBe(8);
    at(Date.parse('2026-11-26T11:02:30Z')); await svc.tick();
    expect(n()[1]).toBe(16);
  });
  it('flux d’ING en panne : éléments gardés, erreur notée', async () => {
    const { rest, svc } = setup();
    await svc.researchPass();
    const bad = new AnalysisService({ rest, fetch: async () => new Response('nope', { status: 503 }), now: () => NOW + 3_600_000 });
    await bad.researchPass();
    const res = await state<{ ok: boolean; error: string; items: unknown[] }>(rest, 'research:ing');
    expect(res).toMatchObject({ ok: false, error: 'HTTP 503' });
    expect(res.items).toHaveLength(10);
  });
});
