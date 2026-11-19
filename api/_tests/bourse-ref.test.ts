// @vitest-environment node
/// <reference types="node" />
// Référentiel du module Bourse : clé des ISIN, règle PEA, lecture GLEIF réelle.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gleifUrl, parseGleifIsin } from '../_lib/bourse/gleif.js';
import { normalizeIsin } from '../_lib/bourse/isin.js';
import { PEA_ETFS, peaVerdict } from '../_lib/bourse/pea.js';

const GLEIF = JSON.parse(readFileSync(new URL('../../supabase/functions/bourse-jobs/fixtures/gleif-isin-FR0000120271-2026-11-19.json', import.meta.url), 'utf-8'));

describe('ISIN', () => {
  it('clé de contrôle', () => {
    expect(normalizeIsin('US0378331005')).toBe('US0378331005');           // Apple
    expect(normalizeIsin(' fr0000120073 ')).toBe('FR0000120073');         // Air Liquide
    expect(normalizeIsin('LU1681043599')).toBe('LU1681043599');
    expect(normalizeIsin('US0378331006')).toBeNull();
    expect(normalizeIsin('FR000012007')).toBeNull();
    expect(normalizeIsin('')).toBeNull();
  });

  it('toute la table des ETF PEA a des ISIN valides', () => {
    for (const isin of Object.keys(PEA_ETFS)) expect(normalizeIsin(isin), isin).toBe(isin);
  });
});

describe('règle PEA', () => {
  it('action : siège dans l’EEE, jamais le préfixe de l’ISIN', () => {
    expect(peaVerdict({ kind: 'action', isin: 'FR0000120271', hqCountry: 'FR' }).eligible).toBe(true);
    expect(peaVerdict({ kind: 'action', isin: 'NL0000235190', hqCountry: 'NL' }).eligible).toBe(true);
    expect(peaVerdict({ kind: 'action', isin: 'NO0010096985', hqCountry: 'NO' }).eligible).toBe(true);
    expect(peaVerdict({ kind: 'action', isin: 'GB0009895292', hqCountry: 'GB' })).toMatchObject({ eligible: false, reason: 'siège hors de l’EEE (GB)' });
    expect(peaVerdict({ kind: 'action', isin: 'CH0012005267', hqCountry: 'CH' }).eligible).toBe(false);
    expect(peaVerdict({ kind: 'action', isin: 'FR0000000000', hqCountry: 'US' }).eligible).toBe(false);
    expect(peaVerdict({ kind: 'action', isin: 'FR0000120271', hqCountry: null }).eligible).toBeNull();
  });

  it('ETF : seulement la table, inconnu sinon', () => {
    expect(peaVerdict({ kind: 'etf', isin: 'FR0011871110', hqCountry: null })).toEqual({ eligible: true, reason: 'ETF de la table des fonds éligibles', source: 'table ETF' });
    expect(peaVerdict({ kind: 'etf', isin: 'IE00B4L5Y983', hqCountry: 'IE' }).eligible).toBeNull();
    expect(peaVerdict({ kind: 'livret', isin: null, hqCountry: null }).eligible).toBe(false);
  });
});

describe('GLEIF', () => {
  it('réponse réelle : TotalEnergies, siège en France', () => {
    expect(parseGleifIsin(GLEIF)).toEqual({ lei: '529900S21EQ1BO4ESM68', legalName: 'TotalEnergies SE', hqCountry: 'FR', legalCountry: 'FR', status: 'ISSUED' });
    expect(parseGleifIsin({ data: [] })).toBeNull();
    expect(() => parseGleifIsin({})).toThrow(/data/);
    expect(gleifUrl('FR0000120271')).toBe('https://api.gleif.org/api/v1/lei-records?filter%5Bisin%5D=FR0000120271');
  });
});
