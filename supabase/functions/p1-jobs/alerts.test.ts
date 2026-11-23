// @vitest-environment node
// Moteur d'alertes en ligne (O4) : base simulée, Telegram simulé, horloge fixe.
import { describe, expect, it } from 'vitest';
import { MemRest } from './_memrest.ts';
import { fireEventWatch, fireNewsAlerts, fireReleaseAlerts, runAlertCommand, runAlerts, type AlertDeps } from './alerts.ts';

const T0 = Date.UTC(2026, 11, 10, 13, 30);   // 10/12/2026 14:30 Paris, IPC

function setup(env: Record<string, string> = { TELEGRAM_BOT_TOKEN: 'tok123', TELEGRAM_CHAT_ID: '42' }) {
  const rest = new MemRest();
  let now = T0;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  let answer: Record<string, unknown> = { ok: true, result: {} };
  const deps: AlertDeps = {
    rest, now: () => now, sleep: async (ms) => { now += ms; }, env: (k) => env[k],
    fetch: async (url, init) => {
      sent.push({ url, body: JSON.parse(init?.body ?? '{}') });
      return { status: answer.ok ? 200 : 400, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(answer)).buffer };
    },
  };
  return { rest, deps, sent, at: (ms: number) => { now = ms; }, answer: (a: Record<string, unknown>) => { answer = a; } };
}

const cmd = (d: AlertDeps, body: Record<string, unknown>) => runAlertCommand(d, body);

describe('alertes en ligne : écritures de /alertes', () => {
  it('crée, modifie, désactive, supprime ; refuse ce que la passerelle refuse', async () => {
    const { rest, deps } = setup();
    const c = await cmd(deps, { op: 'create', kind: 'price', params: { inst: 'BTC-USDT-SWAP', level: '110000.0' }, channels: ['telegram'] });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ id: 1, state: 'armée', channels: ['écran', 'telegram'], label: 'BTC franchit 110 000', params: { level: '110000' } });
    expect((await rest.select('p1_state', { select: 'key', key: 'eq.alert:rule:1' })).length).toBe(1);
    expect(await cmd(deps, { op: 'create', kind: 'price', params: { inst: 'SOL-USDT-SWAP', level: '1' } })).toEqual(
      { status: 400, body: { ok: false, error: "instrument non suivi : 'SOL-USDT-SWAP'" } });
    expect((await cmd(deps, { op: 'update', id: 1, state: 'déclenchée' })).status).toBe(400);
    expect((await cmd(deps, { op: 'update', id: 9, state: 'armée' })).status).toBe(404);
    const u = await cmd(deps, { op: 'update', id: 1, state: 'désactivée', channels: ['voix'] });
    expect(u.body).toMatchObject({ state: 'désactivée', channels: ['écran', 'voix'] });
    expect(rest.rows('alert_rules')[0]).toMatchObject({ state: 'désactivée', channels: '["écran","voix"]' });
    expect((await cmd(deps, { op: 'delete', id: 1 })).body).toMatchObject({ ok: true });
    expect(rest.rows('alert_rules')).toEqual([]);
    expect((await rest.select('p1_state', { select: 'key', key: 'like.alert:rule:*' }))).toEqual([]);
    expect((await cmd(deps, { op: 'nope' })).status).toBe(400);
  });

  it('essai Telegram : jeton jamais renvoyé, état publié', async () => {
    const { deps, sent, answer, rest } = setup();
    answer({ ok: false, description: 'Unauthorized: bot tok123 revoked' });
    const r = await cmd(deps, { op: 'test' });
    expect(r.body).toMatchObject({ ok: false, error: 'Unauthorized: bot <jeton> revoked' });
    expect(sent[0].url).toContain('/sendMessage');
    expect(sent[0].body.chat_id).toBe('42');
    const [summary] = await rest.select<{ value: { telegram: Record<string, unknown> } }>('p1_state', { select: 'value', key: 'eq.alert:summary' });
    expect(summary.value.telegram).toMatchObject({ configured: true, last_ok: false });
  });
});

