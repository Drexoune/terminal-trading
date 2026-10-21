// Collecteur planifié du Mode Online : un passage par minute, déclenché par
// pg_cron + pg_net (supabase/cron.sql), qui lit le REST public OKX EEA et
// écrit dans Postgres. Logique pure : aucune API Deno, aucun import npm ;
// fetch, horloge et base sont injectés, d'où les tests Vitest sur des
// réponses OKX réelles (fixtures/okx-rest-eea.json).
//
// Un passage :
//   1. mesure l'écart d'horloge avec /api/v5/public/time (plus court aller-retour
//      sur quelques échantillons, comme collectors/…/okx/rest.py::best_sample) ;
//   2. pour chaque instrument, en parallèle : ticker, funding, open interest et
//      les 3 dernières bougies 1m ;
//   3. écrit un instantané par minute (clé inst, ts_minute) et les bougies
//      closes (clé inst, t), en upsert : rejouer un passage ne crée pas de doublon ;
//   4. signale les minutes manquantes entre la dernière bougie en base et les
//      bougies reçues (collector_gaps). Un trou est journalisé, jamais comblé
//      ni masqué ;
//   5. journalise le passage dans collector_runs (ok ou erreurs, lignes écrites,
//      durée, écart d'horloge).
// Une erreur sur un instrument n'empêche pas les autres : le passage est alors
// marqué ok = false avec le message. Funding et open interest sont facultatifs :
// absents ou illisibles, leurs colonnes restent null et l'instantané part quand même.
//
// Champs OKX vérifiés le 20/10/2026 par appel réel sur https://eea.okx.com
// (mêmes noms que les canaux WebSocket, voir docs/okx.md et parse.py) :
// - ticker : last, bidPx, askPx, open24h, high24h, low24h, sodUtc0, volCcy24h
//   (devise de base), ts ;
// - funding-rate : fundingRate, fundingTime (PROCHAINE échéance), ts ;
// - open-interest : oiCcy (devise de base), oiUsd, ts ;
// - candles : [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm], de la plus
//   récente à la plus ancienne ; confirm = "0" pour la minute en cours.
// Une erreur OKX arrive en HTTP 200 avec un code différent de "0".
// Limites de débit (doc v5, par IP) : time 10 / 2 s, funding-rate 10 / 2 s,
// ticker et open-interest 20 / 2 s, candles 40 / 2 s. Un passage en fait
// 2 + 4 par instrument, une fois par minute : très loin des plafonds.

import type { Db, FetchLike, Row } from './postgrest.ts';

/** REST du compte européen (docs/okx.md, décision T-008). */
export const OKX_EEA_REST = 'https://eea.okx.com';

/** Mêmes instruments que le Mode Online du front (web/src/config/modes.ts). */
export const DEFAULT_INSTRUMENTS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];

/** Bougies lues à chaque passage : la minute en cours et les deux précédentes. */
export const CANDLES_LIMIT = 3;

/** Retenue sur le message d'erreur journalisé. */
const ERROR_MAX_CHARS = 2000;

const MINUTE_MS = 60_000;

export interface CollectorDeps {
  fetch: FetchLike;
  now: () => number;        // ms UTC
  instruments: string[];
  okxBase: string;          // OKX_EEA_REST en production
  db: Db;
  clockSamples?: number;    // échantillons d'horloge ; 2 par défaut
  okxTimeoutMs?: number;    // par requête OKX ; 8 s par défaut
}

export interface RunResult {
  ok: boolean;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  rows: number;             // lignes écrites (instantanés + bougies + trous)
  gaps: number;             // minutes manquantes détectées pendant ce passage
  okx_offset_ms: number | null;
  rtt_ms: number | null;
  errors: string[];
}

export interface ClockSample {
  offset_ms: number;        // heure OKX - heure locale
  rtt_ms: number;           // aller-retour ; l'incertitude de l'écart vaut rtt / 2
}

export interface Gap {
  inst: string;
  from_t: number;           // première minute manquante (ouverture, ms)
  to_t: number;             // dernière minute manquante (ouverture, ms)
  missing: number;
}

type Dict = Record<string, unknown>;

// --- Lecture des champs OKX (même règle que parse.py : champ obligatoire
// illisible = erreur, champ facultatif vide = null, jamais de valeur inventée).

