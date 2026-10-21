// Source « OKX direct » (Mode Online) : le worker du navigateur lit lui-même les
// WebSockets publiques d'OKX EEA, sans passerelle. C'est le travail de
// gateway/terminal_gateway/okx_service.py et de collectors/…/okx/ws.py, refait
// dans le navigateur, avec les mêmes clés et les mêmes valeurs :
//
//   ticker:<inst>  trade:<inst>  funding:<inst>  oi:<inst>  candle:1m:<inst>
//   instrument:<inst>   GET {apiBase}/api/instruments?inst= (fonction Vercel : le
//                       REST d'OKX refuse le CORS), lu une fois par instrument
//   feed:okx-public, feed:okx-business   état des deux connexions, chaque seconde
//   clock:okx           écart navigateur ↔ OKX, chaque minute (GET {apiBase}/api/okx-time)
//   gaps:okx            trous de séquence des trades (okx/gaps.ts)
//   gateway:meta        origine des données
//
// Toutes les heures publiées (ts_recv, last_message_ms, coupures…) sont des
// heures navigateur corrigées sur l'horloge OKX ; avant la première mesure,
// l'heure du navigateur telle quelle.
//
// Règles OKX v5, section « Connect » (docs/okx.md) :
// - la connexion tombe sans donnée pendant 30 s : après 20 s de silence, envoyer
//   la chaîne 'ping' et attendre 'pong' (ou tout autre message) dans les 20 s,
//   sinon reconnecter ;
// - au plus 3 connexions par seconde et par IP : deux connexions seulement, et
//   chacune attend au moins 1 s avant de se refaire (délai croissant jusqu'à
//   30 s, avec gigue) ;
// - un abonnement refusé pour un instrument ou un canal inexistant (60018) est
//   écarté et affiché ; OKX garde la connexion et sert les autres abonnements
//   (observé sur wseea le 21/10/2026). Toute autre erreur fait refaire la
//   connexion, comme dans la passerelle : l'erreur reste visible dans l'état du flux.
// Vérifié en réel le 20/10/2026 (Node 22, WebSocket native) : abonnements,
// 'ping' -> 'pong', refus 60018, aucune rupture de séquence en 20 s.
// À vérifier au déploiement : connexion depuis la page servie par Vercel (en-tête
// Origin du navigateur), et minuteries du worker quand l'onglet passe en
// arrière-plan (un ping en retard ne coûte qu'une reconnexion).

import { bestSample, pingSample, type PingSample } from '../latency';
import { TradeSequence, type TradeGap } from '../okx/gaps';
import { Control, parse, type OkxEvent } from '../okx/parse';
import type {
  ClockState, DataSource, FeedState, FetchLike, GapsState, GatewayMeta, InstrumentMeta, SourceSink,
  WebSocketCtor, WebSocketLike,
} from '../protocol';
import { WS_OPEN } from '../protocol';

export const KEEPALIVE_MS = 20_000;       // N < 30 s, cf. doc OKX
export const OPEN_TIMEOUT_MS = 10_000;    // comme open_timeout côté Python
export const BACKOFF_MIN_MS = 1_000;      // 3 connexions/s/IP au maximum
export const BACKOFF_MAX_MS = 30_000;
export const FEED_HEARTBEAT_MS = 1_000;
export const OUTAGES_KEPT = 10;
export const CLOCK_EVERY_MS = 60_000;
export const CLOCK_SAMPLES = 5;
export const CLOCK_SPACING_MS = 200;
// Au-delà, l'horloge du navigateur est jugée fausse (même seuil que la
// passerelle et drexbot). Les heures restent corrigées ; l'écran le signale.
export const CLOCK_MAX_DRIFT_MS = 5_000;
export const INSTRUMENT_RETRY_MIN_MS = 5_000;
export const INSTRUMENT_RETRY_MAX_MS = 60_000;

const PUBLIC_CHANNELS = ['trades', 'tickers', 'funding-rate', 'open-interest'];

// « Subscribe failed, wrong URL or channel:tickers,instId:FOO-USDT-SWAP doesn't exist. »
const REJECTED = /channel:([^,\s]+),instId:(\S+) doesn't exist/;

export const ONLINE_META: GatewayMeta = {
  source: 'Données réelles · OKX EEA', region: 'eea', host: 'navigateur', mode: 'online',
};

