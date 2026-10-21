import { describe, expect, it } from 'vitest';
import {
  DASH, MINUS, NBSP, decimalsOf, fmtDuration, fmtNumber, fmtPctChange, fmtRatePct, fmtSigned,
  fmtUsdCompact,
} from './format';

const THIN = ' ';

describe('format fr-FR', () => {
  it('prix avec espace fine et virgule', () => {
    expect(fmtNumber(108420.5, 1)).toBe(`108${THIN}420,5`);
    expect(fmtNumber(3912.4, 1)).toBe(`3${THIN}912,4`);
  });

  it('signe moins typographique', () => {
    expect(fmtNumber(-0.42, 2)).toBe(`${MINUS}0,42`);
    expect(fmtSigned(-0.42)).toBe(`${MINUS}0,42`);
    expect(fmtSigned(1.84)).toBe('+1,84');
    expect(fmtSigned(0)).toBe('0,00');
    expect(fmtSigned(-0.001, 2)).toBe('0,00');
  });

  it('pourcentages avec espace insécable', () => {
    expect(fmtPctChange(0.0184)).toBe(`+1,84${NBSP}%`);
    expect(fmtPctChange(-0.0042)).toBe(`${MINUS}0,42${NBSP}%`);
    expect(fmtRatePct(0.000081)).toBe(`+0,0081${NBSP}%`);
  });

  it('montants compacts', () => {
    expect(fmtUsdCompact(31.2e9)).toBe(`31,2${NBSP}Md$`);
    expect(fmtUsdCompact(840.5e6)).toBe(`840,5${NBSP}M$`);
  });

  it('valeur absente : un tiret, jamais un zéro', () => {
    expect(fmtNumber(null)).toBe(DASH);
    expect(fmtPctChange(undefined)).toBe(DASH);
    expect(fmtUsdCompact(Number.NaN)).toBe(DASH);
  });

  it('décimales d’un pas de prix', () => {
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(0.01)).toBe(2);
    expect(decimalsOf(1)).toBe(0);
    expect(decimalsOf(1e-7)).toBe(7);
  });

  it('durées', () => {
    expect(fmtDuration(41.4)).toBe(`41${NBSP}ms`);
    expect(fmtDuration(2300)).toBe(`2,3${NBSP}s`);
  });
});
