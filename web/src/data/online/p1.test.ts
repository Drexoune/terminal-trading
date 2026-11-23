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
    expect(getValue(P1_STATUS_KEY)).toEqual({ configured: true, reason: null, received_ms: NOW });
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
