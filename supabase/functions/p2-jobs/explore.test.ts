// @vitest-environment node
// Sonde R0 de p2-jobs : lecture des réponses, une ligne par source, 403 de la RBNZ toléré.
import { describe, expect, it } from 'vitest';
import { explore, readBisCsv, readGammaEvents, readKalshiEvents, type ExploreDeps } from './explore.ts';
import { createHandler } from './handler.ts';

const BIS_CSV = `FREQ,REF_AREA,UNIT_MEASURE,UNIT_MULT,TIME_FORMAT,COMPILATION,DECIMALS,SOURCE_REF,SUPP_INFO_BREAKS,TITLE,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK
D,US,368,0,,"From 19 Dec 1985 onwards: mid-point, of the target",4,US Federal Reserve System,, Central bank policy rates - United States,2026-11-17,3.875,A,F,
D,XM,368,0,,x,4,European Central Bank,, Central bank policy rates - Euro area,2026-11-17,2.5,A,F,`;

function deps(status: (url: string) => number): ExploreDeps {
  let t = 0;
  return {
    now: () => 1_795_400_000_000, perf: () => (t += 5), sleep: async () => {}, env: () => undefined,
    fetch: async (url) => ({
      status: status(url), headers: { get: (k: string) => (k === 'x-ratelimit-limit' ? '600' : null) },
      text: async () => url.includes('gamma') ? JSON.stringify([{ slug: 'fed-decision', title: 'Fed Decision in December?', endDate: '2026-12-10',
        markets: [{ groupItemTitle: 'No change', bestBid: 0.03, bestAsk: 0.031, clobTokenIds: '["123"]' }] }])
        : url.includes('prices-history') ? '{"history":[{"t":1,"p":0.03}]}'
          : url.includes('kalshi') ? JSON.stringify({ events: [{ event_ticker: 'KXFEDDECISION-26DEC', sub_title: 'On Dec 9, 2026',
            markets: [{ ticker: 'KXFEDDECISION-26DEC-H0', yes_bid_dollars: '0.0300', yes_ask_dollars: '0.0400' }] }] })
            : url.includes('bis.org') ? BIS_CSV : '<html>2027 FOMC Meetings</html>',
    }),
  };
}

describe('sonde R0 de p2-jobs', () => {
  it('lit Polymarket, Kalshi et le CSV du BIS (virgules entre guillemets comprises)', () => {
    expect(readBisCsv(BIS_CSV)).toEqual({ US: ['2026-11-17', 3.875], XM: ['2026-11-17', 2.5] });
    expect(readKalshiEvents('{"events":[]}')).toEqual([]);
    expect(readGammaEvents('[]')).toEqual({ events: 0 });
  });

  it('une ligne par source ; la RBNZ peut refuser (403) sans faire échouer la sonde', async () => {
    const r = await explore(deps((u) => (u.includes('rbnz') ? 403 : 200)));
    expect(r.ok).toBe(true);
    const lines = r.lines as { label: string; status: number; extract: unknown; headers: Record<string, string> }[];
    expect(lines.map((l) => l.label)).toEqual(['polymarket-gamma', 'polymarket-clob-history', 'kalshi-events', 'bis-cbpol', 'fed-calendar', 'rbnz-calendar']);
    expect(lines[0].extract).toMatchObject({ token: '123', markets: [{ outcome: 'No change', bid: 0.03 }] });
    expect(lines[2].headers['x-ratelimit-limit']).toBe('600');
    expect((await explore(deps((u) => (u.includes('kalshi') ? 451 : 200)))).ok).toBe(false);
  });

  it('secret d’appel exigé, tâche inconnue refusée', async () => {
    const h = createHandler((k) => (k === 'P1_JOBS_SECRET' ? 's'.repeat(40) : undefined), { ...deps(() => 200), run: async () => ({ ok: true }) });
    const req = (job: string, secret: string) => new Request(`https://x/functions/v1/p2-jobs?job=${job}`, { method: 'POST', headers: { 'x-jobs-secret': secret } });
    expect((await h(req('explore', 'nope'))).status).toBe(401);
    expect((await h(req('capture', 's'.repeat(40)))).status).toBe(400);
    expect((await h(req('explore', 's'.repeat(40)))).status).toBe(200);
  });
});
