/// <reference lib="webworker" />
// Worker de flux : démarre la source du mode choisi, décode les messages hors
// du fil principal, mesure la latence, et transmet l'état à l'écran par lots,
// au plus FLUSH_HZ fois par seconde.
//
//   source 'gateway'    : WebSocket de la passerelle Python (Modes Local et Tour)
//   source 'okx-direct' : WebSockets publiques d'OKX lues par le navigateur (Mode Online)
//
// Les deux sources publient les mêmes clés et les mêmes formes de valeurs ;
// seule la découpe de la latence diffère (LatencyState.path).

import type { SourceConfig } from '../config/modes';
import { RollingMedian } from './latency';
import type { ConnState, DataSource, Item, LatencyState, SourceSink } from './protocol';
import { createGatewaySource } from './sources/gatewaySource';
import { createOkxSource } from './sources/okxSource';

export type ToWorker = { type: 'start'; source: SourceConfig; topics: string[]; latencyKey: string };
export type FromWorker = { type: 'batch'; items: Item[]; conn: ConnState; latency: LatencyState };

const FLUSH_HZ = 15;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let source: DataSource | null = null;
let path: LatencyState['path'] = 'gateway';
let pending: Item[] = [];
let dirty = false;
let timersStarted = false;
let total = new RollingMedian();
let okxToGw = new RollingMedian();
let gwToScreen = new RollingMedian();
let conn: ConnState = initialConn();

function initialConn(): ConnState {
  return { status: 'connecting', since: null, lastMessage: null, offsetMs: null, rttMs: null, attempts: 0 };
}

function makeSink(topics: string[], filter: boolean): SourceSink {
  return {
    item(key, value) {
      // La passerelle filtre déjà par préfixe ; la source directe publie tout.
      if (filter && !topics.some((p) => key.startsWith(p))) return;
      pending.push([key, value]);
    },
    conn(patch) {
      Object.assign(conn, patch);
      dirty = true;
    },
    latency(s) {
      total.push(s.total);
      if (s.okxToGateway !== null) okxToGw.push(s.okxToGateway);
      if (s.gatewayToScreen !== null) gwToScreen.push(s.gatewayToScreen);
    },
  };
}

function start(msg: ToWorker): void {
  // Un nouveau départ remplace la source en cours (changement de mode).
  source?.stop();
  pending = [];
  conn = initialConn();
  total = new RollingMedian();
  okxToGw = new RollingMedian();
  gwToScreen = new RollingMedian();
  dirty = true;
  const cfg = msg.source;
  if (cfg.kind === 'gateway') {
    path = 'gateway';
    source = createGatewaySource({ wsUrl: cfg.wsUrl, topics: msg.topics, latencyKey: msg.latencyKey },
      makeSink(msg.topics, false));
  } else {
    path = 'direct';
    source = createOkxSource({
      apiBase: cfg.apiBase, publicWs: cfg.publicWs, businessWs: cfg.businessWs,
      instruments: cfg.instruments, latencyKey: msg.latencyKey,
    }, makeSink(msg.topics, true));
  }
  try {
    source.start();
  } catch (e) {
    // Une source qui ne démarre pas doit le dire à l'écran, pas se taire.
    Object.assign(conn, { status: 'closed', reason: `source arrêtée : ${(e as Error).message}` });
    dirty = true;
  }
}

function flush(): void {
  if (!dirty && !pending.length) return;
  const out: FromWorker = {
    type: 'batch',
    items: pending,
    conn: { ...conn },
    latency: {
      totalMs: total.value,
      okxToGatewayMs: okxToGw.value,
      gatewayToScreenMs: gwToScreen.value,
      samples: total.count,
      path,
    },
  };
  pending = [];
  dirty = false;
  ctx.postMessage(out);
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  if (ev.data.type !== 'start') return;
  // Minuteries d'abord : même si la source échoue, l'état parvient à l'écran.
  if (!timersStarted) {
    timersStarted = true;
    setInterval(flush, 1000 / FLUSH_HZ);
    // Le statut « retard » dépend du temps qui passe, pas seulement des messages.
    setInterval(() => { dirty = true; }, 1000);
  }
  start(ev.data);
};
