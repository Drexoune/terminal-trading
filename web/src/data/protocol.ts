// Messages de la passerelle (gateway/terminal_gateway/app.py) et valeurs du bus.
// Toute valeur de marché porte ts_source (heure OKX) et ts_recv (heure de
// réception), en ms UTC. ts_recv est l'heure de la passerelle en Modes Local et
// Tour, l'heure du navigateur corrigée sur l'horloge OKX en Mode Online (le
// worker lit alors OKX lui-même, sources/okxSource.ts) : mêmes clés, mêmes
// formes dans les trois modes.

export type Item = [key: string, value: unknown];

export type ServerMessage =
  | { type: 'hello'; app: string; version: string; ts_sent: number }
  | { type: 'snapshot' | 'delta'; items: Item[]; ts_sent: number }
  | { type: 'pong'; id: number; t0: number; ts: number };

export interface Stamped { ts_source: number; ts_recv: number }

export interface Ticker extends Stamped {
  inst: string; last: number; bid: number | null; ask: number | null;
  open24h: number | null; high24h: number | null; low24h: number | null;
  sod_utc0: number | null; vol_base24h: number | null;
}

export interface Trade extends Stamped {
  inst: string; trade_id: number; count: number; px: number; sz: number; side: 'buy' | 'sell';
}

export interface Funding extends Stamped {
  inst: string; rate: number; funding_time: number | null; prev_funding_time: number | null;
  interval_ms: number | null;
}

export interface OpenInterest extends Stamped { inst: string; oi_base: number | null; oi_usd: number | null }

export interface Candle {
  t: number; o: number; h: number; l: number; c: number; vol_base: number; vol_quote: number;
}

export interface LiveCandle extends Candle { inst: string; bar: string; confirmed: boolean; ts_recv: number }

/** Coupure d'un flux, refermée à la reconnexion. */
export interface Outage { from_ms: number; to_ms: number; duration_ms: number }

/** État d'un flux OKX (collectors/terminal_collectors/okx/ws.py::FeedState.snapshot). */
export interface FeedState {
  name: string;
  status: 'connecting' | 'connected' | 'reconnecting' | 'stopped';
  connected_since_ms: number | null;
  last_message_ms: number | null;
  reconnects: number;
  outages: Outage[];               // 10 dernières coupures
  last_error: string | null;
  rejected?: string[];             // abonnements refusés par OKX (« tickers FOO-USDT-SWAP »)
}

/** Écart d'horloge avec OKX : machine de la passerelle, ou navigateur en Mode Online. */
export interface ClockState { offset_ms: number; uncertainty_ms: number; ok: boolean; ts_recv: number }

/** Paramètres de contrat, lus sur /api/v5/public/instruments, jamais codés en dur. */
export interface InstrumentMeta {
  inst: string; ct_val: number; ct_val_ccy: string; ct_type: string; lot_sz: number;
  min_sz: number; tick_sz: number; settle_ccy: string; state: string;
}

/** Journal des trous de séquence des trades (gaps:okx). */
export interface GapsState { count: number; last: string; ts_recv: number }

/** Origine des données (gateway:meta) ; host et mode seulement en Mode Online. */
export interface GatewayMeta {
  source: string; region: string;
  host?: string;                          // machine qui sert les données (Mac, tour, « navigateur »)
  mode?: string;                          // 'online' pour la source directe
  mode_hint?: 'local' | 'tour' | null;    // mode annoncé par la passerelle (GATEWAY_MODE)
}

export interface ChartData {
  inst: string; range: '1D' | '5D' | '1M'; bar: string; bar_ms: number;
  from_ms: number; to_ms: number; candles: Candle[];
  prev_day: { t: number; h: number; l: number; confirmed: boolean } | null;
  source: string; ts_recv: number;
}

/**
 * État de la connexion du worker à sa source, calculé dans le worker.
 * Modes Local et Tour : connexion à la passerelle, horloge de la passerelle.
 * Mode Online : flux public OKX (status 'open' une fois abonné), horloge OKX
 * mesurée par /api/okx-time.
 */
export interface ConnState {
  status: 'connecting' | 'open' | 'closed';
  since: number | null;
  lastMessage: number | null;   // heure navigateur corrigée
  offsetMs: number | null;      // heure de référence (passerelle ou OKX) − heure navigateur
  rttMs: number | null;         // aller-retour du ping passerelle, ou de /api/okx-time
  attempts: number;
  reason?: string;              // pourquoi la source est arrêtée, quand on le sait
}

/** Latence de bout en bout du flux principal (trades BTC), médiane glissante. */
export interface LatencyState {
  totalMs: number | null;        // trade OKX -> réception par le navigateur
  okxToGatewayMs: number | null; // trade OKX -> réception par la passerelle ; null en direct
  gatewayToScreenMs: number | null; // null en direct
  samples: number;
  path: 'gateway' | 'direct';    // via la passerelle, ou OKX lu par le navigateur (Mode Online)
}

export const WATCHED_TOPICS = [
  'ticker:', 'trade:', 'funding:', 'oi:', 'candle:1m:', 'feed:', 'clock:', 'instrument:', 'gaps:',
  'gateway:',
];

// --- Sources du worker (sources/gatewaySource.ts, sources/okxSource.ts) ----------

/** Un échantillon de latence du flux principal, en ms (null : tronçon absent du trajet). */
export interface LatencySample { total: number; okxToGateway: number | null; gatewayToScreen: number | null }

/** Ce qu'une source remet au worker, qui regroupe et transmet à l'écran. */
export interface SourceSink {
  /** Une valeur à transmettre, dans l'ordre d'arrivée (plusieurs par clé et par lot possibles). */
  item(key: string, value: unknown): void;
  /** Changement de l'état de connexion. */
  conn(patch: Partial<ConnState>): void;
  latency(sample: LatencySample): void;
}

export interface DataSource {
  start(): void;
  /** Arrêt propre : sockets fermées, minuteries et requêtes annulées ; plus aucun
   *  appel au puits une fois stop() rendu. */
  stop(): void;
}

/** Sous-ensemble de WebSocket utilisé par les sources (injectable dans les tests). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export const WS_OPEN = 1; // WebSocket.OPEN, sans dépendre du constructeur injecté

/** Sous-ensemble de fetch utilisé par les sources (injectable dans les tests). */
export type FetchLike = (url: string, init?: { cache?: RequestCache; signal?: AbortSignal })
  => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
