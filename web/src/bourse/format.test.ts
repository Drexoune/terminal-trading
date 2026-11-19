import { describe, expect, it } from 'vitest';
import { fmtDecimalText, fmtParis, fmtValueDate, isStaleClose, previousBusinessDay } from './format';

import { NBSP as NB } from '../lib/format';

describe('format Bourse', () => {
  it('décimal en texte, virgule, espaces fines, zéros finals', () => {
    expect(fmtDecimalText('614.2500')).toBe('614,25');
    expect(fmtDecimalText('0.8329')).toBe('0,8329');
    expect(fmtDecimalText('1234567.5')).toBe(`1${NB}234${NB}567,50`);
    expect(fmtDecimalText('97')).toBe('97,00');
    expect(fmtDecimalText('1.1081', 4)).toBe('1,1081');
    for (const bad of [null, '', '-1', '1e5', 'abc']) expect(fmtDecimalText(bad)).toBe('—');
  });

  it('dates à Paris, changement d’heure compris', () => {
    expect(fmtValueDate('2026-11-18')).toBe('18/11/2026');
    expect(fmtParis('2026-11-19T06:30:00Z')).toBe(`19/11${NB}07:30`);
    expect(fmtParis('2026-07-15T06:30:00Z')).toBe(`15/07${NB}08:30`);
    expect(fmtParis(null)).toBe('—');
  });

  it('dernier jour ouvré et clôture périmée', () => {
    expect(previousBusinessDay(Date.parse('2026-11-19T10:00:00Z'))).toBe('2026-11-18');
    expect(previousBusinessDay(Date.parse('2026-11-23T08:00:00Z'))).toBe('2026-11-20');   // lundi
    expect(previousBusinessDay(Date.parse('2026-11-18T23:30:00Z'))).toBe('2026-11-18');   // déjà le 19 à Paris
    expect(isStaleClose('2026-11-18', Date.parse('2026-11-19T10:00:00Z'))).toBe(false);
    expect(isStaleClose('2026-11-17', Date.parse('2026-11-19T10:00:00Z'))).toBe(true);
    expect(isStaleClose(null, 0)).toBe(true);
  });
});
