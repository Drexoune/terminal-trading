// Source « passerelle » (Modes Local et Tour) : la WebSocket de la passerelle
// Python, sur le Mac ou sur la tour. Abonnement par préfixes de clés, ping
// toutes les 5 s pour l'horloge et l'aller-retour, reconnexion à délai
// croissant, latence découpée en OKX -> passerelle -> navigateur.
//
// Horloges : ts_source est l'heure d'OKX, ts_recv celle de la machine de la
// passerelle. L'écart machine ↔ OKX publié par la passerelle (clock:okx) est
// ajouté avant le calcul, pour que la latence ne dépende pas de l'horloge de la
// tour ou du Mac (même référence OKX qu'en Mode Online).

import { ClockSync, legs, pingSample } from '../latency';
import type {
  ClockState, DataSource, ServerMessage, SourceSink, Trade, WebSocketCtor, WebSocketLike,
} from '../protocol';
import { WS_OPEN } from '../protocol';

export const PING_EVERY_MS = 5_000;
/** La passerelle republie l'état des flux chaque seconde : 3 pings sans rien recevoir = connexion morte. */
export const SILENCE_LIMIT_MS = 3 * PING_EVERY_MS;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface GatewaySourceOptions { wsUrl: string; topics: string[]; latencyKey: string }

export interface GatewayDeps {
  WebSocket: WebSocketCtor;
  now: () => number;      // heure navigateur, ms
  random: () => number;
}

const browserDeps = (): GatewayDeps => ({ WebSocket, now: () => Date.now(), random: Math.random });

export function createGatewaySource(opts: GatewaySourceOptions, sink: SourceSink,
  deps: GatewayDeps = browserDeps()): DataSource {
  let ws: WebSocketLike | null = null;
  let stopped = false;
  let open = false;           // passé à 'open' par un premier message de données
  let attempts = 0;
  let pingId = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRecv = 0;           // heure navigateur du dernier message (pong compris)
  let okxOffsetMs = 0;        // heure OKX − heure de la passerelle (clock:okx)
  const pingsInFlight = new Map<number, number>();
  const clock = new ClockSync();

  /** Abandonne la connexion `sock` et programme la suivante (délai croissant). */
  function drop(sock: WebSocketLike): void {
    if (ws !== sock || stopped) return;
    ws = null;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try { sock.close(); } catch { /* déjà fermée */ }
    attempts += 1;
    sink.conn({ status: 'closed', since: null, attempts });
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (attempts - 1));
    retryTimer = setTimeout(connect, base + deps.random() * base * 0.25);
  }

  function connect(): void {
    if (stopped) return;
    open = false;
    pingsInFlight.clear();
    sink.conn({ status: 'connecting' });
    let sock: WebSocketLike;
    try {
      sock = new deps.WebSocket(opts.wsUrl);
    } catch (e) {
      // Adresse refusée par le navigateur : réessayer ne changerait rien.
      sink.conn({ status: 'closed', since: null, reason: `adresse WebSocket refusée : ${(e as Error).message}` });
      return;
    }
    ws = sock;
    lastRecv = deps.now();
    sock.onopen = () => {
      attempts = 0;
      sink.conn({ attempts });
      sock.send(JSON.stringify({ op: 'subscribe', topics: opts.topics }));
      ping();
    };
    sock.onmessage = (ev) => onMessage(ev.data as string);
    sock.onclose = () => drop(sock);
    sock.onerror = () => drop(sock);
  }

  function ping(): void {
    if (!ws || ws.readyState !== WS_OPEN) return;
    // Connexion muette (tour éteinte, Tailscale coupé sans fermeture TCP) :
    // la socket reste « ouverte » pendant des minutes, on la remplace.
    if (deps.now() - lastRecv > SILENCE_LIMIT_MS) {
      drop(ws);
      return;
    }
    pingId += 1;
    const t0 = deps.now();
    pingsInFlight.set(pingId, t0);
    ws.send(JSON.stringify({ op: 'ping', id: pingId, t0 }));
  }

  function onMessage(raw: string): void {
    const now = deps.now();
    lastRecv = now;
    const msg = JSON.parse(raw) as ServerMessage;
    if (msg.type === 'pong') {
      const t0 = pingsInFlight.get(msg.id);
      pingsInFlight.delete(msg.id);
      if (t0 !== undefined) {
        clock.add(pingSample(t0, msg.ts, now));
        sink.conn({ offsetMs: clock.best?.offsetMs ?? null, rttMs: clock.best?.rttMs ?? null });
      }
      return;
    }
    if (msg.type === 'hello') return;
    if (!open) {
      open = true;
      sink.conn({ status: 'open', since: clock.toGateway(now) });
    }
    sink.conn({ lastMessage: clock.toGateway(now) });
    // L'écart d'horloge du lot s'applique avant les trades du même lot.
    for (const [key, value] of msg.items) {
      if (key === 'clock:okx') okxOffsetMs = (value as ClockState).offset_ms ?? 0;
    }
    for (const [key, value] of msg.items) {
      sink.item(key, value);
      if (msg.type === 'delta' && key === opts.latencyKey && clock.best) {
        const t = value as Trade;
        // Tout ramené sur l'horloge OKX : réception passerelle et navigateur + écart.
        const l = legs(t.ts_source, t.ts_recv + okxOffsetMs, clock.toGateway(now) + okxOffsetMs);
        sink.latency({ total: l.total, okxToGateway: l.okxToGateway, gatewayToScreen: l.gatewayToScreen });
      }
    }
  }

  return {
    start() {
      stopped = false;
      connect();
      pingTimer = setInterval(ping, PING_EVERY_MS);
    },
    stop() {
      stopped = true;
      if (pingTimer) clearInterval(pingTimer);
      if (retryTimer) clearTimeout(retryTimer);
      pingTimer = retryTimer = null;
      const sock = ws;
      ws = null; // onclose ignore alors la fermeture : pas de reconnexion
      if (sock) {
        sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
        sock.close();
      }
      sink.conn({ status: 'closed', since: null });
    },
  };
}