function num(v: unknown, field: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`champ ${field} illisible (${JSON.stringify(v)})`);
}

function opt(v: unknown, field: string): number | null {
  return v === undefined || v === null || v === '' ? null : num(v, field);
}

function ms(v: unknown, field: string): number {
  const n = num(v, field);
  if (!Number.isSafeInteger(n)) throw new Error(`champ ${field} non entier (${JSON.stringify(v)})`);
  return n;
}

function optMs(v: unknown, field: string): number | null {
  return v === undefined || v === null || v === '' ? null : ms(v, field);
}

/** Horodatage ISO 8601 UTC, accepté par PostgREST pour une colonne timestamptz. */
export const iso = (t: number): string => new Date(t).toISOString();

const isoOrNull = (t: number | null): string | null => (t === null ? null : iso(t));

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- REST OKX ------------------------------------------------------------------

async function okxGet(deps: CollectorDeps, path: string): Promise<unknown[]> {
  const where = path.split('?')[0];
  const r = await deps.fetch(`${deps.okxBase}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(deps.okxTimeoutMs ?? 8_000),
  });
  if (r.status === 429) throw new Error(`limite de débit OKX atteinte sur ${where}`);
  if (!r.ok) throw new Error(`OKX HTTP ${r.status} sur ${where}`);
  let body: { code?: unknown; msg?: unknown; data?: unknown };
  try {
    body = JSON.parse(await r.text()) as typeof body;
  } catch {
    // Page d'erreur HTML d'un intermédiaire, réponse tronquée…
    throw new Error(`${where} : réponse non JSON`);
  }
  if (body.code !== '0') throw new Error(`${where} : code ${String(body.code)} ${String(body.msg ?? '')}`.trim());
  if (!Array.isArray(body.data)) throw new Error(`${where} : réponse sans data`);
  return body.data;
}

/** Une ligne de réponse pour l'instrument demandé, sinon erreur. */
function first(data: unknown[], inst: string, what: string): Dict {
  const d = data[0] as Dict | undefined;
  if (!d) throw new Error(`${what} : réponse vide`);
  if (d.instId !== inst) throw new Error(`${what} : réponse pour ${String(d.instId)}, ${inst} attendu`);
  return d;
}

export async function clockSample(deps: CollectorDeps): Promise<ClockSample> {
  const t0 = deps.now();
  const data = await okxGet(deps, '/api/v5/public/time');
  const t1 = deps.now();
  const server = ms((data[0] as Dict | undefined)?.ts, 'ts');
  return { offset_ms: server - (t0 + t1) / 2, rtt_ms: t1 - t0 };
}

/** L'échantillon au plus court aller-retour est le moins incertain (méthode NTP). */
export function bestSample(samples: ClockSample[]): ClockSample | null {
  return samples.reduce<ClockSample | null>((best, s) => (best === null || s.rtt_ms < best.rtt_ms ? s : best), null);
}

// --- Lignes écrites ------------------------------------------------------------

interface Fetched { data: unknown[]; recv: number }

/**
 * Colonnes du ticker : prix et minute de référence de l'instantané (heure OKX,
 * pas l'heure locale : un passage en retard reste rangé à la bonne minute).
 */
export function tickerColumns(inst: string, ticker: Fetched): Row {
  const t = first(ticker.data, inst, 'ticker');
  const tsSource = ms(t.ts, 'ts');
  return {
    inst,
    ts_minute: iso(Math.floor(tsSource / MINUTE_MS) * MINUTE_MS),
    last: num(t.last, 'last'),
    bid: opt(t.bidPx, 'bidPx'),
    ask: opt(t.askPx, 'askPx'),
    open24h: opt(t.open24h, 'open24h'),
    high24h: opt(t.high24h, 'high24h'),
    low24h: opt(t.low24h, 'low24h'),
    sod_utc0: opt(t.sodUtc0, 'sodUtc0'),
    vol_base24h: opt(t.volCcy24h, 'volCcy24h'),
    ts_source: iso(tsSource),
  };
}

/** Colonnes du funding, chacune avec sa propre heure source. */
export function fundingColumns(inst: string, funding: Fetched): Row {
  const f = first(funding.data, inst, 'funding');
  return {
    funding_rate: num(f.fundingRate, 'fundingRate'),
    funding_time: isoOrNull(optMs(f.fundingTime, 'fundingTime')),
    funding_ts_source: iso(ms(f.ts, 'ts')),
  };
}

/** Colonnes de l'open interest. */
export function oiColumns(inst: string, oi: Fetched): Row {
  const o = first(oi.data, inst, 'open interest');
  return {
    oi_base: opt(o.oiCcy, 'oiCcy'),
    oi_usd: opt(o.oiUsd, 'oiUsd'),
    oi_ts_source: iso(ms(o.ts, 'ts')),
  };
}

/** Colonnes d'un funding ou d'un open interest absent ou illisible : null, jamais inventées. */
export const NO_FUNDING: Row = { funding_rate: null, funding_time: null, funding_ts_source: null };
export const NO_OI: Row = { oi_base: null, oi_usd: null, oi_ts_source: null };

/**
 * Bougies closes seulement (confirm = "1"), de la plus ancienne à la plus
 * récente. La minute en cours sera écrite au passage suivant, une fois close :
 * la table ne contient que des valeurs définitives.
 */
export function candleRows(inst: string, candles: Fetched): Row[] {
  const rows: Row[] = [];
  for (const raw of candles.data) {
    if (!Array.isArray(raw) || raw.length < 9) throw new Error('bougie : tableau inattendu');
    if (raw[8] !== '1') continue;
    rows.push({
      inst,
      t: iso(ms(raw[0], 't')),
      o: num(raw[1], 'o'),
      h: num(raw[2], 'h'),
      l: num(raw[3], 'l'),
      c: num(raw[4], 'c'),
      vol_base: num(raw[6], 'volCcy'),
      vol_quote: num(raw[7], 'volCcyQuote'),
      ts_recv: iso(candles.recv),
    });
  }
  return rows.sort((a, b) => Date.parse(String(a.t)) - Date.parse(String(b.t)));
}

/**
 * Minutes manquantes : entre la dernière bougie déjà en base et les bougies
 * reçues, puis entre bougies reçues consécutives. Pas de dernière bougie
 * (premier passage) : rien à comparer, aucun trou.
 */
export function findGaps(inst: string, lastStored: number | null, received: number[]): Gap[] {
  const fresh = [...new Set(received)].sort((a, b) => a - b).filter((t) => lastStored === null || t > lastStored);
  const seq = lastStored === null ? fresh : [lastStored, ...fresh];
  const gaps: Gap[] = [];
  for (let i = 1; i < seq.length; i++) {
    const missing = Math.round((seq[i] - seq[i - 1]) / MINUTE_MS) - 1;
    if (missing > 0) {
      gaps.push({ inst, from_t: seq[i - 1] + MINUTE_MS, to_t: seq[i] - MINUTE_MS, missing });
    }
  }
  return gaps;
}

// --- Un instrument -------------------------------------------------------------

interface InstrumentResult { rows: number; gaps: number; errors: string[] }

async function collectInstrument(deps: CollectorDeps, inst: string): Promise<InstrumentResult> {
  const out: InstrumentResult = { rows: 0, gaps: 0, errors: [] };
  const fail = (what: string, e: unknown) => out.errors.push(`${inst} · ${what} : ${message(e)}`);
  const id = encodeURIComponent(inst);
  const get = async (path: string): Promise<Fetched> => {
    const data = await okxGet(deps, path);
    return { data, recv: deps.now() };
  };

  const [ticker, funding, oi, candles] = await Promise.allSettled([
    get(`/api/v5/market/ticker?instId=${id}`),
    get(`/api/v5/public/funding-rate?instId=${id}`),
    get(`/api/v5/public/open-interest?instType=SWAP&instId=${id}`),
    get(`/api/v5/market/candles?instId=${id}&bar=1m&limit=${CANDLES_LIMIT}`),
  ]);

  // Funding et open interest : facultatifs. Absents ou illisibles, leurs
  // colonnes restent null et l'erreur est consignée ; l'instantané part quand même.
  const optional = (what: string, res: PromiseSettledResult<Fetched>, cols: (f: Fetched) => Row, none: Row) => {
    if (res.status === 'rejected') {
      fail(what, res.reason);
      return { cols: none, recv: 0 };
    }
    try {
      return { cols: cols(res.value), recv: res.value.recv };
    } catch (e) {
      fail(what, e);
      return { cols: none, recv: 0 };
    }
  };
  const f = optional('funding', funding, (x) => fundingColumns(inst, x), NO_FUNDING);
  const o = optional('open interest', oi, (x) => oiColumns(inst, x), NO_OI);

  // Instantané : impossible sans ticker (prix et minute de référence).
  if (ticker.status === 'rejected') {
    fail('ticker', ticker.reason);
  } else {
    try {
      const row: Row = {
        ...tickerColumns(inst, ticker.value), ...f.cols, ...o.cols,
        ts_recv: iso(Math.max(ticker.value.recv, f.recv, o.recv)),
      };
      await deps.db.upsert('okx_snapshots', [row], 'inst,ts_minute');
      out.rows += 1;
    } catch (e) {
      fail('instantané', e);
    }
  }

  // Bougies, puis trous : la dernière bougie en base est lue AVANT l'écriture.
  if (candles.status === 'rejected') {
    fail('bougies', candles.reason);
    return out;
  }
  try {
    const rows = candleRows(inst, candles.value);
    if (rows.length === 0) return out;
    const last = await deps.db.select<{ t: string }>('okx_candles_1m',
      { select: 't', inst: `eq.${inst}`, order: 't.desc', limit: '1' });
    const lastStored = last[0] ? Date.parse(last[0].t) : null;
    if (lastStored !== null && Number.isNaN(lastStored)) throw new Error(`dernière bougie illisible (${last[0].t})`);
    await deps.db.upsert('okx_candles_1m', rows, 'inst,t');
    out.rows += rows.length;
    const gaps = findGaps(inst, lastStored, rows.map((r) => Date.parse(String(r.t))));
    if (gaps.length > 0) {
      // Clé (inst, from_t) : un trou déjà signalé n'est pas compté deux fois.
      await deps.db.upsert('collector_gaps', gaps.map((g) => ({
        inst: g.inst, from_t: iso(g.from_t), to_t: iso(g.to_t), missing: g.missing,
      })), 'inst,from_t');
      out.rows += gaps.length;
      out.gaps += gaps.reduce((n, g) => n + g.missing, 0);
    }
  } catch (e) {
    fail('bougies', e);
  }
  return out;
}

// --- Un passage ----------------------------------------------------------------

const round1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);

/**
 * Un passage complet. Ne lève que si le journal (collector_runs) ne peut pas
 * être écrit : toute autre erreur est consignée dans le passage.
 */
export async function runCollector(deps: CollectorDeps): Promise<RunResult> {
  const started = deps.now();
  const errors: string[] = [];

  // 1. Horloge : quelques échantillons, en série, pour profiter de la connexion
  //    déjà ouverte ; on garde le plus court aller-retour.
  const samples: ClockSample[] = [];
  let clockError: unknown = null;
  for (let i = 0; i < (deps.clockSamples ?? 2); i++) {
    try {
      samples.push(await clockSample(deps));
    } catch (e) {
      clockError = e;
    }
  }
  const clock = bestSample(samples);
  if (clock === null) errors.push(`horloge : ${message(clockError)}`);

  // 2. Instruments en parallèle ; chacun consigne ses propres erreurs.
  const results = await Promise.all(deps.instruments.map((inst) => collectInstrument(deps, inst)));
  let rows = 0;
  let gaps = 0;
  for (const r of results) {
    rows += r.rows;
    gaps += r.gaps;
    errors.push(...r.errors);
  }

  // 3. Journal du passage.
  const finished = deps.now();
  const result: RunResult = {
    ok: errors.length === 0,
    started_at: iso(started),
    finished_at: iso(finished),
    duration_ms: finished - started,
    rows,
    gaps,
    okx_offset_ms: round1(clock?.offset_ms ?? null),
    rtt_ms: round1(clock?.rtt_ms ?? null),
    errors,
  };
  await deps.db.insert('collector_runs', [{
    started_at: result.started_at,
    finished_at: result.finished_at,
    ok: result.ok,
    error: errors.length ? errors.join(' ; ').slice(0, ERROR_MAX_CHARS) : null,
    rows,
    okx_offset_ms: result.okx_offset_ms,
    rtt_ms: result.rtt_ms,
  }]);
  return result;
}
