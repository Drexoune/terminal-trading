// @vitest-environment node
// Capture en ligne (O3) sur une horloge fictive, une base simulée et les pages réelles du BLS :
// même scénario que la passerelle (gateway/tests/test_release_service.py), la répétition du
// 08/12/2026 (communiqué révisé de la productivité, même période que le préliminaire).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_V1 } from './bls_api.ts';
import { burstPlan, checkRevisions, runCapture, type CapFetch, type CaptureDeps } from './capture.ts';
import { MemRest } from './_memrest.ts';

const FIX = fileURLToPath(new URL('../../../gateway/tests/fixtures/bls/', import.meta.url));
const PAGES = JSON.parse(gunzipSync(readFileSync(`${FIX}releases_2026-11-20.json.gz`)).toString('utf8')) as Record<string, string>;
const API_REAL = gunzipSync(readFileSync(`${FIX}api_v1_2026-11-23.json.gz`)).toString('utf8');
const T = Date.UTC(2026, 11, 8, 13, 30);           // 08:30 New York
const PROD = 'https://www.bls.gov/news.release/prod2.nr0.htm';
const FULL = 'https://www.bls.gov/news.release/prod2.htm';
const ARCHIVE = 'https://www.bls.gov/news.release/archives/prod2_12082026.htm';
const BEFORE = PAGES['prod2_nr0_2026-11-20'];
const AFTER = BEFORE.replace('Thursday, November 5, 2026', 'Tuesday, December 8, 2026')
  .replaceAll('Third Quarter 2026, Preliminary', 'Third Quarter 2026, Revised')
  .replace('labor productivity increased 3.6 percent', 'labor productivity increased 4.1 percent');
const NEWER = AFTER.replace('Tuesday, December 8, 2026', 'Thursday, February 4, 2027').replaceAll('Third Quarter 2026, Revised', 'Fourth Quarter 2026, Preliminary');
const enc = (s: string) => new TextEncoder().encode(s);

interface WorldOpts { publishAfterMs?: number; status?: Record<number, number>; nullUntil?: number; pages?: Record<string, string>; okxOffset?: number }

function world(start: number, o: WorldOpts = {}) {
  const w = { t: start, requests: [] as [number, string][], api: 0 };
  const publishAt = T + (o.publishAfterMs ?? 1_800);
  const fetch: CapFetch = async (url, init) => {
    const send = w.t;
    w.requests.push([send, url]);
    w.t += 120;
    const reply = (status: number, body: string, headers: Record<string, string> = {}) =>
      ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, arrayBuffer: async () => enc(body).buffer as ArrayBuffer });
    if (url.includes('okx.com')) return reply(200, JSON.stringify({ data: [{ ts: String(send + 60 + (o.okxOffset ?? -12)) }] }));
    if (url === API_V1) { w.api++; expect(init?.method).toBe('POST'); return reply(200, API_REAL); }
    const n = w.requests.filter(([, u]) => u.includes('www.bls.gov')).length;
    if (o.status?.[n]) return reply(o.status[n], 'denied');
    if (o.pages?.[url] !== undefined) return reply(200, o.pages[url]);
    if (o.nullUntil && send < o.nullUntil && url === PROD) return reply(200, '\0'.repeat(500));
    return reply(200, send >= publishAt ? AFTER : BEFORE, { date: 'Tue, 08 Dec 2026 13:30:02 GMT' });
  };
  const deps = (rest: MemRest, env: Record<string, string> = { BLS_CONTACT_EMAIL: 'terminal@example.org' }): CaptureDeps => ({
    fetch, now: () => w.t, sleep: async (ms) => { w.t += Math.round(ms); }, env: (n) => env[n], rest,
  });
  return { w, deps };
}

function base(): MemRest {
  const rest = new MemRest();
  const seen = T - 86_400_000;
  rest.rows('official_releases').push(
    { id: 1, source: 'BLS', title: 'Productivity and Costs', local_date: '2026-12-08', local_time: '08:30', tz: 'America/New_York', utc_ms: T, first_seen_ms: seen, last_seen_ms: seen },
    { id: 2, source: 'BLS', title: 'Real Earnings', local_date: '2026-12-08', local_time: '08:30', tz: 'America/New_York', utc_ms: T, first_seen_ms: seen, last_seen_ms: seen },
  );
  rest.rows('calendar_snapshots').push({ id: 1, source: 'ForexFactory', status: 200, received_ms: T - 45 * 60_000 });
  rest.rows('calendar_events').push({ id: 1, identity: '133-us-revised-nonfarm-productivity-qq|USD|2026-12-08|1', indicator_id: 'us-prod-qq',
    forecast: '4.0', forecast_raw: '4.0%', first_seen_ms: T - 3 * 86_400_000, status: 'prévu' });
  return rest;
}

