// @vitest-environment node
// Tâches rates, rates-history et policy (R1) de bout en bout : base simulée, réseau rejoué depuis
// les réponses réelles du 23/11/2026 (fixtures/).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemRest } from '../p1-jobs/_memrest.ts';
import { runPolicy, runRates, runRatesHistory, type HttpFetch } from './rates.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SEARCH = JSON.parse(fx('gamma-search-2026-11-23.json')) as Record<string, unknown>;
const NOW = Date.UTC(2026, 10, 23, 21, 16, 30);   // lundi 23/11/2026, 22:16 à Paris (hors quart d'heure)

const Q_BANK: Record<string, string> = {
  'fed decision': 'FED', 'ecb interest rates': 'BCE', 'bank of england decision': 'BOE', 'bank of japan decision': 'BOJ',
  'swiss national bank decision': 'BNS', 'bank of canada decision': 'BOC', 'reserve bank of australia decision': 'RBA',
  'reserve bank of new zealand decision': 'RBNZ',
};

function fakeFetch(over: Record<string, (url: string) => { status: number; body: string }> = {}) {
  const calls: string[] = [];
  const f: HttpFetch = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
    const u = new URL(url);
    for (const [k, h] of Object.entries(over)) if (url.includes(k)) { const r = h(url); return { status: r.status, text: async () => r.body }; }
    let body = '';
    if (u.pathname === '/public-search') body = JSON.stringify(SEARCH[Q_BANK[u.searchParams.get('q') ?? '']]);
    else if (u.pathname === '/books') body = fx('clob-books-FED-26DEC-2026-11-23.json');
    else if (u.pathname === '/last-trades-prices') body = fx('clob-last-trades-FED-26DEC-2026-11-23.json');
    else if (u.pathname === '/prices-history') body = fx('clob-history-daily-FED-26DEC-H0-2026-11-23.json');
    else if (u.pathname.endsWith('/events')) {
      const s = u.searchParams.get('series_ticker');
      const file: Record<string, string> = { KXFEDDECISION: 'kalshi-KXFEDDECISION-open-2026-11-23.json', KXFED: 'kalshi-KXFED-open-2026-11-23.json',
        KXCBDECISIONJAPAN: 'kalshi-KXCBDECISIONJAPAN-open-2026-11-23.json', KXCBDSWISS: 'kalshi-KXCBDSWISS-open-2026-11-23.json' };
      body = file[s ?? ''] ? fx(file[s!]) : '{"events":[],"cursor":""}';
    } else if (u.pathname.endsWith('/candlesticks')) body = fx('kalshi-candles-KXFEDDECISION-26DEC-H0-2026-11-23.json');
    else if (u.hostname === 'stats.bis.org') body = fx('bis-cbpol-2026-11-23.csv');
    else return { status: 404, text: async () => 'not found' };
    return { status: 200, text: async () => body };
  };
  return { f, calls };
}

type BankState = { policy: Record<string, unknown>; meetings: { date: string; days: number; sources: Record<string, Record<string, unknown>>;
  gap: { pts: number } | null }[]; path: { source?: string; points?: { meeting: string; rate: number; delta_bp: number }[]; missing?: string } };

describe('tâche policy', () => {
  it('taux du BIS des 8 banques, borne haute et fourchette de la Fed', async () => {
    const rest = new MemRest();
    const { f, calls } = fakeFetch();
    const r = await runPolicy({ fetch: f, now: () => NOW, rest });
    expect(r).toMatchObject({ ok: true, banks: 8 });
    expect(calls[0]).toBe('GET https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.US+XM+GB+JP+CH+CA+AU+NZ');
    const st = rest.rows('p2_state').find((x) => x.key === 'policy:all')!.value as Record<string, { rate: number; date: string }>;
    expect(st.FED).toMatchObject({ rate: 3.875, date: '2026-11-17' });
    expect(rest.rows('policy_rates').length).toBeGreaterThan(200);
  });
});

