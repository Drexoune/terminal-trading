/** @vitest-environment node */
// GET /api/instruments, /api/okx-time, /api/health, et les fichiers api/<nom>.ts
// eux-mêmes (export GET, contexte réel, fetch natif simulé).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_INSTRUMENTS } from '../_lib/http.ts';
import { okxReply, readJson, req, testContext } from './fakes.ts';
import { handleHealth, handleInstruments, handleOkxTime } from '../_lib/routes.ts';
import * as chartFn from '../chart.ts';
import * as healthFn from '../health.ts';
import * as instrumentsFn from '../instruments.ts';
import * as okxTimeFn from '../okx-time.ts';
import * as collectorHealthFn from '../collector-health.ts';

const NOW = Date.UTC(2026, 9, 20, 9, 30);

describe('GET /api/instruments', () => {
  it('paramètres de contrat d’OKX, mis en cache 1 h par le CDN', async () => {
    const t = testContext({ nowMs: NOW });
    const res = await handleInstruments(req('/api/instruments?inst=BTC-USDT-SWAP'), t.ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      inst: 'BTC-USDT-SWAP', ct_val: 0.01, ct_val_ccy: 'BTC', ct_type: 'linear', lot_sz: 0.01,
      min_sz: 0.01, tick_sz: 0.1, settle_ccy: 'USDT', state: 'live',
    });
    expect(res.headers.get('cache-control')).toBe(CACHE_INSTRUMENTS);
    expect(CACHE_INSTRUMENTS).toBe('public, max-age=0, s-maxage=3600');
  });

  it('inst obligatoire et dans la liste blanche', async () => {
    const t = testContext({ nowMs: NOW });
    const missing = await handleInstruments(req('/api/instruments'), t.ctx);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ detail: 'paramètre inst manquant' });
    const other = await handleInstruments(req('/api/instruments?inst=SOL-USDT-SWAP'), t.ctx);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ detail: 'instrument non suivi : SOL-USDT-SWAP' });
    expect(t.calls).toHaveLength(0);
  });

  it('OKX en erreur : 502, jamais de paramètres supposés', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = testContext({ nowMs: NOW, override: () => okxReply([]) });
    const res = await handleInstruments(req('/api/instruments?inst=ETH-USDT-SWAP'), t.ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: 'OKX indisponible : instrument introuvable' });
  });
});

describe('GET /api/okx-time', () => {
  it('heure OKX, heure de la fonction, aller-retour ; jamais en cache', async () => {
    const t = testContext({ nowMs: NOW });
    const res = await handleOkxTime(req('/api/okx-time'), t.ctx);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ okx_ts: NOW, fn_ts: NOW, rtt_ms: 0 });
    expect(t.calls.map((c) => c.url)).toEqual(['https://eea.okx.com/api/v5/public/time']);
  });

  it('aucun paramètre accepté', async () => {
    const t = testContext({ nowMs: NOW });
    const res = await handleOkxTime(req('/api/okx-time?t=1'), t.ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ detail: 'paramètre inconnu : t (cette route n’en prend aucun)' });
  });

  it('heure illisible : 502', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = testContext({ nowMs: NOW, override: () => okxReply([{ ts: 'abc' }]) });
    const res = await handleOkxTime(req('/api/okx-time'), t.ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ detail: 'OKX indisponible : réponse illisible' });
  });
});

describe('GET /api/health', () => {
  it('sur Vercel : hôte et région réelle de la fonction', async () => {
    const t = testContext({ nowMs: NOW, env: { VERCEL: '1', VERCEL_REGION: 'cdg1', SUPABASE_SECRET_KEY: 'sb_secret_zzzzzzzzzzzz' } });
    const res = await handleHealth(req('/api/health'), t.ctx);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ app: 'TERMINAL', mode: 'online', host: 'vercel', region: 'eea', fn_region: 'cdg1', ts: NOW });
    expect(text).not.toContain('sb_secret');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(t.calls).toHaveLength(0);
  });

  it('en développement (middleware de Vite)', async () => {
    const res = await handleHealth(req('/api/health'), testContext({ nowMs: NOW }).ctx);
    expect(await res.json()).toMatchObject({ host: 'vite-dev', fn_region: null });
  });
});

describe('fichiers api/<nom>.ts : export GET au format Web standard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('chacun exporte une fonction GET', () => {
    for (const mod of [chartFn, healthFn, instrumentsFn, okxTimeFn, collectorHealthFn]) {
      expect(typeof mod.GET).toBe('function');
    }
  });

  it('le contexte réel utilise le fetch natif (simulé ici) vers eea.okx.com', async () => {
    const instruments = readJson<{ data: unknown[] }>('collectors/tests/fixtures/rest_instruments.json');
    const fetchMock = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/api/v5/public/time') return okxReply([{ ts: '1792472430123' }]);
      return okxReply(instruments.data);
    });
    vi.stubGlobal('fetch', fetchMock);
    const time = await okxTimeFn.GET(req('/api/okx-time'));
    expect((await time.json()).okx_ts).toBe(1792472430123);
    const inst = await instrumentsFn.GET(req('/api/instruments?inst=BTC-USDT-SWAP'));
    expect((await inst.json()).ct_val).toBe(0.01);
    expect(fetchMock.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'https://eea.okx.com/api/v5/public/time',
      'https://eea.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP',
    ]);
  });

  it('l’environnement est lu à chaque requête (process.env)', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    const off = await collectorHealthFn.GET(req('/api/collector-health'));
    expect(await off.json()).toMatchObject({ configured: false });
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_REGION', 'cdg1');
    expect(await (await healthFn.GET(req('/api/health'))).json()).toMatchObject({ host: 'vercel', fn_region: 'cdg1' });
  });
});
