/** @vitest-environment node */
// GET /api/chart : même JSON que la passerelle (OkxService.chart), mêmes
// requêtes à OKX, liste blanche, validation des paramètres, en-têtes de cache.

import { describe, expect, it, vi } from 'vitest';
import type { ChartData } from '../../web/src/data/protocol.ts';
import { CHART_SOURCE, DAY_MS } from '../_lib/chart.ts';
import { CACHE_CHART } from '../_lib/http.ts';
import { handleChart } from '../_lib/routes.ts';
import { readJson, req, testContext, type Recorded } from './fakes.ts';

interface Golden {
  now_ms: number;
  listing_ms: number;
  cases: Record<string, { requests: { path: string; params: Record<string, string> }[]; chart: ChartData }>;
}

const golden = readJson<Golden>('api/_tests/fixtures/chart_golden.json');
const GATEWAY_SOURCE = 'OKX EEA REST'; // `source` de la passerelle ; la fonction ajoute « · Vercel »

async function chartOf(path: string, ctx = testContext({ nowMs: golden.now_ms, listingMs: golden.listing_ms })) {
  const res = await handleChart(req(path), ctx.ctx);
  return { res, body: await res.json(), calls: ctx.calls, ctx };
}

describe('parité avec la passerelle (fixtures/chart_golden.json)', () => {
  for (const [key, expected] of Object.entries(golden.cases)) {
    const [inst, range] = key.split('|');
    it(`${inst} ${range} : mêmes requêtes OKX, même JSON`, async () => {
      const { res, body, calls } = await chartOf(`/api/chart?inst=${inst}&range=${range}`);
      expect(res.status).toBe(200);
      expect(calls.map((c: Recorded) => ({ path: c.path, params: c.params }))).toEqual(expected.requests);
      expect({ ...body, source: GATEWAY_SOURCE }).toEqual(expected.chart);
      expect(body.source).toBe(CHART_SOURCE);
      // Même ordre de clés, au niveau du graphique et de chaque bougie.
      expect(Object.keys(body)).toEqual(Object.keys(expected.chart));
      expect(Object.keys(body.candles[0])).toEqual(Object.keys(expected.chart.candles[0]));
      expect(Object.keys(body.prev_day)).toEqual(Object.keys(expected.chart.prev_day!));
    });
  }

  it('le jeu de référence couvre la pagination (1 J sur deux pages de 300) et la veille UTC', () => {
    const d = golden.cases['BTC-USDT-SWAP|1D'];
    expect(d.chart.candles).toHaveLength(301);
    expect(d.requests.filter((r) => r.params.bar === '1m').map((r) => r.params.limit)).toEqual(['300', '300']);
    expect(d.chart.prev_day).not.toBeNull();
  });
});

describe('forme du graphique', () => {
  it('sans paramètre : BTC-USDT-SWAP, 1 J, journée UTC en cours', async () => {
    const { body } = await chartOf('/api/chart');
    const today = golden.now_ms - (golden.now_ms % DAY_MS);
    expect(body).toMatchObject({ inst: 'BTC-USDT-SWAP', range: '1D', bar: '1m', bar_ms: 60_000, from_ms: today, to_ms: today + DAY_MS });
    expect(body.ts_recv).toBe(golden.now_ms);
  });

  it('1 M : bougies d’une heure sur 30 jours', async () => {
    const { body } = await chartOf('/api/chart?inst=ETH-USDT-SWAP&range=1M');
    const today = golden.now_ms - (golden.now_ms % DAY_MS);
    expect(body).toMatchObject({ inst: 'ETH-USDT-SWAP', range: '1M', bar: '1H', bar_ms: 3_600_000, from_ms: today - 29 * DAY_MS });
  });

  it('sans bougie de la veille : prev_day null, jamais une valeur supposée', async () => {
    const t = testContext({ nowMs: golden.now_ms, listingMs: golden.now_ms - 3_600_000 });
    const { body } = await chartOf('/api/chart?range=1D', t);
    expect(body.prev_day).toBeNull();
    expect(body.candles.length).toBe(61);
  });
});

