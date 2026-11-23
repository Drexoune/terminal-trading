// API v1 du BLS (révisions, PPI sous-jacent, rattrapage de secours, T-040 et T-041) : portage
// de gateway/terminal_gateway/bls_api.py. Variations recalculées en entiers exacts (BigInt),
// arrondies au dixième, demi vers le haut, comme Decimal ROUND_HALF_UP.

import { formatDec, parseDec, subDec, divHalfUp } from './decimal.ts';

export const API_V1 = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
export const DAILY_MAX = 20;
export const MAX_YEARS = 10;

export const DERIVATIONS: Record<string, [string, 'm/m' | 'y/y' | 'diff' | 'level']> = {
  'us-cpi-mm': ['CUSR0000SA0', 'm/m'], 'us-cpi-yy': ['CUUR0000SA0', 'y/y'],
  'us-core-cpi-mm': ['CUSR0000SA0L1E', 'm/m'], 'us-core-cpi-yy': ['CUUR0000SA0L1E', 'y/y'],
  'us-nfp': ['CES0000000001', 'diff'], 'us-unemployment': ['LNS14000000', 'level'],
  'us-ahe-mm': ['CES0500000003', 'm/m'], 'us-ppi-mm': ['WPSFD4', 'm/m'],
  'us-core-ppi-mm': ['WPSFD49104', 'm/m'],
  'us-prod-qq': ['PRS85006092', 'level'], 'us-ulc-qq': ['PRS85006112', 'level'],
};
const KIND_FR = {
  'm/m': 'variation sur un mois recalculée, arrondie au dixième',
  'y/y': 'variation sur un an recalculée, arrondie au dixième',
  diff: 'écart de niveau recalculé', level: 'valeur de la série',
};

export interface ApiData { series: Record<string, Record<string, string>>; latest: Record<string, string>; messages: string[] }
export interface Derived { indicator: string; period: string; value: string; series: string; excerpt: string }

export function requestBody(series: string[], startYear: number, endYear: number) {
  return { seriesid: [...new Set(series)].sort().slice(0, 25), startyear: String(Math.max(startYear, endYear - MAX_YEARS + 1)), endyear: String(endYear) };
}

export function periodKey(year: string, period: string): string | null {
  if (period.length !== 3 || !/^\d\d$/.test(period.slice(1))) return null;
  const n = Number(period.slice(1));
  if (period[0] === 'M' && n >= 1 && n <= 12) return `${year}-${String(n).padStart(2, '0')}`;
  if (period[0] === 'Q' && n >= 1 && n <= 4) return `${year}-Q${n}`;
  return null;
}

export function parseResponse(text: string): ApiData {
  let doc: { status?: string; message?: unknown[]; Results?: { series?: { seriesID: string; data?: { year: unknown; period: unknown; value?: unknown; latest?: string }[] }[] } };
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`réponse illisible : ${(e as Error).message}`);
  }
  const messages = (doc.message ?? []).map(String);
  if (doc.status !== 'REQUEST_SUCCEEDED') throw new Error(`${doc.status} : ${messages.join(' ; ') || 'sans message'}`);
  const series: ApiData['series'] = {};
  const latest: ApiData['latest'] = {};
  for (const s of doc.Results?.series ?? []) {
    const points: Record<string, string> = {};
    for (const row of s.data ?? []) {
      const key = periodKey(String(row.year), String(row.period));
      if (key === null) continue;
      points[key] = String(row.value ?? '').trim();
      if (row.latest === 'true') latest[s.seriesID] = key;
    }
    series[s.seriesID] = points;
  }
  return { series, latest, messages };
}

export function shift(period: string, months: number): string {
  const [year, rest] = period.split('-');
  if (rest.startsWith('Q')) {
    const n = Number(year) * 4 + Number(rest.slice(1)) - 1 + months;
    return `${Math.floor(n / 4)}-Q${(((n % 4) + 4) % 4) + 1}`;
  }
  const n = Number(year) * 12 + Number(rest) - 1 + months;
  return `${Math.floor(n / 12)}-${String((((n % 12) + 12) % 12) + 1).padStart(2, '0')}`;
}

export function derive(indicator: string, period: string, data: ApiData): Derived | null {
  const d = DERIVATIONS[indicator];
  if (!d) return null;
  const [sid, kind] = d;
  const points = data.series[sid] ?? {};
  const cur = parseDec(points[period]);
  if (!cur) return null;
  let value: string;
  let used: [string, string][];
  if (kind === 'level') {
    value = formatDec(cur.n, cur.scale, cur.n < 0n);
    used = [[period, points[period]]];
  } else {
    const back = shift(period, kind === 'y/y' ? -12 : -1);
    const prev = parseDec(points[back]);
    if (!prev || (kind !== 'diff' && prev.n === 0n)) return null;
    used = [[period, points[period]], [back, points[back]]];
    if (kind === 'diff') {
      const r = subDec(cur, prev);
      value = formatDec(r.n, r.scale, r.n < 0n);
    } else {
      // (cur/prev - 1) * 100 au dixième = (cur - prev) * 1000 / prev, en entier arrondi.
      const scale = Math.max(cur.scale, prev.scale);
      const c = cur.n * 10n ** BigInt(scale - cur.scale);
      const p = prev.n * 10n ** BigInt(scale - prev.scale);
      const tenths = divHalfUp((c - p) * 1000n, p);
      value = formatDec(tenths, 1, tenths < 0n);
    }
  }
  const levels = used.map(([p, v]) => `${p} = ${v}`).join(', ');
  return { indicator, period, value, series: sid, excerpt: `API v1 du BLS · ${sid} : ${levels} · ${KIND_FR[kind]}` };
}

export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseDec(a);
  const y = parseDec(b);
  if (!x || !y) return false;
  const s = Math.max(x.scale, y.scale);
  return x.n * 10n ** BigInt(s - x.scale) === y.n * 10n ** BigInt(s - y.scale);
}
