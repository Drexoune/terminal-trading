// Tree of Alpha en temps réel sur la machine Oracle (T-072), service terminal-news.
//
// - WebSocket publique sans clé (T-021) tenue 24 h/24 par VenueStream (reconnexion à délai
//   croissant, journal des coupures). Tenue pour établie dès l'ouverture : le flux n'envoie rien
//   à l'abonnement et se tait parfois 17 min ; reconnexion seulement après 30 min de silence.
// - Chaque message → titre (toa.ts) → quatre couches de doublons partagées avec les RSS
//   (isDuplicate) → news_items → p1_state news:item:<id> (diffusé au front par Realtime) →
//   alertes par mot-clé et par catégorie (fireNewsAlerts). Un message à la fois (file unique).
// - État du flux toutes les 30 s : feed:toa (barre de flux), jugé sur la connexion.
//
// Secrets (T-071, T-072) dans /etc/terminal/alerts.env : SUPABASE_URL, SUPABASE_SECRET_KEY
// (« oracle »), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. État sans secret : /var/lib/terminal-news/status.json.

import { pathToFileURL } from 'node:url';
import type { AlertDeps } from '../../supabase/functions/p1-jobs/alerts';
import { fireNewsAlerts } from '../../supabase/functions/p1-jobs/alerts';
import { feedFail, feedOk, type FeedState } from '../../supabase/functions/p1-jobs/calendar_job';
import { isDuplicate, type Known, type NewsItem } from '../../supabase/functions/p1-jobs/news';
import { FEEDS, RULES_VERSION } from '../../supabase/functions/p1-jobs/news_rules';
import { createRest, type Json, type Rest, type Row } from '../../supabase/functions/p1-jobs/rest';
import type { FetchLike as PgFetch } from '../../supabase/functions/okx-collector/postgrest';
import type { WebSocketCtor } from '../../web/src/data/protocol';
import { VenueStream, type MessageResult, type MicroFeedState } from '../../web/src/micro/stream';
import { saveJson } from '../micro/persist';
import { normalizeToa, TOA_FEED, TOA_WS, type ToaItem, type ToaRaw } from './toa';

export const TOA_STATE = { name: 'toa', label: 'Tree of Alpha', late_after_ms: 90_000, stale_after_ms: 300_000 };
export const KEEP_MS = 7 * 86_400_000;
export const RELOAD_MS = 600_000;
export const BEAT_MS = 30_000;

export interface NewsServiceDeps {
  rest: Rest; env: (n: string) => string | undefined; fetch: AlertDeps['fetch'];
  WebSocket: WebSocketCtor; now: () => number; random: () => number; sleep: (ms: number) => Promise<void>;
  writeStatus?: (s: Record<string, unknown>) => void;
}

export class NewsService {
  known: Known[] = [];
  readonly stream: VenueStream;
  feed: MicroFeedState | null = null;
  private prev: FeedState | null = null;
  private queue: Promise<void> = Promise.resolve();
  private timers: ReturnType<typeof setInterval>[] = [];
  stats = { messages: 0, kept: 0, duplicates: 0, ignored: 0, alerts: 0, last_item_ms: null as number | null, last_error: null as string | null };

  constructor(private readonly d: NewsServiceDeps) {
    this.stream = new VenueStream({
      name: 'toa', label: 'Tree of Alpha', venue: 'okx', url: TOA_WS, quietMs: 30 * 60_000, connectedOnOpen: true,
      subscribe: () => [], onMessage: (raw, recv) => this.onMessage(raw, recv),
    }, { WebSocket: d.WebSocket, now: d.now, random: d.random }, (s) => { this.feed = s; });
  }

  async load(): Promise<void> {
    const rows = await this.d.rest.select<{ id: number; feed: string; native_id: string | null; url: string | null; title: string; title_norm: string;
      published_ms: number | null; received_ms: number }>('news_items', {
      select: 'id,feed,native_id,url,title,title_norm,published_ms,received_ms', received_ms: `gte.${this.d.now() - KEEP_MS}`,
      order: 'received_ms.desc', limit: '5000' });
    this.known = rows.map((r) => ({ id: r.id, feed: r.feed, native_id: r.native_id, url: r.url, title: r.title, title_norm: r.title_norm,
      bank: FEEDS.find((f) => f.id === r.feed)?.bank ?? null, t: r.published_ms ?? r.received_ms }));
  }

  async start(): Promise<void> {
    await this.load();
    this.stream.start();
    const every = (ms: number, f: () => Promise<void>) => this.timers.push(setInterval(() => { this.enqueue(f); }, ms));
    every(RELOAD_MS, () => this.load());
    every(BEAT_MS, () => this.beat());
    await this.beat();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.stream.stop();
  }

