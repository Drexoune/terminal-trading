import { describe, expect, it } from 'vitest';
import {
  MARKETS, currentSession, fmtHm, isMarketOpen, sessionBands, tzOffsetMs, zonedToUtc,
} from './time';

const utc = (s: string) => Date.parse(`${s}Z`);
const H = 3_600_000;
const market = (code: string) => MARKETS.find((m) => m.code === code)!;

describe('horloges à travers les changements d’heure', () => {
  it('Paris passe à l’heure d’hiver le 25/10/2026 à 01:00 UTC', () => {
    expect(fmtHm(utc('2026-10-25T00:30:00'), 'Europe/Paris')).toBe('02:30'); // CEST
    expect(fmtHm(utc('2026-10-25T01:30:00'), 'Europe/Paris')).toBe('02:30'); // CET
    expect(tzOffsetMs(utc('2026-10-24T12:00:00'), 'Europe/Paris')).toBe(2 * H);
    expect(tzOffsetMs(utc('2026-10-26T12:00:00'), 'Europe/Paris')).toBe(1 * H);
  });

  it('Londres passe de BST à GMT le même jour', () => {
    expect(fmtHm(utc('2026-10-24T13:36:00'), 'Europe/London')).toBe('14:36');
    expect(fmtHm(utc('2026-10-26T13:36:00'), 'Europe/London')).toBe('13:36');
  });

  it('New York ne change d’heure que le 01/11/2026 à 06:00 UTC', () => {
    expect(fmtHm(utc('2026-10-26T13:36:00'), 'America/New_York')).toBe('09:36'); // EDT
    expect(fmtHm(utc('2026-11-01T05:30:00'), 'America/New_York')).toBe('01:30'); // EDT
    expect(fmtHm(utc('2026-11-01T06:30:00'), 'America/New_York')).toBe('01:30'); // EST
    expect(fmtHm(utc('2026-11-02T13:36:00'), 'America/New_York')).toBe('08:36');
  });

  it('Tokyo ne change jamais d’heure', () => {
    expect(fmtHm(utc('2026-10-20T13:36:00'), 'Asia/Tokyo')).toBe('22:36');
    expect(fmtHm(utc('2026-11-02T13:36:00'), 'Asia/Tokyo')).toBe('22:36');
  });

  it('reproduit les horloges de la maquette (20/10/2026 13:36 UTC)', () => {
    const t = utc('2026-10-20T13:36:04');
    expect(['Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York']
      .map((tz) => fmtHm(t, tz))).toEqual(['22:36', '14:36', '15:36', '09:36']);
  });
});

describe('marchés ouverts', () => {
  it('à 13:36 UTC le 20/10/2026 : Tokyo fermé, Londres, Paris et New York ouverts', () => {
    const t = utc('2026-10-20T13:36:04');
    expect(MARKETS.map((m) => isMarketOpen(m, t))).toEqual([false, true, true, true]);
  });

  it('New York ouvre à 13:30 UTC avant le 01/11 et à 14:30 UTC après', () => {
    expect(isMarketOpen(market('NY'), utc('2026-10-30T13:31:00'))).toBe(true);
    expect(isMarketOpen(market('NY'), utc('2026-11-02T13:31:00'))).toBe(false);
    expect(isMarketOpen(market('NY'), utc('2026-11-02T14:31:00'))).toBe(true);
  });

  it('Londres ouvre à 07:00 UTC avant le 25/10 et à 08:00 UTC après', () => {
    expect(isMarketOpen(market('LON'), utc('2026-10-23T07:10:00'))).toBe(true);
    expect(isMarketOpen(market('LON'), utc('2026-10-26T07:10:00'))).toBe(false);
  });

  it('pause de midi à Tokyo et fermeture le week-end', () => {
    expect(isMarketOpen(market('TOK'), utc('2026-10-20T03:00:00'))).toBe(false); // 12:00 JST
    expect(isMarketOpen(market('TOK'), utc('2026-10-20T04:00:00'))).toBe(true); // 13:00 JST
    expect(isMarketOpen(market('PAR'), utc('2026-10-24T10:00:00'))).toBe(false); // samedi
  });
});

describe('bandes de session', () => {
  const day = (s: string) => {
    const from = utc(`${s}T00:00:00`);
    return Object.fromEntries(sessionBands(from, from + 24 * H)
      .map((b) => [b.id, [(b.from - from) / H, (b.to - from) / H]]));
  };

  it('20/10/2026 : identiques à la maquette (Asie 0–6, Londres 7–15,5, NY 13,5–20 UTC)', () => {
    expect(day('2026-10-20')).toEqual({ asia: [0, 6], london: [7, 15.5], ny: [13.5, 20] });
  });

  it('semaine du 26/10/2026 : Londres recule d’une heure, New York pas encore', () => {
    expect(day('2026-10-26')).toEqual({ asia: [0, 6], london: [8, 16.5], ny: [13.5, 20] });
  });

  it('à partir du 02/11/2026 : New York recule aussi', () => {
    expect(day('2026-11-02')).toEqual({ asia: [0, 6], london: [8, 16.5], ny: [14.5, 21] });
  });

  it('pas de bande le week-end', () => {
    expect(day('2026-10-24')).toEqual({});
  });

  it('session courante', () => {
    expect(currentSession(utc('2026-10-20T13:36:00'))?.id).toBe('ny');
    expect(currentSession(utc('2026-10-20T10:00:00'))?.id).toBe('london');
    expect(currentSession(utc('2026-10-20T22:00:00'))).toBeNull();
  });

  it('zonedToUtc gère l’heure du changement', () => {
    expect(zonedToUtc(2026, 10, 26, '08:00', 'Europe/London')).toBe(utc('2026-10-26T08:00:00'));
    expect(zonedToUtc(2026, 10, 23, '08:00', 'Europe/London')).toBe(utc('2026-10-23T07:00:00'));
  });
});
