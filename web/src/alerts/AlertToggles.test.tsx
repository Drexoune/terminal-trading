import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../calendar/calendar';
import { getSettings, setSettings } from '../config/settings';
import { clearValues, setValue } from '../data/store';
import { EventBell, NewsCategoryAlerts } from './AlertToggles';
import type { AlertRule } from './alerts';

const EV = { id: '552-us-flash-manufacturing-pmi|USD|2026-11-23|1', title: 'Flash Manufacturing PMI', title_fr: null, time_ms: 1795409100000,
  currency: 'USD' } as unknown as CalendarEvent;
const rule = (id: number, kind: AlertRule['kind'], params: Record<string, unknown>, state: AlertRule['state'] = 'armée'): AlertRule =>
  ({ id, kind, params, channels: ['écran', 'telegram'], state, label: '', category: '', created_ms: 0, updated_ms: 0, last_fired_ms: null });

let calls: { method: string; url: string; body: unknown }[] = [];
let status = 200;
const initial = getSettings();

beforeEach(() => {
  calls = [];
  status = 200;
  setSettings({ ...initial, mode: 'online' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(status === 200 ? '{"id":9}' : '{"detail":"session requise"}', { status, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearValues(); setSettings(initial); });

describe('cloche du calendrier', () => {
  it('pose une règle event_watch avec Telegram ; un second clic la retire', async () => {
    const onError = vi.fn();
    const { rerender } = render(<EventBell ev={EV} rules={[]} onError={onError} done={false} />);
    await act(async () => { fireEvent.click(screen.getByTestId('cal-bell')); });
    expect(calls[0]).toMatchObject({ method: 'POST', body: { kind: 'event_watch', channels: ['telegram'],
      params: { event_id: EV.id, title: 'Flash Manufacturing PMI', time_ms: 1795409100000 } } });
    rerender(<EventBell ev={EV} rules={[rule(4, 'event_watch', { event_id: EV.id })]} onError={onError} done={false} />);
    expect(screen.getByTestId('cal-bell').getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(screen.getByTestId('cal-bell')); });
    expect(calls.find((c) => c.method === 'DELETE')?.url).toMatch(/\/api\/alerts\/rules\/4$/);
  });

  it('session absente : raison affichée ; cachée en Mode Local et quand le réel est connu', async () => {
    status = 401;
    const onError = vi.fn();
    render(<EventBell ev={EV} rules={[]} onError={onError} done={false} />);
    await act(async () => { fireEvent.click(screen.getByTestId('cal-bell')); });
    expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/^Cloche : session requise/));
    cleanup();
    render(<EventBell ev={EV} rules={[]} onError={onError} done />);
    expect(screen.queryByTestId('cal-bell')).toBeNull();
    cleanup();
    setSettings({ ...initial, mode: 'local' });
    render(<EventBell ev={EV} rules={[]} onError={onError} done={false} />);
    expect(screen.queryByTestId('cal-bell')).toBeNull();
  });
});

describe('alertes Telegram par catégorie du fil', () => {
  it('« Fort impact » crée la règle ; changer de niveau remplace l’ancienne', async () => {
    setValue('alert:rule:7', rule(7, 'news_category', { category: 'crypto', urgent_only: false }));
    render(<NewsCategoryAlerts categories={[{ value: 'crypto', label: 'Crypto' }, { value: 'macro', label: 'Macro' }]} />);
    expect(screen.getByText('Alertes Telegram · 1 catégorie')).toBeTruthy();
    const crypto = screen.getByRole('group', { name: 'Telegram : Crypto' });
    expect(crypto.querySelector('[aria-pressed="true"]')?.textContent).toBe('Tout');
    await act(async () => { fireEvent.click(screen.getByRole('group', { name: 'Telegram : Crypto' }).querySelectorAll('button')[1]); });
    expect(calls.map((c) => c.method)).toEqual(['DELETE', 'POST']);
    expect(calls[1].body).toEqual({ kind: 'news_category', params: { category: 'crypto', urgent_only: true }, channels: ['telegram'] });
  });
});
