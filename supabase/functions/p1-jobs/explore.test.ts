// @vitest-environment node
// Étape O0 (plan « Tout en ligne ») : sonde des sources depuis Supabase, sur un réseau simulé.
import { describe, expect, it } from 'vitest';
import { BLS_API, BLS_PAGES, explore, FF_XML, OKX_TIME, scrub, type ProbeFetch, type ProbeInit } from './explore.ts';
import { createHandler } from './handler.ts';

const TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';
const EMAIL = 'terminal@example.org';
const T0 = Date.UTC(2026, 10, 24, 9, 0, 0);
const PAGE = '<html><title>Consumer Price Index - 2026 M10 Results</title><pre>Transmission of material in this release is embargoed until 8:30 a.m. (ET) Tuesday, November 10, 2026</pre></html>';

function world(opts: { blsStatus?: number; tgError?: boolean } = {}) {
  let t = T0;
  const calls: { url: string; init?: ProbeInit; at: number }[] = [];
  const sleeps: number[] = [];
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
  const fetch: ProbeFetch = async (url, init) => {
    calls.push({ url, init, at: t });
    t += 120;
    if (url.startsWith('https://api.telegram.org')) {
      if (opts.tgError) throw new Error(`connexion refusée vers ${url}`);
      return { status: 200, headers: headers({}), text: async () => JSON.stringify({ ok: true, result: { username: 'terminaldrexbot' } }) };
    }
    if (url === OKX_TIME) return { status: 200, headers: headers({}), text: async () => JSON.stringify({ data: [{ ts: String(t - 60 - 15) }] }) };
    if (url === FF_XML) return { status: 200, headers: headers({ etag: '"x"' }), text: async () => '<weeklyevents><event></event><event></event></weeklyevents>' };
    if (url === BLS_API) {
      return { status: 200, headers: headers({}), text: async () => JSON.stringify({ status: 'REQUEST_SUCCEEDED', message: [],
        Results: { series: [{ seriesID: 'WPSFD49104', data: [{ year: '2026', period: 'M10', value: '156.740', latest: 'true' }] }] } }) };
    }
    // Pages du BLS : en-tête Date à la seconde, 300 ms derrière l'horloge de la fonction.
    return { status: opts.blsStatus ?? 200, headers: headers({ date: new Date(Math.floor((t - 60 - 300) / 1000) * 1000).toUTCString(), server: 'AkamaiNetStorage' }),
      text: async () => PAGE };
  };
  const deps = (env: Record<string, string>) => ({
    fetch, now: () => t, perf: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, env: (n: string) => env[n],
  });
  return { calls, sleeps, deps };
}

describe('p1-jobs : sonde O0', () => {
  it('une requête par source, une seconde entre deux requêtes au BLS, User-Agent avec contact', async () => {
    const w = world();
    const r = await explore(w.deps({ BLS_CONTACT_EMAIL: EMAIL, TELEGRAM_BOT_TOKEN: TOKEN, SB_REGION: 'eu-west-3' }));
    const urls = w.calls.map((c) => c.url);
    expect(urls.slice(0, 5)).toEqual(BLS_PAGES.map((p) => p.url));
    expect(urls.slice(5)).toEqual([BLS_API, FF_XML, `https://api.telegram.org/bot${TOKEN}/getMe`, OKX_TIME]);
    expect(w.sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(w.calls[0].init?.headers?.['User-Agent']).toBe(`terminal-trading/0.1 (${EMAIL})`);
    expect(r.region).toBe('eu-west-3');
    const cpi = r.lines.find((l) => l.label === 'bls-cpi-nr0')!;
    expect(cpi.title).toBe('Consumer Price Index - 2026 M10 Results');
    expect(cpi.embargo).toMatch(/^embargoed until 8:30 a\.m\. \(ET\) Tuesday, November 10, 2026/);
    expect(cpi.clock_skew_ms).toBeGreaterThanOrEqual(0);
    expect(cpi.clock_skew_ms).toBeLessThan(1500);
    expect(cpi.cpu_ms).not.toBeNull();
    expect(r.lines.find((l) => l.label === 'bls-api-v1')!.extract).toMatchObject({ status: 'REQUEST_SUCCEEDED',
      latest: [{ series: 'WPSFD49104', period: 'M10', value: '156.740' }] });
    expect(r.lines.find((l) => l.label === 'okx-time')!.extract).toMatchObject({ clock_skew_vs_okx_ms: expect.any(Number) });
    expect(r.verdict).toEqual({ bls_pages: 'ok', bls_api: 'ok', forexfactory: 'ok', telegram: 'ok', okx: 'ok' });
  });

  it('le jeton Telegram et l’adresse de contact ne sortent jamais dans le rapport', async () => {
    const w = world({ tgError: true });
    const r = await explore(w.deps({ BLS_CONTACT_EMAIL: EMAIL, TELEGRAM_BOT_TOKEN: TOKEN }));
    const text = JSON.stringify(r);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(EMAIL);
    expect(r.lines.find((l) => l.label === 'telegram-getme')!.url).toBe('https://api.telegram.org/bot<masqué>/getMe');
    expect(r.verdict.telegram).toMatch(/^injoignable : connexion refusée vers .*<masqué>/);
  });

  it('403 du BLS : no-go dit clairement ; sans adresse de contact, le BLS n’est pas interrogé', async () => {
    const w = world({ blsStatus: 403 });
    const r = await explore(w.deps({ BLS_CONTACT_EMAIL: EMAIL }));
    expect(r.verdict.bls_pages).toBe('refusé (HTTP 403) : no-go pour cette source');
    const w2 = world();
    const r2 = await explore(w2.deps({}));
    expect(w2.calls.some((c) => c.url.includes('bls.gov'))).toBe(false);
    expect(r2.verdict.bls_pages).toMatch(/BLS_CONTACT_EMAIL absent/);
    expect(r2.verdict.telegram).toMatch(/TELEGRAM_BOT_TOKEN absent/);
  });

  it('scrub ignore les valeurs trop courtes ou absentes', () => {
    expect(scrub('a secret-value b', ['secret-value', undefined, 'ab'])).toBe('a <masqué> b');
  });
});

describe('p1-jobs : contrôle de l’appel', () => {
  const SECRET = 'p'.repeat(40);
  const post = (job: string, secret = SECRET) => new Request(`https://ref.supabase.co/functions/v1/p1-jobs?job=${job}`,
    { method: 'POST', headers: { 'x-jobs-secret': secret } });
  const deps = { fetch: (async () => { throw new Error('aucun appel'); }) as ProbeFetch, now: () => T0, perf: () => 0,
    sleep: async () => {}, run: async () => ({ job: 'explore' }) };

  it('405, 500 sans secret configuré, 401, 400, puis 200', async () => {
    const h = createHandler((n) => ({ P1_JOBS_SECRET: SECRET } as Record<string, string>)[n], deps);
    expect((await h(new Request('https://x/functions/v1/p1-jobs?job=explore'))).status).toBe(405);
    expect((await createHandler(() => undefined, deps)(post('explore'))).status).toBe(500);
    expect((await h(post('explore', 'x'.repeat(40)))).status).toBe(401);
    expect((await h(post('inconnue'))).status).toBe(400);
    const ok = await h(post('explore'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, report: { job: 'explore' } });
  });
});
