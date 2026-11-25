// Source de la microstructure côté navigateur (P5, T-065, T-069), démarrée une fois à la première
// ouverture de l'écran ; elle alimente le store sous les clés `micro:*`.
//
// - Serveur (T-069) : si VITE_MICRO_SERVER_URL est renseignée, l'état vient de la machine Oracle
//   en SSE (`/micro/stream`) : l'heure de carte, les liquidations et le journal accumulés fenêtre
//   fermée arrivent à l'ouverture, puis le direct.
// - Repli : rien reçu en 5 s, erreur, ou silence de 5 s → le moteur local démarre (worker, comme
//   avant T-069) et le serveur est retenté toutes les 30 s ; à son retour, le moteur local s'arrête.
// - `micro:source` dit d'où viennent les données (puce de l'écran).
// Indépendant du mode (données publiques, aucune clé) : un changement de mode ne l'arrête pas.

import { useEffect, useState } from 'react';
import { setValue } from '../data/store';
import type { MicroFromWorker, MicroToWorker } from './micro.worker';

export const SERVER_TIMEOUT_MS = 5_000;
export const SERVER_RETRY_MS = 30_000;

type Item = [string, unknown];
export interface BrowserSource { kind: 'browser'; reason: string | null; since: number; server: string | null }

interface EventSourceLike {
  addEventListener(type: string, l: (ev: MessageEvent) => void): void;
  onerror: ((ev: Event) => void) | null;
  close(): void;
}
export interface SourceDeps {
  EventSource: new (url: string) => EventSourceLike;
  publish: (items: Item[]) => void;
  startLocal: () => void;
  stopLocal: () => void;
  now: () => number;
}

/** Serveur d'abord, moteur local en repli ; testé avec un faux EventSource (client.test.ts). */
export class MicroSource {
  private es: EventSourceLike | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private local = false;
  mode: 'connecting' | 'server' | 'local' = 'connecting';

  constructor(private readonly server: string | null, private readonly deps: SourceDeps) {}

  start(): void {
    if (!this.server) { this.fallback(null); return; }
    this.connect();
  }

  private arm(reason: string): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fallback(reason), SERVER_TIMEOUT_MS);
  }

  private connect(): void {
    this.es?.close();
    const es = new this.deps.EventSource(`${this.server}/micro/stream`);
    this.es = es;
    this.arm(`aucune réponse du serveur en ${SERVER_TIMEOUT_MS / 1000} s`);
    const onData = (ev: MessageEvent) => {
      if (this.es !== es) return;
      let items: Item[];
      try { items = JSON.parse(String(ev.data)) as Item[]; } catch { return; }
      this.arm(`serveur muet depuis ${SERVER_TIMEOUT_MS / 1000} s`);
      if (this.mode !== 'server') {
        this.mode = 'server';
        if (this.retry) { clearTimeout(this.retry); this.retry = null; }
        if (this.local) { this.deps.stopLocal(); this.local = false; }
      }
      this.deps.publish(items);
    };
    es.addEventListener('state', onData);
    es.addEventListener('items', onData);
    // EventSource se reconnecte seul ; s'il ne revient pas, le chien de garde bascule en local.
    es.onerror = () => { if (this.es === es && this.mode !== 'server') this.fallback('serveur injoignable'); };
  }

  private fallback(reason: string | null): void {
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    this.es?.close();
    this.es = null;
    if (!this.local) { this.deps.startLocal(); this.local = true; }
    if (this.mode !== 'local') {
      this.mode = 'local';
      const src: BrowserSource = { kind: 'browser', reason, since: this.deps.now(), server: this.server };
      this.deps.publish([['micro:source', src]]);
    }
    if (this.server && !this.retry) {
      this.retry = setTimeout(() => { this.retry = null; this.connect(); }, SERVER_RETRY_MS);
    }
  }

  stop(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    if (this.retry) clearTimeout(this.retry);
    this.es?.close();
    if (this.local) this.deps.stopLocal();
  }
}

// --- Moteur local --------------------------------------------------------------------------------

let worker: Worker | null = null;
let inlineTimer: ReturnType<typeof setInterval> | null = null;
let inlineEngine: { stop(): void } | null = null;
let source: MicroSource | null = null;

const publish = (items: Item[]) => { for (const [k, v] of items) setValue(k, v); };
const devParam = (name: string) => (import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search).get(name) : null);

/** Tests de bout en bout seulement (serveur de dev, `?microInline=1`) : Playwright n'intercepte pas
 *  les WebSockets ouvertes dans un worker ; le même moteur tourne alors sur le fil principal.
 *  Branche retirée du build de production (import.meta.env.DEV). */
async function startInline(): Promise<void> {
  const [{ MicroEngine }, { relayStatUrl }] = await Promise.all([import('./engine'), import('./backfill')]);
  const e = new MicroEngine({ WebSocket: WebSocket as never, fetch: (u, i) => fetch(u, i), now: () => Date.now(), random: Math.random, okxStatsUrl: relayStatUrl });
  e.start();
  inlineEngine = e;
  inlineTimer = setInterval(() => publish(e.publish()), 100);
}

function startLocal(): void {
  if (import.meta.env.DEV && devParam('microInline') !== null) { void startInline(); return; }
  if (typeof Worker === 'undefined' || worker) return;
  const w = new Worker(new URL('./micro.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (ev: MessageEvent<MicroFromWorker>) => { if (worker === w) publish(ev.data.items); };
  const start: MicroToWorker = { type: 'start' };
  w.postMessage(start);
}

function stopLocal(): void {
  worker?.terminate();
  worker = null;
  if (inlineTimer) clearInterval(inlineTimer);
  inlineTimer = null;
  inlineEngine?.stop();
  inlineEngine = null;
}

/** Adresse du serveur : VITE_MICRO_SERVER_URL ; en développement, `?microServer=` la remplace (tests). */
export function microServerUrl(): string | null {
  const dev = import.meta.env.DEV ? devParam('microServer') : null;
  const url = dev ?? (import.meta.env.VITE_MICRO_SERVER_URL as string | undefined) ?? '';
  return url.trim().replace(/\/+$/, '') || null;
}

export function startMicro(): void {
  if (source) return;
  if (typeof EventSource === 'undefined' && typeof Worker === 'undefined') return;
  source = new MicroSource(microServerUrl(), {
    EventSource: (typeof EventSource !== 'undefined' ? EventSource : class { addEventListener() {} onerror = null; close() {} }) as never,
    publish, startLocal, stopLocal, now: () => Date.now(),
  });
  source.start();
}

export const microStarted = () => source !== null;

/** Heure du navigateur, rafraîchie chaque seconde : celle du moteur (Date.now) pour juger la
 *  fraîcheur des flux, jamais l'horloge de la passerelle (décalée en démonstration). */
export function useBrowserNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
