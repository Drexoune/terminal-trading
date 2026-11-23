import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gateway', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '../gateway';
import { clearValues, getValue } from '../store';
import { loadState, P1_STATUS_KEY, refreshNext } from './p1';
import { nextEvents, type CalendarEvent, type CalendarWeek } from '../../calendar/calendar';

const NOW = Date.UTC(2026, 10, 23, 12, 0);
const ev = (id: string, impact: string, time_ms: number | null) => ({ id, impact, time_ms }) as CalendarEvent;
const WEEK = {
  week: '2026-W48', from: '2026-11-22', to: '2026-11-28', archive: false,
  forexfactory: { source_ts_ms: 1, received_ms: 2 }, bls: null,
  events: [ev('passé', 'High', NOW - 1), ev('faible', 'Low', NOW + 1), ev('b', 'Medium', NOW + 20), ev('a', 'High', NOW + 10),
    ev('sans-heure', 'High', null), ev('c', 'High', NOW + 30), ev('d', 'High', NOW + 40), ev('e', 'High', NOW + 50), ev('f', 'High', NOW + 60)],
} as CalendarWeek;

afterEach(() => { clearValues(); vi.mocked(fetchJson).mockReset(); });

describe('Mode Online : état de P1', () => {
  it('prochains événements : Fort ou Moyen, à venir, dans l’ordre, cinq au plus', () => {
    expect(nextEvents(WEEK, NOW).events.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(nextEvents(null, NOW)).toEqual({ events: [], computed_ms: NOW, week: null, forexfactory: null });
  });

  it('l’état relu est rangé sous les clés du bus, calendar:next recalculé', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ configured: true, computed_ms: NOW,
      items: [['calendar:week:2026-W48', WEEK], ['feed:calendar', { name: 'calendar', status: 'connected' }]] });
    await loadState(() => NOW);
    expect(vi.mocked(fetchJson).mock.calls[0][0]).toBe('/api/p1/state');
    expect(getValue('calendar:week:2026-W48')).toEqual(WEEK);
    expect(getValue<{ events: { id: string }[] }>('calendar:next')!.events[0].id).toBe('a');
    expect(getValue(P1_STATUS_KEY)).toMatchObject({ configured: true, reason: null, received_ms: NOW });
    refreshNext(NOW + 15);
    expect(getValue<{ events: { id: string }[] }>('calendar:next')!.events[0].id).toBe('b');
  });

  it('non configuré ou injoignable : la raison, aucune donnée', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ configured: false, reason: 'variable(s) absente(s) : SUPABASE_URL', items: [], computed_ms: NOW });
    await loadState(() => NOW);
    expect(getValue(P1_STATUS_KEY)).toMatchObject({ configured: false, reason: 'variable(s) absente(s) : SUPABASE_URL' });
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP 502'));
    await loadState(() => NOW);
    expect(getValue(P1_STATUS_KEY)).toMatchObject({ configured: null, reason: 'agenda en ligne injoignable : HTTP 502' });
    expect(getValue('calendar:next')).toBeUndefined();
  });
});

describe('Mode Online : Realtime et relecture', () => {
  it('message poussé = valeur du store ; 15 s sans Realtime, 5 min avec ; relecture à la reconnexion', async () => {
    const { startP1Online, STATE_EVERY_MS, STATE_EVERY_DEGRADED_MS, applyPush } = await import('./p1');
    const timers: number[] = [];
    let loads = 0;
    let onStatus: (s: 'connexion' | 'connecté' | 'coupé' | 'non configuré', why?: string) => void = () => {};
    let onMessage: (m: { key: string; value: unknown; updated_ms: number }) => void = () => {};
    const stop = startP1Online({
      load: async () => { loads++; },
      setTimer: (_fn, ms) => { timers.push(ms); return timers.length; },
      clearTimer: () => {},
      connect: (_c, m, s) => { onMessage = m; onStatus = s; return () => {}; },
    });
    await Promise.resolve(); await Promise.resolve();
    expect(loads).toBe(1);
    expect(timers.at(-1)).toBe(STATE_EVERY_DEGRADED_MS);
    onStatus('connecté');
    expect(loads).toBe(2);                         // relecture complète à la connexion
    expect(timers.at(-1)).toBe(STATE_EVERY_MS);
    onMessage({ key: 'release:us-cpi-mm:2026-11', value: { value: '0.3' }, updated_ms: NOW });
    expect(getValue('release:us-cpi-mm:2026-11')).toEqual({ value: '0.3' });
    expect(getValue(P1_STATUS_KEY)).toMatchObject({ realtime: 'connecté' });
    onStatus('coupé', 'CLOSED');
    expect(timers.at(-1)).toBe(STATE_EVERY_DEGRADED_MS);
    expect(getValue(P1_STATUS_KEY)).toMatchObject({ realtime: 'coupé', realtime_reason: 'CLOSED' });
    applyPush({ key: 'calendar:week:2026-W48', value: WEEK, updated_ms: NOW }, NOW);
    expect(getValue<{ events: { id: string }[] }>('calendar:next')!.events[0].id).toBe('a');
    stop();
  });
});