describe('capture en ligne : rafale', () => {
  it('plan : T-60 s, puis une requête par seconde de T-3 s à T+60 s', () => {
    const plan = burstPlan(T);
    expect(plan[0]).toEqual([T - 60_000, 'T-60s']);
    expect(plan).toHaveLength(65);
    expect(plan.at(-1)).toEqual([T + 60_050, 'rafale']);
  });

  it('répétition du 08/12 : révisé capté à T+1,8 s, chiffres, délais, état publié ; un seul appel fait la rafale', async () => {
    const rest = base();
    const { w, deps } = world(T - 60_000);
    const r = await runCapture(deps(rest));
    expect(r).toMatchObject({ ok: true, step: 'rafale', phase: 'capté', keys: ['release:us-prod-qq:2026-Q3:Revised', 'release:us-ulc-qq:2026-Q3:Revised'] });
    const bls = w.requests.filter(([, u]) => u.includes('www.bls.gov'));
    expect(bls.map(([, u]) => u)).toEqual(Array(7).fill(PROD));       // T-60 s, puis T-3 s … T+2 s
    const prod = rest.rows('releases').find((x) => x.indicator_id === 'us-prod-qq')!;
    expect(prod).toMatchObject({ value: '4.1', period: '2026-Q3', edition: 'Revised', timing: 'attendue', machine: 'supabase',
      forecast: '4.0', surprise: '0.1', z: null, z_reason: 'historique insuffisant (0/8)', nature: 'officielle', forecast_seen_ms: T - 45 * 60_000 });
    expect(rest.rows('releases').find((x) => x.indicator_id === 'us-ulc-qq')!.value).toBe('-0.7');
    const timing = rest.rows('release_timings')[0];
    expect(timing).toMatchObject({ okx_offset_ms: -12, date_header: 'Tue, 08 Dec 2026 13:30:02 GMT' });
    expect(timing.first_send_ms).toBe(T + 2050);
    const p = rest.state('release:us-prod-qq:2026-Q3:Revised') as Record<string, unknown>;
    expect(p).toMatchObject({ value: '4.1', label_fr: 'Productivité non agricole (t/t)', unit: '%', machine: 'supabase', forecast_age_ms: 45 * 60_000 });
    expect(p.capture_delay_ms).toBe(2050 + 120 - 12);
    expect(rest.state('release:last')).toMatchObject({ release: 'prod2', keys: ['release:us-prod-qq:2026-Q3:Revised', 'release:us-ulc-qq:2026-Q3:Revised'], nature: 'officielle' });
    expect(rest.state('release:state')).toMatchObject({ phase: 'capté', machine: 'supabase' });
    expect(rest.rows('release_polls')[0]).toMatchObject({ label: 'T-60s', verdict: 'référence' });
    // Un second appel dans la même fenêtre : le verrou l'arrête, la première publication reste.
    rest.rows('releases').length = 0;
    w.t = T - 59_000;
    expect(await runCapture(deps(rest))).toMatchObject({ skipped: 'rafale déjà lancée par un autre appel' });
  });

  it('403 : arrêt immédiat, aucun contournement', async () => {
    const rest = base();
    const { w, deps } = world(T - 60_000, { status: { 3: 403 } });
    expect(await runCapture(deps(rest))).toMatchObject({ phase: 'bloqué' });
    expect(w.requests.filter(([, u]) => u.includes('www.bls.gov'))).toHaveLength(3);
    expect(rest.state('release:state')).toMatchObject({ phase: 'bloqué', reason: expect.stringContaining('HTTP 403') });
  });

  it('octets nuls : la page complète prend le relais', async () => {
    const rest = base();
    const { w, deps } = world(T - 60_000, { nullUntil: T + 5_000 });
    await runCapture(deps(rest));
    const urls = w.requests.filter(([, u]) => u.includes('www.bls.gov')).map(([, u]) => u);
    expect(urls.slice(0, 2)).toEqual([PROD, FULL]);
    expect(rest.rows('releases').find((x) => x.indicator_id === 'us-prod-qq')!.value).toBe('4.1');
  });

  it('publication après T+60 s : rien dans la rafale, captée par la suite toutes les 10 s', async () => {
    const rest = base();
    const { w, deps } = world(T - 60_000, { publishAfterMs: 75_000 });
    expect(await runCapture(deps(rest))).toMatchObject({ phase: 'non capté' });
    w.t = T + 61_000;
    const r = await runCapture(deps(rest));
    expect(r.steps).toEqual([expect.objectContaining({ step: 'suite', phase: 'capté' })]);
    expect(rest.rows('releases').find((x) => x.indicator_id === 'us-prod-qq')!.value).toBe('4.1');
  });
});

