// @vitest-environment node
// Récap de séance (P6, S4) : fenêtres par fuseau IANA (changements d'heure décalés entre l'Europe
// et les États-Unis), jours ouvrés, registre (deltas de CVD par minute, doublons), faits calculés
// à la main ; une lecture qui recopie les faits passe le contrôleur, un calcul de l'IA est écarté.
import { describe, expect, it } from 'vitest';
import { verifyAnswer } from '../../../api/_lib/assistant-core';
import { fmtHm, SESSIONS } from '../lib/time';
import { closedSessions, Ledger, recapFacts, recapKey, sessionWindow } from './recap';

const NY = SESSIONS.find((s) => s.id === 'ny')!;
const LON = SESSIONS.find((s) => s.id === 'london')!;
const sp = (s: string) => s.replace(/[  ]/g, ' ');

describe('fenêtres', () => {
  it('New York 09:30–16:00 : 15:30 Paris en temps normal, 14:30 la semaine où seule l’Europe a changé d’heure', () => {
    const normal = sessionWindow(NY, '2026-11-25');
    expect([fmtHm(normal.from, 'Europe/Paris'), fmtHm(normal.to, 'Europe/Paris')]).toEqual(['15:30', '22:00']);
    const gap = sessionWindow(NY, '2026-10-27');                      // Europe à l'heure d'hiver le 25/10, États-Unis le 01/11
    expect(fmtHm(gap.from, 'Europe/Paris')).toBe('14:30');
    expect(sessionWindow(LON, '2026-11-25').to - sessionWindow(LON, '2026-11-25').from).toBe(8.5 * 3_600_000);
    expect(recapKey(normal)).toBe('recap:2026-11-25:ny');
  });
  it('séances closes récemment, jamais le week-end', () => {
    const after = Date.parse('2026-11-25T21:05:00Z');                 // 22:05 Paris, mercredi
    expect(closedSessions(after, 15 * 60_000).map((w) => w.session)).toEqual(['ny']);
    expect(closedSessions(Date.parse('2026-11-28T21:05:00Z'), 15 * 60_000)).toEqual([]);   // samedi
  });
});

describe('registre et faits', () => {
  const w = sessionWindow(NY, '2026-11-25');
  const m = (k: number) => w.from + k * 60_000;
  const ledger = new Ledger();
  ledger.addCvd({ t: [m(-1), m(0), m(1), m(2)], perp: [100, 110, 95, 125], spot: [0, -5, -5, -20] }, m(3));
  ledger.addLiqs([{ venue: 'binance', ts: m(1), side: 'long', px: 60_000, sz: 50, usd: 3_000_000 },
    { venue: 'binance', ts: m(1), side: 'long', px: 60_000, sz: 50, usd: 3_000_000 },                       // doublon
    { venue: 'bybit', ts: m(2), side: 'short', px: 60_100, sz: 2, usd: 120_200 },
    { venue: 'okx', ts: w.to + 60_000, side: 'long', px: 1, sz: 1, usd: 9e9 }]);                             // hors séance
  ledger.addWalls([{ t: m(2), px: 60_500, sz: 420.4, side: 'ask', left: 10 }]);
  const facts = recapFacts(w, {
    candles: [{ t: m(0), o: 60_000, h: 60_400, l: 59_900, c: 60_200 }, { t: m(1), o: 60_200, h: 60_900, l: 60_100, c: 60_600 }],
    ledger, funding8h: 0.0000951, figures: [{ label: 'IPC (m/m)', value: '0.6', unit: '%', at: m(-60) }], headlines: [{ title: 'Fed holds', source: 'Fed', at: m(1) }],
  });
  const v = (label: string) => sp(facts.find((f) => f.label.startsWith(label))!.value);
  it('BTC : ouverture, clôture, variation, extrêmes', () => {
    expect(v('BTC-USDT perp · ouverture')).toBe('60 000,0 $ → 60 600,0 $');
    expect(v('BTC-USDT perp · variation')).toBe('+1,00 %');
    expect(v('BTC-USDT perp · plus haut')).toBe('60 900,0 $ et 59 900,0 $');
  });
  it('CVD : somme des deltas des minutes de la séance, couverture dite', () => {
    expect(v('CVD perpétuel')).toBe('+25 BTC (3 minutes couvertes sur 390)');        // 10 − 15 + 30
    expect(v('CVD spot')).toBe('−20 BTC (3 minutes couvertes sur 390)');
  });
  it('liquidations, murs, funding, chiffres, titres', () => {
    expect(v('Liquidations BTC sur la séance')).toBe('longs 3,0 M$, shorts 120,2 k$ (Binance et OKX : minimums)');
    expect(v('Murs retirés')).toBe('1 ; le plus gros : 420 BTC à 60 500 à 15:32 (Paris)');
    expect(v('Funding')).toBe('+0,0095 %');
    expect(facts.some((f) => f.label.startsWith('Chiffre publié'))).toBe(true);       // filtré par l'appelant (séance)
    expect(facts.find((f) => f.label.startsWith('Titre urgent'))!.value).toBe('Fed holds');
  });
  it('une lecture qui recopie les faits passe ; un calcul est écarté', () => {
    const ids = (p: string) => facts.filter((f) => f.label.startsWith(p)).map((f) => f.id);
    expect(verifyAnswer('Le BTC gagne +1,00 % (60 000,0 $ → 60 600,0 $) ; CVD perpétuel +25 BTC.', [...ids('BTC-USDT perp · ouverture'), ...ids('BTC-USDT perp · variation'), ...ids('CVD perpétuel')], facts).ok).toBe(true);
    expect(verifyAnswer('Le BTC gagne 600 $ sur la séance.', ids('BTC-USDT perp · ouverture'), facts).ok).toBe(false);
  });
  it('registre sauvegardé puis relu ; ménage au-delà de 26 h', () => {
    const b = new Ledger();
    b.restore(JSON.parse(JSON.stringify(ledger.save())), w.to);
    expect([b.cvd.perp.size, b.liqs.length, b.walls.length]).toEqual([3, 3, 1]);
    b.prune(w.to + 27 * 3_600_000);
    expect([b.cvd.perp.size, b.liqs.length]).toEqual([0, 0]);
  });
});