/** Dépendances injectées : les vraies dans le navigateur, des fausses dans les tests. */
export interface OkxDeps {
  WebSocket: WebSocketCtor;
  fetch: FetchLike;
  now: () => number;      // heure navigateur, ms
  random: () => number;
}

const browserDeps = (): OkxDeps => ({
  WebSocket, fetch: (url, init) => fetch(url, init), now: () => Date.now(), random: Math.random,
});

type Timer = ReturnType<typeof setTimeout>;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const round1 = (x: number) => Math.round(x * 10) / 10;
const seconds = (ms: number) => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`;

/** Délai avant la tentative `attempt` (1, 2, 3…) : exponentiel, plafonné, avec gigue (ws.py). */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (attempt - 1));
  return Math.min(BACKOFF_MAX_MS, base + random() * base * 0.25);
}

interface StreamHooks {
  onEvents(events: OkxEvent[]): void;
  onState(state: FeedState): void;
  onMessage(recv: number): void;
}

/** Une connexion OKX (publique ou business) et ses abonnements : OkxStream de ws.py. */
export class OkxStream {
  readonly state: FeedState;
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private attempt = 0;           // échecs consécutifs depuis la dernière donnée reçue
  private pendingPong = false;
  private quietSince = 0;        // heure navigateur du dernier message (ou du dernier ping)
  private watchdog: Timer | null = null;
  private retry: Timer | null = null;
  private downSince: number | null = null;
  /** Abonnements demandés ; un abonnement refusé par OKX en est retiré. */
  readonly args: { channel: string; instId: string }[];

  constructor(
    readonly name: string,
    readonly url: string,
    args: { channel: string; instId: string }[],
    private readonly hooks: StreamHooks,
    private readonly deps: Pick<OkxDeps, 'WebSocket' | 'now' | 'random'>,
    private readonly stamp: () => number,   // heure corrigée sur OKX
  ) {
    this.args = [...args];
    this.state = {
      name, status: 'connecting', connected_since_ms: null, last_message_ms: null,
      reconnects: 0, outages: [], last_error: null, rejected: [],
    };
  }

  get attempts(): number {
    return this.attempt;
  }

  /** Même forme que FeedState.snapshot() en Python, clés dans le même ordre. */
  snapshot(): FeedState {
    return {
      ...this.state, outages: this.state.outages.slice(-OUTAGES_KEPT), rejected: [...(this.state.rejected ?? [])],
    };
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
    this.emit();
  }

  private emit(): void {
    this.hooks.onState(this.snapshot());
  }

  private connect(): void {
    this.retry = null;
    if (this.stopped) return;
    this.pendingPong = false;
    let sock: WebSocketLike;
    try {
      sock = new this.deps.WebSocket(this.url);
    } catch (e) {
      this.fail(`connexion impossible : ${errText(e)}`);
      return;
    }
    this.ws = sock;
    this.quietSince = this.deps.now();
    this.arm(OPEN_TIMEOUT_MS);
    sock.onopen = () => {
      if (this.ws !== sock) return;
      this.quietSince = this.deps.now();
      this.arm(KEEPALIVE_MS);
      sock.send(JSON.stringify({ id: 'sub', op: 'subscribe', args: this.args }));
    };
    sock.onmessage = (ev) => {
      if (this.ws === sock) this.onMessage(ev.data);
    };
    sock.onclose = (ev) => {
      if (this.ws === sock) this.fail(`connexion fermée (code ${ev.code}${ev.reason ? ` : ${ev.reason}` : ''})`);
    };
    // Le navigateur ne dit rien de la cause ; la fermeture suit, déjà ignorée.
    sock.onerror = () => {
      if (this.ws === sock) this.fail('erreur WebSocket');
    };
  }

  /** Une seule minuterie par connexion : délai d'ouverture, puis maintien en vie. */
  private arm(ms: number): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.tick(), Math.max(1, ms));
  }

  private tick(): void {
    this.watchdog = null;
    const sock = this.ws;
    if (!sock || this.stopped) return;
    if (sock.readyState !== WS_OPEN) {
      this.fail(`pas de connexion en ${seconds(OPEN_TIMEOUT_MS)}`);
      return;
    }
    const quiet = this.deps.now() - this.quietSince;
    if (quiet < KEEPALIVE_MS) {
      this.arm(KEEPALIVE_MS - quiet);
      return;
    }
    if (this.pendingPong) {
      this.fail(`pas de pong en ${seconds(KEEPALIVE_MS)}`);
      return;
    }
    sock.send('ping');
    this.pendingPong = true;
    this.quietSince = this.deps.now();
    this.arm(KEEPALIVE_MS);
  }

  private onMessage(data: unknown): void {
    this.quietSince = this.deps.now();
    this.pendingPong = false;
    const recv = this.stamp();
    this.state.last_message_ms = recv;
    this.hooks.onMessage(recv);
    let result: OkxEvent[] | Control;
    try {
      result = parse(String(data), recv);
    } catch (e) {
      // Comme en Python : un message illisible fait refaire la connexion, et la
      // cause reste affichée dans l'état du flux.
      this.fail(`message illisible : ${errText(e)}`);
      return;
    }
    if (result instanceof Control) {
      this.onControl(result, recv);
    } else if (result.length) {
      // Première donnée : la prochaine coupure repart du délai minimal. Pas dès
      // la confirmation d'abonnement : une connexion qui confirme puis tombe
      // aussitôt doit voir le délai grandir (ws.py).
      this.attempt = 0;
      this.hooks.onEvents(result);
    }
  }

  private onControl(ctl: Control, recv: number): void {
    if (ctl.event === 'error') {
      if (!this.reject(ctl)) this.fail(`OKX a refusé la requête : ${String(ctl.raw.code)} ${String(ctl.raw.msg)}`);
    } else if (ctl.event === 'subscribe' && this.state.status !== 'connected') {
      this.state.status = 'connected';
      this.state.connected_since_ms = recv;
      this.state.last_error = null;
      if (this.downSince !== null) {
        const outage = { from_ms: this.downSince, to_ms: recv, duration_ms: recv - this.downSince };
        this.state.outages.push(outage);
        if (this.state.outages.length > OUTAGES_KEPT) this.state.outages.shift();
        console.warn(`${this.name} : coupure de ${seconds(outage.duration_ms)} refermée`);
        this.downSince = null;
      }
      this.emit();
    } else if (ctl.event === 'notice') {
      // OKX prévient avant une maintenance : la reconnexion se fera à la coupure.
      console.warn(`${this.name} : notice OKX ${String(ctl.raw.msg)}`);
    }
  }

  /**
   * Refus 60018 d'un abonnement précis : on l'écarte et le flux continue.
   * Faux si le refus ne désigne aucun abonnement connu : la connexion est alors
   * refaite, comme pour toute autre erreur.
   */
  private reject(ctl: Control): boolean {
    const m = REJECTED.exec(String(ctl.raw.msg ?? ''));
    if (String(ctl.raw.code) !== '60018' || !m) return false;
    const i = this.args.findIndex((a) => a.channel === m[1] && a.instId === m[2]);
    if (i < 0) return false;
    this.args.splice(i, 1);          // pas redemandé à la reconnexion
    const label = `${m[1]} ${m[2]}`;
    const rejected = (this.state.rejected ??= []);
    rejected.push(label);
    console.error(`${this.name} : abonnement refusé par OKX (60018) : ${label}`);
    if (!this.args.length) {
      this.state.last_error = `tous les abonnements refusés par OKX : ${rejected.join(', ')}`;
      this.stop();
    } else {
      this.emit();
    }
    return true;
  }

  private fail(reason: string): void {
    if (this.stopped) return;
    this.detach();
    this.state.last_error = reason;
    this.attempt += 1;
    this.state.reconnects += 1;
    this.state.status = 'reconnecting';
    this.state.connected_since_ms = null;
    if (this.downSince === null) this.downSince = this.stamp();
    this.emit();
    const delay = backoffDelay(this.attempt, this.deps.random);
    console.warn(`${this.name} : connexion perdue (${reason}), reconnexion dans ${seconds(delay)} `
      + `(tentative ${this.attempt})`);
    this.retry = setTimeout(() => this.connect(), delay);
  }

  /** Ferme la socket courante sans qu'elle puisse encore rien déclencher. */
  private detach(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    const sock = this.ws;
    this.ws = null;
    if (!sock) return;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try {
      sock.close();
    } catch {
      // déjà fermée
    }
  }
}

export interface OkxSourceOptions {
  apiBase: string;          // '' : fonctions Vercel de la même origine
  publicWs: string;
  businessWs: string;
  instruments: string[];
  latencyKey: string;       // trade:<inst> du flux principal, pour la latence
}

/** Paramètres d'instrument, dans l'ordre et la forme de rest.py::instrument(). */
function instrumentMeta(inst: string, body: unknown): InstrumentMeta {
  const b = (body ?? {}) as Record<string, unknown>;
  const pos = (k: string) => {
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${k} invalide : ${JSON.stringify(v)}`);
    return v;
  };
  const str = (k: string) => {
    const v = b[k];
    if (typeof v !== 'string') throw new Error(`${k} invalide : ${JSON.stringify(v)}`);
    return v;
  };
  if (b.inst !== inst) throw new Error(`instrument ${JSON.stringify(b.inst)} reçu pour ${inst}`);
  return {
    inst, ct_val: pos('ct_val'), ct_val_ccy: str('ct_val_ccy'), ct_type: str('ct_type'),
    lot_sz: pos('lot_sz'), min_sz: pos('min_sz'), tick_sz: pos('tick_sz'),
    settle_ccy: str('settle_ccy'), state: str('state'),
  };
}

