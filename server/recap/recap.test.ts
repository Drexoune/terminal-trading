// @vitest-environment node
// Service des récaps (P6, S4) : base simulée, Gemini simulé. Faits de la séance tirés des bougies,
// du registre et de Supabase ; lecture contrôlée (réécrite une fois, sinon faits seuls) ; une
// séance déjà récapitulée n'est jamais refaite ; plafond de 6 par jour.
import { describe, expect, it } from 'vitest';
import { MemRest } from '../../supabase/functions/p1-jobs/_memrest';
import { SESSIONS } from '../../web/src/lib/time';
import { sessionWindow, type Recap } from '../../web/src/recap/recap';
import { RecapService } from './main';

const NY = SESSIONS.find((s) => s.id === 'ny')!;
const W = sessionWindow(NY, '2026-11-25');
const KEY = 'AIzaFAKE';

function setup(replies: unknown[], env: Record<string, string> = { GEMINI_API_KEY: KEY }) {
  const rest = new MemRest();
  for (let k = 0; k < 3; k++) {
    const t = W.from + k * 60_000;
    // La base simulée compare des chaînes : même format que la requête (Postgres compare des instants).
    rest.rows('okx_candles_1m').push({ inst: 'BTC-USDT-SWAP', t: new Date(t).toISOString(), o: 60_000 + k * 100, h: 60_150 + k * 100, l: 59_950 + k * 100, c: 60_100 + k * 100 });
  }
  rest.rows('news_items').push({ title: 'Fed holds rates', source: 'Fed', urgent: true, published_ms: W.from + 30 * 60_000, received_ms: W.from + 30 * 60_000 });
  rest.rows('news_items').push({ title: 'Hors séance', source: 'Fed', urgent: true, published_ms: W.to + 60_000, received_ms: W.to + 60_000 });
  const prompts: string[] = [];
  const fetch = async (_u: string, init?: RequestInit) => {
    prompts.push(String(init?.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(replies.shift()) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }), { status: 200 });
  };
  let now = W.to + 6 * 60_000;
  const svc = new RecapService({ rest, env: (k) => env[k], fetch, sseFetch: async () => ({ ok: false, status: 503, body: null }), now: () => now, sleep: async () => {}, microUrl: 'x' });
  svc.ledger.addLiqs([{ venue: 'bybit', ts: W.from + 60_000, side: 'long', px: 60_000, sz: 10, usd: 600_000 }]);
  return { rest, svc, prompts, at: (ms: number) => { now = ms; } };
}

const stored = async (rest: MemRest) => (await rest.select<{ value: Recap }>('p1_state', { select: 'value', key: 'eq.recap:2026-11-25:ny' }))[0]?.value;

describe('récap de séance', () => {
  it('faits de la séance et lecture contrôlée, écrits dans recap:<date>:<séance>', async () => {
    const { rest, svc, prompts } = setup([{ answer: 'Le BTC gagne +0,50 % sur la séance de New York.', sources: ['F3'] }]);
    await svc.tick();
    const r = (await stored(rest))!;
    expect(r).toMatchObject({ session: 'ny', label: 'New York', date: '2026-11-25', text: 'Le BTC gagne +0,50 % sur la séance de New York.', sources: ['F3'], reason: null });
    expect(r.facts.find((f) => f.id === 'F3')!.label).toBe('BTC-USDT perp · variation sur la séance');
    expect(r.facts.find((f) => f.id === 'F3')!.value.replace(/[\u00a0\u202f]/g, ' ')).toBe('+0,50 %');            // 60 000 → 60 300
    expect(r.facts.some((f) => f.value === 'Fed holds rates')).toBe(true);
    expect(r.facts.some((f) => f.value === 'Hors séance')).toBe(false);
    expect(prompts[0]).toContain('Séance New York du 2026-11-25');
    expect(rest.rows('bt_ai_calls')[0]).toMatchObject({ route: 'recap', status: 200 });
    await svc.tick();                                                // déjà faite : aucun nouvel appel
    expect(prompts).toHaveLength(1);
  });

  it('lecture qui invente un chiffre : réécrite une fois, puis faits seuls (lecture automatique)', async () => {
    const { rest, svc } = setup([{ answer: 'Le BTC gagne 200 $.', sources: ['F2'] }, { answer: 'Le BTC gagne 0,4 %.', sources: ['F3'] }]);
    await svc.tick();
    const r = (await stored(rest))!;
    expect(r.text).toBeNull();
    expect(r.reason).toMatch(/lecture écartée \(chiffre non sourcé/);
    expect(r.facts.length).toBeGreaterThan(3);
    expect(rest.rows('bt_ai_calls').map((c) => c.status)).toEqual([422, 422]);
  });

  it('sans clé Gemini ou plafond atteint : faits seuls', async () => {
    const a = setup([], {});
    await a.svc.tick();
    expect((await stored(a.rest))!.reason).toMatch(/clé Gemini absente/);
    const b = setup([]);
    for (let k = 0; k < 6; k++) b.rest.rows('bt_ai_calls').push({ id: k, day: '2026-11-25', cached: false, route: 'recap' });
    await b.svc.tick();
    expect((await stored(b.rest))!.reason).toMatch(/plafond de 6 récaps/);
  });
});
