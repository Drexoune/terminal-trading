// Alertes à la seconde sur la machine Oracle (T-071), service terminal-alerts.
//
// - Prix : trades publics d'OKX (BTC-USDT-SWAP, ETH-USDT-SWAP) par une WebSocket EEA (T-008),
//   jugés un par un ; Telegram part dans la seconde.
// - Liquidations et murs retirés : flux SSE local de la microstructure (server/micro, même
//   machine) ; aucun second collecteur.
// - Moteur d'alertes existant (supabase/functions/p1-jobs/alerts.ts : règles, base, Telegram,
//   état publié), dédoublonnage par la base : Supabase, qui juge toujours les prix à la minute,
//   reste le repli et ne peut pas doubler une alerte (même clé de minute).
// - Battement de cœur toutes les 30 s dans p1_state (alert:oracle), lu par l'écran /alertes.
//
// Secrets (T-071) dans /etc/terminal/alerts.env : SUPABASE_URL, SUPABASE_SECRET_KEY (« oracle »),
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. État sans secret : /var/lib/terminal-alerts/status.json.

import { pathToFileURL } from 'node:url';
import { Engine, type AlertDeps, type Rule } from '../../supabase/functions/p1-jobs/alerts';
import { createRest, type Json, type Rest } from '../../supabase/functions/p1-jobs/rest';
import type { FetchLike as PgFetch } from '../../supabase/functions/okx-collector/postgrest';
import type { WebSocketCtor } from '../../web/src/data/protocol';
import { VenueStream, type MessageResult, type MicroFeedState } from '../../web/src/micro/stream';
import { saveJson } from '../micro/persist';
import { judgeWalls, LiqWindow, PriceJudge, type Fire, type LiqRow, type WallSeen } from './judge';
import { SseParser } from '../shared/sse-client';

export { SseParser };

export const OKX_WS = 'wss://wseea.okx.com/ws/v5/public';
export const INSTS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];
export const RELOAD_MS = 30_000;
export const SSE_RETRY_MS = 5_000;

export interface ServiceDeps {
  rest: Rest; env: (n: string) => string | undefined;
  fetch: AlertDeps['fetch'];                 // Telegram
  sseFetch: (url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;
  WebSocket: WebSocketCtor; now: () => number; random: () => number; sleep: (ms: number) => Promise<void>;
  microUrl: string;
  writeStatus?: (s: Record<string, unknown>) => void;
}

export class AlertService {
  readonly engine: Engine;
  readonly price = new PriceJudge();
  readonly liqs = new LiqWindow();
  readonly stream: VenueStream;
  private wallSeen = new Set<string>();
  private pending: Fire[] = [];
  private sseReady = false;
  private queue: Promise<void> = Promise.resolve();
  private timers: ReturnType<typeof setInterval>[] = [];
  private stopped = false;
  feed: MicroFeedState | null = null;
  lastTrade: Record<string, number> = {};
  sse = { connected: false, since: null as number | null, error: null as string | null };
  fired = 0;
  lastFire: { at: number; title: string } | null = null;

  constructor(private readonly d: ServiceDeps) {
    this.engine = new Engine({ rest: d.rest, env: d.env, fetch: d.fetch, now: d.now, sleep: d.sleep });
    this.stream = new VenueStream({
      name: 'okx-alerts', label: 'OKX WS (alertes)', venue: 'okx', url: OKX_WS, ping: 'ping', quietMs: 20_000,
      subscribe: () => [JSON.stringify({ op: 'subscribe', args: INSTS.map((instId) => ({ channel: 'trades', instId })) })],
      onMessage: (raw, recv) => this.onOkx(raw, recv),
    }, { WebSocket: d.WebSocket, now: d.now, random: d.random }, (s) => { this.feed = s; });
  }

  get rules(): Rule[] { return this.engine.rules; }

  async start(): Promise<void> {
    await this.engine.load();
    this.stream.start();
    void this.sseLoop();
    const every = (ms: number, f: () => Promise<void> | void) => this.timers.push(setInterval(() => { Promise.resolve(f()).catch((e) => console.error('alertes', e)); }, ms));
    every(RELOAD_MS, () => this.enqueue(async () => { await this.engine.load(); await this.heartbeat(); }));
    await this.heartbeat();
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.stream.stop();
  }

  // --- entrées ---------------------------------------------------------------------------------

  onOkx(raw: string, _recv: number): MessageResult {
    if (raw === 'pong') return 'ignore';
    const m = JSON.parse(raw) as { event?: string; code?: string; msg?: string; arg?: { channel?: string; instId?: string }; data?: { px: string; ts: string }[] };
    if (m.event === 'subscribe') return 'ack';
    if (m.event === 'error') return { error: `OKX a refusé l’abonnement : ${m.code} ${m.msg}` };
    if (m.arg?.channel !== 'trades' || !m.data) return 'ignore';
    const inst = String(m.arg.instId);
    for (const t of m.data) {
      const ts = Number(t.ts), px = Number(t.px);
      if (!Number.isFinite(px)) continue;
      this.lastTrade[inst] = ts;
      this.fire(this.price.onTrade(inst, px, ts, this.rules));
    }
    return 'data';
  }

