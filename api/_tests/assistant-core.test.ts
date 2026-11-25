// Porte de P6 (T-074) : le contrôleur écarte toute réponse dont un nombre n'est pas dans un fait
// cité. Corpus de 20 réponses simulées de Gemini sur des faits du terminal.
import { describe, expect, it } from 'vitest';
import { cleanFacts, NO_DATA, numbersOf, verifyAnswer, type Fact } from '../_lib/assistant-core';

const F: Fact[] = [
  { id: 'F1', label: 'BTC-USDT perp · dernier prix', value: '108 420,5 $', source: 'OKX', at_ms: 1, href: '/graphiques' },
  { id: 'F2', label: 'BTC-USDT perp · variation 24 h', value: '−1,84 %', source: 'OKX', at_ms: 1, href: '/graphiques' },
  { id: 'F3', label: 'IPC États-Unis (m/m), novembre', value: 'réel 0,6 %, consensus 0,3 %, surprise z +2,1', source: 'BLS', at_ms: 1, href: '/calendrier' },
  { id: 'F4', label: 'Fed, réunion du 16/12 · baisse de 25 pb', value: '62,5 %', source: 'Polymarket', at_ms: 1, href: '/taux' },
  { id: 'F5', label: 'Liquidations 1 h', value: 'longs 66,7 M$, shorts 1,52 M$', source: 'OKX, Binance, Bybit', at_ms: 1, href: '/microstructure' },
  { id: 'F6', label: 'Article ouvert · titre', value: 'Fed\'s Powell says inflation progress has stalled, sees 2 cuts in 2027', source: 'article : Reuters', at_ms: 1, href: null },
];

describe('nombres', () => {
  it('écritures française et anglaise', () => {
    expect(numbersOf('108 420,5 $').map((n) => n.value)).toEqual([108420.5]);
    expect(numbersOf('108,420.5').map((n) => n.value)).toEqual([108420.5]);
    expect(numbersOf('−0,042 % et 0.6%').map((n) => n.value)).toEqual([0.042, 0.6]);
    expect(numbersOf('à 14:30, le 16/12').map((n) => n.value)).toEqual([14, 30, 16, 12]);
    expect(numbersOf('1,234,567').map((n) => n.value)).toEqual([1234567]);
  });
});

// [réponse, sources, attendu ok]
const CORPUS: [string, string[], boolean][] = [
  ['Le BTC cote 108 420,5 $ (OKX).', ['F1'], true],
  ['Le BTC recule de 1,84 % sur 24 h.', ['F2'], true],
  ['L’IPC de novembre ressort à 0,6 %, contre 0,3 % attendu (surprise z +2,1).', ['F3'], true],
  ['Polymarket donne 62,5 % à une baisse de 25 pb le 16/12.', ['F4'], true],
  ['Sur l’heure, 66,7 M$ de longs ont été liquidés contre 1,52 M$ de shorts.', ['F5'], true],
  ['Powell voit 2 baisses en 2027 selon Reuters.', ['F6'], true],
  [NO_DATA, [], true],
  ['Le BTC cote environ 108 420 $.', ['F1'], true],                          // arrondi à sa propre précision
  ['La surprise de l’IPC n’est pas reprise ici ; voir le calendrier.', ['F3'], true],
  ['Le BTC est à 108 420,5 $ et recule de 1,84 %.', ['F1', 'F2'], true],
  // --- écartées
  ['Le BTC cote 108 500 $.', ['F1'], false],                                // nombre faux
  ['Le BTC recule de 1,8 %, soit environ 2 000 $.', ['F2'], false],          // conversion calculée
  ['L’IPC sort à 0,6 %, soit 0,3 point au-dessus du consensus.', ['F1'], false], // fait non cité
  ['La probabilité est passée de 50 % à 62,5 %.', ['F4'], false],            // 50 inventé
  ['Les liquidations totalisent 68,22 M$.', ['F5'], false],                  // somme calculée
  ['Le BTC cote 108 420,5 $.', ['F9'], false],                               // source inconnue
  ['Le BTC cote 108 420,5 $.', [], false],                                   // nombre sans source
  ['Le BTC cote 108 420,55 $.', ['F1'], false],                              // plus précis que la source
  ['Powell voit 3 baisses en 2027.', ['F6'], false],                         // nombre faux
  ['Le funding est de 0,0095 %.', ['F1', 'F2'], false],                      // donnée absente
];

describe('contrôleur (porte de P6)', () => {
  it.each(CORPUS)('%s', (answer, sources, ok) => {
    const v = verifyAnswer(answer, sources, F);
    expect(v.ok, JSON.stringify(v)).toBe(ok);
    if (!ok) expect(v.reason).toBeTruthy();
  });
  it('un nombre de la question est permis', () => {
    expect(verifyAnswer('Au-dessus de 110 000 $, aucune donnée : le BTC cote 108 420,5 $.', ['F1'], F, 'Le BTC est-il au-dessus de 110 000 $ ?').ok).toBe(true);
  });
});

describe('faits reçus', () => {
  it('forme bornée, ids F<n>, liens internes seulement', () => {
    const c = cleanFacts([{ id: 'F1', label: 'x', value: 'y', source: 's', at_ms: 1, href: '/taux' }, { id: 'X', value: 'z' },
      { id: 'F2', value: 'v', href: 'https://ailleurs.example' }, 'nope']);
    expect(c.map((f) => [f.id, f.href])).toEqual([['F1', '/taux'], ['F2', null]]);
    expect(cleanFacts({})).toEqual([]);
  });
});
