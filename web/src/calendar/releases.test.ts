import { describe, expect, it } from 'vitest';
import { NBSP } from '../lib/format';
import type { CalendarEvent } from './calendar';
import {
  bannerVisible, BANNER_MS, captureLabel, changeTone, figureFor, figureIndex, figures, fmtChangePct, fmtDelay, fmtFigure,
  fmtSignedText, pickReaction, reactionCaption, reactionPoints, reactions, revisionText, surpriseText,
  type Reaction, type ReleaseFigure, type ReleaseLast,
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
    const last = { bus_ms: T, scheduled_ms: T - 2000 } as ReleaseLast;
    expect(bannerVisible(last, T + 1000)).toBe(true);
    expect(bannerVisible(last, T + BANNER_MS)).toBe(false);
    expect(bannerVisible(undefined, T)).toBe(false);
    // Rattrapage d'une publication d'il y a 10 jours, relue au démarrage : pas de bandeau.
    expect(bannerVisible({ ...last, scheduled_ms: T - 10 * 86_400_000 }, T + 1000)).toBe(false);
  });
});

// --- E3 : rattrapage, révisions, réaction du BTC --------------------------------------

function reaction(over: Partial<Reaction> = {}): Reaction {
  return {
    release: 'prod2', title: 'Productivity and Costs', indicators: ['us-prod-qq', 'us-ulc-qq'],
    ny_date: '2026-12-08', scheduled_ms: T, inst: 'BTC-USDT-SWAP', source: 'OKX EEA REST',
    candles: [{ t: T - 60_000, o: 1, h: 1, l: 1, c: 100 }, { t: T, o: 1, h: 1, l: 1, c: 99 }],
    ref_price: '100', end_price: '99.08', change_pct: '-0.92', missing: [], reason: null,
    received_ms: T + 31 * 60_000, ...over,
  };
}

describe('rattrapage et révisions', () => {
  it('un rattrapage ne prétend mesurer aucun délai', () => {
    expect(captureLabel(fig())).toBe(`capté 2,12${NBSP}s`);
    expect(captureLabel(fig({ nature: 'rattrapage', capture_delay_ms: null }))).toMatch(/^rattrapé : communiqué relu/);
    expect(captureLabel(fig({ nature: 'rattrapage API' }))).toMatch(/recalculé depuis l’API v1/);
    // PPI sous-jacent : vide à l'heure H, complété par l'API (08/12/2026 13:45 UTC = 14:45 Paris).
    expect(captureLabel(fig({ value: '0.3', filled_ms: T + 15 * 60_000 }))).toBe('complété par l’API v1 du BLS à 14:45 (recalculé, absent du communiqué résumé)');
  });

  it('la dernière révision est affichée avec sa source, la première publication reste', () => {
    expect(revisionText(fig())).toBeNull();
    const seen = Date.UTC(2027, 1, 4, 14, 30);
    const r = { kind: 'révision', previous: '4.1', value: '4.4', source: 'BLS API v1', series: 'PRS85006092', excerpt: null, seen_ms: seen };
    expect(revisionText(fig({ revisions: [r] }))).toBe(`révisé à 4,4${NBSP}% (API v1 du BLS, lu le 04/02/2027)`);
    expect(revisionText(fig({ revisions: [r, { ...r, value: '-0.2' }] }))).toContain(`révisé à −0,2${NBSP}%`);
    expect(revisionText(fig({ revisions: [{ ...r, kind: 'écart' }] }))).toMatch(/^écart à vérifier/);
  });
});

describe('réaction du BTC', () => {
  it('choisit la publication du jour, sinon la dernière de l’indicateur', () => {
    const old = reaction({ ny_date: '2026-11-05', scheduled_ms: T - 33 * 86_400_000, change_pct: '0.10' });
    const all = reactions([['reaction:prod2:2026-11-05', old], ['reaction:prod2:2026-12-08', reaction()], ['release:x', {}]]);
    expect(all).toHaveLength(2);
    expect(pickReaction(ev(), all).reaction?.ny_date).toBe('2026-12-08');
    expect(pickReaction(ev({ ny_date: '2026-11-20' }), all).reaction?.ny_date).toBe('2026-11-05');
    expect(pickReaction(ev({ indicator: 'us-ulc-qq' }), all).reaction?.ny_date).toBe('2026-12-08');
    expect(pickReaction(ev({ ny_date: '2026-10-01' }), all).reaction).toBeNull();
    expect(pickReaction(ev({ capture: false, indicator: null }), all).reason).toMatch(/seulement pour les publications suivies/);
    expect(pickReaction(null, all).reason).toBe('Sélectionner un événement.');
  });

  it('variation signée à la française, couleur selon le sens', () => {
    expect(fmtChangePct('-0.92')).toBe(`−0,92${NBSP}%`);
    expect(fmtChangePct('1.05')).toBe(`+1,05${NBSP}%`);
    expect(fmtChangePct(null)).toBe('—');
    expect([changeTone('-0.92'), changeTone('0.00'), changeTone('0.4'), changeTone(null)]).toEqual(['down', null, 'up', null]);
  });

  it('légende à l’heure de Paris, points à la clôture de chaque bougie', () => {
    // 08/12/2026 13:30 UTC = 14:30 Paris (heure d'hiver) : de 14:25 à 15:00.
    expect(reactionCaption(reaction())).toBe('BTC-USDT perp OKX EEA REST, du 08/12/2026 14:25 au 15:00 (heure de Paris)');
    expect(reactionPoints(reaction())).toEqual([{ x: 0, y: 100 }, { x: 1, y: 99 }]);
  });
});
