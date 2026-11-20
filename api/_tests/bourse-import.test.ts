// Import des opérations (B1.4) : lecture des lignes au format Baggr et
// rattachement au référentiel. Titres génériques (aucune ligne réelle du
// portefeuille dans le dépôt) ; mêmes cas que les exports XTB de Clément.
import { describe, expect, it } from 'vitest';
import { parseRows, readDate, readNumber, resolveRows, type RawRow, type RefListing, toDbRow } from '../_lib/bourse/importer.js';

const TODAY = '2026-11-20';
const serial = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000 + 25569;

const LISTINGS: RefListing[] = [
  { id: 1, symbol: 'TTE', mic: 'XPAR', currency: 'EUR', isin: 'FR0000120271', name: 'TotalEnergies', tracked: true },
  { id: 2, symbol: 'CW8', mic: 'XPAR', currency: 'EUR', isin: 'LU1681043599', name: 'Amundi MSCI World', tracked: true },
  { id: 3, symbol: 'AAPL', mic: 'XNAS', currency: 'USD', isin: 'US0378331005', name: 'Apple', tracked: true },
];

const row = (o: Record<string, string | number | null>): RawRow => o;

describe('lecture des cellules', () => {
  it('nombres : nombre, virgule ou point, pas de séparateur de milliers', () => {
    expect(readNumber(29.6571)).toBe('29.6571');
    expect(readNumber('29,6571')).toBe('29.6571');
    expect(readNumber(' 1742.35 ')).toBe('1742.35');
    expect(readNumber(1000)).toBe('1000');
    expect(readNumber('-0,5')).toBe('-0.5');
    expect(readNumber('1\u202f742,35')).toBe('1742.35');
    expect(readNumber('1 742,35')).toBe('invalide');   // espace insécable ou fine des exports français
    expect(readNumber('1.742,35')).toBe('invalide');
    expect(readNumber('')).toBeNull();
    expect(readNumber(null)).toBeNull();
  });

  it('dates : numéro de série Excel, JJ/MM/AAAA, AAAA-MM-JJ', () => {
    expect(readDate(serial('2026-09-21'))).toBe('2026-09-21');
    expect(readDate(serial('2026-09-21') + 0.5)).toBe('2026-09-21');
    expect(readDate('21/09/2026')).toBe('2026-09-21');
    expect(readDate('2026-09-21')).toBe('2026-09-21');
    expect(readDate('2026-09-21T00:00:00')).toBe('2026-09-21');
    expect(readDate('31/02/2026')).toBeNull();
    expect(readDate('09/21/2026')).toBeNull();
  });
});

describe('parseRows', () => {
  it('fichier valide : dépôt, achats, intérêts négatifs, taxes, split', () => {
    const { rows, errors } = parseRows([
      row({ Date: serial('2026-09-21'), Type: 'Dépôt', Montant: 1000, Devise: 'EUR', 'Référence': '111' }),
      row({ Date: '22/09/2026', Type: 'Achat', ISIN: 'FR0000120271', Ticker: 'TTE', Place: 'XPAR', Nom: 'TotalEnergies', 'Quantité': 3, 'Prix unitaire': '58,75', Taxes: 0.53, Devise: 'EUR', 'Référence': '112' }),
      row({ Date: '2026-10-03', Type: 'Intérêts', Montant: '-0,12', Devise: 'EUR' }),
      row({ Date: '2026-11-03', Type: 'Taxes', Montant: 0.04, Devise: 'EUR' }),
      row({ Date: '2026-11-04', Type: 'Split/Regroupement', Ticker: 'TTE', Place: 'Euronext Paris', Ratio: '10:1' }),
      row({ Date: null, Type: null, ISIN: null }),
    ], TODAY);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.line, r.trade_date, r.kind, r.mic, r.quantity, r.price, r.amount, r.taxes])).toEqual([
      [2, '2026-09-21', 'depot', null, null, null, '1000', '0'],
      [3, '2026-09-22', 'achat', 'XPAR', '3', '58.75', null, '0.53'],
      [4, '2026-10-03', 'interets', null, null, null, '-0.12', '0'],
      [5, '2026-11-03', 'taxes', null, null, null, '0.04', '0'],
      [6, '2026-11-04', 'split', 'XPAR', null, null, null, '0'],
    ]);
    expect(rows[4]).toMatchObject({ ratio_new: '10', ratio_old: '1' });
  });

  it('erreurs signalées avec leur ligne', () => {
    const { errors } = parseRows([
      row({ Date: '2026-12-01', Type: 'Dépôt', Montant: 10 }),
      row({ Date: '2026-10-01', Type: 'Virement', Montant: 10 }),
      row({ Date: '2026-10-01', Type: 'Achat', ISIN: 'FR0000120272', 'Quantité': 1, 'Prix unitaire': 10 }),
      row({ Date: '2026-10-01', Type: 'Achat', Ticker: 'TTE', 'Quantité': 1, 'Prix unitaire': 10 }),
      row({ Date: '2026-10-01', Type: 'Achat', ISIN: 'FR0000120271', 'Quantité': -1, 'Prix unitaire': 10 }),
      row({ Date: '2026-10-01', Type: 'Dépôt', Montant: 10, Commentaire: 'x' }),
      row({ Date: 'hier', Type: 'Dépôt', Montant: 10 }),
      row({ Date: '2026-10-01', Type: 'Split/Regroupement', ISIN: 'FR0000120271', Ratio: 'dix' }),
    ], TODAY);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 6, 7, 8, 9]);
    expect(errors[0].message).toMatch(/futur/);
    expect(errors[1].message).toMatch(/type inconnu/);
    expect(errors[2].message).toMatch(/ISIN invalide/);
    expect(errors[3].message).toMatch(/Place attendue/);
    expect(errors.find((e) => e.line === 6)!.message).toMatch(/négatif/);
    expect(errors.find((e) => e.line === 7)!.message).toMatch(/colonne\(s\) inconnue\(s\) : Commentaire/);
    expect(errors.find((e) => e.line === 8)!.message).toMatch(/date illisible/);
    expect(errors.find((e) => e.line === 9)!.message).toMatch(/Ratio/);
  });

  it('en-têtes dans n’importe quel ordre, sans accents ni casse', () => {
    const { rows, errors } = parseRows([row({ MONTANT: 5, type: 'depot', DATE: '2026-10-01' })], TODAY);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ kind: 'depot', amount: '5' });
  });
});