describe('capture en ligne : suites', () => {
  it('rattrapage à T+40 min : communiqué relu, aucun délai mesuré', async () => {
    const rest = base();
    const { w, deps } = world(T + 40 * 60_000);
    const r = await runCapture(deps(rest));
    expect(r.steps).toContainEqual(expect.objectContaining({ step: 'rattrapage', phase: 'rattrapé' }));
    expect(w.requests.filter(([, u]) => u.includes('www.bls.gov')).map(([, u]) => u)).toEqual([PROD]);
    expect(rest.rows('releases').find((x) => x.indicator_id === 'us-prod-qq')).toMatchObject({ value: '4.1', nature: 'rattrapage' });
    expect(rest.rows('release_timings')).toHaveLength(0);
    expect((rest.state('release:us-prod-qq:2026-Q3:Revised') as { capture_delay_ms: number | null }).capture_delay_ms).toBeNull();
    // Rien à refaire au passage suivant (déjà capté).
    const again = await runCapture(deps(rest));
    expect(again.steps).not.toContainEqual(expect.objectContaining({ step: 'rattrapage' }));
  });

  it('rattrapage : publication plus récente en ligne -> copie archivée à la date', async () => {
    const rest = base();
    const { w, deps } = world(T + 40 * 60_000, { pages: { [PROD]: NEWER, [ARCHIVE]: AFTER } });
    await runCapture(deps(rest));
    expect(w.requests.filter(([, u]) => u.includes('www.bls.gov')).map(([, u]) => u)).toEqual([PROD, ARCHIVE]);
    expect(rest.rows('releases').find((x) => x.indicator_id === 'us-prod-qq')).toMatchObject({ value: '4.1', url: ARCHIVE });
  });

  it('réaction du BTC à T+31 min, depuis les bougies du collecteur', async () => {
    const rest = base();
    for (let i = 0; i < 41; i++) {
      const t = T - 10 * 60_000 + i * 60_000;
      rest.rows('okx_candles_1m').push({ inst: 'BTC-USDT-SWAP', t: new Date(t).toISOString(), o: 90_000 - 10 * i, h: 90_005 - 10 * i, l: 89_995 - 10 * i, c: 90_000 - 10 * i });
    }
    rest.rows('releases').push({ id: 1, release: 'prod2', ny_date: '2026-12-08', indicator_id: 'us-prod-qq', period: '2026-Q3', edition: 'Revised', value: '4.1', regular: 1, scheduled_ms: T });
    const { deps } = world(T + 31 * 60_000);
    const r = await runCapture(deps(rest));
    expect(r.steps).toContainEqual({ step: 'réaction', release: 'prod2', change_pct: '-0.33', reason: null });
    expect(rest.state('reaction:prod2:2026-12-08')).toMatchObject({ change_pct: '-0.33', title: 'Productivity and Costs', indicators: ['us-prod-qq', 'us-ulc-qq'] });
  });

  it('PPI sous-jacent vide à l’heure H : complété une fois par l’API v1', async () => {
    const rest = base();
    rest.rows('releases').push({ id: 9, release: 'ppi', indicator_id: 'us-core-ppi-mm', period: '2026-10', edition: '', ny_date: '2026-11-13',
      value: null, reason: 'absent du résumé', regular: 1, scheduled_ms: T - 25 * 86_400_000, forecast: '0.2', flags: '[]', nature: 'officielle' });
    const { w, deps } = world(T);
    expect(await checkRevisions(deps(rest), 'révisions quotidiennes', T)).toBe(1);
    expect(await checkRevisions(deps(rest), 'révisions quotidiennes', T)).toBe(0);
    expect(w.api).toBe(2);
    expect(rest.rows('releases')[0]).toMatchObject({ value: '0.3', surprise: '0.1', part: 'API v1 (recalculé)', reason: null });
    expect(rest.state('release:us-core-ppi-mm:2026-10')).toMatchObject({ value: '0.3' });
  });

  it('sans adresse de contact : capture arrêtée avec sa raison, aucune requête', async () => {
    const rest = base();
    const { w, deps } = world(T - 60_000);
    expect(await runCapture(deps(rest, {}))).toMatchObject({ ok: false });
    expect(w.requests).toHaveLength(0);
    expect(rest.state('release:state')).toMatchObject({ phase: 'arrêté' });
  });
});
