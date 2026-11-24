// @vitest-environment node
// Tâche candles (section Backtest, S1) sur la base simulée, réponses réelles d'OKX du 24/11/2026 :
// bougies closes seulement, reprise de l'historique dans le budget de pages, Tiingo ajusté, clé
// jamais recopiée, appel protégé.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { type CandleDeps, okxBars, PAGE_BUDGET, runCandles, tiingoBars } from './candles.ts';
import { createHandler } from './handler.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 10, 24, 14);
const KEY = 'tiingo-cle-de-test-123456';
const TIINGO = JSON.stringify([
  { date: '1999-03-10T00:00:00.000Z', adjOpen: 44.1, adjHigh: 44.6, adjLow: 43.2, adjClose: 44.4, adjVolume: 5_232_000, close: 102.5 },
  { date: '2026-11-23T00:00:00.000Z', adjOpen: 611, adjHigh: 615, adjLow: 605, adjClose: 612.4, adjVolume: 41_000_000 },
]);

/** OKX simulé : pages de 100 bougies horaires ou quotidiennes, plus rien avant `floor`. */
function okxPage(url: string, floorMs: number): string {
  const u = new URL(url);
  const step = u.searchParams.get('bar') === '1H' ? 3_600_000 : 86_400_000;
  const after = Number(u.searchParams.get('after') ?? NOW);
  const top = Math.floor((after - 1) / step) * step;
  const data: string[][] = [];
  for (let t = top; data.length < 100 && t >= floorMs; t -= step) data.push([String(t), '1', '2', '0.5', '1.5', '10', '0', '0', t + step > NOW ? '0' : '1']);
  return JSON.stringify({ code: '0', msg: '', data });
}

function deps(rest: MemRest, opts: { seen?: string[]; floor?: number; fail?: (u: string) => boolean; key?: string } = {}): CandleDeps {
  return { rest, now: () => NOW, sleep: async () => {}, env: (n) => (n === 'TIINGO_API_KEY' ? (opts.key ?? KEY) || undefined : undefined),
    fetch: async (url, init) => {
      opts.seen?.push(`${url} ${JSON.stringify(init?.headers ?? {})}`);
      if (opts.fail?.(url)) return { status: 500, text: async () => `panne ${KEY}` };
      return { status: 200, text: async () => (url.includes('tiingo') ? TIINGO : okxPage(url, opts.floor ?? Date.UTC(2026, 9, 1))) };
    } };
}

describe('lecture des réponses', () => {
  it('OKX : bougies closes, ordre chronologique', () => {
    const d = okxBars(fx('okx-candles-1d-btc-2026-11-24.json'));
    expect(d.raw).toBe(100);
    expect(d.bars.length).toBe(99);   // bougie du 24/11 en cours
    expect(new Date(d.bars.at(-1)!.ts).toISOString()).toBe('2026-11-23T00:00:00.000Z');
    const h = okxBars(fx('okx-candles-1h-btc-2026-11-24.json'));
    expect(h.bars[1].ts - h.bars[0].ts).toBe(3_600_000);
    expect(() => okxBars('{"code":"50011","msg":"Too Many Requests"}')).toThrow(/50011/);
  });
  it('Tiingo : OHLC ajusté, pas le cours brut', () => {
    expect(tiingoBars(TIINGO)[0]).toEqual({ ts: Date.UTC(1999, 2, 10), open: 44.1, high: 44.6, low: 43.2, close: 44.4, volume: 5_232_000 });
    expect(() => tiingoBars('{"detail":"Invalid token."}')).toThrow(/Invalid token/);
  });
});

describe('tâche candles', () => {
  it('séries complètes quand OKX n’a plus rien ; bougie en cours exclue ; Tiingo relu en entier', async () => {
    const rest = new MemRest();
    const r = await runCandles(deps(rest));
    expect(r.ok).toBe(true);
    const st = (rest.rows('bt_state').find((x) => x.key === 'series')!.value) as Record<string, { complete: boolean; first: string; last: string }>;
    expect(st['BTC:1D']).toMatchObject({ complete: true, first: '2026-10-01T00:00:00.000Z', last: '2026-11-23T00:00:00.000Z' });
    expect(st['QQQ:1D']).toMatchObject({ first: '1999-03-10T00:00:00.000Z' });
    const btc = rest.rows('bt_candles').filter((x) => x.asset === 'BTC' && x.tf === '1D');
    expect(btc.length).toBe(54);   // 01/10 → 23/11
    expect(rest.rows('bt_candles').find((x) => x.asset === 'QQQ')).toMatchObject({ close: 44.4, source: 'tiingo' });
  });
  it('historique long : budget de pages respecté, reprise au passage suivant', async () => {
    const rest = new MemRest();
    const seen: string[] = [];
    const floor = Date.UTC(2021, 0, 1);
    expect(PAGE_BUDGET).toBe(120);
    const r1 = await runCandles({ ...deps(rest, { seen, floor }), pageBudget: 10 });
    expect(seen.filter((s) => s.includes('okx.com')).length).toBe(10);
    expect(r1.pages_left).toBe(0);
    const n1 = rest.rows('bt_candles').length;
    await runCandles({ ...deps(rest, { floor }), pageBudget: 10 });
    expect(rest.rows('bt_candles').length).toBeGreaterThan(n1);
    const st = (rest.rows('bt_state').find((x) => x.key === 'series')!.value) as Record<string, { complete: boolean }>;
    expect(st['BTC:1H'].complete).toBe(false);   // 2021 → 2026 en horaire : bien plus de 20 pages
  });
  it('panne de Tiingo : erreur visible, clé jamais recopiée, les autres séries continuent', async () => {
    const rest = new MemRest();
    const r = await runCandles(deps(rest, { fail: (u) => u.includes('tiingo') }));
    expect(r.ok).toBe(false);
    expect((r.problems as string[]).filter((p) => p.startsWith('QQQ') || p.startsWith('SPY')).length).toBe(2);
    expect(JSON.stringify(rest.tables.get('bt_state'))).not.toContain(KEY);
    expect(rest.rows('bt_state').find((x) => x.key === 'feed:candles')!.value).toMatchObject({ status: 'connected' });
  });
  it('Tiingo relu au plus une fois toutes les 20 h', async () => {
    const rest = new MemRest();
    const seen: string[] = [];
    await runCandles(deps(rest, { seen }));
    await runCandles(deps(rest, { seen }));
    expect(seen.filter((s) => s.includes('tiingo')).length).toBe(2);   // QQQ et SPY, une seule fois
  });
  it('appel protégé par x-jobs-secret, tâche connue seulement', async () => {
    const secret = 's'.repeat(40);
    const h = createHandler((n) => (n === 'P1_JOBS_SECRET' ? secret : undefined),
      { fetch: async () => ({ status: 200, text: async () => '{}' }), now: () => NOW, sleep: async () => {}, rest: new MemRest(), run: async () => ({ ok: true }) });
    const post = (job: string, s = secret) => h(new Request(`https://x/bt-jobs?job=${job}`, { method: 'POST', headers: { 'x-jobs-secret': s } }));
    expect((await post('candles')).status).toBe(200);
    expect((await post('candles', 'faux')).status).toBe(401);
    expect((await post('inconnue')).status).toBe(400);
  });
});