describe('alertes en ligne : déclenchements', () => {
  const last = { release: 'cpi', title: 'Consumer Price Index', period: '2026-11', edition: null, ny_date: '2026-12-10',
    keys: ['release:us-cpi-mm:2026-11'], scheduled_ms: T0, bus_ms: T0 + 400, nature: 'officielle' };
  const fig = { indicator: 'us-cpi-mm', label_fr: 'IPC (m/m)', unit: '%', value: '0.6', forecast: '0.3', surprise: '0.3', z: '2.1', period: '2026-11' };

  it('chiffre publié : une seule fois, Telegram envoyé, jamais pour un arriéré', async () => {
    const { rest, deps, sent, at } = setup();
    await cmd(deps, { op: 'create', kind: 'release', params: { releases: [] }, channels: ['telegram', 'voix'] });
    await cmd(deps, { op: 'create', kind: 'surprise', params: { z_min: '2' }, channels: [] });
    at(T0 + 500);
    expect(await fireReleaseAlerts(deps, last, [fig])).toBe(2);
    expect(await fireReleaseAlerts(deps, last, [fig])).toBe(0);
    expect(sent).toHaveLength(1);
    expect(String(sent[0].body.text)).toContain('IPC (m/m) : 0,6 % (prév. 0,3 %, surprise +0,3, z +2,1)');
    const ev = rest.rows('alert_events');
    expect(ev.map((e) => e.telegram).sort()).toEqual(['envoyé', null]);
    const fired = await rest.select<{ value: Record<string, unknown> }>('p1_state', { select: 'value', key: 'like.alert:fired:*' });
    expect(fired.map((f) => f.value.voice).sort()).toEqual([false, true]);
    // La tâche de la minute suivante ne redéclenche rien.
    await rest.upsert('p1_state', [{ key: 'release:last', value: last, updated_ms: T0 }, { key: 'release:us-cpi-mm:2026-11', value: fig, updated_ms: T0 }], 'key');
    at(T0 + 60_000);
    expect((await runAlerts(deps)).fired).toEqual([]);
    // Arriéré (publication vieille de plus de 2 h) : rien.
    at(T0 + 3 * 3_600_000);
    expect(await fireReleaseAlerts(deps, { ...last, period: '2026-10', bus_ms: T0 + 3 * 3_600_000 }, [fig])).toBe(0);
  });

  it('prix : curseur posé sans déclencher, puis franchissement par le haut de la bougie', async () => {
    const { rest, deps, at } = setup({});
    await cmd(deps, { op: 'create', kind: 'price', params: { inst: 'BTC-USDT-SWAP', level: '100000', direction: 'hausse' }, channels: ['telegram'] });
    const k = (min: number, h: number, l: number, c: number) => ({ inst: 'BTC-USDT-SWAP', t: new Date(T0 + min * 60_000).toISOString(), h, l, c });
    await rest.insert('okx_candles_1m', [k(0, 99_950, 99_800, 99_900)]);
    expect((await runAlerts(deps)).fired).toEqual([]);
    await rest.insert('okx_candles_1m', [k(1, 99_990, 99_850, 99_950), k(2, 100_020, 99_940, 99_980)]);
    at(T0 + 4 * 60_000);
    const r = await runAlerts(deps);
    expect(r.fired).toEqual([{ rule: 1, title: 'BTC-USDT perp franchit 100 000 à la hausse', telegram: 'non configuré' }]);
    expect(rest.rows('alert_rules')[0].state).toBe('déclenchée');
    await rest.insert('okx_candles_1m', [k(3, 100_100, 99_000, 99_500)]);
    expect((await runAlerts(deps)).fired).toEqual([]);   // déclenchée : plus évaluée avant d'être réarmée
  });

  it('T-5 min avant une publication captée', async () => {
    const { rest, deps, at } = setup({});
    await cmd(deps, { op: 'create', kind: 'event_soon', params: { minutes: 5, captured_only: true } });
    await rest.upsert('p1_state', [{ key: 'calendar:week:2026-W50', updated_ms: T0, value: { events: [
      { id: 'e1', time_ms: T0, capture: true, impact: 'High', currency: 'USD', title: 'CPI m/m', title_fr: 'IPC (m/m)', forecast_raw: '0.3%' },
      { id: 'e2', time_ms: T0, capture: false, impact: 'High', currency: 'USD', title: 'Other' }] } }], 'key');
    at(T0 - 6 * 60_000);
    expect((await runAlerts(deps)).fired).toEqual([]);
    at(T0 - 4 * 60_000);
    expect((await runAlerts(deps)).fired).toEqual([{ rule: 1, title: 'Dans 5 min : IPC (m/m) (USD)', telegram: null }]);
  });

  it('acquittement : tout, ou une liste ; résumé à jour', async () => {
    const { rest, deps, at } = setup({});
    await cmd(deps, { op: 'create', kind: 'release', params: {} });
    at(T0 + 500);
    await fireReleaseAlerts(deps, last, [fig]);
    await fireReleaseAlerts(deps, { ...last, release: 'ppi', keys: [] }, []);
    const ids = rest.rows('alert_events').map((e) => String(e.id));
    expect((await cmd(deps, { op: 'ack', ids: ['zz'] })).status).toBe(400);
    expect((await cmd(deps, { op: 'ack', ids: [ids[0]] })).body).toEqual({ acked: 1 });
    expect((await cmd(deps, { op: 'ack' })).body).toEqual({ acked: 1 });
    const [s] = await rest.select<{ value: { unacked: number } }>('p1_state', { select: 'value', key: 'eq.alert:summary' });
    expect(s.value.unacked).toBe(0);
  });
});

