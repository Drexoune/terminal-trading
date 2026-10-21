/** @vitest-environment node */
// Contrat avec les consommateurs du front : leurs VRAIS modules (source OKX
// directe du worker, sondes de l'écran Paramètres, barre de flux) branchés sur
// les VRAIES routes, OKX et Supabase simulés. Un changement de forme d'un côté
// ou de l'autre casse ce test plutôt que l'écran.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ClockState, ConnState, InstrumentMeta, Item, LatencySample, SourceSink, WebSocketLike,
} from '../../web/src/data/protocol.ts';
import { fetchCollectorHealth } from '../../web/src/data/gateway.ts';
import { createOkxSource } from '../../web/src/data/sources/okxSource.ts';
import { collectorLine, collectorStatus, probe } from '../../web/src/screens/settings/health.ts';
import {
  handleChart, handleCollectorHealth, handleHealth, handleInstruments, handleOkxTime, type Context,
} from '../_lib/routes.ts';
import { testContext } from './fakes.ts';

const BTC = 'BTC-USDT-SWAP'; // seul instrument de la réponse OKX enregistrée
const SB_SECRET = 'sb_secret_test_only_not_a_real_key';

const ROUTES: Record<string, (r: Request, ctx: Context) => Promise<Response>> = {
  '/api/chart': handleChart,
  '/api/instruments': handleInstruments,
  '/api/okx-time': handleOkxTime,
  '/api/health': handleHealth,
  '/api/collector-health': handleCollectorHealth,
};

/** Les fonctions vues du navigateur : même origine, adresses relatives acceptées. */
function sameOrigin(ctx: Context) {
  return async (url: string): Promise<Response> => {
    const u = new URL(url, 'https://terminal.example');
    const route = ROUTES[u.pathname];
    return route ? route(new Request(u), ctx) : Response.json({ detail: 'route inconnue' }, { status: 404 });
  };
}

/** WebSocket qui ne s'ouvre jamais : seul le REST est en jeu ici. */
class SilentSocket implements WebSocketLike {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  constructor(readonly url: string) {}
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

class Sink implements SourceSink {
  items: Item[] = [];
  conns: Partial<ConnState>[] = [];
  item(key: string, value: unknown) { this.items.push([key, value]); }
  conn(patch: Partial<ConnState>) { this.conns.push(patch); }
  latency(_sample: LatencySample) {}
  last<T>(key: string): T | undefined {
    return this.items.filter(([k]) => k === key).map(([, v]) => v as T).at(-1);
  }
}

async function until(check: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('source OKX directe du worker (web/src/data/sources/okxSource.ts)', () => {
  it('lit /api/instruments et /api/okx-time tels que les fonctions les servent', async () => {
    // Heure OKX simulée = heure réelle au départ : l'écart mesuré reste petit.
    const t = testContext({ nowMs: Date.now() });
    const serve = sameOrigin(t.ctx);
    const sink = new Sink();
    const src = createOkxSource(
      { apiBase: '', publicWs: 'wss://pub.test', businessWs: 'wss://biz.test', instruments: [BTC],
        latencyKey: `trade:${BTC}` },
      sink, { WebSocket: SilentSocket, fetch: (url) => serve(url), now: () => Date.now(), random: () => 0.5 });
    src.start();
    try {
      await until(() => !!sink.last(`instrument:${BTC}`) && !!sink.last('clock:okx'));
    } finally {
      src.stop();
    }
    const served = await (await handleInstruments(new Request(`https://x/api/instruments?inst=${BTC}`), t.ctx)).json();
    expect(sink.last<InstrumentMeta>(`instrument:${BTC}`)).toEqual(served);
    expect(sink.last<InstrumentMeta>(`instrument:${BTC}`)?.ct_val).toBe(0.01);
    const clock = sink.last<ClockState>('clock:okx')!;
    expect(clock.ok).toBe(true);
    expect(Math.abs(clock.offset_ms)).toBeLessThan(5_000);
    expect(sink.conns.some((c) => typeof c.offsetMs === 'number' && typeof c.rttMs === 'number')).toBe(true);
  });
});

describe('sondes des Paramètres et barre de flux (gateway.ts, settings/health.ts)', () => {
  const NOW = Date.UTC(2026, 9, 20, 9, 30);
  const LAST = {
    started_at: '2026-10-20T09:29:00.012+00:00', finished_at: '2026-10-20T09:29:01.5+00:00',
    ok: true, error: null, rows: 4,
  };

  /** PostgREST minimal : dernier passage, décomptes (Content-Range), trous. */
  const postgrest = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (init?.method === 'HEAD') {
      return new Response(null, { headers: { 'Content-Range': u.searchParams.get('ok') ? '0-1/2' : '0-1439/1440' } });
    }
    if (u.pathname.endsWith('/collector_runs')) return Response.json([LAST]);
    return Response.json([{ missing: 3 }], { headers: { 'Content-Range': '0-0/1' } });
  };

  it('Mode Online sans Supabase : joignable, collecteur non configuré', async () => {
    const t = testContext({ nowMs: NOW });
    vi.stubGlobal('fetch', sameOrigin(t.ctx));
    const result = await probe('online', '');
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/^Joignable · \d+\u00a0ms · vite-dev · eea$/);
    // La raison exacte donnée par la fonction est affichée telle quelle.
    const why = 'variable(s) absente(s) : SUPABASE_URL, SUPABASE_SECRET_KEY';
    expect(result.detail).toBe(`Collecteur Supabase : collecteur non configuré (${why})`);
    expect(collectorStatus(await fetchCollectorHealth(), null))
      .toEqual({ state: 'down', label: `collecteur non configuré : ${why}` });
  });

  it('Mode Online avec Supabase : dernier passage, comptes sur 24 h', async () => {
    const t = testContext({
      nowMs: NOW, fetch: postgrest,
      env: { VERCEL: '1', SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_SECRET_KEY: SB_SECRET },
    });
    vi.stubGlobal('fetch', sameOrigin(t.ctx));
    const result = await probe('online', '');
    expect(result.text).toMatch(/ · vercel · eea$/);
    expect(result.detail).toBe('Collecteur Supabase : dernier passage il y a 59\u00a0s · '
      + '1\u202f440 passages sur 24\u00a0h, 2 en échec, 3 minutes manquantes');
    const h = await fetchCollectorHealth();
    expect(collectorStatus(h, null)).toMatchObject({ state: 'live' });
    expect(collectorLine(h, null)).toBe(result.detail);
  });

  it('Supabase en échec : le message de la fonction remonte, sans secret', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = testContext({
      nowMs: NOW, env: { SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co', SUPABASE_SECRET_KEY: SB_SECRET },
      fetch: async () => Response.json({ message: `Invalid API key ${SB_SECRET}` }, { status: 401 }),
    });
    vi.stubGlobal('fetch', sameOrigin(t.ctx));
    const result = await probe('online', '');
    expect(result.detail).toBe('Collecteur Supabase : injoignable (HTTP 502 {"detail":"Supabase indisponible : HTTP 401"})');
    expect(result.detail).not.toContain('sb_secret');
  });
});