export class OkxDirectSource implements DataSource {
  readonly streams: [OkxStream, OkxStream];
  private readonly sequence = new TradeSequence();
  private gapCount = 0;
  private clock: PingSample | null = null;
  private stopped = true;
  private abort: AbortController | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly timers = new Set<Timer>();

  constructor(private readonly opts: OkxSourceOptions, private readonly sink: SourceSink,
    private readonly deps: OkxDeps = browserDeps()) {
    const hooks: StreamHooks = {
      onEvents: (events) => this.onEvents(events),
      onState: (state) => this.onState(state),
      onMessage: (recv) => this.sink.conn({ lastMessage: recv }),
    };
    const stamp = () => this.now();
    const { instruments } = opts;
    this.streams = [
      new OkxStream('okx-public', opts.publicWs,
        instruments.flatMap((instId) => PUBLIC_CHANNELS.map((channel) => ({ channel, instId }))),
        hooks, deps, stamp),
      new OkxStream('okx-business', opts.businessWs,
        instruments.map((instId) => ({ channel: 'candle1m', instId })), hooks, deps, stamp),
    ];
  }

  /** Heure navigateur corrigée sur l'horloge OKX (telle quelle avant la première mesure). */
  now(): number {
    return this.deps.now() + (this.clock?.offsetMs ?? 0);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.abort = new AbortController();
    this.sink.item('gateway:meta', { ...ONLINE_META });
    this.sink.conn({ status: 'connecting', since: null, attempts: 0 });
    for (const s of this.streams) s.start();
    // L'écran juge la fraîcheur sur last_message_ms : republier l'état chaque
    // seconde, même sans changement (comme _feed_heartbeat côté passerelle).
    this.heartbeat = setInterval(() => this.streams.forEach((s) => this.onState(s.snapshot())),
      FEED_HEARTBEAT_MS);
    for (const inst of this.opts.instruments) void this.loadInstrument(inst, 0);
    void this.clockRound();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.abort?.abort();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    for (const s of this.streams) s.stop();
    this.sink.conn({ status: 'closed', since: null });
  }

