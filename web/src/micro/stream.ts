// Connexion WebSocket générique d'une plateforme (P5, T-065) : même cycle que OkxStream
// (data/sources/okxSource.ts) — délai d'ouverture, maintien en vie propre à chaque plateforme,
// reconnexion à délai croissant avec gigue (1 à 30 s), journal des coupures — plus un journal des
// trous (resynchronisation d'un carnet, rupture de séquence des trades) affiché à l'écran.

import type { FeedState, Outage, WebSocketCtor, WebSocketLike } from '../data/protocol';
import { WS_OPEN } from '../data/protocol';
import { backoffDelay } from '../data/sources/okxSource';
import type { Venue } from './types';

export const OPEN_TIMEOUT_MS = 10_000;
export const OUTAGES_KEPT = 10;
export const GAPS_KEPT = 20;

export interface Gap { at_ms: number; text: string }
export interface MicroFeedState extends FeedState { venue: Venue; gaps: Gap[]; messages: number }

export type MessageResult = 'ack' | 'data' | 'ignore' | { error: string };

export interface StreamSpec {
  name: string;                 // micro:feed:<name>
  label: string;                // « Binance WS (perp) »
  venue: Venue;
  url: string;
  /** Messages envoyés à l'ouverture (abonnements). */
  subscribe: () => string[];
  /** Ping applicatif après `quietMs` de silence ; sans ping, le silence seul fait reconnecter. */
  ping?: string;
  quietMs: number;
  /** Lit un message ; « ack » confirme l'abonnement, une erreur fait refaire la connexion. */
  onMessage: (raw: string, recv: number) => MessageResult;
  /** Appelé à chaque nouvelle connexion (remise à zéro du carnet). */
  onOpen?: () => void;
}

export interface StreamDeps { WebSocket: WebSocketCtor; now: () => number; random: () => number }

type Timer = ReturnType<typeof setTimeout>;
const secs = (ms: number) => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;

export class VenueStream {
  readonly state: MicroFeedState;
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private pendingPong = false;
  private quietSince = 0;
  private watchdog: Timer | null = null;
  private retry: Timer | null = null;
  private downSince: number | null = null;

  constructor(readonly spec: StreamSpec, private readonly deps: StreamDeps, private readonly onState: (s: MicroFeedState) => void) {
    this.state = { name: spec.name, label: spec.label, venue: spec.venue, status: 'connecting', connected_since_ms: null, last_message_ms: null,
      reconnects: 0, outages: [], last_error: null, gaps: [], messages: 0 };
  }

  get attempts(): number { return this.attempt; }

  snapshot(): MicroFeedState {
    return { ...this.state, outages: this.state.outages.slice(-OUTAGES_KEPT), gaps: this.state.gaps.slice(-GAPS_KEPT) };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.detach();
    this.state.status = 'stopped';
    this.onState(this.snapshot());
  }

  /** Trou de données signalé par l'adaptateur (carnet resynchronisé, séquence rompue). */
  gap(text: string): void {
    this.state.gaps.push({ at_ms: this.deps.now(), text });
    if (this.state.gaps.length > GAPS_KEPT) this.state.gaps.shift();
    console.warn(`${this.spec.name} : ${text}`);
    this.onState(this.snapshot());
  }

  /** Reconnexion demandée par l'adaptateur (carnet impossible à resynchroniser en place). */
  restart(reason: string): void {
    this.fail(reason);
  }

  send(msg: string): void {
    if (this.ws?.readyState === WS_OPEN) this.ws.send(msg);
  }

  private connect(): void {
    this.retry = null;
    if (this.stopped) return;
    this.pendingPong = false;
    let sock: WebSocketLike;
    try {
      sock = new this.deps.WebSocket(this.spec.url);
    } catch (e) {
      this.fail(`connexion impossible : ${(e as Error).message}`);
      return;
    }
    this.ws = sock;
    this.quietSince = this.deps.now();
    this.arm(OPEN_TIMEOUT_MS);
    sock.onopen = () => {
      if (this.ws !== sock) return;
      this.quietSince = this.deps.now();
      this.arm(this.spec.quietMs);
      this.spec.onOpen?.();
      for (const m of this.spec.subscribe()) sock.send(m);
    };
    sock.onmessage = (ev) => { if (this.ws === sock) this.message(String(ev.data)); };
    sock.onclose = (ev) => { if (this.ws === sock) this.fail(`connexion fermée (code ${ev.code}${ev.reason ? ` : ${ev.reason}` : ''})`); };
    sock.onerror = () => { if (this.ws === sock) this.fail('erreur WebSocket'); };
  }

  private arm(ms: number): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.tick(), Math.max(1, ms));
  }

  private tick(): void {
    this.watchdog = null;
    const sock = this.ws;
    if (!sock || this.stopped) return;
    if (sock.readyState !== WS_OPEN) { this.fail(`pas de connexion en ${secs(OPEN_TIMEOUT_MS)}`); return; }
    const quiet = this.deps.now() - this.quietSince;
    if (quiet < this.spec.quietMs) { this.arm(this.spec.quietMs - quiet); return; }
    if (!this.spec.ping || this.pendingPong) { this.fail(`aucun message en ${secs(quiet)}`); return; }
    sock.send(this.spec.ping);
    this.pendingPong = true;
    this.quietSince = this.deps.now();
    this.arm(this.spec.quietMs);
  }

  private connected(recv: number): void {
    if (this.state.status === 'connected') return;
    this.state.status = 'connected';
    this.state.connected_since_ms = recv;
    this.state.last_error = null;
    if (this.downSince !== null) {
      const o: Outage = { from_ms: this.downSince, to_ms: recv, duration_ms: recv - this.downSince };
      this.state.outages.push(o);
      if (this.state.outages.length > OUTAGES_KEPT) this.state.outages.shift();
      this.downSince = null;
    }
    this.onState(this.snapshot());
  }

  private message(raw: string): void {
    const recv = this.deps.now();
    this.quietSince = recv;
    this.pendingPong = false;
    this.state.last_message_ms = recv;
    this.state.messages++;
    let r: MessageResult;
    try {
      r = this.spec.onMessage(raw, recv);
    } catch (e) {
      this.fail(`message illisible : ${(e as Error).message}`.slice(0, 200));
      return;
    }
    if (typeof r === 'object') { this.fail(r.error); return; }
    if (r === 'ack') this.connected(recv);
    else if (r === 'data') { this.attempt = 0; this.connected(recv); }
  }

  private fail(reason: string): void {
    if (this.stopped) return;
    this.detach();
    this.state.last_error = reason;
    this.attempt += 1;
    this.state.reconnects += 1;
    this.state.status = 'reconnecting';
    this.state.connected_since_ms = null;
    if (this.downSince === null) this.downSince = this.deps.now();
    this.onState(this.snapshot());
    const delay = backoffDelay(this.attempt, this.deps.random);
    console.warn(`${this.spec.name} : connexion perdue (${reason}), reconnexion dans ${secs(delay)} (tentative ${this.attempt})`);
    this.retry = setTimeout(() => this.connect(), delay);
  }

  private detach(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    const sock = this.ws;
    this.ws = null;
    if (!sock) return;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try { sock.close(); } catch { /* déjà fermée */ }
  }
}
