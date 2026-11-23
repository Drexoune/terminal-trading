// @vitest-environment node
// Tâches ff-calendar et bls-calendar (O2) sur une base simulée et un réseau simulé,
// avec les relevés réels du 20/11/2026.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { archiveWeek, BLS_ICS_URL, FF_URL, runBlsCalendar, runFfCalendar, type HttpFetch } from './calendar_job.ts';
import { fromBytea } from './rest.ts';
import { MemRest } from './_memrest.ts';

const FIX = fileURLToPath(new URL('../../../gateway/tests/fixtures/calendar/', import.meta.url));
const XML = new Uint8Array(readFileSync(`${FIX}ff_calendar_thisweek_2026-11-20.xml`));
const ICS = new Uint8Array(readFileSync(`${FIX}bls_2026-11-20.ics`));
const EMAIL = 'terminal@example.org';
const T0 = Date.UTC(2026, 10, 20, 15, 45);   // vendredi 20/11, 16:45 Paris

interface Reply { status: number; body?: Uint8Array; headers?: Record<string, string> }

function net(replies: Record<string, Reply[]>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const r = replies[url].shift()!;
    const h = r.headers ?? {};
    return { status: r.status, headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
      arrayBuffer: async () => (r.body ?? new Uint8Array()).slice().buffer };
  };
  return { fetch, calls };
}

function deps(rest: MemRest, fetch: HttpFetch, t: { now: number }, env: Record<string, string> = { BLS_CONTACT_EMAIL: EMAIL }) {
  return { rest, fetch, now: () => t.now, env: (n: string) => env[n] };
}

const withForecast = (xml: Uint8Array, from: string, to: string) =>
  new TextEncoder().encode(new TextDecoder('windows-1252').decode(xml).replace(from, to));

describe('p1-jobs : agenda ForexFactory', () => {
  it('premier relevé : archive brute, 11 événements, semaine et flux publiés', async () => {
    const rest = new MemRest();
    const t = { now: T0 };
    const { fetch, calls } = net({ [FF_URL]: [{ status: 200, body: XML, headers: { etag: '"a1"', 'last-modified': 'Fri, 20 Nov 2026 15:42:00 GMT' } }] });
    const r = await runFfCalendar(deps(rest, fetch, t));
    expect(r).toMatchObject({ ok: true, status: 200, events: 11, week: '2026-W47' });
    expect(calls[0].headers['User-Agent']).toBe('terminal-trading/0.1');
    const snap = rest.rows('calendar_snapshots')[0];
    expect(snap).toMatchObject({ source: 'ForexFactory', status: 200, etag: '"a1"', received_ms: T0, source_ts_ms: Date.UTC(2026, 10, 20, 15, 42) });
    expect(fromBytea(snap.body as string)).toEqual(XML);
    expect(rest.rows('calendar_events')).toHaveLength(11);
    const week = rest.state('calendar:week:2026-W47') as { events: unknown[]; from: string; to: string; forexfactory: { received_ms: number } };
    expect(week.events).toHaveLength(11);
    expect([week.from, week.to]).toEqual(['2026-11-15', '2026-11-21']);
    expect(week.forexfactory.received_ms).toBe(T0);
    expect(rest.state('feed:calendar')).toMatchObject({ name: 'calendar', status: 'connected', last_message_ms: T0, last_error: null });
  });

  it('second passage sauté ; relevé forcé conditionnel (304) ; une prévision révisée = une nouvelle version', async () => {
    const rest = new MemRest();
    const t = { now: T0 };
    const changed = withForecast(XML, '<previous><![CDATA[50.9]]></previous>', '<previous><![CDATA[51.2]]></previous>');
    const { fetch, calls } = net({ [FF_URL]: [
      { status: 200, body: XML, headers: { etag: '"a1"', 'last-modified': 'Fri, 20 Nov 2026 15:42:00 GMT' } },
      { status: 304, headers: { etag: '"a1"' } },
      { status: 200, body: changed, headers: { etag: '"a2"' } },
    ] });
    await runFfCalendar(deps(rest, fetch, t));
    t.now += 10 * 60_000;
    expect(await runFfCalendar(deps(rest, fetch, t))).toMatchObject({ ok: true, skipped: expect.stringContaining('20 min') });
    const r304 = await runFfCalendar(deps(rest, fetch, t), true);
    expect(r304).toMatchObject({ ok: true, status: 304, events: 0 });
    expect(calls[1].headers).toMatchObject({ 'If-None-Match': '"a1"', 'If-Modified-Since': 'Fri, 20 Nov 2026 15:42:00 GMT' });
    expect((rest.state('calendar:week:2026-W47') as { forexfactory: { received_ms: number } }).forexfactory.received_ms).toBe(t.now);
    t.now += 60 * 60_000;
    await runFfCalendar(deps(rest, fetch, t));
    const events = rest.rows('calendar_events');
    expect(events).toHaveLength(12);   // 11 + la nouvelle version de BusinessNZ
    const busNz = events.filter((e) => String(e.identity).startsWith('852-nz-businessnz-services-index'));
    expect(busNz.map((e) => [e.previous_raw, e.first_seen_ms === T0, e.last_seen_ms === t.now])).toEqual([['50.9', true, false], ['51.2', false, true]]);
    expect(events.filter((e) => e.last_seen_ms === t.now)).toHaveLength(11);
  });

  it('refus de ForexFactory : relevé archivé avec son statut, flux en erreur, rien d’inventé', async () => {
    const rest = new MemRest();
    const { fetch } = net({ [FF_URL]: [{ status: 403 }] });
    const r = await runFfCalendar(deps(rest, fetch, { now: T0 }));
    expect(r).toMatchObject({ ok: false, status: 403, error: 'ForexFactory : HTTP 403' });
    expect(rest.rows('calendar_snapshots')[0]).toMatchObject({ status: 403, body: null });
    expect(rest.rows('calendar_events')).toHaveLength(0);
    expect(rest.state('feed:calendar')).toMatchObject({ status: 'reconnecting', reconnects: 1, last_error: 'ForexFactory : HTTP 403' });
  });
});

