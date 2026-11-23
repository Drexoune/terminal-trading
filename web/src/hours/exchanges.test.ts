import { describe, expect, it } from 'vitest';
import { countdown, exchange, EXCHANGES, marketStatus, sessionsOn, upcomingClosures } from './exchanges';

const utc = (s: string) => Date.parse(`${s}Z`);

describe('horaires des marchés', () => {
  it('Tokyo fermé le 23/11/2026 (fête du travail) ; ouverture suivante le 24 à 09:00', () => {
    const s = marketStatus(exchange('TOK'), utc('2026-11-23T02:00:00'));   // 11:00 à Tokyo, un lundi
    expect(s).toMatchObject({ state: 'férié', holiday: 'Fête du travail' });
    expect(new Date(s.next!.at).toISOString()).toBe('2026-11-24T00:00:00.000Z');
  });

  it('Tokyo : pause de midi, puis clôture à 15:30', () => {
    expect(marketStatus(exchange('TOK'), utc('2026-11-24T02:45:00')).state).toBe('pause');      // 11:45
    const s = marketStatus(exchange('TOK'), utc('2026-11-24T04:00:00'));                         // 13:00
    expect(s).toMatchObject({ state: 'ouvert', next: { kind: 'clôture', at: utc('2026-11-24T06:30:00') } });
  });

  it('New York : Thanksgiving fermé, lendemain écourté à 13:00, puis week-end', () => {
    expect(marketStatus(exchange('NY'), utc('2026-11-26T16:00:00')).state).toBe('férié');
    const fri = marketStatus(exchange('NY'), utc('2026-11-27T15:00:00'));                         // 10:00 à New York
    expect(fri).toMatchObject({ state: 'ouvert', early: true, earlyTimeKnown: true, next: { kind: 'clôture', at: utc('2026-11-27T18:00:00') } });
    const sat = marketStatus(exchange('NY'), utc('2026-11-28T15:00:00'));
    expect(sat.state).toBe('week-end');
    expect(sat.next).toEqual({ kind: 'ouverture', at: utc('2026-11-30T14:30:00') });
  });

  it('Paris : demi-séance à heure non publiée signalée, jamais inventée', () => {
    const s = marketStatus(exchange('PAR'), utc('2026-12-24T09:00:00'));
    expect(s).toMatchObject({ state: 'ouvert', early: true, earlyTimeKnown: false });
    expect(sessionsOn(exchange('PAR'), '2026-12-25')).toEqual([]);
  });

  it('heure d’été : Londres ouvre à 08:00 locale, 07:00 UTC en juin', () => {
    expect(sessionsOn(exchange('LON'), '2027-06-15')[0][0]).toBe(utc('2027-06-15T07:00:00'));
    expect(sessionsOn(exchange('LON'), '2026-12-15')[0][0]).toBe(utc('2026-12-15T08:00:00'));
  });

  it('crypto en continu ; Hong Kong sans jours fériés relevés', () => {
    expect(marketStatus(exchange('CRYPTO'), 0).state).toBe('continu');
    expect(exchange('HKG').holidays).toBeNull();
    expect(EXCHANGES.map((e) => e.code)).toEqual(['TOK', 'HKG', 'SYD', 'LON', 'PAR', 'NY', 'CRYPTO']);
  });

  it('prochaines fermetures et compte à rebours', () => {
    const c = upcomingClosures(utc('2026-11-23T12:00:00'), 4);
    expect(c.map((x) => `${x.day} ${x.code} ${x.kind}`)).toEqual([
      '2026-11-23 TOK férié', '2026-11-26 NY férié', '2026-11-27 NY écourtée', '2026-12-24 LON écourtée']);
    expect(countdown(35 * 60_000)).toBe('35 min');
    expect(countdown(134 * 60_000)).toBe('2 h 14');
    expect(countdown(76 * 3_600_000)).toBe('3 j 4 h');
  });
});
