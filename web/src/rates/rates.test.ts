// Écran Taux (R3) : formats français, axe des taux, issues montrées, principale alternative, votes.
import { describe, expect, it } from 'vitest';
import {
  daysTo, fmtCountdown, fmtDate, fmtMonthYear, fmtMove, fmtProb, fmtRate, mainAlternative, rateAxis, seriesPath, shownOutcomes,
  voteSummary, type Meeting, type Quote,
} from './rates';

const q = (p: number): Quote => ({ p, bid: p, ask: p, last: p, wide: false, vol24: null });
const meeting = (pm: Record<string, number>, kalshi?: Record<string, number>): Meeting => ({
  date: '2026-12-09', days: 16, gap: null,
  sources: {
    polymarket: { probs: Object.fromEntries(Object.entries(pm).map(([o, p]) => [o, q(p)])) },
    ...(kalshi ? { kalshi: { probs: Object.fromEntries(Object.entries(kalshi).map(([o, p]) => [o, q(p)])) } } : {}),
    futures: { missing: 'aucun flux gratuit' },
  },
});

describe('formats', () => {
  it('fr-FR : virgule, espace insécable, signe moins', () => {
    expect(fmtRate(4)).toBe('4,00\u00a0%');
    expect(fmtProb(0.865)).toBe('86,5');
    expect(fmtProb(null)).toBe('—');
    expect(fmtMove(-25)).toBe('−25\u00a0pb');
    expect(fmtMove(0)).toBe('Statu quo');
    expect(fmtMove(3.2)).toBe('+3,2\u00a0pb');
    expect(fmtDate('2026-12-09')).toBe('09/12/2026');
    expect(fmtMonthYear('2027-01-27')).toBe('JANV. 27');
    expect(fmtMonthYear('2026-12-09')).toBe('DÉC. 26');
  });
  it('J-n dans le fuseau de la banque', () => {
    const now = Date.UTC(2026, 10, 23, 21);   // 22:00 à Paris, déjà le 24 à Auckland
    expect(daysTo('2026-12-09', 'America/New_York', now)).toBe(16);
    expect(daysTo('2026-12-09', 'Pacific/Auckland', now)).toBe(15);
    expect(fmtCountdown(0)).toBe('aujourd’hui');
    expect(fmtCountdown(16)).toBe('J-16');
  });
});

describe('axes et séries', () => {
  it('axe des taux : marge d’un quart de l’étendue, repères à 0,25', () => {
    const a = rateAxis([4, 4.03, 4.45, 4.42]);
    expect(a.ticks).toEqual([4, 4.25, 4.5]);
    expect(a.min).toBeLessThan(4);
    expect(rateAxis([0, 0]).ticks).toEqual([0]);
  });
  it('série : coordonnées 0–1000, points hors fenêtre écartés', () => {
    expect(seriesPath([{ t: 0, p: 1 }, { t: 50, p: 0.5 }, { t: 200, p: 0 }], 0, 100, 220)).toBe('M0.0 0.0L500.0 110.0');
  });
});

describe('prochaine réunion', () => {
  it('±50 pb montrés dès 2 % chez une source ; principale alternative', () => {
    expect(shownOutcomes(meeting({ m50: 0.001, m25: 0.002, hold: 0.03, p25: 0.93, p50: 0.035 }))).toEqual(['m25', 'hold', 'p25', 'p50']);
    expect(shownOutcomes(meeting({ hold: 0.9 }, { m50: 0.03 }))).toEqual(['m50', 'm25', 'hold', 'p25']);
    expect(mainAlternative(meeting({ m25: 0.3, hold: 0.6, p25: 0.1 }))).toBe('m25');
    expect(mainAlternative(null)).toBe('p25');
  });
});

describe('votes', () => {
  it('nominatif, unanimité, non publié, consensus, non nominatif', () => {
    expect(voteSummary({ kind: 'nominatif', for: 10, against: 2, dissents: [{ name: 'A', preferred: 'hausse' }, { name: 'B', preferred: 'hausse' }] }))
      .toBe('10–2 · 2 pour une hausse');
    expect(voteSummary({ kind: 'nominatif', for: 9, against: 0 })).toBe('9–0 · unanimité');
    expect(voteSummary({ kind: 'nominatif', for: 7, against: 2, dissents: [{ name: 'A', preferred: 'hausse' }, { name: 'B', preferred: 'baisse' }] }))
      .toBe('7–2 · 2');
    expect(voteSummary({ kind: 'non publié' })).toBe('Non publié');
    expect(voteSummary({ kind: 'consensus' })).toBe('Consensus · non publié');
    expect(voteSummary({ kind: 'non nominatif' })).toBe('Vote non nominatif');
    expect(voteSummary({ kind: 'nominatif', unanimous: true })).toBe('Unanimité');
    expect(voteSummary({ kind: 'lien', note: 'Vote nominatif dans le communiqué (PDF)' })).toBe('Vote nominatif dans le communiqué (PDF)');
    expect(voteSummary(null)).toBe('—');
  });
});
