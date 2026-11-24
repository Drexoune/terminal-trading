// Lecture des réponses des sources de P3 (étape M1) et mise en forme commune : une observation =
// (période, valeur). Périodes « AAAA-MM » (mensuelles) ou « AAAA-Qn » (trimestrielles), comme
// l'OCDE et la BCE les écrivent. Module pur, testé sur les captures de M0.

import { csvFields } from './explore.ts';

export interface Obs { period: string; value: number }

const MONTHLY = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTERLY = /^\d{4}-Q[1-4]$/;

/** CSV SDMX (OCDE, BCE) -> observations par clé de série (valeurs des colonnes demandées, jointes par « | »). */
export function sdmxCsv(body: string, keyCols: string[]): Map<string, Obs[]> {
  const [head, ...rows] = body.trim().split(/\r?\n/);
  const cols = csvFields(head ?? '');
  const it = cols.indexOf('TIME_PERIOD'), iv = cols.indexOf('OBS_VALUE');
  const ik = keyCols.map((c) => cols.indexOf(c));
  const out = new Map<string, Obs[]>();
  if (it < 0 || iv < 0 || ik.some((i) => i < 0)) return out;
  for (const line of rows) {
    const f = csvFields(line);
    const v = Number(f[iv]);
    const p = f[it];
    if (f[iv] === '' || !Number.isFinite(v) || !(MONTHLY.test(p) || QUARTERLY.test(p))) continue;
    const k = ik.map((i) => f[i]).join('|');
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ period: p, value: v });
  }
  for (const s of out.values()) s.sort((a, b) => (a.period < b.period ? -1 : 1));
  return out;
}

/** CSV de FRED (date AAAA-MM-JJ du premier jour de la période) -> observations mensuelles ou trimestrielles. */
export function fredCsv(body: string, freq: 'M' | 'Q'): Obs[] {
  const out: Obs[] = [];
  for (const line of body.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(',');
    const x = Number(v);
    if (!/^\d{4}-\d{2}-01$/.test(d ?? '') || v === '' || v === '.' || !Number.isFinite(x)) continue;
    const m = Number(d.slice(5, 7));
    out.push({ period: freq === 'M' ? d.slice(0, 7) : `${d.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`, value: x });
  }
  return out;
}

/** CSV de FRED quotidien (changes) -> dernière valeur de chaque mois. */
export function fredMonthEnd(body: string): Obs[] {
  const last = new Map<string, number>();
  for (const line of body.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(',');
    const x = Number(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') || v === '' || v === '.' || !Number.isFinite(x)) continue;
    last.set(d.slice(0, 7), x);   // ordre chronologique : la dernière date du mois gagne
  }
  return [...last.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([period, value]) => ({ period, value }));
}

/** CSV du BIS (WS_CBPOL mensuel) -> observations par zone. Les libellés entre guillemets sont lus correctement. */
export function bisMonthly(body: string): Map<string, Obs[]> {
  return sdmxCsv(body, ['REF_AREA']);
}

/** Variation sur un an (en %) d'un indice : 12 mois ou 4 trimestres plus tôt, période exacte exigée. */
export function yoy(series: Obs[], freq: 'M' | 'Q'): Obs[] {
  const byPeriod = new Map(series.map((o) => [o.period, o.value]));
  const out: Obs[] = [];
  for (const o of series) {
    const prev = byPeriod.get(shiftPeriod(o.period, freq === 'M' ? -12 : -4));
    if (prev === undefined || prev === 0) continue;
    out.push({ period: o.period, value: Math.round((o.value / prev - 1) * 1e6) / 1e4 });
  }
  return out;
}

/** Période décalée de n mois (« AAAA-MM ») ou n trimestres (« AAAA-Qn »). */
export function shiftPeriod(p: string, n: number): string {
  if (QUARTERLY.test(p)) {
    const i = Number(p.slice(0, 4)) * 4 + Number(p.slice(6)) - 1 + n;
    return `${Math.floor(i / 4)}-Q${(i % 4) + 1}`;
  }
  const i = Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Dernier jour de la période (AAAA-MM-JJ). */
export function periodEnd(p: string): string {
  if (QUARTERLY.test(p)) {
    const y = Number(p.slice(0, 4)), q = Number(p.slice(6));
    return new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
  }
  const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
