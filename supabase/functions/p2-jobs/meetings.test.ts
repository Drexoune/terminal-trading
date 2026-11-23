// @vitest-environment node
// Calendriers des réunions (R0) : forme des dates, ordre, prochaine réunion, accord avec les marchés.
import { describe, expect, it } from 'vitest';
import { BANKS, CALENDARS, nextMeeting } from './meetings.ts';

describe('calendriers des réunions', () => {
  it('8 banques, dates valides, croissantes, sans doublon, avec leur source', () => {
    expect(BANKS).toEqual(['FED', 'BCE', 'BOE', 'BOJ', 'BNS', 'BOC', 'RBA', 'RBNZ']);
    for (const b of BANKS) {
      const c = CALENDARS[b];
      expect(c.dates.length, b).toBeGreaterThan(2);
      for (const d of c.dates) expect(Number.isNaN(Date.parse(`${d}T12:00:00Z`)), `${b} ${d}`).toBe(false);
      expect([...c.dates].sort(), b).toEqual(c.dates);
      expect(new Set(c.dates).size, b).toBe(c.dates.length);
      expect(c.url, b).toMatch(/^https:\/\//);
      expect(c.until! >= c.dates[c.dates.length - 1] || c.until === null, b).toBe(true);
    }
    expect(CALENDARS.RBNZ.source).toBe('marchés');
  });

  it('prochaine réunion au 23/11/2026, conforme aux contrats relevés le même jour', () => {
    // Fin des événements Polymarket (jour de l'annonce, heure locale) relevée par scripts/explore_rates.py.
    expect(Object.fromEntries(BANKS.map((b) => [b, nextMeeting(b, '2026-11-23')]))).toEqual({
      FED: '2026-12-09', BCE: '2026-12-17', BOE: '2026-12-17', BOJ: '2026-12-18', BNS: '2026-12-10', BOC: '2026-12-09',
      RBA: '2026-12-08', RBNZ: '2026-12-09' });
    expect(nextMeeting('BOC', '2027-08-01')).toBeNull();     // au-delà de la liste publiée : « — », jamais une date devinée
  });
});
