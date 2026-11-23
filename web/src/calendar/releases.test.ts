import { describe, expect, it } from 'vitest';
import { NBSP } from '../lib/format';
import type { CalendarEvent } from './calendar';
import {
  bannerVisible, BANNER_MS, figureFor, figureIndex, figures, fmtDelay, fmtFigure, fmtSignedText, surpriseText,
  type ReleaseFigure, type ReleaseLast,
} from './releases';

const T = Date.UTC(2026, 11, 8, 13, 30);

function fig(over: Partial<ReleaseFigure> = {}): ReleaseFigure {
  return {
    indicator: 'us-prod-qq', label_fr: 'Productivité non agricole (t/t)', unit: '%', release: 'prod2',
    period: '2026-Q3', edition: 'Revised', ny_date: '2026-12-08', value: '4.1', reason: null, part: 'texte',
    excerpt: 'Nonfarm business sector labor productivity increased 4.1 percent…', flags: [], timing: 'attendue',
    nature: 'officielle', source: 'BLS', url: 'https://www.bls.gov/news.release/prod2.nr0.htm', machine: 'mac',
    scheduled_ms: T, embargo_ms: T, first_byte_ms: T + 2130, received_ms: T + 2170, capture_delay_ms: 2118,
    clock_corrected: true, bus_ms: T + 2180, forecast: '4.0', forecast_raw: '4.0%', forecast_age_ms: 2_700_000,
    surprise: '0.1', z: null, z_n: 0, z_provisional: false, z_reason: 'historique insuffisant (0/8)',
    regular: true, display_ms: null, ...over,
  };
}

const ev = (over: Partial<CalendarEvent> = {}) => ({
  id: 'x', title: 'Revised Nonfarm Productivity q/q', title_fr: null, indicator: 'us-prod-qq', capture: true,
  currency: 'USD', impact: 'Low', ny_date: '2026-12-08', time_ms: T, time_source: 'BLS', time_kind: 'officielle',
  ff_time_ms: T, time_mismatch: false, official: null, forecast_raw: '4.0%', forecast: '4.0', previous_raw: '3.6%',
  previous: '3.6', unit: '%', actual: null, series: null, ...over,
}) as CalendarEvent;

describe('chiffres captés', () => {
  it('ne garde que les clés qui portent un chiffre', () => {
    const out = figures([['release:last', { keys: [] }], ['release:state', { phase: 'attente' }],
      ['release:us-prod-qq:2026-Q3:Revised', fig()]]);
    expect(out.map(([k]) => k)).toEqual(['release:us-prod-qq:2026-Q3:Revised']);
  });

  it('associe un événement à son chiffre par indicateur et jour de New York', () => {
    const index = figureIndex([['a', fig()], ['b', fig({ indicator: 'us-ulc-qq', value: '-0.7' })]]);
    expect(figureFor(ev(), index)?.value).toBe('4.1');
    expect(figureFor(ev({ ny_date: '2026-11-05' }), index)).toBeNull();
    expect(figureFor(ev({ indicator: null }), index)).toBeNull();
  });

  it('formate le chiffre au format fr-FR', () => {
    expect(fmtFigure(fig({ value: '-0.7' }))).toBe(`−0,7${NBSP}%`);
    expect(fmtFigure(fig({ value: '165', unit: 'K' }))).toBe(`165${NBSP}k`);
    expect(fmtFigure(fig({ value: null, reason: 'x' }))).toBe('—');
  });

  it('signe explicite, moins typographique, zéro sans signe', () => {
    expect(fmtSignedText('0.1')).toBe('+0,1');
    expect(fmtSignedText('-0.15')).toBe('−0,15');
    expect(fmtSignedText('0.0')).toBe('0,0');
  });
});

describe('surprise', () => {
  it('brute toujours, z absent avec sa raison', () => {
    expect(surpriseText(fig())).toEqual({ text: `+0,1${NBSP}pt`, reason: 'z : historique insuffisant (0/8)', tone: null });
  });

  it('z provisoire et couleur à partir de |z| ≥ 0,25', () => {
    const s = surpriseText(fig({ z: '1.20', z_n: 9, z_provisional: true, z_reason: null }));
    expect(s.text).toBe(`+0,1${NBSP}pt · z +1,20 (provisoire, n${NBSP}=${NBSP}9)`);
    expect(s.tone).toBe('up');
    expect(surpriseText(fig({ surprise: '-0.1', z: '-0.20', z_n: 30, z_reason: null })).tone).toBeNull();
  });

  it('sans prévision ou sans chiffre : « — » et la raison', () => {
    expect(surpriseText(fig({ surprise: null })).reason).toMatch(/aucune prévision/);
    expect(surpriseText(fig({ value: null, reason: 'désaccord texte (0.5) / tableau A (0.4)' })).reason)
      .toBe('désaccord texte (0.5) / tableau A (0.4)');
  });
});

describe('délais et bandeau', () => {
  it('délai en secondes', () => {
    expect(fmtDelay(2118)).toBe(`2,12${NBSP}s`);
    expect(fmtDelay(-31 * 60_000)).toBe(`−1860,00${NBSP}s`);
    expect(fmtDelay(null)).toBe('—');
  });

  it('bandeau visible 15 minutes après la publication sur le bus', () => {
    const last = { bus_ms: T } as ReleaseLast;
    expect(bannerVisible(last, T + 1000)).toBe(true);
    expect(bannerVisible(last, T + BANNER_MS)).toBe(false);
    expect(bannerVisible(undefined, T)).toBe(false);
  });
});
