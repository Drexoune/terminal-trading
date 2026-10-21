import { describe, expect, it } from 'vitest';
import { MODULES } from '../modules';
import { ENTRIES, matchEntry } from './CommandPalette';

describe('registre des écrans', () => {
  it('24 modules, chacun avec une URL et une commande uniques', () => {
    expect(MODULES).toHaveLength(24);
    expect(new Set(MODULES.map((m) => m.path)).size).toBe(24);
    expect(new Set(ENTRIES.map((e) => e.command)).size).toBe(ENTRIES.length);
  });
});

describe('filtre de la palette', () => {
  const gp = ENTRIES.find((e) => e.command === 'BTC GP')!;
  const book = ENTRIES.find((e) => e.command === 'BTC BOOK')!;

  it('grammaire TICKER FONCTION, insensible à la casse, préfixes acceptés', () => {
    expect(matchEntry(gp, 'btc gp')).toBe(1);
    expect(matchEntry(gp, 'BTC G')).toBe(1);
    expect(matchEntry(book, 'btc gp')).toBe(0);
  });

  it('retrouve aussi par la description', () => {
    expect(matchEntry(gp, 'graphique')).toBeGreaterThan(0);
  });
});