  /** Lot du flux de la microstructure : liquidations cumulées, murs nouveaux (ceux du premier état sont connus, jamais alertés). */
  onMicro(items: [string, unknown][], now: number): void {
    const walls: WallSeen[] = [];
    for (const [k, v] of items) {
      if (k === 'micro:liqs') {
        const rows = ((v as { rows?: LiqRow[] }).rows ?? []).map((l) => ({ venue: l.venue, ts: l.ts, side: l.side, px: l.px, sz: l.sz, usd: l.usd }));
        this.liqs.add(rows);
      } else if (k === 'micro:depth') {
        for (const w of (v as { walls?: WallSeen[] }).walls ?? []) {
          const key = `${w.t}|${w.px}`;
          if (this.wallSeen.has(key)) continue;
          this.wallSeen.add(key);
          if (this.sseReady) walls.push(w);
        }
      }
    }
    this.sseReady = true;
    this.fire([...this.liqs.judge(now, this.rules), ...judgeWalls(walls, this.rules)]);
  }

  private async sseLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const r = await this.d.sseFetch(`${this.d.microUrl}/micro/stream`);
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
        this.sse = { connected: true, since: this.d.now(), error: null };
        const parser = new SseParser();
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.stopped) break;
          for (const ev of parser.push(dec.decode(value, { stream: true }))) {
            if (ev.event !== 'state' && ev.event !== 'items') continue;
            this.onMicro(JSON.parse(ev.data) as [string, unknown][], this.d.now());
          }
        }
        this.sse = { connected: false, since: null, error: 'flux terminé' };
      } catch (e) {
        this.sse = { connected: false, since: null, error: (e as Error).message };
      }
      if (!this.stopped) await this.d.sleep(SSE_RETRY_MS);
    }
  }

  // --- sorties ---------------------------------------------------------------------------------

  /**
   * Déclenchements mis en file ; un seul lot à la fois passe par le moteur (base, Telegram, état),
   * et le rechargement des règles passe par la même file : il ne peut ni perdre une alerte arrivée
   * pendant un enregistrement, ni réécrire « armée » sur une règle qui vient de se déclencher.
   */
  fire(fires: Fire[]): void {
    if (!fires.length) return;
    this.pending.push(...fires);
    this.enqueue(() => this.drain());
  }

  enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch((e) => console.error('alertes', e));
    return this.queue;
  }

  private async drain(): Promise<void> {
    const batch = this.pending.splice(0);
    for (const f of batch) this.engine.fire(f.rule, f.dedupe, f.title, f.body, f.source, f.sourceMs, f.data, f.newState);
    const n = this.engine.fired.length;
    if (!n) return;                                   // déjà vues
    try {
      await this.engine.flush();
      this.fired += n;
      this.lastFire = { at: this.d.now(), title: this.engine.fired[n - 1].title };
    } catch (e) {
      console.error('alertes : enregistrement impossible', e);
    } finally {
      this.engine.fired = [];
      this.engine.changed.clear();
    }
  }

  /** Attend que la file soit vide (tests, arrêt). */
  settled(): Promise<void> { return this.queue; }

  /** Battement de cœur publié (alert:oracle) et état local sans secret. */
  async heartbeat(): Promise<void> {
    const now = this.d.now();
    const value = {
      ok: this.feed?.status === 'connected', at: now, ws: this.feed ? { status: this.feed.status, reconnects: this.feed.reconnects, last_error: this.feed.last_error } : null,
      last_trade_ms: this.lastTrade, micro_stream: this.sse, armed: this.rules.filter((r) => r.state === 'armée').length,
      fired: this.fired, last_fire: this.lastFire,
    };
    await this.d.rest.upsert('p1_state', [{ key: 'alert:oracle', value: value as unknown as Json, updated_ms: now }], 'key');
    this.d.writeStatus?.(value);
  }
}

// Lancement par systemd (deploy/oracle/terminal-alerts.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (n: string) => process.env[n];
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) { console.error('alertes : SUPABASE_URL ou SUPABASE_SECRET_KEY absente de /etc/terminal/alerts.env'); process.exit(2); }
  const statusFile = env('ALERTS_STATUS') ?? '/var/lib/terminal-alerts/status.json';
  const s = new AlertService({
    rest: createRest(url, key, ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as PgFetch), env,
    fetch: (u, i) => fetch(u, i), sseFetch: (u) => fetch(u), WebSocket: WebSocket as unknown as WebSocketCtor,
    now: () => Date.now(), random: Math.random, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    microUrl: env('MICRO_URL') ?? 'http://127.0.0.1:8720',
    writeStatus: (v) => { try { saveJson(statusFile, v); } catch (e) { console.error('alertes : état illisible', e); } },
  });
  s.start().then(() => console.log('alertes : service démarré')).catch((e) => { console.error('alertes : démarrage impossible', e); process.exit(1); });
  process.on('SIGTERM', () => { console.log('alertes : SIGTERM'); s.stop(); setTimeout(() => process.exit(0), 2_000); });
}