describe('tâche rates', () => {
  it('découverte, cotations Polymarket et Kalshi, écart, trajectoire KXFED, une ligne par minute', async () => {
    const rest = new MemRest();
    const { f, calls } = fakeFetch();
    await runPolicy({ fetch: f, now: () => NOW, rest });
    const r = await runRates({ fetch: f, now: () => NOW, rest });
    expect(r.discovery).toBe(24);   // 8 banques × 3 réunions
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST https://clob.polymarket.com/books', 'POST https://clob.polymarket.com/books',   // 120 jetons : lots de 100
      'POST https://clob.polymarket.com/last-trades-prices']);
    const state = rest.rows('p2_state').find((x) => x.key === 'rates:state')!.value as { banks: Record<string, BankState> };
    const fed = state.banks.FED;
    expect(fed.policy).toMatchObject({ display: 4, range: [3.75, 4] });
    const dec = fed.meetings[0];
    expect(dec).toMatchObject({ date: '2026-12-09', days: 16 });
    expect(dec.sources.polymarket).toMatchObject({ total: 1.006, sum_ok: true, ts_source: 1795468699095 })   // 0,15 + 0,25 + 3,25 + 93,5 + 3,45 %;
    expect(dec.sources.kalshi).toMatchObject({ ref: 'KXFEDDECISION-26DEC', ts_source: null });
    expect(dec.sources.futures.missing).toMatch(/aucun flux gratuit/);
    expect(dec.gap).toMatchObject({ pts: 0.4, outcome: 'm50' });   // 0,5 % (Kalshi) contre 0,15 % (Polymarket)
    expect(fed.path.source).toBe('kalshi');
    expect(fed.path.points!.length).toBe(9);   // 10 réunions KXFED, le 08/12/2027 hors calendrier officiel
    expect(fed.path.points![0].delta_bp).toBeGreaterThan(20);
    // BCE : pas de Kalshi ; carnets absents du rejeu -> raison, jamais un chiffre.
    expect(state.banks.BCE.meetings[0].sources.kalshi.missing).toMatch(/séries expirées/);
    expect(state.banks.BCE.meetings[0].sources.polymarket.missing).toBe('aucun prix dans les carnets');
    expect(state.banks.BCE.path.missing).toBe('aucune réunion cotée');
    // Instantané : prochaine réunion seulement hors des quarts d'heure.
    expect(rest.rows('rate_quotes').map((x) => `${x.source}:${x.bank}:${x.meeting}`).sort())
      .toEqual(['kalshi:BNS:2026-12-10', 'kalshi:BOJ:2026-12-18', 'kalshi:FED:2026-12-09', 'polymarket:FED:2026-12-09']);
    expect(rest.rows('rate_quotes')[0].ts).toBe('2026-11-23T21:16:00.000Z');
    // Même minute relancée : pas de doublon ; pas de nouvelle découverte avant 15 min.
    await runRates({ fetch: f, now: () => NOW + 20_000, rest });
    expect(rest.rows('rate_quotes')).toHaveLength(4);
    expect(calls.filter((c) => c.includes('public-search'))).toHaveLength(8);
    const feeds = rest.rows('p2_state').filter((x) => String(x.key).startsWith('feed:')).map((x) => x.key).sort();
    expect(feeds).toEqual(['feed:bis', 'feed:kalshi', 'feed:polymarket']);
  });

  it('source en panne : flux « reconnecting », raison à l’écran, l’autre source continue', async () => {
    const rest = new MemRest();
    const { f } = fakeFetch({ 'clob.polymarket.com/books': () => ({ status: 503, body: '' }) });
    const r = await runRates({ fetch: f, now: () => NOW, rest });
    expect(r.ok).toBe(false);
    const state = rest.rows('p2_state').find((x) => x.key === 'rates:state')!.value as { banks: Record<string, BankState> };
    expect(state.banks.FED.meetings[0].sources.polymarket.missing).toMatch(/Polymarket indisponible \(CLOB : HTTP 503\)/);
    expect(state.banks.FED.meetings[0].sources.kalshi.probs).toBeTruthy();
    expect(state.banks.FED.path.missing).toBe('taux actuel absent (BIS)');
    expect((rest.rows('p2_state').find((x) => x.key === 'feed:polymarket')!.value as { status: string }).status).toBe('reconnecting');
  });
});

describe('tâche rates-history', () => {
  it('premier passage : historique complet ; ensuite depuis le dernier point', async () => {
    const rest = new MemRest();
    const { f, calls } = fakeFetch();
    await runRates({ fetch: f, now: () => NOW, rest });
    const r = await runRatesHistory({ fetch: f, now: () => NOW, rest });
    expect(r.ok).toBe(true);
    expect((r.done as Record<string, number>)['polymarket:FED']).toBeGreaterThan(0);
    expect((r.done as Record<string, number>)['kalshi:FED']).toBe(5 * 48);
    expect(calls.filter((c) => c.includes('prices-history')).length).toBe(8 * 5 * 2);
    const rows = rest.rows('rate_history');
    expect(rows.every((x) => Date.parse(String(x.t)) >= NOW - 60 * 86_400_000)).toBe(true);
  });
});

describe('alerte d’écart entre sources (R5)', () => {
  it('déclenchée au-delà du seuil, une seule fois, réarmée quand l’écart repasse dessous', async () => {
    const rest = new MemRest();
    rest.rows('alert_rules').push({ id: 7, kind: 'rate_gap', params: { bank: 'FED', threshold_pts: '0.3' }, channels: ['écran'], state: 'armée',
      created_ms: NOW - 1000, updated_ms: NOW - 1000, last_fired_ms: null });
    const { f } = fakeFetch();
    const alerts = { fetch: async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) }), sleep: async () => {}, now: () => NOW,
      env: () => undefined, rest };
    const r = await runRates({ fetch: f, now: () => NOW, rest, alerts });
    expect(r.gap_alerts).toBe(1);   // Fed : 0,4 pt (−50 pb et plus) > 0,3
    const ev = rest.rows('alert_events');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ title: 'Écart Polymarket / Kalshi : 0,4 pts · Fed 09/12/2026',
      body: '−50 pb et plus : Polymarket 0,2 % · Kalshi 0,5 % · seuil 0,3 pts' });
    expect(rest.rows('alert_rules')[0].state).toBe('déclenchée');
    // Minute suivante, même écart : rien de plus.
    expect((await runRates({ fetch: f, now: () => NOW + 60_000, rest, alerts: { ...alerts, now: () => NOW + 60_000 } })).gap_alerts).toBe(0);
    // Seuil relevé à la main au-dessus de l'écart : la règle se réarme.
    rest.rows('alert_rules')[0].params = { bank: 'FED', threshold_pts: '5' };
    await runRates({ fetch: f, now: () => NOW + 120_000, rest, alerts: { ...alerts, now: () => NOW + 120_000 } });
    expect(rest.rows('alert_rules')[0].state).toBe('armée');
    expect(rest.rows('alert_events')).toHaveLength(1);
  });
});
