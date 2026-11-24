// Essais d'une session, pour le Sharpe déflaté (T-061) : chaque variante distincte (code,
// paramètres, réglages) lancée sur un même actif, une même unité de temps et une même période
// compte pour un essai. Gardé dans le stockage local du navigateur (confort, pas une donnée sûre) :
// sans stockage, l'écran le dit et le compte repart de 1.
import { trialStats, type Trials } from './metrics';

const KEY = (asset: string, tf: string, period: string) => `bt:trials:${asset}:${tf}:${period}`;

/** Empreinte courte et stable d'une variante (FNV-1a sur 32 bits). */
export function variantHash(parts: unknown[]): string {
  const s = JSON.stringify(parts);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function read(key: string): Record<string, number> | null {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>; } catch { return null; }
}

/** Enregistre le Sharpe par barre d'une variante et renvoie le nombre d'essais et leur variance. */
export function recordTrial(asset: string, tf: string, period: string, hash: string, srBar: number | null): Trials & { stored: boolean } {
  const key = KEY(asset, tf, period);
  const all = read(key);
  if (!all) return { ...trialStats(srBar === null ? [] : [srBar]), stored: false };
  if (srBar !== null && Number.isFinite(srBar)) all[hash] = srBar;
  try { localStorage.setItem(key, JSON.stringify(all)); } catch { return { ...trialStats(Object.values(all)), stored: false }; }
  return { ...trialStats(Object.values(all)), stored: true };
}

export function resetTrials(asset: string, tf: string, period: string): void {
  try { localStorage.removeItem(KEY(asset, tf, period)); } catch { /* stockage absent : rien à effacer */ }
}
