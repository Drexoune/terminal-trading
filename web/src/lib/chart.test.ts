import { describe, expect, it } from 'vitest';
import type { Candle } from '../data/protocol';
import { dailyVwap, downsample, logicalIndex, timeGrid, upsertCandle } from './chart';

const c = (t: number, px: number, base: number): Candle =>
  ({ t, o: px, h: px, l: px, c: px, vol_base: base, vol_quote: px * base });

describe('VWAP ancré sur la journée UTC', () => {
  it('pondère par le volume', () => {
    const v = dailyVwap([c(0, 100, 1), c(60_000, 200, 3)]);
    expect(v.map((p) => p.v)).toEqual([100, 175]);
  });

  it('repart de zéro à 00:00 UTC', () => {
    const day = 86_400_000;
    const v = dailyVwap([c(day - 60_000, 100, 10), c(day, 300, 1)]);
    expect(v[1].v).toBe(300);
  });

  it('ignore une bougie sans volume en début de journée', () => {
    expect(dailyVwap([c(0, 100, 0)])).toEqual([]);
  });
});

describe('bougies en direct', () => {
  it('met à jour la bougie en cours puis ajoute la suivante', () => {
    let s = [c(0, 1, 1)];
    s = upsertCandle(s, c(0, 2, 1));
    s = upsertCandle(s, c(60_000, 3, 1));
    expect(s.map((x) => x.c)).toEqual([2, 3]);
  });

  it('corrige une bougie ancienne sans dupliquer', () => {
    const s = upsertCandle([c(0, 1, 1), c(60_000, 2, 1)], c(0, 9, 1));
    expect(s.map((x) => x.c)).toEqual([9, 2]);
  });
});

describe('grille', () => {
  it('couvre la journée entière en minutes', () => {
    const g = timeGrid(0, 86_400_000, 60_000);
    expect(g.length).toBe(1440);
    expect(logicalIndex(13.5 * 3_600_000, 0, 60_000)).toBe(810);
  });

  it('sous-échantillonne en gardant les extrémités', () => {
    const d = downsample(Array.from({ length: 1000 }, (_, i) => i), 10);
    expect(d.length).toBe(10);
    expect(d[0]).toBe(0);
    expect(d[9]).toBe(999);
  });
});