  // --- flux -------------------------------------------------------------------

  private onEvents(events: OkxEvent[]): void {
    for (const ev of events) {
      switch (ev.kind) {
        case 'trade': {
          const gap = this.sequence.check(ev);
          if (gap) this.recordGap(gap);
          const key = `trade:${ev.inst}`;
          this.sink.item(key, ev);
          // Latence en direct : un seul tronçon, OKX -> navigateur, mesuré en
          // heure OKX ; sans horloge mesurée, il ne voudrait rien dire.
          if (key === this.opts.latencyKey && this.clock) {
            this.sink.latency({ total: ev.ts_recv - ev.ts_source, okxToGateway: null, gatewayToScreen: null });
          }
          break;
        }
        case 'ticker':
          this.sink.item(`ticker:${ev.inst}`, ev);
          break;
        case 'funding':
          this.sink.item(`funding:${ev.inst}`, ev);
          break;
        case 'open_interest':
          this.sink.item(`oi:${ev.inst}`, ev);
          break;
        case 'candle':
          // Une valeur par mise à jour : la bougie close puis la suivante
          // arrivent toutes deux à l'écran, comme avec la clé de conflation du bus.
          this.sink.item(`candle:${ev.bar}:${ev.inst}`, ev);
          break;
      }
    }
  }

