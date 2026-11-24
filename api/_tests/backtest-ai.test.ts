// @vitest-environment node
// Assistant IA du backtest (S3, T-063) : Gemini simulé. Session et même origine exigées, plafond
// d'appels par jour, cache, quota gratuit épuisé, clé jamais recopiée, lecture rejetée quand elle
// cite un chiffre absent de nos mesures.
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, signSession } from '../_lib/bourse/auth.js';
import { DAILY_CALLS, inventedNumbers, MODEL, numbersIn, parisDay } from '../_lib/backtest-ai.js';
import { handleBacktest } from '../_lib/backtest.js';
import type { FetchFn } from '../_lib/okx.js';
import { createContext } from '../_lib/routes.js';

const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const KEY = 'AIzaFAKEKEYFORTESTS0123456789';
const NOW = Date.parse('2026-11-24T22:30:00Z');   // 23:30 à Paris
const ENV = { BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET, GEMINI_API_KEY: KEY,
  SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };
const ORIGIN = 'https://terminal.example';
const PINE = '//@version=6\nstrategy("Test", overlay=true)\nif ta.crossover(close, ta.sma(close, 20))\n    strategy.entry("L", strategy.long)\n';

interface World { used: number; cache: Map<string, unknown>; calls: Record<string, unknown>[]; gemini: { status: number; body: unknown }; seen: { url: string; init?: RequestInit }[] }

function world(over: Partial<World> = {}): World {
  return { used: 0, cache: new Map(), calls: [], seen: [], gemini: { status: 200, body: geminiOk({ title: 'Test', code: PINE, summary: 'Achat au croisement.', assumptions: [] }) }, ...over };
}
function geminiOk(data: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 400, thoughtsTokenCount: 100 } };
}

function ctx(w: World, env: Record<string, string> = ENV) {
  const fetch: FetchFn = async (url, init) => {
    w.seen.push({ url, init });
    const u = new URL(url);
    if (u.host === 'generativelanguage.googleapis.com') return new Response(JSON.stringify(w.gemini.body), { status: w.gemini.status });
    const table = u.pathname.split('/').pop()!;
    if (table === 'bt_ai_cache' && init?.method === 'GET') {
      const h = (u.searchParams.get('hash') ?? '').slice(3);
      return new Response(JSON.stringify(w.cache.has(h) ? [{ response: w.cache.get(h) }] : []), { status: 200 });
    }
    if (table === 'bt_ai_cache' && init?.method === 'POST') {
      for (const r of JSON.parse(String(init.body)) as { hash: string; response: unknown }[]) w.cache.set(r.hash, r.response);
      return new Response(null, { status: 201 });
    }
    if (table === 'bt_ai_calls' && init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': `0-0/${w.used}` } });
    if (table === 'bt_ai_calls' && init?.method === 'POST') { w.calls.push(...(JSON.parse(String(init.body)) as Record<string, unknown>[])); return new Response(null, { status: 201 }); }
    return new Response('[]', { status: 200 });
  };
  return createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, env);
}

