// REST public OKX pour les fonctions Vercel : instruments, bougies, heure du serveur.
//
// Portage de collectors/terminal_collectors/okx/rest.py (mêmes requêtes, même
// pagination, mêmes conversions). Le navigateur ne peut pas appeler ce REST
// lui-même : OKX refuse le CORS (préflight 403, aucun en-tête Access-Control).
//
// Limites vérifiées dans la doc v5 (docs/okx.md) :
// - domaine du compte européen : https://eea.okx.com (décision T-008) ;
// - GET /api/v5/market/candles : 40 requêtes / 2 s par IP, 300 bougies par
//   requête au plus, seulement les 1 440 dernières de chaque taille ;
//   pagination vers le passé avec `after` (enregistrements antérieurs à ts) ;
// - aucune réponse ne porte d'en-tête de limite de débit : on espace les
//   appels de 50 ms ; un 429 est réessayé une fois après 1 s, puis signalé.
//   Les adresses de sortie de Vercel sont partagées entre clients : la limite
//   par IP peut être atteinte par d'autres (à surveiller au déploiement).
// - toute réponse dont `code` ≠ "0" est une erreur, même en HTTP 200.

import type { Candle, InstrumentMeta } from '../../web/src/data/protocol.js';
import { UpstreamError } from './http.js';

export const OKX_EEA_REST = 'https://eea.okx.com';
export const CANDLES_PER_REQUEST = 300;
export const CANDLES_MAX = 1440;
export const MIN_SPACING_MS = 2000 / 40; // 40 requêtes / 2 s
export const RETRY_429_MS = 1000;
export const OKX_TIMEOUT_MS = 8000;

/** Instruments servis par les fonctions (liste blanche) : ceux du Mode Online. */
export const ALLOWED_INSTRUMENTS: readonly string[] = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];

