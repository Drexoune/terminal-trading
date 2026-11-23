// @vitest-environment node
// POST /api/p1/highlights (T-050) : session du mot de passe, même origine, liste validée et dédoublonnée.
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, signSession } from '../_lib/bourse/auth.js';
import type { FetchFn } from '../_lib/okx.js';
import { handleP1, validHighlights } from '../_lib/p1.js';
import { createContext } from '../_lib/routes.js';

const HASH = 'pbkdf2-sha256$100000$AAECAwQFBgcICQoLDA0ODw$W96qzf7j9JBRjdvDcxWyNI1t7VDAmtdCWZ0FVrtrG_E';
const SECRET = 's'.repeat(48);
const NOW = Date.parse('2026-11-23T20:00:00Z');
const ENV = { BOURSE_PASSWORD_HASH: HASH, BOURSE_SESSION_SECRET: SECRET, SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_0123456789abcdefghij' };

function fake() {
  const calls: { url: string; body: unknown }[] = [];
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(null, { status: 201 });
  };
  return { fetch, calls };
}
const ctx = (fetch: FetchFn) => createContext({ fetch, now: () => NOW, monotonic: () => 0, sleep: async () => {} }, ENV);
async function post(body: unknown, session = true, origin = 'https://terminal.example') {
  const headers = new Headers({ host: 'terminal.example', origin, 'content-type': 'application/json' });
  if (session) headers.set('cookie', `${COOKIE_NAME}=${await signSession(Math.floor(NOW / 1000) + 3600, SECRET)}`);
  return new Request('https://terminal.example/api/p1/highlights?path=highlights', { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('mots surlignés du fil d’actus', () => {
  it('validation : blancs réduits, doublons sans casse retirés, caractères refusés', () => {
    expect(validHighlights({ words: [' Nvidia ', 'NVIDIA', 'rate  cut', 'S&P 500', 'Jensen'] })).toEqual(['Nvidia', 'rate cut', 'S&P 500', 'Jensen']);
    expect(() => validHighlights({ words: ['<script>'] })).toThrow(/mot refusé/);
    expect(() => validHighlights({ words: 'Fed' })).toThrow(/liste/);
    expect(() => validHighlights({ words: Array.from({ length: 201 }, (_, i) => `w${i}`) })).toThrow(/200/);
  });

  it('session exigée et même origine ; enregistrement dans p1_state', async () => {
    const f = fake();
    expect((await handleP1(await post({ words: ['Fed'] }, false), ctx(f.fetch))).status).toBe(401);
    expect((await handleP1(await post({ words: ['Fed'] }, true, 'https://evil.example'), ctx(f.fetch))).status).toBe(403);
    expect(f.calls).toHaveLength(0);
    const r = await handleP1(await post({ words: ['Fed', 'Powell'] }), ctx(f.fetch));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ words: ['Fed', 'Powell'], updated_ms: NOW });
    expect(f.calls[0].url).toContain('/rest/v1/p1_state?on_conflict=key');
    expect(f.calls[0].body).toEqual([{ key: 'news:highlight', value: { words: ['Fed', 'Powell'], updated_ms: NOW }, updated_ms: NOW }]);
  });
});