  private onState(state: FeedState): void {
    this.sink.item(`feed:${state.name}`, state);
    if (state.name !== 'okx-public') return;
    // L'état de connexion de l'écran suit le flux public (trades, ticker).
    this.sink.conn({
      status: state.status === 'connected' ? 'open' : state.status === 'connecting' ? 'connecting' : 'closed',
      since: state.connected_since_ms,
      attempts: this.streams[0].attempts,
    });
  }

  private recordGap(gap: TradeGap): void {
    this.gapCount += 1;
    const text = gap.describe();
    console.warn(`trou de séquence : ${text}`);
    const value: GapsState = { count: this.gapCount, last: text, ts_recv: this.now() };
    this.sink.item('gaps:okx', value);
  }

  // --- REST (fonctions Vercel) -------------------------------------------------

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(t);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(ms, resolve));
  }

  private async getJson(path: string, cache?: RequestCache): Promise<unknown> {
    const r = await this.deps.fetch(`${this.opts.apiBase}${path}`, { cache, signal: this.abort?.signal });
    if (!r.ok) throw new Error(`${path} : HTTP ${r.status}`);
    return r.json();
  }

  /** Lu une fois ; en cas d'échec, nouvel essai à délai croissant (jamais de valeur supposée). */
  private async loadInstrument(inst: string, failures: number): Promise<void> {
    try {
      const meta = instrumentMeta(inst, await this.getJson(`/api/instruments?inst=${encodeURIComponent(inst)}`));
      if (!this.stopped) this.sink.item(`instrument:${inst}`, meta);
    } catch (e) {
      if (this.stopped) return;
      const delay = Math.min(INSTRUMENT_RETRY_MAX_MS, INSTRUMENT_RETRY_MIN_MS * 2 ** failures);
      console.error(`paramètres de ${inst} illisibles : ${errText(e)} ; nouvel essai dans ${seconds(delay)}`);
      this.later(delay, () => void this.loadInstrument(inst, failures + 1));
    }
  }

  /**
   * Un échantillon d'horloge. L'heure OKX a été lue par la fonction Vercel à un
   * instant compris entre l'envoi (t0) et la réception (t3) de la requête du
   * navigateur : l'écart vaut okx_ts − (t0 + t3) / 2, à ±(t3 − t0) / 2 près,
   * quelle que soit la part du trajet navigateur ↔ Vercel et Vercel ↔ OKX.
   * fn_ts et rtt_ms de la réponse ne servent qu'au diagnostic.
   */
  private async clockSample(): Promise<PingSample> {
    const t0 = this.deps.now();
    const body = (await this.getJson('/api/okx-time', 'no-store')) as { okx_ts?: unknown } | null;
    const t3 = this.deps.now();
    const okx = body?.okx_ts;
    if (typeof okx !== 'number' || !Number.isFinite(okx) || okx <= 0) {
      throw new Error(`réponse inattendue : ${JSON.stringify(body)}`);
    }
    return pingSample(t0, okx, t3);
  }

  /** CLOCK_SAMPLES mesures, la meilleure retenue (plus court aller-retour), puis attente d'une minute. */
  private async clockRound(): Promise<void> {
    const samples: PingSample[] = [];
    for (let k = 0; k < CLOCK_SAMPLES; k++) {
      if (k) await this.sleep(CLOCK_SPACING_MS);
      try {
        samples.push(await this.clockSample());
      } catch (e) {
        if (this.stopped) return;
        console.warn(`heure OKX indisponible : ${errText(e)}`);
      }
    }
    if (this.stopped) return;
    const best = bestSample(samples);
    if (best) {
      this.clock = best;
      const ok = Math.abs(best.offsetMs) <= CLOCK_MAX_DRIFT_MS;
      if (!ok) console.error(`horloge du navigateur décalée de ${Math.round(best.offsetMs)} ms par rapport à OKX`);
      this.sink.conn({ offsetMs: best.offsetMs, rttMs: best.rttMs });
      const value: ClockState = {
        offset_ms: round1(best.offsetMs), uncertainty_ms: round1(best.rttMs / 2), ok, ts_recv: this.now(),
      };
      this.sink.item('clock:okx', value);
    }
    this.later(CLOCK_EVERY_MS, () => void this.clockRound());
  }
}

export function createOkxSource(opts: OkxSourceOptions, sink: SourceSink, deps?: OkxDeps): OkxDirectSource {
  return new OkxDirectSource(opts, sink, deps);
}
