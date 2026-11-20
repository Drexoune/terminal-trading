// Lecteur .xlsx (B1.4) sur un classeur d'exemple au format d'import Baggr
// (titres génériques, montants fictifs), produit par openpyxl comme un export.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readSheet, sha256Hex, sheetNames } from './xlsx';

const file = () => {
  const b = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/import-exemple.xlsx'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('lecteur .xlsx', () => {
  it('feuilles du classeur', async () => {
    expect(await sheetNames(file())).toEqual(['Opérations', 'Aide']);
  });

  it('lignes de la feuille « Opérations » : texte, nombres, dates en numéro de série, lignes vides ignorées', async () => {
    const { sheet, rows } = await readSheet(file(), 'Opérations');
    expect(sheet).toBe('Opérations');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ Date: 46286, Type: 'Dépôt', Montant: 1000, Devise: 'EUR', 'Référence': '100001', ISIN: null });
    expect(rows[1]).toMatchObject({ Type: 'Achat', ISIN: 'FR0000120271', Ticker: 'TTE', 'Quantité': 3, 'Prix unitaire': 58.75, Taxes: 0.53 });
    expect(rows[2]).toMatchObject({ Type: 'Intérêts', Montant: -0.12 });
  });

  it('feuille absente : la première ; fichier non zip refusé', async () => {
    expect((await readSheet(file(), 'Inconnue')).sheet).toBe('Opérations');
    await expect(readSheet(new TextEncoder().encode('pas un classeur').buffer as ArrayBuffer)).rejects.toThrow(/xlsx/);
  });

  it('empreinte SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
