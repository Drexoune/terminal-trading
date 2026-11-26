// Espaces de travail (stack § 4, plan « panneaux liés, mises en page sauvegardées ») : mises en page
// dockview nommées, gardées dans ce navigateur (préférence d'affichage, aucune donnée de marché) ;
// la disposition en cours est reprise à la réouverture. Deux modèles prêts à l'emploi.

export interface PanelSpec { id: string; screen: string; title: string }
export interface SavedLayout { name: string; saved_ms: number; layout: unknown; asset: string | null }

const KEY = 'workspace:layouts';
export const CURRENT = 'workspace:current';
export const NAME_MAX = 40;

const read = <T>(k: string): T | null => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : null; } catch { return null; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

/** Une mise en page dockview lisible : un objet avec une grille et des panneaux. */
export function validLayout(x: unknown): boolean {
  return !!x && typeof x === 'object' && 'grid' in (x as object) && 'panels' in (x as object) && typeof (x as { panels: unknown }).panels === 'object';
}

export function listLayouts(): SavedLayout[] {
  const all = read<SavedLayout[]>(KEY);
  return Array.isArray(all) ? all.filter((l) => l && typeof l.name === 'string' && validLayout(l.layout)).sort((a, b) => a.name.localeCompare(b.name, 'fr')) : [];
}

export class LayoutError extends Error {}

/** Enregistre (ou remplace) une mise en page nommée. */
export function saveLayout(name: string, layout: unknown, asset: string | null, now: number): SavedLayout[] {
  const n = name.trim();
  if (!n) throw new LayoutError('nom de la mise en page manquant');
  if (n.length > NAME_MAX) throw new LayoutError(`nom de ${NAME_MAX} caractères au plus`);
  if (!validLayout(layout)) throw new LayoutError('mise en page vide : ajouter au moins un écran');
  const next = [...listLayouts().filter((l) => l.name !== n), { name: n, saved_ms: now, layout, asset }];
  if (!write(KEY, next)) throw new LayoutError('stockage du navigateur indisponible (navigation privée ?)');
  return listLayouts();
}

export function deleteLayout(name: string): SavedLayout[] {
  write(KEY, listLayouts().filter((l) => l.name !== name));
  return listLayouts();
}

export const loadCurrent = () => { const c = read<{ layout: unknown; asset: string | null }>(CURRENT); return c && validLayout(c.layout) ? c : null; };
export const saveCurrent = (layout: unknown, asset: string | null) => write(CURRENT, { layout, asset });

/** Modèles : écrans et disposition (direction par rapport au panneau précédent). */
export interface Preset { id: string; label: string; panels: { screen: string; position?: { ref: number; direction: 'right' | 'below' | 'within' } }[] }
export const PRESETS: Preset[] = [
  { id: 'btc', label: 'Séance BTC', panels: [
    { screen: 'charts' }, { screen: 'micro', position: { ref: 0, direction: 'right' } },
    { screen: 'news', position: { ref: 0, direction: 'below' } }, { screen: 'calendar', position: { ref: 2, direction: 'within' } },
  ] },
  { id: 'macro', label: 'Macro', panels: [
    { screen: 'rates' }, { screen: 'heatmap', position: { ref: 0, direction: 'right' } },
    { screen: 'calendar', position: { ref: 0, direction: 'below' } }, { screen: 'risk', position: { ref: 1, direction: 'below' } },
  ] },
  { id: 'tech', label: 'Analyse technique (panneaux liés)', panels: [
    { screen: 'techmap' }, { screen: 'indicators', position: { ref: 0, direction: 'right' } }, { screen: 'season', position: { ref: 1, direction: 'below' } },
  ] },
];