describe('en-têtes et cache', () => {
  it('Cache-Control de la spécification, JSON', async () => {
    const { res } = await chartOf('/api/chart?range=5D');
    expect(res.headers.get('cache-control')).toBe(CACHE_CHART);
    expect(CACHE_CHART).toBe('public, max-age=0, s-maxage=15, stale-while-revalidate=15');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('access-control-allow-origin')).toBeNull(); // même origine seulement
  });

  it('cache de 15 s par instance : un seul appel OKX, puis nouvel appel passé ce délai', async () => {
    const t = testContext({ nowMs: golden.now_ms, listingMs: golden.listing_ms });
    await handleChart(req('/api/chart?range=1M'), t.ctx);
    const first = t.calls.length;
    await handleChart(req('/api/chart?range=1M'), t.ctx);
    expect(t.calls.length).toBe(first);
    t.clock.advance(15_000);
    await handleChart(req('/api/chart?range=1M'), t.ctx);
    expect(t.calls.length).toBe(2 * first);
  });

  it('requêtes simultanées : un seul chargement partagé', async () => {
    const t = testContext({ nowMs: golden.now_ms, listingMs: golden.listing_ms });
    const all = await Promise.all([1, 2, 3].map(() => handleChart(req('/api/chart?range=1M'), t.ctx)));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(t.calls).toHaveLength(golden.cases['BTC-USDT-SWAP|1M'].requests.length);
  });

  it('un échec n’est pas gardé en cache, ni par l’instance ni par le CDN', async () => {
    let fail = true;
    const t = testContext({
      nowMs: golden.now_ms, listingMs: golden.listing_ms,
      override: () => (fail ? new Response('down', { status: 503 }) : undefined),
    });
    const bad = await handleChart(req('/api/chart'), t.ctx);
    expect(bad.status).toBe(502);
    expect(bad.headers.get('cache-control')).toBe('no-store');
    expect(await bad.json()).toEqual({ detail: 'OKX indisponible : HTTP 503' });
    fail = false;
    expect((await handleChart(req('/api/chart'), t.ctx)).status).toBe(200);
  });
});

describe('validation des paramètres', () => {
  const cases: [string, number, string][] = [
    ['/api/chart?inst=DOGE-USDT-SWAP', 404, 'instrument non suivi : DOGE-USDT-SWAP'],
    ['/api/chart?inst=btc-usdt-swap', 404, 'instrument non suivi : btc-usdt-swap'],
    ['/api/chart?range=9Y', 404, 'période inconnue : 9Y'],
    ['/api/chart?range=1d', 404, 'période inconnue : 1d'],
    ['/api/chart?range=__proto__', 404, 'période inconnue : __proto__'],
    ['/api/chart?inst=', 400, 'paramètre inst vide'],
    ['/api/chart?range=1D&range=5D', 400, 'paramètre répété : range'],
    ['/api/chart?bar=1s', 400, 'paramètre inconnu : bar (attendus : inst, range)'],
  ];
  for (const [path, status, detail] of cases) {
    it(`${path} -> ${status}`, async () => {
      const { res, body, calls } = await chartOf(path);
      expect(res.status).toBe(status);
      expect(body).toEqual({ detail });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(calls).toHaveLength(0); // rien n'est demandé à OKX
    });
  }

  it('une valeur longue ou piégée est tronquée et nettoyée dans le message', async () => {
    const { body } = await chartOf(`/api/chart?inst=${encodeURIComponent(`A\u0000B${'x'.repeat(100)}`)}`);
    expect(body.detail).toBe(`instrument non suivi : AB${'x'.repeat(38)}…`);
  });
});

describe('aucune fuite dans les erreurs', () => {
  it('une erreur réseau ne renvoie qu’un message générique (détail au journal, sans secret)', async () => {
    const secret = 'sb_secret_abcdefghijklmnopqrstuvwxyz';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = testContext({
      nowMs: golden.now_ms, env: { SUPABASE_SECRET_KEY: secret },
      override: () => { throw new TypeError(`connect ECONNREFUSED 10.0.0.7:3128 ${secret}`); },
    });
    const res = await handleChart(req('/api/chart'), t.ctx);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(text)).toEqual({ detail: 'OKX indisponible : injoignable ou délai dépassé' });
    expect(text).not.toContain('10.0.0.7');
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).not.toContain(secret);
    warn.mockRestore();
  });

  it('le message d’erreur d’OKX ne part pas dans la réponse, seul le code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = testContext({
      nowMs: golden.now_ms,
      override: () => new Response(JSON.stringify({ code: '50011', msg: 'Rate limit reached <script>' }), { status: 200 }),
    });
    const res = await handleChart(req('/api/chart'), t.ctx);
    expect(await res.json()).toEqual({ detail: 'OKX indisponible : code 50011' });
    vi.restoreAllMocks();
  });
});
