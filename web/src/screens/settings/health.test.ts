import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectorHealth } from '../../data/gateway';
import { NBSP as NB } from '../../lib/format';
import {
  collectorLine, collectorStatus, COLLECTOR_STALE_MS, fmtAge, hostOf, modeHintWarning, probe, reachable,
} from './health';

function health(over: Partial<CollectorHealth> = {}): CollectorHealth {
  return {
    configured: true,
    last_run: { started_at: '2026-10-20T10:00:00Z', finished_at: '2026-10-20T10:00:02Z', ok: true, error: null, rows: 3 },
    age_ms: 42_000, runs_24h: 1440, failures_24h: 0, gaps_24h: 0, source: 'Supabase',
    ...over,
  };
}

describe('mise en forme', () => {
  it('âges courts en fr-FR', () => {
    expect(fmtAge(42_400)).toBe(`42${NB}s`);
    expect(fmtAge(185_000)).toBe(`3${NB}min`);
    expect(fmtAge(2.5 * 3_600_000)).toBe(`2,5${NB}h`);
    expect(fmtAge(-5)).toBe(`0${NB}s`);
  });

  it('hôte d’une adresse', () => {
    expect(hostOf('http://127.0.0.1:8790')).toBe('127.0.0.1:8790');
    expect(hostOf('https://tour.tailnet.ts.net')).toBe('tour.tailnet.ts.net');
    expect(hostOf('pas une adresse')).toBe('pas une adresse');
  });

  it('temps de réponse en fr-FR', () => {
    expect(reachable(45.4, '127.0.0.1:8710')).toBe(`Joignable · 45${NB}ms · 127.0.0.1:8710`);
    expect(reachable(1234.6, 'tour.ts.net')).toBe(`Joignable · 1\u202f235${NB}ms · tour.ts.net`);
  });
});

describe('collecteur Supabase dans la barre de flux', () => {
  it('à jour, en échec, périmé au-delà de 3 min', () => {
    expect(collectorStatus(health(), null).state).toBe('live');
    expect(collectorStatus(health(), null).label).toBe(`à jour · dernier passage il y a 42${NB}s`);
    const failed = collectorStatus(health({ last_run: { ...health().last_run!, ok: false, error: 'OKX 503' } }), null);
    expect(failed).toEqual({ state: 'late', label: 'dernier passage en échec : OKX 503' });
    expect(collectorStatus(health({ age_ms: COLLECTOR_STALE_MS + 1 }), null).state).toBe('stale');
  });

  it('l’âge avance entre deux interrogations', () => {
    expect(collectorStatus(health({ age_ms: 170_000 }), null, 20_000).state).toBe('stale');
  });

  it('non configuré, sans passage, injoignable : déconnecté avec la raison', () => {
    expect(collectorStatus(health({ configured: false, last_run: null, age_ms: null }), null))
      .toEqual({ state: 'down', label: 'collecteur non configuré' });
    expect(collectorStatus(health({ last_run: null, age_ms: null }), null).label).toBe('aucun passage enregistré');
    expect(collectorStatus(null, 'HTTP 500')).toEqual({ state: 'down', label: 'injoignable : HTTP 500' });
    expect(collectorStatus(null, null).state).toBe('down');
    // La fonction Vercel donne la raison exacte : elle est affichée telle quelle.
    expect(collectorStatus(health({ configured: false, reason: 'variable(s) absente(s) : SUPABASE_URL' }), null).label)
      .toBe('collecteur non configuré : variable(s) absente(s) : SUPABASE_URL');
  });

  it('ligne du test Online', () => {
    expect(collectorLine(health({ configured: false }), null)).toBe('Collecteur Supabase : collecteur non configuré');
    expect(collectorLine(health(), null))
      .toBe(`Collecteur Supabase : dernier passage il y a 42${NB}s · 1\u202f440 passages sur 24${NB}h, 0 en échec, 0 minutes manquantes`);
    expect(collectorLine(null, 'délai dépassé')).toBe('Collecteur Supabase : injoignable (délai dépassé)');
    expect(collectorLine(health({ configured: false, reason: 'variable(s) absente(s) : SUPABASE_URL',
      runs_24h: null, failures_24h: null, gaps_24h: null }), null))
      .toBe('Collecteur Supabase : collecteur non configuré (variable(s) absente(s) : SUPABASE_URL)');
  });

  it('avertit quand l’adresse sert la passerelle de l’autre mode', () => {
    expect(modeHintWarning('tour', 'local')).toBe('Attention : cette adresse sert la passerelle du Mac (Mode Local).');
    expect(modeHintWarning('local', 'tour')).toBe('Attention : cette adresse sert la passerelle de la tour (Mode Tour).');
    expect(modeHintWarning('tour', 'tour')).toBeUndefined();
    expect(modeHintWarning('local', null)).toBeUndefined();
  });
});

describe('bouton « Tester »', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

  it('passerelle joignable : temps et hôte', async () => {
    const fetchMock = vi.fn(async () => json({ app: 'TERMINAL', ts: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await probe('tour', 'https://tour.tailnet.ts.net');
    expect(fetchMock).toHaveBeenCalledWith('https://tour.tailnet.ts.net/api/health', expect.anything());
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(new RegExp(`^Joignable · \\d+${NB}ms · tour\\.tailnet\\.ts\\.net$`));
    expect(r.detail).toBeUndefined();
  });

  it('nom de la machine et mode annoncé par la passerelle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ app: 'TERMINAL', host: 'MacBook-de-Clement', mode_hint: 'local' })));
    const r = await probe('tour', 'https://tour.tailnet.ts.net');
    expect(r.text).toMatch(/ · tour\.tailnet\.ts\.net · MacBook-de-Clement$/);
    expect(r.detail).toBe('Attention : cette adresse sert la passerelle du Mac (Mode Local).');
  });

  it('erreur HTTP ou réseau : injoignable avec la raison', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    expect((await probe('local', 'http://127.0.0.1:8710')).text).toBe('Injoignable : HTTP 502 nope');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect((await probe('local', 'http://127.0.0.1:8710')).text).toMatch(/^Injoignable : aucune réponse/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200 })));
    expect((await probe('local', 'http://127.0.0.1:8710')).text).toBe('Injoignable : réponse illisible (pas du JSON)');
  });

  it('délai maximal de 5 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const pending = probe('tour', 'https://tour.tailnet.ts.net');
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).text).toBe('Injoignable : délai dépassé');
  });

  it('Mode Online : /api/health puis /api/collector-health, même origine', async () => {
    const fetchMock = vi.fn(async (url: string) => url === '/api/health'
      ? json({ app: 'TERMINAL', mode: 'online', host: 'vercel', region: 'eea', fn_region: 'cdg1', ts: 1 })
      : json(health({ configured: false, last_run: null, age_ms: null })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await probe('online', '');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/health', '/api/collector-health']);
    expect(r.text).toMatch(new RegExp(`^Joignable · \\d+${NB}ms · vercel · eea · cdg1$`));
    expect(r.detail).toBe('Collecteur Supabase : collecteur non configuré');
  });
});
