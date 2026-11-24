// @vitest-environment node
// Règles de l'écran Taux (R1) sur les réponses réelles du 23/11/2026 : issues, probabilités,
// trajectoire, écart entre sources, rattachement aux réunions officielles, BIS.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  announcementMs, daysUntil, distribution, expectedChangeBp, expectedUpperBound, kalshiOutcome, matchMeeting, maxGap,
  pathFromChanges, pathFromLevels, pickProbability, polymarketOutcome, upcomingMeetings,
} from './rates_rules.ts';
import {
  bisSeries, kalshiCandles, kalshiDecisions, kalshiFedLevels, pmBooks, pmEvents, pmHistory, pmLastTrades, pmQuote, policyFromSeries,
} from './sources.ts';
import type { Bank } from './meetings.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SEARCH = JSON.parse(fx('gamma-search-2026-11-23.json')) as Record<Bank, unknown>;

describe('issues normalisées par le texte, jamais par l’ordre', () => {
  it('Polymarket : casse variable, « 50+ » seulement avec le +', () => {
    expect(polymarketOutcome('No change')).toBe('hold');
    expect(polymarketOutcome('No Change')).toBe('hold');
    expect(polymarketOutcome('25 bps decrease')).toBe('m25');
    expect(polymarketOutcome('50+ bps increase')).toBe('p50');
    expect(polymarketOutcome('50 bps increase')).toBeNull();
    expect(polymarketOutcome('75+ bps decrease')).toBeNull();
  });
  it('Kalshi : suffixes des 5 séries, puis libellé', () => {
    expect(kalshiOutcome('KXFEDDECISION-26DEC-C26', 'Cut >25bps')).toBe('m50');
    expect(kalshiOutcome('KXCBDSWISS-26DEC10-C25', 'Cut 1-25bps')).toBe('m25');
    expect(kalshiOutcome('KXCBDECISIONJAPAN-26DEC17-HOLD', '')).toBe('hold');
    expect(kalshiOutcome('KXCBDECISIONJAPAN-26DEC17-H25P', '')).toBe('p50');
    expect(kalshiOutcome('X-Y-ZZ', 'Hike more than 25bps')).toBe('p50');
    expect(kalshiOutcome('X-Y-ZZ', 'Something else')).toBeNull();
  });
});

describe('probabilité retenue', () => {
  it('milieu si l’écart est d’au plus 10 points, sinon dernier échange marqué « fourchette large »', () => {
    expect(pickProbability(0.93, 0.94, 0.93)).toMatchObject({ p: 0.935, wide: false });
    expect(pickProbability(0.009, 0.08, 0.03)).toMatchObject({ p: 0.0445, wide: false });   // BoJ de mars (R0) : 7,1 points
    expect(pickProbability(0.2, 0.31, 0.25)).toMatchObject({ p: 0.25, wide: true });
    expect(pickProbability(null, 0.04, null)).toMatchObject({ p: null, wide: true });
  });
  it('somme contrôlée entre 95 et 105 %', () => {
    const q = (p: number) => pickProbability(p, p, null);
    expect(distribution({ hold: q(0.5), p25: q(0.4) })).toMatchObject({ total: 0.9, sum_ok: false });
    expect(distribution({ hold: q(0.5), p25: q(0.5) })).toMatchObject({ total: 1, sum_ok: true });
    expect(distribution({})).toMatchObject({ total: null, sum_ok: null });
  });
});

