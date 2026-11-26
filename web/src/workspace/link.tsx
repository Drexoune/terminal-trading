// Panneaux liés (plan, barre de commande « panneaux liés ») : dans un espace de travail, l'actif
// choisi dans un panneau (heatmap technique, indicateurs, saisonnalité) devient l'actif de tous les
// panneaux qui savent l'afficher. Hors espace de travail, chaque écran garde son propre choix.

import { createContext, useContext } from 'react';

export interface Link { asset: string; setAsset: (a: string) => void }
export const LinkContext = createContext<Link | null>(null);

/** Lien d'actif de l'espace de travail courant, ou null hors espace de travail. */
export const useLink = () => useContext(LinkContext);

/** Actif affiché : celui du lien s'il fait partie des choix de l'écran, sinon le choix propre de l'écran. */
export function linkedChoice<T extends string>(link: Link | null, allowed: readonly T[], own: T): T {
  return link && (allowed as readonly string[]).includes(link.asset) ? link.asset as T : own;
}
