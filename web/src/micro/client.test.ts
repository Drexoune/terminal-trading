// @vitest-environment node
// Source de la microstructure (T-069) : serveur d'abord, moteur local en repli (rien en 5 s,
// erreur, silence), nouvel essai toutes les 30 s, moteur local arrêté au retour du serveur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicroSource, SERVER_RETRY_MS, SERVER_TIMEOUT_MS } from './client';

class FakeEs {
  static all: FakeEs[] = [];
  listeners = new Map<string, (ev: MessageEvent) => void>();
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEs.all.push(this); }
  addEventListener(t: string, l: (ev: MessageEvent) => void) { this.listeners.set(t, l); }
  close() { this.closed = true; }
  emit(t: string, items: unknown) { this.listeners.get(t)?.({ data: JSON.stringify(items) } as MessageEvent); }
}

function setup(server: string | null = 'https://micro.test') {
  const published: [string, unknown][] = [];
  const calls = { start: 0, stop: 0 };
  const s = new MicroSource(server, {
    EventSource: FakeEs as never, publish: (it) => published.push(...it),
    startLocal: () => { calls.start++; }, stopLocal: () => { calls.stop++; }, now: () => 42,
  });
  s.start();
  return { s, published, calls };
}

beforeEach(() => { FakeEs.all = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('source de la microstructure', () => {
  it('serveur joignable : état publié, aucun moteur local', () => {
    const { s, published, calls } = setup();
    expect(FakeEs.all[0].url).toBe('https://micro.test/micro/stream');
    FakeEs.all[0].emit('state', [['micro:book', { x: 1 }], ['micro:source', { kind: 'server' }]]);
    expect(s.mode).toBe('server');
    expect(published.map(([k]) => k)).toEqual(['micro:book', 'micro:source']);
    vi.advanceTimersByTime(SERVER_TIMEOUT_MS - 1);
    FakeEs.all[0].emit('items', [['micro:book', { x: 2 }]]);
    vi.advanceTimersByTime(SERVER_TIMEOUT_MS - 1);
    expect(calls.start).toBe(0);
  });

  it('rien en 5 s : moteur local, source « navigateur » avec la raison ; serveur revenu : moteur local arrêté', () => {
    const { s, published, calls } = setup();
    vi.advanceTimersByTime(SERVER_TIMEOUT_MS);
    expect(s.mode).toBe('local');
    expect(calls.start).toBe(1);
    expect(FakeEs.all[0].closed).toBe(true);
    expect(published.at(-1)).toEqual(['micro:source', { kind: 'browser', reason: 'aucune réponse du serveur en 5 s', since: 42, server: 'https://micro.test' }]);
    vi.advanceTimersByTime(SERVER_RETRY_MS);
    expect(FakeEs.all).toHaveLength(2);
    FakeEs.all[1].emit('state', [['micro:source', { kind: 'server' }]]);
    expect(s.mode).toBe('server');
    expect(calls.stop).toBe(1);
  });

  it('serveur muet en cours de route : repli au bout de 5 s', () => {
    const { s, calls } = setup();
    FakeEs.all[0].emit('state', []);
    FakeEs.all[0].onerror?.({} as Event);                 // EventSource retente seul : pas de repli immédiat
    expect(s.mode).toBe('server');
    vi.advanceTimersByTime(SERVER_TIMEOUT_MS);
    expect(s.mode).toBe('local');
    expect(calls.start).toBe(1);
  });

  it('erreur avant toute donnée : repli immédiat ; sans adresse de serveur : moteur local seul', () => {
    const a = setup();
    FakeEs.all[0].onerror?.({} as Event);
    expect(a.s.mode).toBe('local');
    a.s.stop();
    FakeEs.all = [];
    const b = setup(null);
    expect(b.s.mode).toBe('local');
    expect(FakeEs.all).toHaveLength(0);
    vi.advanceTimersByTime(SERVER_RETRY_MS * 2);
    expect(FakeEs.all).toHaveLength(0);
    expect(b.published.at(-1)).toEqual(['micro:source', { kind: 'browser', reason: null, since: 42, server: null }]);
  });
});
