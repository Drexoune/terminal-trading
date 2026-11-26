// Service de la microstructure sur la machine Oracle (T-069) : le moteur du front
// (web/src/micro/engine.ts) tourne 24 h/24 sous Node (WebSocket et fetch natifs) et publie son
// état en SSE (sse.ts) ; Caddy le sert en https devant. Aucune clé : données publiques seulement.
//
//   GET /micro/stream   état complet puis changements (text/event-stream)
//   GET /micro/health   santé : démarrage, sauvegarde, mémoire système, clients, flux, dernier
//                       passage de la recherche du backtest (T-070)
//
// Rythme : carnet et funding 4 fois par seconde, état complet (carte, liquidations, flux)
// toutes les 5 s ; sauvegarde toutes les 60 s et à l'arrêt (SIGTERM), relue au démarrage si elle
// a moins d'une heure. Les statistiques d'OKX sont lues directement sur www.okx.com (pas de CORS
// côté serveur).

import { createServer, type Server } from 'node:http';
import { freemem, loadavg, totalmem } from 'node:os';
import { pathToFileURL } from 'node:url';
import { OKX_STAT_URLS } from '../../api/_lib/okx-stat-urls';
import type { FetchLike, WebSocketCtor } from '../../web/src/data/protocol';
import { MicroEngine, type EngineSave } from '../../web/src/micro/engine';
import { loadJson, saveJson } from './persist';
import { allowedOrigin, SseHub } from './sse';

export const PUBLISH_MS = 250;
export const FULL_EVERY_MS = 5_000;
export const SAVE_MS = 60_000;
export const DEFAULT_ORIGINS = ['https://terminal-trading-steel.vercel.app', 'http://127.0.0.1:5173', 'http://localhost:5173'];

export interface ServerOptions {
  port: number; host: string; stateFile: string; origins: readonly string[];
  /** État de la recherche du backtest (T-070, server/bt), sans secret ; repris dans la santé. */
  btStatusFile?: string;
  /** État des alertes à la seconde (T-071, server/alerts), sans secret ; repris dans la santé. */
  alertsStatusFile?: string;
  /** État du flux Tree of Alpha (T-072, server/news), sans secret ; repris dans la santé. */
  newsStatusFile?: string;
  /** États des analyses et des options de P7 (T-075, server/analysis et server/options), sans secret. */
  analysisStatusFile?: string;
  optionsStatusFile?: string;
  deps?: { WebSocket: WebSocketCtor; fetch: FetchLike; now: () => number; random: () => number };
}

/** Source affichée par l'écran (puce « Serveur Oracle ») et ligne du journal au redémarrage. */
export interface SourceState {
  kind: 'server'; host: string; started_ms: number; restored_from: number | null;
  down: { from: number; to: number } | null; saved_at: number | null;
  sys_mem_pct: number; rss_mb: number; clients: number;
}

export function startMicroServer(o: ServerOptions) {
  const deps = o.deps ?? { WebSocket: WebSocket as unknown as WebSocketCtor, fetch: (u, i) => fetch(u, i), now: () => Date.now(), random: Math.random };
  const engine = new MicroEngine({ ...deps, okxStatsUrl: (s) => OKX_STAT_URLS[s] }, { fullEveryMs: FULL_EVERY_MS });
  const hub = new SseHub(o.origins);
  const started = deps.now();
  const saved = loadJson<EngineSave>(o.stateFile);
  const restored = saved ? engine.restore(saved, started) : false;
  let savedAt: number | null = restored ? saved!.saved_at : null;
  engine.start();

  const source = (): SourceState => ({
    kind: 'server', host: 'Oracle', started_ms: started, restored_from: restored ? saved!.saved_at : null,
    down: restored ? { from: saved!.saved_at, to: started } : null, saved_at: savedAt,
    sys_mem_pct: Math.round((1 - freemem() / totalmem()) * 1000) / 10,
    rss_mb: Math.round(process.memoryUsage().rss / 1048576), clients: hub.size,
  });

  let lastSource = 0;
  const publish = setInterval(() => {
    try {
      const items = engine.publish();
      const now = deps.now();
      if (now - lastSource >= FULL_EVERY_MS) { lastSource = now; items.push(['micro:source', source()]); }
      hub.broadcast(items);
    } catch (e) { console.error('micro : publication impossible', e); }
  }, PUBLISH_MS);

  const save = () => {
    try { saveJson(o.stateFile, engine.save()); savedAt = deps.now(); } catch (e) { console.error('micro : sauvegarde impossible', e); }
  };
  const saver = setInterval(save, SAVE_MS);

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname === '/micro/stream') { hub.handle(req, res); return; }
    if (url.pathname === '/micro/health') {
      const origin = req.headers.origin;
      if (!allowedOrigin(origin, o.origins)) { res.writeHead(403).end(); return; }
      const feeds = [...hub.latest].filter(([k]) => k.startsWith('micro:feed:'))
        .map(([, f]) => { const s = f as { name: string; status: string; last_message_ms: number | null; reconnects: number }; return { name: s.name, status: s.status, last_message_ms: s.last_message_ms, reconnects: s.reconnects }; });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
      const bt = o.btStatusFile ? loadJson<Record<string, unknown>>(o.btStatusFile) : null;
      const alerts = o.alertsStatusFile ? loadJson<Record<string, unknown>>(o.alertsStatusFile) : null;
      const news = o.newsStatusFile ? loadJson<Record<string, unknown>>(o.newsStatusFile) : null;
      const analysis = o.analysisStatusFile ? loadJson<Record<string, unknown>>(o.analysisStatusFile) : null;
      const options = o.optionsStatusFile ? loadJson<Record<string, unknown>>(o.optionsStatusFile) : null;
      res.end(JSON.stringify({ ok: true, ...source(), load: loadavg(), feeds, bt: bt ? { last_pass: bt } : null, alerts, news, analysis, options }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(o.port, o.host);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(publish); clearInterval(saver);
    save();
    engine.stop();
    hub.close();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return { server, engine, hub, stop, restored };
}

// Lancement par systemd (deploy/oracle/terminal-micro.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const s = startMicroServer({
    port: Number(env.MICRO_PORT ?? 8720), host: env.MICRO_HOST ?? '127.0.0.1',
    stateFile: env.MICRO_STATE ?? '/var/lib/terminal-micro/state.json',
    origins: env.MICRO_ORIGINS ? env.MICRO_ORIGINS.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_ORIGINS,
    btStatusFile: env.MICRO_BT_STATUS ?? '/var/lib/terminal-bt/status.json',
    alertsStatusFile: env.MICRO_ALERTS_STATUS ?? '/var/lib/terminal-alerts/status.json',
    newsStatusFile: env.MICRO_NEWS_STATUS ?? '/var/lib/terminal-news/status.json',
    analysisStatusFile: env.MICRO_ANALYSIS_STATUS ?? '/var/lib/terminal-analysis/status.json',
    optionsStatusFile: env.MICRO_OPTIONS_STATUS ?? '/var/lib/terminal-options/status.json',
  });
  console.log(`micro : service démarré${s.restored ? ' (état sauvegardé relu)' : ''}, port ${env.MICRO_PORT ?? 8720}`);
  const quit = (sig: string) => { console.log(`micro : ${sig}, arrêt propre`); void s.stop().then(() => process.exit(0)); };
  process.on('SIGTERM', () => quit('SIGTERM'));
  process.on('SIGINT', () => quit('SIGINT'));
}
