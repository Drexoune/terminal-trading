// Agenda (E2) : jours et heures à Paris à travers les changements d'heure,
// états des lignes, filtres, semaines et mise en forme des valeurs.
import { describe, expect, it } from 'vitest';
import {
  actualReason, applyFilters, countdown, dayLabel, daysUntil, fmtValue, groupByDay, impactLevel, parisDay,
  parisOffsetLabel, rowState, shiftWeek, timeLabel, weekRangeLabel, type CalendarEvent,
} from './calendar';

const ms = (iso: string) => Date.parse(iso);

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'x', title: 'CPI m/m', title_fr: 'IPC (m/m)', indicator: 'us-cpi-mm', capture: true, currency: 'USD', impact: 'High',
    ny_date: '2026-12-10', time_ms: ms('2026-12-10T13:30:00Z'), time_source: 'BLS', time_kind: 'officielle',
    ff_time_ms: ms('2026-12-10T13:30:00Z'), time_mismatch: false, official: { local_time: '08:30', tz: 'America/New_York' },
    forecast_raw: '0.3%', forecast: '0.3', previous_raw: '0.2%', previous: '0.2', unit: '%', actual: null, series: '78-us-cpi-mm',
    ...over,
  };
}

describe('heures de Paris', () => {
  it('08:30 New York = 14:30 Paris en hiver, 14:30 aussi en été, 13:30 entre les deux changements d’heure', () => {
    expect(timeLabel(ev())).toBe('14:30');
    expect(timeLabel(ev({ time_ms: ms('2026-07-15T12:30:00Z') }))).toBe('14:30');
    // Du 25/10 au 01/11/2026, Paris est passé à l'heure d'hiver, New York pas encore.
    expect(timeLabel(ev({ time_ms: ms('2026-10-30T12:30:00Z') }))).toBe('13:30');
    expect(parisOffsetLabel(ms('2026-12-10T12:00:00Z'))).toBe('UTC+1');
    expect(parisOffsetLabel(ms('2026-10-20T12:00:00Z'))).toBe('UTC+2');
  });

  it('jour de Paris : un événement de 23:50 UTC tombe le lendemain à Paris', () => {
    expect(parisDay(ev({ time_ms: ms('2026-11-15T23:50:00Z'), ny_date: '2026-11-15' }))).toBe('2026-11-16');
    expect(parisDay(ev({ time_ms: null, ny_date: '2026-11-18', time_kind: 'Tentative' }))).toBe('2026-11-18');
    expect(timeLabel(ev({ time_ms: null, time_kind: 'Tentative' }))).toBe('Non fixée');
    expect(timeLabel(ev({ time_ms: null, time_kind: 'All Day' }))).toBe('Journée');
    expect(dayLabel('2026-11-16')).toBe('lundi 16 novembre');
  });

  it('regroupement par jour, dans l’ordre', () => {
    const g = groupByDay([
      ev({ id: 'b', time_ms: ms('2026-11-17T15:00:00Z') }), ev({ id: 'a', time_ms: ms('2026-11-17T13:30:00Z') }),
      ev({ id: 'c', time_ms: ms('2026-11-16T09:00:00Z') }),
    ]);
    expect(g.map((x) => [x.day, x.events.map((e) => e.id)])).toEqual([['2026-11-16', ['c']], ['2026-11-17', ['a', 'b']]]);
  });
});

describe('états', () => {
  const t = ms('2026-12-10T13:30:00Z');
  it('à venir, en attente (compte à rebours), nouveau, passé', () => {
    expect(rowState(ev(), t - 2 * 3_600_000)).toEqual({ kind: 'upcoming' });
    expect(rowState(ev(), t - 23 * 60_000 - 56_000)).toEqual({ kind: 'pending', remainingMs: 23 * 60_000 + 56_000 });
    expect(countdown(23 * 60_000 + 56_000)).toBe('00:23:56');
    expect(rowState(ev(), t + 60_000)).toEqual({ kind: 'past' });
    expect(rowState(ev({ actual: '0.4' }), t + 60_000)).toEqual({ kind: 'new' });
    expect(rowState(ev({ actual: '0.4' }), t + 16 * 60_000)).toEqual({ kind: 'past' });
  });

  it('raison d’un réel absent', () => {
    expect(actualReason(ev(), t - 1)).toBe('pas encore publié');
    expect(actualReason(ev(), t + 1)).toMatch(/E3/);
    expect(actualReason(ev({ capture: false }), t + 1)).toMatch(/ForexFactory ne publie pas le réel/);
  });

  it('jours restants', () => {
    expect(daysUntil('2026-12-10', ms('2026-12-07T10:00:00Z'))).toBe('J-3');
    expect(daysUntil('2026-12-08', ms('2026-12-07T23:30:00Z'))).toBe('Aujourd’hui');   // 00:30 à Paris
    expect(daysUntil('2026-12-08', ms('2026-12-07T10:00:00Z'))).toBe('Demain');
  });
});

describe('valeurs, filtres, semaines', () => {
  it('valeurs à la française', () => {
    expect(fmtValue('0.4', '%', '0.4%')).toBe('0,4\u00a0%');
    expect(fmtValue('-0.90', 'T', '-0.90T')).toBe('−0,90\u00a0T');
    expect(fmtValue('198', 'K', '198K')).toBe('198\u00a0k');
    expect(fmtValue(null, null, null)).toBe('—');
    expect(fmtValue(null, null, '<0.1%')).toBe('<0.1%');
    expect(impactLevel('High')).toBe(3);
  });

  it('filtres devise, impact, recherche (VO et français)', () => {
    const evs = [ev({ id: '1' }), ev({ id: '2', currency: 'EUR', title: 'German ZEW', title_fr: null, impact: 'Medium' }),
      ev({ id: '3', impact: 'Low', title: 'Bank Holiday', title_fr: null })];
    const all = { currencies: new Set(['USD', 'EUR']), impacts: new Set(['High', 'Medium', 'Low']), query: '' };
    expect(applyFilters(evs, all).map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(applyFilters(evs, { ...all, currencies: new Set(['EUR']) }).map((e) => e.id)).toEqual(['2']);
    expect(applyFilters(evs, { ...all, impacts: new Set(['High']) }).map((e) => e.id)).toEqual(['1']);
    expect(applyFilters(evs, { ...all, query: 'ipc' }).map((e) => e.id)).toEqual(['1']);
    expect(applyFilters(evs, { ...all, query: 'zew' }).map((e) => e.id)).toEqual(['2']);
  });

  it('semaines ISO et libellé', () => {
    expect(shiftWeek('2026-W47', 1)).toBe('2026-W48');
    expect(shiftWeek('2026-W47', -1)).toBe('2026-W46');
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
    expect(shiftWeek('2027-W01', -1)).toBe('2026-W53');
    expect(weekRangeLabel('2026-11-15', '2026-11-21')).toBe('15 – 21 nov. 2026');
    expect(weekRangeLabel('2026-11-29', '2026-12-05')).toBe('29 nov. – 5 déc. 2026');
  });
});
