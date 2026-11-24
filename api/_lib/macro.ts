// /api/macro/* — P3 (macro et heatmap). Étape M0 : sonde de l'API de l'OCDE depuis Vercel
// (décision T-057). Le 24/11/2026, l'OCDE renvoie HTTP 500 à toute requête de Supabase qui atteint
// son serveur d'origine, et répond au Mac. Si elle répond à Vercel, une tâche quotidienne de Vercel
// relèvera l'OCDE ; sinon P3 passera par les instituts nationaux.
//
//   GET /api/macro/probe     deux requêtes à l'OCDE (IPC COICOP 2018, chômage), sans écriture ;
//                            en-tête x-jobs-secret exigé (P1_JOBS_SECRET) : personne d'autre ne
//                            consomme le quota de l'OCDE (60 téléchargements par heure).

import { HttpError, json, NO_STORE, readQuery, respond, type Env } from './http.js';
import type { FetchFn } from './okx.js';
import type { Context } from './routes.js';

export const OECD = 'https://sdmx.oecd.org/public/rest/data';
const AREAS = 'USA+GBR+JPN+CHE+CAN+AUS+NZL';
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';
const MIN_SECRET = 32;
const TIMEOUT_MS = 20_000;

export const PROBES: { label: string; url: string }[] = [
  { label: 'oecd-cpi-2018', url: `${OECD}/OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0/${AREAS}.M+Q.N.CPI.._T..GY?startPeriod=2026-04&dimensionAtObservation=AllDimensions&format=csvfilewithlabels` },
  { label: 'oecd-unemployment', url: `${OECD}/OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0/${AREAS}.UNE_LF_M...Y._T.Y_GE15..?startPeriod=2026-04&dimensionAtObservation=AllDimensions&format=csvfilewithlabels` },
];

/** Comparaison à temps constant : empreintes SHA-256 des deux valeurs, comparées octet par octet. */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Une ligne CSV (RFC 4180) : champs entre guillemets, virgules et guillemets doublés compris. */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Nombre de séries et dernière période par zone d'un CSV SDMX. */
export function lastByArea(body: string): Record<string, string> {
  const [head, ...rows] = body.trim().split(/\r?\n/);
  const cols = csvFields(head ?? '');
  const ia = cols.indexOf('REF_AREA'), it = cols.indexOf('TIME_PERIOD'), iv = cols.indexOf('OBS_VALUE');
  const out: Record<string, string> = {};
  if (ia < 0 || it < 0 || iv < 0) return out;
  for (const line of rows) {
    const f = csvFields(line);
    if (f[iv] && (!out[f[ia]] || f[it] > out[f[ia]])) out[f[ia]] = f[it];
  }
  return out;
}

export async function probeOecd(fetchFn: FetchFn, now: () => number) {
  const lines = [];
  for (const p of PROBES) {
    const t0 = now();
    try {
      const r = await fetchFn(p.url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = await r.text();
      lines.push({ label: p.label, status: r.status, ms: now() - t0, size: body.length,
        cache: r.headers.get('cf-cache-status'), age: r.headers.get('age'),
        last: r.status === 200 ? lastByArea(body) : body.slice(0, 80) });
    } catch (e) {
      lines.push({ label: p.label, status: null, ms: now() - t0, error: `${(e as Error).name} : ${(e as Error).message}`.slice(0, 160) });
    }
  }
  return { ok: lines.every((l) => l.status === 200), region: (globalThis as { process?: { env?: Env } }).process?.env?.VERCEL_REGION ?? null, lines };
}

export function handleMacro(request: Request, ctx: Context): Promise<Response> {
  return respond(ctx.env, '/api/macro', async () => {
    if (request.method !== 'GET') throw new HttpError(405, 'méthode non autorisée : GET attendu');
    const q = readQuery(request, ['path']);
    if (q.get('path') !== 'probe') throw new HttpError(404, 'route inconnue (attendue : /api/macro/probe)');
    const secret = ctx.env.P1_JOBS_SECRET?.trim() ?? '';
    if (secret.length < MIN_SECRET) throw new HttpError(503, 'P1_JOBS_SECRET absente des variables de Vercel');
    if (!(await sameSecret(request.headers.get('x-jobs-secret') ?? '', secret))) throw new HttpError(401, 'secret d’appel invalide');
    return json(await probeOecd(ctx.deps.fetch, ctx.deps.now), NO_STORE);
  });
}
