// @vitest-environment node
// Assistant de P6 (T-074) : Gemini simulé. Réponse contrôlée (sources, nombres), réécriture une
// fois puis refus journalisé, cache, plafond par usage (route = tâche), session exigée, traduction
// à la demande qui ne peut pas inventer de nombre.
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, signSession } from '../_lib/bourse/auth.js';
import { DAILY_CAPS } from '../_lib/assistant-core.js';
import type { FetchFn } from '../_lib/okx.js';
import { handleP1 } from '../_lib/p1.js';
import { createContext } from '../_lib/routes.js';

const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const KEY = 'AIzaFAKEKEYFORTESTS0123456789';
const NOW = Date.parse('2026-11-25T20:30:00Z');
const ENV = { BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET, GEMINI_API_KEY: KEY,
  SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };
const ORIGIN = 'https://terminal.example';
const FACTS = [
  { id: 'F1', label: 'BTC-USDT perp · dernier prix', value: '108 420,5 $', source: 'OKX', at_ms: NOW, href: '/graphiques' },
  { id: 'F2', label: 'IPC États-Unis (m/m)', value: 'réel 0,6 %, consensus 0,3 %', source: 'BLS', at_ms: NOW, href: '/calendrier' },
];

interface World { used: number; cache: Map<string, unknown>; calls: Record<string, unknown>[]; replies: unknown[]; seen: { url: string; init?: RequestInit }[] }
const world = (replies: unknown[], used = 0): World => ({ used, cache: new Map(), calls: [], replies, seen: [] });
const gem = (data: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 80 } });

function ctx(w: World) {
  const fetch: FetchFn = async (url, init) => {
    w.seen.push({ url, init });
    const u = new URL(url);
    if (u.host === 'generativelanguage.googleapis.com') return new Response(JSON.stringify(gem(w.replies.shift())), { status: 200 });
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
  return createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, ENV);
}

async function post(w: World, path: string, body: unknown, session = true) {
  const headers = new Headers({ 'content-type': 'application/json', origin: ORIGIN, host: 'terminal.example' });
  if (session) headers.set('cookie', `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`);
  const r = await handleP1(new Request(`${ORIGIN}/api/p1?path=${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), ctx(w));
  return { status: r.status, body: await r.json() as Record<string, unknown> };
}

describe('assistant (P6)', () => {
  it('réponse sourcée acceptée, journalisée sous la route « ask », puis servie par le cache', async () => {
    const w = world([{ answer: 'Le BTC cote 108 420,5 $.', sources: ['F1'] }]);
    const r = await post(w, 'assistant', { question: 'Où en est le BTC ?', facts: FACTS });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, cached: false, answer: 'Le BTC cote 108 420,5 $.', sources: ['F1'], calls_today: 1, cap: DAILY_CAPS.ask });
    expect(w.calls[0]).toMatchObject({ route: 'ask', status: 200, error: null });
    const head = w.seen.find((s) => s.init?.method === 'HEAD')!;
    expect(decodeURIComponent(head.url)).toContain('route=eq.ask');                 // plafond propre à l'assistant
    const g = w.seen.find((s) => s.url.includes('generativelanguage'))!;
    expect(String(g.init!.body)).toContain('F1 | BTC-USDT perp · dernier prix | 108 420,5 $');
    const again = await post(w, 'assistant', { question: 'Où en est le BTC ?', facts: FACTS });
    expect(again.body).toMatchObject({ ok: true, cached: true });
  });

  it('chiffre inventé : réécriture demandée une fois, la seconde réponse passe', async () => {
    const w = world([{ answer: 'Le BTC cote 108 500 $.', sources: ['F1'] }, { answer: 'Le BTC cote 108 420,5 $.', sources: ['F1'] }]);
    const r = await post(w, 'assistant', { question: 'Prix du BTC ?', facts: FACTS });
    expect(r.body).toMatchObject({ ok: true, answer: 'Le BTC cote 108 420,5 $.', calls_today: 2 });
    expect(w.calls.map((c) => [c.status, c.error])).toEqual([[422, 'écartée : chiffre non sourcé (108 500)'], [200, null]]);
    const second = w.seen.filter((s) => s.url.includes('generativelanguage'))[1];
    expect(String(second.init!.body)).toContain('Ta réponse précédente a été écartée');
  });

  it('deux réponses non sourcées : refus affiché, rien en cache', async () => {
    const w = world([{ answer: 'L’IPC dépasse le consensus de 0,3 point, soit 100 %.', sources: ['F2'] }, { answer: 'Soit 2 fois le consensus.', sources: ['F2'] }]);
    const r = await post(w, 'assistant', { question: 'IPC ?', facts: FACTS });
    expect(r.body).toMatchObject({ ok: false });
    expect(String(r.body.reason)).toMatch(/^réponse écartée : chiffre non sourcé/);
    expect(w.cache.size).toBe(0);
  });

  it('plafond de l’assistant atteint : 429 ; sans session : refus', async () => {
    expect((await post(world([], DAILY_CAPS.ask), 'assistant', { question: 'x', facts: FACTS })).status).toBe(429);
    expect((await post(world([]), 'assistant', { question: 'x', facts: FACTS }, false)).status).toBe(401);
    expect((await post(world([]), 'assistant', { question: '', facts: FACTS })).status).toBe(400);
  });

  it('traduction à la demande : nombres du texte d’origine seulement', async () => {
    const ok = await post(world([{ title: 'La Fed laisse ses taux à 4,25 %', body: '' }]), 'translate', { title: 'Fed holds rates at 4.25%', summary: '' });
    expect(ok.body).toMatchObject({ ok: true, title: 'La Fed laisse ses taux à 4,25 %' });
    const bad = await post(world([{ title: 'La Fed laisse ses taux à 4,5 %', body: '' }, { title: 'La Fed laisse ses taux à 4,5 %', body: '' }]), 'translate', { title: 'Fed holds rates at 4.25%' });
    expect(bad.body).toMatchObject({ ok: false });
  });
});
