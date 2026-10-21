// @vitest-environment node
/// <reference types="node" />
// Collecteur Supabase du Mode Online : passages complets rejoués sur les
// réponses RÉELLES du REST OKX EEA (fixtures/okx-rest-eea.json, enregistrées par
// curl le 20/10/2026), base simulée en mémoire ; client PostgREST et ses
// en-têtes selon le type de clé ; concordance des lignes écrites avec les
// colonnes de la migration.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CANDLES_LIMIT, DEFAULT_INSTRUMENTS, OKX_EEA_REST, bestSample, candleRows, clockSample, findGaps,
  runCollector, type CollectorDeps,
} from './collector.ts';
import {
  authHeaders, createPostgrest, keyKind, type Db, type FetchLike, type RequestInitLike, type ResponseLike, type Row,
} from './postgrest.ts';

const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

const FIXTURE = JSON.parse(readText('./fixtures/okx-rest-eea.json')) as {
  base: string; responses: Record<string, unknown>;
};
const MIGRATION = readText('../../migrations/20261020120000_online_mode.sql');

const BTC = 'BTC-USDT-SWAP';
const ETH = 'ETH-USDT-SWAP';
const T = (iso: string) => Date.parse(iso);

function response(status: number, body: unknown): ResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/**
 * OKX rejoué : chaque URL appelée doit être exactement une URL enregistrée
 * (sinon 404), ce qui vérifie au passage les chemins et paramètres utilisés.
 * `overrides` remplace une réponse par un corps, un statut HTTP ou une panne réseau.
 */
function okxReplay(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    expect(url.startsWith(`${OKX_EEA_REST}/`)).toBe(true);
    const path = url.slice(OKX_EEA_REST.length);
    const o = overrides[path];
    if (o instanceof Error) throw o;
    if (typeof o === 'number') return response(o, '');
    if (o !== undefined) return response(200, o);
    const body = FIXTURE.responses[path];
    return body === undefined ? response(404, 'inconnu') : response(200, body);
  };
  return { fetch, calls };
}

interface Write { op: 'insert' | 'upsert'; table: string; rows: Row[]; onConflict?: string }

/** Base en mémoire : enregistre les écritures, connaît la dernière bougie par instrument. */
class MemoryDb implements Db {
  writes: Write[] = [];
  selects: { table: string; query: Record<string, string> }[] = [];
  constructor(private lastCandle: Record<string, string> = {}, private failTable?: string) {}

  async insert(table: string, rows: Row[]) {
    if (table === this.failTable) throw new Error(`PostgREST 503 sur ${table} : indisponible`);
    this.writes.push({ op: 'insert', table, rows });
  }

  async upsert(table: string, rows: Row[], onConflict: string) {
    if (table === this.failTable) throw new Error(`PostgREST 503 sur ${table} : indisponible`);
    this.writes.push({ op: 'upsert', table, rows, onConflict });
  }

  async select<T>(table: string, query: Record<string, string>): Promise<T[]> {
    this.selects.push({ table, query });
    const inst = query.inst?.replace(/^eq\./, '') ?? '';
    const t = this.lastCandle[inst];
    return (t ? [{ t }] : []) as T[];
  }

  rows(table: string): Row[] {
    return this.writes.filter((w) => w.table === table).flatMap((w) => w.rows);
  }
}

/** Horloge simulée : avance de `step` ms à chaque lecture. */
function steppingClock(start: number, step = 10) {
  let t = start - step;
  return () => (t += step);
}

// Heure OKX enregistrée par /api/v5/public/time dans la fixture.
const OKX_TIME = 1792492518988;

function deps(over: Partial<CollectorDeps> & { db: Db; fetch: FetchLike }): CollectorDeps {
  return {
    now: steppingClock(OKX_TIME - 200),
    instruments: DEFAULT_INSTRUMENTS,
    okxBase: OKX_EEA_REST,
    ...over,
  };
}