describe('resolveRows', () => {
  const parse = (raw: RawRow[]) => parseRows(raw, TODAY).rows;

  it('Ticker et Place d’abord ; ISIN contradictoire signalé, ligne rattachée au Ticker', () => {
    const r = resolveRows(parse([
      row({ Date: '2026-09-23', Type: 'Achat', ISIN: 'FR0000131104', Ticker: 'CW8', Place: 'XPAR', 'Quantité': 1, 'Prix unitaire': 500, 'Référence': 'A1' }),
    ]), LISTINGS, 'EUR');
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ listing_id: 2, currency: 'EUR', dedup_key: 'ref:A1' });
    expect(r.warnings).toEqual([{ line: 2, message: expect.stringMatching(/ISIN du fichier FR0000131104 ≠ référentiel LU1681043599 pour CW8 \(XPAR\)/) }]);
  });

  it('ISIN seul ; titre inconnu refusé', () => {
    const r = resolveRows(parse([
      row({ Date: '2026-09-23', Type: 'Achat', ISIN: 'FR0000120271', 'Quantité': 1, 'Prix unitaire': 50 }),
      row({ Date: '2026-09-23', Type: 'Achat', ISIN: 'FR0000131104', 'Quantité': 1, 'Prix unitaire': 50 }),
    ]), LISTINGS, 'EUR');
    expect(r.rows.map((x) => x.listing_id)).toEqual([1]);
    expect(r.errors).toEqual([{ line: 3, message: expect.stringMatching(/titre inconnu du référentiel : FR0000131104/) }]);
  });

  it('titre en dollars sur un compte en euros : Montant ou Taux de change exigé', () => {
    const r = resolveRows(parse([
      row({ Date: '2026-11-11', Type: 'Achat', Ticker: 'AAPL', Place: 'XNAS', 'Quantité': 1, 'Prix unitaire': 200, Devise: 'EUR' }),
      row({ Date: '2026-11-11', Type: 'Achat', Ticker: 'AAPL', Place: 'XNAS', 'Quantité': 1, 'Prix unitaire': 200, Devise: 'EUR', 'Taux de change': '0,86' }),
    ]), LISTINGS, 'EUR');
    expect(r.errors).toEqual([{ line: 2, message: 'titre en USD, compte en EUR : Montant ou Taux de change attendu' }]);
    expect(toDbRow(r.rows[1])).toMatchObject({ listing_id: 3, fx_rate: '0.86', currency: 'EUR', quantity: '1', price: '200' });
  });

  it('dédoublonnage : Référence, sinon contenu, avec rang pour deux lignes identiques', () => {
    const same = row({ Date: '2026-10-01', Type: 'Dépôt', Montant: 100 });
    const r = resolveRows(parse([same, same, row({ Date: '2026-10-01', Type: 'Dépôt', Montant: 100, 'Référence': '9' })]), LISTINGS, 'EUR');
    const keys = r.rows.map((x) => x.dedup_key);
    expect(keys[0]).toBe('h:2026-10-01|depot||||100|0|0|EUR');
    expect(keys[1]).toBe(`${keys[0]}#2`);
    expect(keys[2]).toBe('ref:9');
  });
});
