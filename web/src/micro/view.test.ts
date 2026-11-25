// @vitest-environment node
// Lecture de l'état pour l'écran (P5, S3) : fraîcheur d'un panneau, pastilles par plateforme,
// comptes à rebours, niveaux d'or, graduations.
import { describe, expect, it } from 'vitest';
import type { MicroFeedState } from './stream';
import { countdown, depthLevel, microFreshness, panelFresh, priceTicks, venueDots } from './view';

const feed = (name: string, label: string, p: Partial<MicroFeedState> = {}): MicroFeedState => ({
  name, label, venue: 'binance', status: 'connected', connected_since_ms: 0, last_message_ms: 1_000, reconnects: 0, outages: [],
  last_error: null, gaps: [], messages: 1, late_after_ms: 10_000, stale_after_ms: 30_000, ...p,
});

describe('fraîcheur', () => {
  it('direct, retard, périmé, coupé', () => {
    expect(microFreshness(feed('a', 'A'), 2_000)).toBe('live');
    expect(microFreshness(feed('a', 'A'), 12_000)).toBe('late');
    expect(microFreshness(feed('a', 'A'), 40_000)).toBe('stale');
    expect(microFreshness(feed('a', 'A', { status: 'reconnecting' }), 2_000)).toBe('down');
    expect(microFreshness(undefined, 0)).toBe('down');
  });
  it('panneau : un flux coupé est nommé ; plusieurs sont comptés ; heure de Paris', () => {
    const now = Date.parse('2026-11-25T14:00:05Z');
    const m = new Map([['a', feed('a', 'Binance WS (carnet)', { last_message_ms: now - 1_000 })], ['b', feed('b', 'Bybit WS', { status: 'reconnecting', last_message_ms: now - 1_000 })]]);
    expect(panelFresh(['a', 'b'], m, now)).toMatchObject({ state: 'down', text: 'Bybit WS coupé · màj 15:00:04' });
    m.set('a', feed('a', 'Binance WS (carnet)', { last_message_ms: now - 40_000 }));
    expect(panelFresh(['a', 'b'], m, now).text).toBe('2 flux coupés · màj 15:00:04');
    expect(panelFresh(['a'], new Map(), now).text).toBe('Connexion aux plateformes…');
  });
  it('barre de flux : une pastille par plateforme, état le plus dégradé, coupure en détail', () => {
    const m = new Map([['binance-book', feed('binance-book', 'Binance WS (carnet)')],
      ['binance-perp', feed('binance-perp', 'Binance WS (perp)', { status: 'reconnecting', last_error: 'connexion fermée (code 1006)', outages: [{ from_ms: 0, to_ms: 5_000, duration_ms: 5_000 }] })]]);
    const d = venueDots(m, 2_000);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ venue: 'binance', label: 'Binance WS', state: 'down' });
    expect(d[0].detail.replace(/\u00a0/g, ' ')).toMatch(/Binance WS \(perp\) : coupé · 0 reconnexion\(s\) · dernière coupure 01:00:00, 5,0 s · erreur : connexion fermée/);
  });
});

describe('affichage', () => {
  it('compte à rebours', () => {
    const sp = (x: string) => x.replace(/\u00a0/g, ' ');
    expect(sp(countdown(8_640_000 + 1_000, 1_000))).toBe('dans 2 h 24');
    expect(sp(countdown(24 * 60_000, 0))).toBe('dans 24 min');
    expect(sp(countdown(40_000, 0))).toBe('dans 40 s');
    expect(countdown(null, 0)).toBe('—');
  });
  it('niveaux d’or selon les centiles publiés', () => {
    const lv = [10, 20, 30, 40];
    expect([5, 10, 25, 35, 50].map((x) => depthLevel(x, lv))).toEqual([0, 1, 2, 3, 4]);
    expect(depthLevel(5, [])).toBe(0);
  });
  it('graduations rondes', () => {
    expect(priceTicks(59_700, 60_300, 3)).toEqual([59_800, 60_000, 60_200]);
  });
});
