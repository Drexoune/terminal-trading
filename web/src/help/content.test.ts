// @vitest-environment node
// Aide : chaque écran du menu a sa case explicative ; les panneaux trouvent leur bulle par libellé ou
// par début de titre ; chaque terme du glossaire a une définition.
import { describe, expect, it } from 'vitest';
import { ALL_MODULES } from '../modules';
import { PAGES, panelHelp, TERMS } from './content';

describe('aide', () => {
  it('une case explicative par écran du menu, plus Alertes et Paramètres', () => {
    const missing = [...ALL_MODULES.map((m) => m.id), 'alerts', 'settings'].filter((id) => !PAGES[id]);
    expect(missing).toEqual([]);
    for (const p of Object.values(PAGES)) { expect(p.intro.length).toBeGreaterThan(30); expect(p.read.length).toBeGreaterThan(0); expect(p.use.length).toBeGreaterThan(0); }
  });
  it('bulles des panneaux : libellé, titre dynamique, repli de l’écran', () => {
    expect(panelHelp('micro', 'Carte de profondeur · 60 min', 'Carte de profondeur')?.what).toMatch(/ordres en attente/);
    expect(panelHelp('micro', 'Funding et open interest · BTC perpétuel', 'Funding et open interest')?.calc).toMatch(/pondérée/);
    expect(panelHelp('micro', 'Liquidations', 'Liquidations')?.calc).toMatch(/minimums/);
    expect(panelHelp('options', 'Sourire · 4 déc. 26')?.what).toMatch(/sourire/);
    expect(panelHelp('season', 'Trajectoire de l’année · BTC/USDT')?.what).toMatch(/1er janvier/);
    expect(panelHelp('heatmap', 'Paire EUR / USD', 'Comparateur de paire')?.what).toMatch(/comparateur/i);
    expect(panelHelp('rates', 'Évolution · 60 jours', 'Évolution des probabilités')?.what).toMatch(/60 jours/);
    expect(panelHelp('recap', 'New York · 2026-11-25', 'Récap New York 2026-11-25')?.what).toMatch(/récap/i);
    expect(panelHelp('inconnu', 'X')).toBeNull();
  });
  it('glossaire : définition pour chaque terme', () => {
    for (const [k, h] of Object.entries(TERMS)) expect(h.what.length, k).toBeGreaterThan(20);
  });
});