async function post(c: ReturnType<typeof ctx>, task: string, body: unknown, opts: { session?: boolean; origin?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/json', origin: opts.origin ?? ORIGIN, host: 'terminal.example' });
  if (opts.session !== false) headers.set('cookie', `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`);
  return handleBacktest(new Request(`${ORIGIN}/api/backtest/ai-${task}`, { method: 'POST', headers, body: JSON.stringify(body) }), c);
}

describe('assistant IA', () => {
  it('génération : session, appel à Gemini avec la clé en en-tête, appel journalisé, réponse mise en cache', async () => {
    const w = world();
    const r = await post(ctx(w), 'generate', { prompt: 'achat au croisement de la moyenne 20', context: { asset: 'BTC', tf: '1D' } });
    expect(r.status).toBe(200);
    const b = await r.json() as Record<string, unknown>;
    expect(b).toMatchObject({ ok: true, model: MODEL, cached: false, title: 'Test', code: PINE, calls_today: 1, daily_calls: DAILY_CALLS });
    const g = w.seen.find((s) => s.url.includes('generativelanguage'))!;
    expect(g.url).toContain(`/models/${MODEL}:generateContent`);
    expect(g.url).not.toContain(KEY);
    expect((g.init!.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(JSON.parse(String(g.init!.body)).generationConfig.responseMimeType).toBe('application/json');
    expect(w.calls[0]).toMatchObject({ day: '2026-11-24', route: 'generate', model: MODEL, status: 200, input_tokens: 900, output_tokens: 500 });
    // Même demande : servie par le cache, sans appel à Gemini.
    const n = w.seen.filter((s) => s.url.includes('generativelanguage')).length;
    const again = await (await post(ctx(w), 'generate', { prompt: 'achat au croisement de la moyenne 20', context: { asset: 'BTC', tf: '1D' } })).json();
    expect(again).toMatchObject({ ok: true, cached: true, code: PINE });
    expect(w.seen.filter((s) => s.url.includes('generativelanguage')).length).toBe(n);
  });
  it('sans session : 401 ; autre origine : 403 ; tâche inconnue : 404 ; clé absente : 503', async () => {
    const w = world();
    expect((await post(ctx(w), 'generate', { prompt: 'x' }, { session: false })).status).toBe(401);
    expect((await post(ctx(w), 'generate', { prompt: 'x' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(ctx(w), 'translate', { prompt: 'x' })).status).toBe(404);
    const { GEMINI_API_KEY: _k, ...noKey } = ENV;
    expect((await post(ctx(w, noKey), 'generate', { prompt: 'x' })).status).toBe(503);
    expect(w.seen.some((s) => s.url.includes('generativelanguage'))).toBe(false);
  });
  it('plafond du terminal atteint : 429 sans appeler Gemini', async () => {
    const w = world({ used: DAILY_CALLS });
    const r = await post(ctx(w), 'generate', { prompt: 'x' });
    expect(r.status).toBe(429);
    expect(await r.text()).toMatch(/plafond du terminal/);
    expect(w.seen.some((s) => s.url.includes('generativelanguage'))).toBe(false);
  });
  it('quota gratuit de Google épuisé : 429 « quota gratuit », jamais de bascule, clé jamais recopiée', async () => {
    const w = world({ gemini: { status: 429, body: { error: { code: 429, message: `Quota exceeded for key ${KEY}`, status: 'RESOURCE_EXHAUSTED' } } } });
    const r = await post(ctx(w), 'generate', { prompt: 'x' });
    expect(r.status).toBe(429);
    expect(await r.text()).toMatch(/quota gratuit de Google atteint/);
    expect(JSON.stringify(w.calls)).not.toContain(KEY);
    expect(w.seen.filter((s) => s.url.includes('generativelanguage')).every((s) => s.url.includes(MODEL))).toBe(true);
  });
  it('réparation : code et erreur exigés ; réponse sans strategy() refusée', async () => {
    const w = world({ gemini: { status: 200, body: geminiOk({ code: 'plot(close)', change: 'x' }) } });
    expect((await post(ctx(w), 'repair', { code: PINE })).status).toBe(400);
    expect(await (await post(ctx(w), 'repair', { code: PINE, error: 'Unexpected token at 4:1', line: 4 })).json())
      .toMatchObject({ ok: false, reason: 'réponse sans script strategy()' });
    expect(w.cache.size).toBe(0);   // réponse refusée : jamais en cache
  });
  it('lecture : acceptée quand elle ne cite que nos chiffres, rejetée sinon', async () => {
    const facts = { winrate_pct: '62,5 %', total_pnl: '+4 168 USDT', sharpe: '0,90', dsr_pct: '91,1 %', trials: 1, t_stat: '1,03' };
    const good = world({ gemini: { status: 200, body: geminiOk({ text: 'Taux de réussite de 62,5 %, Sharpe de 0,90 et t-stat de 1,03 : avec 1 essai, le Sharpe déflaté de 91,1 % reste fragile.' }) } });
    expect(await (await post(ctx(good), 'explain', { facts, context: { asset: 'BTC', tf: '1D' } })).json()).toMatchObject({ ok: true });
    const bad = world({ gemini: { status: 200, body: geminiOk({ text: 'Le Sharpe de 0,90 promet 25 % par an.' }) } });
    expect(await (await post(ctx(bad), 'explain', { facts })).json()).toMatchObject({ ok: false, reason: expect.stringMatching(/chiffre absent de nos mesures \(25\)/) });
  });
  it('état : clé présente, appels du jour, plafond ; jour de Paris', async () => {
    const w = world({ used: 3 });
    const b = await (await handleBacktest(new Request(`${ORIGIN}/api/backtest/ai`), ctx(w))).json();
    expect(b).toMatchObject({ configured: true, model: MODEL, calls_today: 3, daily_calls: DAILY_CALLS, day: '2026-11-24' });
    expect(parisDay(Date.parse('2026-11-24T23:30:00Z'))).toBe('2026-11-25');
  });
});

describe('contrôle des chiffres', () => {
  it('nombres français et anglais, espaces fines, valeur absolue', () => {
    expect(numbersIn('−1 234,5 € et 62,5 % puis 0.9')).toEqual([1234.5, 62.5, 0.9]);
  });
  it('tolérance d’arrondi seulement', () => {
    expect(inventedNumbers('Sharpe 0,9 et 62,5 %', { a: 0.9, b: '62,5 %' })).toEqual([]);
    expect(inventedNumbers('Sharpe 1,2', { a: 0.9 })).toEqual([1.2]);
  });
});
