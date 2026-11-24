// Mise en forme et fraîcheur des écrans de P4 ; chargement de /api/sentiment en Mode Online.
import { describe, expect, it } from 'vitest';
import { loadSentiment, SENTIMENT_STATUS_KEY } from '../data/online/sentiment';
import { getValue } from '../data/store';
import { biasOf, dateTicks, feedFresh, fmtBn, fmtFunding, fmtRaw, freshText, indexMove, monthLabel, pctTone, sentimentKey, zoneOf, type FeedState } from './sentiment';

const feed = (ago: number, now: number, status = 'connected'): FeedState => ({ name: 'closes', status, last_message_ms: now - ago, last_error: null,
  late_after_ms: 30 * 3_600_000, stale_after_ms: 54 * 3_600_000 });

describe('mise en forme', () => {
  it('zones, pastille, couleur des percentiles', () => {
    expect([10, 25, 44.9, 45, 54.9, 55, 75].map((v) => zoneOf(v).label)).toEqual(['Risk-off fort', 'Risk-off', 'Risk-off', 'Neutre', 'Neutre', 'Risk-on', 'Risk-on fort']);
    expect([30, 50, 60].map(biasOf)).toEqual(['RISK-OFF', 'NEUTRAL', 'RISK-ON']);
    expect([18, 50, 59].map(pctTone)).toEqual(['dn', 'nt', 'up']);
  });
  it('valeurs brutes au format fr-FR, signe moins typographique', () => {
    expect(fmtRaw({ id: 'vix', raw: 20, unit: 'pts' })).toBe('20,0');
    expect(fmtRaw({ id: 'trend', raw: 1.58, unit: '%' })).toBe('+1,58 %');
    expect(fmtRaw({ id: 'credit', raw: -0.9, unit: 'pts' })).toBe('−0,90 pts');
    expect(fmtRaw({ id: 'crypto', raw: null, unit: '%' })).toBe('—');
    expect(fmtBn(5_848_811)).toMatch(/^5\s849 Md\$$/);
    expect(fmtBn(-11_000, true)).toBe('−11 Md$');
    expect(fmtFunding(0.00004574)).toBe('0,0046 %');
    expect(fmtFunding(-0.0001)).toBe('−0,0100 %');
  });
  it('variation de l’indice : flèche et écart arrondi, rien sans valeur', () => {
    expect(indexMove(30, 61)).toEqual({ text: '▼ 31', dir: 'dn' });
    expect(indexMove(30.4, 17.2)).toEqual({ text: '▲ 13', dir: 'up' });
    expect(indexMove(null, 61)).toBeNull();
    expect(indexMove(30, null)).toBeNull();
  });
  it('dates : mois courts, cinq repères', () => {
    expect(monthLabel('2025-10-20')).toBe('oct. 25');
    const nine = ['2025-10', '2025-11', '2026-01', '2026-02', '2026-04', '2026-05', '2026-07', '2026-08', '2026-10'].map((m) => `${m}-01`);
    expect(dateTicks(nine)).toEqual(['oct. 25', 'janv. 26', 'avr. 26', 'juil. 26', 'oct. 26']);
    expect(dateTicks(['2026-10-01', '2026-11-01'])).toEqual(['oct. 26', 'nov. 26']);
  });
});

describe('fraîcheur', () => {
  const NOW = Date.parse('2026-11-24T21:00:00Z');   // 22:00 à Paris
  it('connecté, en retard, périmé, rien reçu', () => {
    expect(feedFresh(feed(60_000, NOW), NOW)).toBe('live');
    expect(feedFresh(feed(31 * 3_600_000, NOW), NOW)).toBe('late');
    expect(feedFresh(feed(60_000, NOW, 'reconnecting'), NOW)).toBe('late');
    expect(feedFresh(feed(55 * 3_600_000, NOW), NOW)).toBe('stale');
    expect(feedFresh(null, NOW)).toBe('down');
  });
  it('texte : heure de Paris, date si ce n’est pas aujourd’hui, « périmé »', () => {
    expect(freshText('FRED', feed(30 * 60_000, NOW), NOW)).toBe('FRED · relevé 21:30');
    expect(freshText('FRED', feed(55 * 3_600_000, NOW), NOW)).toBe('FRED · relevé 22/11 15:00 · périmé');
    expect(freshText('FRED', null, NOW)).toBe('FRED · —');
  });
});

describe('chargement en Mode Online', () => {
  it('les 5 routes sous sentiment:<route>, flux recopiés, échec d’une route visible', async () => {
    const calls: string[] = [];
    const fetcher = (async (path: string) => {
      calls.push(path);
      if (path.endsWith('/crowding')) throw new Error('HTTP 502');
      const route = path.split('/').pop();
      return { configured: true, route, computed_ms: 1, feed: { name: route === 'risk' ? 'closes' : route, status: 'connected' }, data: {},
        ...(route === 'banks' ? { bpr_feed: { name: 'banks', status: 'connected' } } : {}) };
    }) as unknown as Parameters<typeof loadSentiment>[1];
    await loadSentiment(() => 42, fetcher);
    expect(calls.sort()).toEqual(['/api/sentiment/banks', '/api/sentiment/cot', '/api/sentiment/crowding', '/api/sentiment/liquidity', '/api/sentiment/risk']);
    expect(getValue(sentimentKey('risk'))).toMatchObject({ route: 'risk' });
    expect(getValue('feed:closes')).toMatchObject({ status: 'connected' });
    expect(getValue('feed:banks')).toMatchObject({ status: 'connected' });
    expect(getValue(SENTIMENT_STATUS_KEY)).toMatchObject({ ok: false, reason: expect.stringMatching(/crowding : HTTP 502/), received_ms: 42 });
  });
});