export class OkxError extends UpstreamError {
  constructor(message: string, detail = '') {
    super('OKX', message, detail);
    this.name = 'OkxError';
  }
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Dépendances injectées : les vraies dans la fonction, des fausses dans les tests. */
export interface OkxDeps {
  fetch: FetchFn;
  now(): number;        // heure murale, ms UTC
  monotonic(): number;  // horloge monotone, ms (espacement, aller-retour)
  sleep(ms: number): Promise<void>;
}

/** Bougie OKX avec son état (confirmée ou en cours), comme candle_from_row en Python. */
export interface OkxCandle extends Candle { confirmed: boolean }

/** Réponse de GET /api/okx-time. */
export interface OkxTime {
  okx_ts: number;   // heure OKX (ms UTC)
  fn_ts: number;    // heure de la fonction au milieu de l'aller-retour (ms UTC)
  rtt_ms: number;   // aller-retour fonction ↔ OKX
}

// Conversions strictes, comme float() et int() en Python : un champ illisible
// lève une erreur plutôt que de produire une valeur fausse.
function num(v: unknown, field: string): number {
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new OkxError('réponse illisible', `champ ${field} : ${JSON.stringify(v)}`);
}

function int(v: unknown, field: string): number {
  const n = num(v, field);
  if (!Number.isSafeInteger(n)) throw new OkxError('réponse illisible', `champ ${field} non entier : ${JSON.stringify(v)}`);
  return n;
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new OkxError('réponse illisible', `champ ${field} : ${JSON.stringify(v)}`);
  return v;
}

/** Bougie OKX : tableau [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]. */
export function candleFromRow(row: unknown): OkxCandle {
  if (!Array.isArray(row) || row.length < 9) {
    throw new OkxError('réponse illisible', `bougie : ${JSON.stringify(row)?.slice(0, 120)}`);
  }
  return {
    t: int(row[0], 'ts'),
    o: num(row[1], 'o'),
    h: num(row[2], 'h'),
    l: num(row[3], 'l'),
    c: num(row[4], 'c'),
    vol_base: num(row[6], 'volCcy'),
    vol_quote: num(row[7], 'volCcyQuote'),
    confirmed: row[8] === '1',
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const realOkxDeps: OkxDeps = {
  // Lu à chaque appel (et non capturé au chargement) : remplaçable dans les tests.
  fetch: (url, init) => globalThis.fetch(url, init),
  now: () => Date.now(),
  monotonic: () => performance.now(),
  sleep,
};

export class OkxRest {
  // Une instance de fonction peut servir plusieurs requêtes à la fois : les
  // appels passent un par un, espacés de MIN_SPACING_MS (le verrou du Python).
  private queue: Promise<void> = Promise.resolve();
  private lastCall = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: OkxDeps = realOkxDeps, readonly baseUrl = OKX_EEA_REST) {}

  private spacing(): Promise<void> {
    const turn = this.queue.then(async () => {
      const wait = this.lastCall + MIN_SPACING_MS - this.deps.monotonic();
      if (wait > 0) await this.deps.sleep(wait);
      this.lastCall = this.deps.monotonic();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  /** GET public ; rend `data` et l'aller-retour de la dernière tentative. */
  private async get(path: string, params: Record<string, string> = {}): Promise<{ data: unknown[]; sentAt: number; rttMs: number }> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
    for (let attempt = 0; ; attempt++) {
      await this.spacing();
      const sentAt = this.deps.now();
      const m0 = this.deps.monotonic();
      let status: number;
      let text: string;
      try {
        const r = await this.deps.fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(OKX_TIMEOUT_MS),
        });
        status = r.status;
        text = await r.text();
      } catch (e) {
        throw new OkxError('injoignable ou délai dépassé', `${path} : ${e instanceof Error ? e.message : String(e)}`);
      }
      const rttMs = this.deps.monotonic() - m0;
      if (status === 429) {
        if (attempt === 0) {
          await this.deps.sleep(RETRY_429_MS);
          continue;
        }
        throw new OkxError('limite de débit atteinte', `${path} : HTTP 429`);
      }
      if (status < 200 || status >= 300) throw new OkxError(`HTTP ${status}`, `${path} : ${text.slice(0, 200)}`);
      let body: { code?: unknown; msg?: unknown; data?: unknown };
      try {
        body = JSON.parse(text);
      } catch {
        throw new OkxError('réponse illisible', `${path} : pas du JSON`);
      }
      if (body?.code !== '0') {
        // Seul le code numérique part dans la réponse ; le message d'OKX reste au journal.
        const code = typeof body?.code === 'string' && /^\d{1,6}$/.test(body.code) ? body.code : '?';
        throw new OkxError(`code ${code}`, `${path} : ${String(body?.msg ?? '').slice(0, 200)}`);
      }
      if (!Array.isArray(body.data)) throw new OkxError('réponse illisible', `${path} : data absent`);
      return { data: body.data, sentAt, rttMs };
    }
  }

  /** Paramètres de contrat (ctVal, lotSz…), lus sur OKX, jamais codés en dur. */
  async instrument(instId: string, instType = 'SWAP'): Promise<InstrumentMeta> {
    const { data } = await this.get('/api/v5/public/instruments', { instType, instId });
    const d = data[0] as Record<string, unknown> | undefined;
    if (!d) throw new OkxError('instrument introuvable', instId);
    if (d.instId !== instId) throw new OkxError('réponse illisible', `instrument ${JSON.stringify(d.instId)} reçu pour ${instId}`);
    return {
      inst: instId,
      ct_val: num(d.ctVal, 'ctVal'),
      ct_val_ccy: str(d.ctValCcy, 'ctValCcy'),
      ct_type: str(d.ctType, 'ctType'),
      lot_sz: num(d.lotSz, 'lotSz'),
      min_sz: num(d.minSz, 'minSz'),
      tick_sz: num(d.tickSz, 'tickSz'),
      settle_ccy: str(d.settleCcy, 'settleCcy'),
      state: str(d.state, 'state'),
    };
  }

  /** Bougies de `sinceMs` à maintenant, de la plus ancienne à la plus récente (OkxRest.candles en Python). */
  async candles(instId: string, bar: string, sinceMs: number | null = null, maxCount = CANDLES_MAX): Promise<OkxCandle[]> {
    const out: OkxCandle[] = [];
    let after: number | null = null;
    while (out.length < maxCount) {
      const params: Record<string, string> = {
        instId, bar, limit: String(Math.min(CANDLES_PER_REQUEST, maxCount - out.length)),
      };
      if (after !== null) params.after = String(after);
      const { data: rows } = await this.get('/api/v5/market/candles', params);
      if (!rows.length) break;
      const batch = rows.map(candleFromRow);
      out.push(...batch.filter((c) => sinceMs === null || c.t >= sinceMs));
      const oldest = batch[batch.length - 1].t;
      if (sinceMs !== null && oldest <= sinceMs) break;
      after = oldest;
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /** Heure OKX et aller-retour (l'heure OKX a été lue entre l'envoi et la réception). */
  async time(): Promise<OkxTime> {
    const { data, sentAt, rttMs } = await this.get('/api/v5/public/time');
    const d = data[0] as Record<string, unknown> | undefined;
    return {
      okx_ts: int(d?.ts, 'ts'),
      fn_ts: Math.round(sentAt + rttMs / 2),
      rtt_ms: Math.round(rttMs * 10) / 10,
    };
  }
}