describe('Polymarket (réponses réelles)', () => {
  it('découverte : 8 banques, événements « décision » rattachés aux dates officielles à un jour près', () => {
    const banks: Bank[] = ['FED', 'BCE', 'BOE', 'BOJ', 'BNS', 'BOC', 'RBA', 'RBNZ'];
    const first = Object.fromEntries(banks.map((b) => {
      const evs = pmEvents(b, JSON.stringify(SEARCH[b]));
      expect(evs.every((e) => Object.keys(e.outcomes).length === 5 && e.skipped.length === 0)).toBe(true);
      return [b, evs.map((e) => e.meeting).sort()[0]];
    }));
    expect(first).toEqual({ FED: '2026-12-09', BCE: '2026-12-17', BOE: '2026-12-17', BOJ: '2026-12-18', BNS: '2026-12-10',
      BOC: '2026-12-09', RBA: '2026-12-08', RBNZ: '2026-12-09' });
    // « How many dissent… » et « Fed decisions (Sep–Dec) » écartés par le titre.
    expect(pmEvents('FED', JSON.stringify(SEARCH.FED)).map((e) => e.event_id)).toHaveLength(4);
  });

  it('carnets : maximum des achats, minimum des ventes ; dernier échange de last-trades-prices', () => {
    const fed = pmEvents('FED', JSON.stringify(SEARCH.FED)).find((e) => e.meeting === '2026-12-09')!;
    const books = pmBooks(fx('clob-books-FED-26DEC-2026-11-23.json'));
    const last = pmLastTrades(fx('clob-last-trades-FED-26DEC-2026-11-23.json'));
    const hike = books.get(fed.outcomes.p25!.token)!;
    expect([hike.bid, hike.ask]).toEqual([0.93, 0.94]);
    const q = pmQuote(fed.outcomes, books, last);
    expect(q.probs.p25).toMatchObject({ p: 0.935, last: 0.93, wide: false });
    expect(q.probs.hold!.p).toBe(0.0325);   // (0,031 + 0,034) / 2
    expect(q.ts_source).toBe(1795468699095);
    const d = distribution(q.probs);
    expect(d.sum_ok).toBe(true);
    expect(expectedChangeBp(q.probs)).toBeGreaterThan(24);
  });

  it('historique : secondes -> millisecondes', () => {
    const h = pmHistory(fx('clob-history-daily-FED-26DEC-H0-2026-11-23.json'));
    expect(h.length).toBeGreaterThan(100);
    expect(h[0].t).toBe(1785456021000);
    expect(pmHistory('{"error":"x"}')).toEqual([]);
  });
});

describe('Kalshi (réponses réelles)', () => {
  it('décisions : Fed du 09/12, BoJ datée du 17 par Kalshi rattachée à l’annonce du 18', () => {
    const fed = kalshiDecisions('FED', fx('kalshi-KXFEDDECISION-open-2026-11-23.json'));
    expect(fed[0]).toMatchObject({ meeting: '2026-12-09', event_ticker: 'KXFEDDECISION-26DEC' });
    expect(fed[0].probs.p25).toMatchObject({ p: 0.935, vol24: 649035.02 });
    expect(fed[0].probs.hold!.p).toBe(0.035);
    const boj = kalshiDecisions('BOJ', fx('kalshi-KXCBDECISIONJAPAN-open-2026-11-23.json'));
    expect(boj[0].meeting).toBe('2026-12-18');
    expect(kalshiDecisions('BNS', fx('kalshi-KXCBDSWISS-open-2026-11-23.json'))[0].meeting).toBe('2026-12-10');
  });

  it('KXFED : borne haute attendue de décembre ≈ 4,25 % (hausse de 25 pb à 93 %)', () => {
    const lv = kalshiFedLevels(fx('kalshi-KXFED-open-2026-11-23.json'));
    expect(lv.map((l) => l.meeting)).toEqual(['2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28',
      '2027-09-15', '2027-10-27', null, '2028-01-26']);   // 08/12/2027 : date Kalshi absente du calendrier officiel (R0)
    const dec = expectedUpperBound(lv[0].strikes)!;
    expect(dec.truncated).toBe(false);
    expect(dec.rate).toBeGreaterThan(4.2);
    expect(dec.rate).toBeLessThan(4.3);
  });

  it('bougies : milieu de la clôture, sinon dernier prix', () => {
    const c = kalshiCandles(fx('kalshi-candles-KXFEDDECISION-26DEC-H0-2026-11-23.json'));
    expect(c).toHaveLength(48);
    expect(c[c.length - 1]).toEqual({ t: 1795456800000, p: 0.025 });
  });
});

