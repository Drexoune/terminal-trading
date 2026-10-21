import { describe, expect, it } from 'vitest';
import { ClockSync, RollingMedian, bestSample, freshness, legs, pingSample } from './latency';

describe('synchronisation d’horloge navigateur ↔ passerelle', () => {
  it('retrouve l’écart quand le trajet est symétrique', () => {
    // navigateur en retard de 500 ms ; aller 20 ms, retour 20 ms
    const s = pingSample(1_000, 1_000 + 20 + 500, 1_040);
    expect(s.rttMs).toBe(40);
    expect(s.offsetMs).toBe(500);
  });

  it('garde l’échantillon au plus court aller-retour', () => {
    const c = new ClockSync();
    c.add({ offsetMs: 900, rttMs: 800 });
    c.add({ offsetMs: 510, rttMs: 30 });
    c.add({ offsetMs: 300, rttMs: 400 });
    expect(c.best?.offsetMs).toBe(510);
    expect(c.toGateway(1_000)).toBe(1_510);
  });

  it('meilleur échantillon d’une série, sans aller-retour négatif', () => {
    expect(bestSample([])).toBeNull();
    expect(bestSample([{ offsetMs: 9, rttMs: -1 }])).toBeNull();
    expect(bestSample([{ offsetMs: 1, rttMs: 90 }, { offsetMs: 2, rttMs: 12 }, { offsetMs: 3, rttMs: 40 }]))
      .toEqual({ offsetMs: 2, rttMs: 12 });
  });

  it('ignore un aller-retour négatif (horloge qui recule)', () => {
    const c = new ClockSync();
    c.add({ offsetMs: 1, rttMs: -5 });
    expect(c.best).toBeNull();
  });
});

describe('latence de bout en bout', () => {
  it('découpe le trajet OKX → passerelle → écran', () => {
    expect(legs(1_000, 1_116, 1_160)).toEqual({ okxToGateway: 116, gatewayToScreen: 44, total: 160 });
  });

  it('médiane glissante', () => {
    const m = new RollingMedian(3);
    [10, 500, 20, 30].forEach((v) => m.push(v));
    expect(m.value).toBe(30);
    expect(m.count).toBe(3);
  });
});

describe('fraîcheur d’un flux', () => {
  it('suit les seuils du design system', () => {
    expect(freshness(500, true)).toBe('live');
    expect(freshness(2_500, true)).toBe('late');
    expect(freshness(20_000, true)).toBe('stale');
    expect(freshness(100, false)).toBe('down');
  });
});
