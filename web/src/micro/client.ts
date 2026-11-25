// Démarrage du worker de la microstructure depuis le fil principal (P5, T-065) : une seule fois,
// à la première ouverture de l'écran ; ses lots alimentent le store sous les clés `micro:*`.
// Indépendant du mode (données publiques, aucune clé) : un changement de mode ne l'arrête pas.

import { useEffect, useState } from 'react';
import { setValue } from '../data/store';
import type { MicroFromWorker, MicroToWorker } from './micro.worker';

let worker: Worker | null = null;
let inline = false;

/** Tests de bout en bout seulement (serveur de dev, `?microInline=1`) : Playwright n'intercepte pas
 *  les WebSockets ouvertes dans un worker ; le même moteur tourne alors sur le fil principal.
 *  Branche retirée du build de production (import.meta.env.DEV). */
async function startInline(): Promise<void> {
  inline = true;
  const [{ MicroEngine }, { OKX_STATS_RELAY }] = await Promise.all([import('./engine'), import('./backfill')]);
  const e = new MicroEngine({ WebSocket: WebSocket as never, fetch: (u, i) => fetch(u, i), now: () => Date.now(), random: Math.random, okxStatsBase: OKX_STATS_RELAY });
  e.start();
  setInterval(() => { for (const [k, v] of e.publish()) setValue(k, v); }, 100);
}

export function startMicro(): void {
  if (worker || inline) return;
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('microInline')) { void startInline(); return; }
  if (typeof Worker === 'undefined') return;
  const w = new Worker(new URL('./micro.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (ev: MessageEvent<MicroFromWorker>) => {
    for (const [k, v] of ev.data.items) setValue(k, v);
  };
  const start: MicroToWorker = { type: 'start' };
  w.postMessage(start);
}

export const microStarted = () => worker !== null || inline;

/** Heure du navigateur, rafraîchie chaque seconde : celle du worker (Date.now) pour juger la
 *  fraîcheur des flux, jamais l'horloge de la passerelle (décalée en démonstration). */
export function useBrowserNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