describe('trajectoire et écart', () => {
  it('borne haute : probabilités rendues décroissantes, queue basse signalée', () => {
    expect(expectedUpperBound([{ k: 3.75, p: 1 }, { k: 4, p: 0.5 }, { k: 4.25, p: 0.6 }])).toEqual({ rate: 4.25, truncated: false });
    expect(expectedUpperBound([{ k: 4, p: 0.5 }, { k: 4.25, p: 0 }])!.truncated).toBe(true);
    expect(expectedUpperBound([{ k: 4, p: 1 }])).toBeNull();
  });
  it('niveaux -> variations ; variations -> niveaux, arrêt au premier trou', () => {
    expect(pathFromLevels(4, [{ meeting: 'a', rate: 4.25 }, { meeting: 'b', rate: 4.2 }]))
      .toEqual([{ meeting: 'a', rate: 4.25, delta_bp: 25 }, { meeting: 'b', rate: 4.2, delta_bp: -5 }]);
    expect(pathFromChanges(2.5, [{ meeting: 'a', delta_bp: 10 }, { meeting: 'b', delta_bp: null }, { meeting: 'c', delta_bp: 5 }]))
      .toEqual([{ meeting: 'a', rate: 2.6, delta_bp: 10 }]);
  });
  it('écart maximal entre sources, en points', () => {
    const q = (p: number) => pickProbability(p, p, null);
    expect(maxGap({ polymarket: { hold: q(0.033), p25: q(0.935) }, kalshi: { hold: q(0.035), p25: q(0.91) } }))
      .toEqual({ pts: 2.5, outcome: 'p25', sources: ['polymarket', 'kalshi'] });
    expect(maxGap({ polymarket: { hold: q(0.5) } })).toBeNull();
  });
});

describe('réunions', () => {
  it('date de fin hors du calendrier : rien plutôt qu’une mauvaise réunion', () => {
    expect(matchMeeting('FED', '2027-12-08T19:00:00Z')).toBeNull();
    expect(matchMeeting('BOC', '2026-12-09T00:00:00Z')).toBe('2026-12-09');   // 19:00 la veille à Toronto
  });
  it('une réunion reste « prochaine » jusqu’à 2 h après l’annonce, changement d’heure compris', () => {
    const at = announcementMs('FED', '2026-12-09');
    expect(new Date(at).toISOString()).toBe('2026-12-09T19:00:00.000Z');
    expect(upcomingMeetings('FED', at + 3_600_000)[0]).toBe('2026-12-09');
    expect(upcomingMeetings('FED', at + 2 * 3_600_000)[0]).toBe('2027-01-27');
    expect(new Date(announcementMs('FED', '2027-03-17')).toISOString()).toBe('2027-03-17T18:00:00.000Z');   // heure d'été à New York
    expect(daysUntil('FED', '2026-12-09', Date.UTC(2026, 10, 23, 21))).toBe(16);
    expect(daysUntil('RBNZ', '2026-12-09', Date.UTC(2026, 10, 23, 21))).toBe(15);   // déjà le 24 à Auckland
  });
});

describe('BIS', () => {
  it('dernier taux des 8 banques et dernier mouvement', () => {
    const s = bisSeries(fx('bis-cbpol-2026-11-23.csv'));
    expect(s.get('US')!.at(-1)).toEqual(['2026-11-17', 3.875]);
    expect(s.get('XM')!.at(-1)![1]).toBe(2.5);
    expect([...s.keys()].sort()).toEqual(['AU', 'CA', 'CH', 'GB', 'JP', 'NZ', 'US', 'XM']);
    expect(policyFromSeries([['2026-01-01', 4], ['2026-03-01', 4.25], ['2026-05-01', 4.25]]))
      .toEqual({ rate: 4.25, date: '2026-05-01', last_change: { date: '2026-03-01', from: 4, to: 4.25 }, since: '2026-01-01' });
    expect(policyFromSeries([['2026-01-01', 0]])!.last_change).toBeNull();
  });
});
