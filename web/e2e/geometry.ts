// Mesure des repères de mise en page, identique sur la maquette statique et
// sur l'application : c'est le critère bloquant de la comparaison (±2 px).

import type { Page } from '@playwright/test';

export interface Box { x: number; y: number; w: number; h: number }
export type Geometry = Record<string, Box | null>;

/** Repères communs à la maquette Main.html et à l'écran Vue d'ensemble. */
export const MAIN_LANDMARKS: Record<string, string> = {
  'barre du haut': 'body header',
  'logo': 'body header > a',
  'menu latéral': 'nav[aria-label="Navigation principale"]',
  'entrée active du menu': 'nav [aria-current="page"]',
  'sous-en-tête': 'main > div:first-child',
  'panneau BTC': 'section[aria-label="BTC-USDT perpétuel"]',
  'watchlist': 'section[aria-label="Watchlist"]',
  'prochains événements': 'section[aria-label="Prochains événements"]',
  'sentiment de risque': 'section[aria-label="Sentiment de risque"]',
  'alertes actives': 'section[aria-label="Alertes actives"]',
  'titres urgents': 'section[aria-label="Titres urgents"]',
  'barre de flux': 'main > div:last-child',
};

export async function measure(page: Page, landmarks: Record<string, string>): Promise<Geometry> {
  return page.evaluate((lm) => {
    const out: Record<string, { x: number; y: number; w: number; h: number } | null> = {};
    for (const [name, sel] of Object.entries(lm)) {
      const el = document.querySelector(sel);
      if (!el) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      out[name] = {
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY),
        w: Math.round(r.width), h: Math.round(r.height),
      };
    }
    return out;
  }, landmarks);
}

export interface Diff { name: string; field: keyof Box; ref: number; got: number; delta: number }

export function compare(ref: Geometry, got: Geometry, tolerance = 2,
  fields: (keyof Box)[] = ['x', 'y', 'w', 'h']): { diffs: Diff[]; missing: string[] } {
  const diffs: Diff[] = [];
  const missing: string[] = [];
  for (const [name, r] of Object.entries(ref)) {
    const g = got[name];
    if (!r) continue;
    if (!g) { missing.push(name); continue; }
    for (const f of fields) {
      const delta = g[f] - r[f];
      if (Math.abs(delta) > tolerance) diffs.push({ name, field: f, ref: r[f], got: g[f], delta });
    }
  }
  return { diffs, missing };
}
