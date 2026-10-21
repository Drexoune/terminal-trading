// Réglages du terminal à l'exécution, au-dessus du contrat de modes.ts : état
// courant, enregistrement sur cet appareil (stockage local du navigateur) et
// abonnement, pour que le flux et les graphiques suivent un changement de mode.
//
// Le stockage peut manquer (navigation privée, données bloquées) : le réglage
// vaut alors pour la session, et rien ne lève d'exception.

import { useSyncExternalStore } from 'react';
import {
  defaultSettings, loadSettings, normalizeUrl, saveSettings, STORAGE_KEY, validateGatewayUrl,
  type BuildEnv, type Mode, type Settings,
} from './modes';

type StorageLike = Parameters<typeof loadSettings>[0];
type Listener = () => void;

/** Stockage local du navigateur, ou null s'il est inaccessible. */
export function browserStorage(): StorageLike {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // l'accès lui-même peut lever (données de site bloquées)
  }
}

export function sameSettings(a: Settings, b: Settings): boolean {
  return a.mode === b.mode && a.localUrl === b.localUrl && a.tourUrl === b.tourUrl;
}

/** Adresse active du mode (vide en Mode Online, qui n'a pas de passerelle). */
export function activeUrl(s: Settings): string {
  return s.mode === 'local' ? s.localUrl : s.mode === 'tour' ? s.tourUrl : '';
}

/**
 * Réglages acceptables : adresses normalisées, une adresse refusée garde la
 * valeur précédente (l'écran bloque déjà « Appliquer » dans ce cas).
 */
export function sanitizeSettings(next: Settings, prev: Settings): Settings {
  const localUrl = normalizeUrl(next.localUrl);
  const tourUrl = normalizeUrl(next.tourUrl);
  const mode: Mode = next.mode === 'online' || next.mode === 'local' || next.mode === 'tour'
    ? next.mode : prev.mode;
  return {
    mode,
    localUrl: validateGatewayUrl(localUrl) ? prev.localUrl : localUrl,
    tourUrl: tourUrl === '' || !validateGatewayUrl(tourUrl) ? tourUrl : prev.tourUrl,
  };
}

export interface SettingsStore {
  get(): Settings;
  /** Applique et enregistre ; renvoie false si le stockage de l'appareil a refusé. */
  set(next: Settings): boolean;
  subscribe(l: Listener): () => void;
  /** Relit le stockage (changement fait dans un autre onglet). */
  reload(): void;
}

export function createSettingsStore(storage: StorageLike, defaults: Settings): SettingsStore {
  let current = loadSettings(storage, defaults);
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => {
    // Un abonné en erreur ne doit pas empêcher les autres de suivre le changement.
    try { l(); } catch (e) { console.error('abonné aux réglages en erreur', e); }
  });
  return {
    get: () => current,
    set(next) {
      const s = sanitizeSettings(next, current);
      const saved = saveSettings(storage, s);
      if (!sameSettings(s, current)) {
        current = s;
        emit();
      }
      return saved;
    },
    subscribe(l) {
      listeners.add(l);
      return () => { listeners.delete(l); };
    },
    reload() {
      const s = loadSettings(storage, defaults);
      if (!sameSettings(s, current)) {
        current = s;
        emit();
      }
    },
  };
}

// Variables de build publiques (jamais de secret) : mode par défaut et adresses des passerelles.
const BUILD_ENV: BuildEnv = {
  VITE_DEFAULT_MODE: import.meta.env.VITE_DEFAULT_MODE,
  VITE_LOCAL_GATEWAY_URL: import.meta.env.VITE_LOCAL_GATEWAY_URL,
  VITE_TOUR_GATEWAY_URL: import.meta.env.VITE_TOUR_GATEWAY_URL,
};

const store = createSettingsStore(
  browserStorage(),
  defaultSettings(BUILD_ENV, typeof location === 'undefined' ? '' : location.hostname),
);

// Un autre onglet a changé de mode : celui-ci suit, pour ne pas afficher deux sources.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) store.reload(); });
}

export const getSettings = (): Settings => store.get();
export const setSettings = (next: Settings): boolean => store.set(next);
export const subscribeSettings = (l: Listener): (() => void) => store.subscribe(l);

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