describe('p1-jobs : calendrier du BLS', () => {
  it('sans adresse de contact : arrêté avec sa raison, le BLS n’est pas interrogé', async () => {
    const rest = new MemRest();
    const { fetch, calls } = net({});
    const r = await runBlsCalendar(deps(rest, fetch, { now: T0 }, {}));
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(rest.state('feed:bls-calendar')).toMatchObject({ status: 'stopped', last_error: expect.stringContaining('BLS_CONTACT_EMAIL') });
  });

  it('34 publications ; une date à venir qui disparaît du calendrier est « déplacée »', async () => {
    const rest = new MemRest();
    const t = { now: T0 };
    const text = new TextDecoder().decode(ICS);
    // Le jour suivant, le CPI du 10/12 n'est plus annoncé (shutdown, report).
    const blocks = text.split('BEGIN:VEVENT');
    const without = new TextEncoder().encode(blocks.filter((b) => !(b.includes('20261210T083000') && b.includes('Consumer Price Index'))).join('BEGIN:VEVENT'));
    const { fetch, calls } = net({ [BLS_ICS_URL]: [{ status: 200, body: ICS, headers: { etag: '"b1"' } }, { status: 200, body: without, headers: { etag: '"b2"' } }] });
    expect(await runBlsCalendar(deps(rest, fetch, t))).toMatchObject({ ok: true, status: 200, moved: 0 });
    expect(calls[0].headers['User-Agent']).toBe(`terminal-trading/0.1 (${EMAIL})`);
    expect(rest.rows('official_releases')).toHaveLength(34);
    t.now += 86_400_000;
    const r = await runBlsCalendar(deps(rest, fetch, t));
    expect(r).toMatchObject({ ok: true, moved: 1 });
    expect(calls[1].headers['If-None-Match']).toBe('"b1"');
    const off = rest.state('calendar:official') as { moved: { title: string; local_date: string }[]; releases: { title: string }[] };
    expect(off.moved).toEqual([expect.objectContaining({ title: 'Consumer Price Index', local_date: '2026-12-10' })]);
    expect(off.releases.every((x) => ['Consumer Price Index', 'Employment Situation', 'Producer Price Index', 'Productivity and Costs'].includes(x.title))).toBe(true);
    // La première vue d'une publication toujours annoncée est gardée.
    const empsit = rest.rows('official_releases').find((x) => x.title === 'Employment Situation' && x.local_date === '2026-12-04')!;
    expect([empsit.first_seen_ms, empsit.last_seen_ms]).toEqual([T0, t.now]);
  });
});

describe('p1-jobs : archive d’une semaine passée', () => {
  it('dernière version de chaque événement de la semaine', async () => {
    const rest = new MemRest();
    const t = { now: T0 };
    const changed = withForecast(XML, '<previous><![CDATA[50.9]]></previous>', '<previous><![CDATA[51.2]]></previous>');
    const { fetch } = net({ [FF_URL]: [{ status: 200, body: XML }, { status: 200, body: changed }] });
    await runFfCalendar(deps(rest, fetch, t));
    t.now += 3_600_000;
    await runFfCalendar(deps(rest, fetch, t));
    const week = await archiveWeek(rest, '2026-W47');
    expect(week).toMatchObject({ week: '2026-W47', archive: true });
    const events = (week!.events as { id: string; previous_raw: string }[]);
    expect(events).toHaveLength(11);
    expect(events.find((e) => e.id.startsWith('852-nz'))!.previous_raw).toBe('51.2');
    expect(await archiveWeek(rest, '2026-W40')).toBeNull();
  });
});
