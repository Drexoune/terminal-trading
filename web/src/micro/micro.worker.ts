/// <reference lib="webworker" />
// Worker de la microstructure (P5, T-065) : lit les WebSockets publiques des plateformes et leurs
// historiques REST, hors du fil principal et à part du worker de flux (data/worker.ts), pour
// qu'un carnet lourd ne ralentisse jamais la watchlist ni le graphique. Démarré à la première
// ouverture de /microstructure, il tourne tant que l'application est ouverte (l'historique de la
// carte et des liquidations s'accumule même hors de l'écran). Lots publiés au plus 10 fois par seconde.

import type { Item } from '../data/protocol';
import { relayStatUrl } from './backfill';
import { MicroEngine } from './engine';

export type MicroToWorker = { type: 'start' };
export type MicroFromWorker = { type: 'batch'; items: Item[] };

export const MICRO_FLUSH_HZ = 10;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: MicroEngine | null = null;

ctx.onmessage = (ev: MessageEvent<MicroToWorker>) => {
  if (ev.data.type !== 'start' || engine) return;
  engine = new MicroEngine({
    WebSocket: WebSocket as never,
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
    random: Math.random,
    okxStatsUrl: relayStatUrl,
  });
  engine.start();
  setInterval(() => {
    try {
      const out: MicroFromWorker = { type: 'batch', items: engine!.publish() };
      ctx.postMessage(out);
    } catch (e) { console.error('micro : publication impossible', e); }
  }, 1000 / MICRO_FLUSH_HZ);
};
