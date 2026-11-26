// @vitest-environment node
// Service des options (T-075) : Deribit et base simulés. Relevé réel du 25/11/2026 transformé en
// options:latest, historique horaire, DVOL repris par pages, relevés relus après redémarrage, trous
// journalisés, panne de Deribit sans écriture.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../../supabase/functions/p1-jobs/_memrest';
import type { OptionsSnapshot } from '../../web/src/analysis/options';
import { OptionsService } from './main';

const fx = JSON.parse(readFileSync(new URL('../../web/src/analysis/fixtures/deribit-btc-2026-11-25.json', import.meta.url), 'utf8')) as { summary_ts: number; rows: unknown[] };
const T0 = fx.summary_ts;

function setup(dir?: string, fail = false) {
  const rest = new MemRest();
  const calls: string[] = [];
  const fetch = async (u: string) => {
    const url = new URL(u), m = url.pathname.split('/').pop()!;
    calls.push(m);
    if (fail) return new Response('{}', { status: 502 });
    if (m === 'get_index_price') return Response.json({ result: { index_price: 59_886.62 } });
    if (m === 'get_book_summary_by_currency') return Response.json({ result: fx.rows });
    const end = Number(url.searchParams.get('end_timestamp')), start = Number(url.searchParams.get('start_timestamp'));
    const from = Math.max(start, end - 1000 * 3_600_000);                 // 1 000 points par page
    const data = [];
    for (let t = Math.ceil(from / 3_600_000) * 3_600_000; t <= end; t += 3_600_000) data.push([t, 55, 56, 54, 55]);
    return Response.json({ result: { data, continuation: from > start ? from : null } });
  };
  let now = T0;
  const svc = new OptionsService({ rest, fetch, now: () => now, dir });
  return { rest, svc, calls, at: (ms: number) => { now = ms; } };
}
const state = async <T>(rest: MemRest, key: string) => (await rest.select<{ value: T }>('p1_state', { select: 'value', key: `eq.${key}` }))[0]?.value;

describe('service des options', () => {
  it('relevé réel → options:latest ; DVOL de 90 jours repris en 3 pages ; historique horaire', async () => {
    const { rest, svc, calls } = setup();
    await svc.tick();
    const s = await state<OptionsSnapshot & { source: string }>(rest, 'options:latest');
    expect(s.expiries).toHaveLength(3);
    expect(s.index).toBe(59_886.62);
    expect(s.dvol).toBe(55);
    expect(calls.filter((c) => c === 'get_volatility_index_data')).toHaveLength(3);
    expect(svc.dvol.size).toBeGreaterThan(2_150);
    const h = await state<{ points: unknown[]; dvol: unknown[] }>(rest, 'options:history');
    expect(h.points).toHaveLength(1);
    expect(h.dvol.length).toBe(svc.dvol.size);
  });
  it('toutes les 5 min ; trou de plus de 10 min journalisé ; relevés relus au redémarrage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opt-'));
    const { svc, calls, at } = setup(dir);
    await svc.tick();
    at(T0 + 60_000); await svc.tick();
    expect(calls.filter((c) => c === 'get_book_summary_by_currency')).toHaveLength(1);
    at(T0 + 5 * 60_000); await svc.tick();
    at(T0 + 30 * 60_000); await svc.tick();
    expect(calls.filter((c) => c === 'get_book_summary_by_currency')).toHaveLength(3);
    expect(svc.status.gaps).toEqual([{ from: T0 + 5 * 60_000, to: T0 + 30 * 60_000 }]);
    expect(new OptionsService({ rest: new MemRest(), fetch: async () => new Response(), now: () => T0 + 31 * 60_000, dir }).points).toHaveLength(3);
  });
  it('Deribit en panne : rien d’écrit, erreur notée', async () => {
    const { rest, svc } = setup(undefined, true);
    await svc.tick();
    expect(await state(rest, 'options:latest')).toBeUndefined();
    expect(String(svc.status.error)).toMatch(/HTTP 502/);
  });
});
