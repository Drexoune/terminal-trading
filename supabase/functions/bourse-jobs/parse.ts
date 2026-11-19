// Lecture des réponses des sources du module Bourse (étape B0). Fonctions
// pures, sans dépendance, testées par Vitest sur des réponses réelles
// (fixtures/*-2026-11-19.*) ou, quand la source exige une clé ou une adresse
// de contact, sur la forme documentée (fixtures/*.documented.json) en
// attendant la réponse réelle de la tâche « explore » (docs/plan-b0.md, B0.1).
//
// Règle commune : une valeur illisible est écartée et comptée, jamais
// remplacée par une valeur inventée. Les cours restent en texte décimal
// jusqu'à Postgres (colonnes numeric) : aucun passage par un flottant.

/** Nombre décimal positif écrit en texte (« 1.1081 », « 230.5 »), sinon null. */
export function decimalText(value: unknown): string | null {
  const s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value ?? '').trim();
  if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return null;
  return Number(s) > 0 ? s : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- CSV (BCE) ---------------------------------------------------------------------

/** CSV RFC 4180 : champs entre guillemets, guillemets doublés, virgules et retours dans un champ. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export interface FxRate { value_date: string; currency: string; per_eur: string }

/**
 * Cours de référence de la BCE (API de données, série EXR, format csvdata,
 * relevé réel du 19/11/2026) : colonnes KEY, CURRENCY, TIME_PERIOD, OBS_VALUE…
 * Seuls les cours de référence quotidiens (EXR.D.<devise>.EUR.SP00.A) sont
 * gardés ; une ligne sans valeur (jour sans fixing) est écartée.
 */
export function parseEcbCsv(text: string): { rates: FxRate[]; skipped: number } {
  const [header, ...lines] = parseCsv(text);
  if (!header) throw new Error('BCE : réponse vide');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`BCE : colonne ${name} absente`);
    return i;
  };
  const [iKey, iCur, iDate, iVal] = [col('KEY'), col('CURRENCY'), col('TIME_PERIOD'), col('OBS_VALUE')];
  const rates: FxRate[] = [];
  let skipped = 0;
  for (const line of lines) {
    const key = line[iKey] ?? '';
    const currency = line[iCur] ?? '';
    const date = line[iDate] ?? '';
    const value = decimalText(line[iVal]);
    if (!/^EXR\.D\.[A-Z]{3}\.EUR\.SP00\.A$/.test(key) || !/^[A-Z]{3}$/.test(currency) || !DATE.test(date) || !value) {
      skipped++;
      continue;
    }
    rates.push({ value_date: date, currency, per_eur: value });
  }
  return { rates, skipped };
}

// --- Massive (ex-Polygon) : clôtures groupées du marché américain -------------------

export interface DailyClose { symbol: string; close: string; source_ts: string | null }

/**
 * GET /v2/aggs/grouped/locale/us/market/stocks/{date} : {status, resultsCount,
 * results: [{T, o, h, l, c, v, vw, t, n}]} ; t = début de la journée en ms.
 * Forme documentée, à confirmer par la tâche « explore ».
 */
export function parseMassiveGrouped(body: unknown): { closes: Map<string, DailyClose>; count: number } {
  const b = (body ?? {}) as { status?: unknown; results?: unknown; error?: unknown; message?: unknown };
  if (b.status !== 'OK' && b.status !== 'DELAYED') {
    const why = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : String(b.status);
    throw new Error(`Massive : ${why.slice(0, 200)}`);
  }
  const closes = new Map<string, DailyClose>();
  const results = Array.isArray(b.results) ? b.results : [];
  for (const r of results as Record<string, unknown>[]) {
    const symbol = typeof r.T === 'string' ? r.T : '';
    const close = decimalText(r.c);
    if (!symbol || !close) continue;
    const t = typeof r.t === 'number' && Number.isFinite(r.t) ? new Date(r.t).toISOString() : null;
    closes.set(symbol, { symbol, close, source_ts: t });
  }
  return { closes, count: results.length };
}

// --- Alpha Vantage -------------------------------------------------------------------

export type AlphaResult =
  | { kind: 'series'; rows: { value_date: string; close: string }[]; refreshed: string | null; timezone: string | null }
  | { kind: 'quota'; message: string }
  | { kind: 'error'; message: string };

/**
 * TIME_SERIES_DAILY : {"Meta Data": {"3. Last Refreshed", "5. Time Zone"…},
 * "Time Series (Daily)": {"AAAA-MM-JJ": {"4. close": "…"}}}. Le dépassement du
 * quota arrive en HTTP 200 avec une seule clé « Information » ou « Note » ; une
 * erreur de symbole, avec « Error Message ».
 */
export function parseAlphaDaily(body: unknown): AlphaResult {
  const b = (body ?? {}) as Record<string, unknown>;
  for (const k of ['Information', 'Note']) {
    if (typeof b[k] === 'string') return { kind: 'quota', message: (b[k] as string).slice(0, 300) };
  }
  if (typeof b['Error Message'] === 'string') return { kind: 'error', message: (b['Error Message'] as string).slice(0, 300) };
  const series = b['Time Series (Daily)'];
  if (!series || typeof series !== 'object') return { kind: 'error', message: 'série quotidienne absente de la réponse' };
  const rows: { value_date: string; close: string }[] = [];
  for (const [date, v] of Object.entries(series as Record<string, Record<string, unknown>>)) {
    const close = decimalText(v?.['4. close']);
    if (DATE.test(date) && close) rows.push({ value_date: date, close });
  }
  rows.sort((a, b2) => a.value_date.localeCompare(b2.value_date));
  const meta = (b['Meta Data'] ?? {}) as Record<string, unknown>;
  return {
    kind: 'series', rows,
    refreshed: typeof meta['3. Last Refreshed'] === 'string' ? meta['3. Last Refreshed'] as string : null,
    timezone: typeof meta['5. Time Zone'] === 'string' ? meta['5. Time Zone'] as string : null,
  };
}

// --- SEC -----------------------------------------------------------------------------

export interface SecCompany { cik: number; ticker: string; name: string; exchange: string | null }

/** company_tickers_exchange.json : {"fields": ["cik","name","ticker","exchange"], "data": [[…]]}. */
export function parseSecTickers(body: unknown): { companies: SecCompany[]; skipped: number } {
  const b = (body ?? {}) as { fields?: unknown; data?: unknown };
  if (!Array.isArray(b.fields) || !Array.isArray(b.data)) throw new Error('SEC : champs « fields » et « data » attendus');
  const idx = (name: string) => {
    const i = (b.fields as unknown[]).indexOf(name);
    if (i < 0) throw new Error(`SEC : champ ${name} absent`);
    return i;
  };
  const [iCik, iName, iTicker, iExch] = [idx('cik'), idx('name'), idx('ticker'), idx('exchange')];
  const seen = new Set<string>();
  const companies: SecCompany[] = [];
  let skipped = 0;
  for (const row of b.data as unknown[][]) {
    const cik = row?.[iCik];
    const ticker = row?.[iTicker];
    const name = row?.[iName];
    const exch = row?.[iExch];
    if (typeof cik !== 'number' || !Number.isInteger(cik) || cik <= 0 || typeof ticker !== 'string'
        || !/^[A-Z0-9.\-]{1,12}$/.test(ticker) || typeof name !== 'string' || !name.trim()) {
      skipped++;
      continue;
    }
    const key = `${cik}|${ticker}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    companies.push({ cik, ticker, name: name.trim().slice(0, 200), exchange: typeof exch === 'string' && exch ? exch : null });
  }
  return { companies, skipped };
}