describe('cloche du calendrier et catégories du fil', () => {
  const T = Date.UTC(2026, 10, 23, 14, 45);
  const EV = { id: '552-us-flash-manufacturing-pmi|USD|2026-11-23|1', title: 'Flash Manufacturing PMI', title_fr: null, currency: 'USD',
    time_ms: T, forecast_raw: '54.5', previous_raw: '54.9', capture: false, indicator: null, ny_date: '2026-11-23' };
  const CPI = { id: '1-us-cpi-mm|USD|2026-12-10|1', title: 'CPI m/m', title_fr: 'IPC (m/m)', currency: 'USD', time_ms: T0,
    forecast_raw: '0.3%', previous_raw: '0.4%', capture: true, indicator: 'us-cpi-mm', ny_date: '2026-12-10' };
  async function seed(rest: MemRest) {
    await rest.upsert('p1_state', [{ key: 'calendar:week:2026-W50', updated_ms: 0, value: { events: [EV, CPI] } }], 'key');
  }
  const bell = (ev: typeof EV | typeof CPI) => ({ op: 'create', kind: 'event_watch', params: { event_id: ev.id, title: ev.title, time_ms: ev.time_ms }, channels: ['telegram'] });

  it('réel tiré de FinancialJuice : un seul message, cloche éteinte ensuite', async () => {
    const { rest, deps, sent, at } = setup();
    await seed(rest);
    await cmd(deps, bell(EV));
    at(T + 10_000);
    expect(await fireEventWatch(deps)).toBe(0);                          // rien encore
    await rest.upsert('p1_state', [{ key: `calendar:actual:${EV.id}`, updated_ms: T, value: { actual: '54.5', actual_raw: '54.5', news_title: 'x' } }], 'key');
    expect(await fireEventWatch(deps)).toBe(1);
    expect(sent.map((x) => String(x.body.text).split('\n')[0])).toEqual(['Flash Manufacturing PMI (USD) : 54.5']);
    expect(rest.rows('alert_rules')[0].state).toBe('déclenchée');
    expect(await fireEventWatch(deps)).toBe(0);
  });

  it('chiffre capté au BLS : valeur à la française, source BLS', async () => {
    const { rest, deps, sent, at } = setup();
    await seed(rest);
    await cmd(deps, bell(CPI));
    await rest.upsert('p1_state', [{ key: 'release:us-cpi-mm:2026-11', updated_ms: T0, value: { indicator: 'us-cpi-mm', ny_date: '2026-12-10', value: '0.6', unit: '%' } }], 'key');
    at(T0 + 900);
    expect(await fireEventWatch(deps)).toBe(1);
    expect(String(sent[0].body.text)).toContain('IPC (m/m) (USD) : 0,6\u00a0%\nConsensus 0.3% · précédent 0.4% · source : BLS (capté à la source)');
  });

  it('rien après 30 min : « réel non capté » une fois ; après 24 h, cloche éteinte sans message', async () => {
    const { rest, deps, at } = setup({});
    await seed(rest);
    await cmd(deps, bell(EV));
    at(T + 31 * 60_000);
    expect((await runAlerts(deps)).fired).toEqual([{ rule: 1, title: 'Flash Manufacturing PMI (USD) : réel non capté', telegram: 'non configuré' }]);
    at(T + 40 * 60_000);
    expect((await runAlerts(deps)).fired).toEqual([]);
    expect(rest.rows('alert_rules')[0].state).toBe('armée');
    at(T + 25 * 3_600_000);
    await runAlerts(deps);
    expect(rest.rows('alert_rules')[0].state).toBe('déclenchée');
  });

  it('catégorie du fil : fort impact seulement, un message par titre', async () => {
    const { deps, sent } = setup();
    await cmd(deps, { op: 'create', kind: 'news_category', params: { category: 'crypto', urgent_only: true }, channels: ['telegram'] });
    const item = (id: number, urgent: boolean, category = 'crypto') => ({ id, title: `Titre ${id}`, source: 'FinancialJuice', published_ms: T0, received_ms: T0, category, urgent });
    expect(await fireNewsAlerts(deps, [item(1, false), item(2, true), item(3, true, 'macro')])).toBe(1);
    expect(await fireNewsAlerts(deps, [item(2, true)])).toBe(0);
    expect(String(sent[0].body.text).split('\n').slice(0, 2)).toEqual(['Crypto : Titre 2', 'FinancialJuice · fort impact · VO']);
  });
});