/** Colonnes d'une table de la migration (lignes « nom type … » du create table). */
function migrationColumns(table: string): string[] {
  const block = MIGRATION.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!block) throw new Error(`table ${table} absente de la migration`);
  return block[1].split('\n')
    .map((line) => line.trim().match(/^([a-z_0-9]+)\s+(text|double|timestamptz|boolean|integer|numeric|bigint)\b/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

describe('fixtures OKX réelles', () => {
  it('couvrent chaque URL appelée par un passage', async () => {
    const okx = okxReplay();
    const db = new MemoryDb();
    const result = await runCollector(deps({ fetch: okx.fetch, db }));
    expect(result.errors).toEqual([]);
    expect(FIXTURE.base).toBe(OKX_EEA_REST);
    const paths = okx.calls.map((u) => u.slice(OKX_EEA_REST.length)).sort();
    expect(paths).toEqual([
      '/api/v5/market/candles?instId=BTC-USDT-SWAP&bar=1m&limit=3',
      '/api/v5/market/candles?instId=ETH-USDT-SWAP&bar=1m&limit=3',
      '/api/v5/market/ticker?instId=BTC-USDT-SWAP',
      '/api/v5/market/ticker?instId=ETH-USDT-SWAP',
      '/api/v5/public/funding-rate?instId=BTC-USDT-SWAP',
      '/api/v5/public/funding-rate?instId=ETH-USDT-SWAP',
      '/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP',
      '/api/v5/public/open-interest?instType=SWAP&instId=ETH-USDT-SWAP',
      '/api/v5/public/time',
      '/api/v5/public/time',
    ]);
    expect(CANDLES_LIMIT).toBe(3);
  });
});

describe('passage nominal', () => {
  it('écrit un instantané par instrument, les bougies closes et le journal', async () => {
    const db = new MemoryDb();
    const result = await runCollector(deps({ fetch: okxReplay().fetch, db }));

    expect(result.ok).toBe(true);
    expect(result.rows).toBe(6);   // 2 instantanés + 2 × 2 bougies closes
    expect(result.gaps).toBe(0);

    const snaps = db.writes.filter((w) => w.table === 'okx_snapshots');
    expect(snaps.every((w) => w.op === 'upsert' && w.onConflict === 'inst,ts_minute')).toBe(true);
    const btc = db.rows('okx_snapshots').find((r) => r.inst === BTC)!;
    // Valeurs de la fixture, ts_minute = minute du ticker (heure OKX).
    expect(btc).toMatchObject({
      inst: BTC,
      ts_minute: '2026-10-20T10:35:00.000Z',
      last: 81487.3, bid: 81487.2, ask: 81487.3,
      open24h: 82188.9, high24h: 82733.4, low24h: 81166, sod_utc0: 81909.5, vol_base24h: 57104.9366,
      funding_rate: 0.0000132021683794,
      funding_time: '2026-10-20T16:00:00.000Z',   // prochaine échéance
      oi_base: 30621.5307000001155, oi_usd: 2495045383.58907941095155,
      ts_source: '2026-10-20T10:35:18.368Z',
      funding_ts_source: '2026-10-20T10:32:09.159Z',
      oi_ts_source: '2026-10-20T10:35:20.143Z',
    });
    expect(typeof btc.ts_recv).toBe('string');
    expect(Number.isNaN(Date.parse(String(btc.ts_recv)))).toBe(false);

    // Bougies : la minute en cours (confirm = 0) n'est pas écrite.
    const candles = db.rows('okx_candles_1m').filter((r) => r.inst === BTC);
    expect(candles.map((c) => c.t)).toEqual(['2026-10-20T10:33:00.000Z', '2026-10-20T10:34:00.000Z']);
    expect(candles[1]).toMatchObject({
      o: 81491, h: 81497.8, l: 81480, c: 81480.1, vol_base: 5.1883, vol_quote: 422792.07307,
    });
    expect(db.writes.find((w) => w.table === 'okx_candles_1m')!.onConflict).toBe('inst,t');
    // La dernière bougie en base est lue avant l'écriture, pour chaque instrument.
    expect(db.selects.map((s) => s.query)).toContainEqual(
      { select: 't', inst: `eq.${BTC}`, order: 't.desc', limit: '1' });

    // Journal : une seule ligne, insérée (pas d'upsert), sans erreur.
    const runs = db.writes.filter((w) => w.table === 'collector_runs');
    expect(runs).toHaveLength(1);
    expect(runs[0].op).toBe('insert');
    expect(runs[0].rows[0]).toMatchObject({ ok: true, error: null, rows: 6 });
    expect(runs[0].rows[0].okx_offset_ms).toBeTypeOf('number');
    expect(db.rows('collector_gaps')).toEqual([]);
  });

  it('écrit exactement les colonnes de la migration, mêmes clés à chaque ligne', async () => {
    const db = new MemoryDb({ [BTC]: '2026-10-20T10:20:00+00:00' });
    await runCollector(deps({ fetch: okxReplay().fetch, db }));
    const expectCols = (table: string, rows: Row[], skip: string[] = []) => {
      expect(rows.length).toBeGreaterThan(0);
      const cols = migrationColumns(table).filter((c) => !skip.includes(c)).sort();
      for (const r of rows) expect(Object.keys(r).sort()).toEqual(cols);
    };
    expectCols('okx_snapshots', db.rows('okx_snapshots'));
    expectCols('okx_candles_1m', db.rows('okx_candles_1m'));
    expectCols('collector_runs', db.rows('collector_runs'), ['id']);
    expectCols('collector_gaps', db.rows('collector_gaps'), ['id', 'detected_at']);
  });
});

describe('migration', () => {
  it('colonnes lues par /api/collector-health (api/_lib/supabase.ts), dans cet ordre', () => {
    expect(migrationColumns('collector_runs'))
      .toEqual(['id', 'started_at', 'finished_at', 'ok', 'error', 'rows', 'okx_offset_ms', 'rtt_ms']);
    expect(migrationColumns('collector_gaps')).toEqual(['id', 'inst', 'from_t', 'to_t', 'missing', 'detected_at']);
  });

  it('RLS activée sur chaque table, aucune politique, rien pour les rôles publics', () => {
    const tables = [...MIGRATION.matchAll(/create table public\.([a-z_0-9]+)/g)].map((m) => m[1]);
    expect(tables).toEqual(['okx_snapshots', 'okx_candles_1m', 'collector_runs', 'collector_gaps']);
    for (const t of tables) expect(MIGRATION).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
    expect(MIGRATION).not.toMatch(/create policy/i);
    expect(MIGRATION).toMatch(/revoke all on table[\s\S]*?from anon, authenticated;/);
  });

  it('rétention quotidienne de 90 jours planifiée par pg_cron', () => {
    expect(MIGRATION).toContain("keep interval default interval '90 days'");
    expect(MIGRATION).toContain("select cron.schedule('okx-retention-daily', '17 3 * * *', 'select public.okx_retention()');");
  });
});

describe('erreurs', () => {
  it('une erreur sur un instrument n’empêche pas les autres', async () => {
    const db = new MemoryDb();
    const okx = okxReplay({
      // Réponse d'erreur réelle d'OKX (HTTP 200, code 51001).
      [`/api/v5/market/ticker?instId=${ETH}`]: FIXTURE.responses['/api/v5/market/ticker?instId=NOPE-USDT-SWAP'],
      [`/api/v5/public/open-interest?instType=SWAP&instId=${ETH}`]: 429,
    });
    const result = await runCollector(deps({ fetch: okx.fetch, db }));

    expect(result.ok).toBe(false);
    expect(db.rows('okx_snapshots').map((r) => r.inst)).toEqual([BTC]);
    // Les bougies ETH, lues à part, sont quand même écrites.
    expect(db.rows('okx_candles_1m').filter((r) => r.inst === ETH)).toHaveLength(2);
    expect(result.errors).toEqual([
      `${ETH} · open interest : limite de débit OKX atteinte sur /api/v5/public/open-interest`,
      `${ETH} · ticker : /api/v5/market/ticker : code 51001 Instrument ID, Instrument ID code, or Spread ID doesn't exist.`,
    ]);
    const run = db.rows('collector_runs')[0];
    expect(run.ok).toBe(false);
    expect(run.error).toBe(result.errors.join(' ; '));
    expect(run.rows).toBe(1 + 4);
  });

  it('funding absent : instantané écrit, colonnes funding à null, jamais inventées', async () => {
    const db = new MemoryDb();
    const okx = okxReplay({ [`/api/v5/public/funding-rate?instId=${BTC}`]: new Error('fetch failed') });
    const result = await runCollector(deps({ fetch: okx.fetch, db }));
    const btc = db.rows('okx_snapshots').find((r) => r.inst === BTC)!;
    expect(btc).toMatchObject({ last: 81487.3, funding_rate: null, funding_time: null, funding_ts_source: null });
    expect(btc.oi_usd).toBe(2495045383.58907941095155);
    expect(result.errors).toEqual([`${BTC} · funding : fetch failed`]);
  });

  it('funding ou open interest illisible : instantané écrit quand même, colonnes à null', async () => {
    const db = new MemoryDb();
    const oi = FIXTURE.responses[`/api/v5/public/open-interest?instType=SWAP&instId=${ETH}`] as { data: object[] };
    const okx = okxReplay({
      // Funding d'ETH renvoyé pour BTC ; open interest d'ETH avec un montant illisible.
      [`/api/v5/public/funding-rate?instId=${BTC}`]: FIXTURE.responses[`/api/v5/public/funding-rate?instId=${ETH}`],
      [`/api/v5/public/open-interest?instType=SWAP&instId=${ETH}`]: { ...oi, data: [{ ...oi.data[0], oiUsd: 'abc' }] },
    });
    const result = await runCollector(deps({ fetch: okx.fetch, db }));
    expect(result.errors).toEqual([
      `${BTC} · funding : funding : réponse pour ${ETH}, ${BTC} attendu`,
      `${ETH} · open interest : champ oiUsd illisible ("abc")`,
    ]);
    const btc = db.rows('okx_snapshots').find((r) => r.inst === BTC)!;
    expect(btc).toMatchObject({ last: 81487.3, funding_rate: null, funding_time: null, funding_ts_source: null });
    expect(btc.oi_ts_source).toBe('2026-10-20T10:35:20.143Z');
    const eth = db.rows('okx_snapshots').find((r) => r.inst === ETH)!;
    expect(eth).toMatchObject({ last: 2383.37, oi_base: null, oi_usd: null, oi_ts_source: null });
    expect(eth.funding_rate).toBe(0.00001451190419);
    expect(result.rows).toBe(6);
  });

  it('corps OKX non JSON (page d’erreur d’un intermédiaire) : erreur nommée', async () => {
    const db = new MemoryDb();
    const okx = okxReplay({ [`/api/v5/market/ticker?instId=${BTC}`]: '<html>502 Bad Gateway</html>' });
    const result = await runCollector(deps({ fetch: okx.fetch, db }));
    expect(result.errors).toEqual([`${BTC} · ticker : /api/v5/market/ticker : réponse non JSON`]);
    expect(db.rows('okx_snapshots').map((r) => r.inst)).toEqual([ETH]);
  });

  it('réponse pour un autre instrument : refusée', async () => {
    const db = new MemoryDb();
    const okx = okxReplay({
      [`/api/v5/market/ticker?instId=${ETH}`]: FIXTURE.responses[`/api/v5/market/ticker?instId=${BTC}`],
    });
    const result = await runCollector(deps({ fetch: okx.fetch, db }));
    expect(result.errors).toEqual([`${ETH} · instantané : ticker : réponse pour ${BTC}, ${ETH} attendu`]);
  });

  it('écriture en base refusée : consignée, puis journal écrit', async () => {
    const db = new MemoryDb({}, 'okx_candles_1m');
    const result = await runCollector(deps({ fetch: okxReplay().fetch, db }));
    expect(result.ok).toBe(false);
    expect(result.rows).toBe(2);
    expect(result.errors[0]).toBe(`${BTC} · bougies : PostgREST 503 sur okx_candles_1m : indisponible`);
    expect(db.rows('collector_runs')).toHaveLength(1);
  });

  it('journal impossible à écrire : le passage lève', async () => {
    const db = new MemoryDb({}, 'collector_runs');
    await expect(runCollector(deps({ fetch: okxReplay().fetch, db }))).rejects.toThrow('collector_runs');
  });
});

describe('trous de minutes', () => {
  it('signale les minutes entre la dernière bougie en base et la plus ancienne reçue', async () => {
    // En base : 10:28 ; reçues : 10:33 et 10:34 -> 10:29 à 10:32 manquent.
    const db = new MemoryDb({ [BTC]: '2026-10-20T10:28:00+00:00', [ETH]: '2026-10-20T10:32:00+00:00' });
    const result = await runCollector(deps({ fetch: okxReplay().fetch, db }));
    expect(result.ok).toBe(true);
    expect(result.gaps).toBe(4);
    expect(result.rows).toBe(6 + 1);
    const w = db.writes.find((x) => x.table === 'collector_gaps')!;
    expect(w.onConflict).toBe('inst,from_t');
    expect(w.rows).toEqual([{
      inst: BTC, from_t: '2026-10-20T10:29:00.000Z', to_t: '2026-10-20T10:32:00.000Z', missing: 4,
    }]);
  });

  it('findGaps : chevauchement, premier passage, trou interne, doublons', () => {
    const m = (hm: string) => T(`2026-10-20T${hm}:00Z`);
    expect(findGaps(BTC, m('10:34'), [m('10:33'), m('10:34')])).toEqual([]);   // déjà en base
    expect(findGaps(BTC, m('10:33'), [m('10:33'), m('10:34')])).toEqual([]);   // continuité
    expect(findGaps(BTC, null, [m('10:33'), m('10:34')])).toEqual([]);         // premier passage
    expect(findGaps(BTC, m('10:40'), [m('10:33')])).toEqual([]);               // base en avance
    expect(findGaps(BTC, null, [m('10:34'), m('10:31'), m('10:34')])).toEqual([
      { inst: BTC, from_t: m('10:32'), to_t: m('10:33'), missing: 2 },
    ]);
  });

  it('candleRows : ignore la minute en cours, refuse un tableau tronqué', () => {
    const data = (FIXTURE.responses[`/api/v5/market/candles?instId=${ETH}&bar=1m&limit=3`] as { data: unknown[] }).data;
    const rows = candleRows(ETH, { data, recv: OKX_TIME });
    expect(rows.map((r) => r.t)).toEqual(['2026-10-20T10:33:00.000Z', '2026-10-20T10:34:00.000Z']);
    expect(rows[0]).toMatchObject({ o: 2384.84, c: 2383.52, vol_base: 2384.124, ts_recv: '2026-10-20T10:35:18.988Z' });
    expect(() => candleRows(ETH, { data: [['1792492440000', '1']], recv: 0 })).toThrow('tableau inattendu');
  });
});

describe('horloge', () => {
  it('écart = heure OKX − milieu de l’aller-retour', async () => {
    const times = [OKX_TIME - 100, OKX_TIME + 20];
    const s = await clockSample(deps({ fetch: okxReplay().fetch, db: new MemoryDb(), now: () => times.shift()! }));
    expect(s).toEqual({ offset_ms: 40, rtt_ms: 120 });
  });

  it('garde l’échantillon au plus court aller-retour', () => {
    expect(bestSample([])).toBeNull();
    expect(bestSample([{ offset_ms: 5, rtt_ms: 300 }, { offset_ms: -2, rtt_ms: 80 }, { offset_ms: 9, rtt_ms: 90 }]))
      .toEqual({ offset_ms: -2, rtt_ms: 80 });
  });

  it('journalise l’écart retenu et l’aller-retour', async () => {
    // Début du passage, puis échantillon 1 : 300 ms d'aller-retour (connexion à
    // ouvrir) ; échantillon 2 : 40 ms.
    const times = [OKX_TIME - 1000, OKX_TIME - 400, OKX_TIME - 100, OKX_TIME - 30, OKX_TIME + 10];
    const fallback = steppingClock(OKX_TIME + 20);
    const db = new MemoryDb();
    const result = await runCollector(deps({
      fetch: okxReplay().fetch, db, now: () => times.shift() ?? fallback(),
    }));
    expect(result.okx_offset_ms).toBe(10);   // 988 - (958 + 998) / 2
    expect(result.rtt_ms).toBe(40);
    expect(db.rows('collector_runs')[0]).toMatchObject({ okx_offset_ms: 10, rtt_ms: 40 });
  });

  it('heure OKX indisponible : passage poursuivi, écart null, erreur consignée', async () => {
    const db = new MemoryDb();
    const okx = okxReplay({ '/api/v5/public/time': 503 });
    const result = await runCollector(deps({ fetch: okx.fetch, db }));
    expect(result.okx_offset_ms).toBeNull();
    expect(result.rows).toBe(6);
    expect(result.errors).toEqual(['horloge : OKX HTTP 503 sur /api/v5/public/time']);
  });
});

// --- Client PostgREST ------------------------------------------------------------

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: 'supabase', role })}.c2lnbmF0dXJl`;

function capture(status = 201, body: unknown = '') {
  const calls: { url: string; init: RequestInitLike }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    return response(status, body);
  };
  return { fetch, calls };
}

describe('PostgREST', () => {
  it('clé secrète sb_secret_ : en-tête apikey seul, pas de Bearer', async () => {
    const key = 'sb_secret_abcdefghijklmnop';
    expect(keyKind(key)).toBe('secret');
    expect(authHeaders(key)).toEqual({ apikey: key });
    const c = capture();
    await createPostgrest({ url: 'https://ref.supabase.co/', key, fetch: c.fetch })
      .upsert('okx_snapshots', [{ inst: BTC, last: 1 }], 'inst,ts_minute');
    const { url, init } = c.calls[0];
    expect(url).toBe('https://ref.supabase.co/rest/v1/okx_snapshots?on_conflict=inst%2Cts_minute');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });
    expect(JSON.parse(init.body!)).toEqual([{ inst: BTC, last: 1 }]);
  });

  it('ancienne clé service_role (JWT) : apikey + Authorization Bearer', async () => {
    const key = jwt('service_role');
    expect(keyKind(key)).toBe('legacy-jwt');
    const c = capture();
    await createPostgrest({ url: 'https://ref.supabase.co', key, fetch: c.fetch })
      .insert('collector_runs', [{ ok: true }]);
    expect(c.calls[0].url).toBe('https://ref.supabase.co/rest/v1/collector_runs');
    expect(c.calls[0].init.headers).toEqual({
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal',
    });
  });

  it('refuse les clés publiques ou inconnues', () => {
    expect(() => keyKind('sb_publishable_abc')).toThrow('clé publiable refusée');
    expect(() => keyKind(jwt('anon'))).toThrow('« anon » refusée');
    expect(() => keyKind('n-importe-quoi')).toThrow('format de clé Supabase inconnu');
    expect(() => createPostgrest({ url: 'https://ref.supabase.co', key: 'sb_publishable_x', fetch: capture().fetch }))
      .toThrow('clé publiable refusée');
  });

  it('select : paramètres encodés, réponse JSON', async () => {
    const c = capture(200, [{ t: '2026-10-20T10:34:00+00:00' }]);
    const db = createPostgrest({ url: 'https://ref.supabase.co', key: 'sb_secret_x', fetch: c.fetch });
    const rows = await db.select<{ t: string }>('okx_candles_1m', { select: 't', inst: `eq.${BTC}`, order: 't.desc', limit: '1' });
    expect(rows).toEqual([{ t: '2026-10-20T10:34:00+00:00' }]);
    expect(c.calls[0].url).toBe(
      'https://ref.supabase.co/rest/v1/okx_candles_1m?select=t&inst=eq.BTC-USDT-SWAP&order=t.desc&limit=1');
    expect(c.calls[0].init).toMatchObject({ method: 'GET', headers: { apikey: 'sb_secret_x', Accept: 'application/json' } });
  });

  it('erreur PostgREST : statut et message dans l’exception', async () => {
    const c = capture(401, { code: 'PGRST301', message: 'Invalid JWT', details: null, hint: null });
    const db = createPostgrest({ url: 'https://ref.supabase.co', key: 'sb_secret_x', fetch: c.fetch });
    await expect(db.insert('collector_runs', [{ ok: true }]))
      .rejects.toThrow('PostgREST 401 sur collector_runs : PGRST301 Invalid JWT');
  });

  it('panne réseau ou réponse inattendue : la table est nommée', async () => {
    const down: FetchLike = async () => { throw new Error('fetch failed'); };
    const db = createPostgrest({ url: 'https://ref.supabase.co', key: 'sb_secret_x', fetch: down });
    await expect(db.insert('collector_runs', [{ ok: true }]))
      .rejects.toThrow('PostgREST injoignable sur collector_runs : fetch failed');
    const odd = createPostgrest({ url: 'https://ref.supabase.co', key: 'sb_secret_x', fetch: capture(200, { t: 1 }).fetch });
    await expect(odd.select('okx_candles_1m', { select: 't' })).rejects.toThrow('tableau attendu sur okx_candles_1m');
  });

  it('rien à écrire : aucune requête ; identifiants hors migration refusés', async () => {
    const c = capture();
    const db = createPostgrest({ url: 'https://ref.supabase.co', key: 'sb_secret_x', fetch: c.fetch });
    await db.upsert('okx_candles_1m', [], 'inst,t');
    expect(c.calls).toHaveLength(0);
    await expect(db.insert('runs?select=*', [{ a: 1 }])).rejects.toThrow('table invalide');
    await expect(db.upsert('okx_candles_1m', [{ a: 1 }], 'inst;drop')).rejects.toThrow('on_conflict invalide');
  });
});
