import { afterEach, describe, expect, it, vi } from 'vitest';
import { ackAlerts } from '../../alerts/alerts';
import { clearValues, getValue, keysWithPrefix, setValue } from '../store';
import { ALERTS_STATUS_KEY, alertsProblem, applyAlertState, loadAlerts, startAlertsOnline } from './alerts';

afterEach(() => { vi.unstubAllGlobals(); clearValues(); });

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('alertes en Mode Online (O4)', () => {
  it('une règle absente de la réponse quitte le store ; les autres clés restent', () => {
    setValue('alert:rule:1', { id: 1 });
    setValue('alert:rule:2', { id: 2 });
    setValue('alert:fired:aa', { id: 'aa' });
    setValue('release:last', { release: 'cpi' });
    applyAlertState([['alert:rule:2', { id: 2, state: 'armée' }], ['alert:summary', { rules: 1 }]]);
    expect(keysWithPrefix('alert:rule:').map(([k]) => k)).toEqual(['alert:rule:2']);
    expect(keysWithPrefix('alert:fired:')).toEqual([]);
    expect(getValue('release:last')).toEqual({ release: 'cpi' });
    expect(getValue('alert:summary')).toEqual({ rules: 1 });
  });

  it('session absente : raison lisible, rien d’inventé', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { detail: 'session requise' })));
    await loadAlerts(() => 5);
    expect(getValue(ALERTS_STATUS_KEY)).toEqual({ ok: false, reason: expect.stringMatching(/^session requise/), received_ms: 5 });
    expect(alertsProblem('HTTP 503 {"detail":"non configuré : P1_JOBS_SECRET absente"}')).toBe('indisponible : non configuré : P1_JOBS_SECRET absente');
  });

  it('écriture puis relecture immédiate de l’état', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return url.endsWith('/state') ? reply(200, { items: [['alert:summary', { unacked: 0 }]], computed_ms: 1 }) : reply(200, { acked: 2 });
    }));
    const stop = startAlertsOnline((() => 0 as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval, (() => {}) as typeof clearInterval);
    await vi.waitFor(() => expect(getValue(ALERTS_STATUS_KEY)).toMatchObject({ ok: true }));
    await ackAlerts();
    await vi.waitFor(() => expect(calls.filter((c) => c.endsWith('/api/alerts/state'))).toHaveLength(2));
    expect(calls[1]).toMatch(/^POST .*\/api\/alerts\/ack$/);
    stop();
  });
});
