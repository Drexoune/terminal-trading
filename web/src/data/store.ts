// Store du fil principal : dernier état par clé, alimenté par le worker.
// Les composants s'abonnent à une clé précise (useValue) ; les graphiques
// peuvent aussi recevoir chaque mise à jour d'une clé (onItem), y compris
// plusieurs valeurs successives d'une même bougie dans un même lot.
//
// La source du worker dépend du mode (config/modes.ts) : passerelle du Mac,
// passerelle de la tour, ou OKX en direct depuis le navigateur. Un changement
// de mode ou d'adresse active redémarre le worker et vide le store : le
// contenu d'un mode ne se mélange jamais à celui d'un autre.

import { useSyncExternalStore } from 'react';
import type { FromWorker, ToWorker } from './worker';
import type { ConnState, LatencyState } from './protocol';
import { WATCHED_TOPICS } from './protocol';
import { modeDef, sourceFor, type Settings } from '../config/modes';
import { activeUrl, getSettings, subscribeSettings } from '../config/settings';
import { NOT_CONFIGURED } from './gateway';

type Listener = () => void;
type ItemListener = (value: unknown) => void;

/** État de connexion publié dans le store, avec la raison d'un arrêt quand elle est connue. */
export type FeedConn = ConnState & { reason?: string };

const values = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();
const itemListeners = new Map<string, Set<ItemListener>>();

export const CONN_KEY = '$conn';
export const LATENCY_KEY = '$latency';
export const MAIN_INST = 'BTC-USDT-SWAP';

function notify(key: string): void {
  listeners.get(key)?.forEach((l) => l());
}

export function setValue(key: string, value: unknown): void {
  values.set(key, value);
  // Un écouteur en erreur ne doit jamais empêcher les autres mises à jour du lot.
  itemListeners.get(key)?.forEach((l) => {
    try { l(value); } catch (e) { console.error(`écouteur de ${key} en erreur`, e); }
  });
  notify(key);
}

export function getValue<T>(key: string): T | undefined {
  return values.get(key) as T | undefined;
}

/** Vide toutes les valeurs et prévient chaque abonné (changement de source). */
export function clearValues(): void {
  const keys = new Set([...values.keys(), ...listeners.keys()]);
  values.clear();
  keys.forEach(notify);
}

export function subscribeKey(key: string, l: Listener): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(l);
  return () => set!.delete(l);
}

export function onItem(key: string, l: ItemListener): () => void {
  let set = itemListeners.get(key);
  if (!set) itemListeners.set(key, (set = new Set()));
  set.add(l);
  return () => set!.delete(l);
}

export function useValue<T>(key: string): T | undefined {
  return useSyncExternalStore(
    (l) => subscribeKey(key, l),
    () => values.get(key) as T | undefined,
  );
}

export const useConn = () => useValue<FeedConn>(CONN_KEY);
export const useLatency = () => useValue<LatencyState>(LATENCY_KEY);

function connState(status: ConnState['status'], reason?: string): FeedConn {
  return { status, since: null, lastMessage: null, offsetMs: null, rttMs: null, attempts: 0, reason };
}

/** Ce qui impose un redémarrage : le mode et l'adresse qu'il utilise. */
export function feedKey(s: Settings): string {
  return `${s.mode}|${activeUrl(s)}`;
}

let worker: Worker | null = null;
let started = false;
let activeKey: string | null = null;

/** Démarre le worker de flux sur la source du mode actif (une fois). */
export function startFeed(): void {
  if (worker) return;
  if (!started) {
    started = true;
    // Mode ou adresse active changés (écran Paramètres, autre onglet) : on redémarre.
    subscribeSettings(() => {
      if (feedKey(getSettings()) !== activeKey) restartFeed();
    });
  }
  const settings = getSettings();
  activeKey = feedKey(settings);
  const source = sourceFor(settings);
  if (!source) {
    // Seul le Mode Tour sans adresse arrive ici : rien à joindre, on le dit.
    const reason = settings.mode === 'tour' ? NOT_CONFIGURED
      : `${modeDef(settings.mode).label} : adresse de la passerelle invalide`;
    setValue(CONN_KEY, connState('closed', reason));
    return;
  }
  setValue(CONN_KEY, connState('connecting'));
  if (typeof Worker === 'undefined') return;
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (ev: MessageEvent<FromWorker>) => {
    if (worker !== w) return; // lot d'un worker arrêté, arrivé après le changement de mode
    for (const [k, v] of ev.data.items) setValue(k, v);
    setValue(CONN_KEY, ev.data.conn);
    setValue(LATENCY_KEY, ev.data.latency);
  };
  const start: ToWorker = {
    type: 'start', source, topics: WATCHED_TOPICS, latencyKey: `trade:${MAIN_INST}`,
  };
  w.postMessage(start);
}

/** Arrête le worker, vide le store, prévient les abonnés et repart sur le mode actif. */
export function restartFeed(): void {
  worker?.terminate();
  worker = null;
  clearValues();
  startFeed();
}

/** Heure de la source (passerelle, ou horloge OKX en Mode Online), à défaut celle du navigateur. */
export function gatewayNow(): number {
  const conn = values.get(CONN_KEY) as ConnState | undefined;
  return Date.now() + (conn?.offsetMs ?? 0);
}