  enqueue(job: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(job).catch((e) => { this.stats.last_error = String((e as Error)?.message ?? e).slice(0, 200); console.error('actus', e); });
    return this.queue;
  }

  settled(): Promise<void> { return this.queue; }

  onMessage(raw: string, recv: number): MessageResult {
    let msg: unknown;
    try { msg = JSON.parse(raw); } catch { this.stats.ignored++; return 'ignore'; }
    this.stats.messages++;
    const item = normalizeToa(msg as ToaRaw, recv);
    if (!item) { this.stats.ignored++; return 'data'; }
    if (isDuplicate(this.known, TOA_FEED, item.native_id, item.url, item.title, item.title_norm, item.published_ms ?? recv)) { this.stats.duplicates++; return 'data'; }
    this.known.push({ id: -1, feed: TOA_FEED.id, native_id: item.native_id, url: item.url, title: item.title, title_norm: item.title_norm, bank: null, t: item.published_ms ?? recv });
    this.enqueue(() => this.ingest(item));
    return 'data';
  }

  /** news_items, puis news:item:<id> (Realtime), puis alertes ; un message à la fois. */
  async ingest(it: ToaItem): Promise<void> {
    const { rest } = this.d;
    const row: Row = { feed: TOA_FEED.id, source: it.source, kind: TOA_FEED.kind, native_id: it.native_id, url: it.url, title: it.title, title_norm: it.title_norm,
      numbers: it.numbers, summary: it.summary, category: it.category, urgent: it.urgent, rule: it.rule, rules_version: RULES_VERSION, figure: null,
      published_ms: it.published_ms, published_raw: it.published_ms === null ? null : String(it.published_ms), received_ms: it.received_ms, backfill: false };
    const made = await rest.insertIgnore<{ id: number }>('news_items', [row], 'url', 'id');
    if (!made.length) { this.stats.duplicates++; return; }
    const id = made[0].id;
    const item: NewsItem = { id, feed: TOA_FEED.id, source: it.source, kind: TOA_FEED.kind, bank: null, title: it.title, summary: it.summary, url: it.url,
      category: it.category, urgent: it.urgent, rule: it.rule, rules_version: RULES_VERSION, figure: null, published_ms: it.published_ms,
      published_raw: row.published_raw as string | null, received_ms: it.received_ms, backfill: false, lang: 'en' };
    await rest.upsert('p1_state', [{ key: `news:item:${id}`, value: item as unknown as Json, updated_ms: this.d.now() }], 'key');
    this.stats.kept++;
    this.stats.last_item_ms = it.published_ms ?? it.received_ms;
    const alertDeps: AlertDeps = { rest, env: this.d.env, fetch: this.d.fetch, now: this.d.now, sleep: this.d.sleep };
    this.stats.alerts += await fireNewsAlerts(alertDeps, [{ id, title: it.title, source: it.source, published_ms: it.published_ms, received_ms: it.received_ms,
      category: it.category, urgent: it.urgent }]);
  }

  /** feed:toa (barre de flux) : jugé sur la connexion, pas sur l'âge du dernier titre. */
  async beat(): Promise<void> {
    const now = this.d.now();
    const up = this.feed?.status === 'connected';
    const state = up ? feedOk(TOA_STATE as Parameters<typeof feedOk>[0], this.prev, now)
      : feedFail(TOA_STATE as Parameters<typeof feedFail>[0], this.prev, this.feed?.last_error ?? 'connexion en cours');
    this.prev = state;
    await this.d.rest.upsert('p1_state', [{ key: 'feed:toa', value: state as unknown as Json, updated_ms: now }], 'key');
    this.d.writeStatus?.({ at: now, connected: up, reconnects: this.feed?.reconnects ?? 0, ws_error: this.feed?.last_error ?? null, ...this.stats });
  }
}

// Lancement par systemd (deploy/oracle/terminal-news.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (n: string) => process.env[n];
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) { console.error('actus : SUPABASE_URL ou SUPABASE_SECRET_KEY absente de /etc/terminal/alerts.env'); process.exit(2); }
  const statusFile = env('NEWS_STATUS') ?? '/var/lib/terminal-news/status.json';
  const s = new NewsService({
    rest: createRest(url, key, ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as PgFetch), env,
    fetch: (u, i) => fetch(u, i), WebSocket: WebSocket as unknown as WebSocketCtor,
    now: () => Date.now(), random: Math.random, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    writeStatus: (v) => { try { saveJson(statusFile, v); } catch (e) { console.error('actus : état illisible', e); } },
  });
  s.start().then(() => console.log('actus : Tree of Alpha, service démarré')).catch((e) => { console.error('actus : démarrage impossible', e); process.exit(1); });
  process.on('SIGTERM', () => { console.log('actus : SIGTERM'); s.stop(); setTimeout(() => process.exit(0), 2_000); });
}
