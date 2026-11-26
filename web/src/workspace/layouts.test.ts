// Espaces de travail : mises en page nommées gardées dans le navigateur, remplacées par nom,
// refusées vides ou sans nom ; disposition en cours reprise ; modèles cohérents ; lien d'actif.
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_MODULES } from '../modules';
import { deleteLayout, LayoutError, listLayouts, loadCurrent, PRESETS, saveCurrent, saveLayout } from './layouts';
import { linkedChoice } from './link';

const L = { grid: { root: {} }, panels: { a: { id: 'a' } } };

describe('mises en page', () => {
  beforeEach(() => localStorage.clear());
  it('enregistrer, remplacer par nom, trier, supprimer', () => {
    saveLayout('Séance', L, 'BTC', 1);
    saveLayout('Macro', L, null, 2);
    expect(saveLayout('Séance', L, 'ETH', 3).map((l) => [l.name, l.asset])).toEqual([['Macro', null], ['Séance', 'ETH']]);
    expect(deleteLayout('Macro').map((l) => l.name)).toEqual(['Séance']);
  });
  it('refus : sans nom, nom trop long, mise en page vide', () => {
    expect(() => saveLayout('  ', L, null, 1)).toThrow(LayoutError);
    expect(() => saveLayout('x'.repeat(41), L, null, 1)).toThrow('40 caractères');
    expect(() => saveLayout('Vide', undefined, null, 1)).toThrow('ajouter au moins un écran');
  });
  it('disposition en cours ; stockage corrompu ignoré', () => {
    saveCurrent(L, 'SPY');
    expect(loadCurrent()).toEqual({ layout: L, asset: 'SPY' });
    localStorage.setItem('workspace:layouts', '{pas du json');
    expect(listLayouts()).toEqual([]);
  });
  it('modèles : écrans existants, références valides', () => {
    const ids = new Set(ALL_MODULES.map((m) => m.id));
    for (const p of PRESETS) p.panels.forEach((x, i) => { expect(ids.has(x.screen), x.screen).toBe(true); if (x.position) expect(x.position.ref).toBeLessThan(i); });
  });
  it('lien d’actif : appliqué si l’écran sait l’afficher', () => {
    const link = { asset: 'ETH', setAsset: () => {} };
    expect(linkedChoice(link, ['BTC', 'ETH'], 'BTC')).toBe('ETH');
    expect(linkedChoice({ ...link, asset: 'EURUSD' }, ['BTC', 'ETH'], 'BTC')).toBe('BTC');
    expect(linkedChoice(null, ['BTC', 'ETH'], 'BTC')).toBe('BTC');
  });
});
