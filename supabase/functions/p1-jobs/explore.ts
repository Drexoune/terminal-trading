// Étape O0 du plan « Tout en ligne » (docs/plan-online.md) : sonde des sources de P1
// DEPUIS Supabase, c'est-à-dire depuis les adresses IP qui feront la capture. Rien n'est
// écrit en base, aucun message n'est envoyé.
//
// Une requête par source, une seconde d'écart entre deux requêtes au BLS (règle T-023) :
//   - BLS : deux pages résumé, la page complète du CPI, le calendrier bls.ics, l'index
//     des archives, l'API v1 (une requête des 25 du jour) ;
//   - ForexFactory : le XML de la semaine (une requête, comme le relevé horaire) ;
//   - Telegram : getMe (vérifie le jeton, n'envoie rien) ;
//   - OKX EEA : heure du serveur.
// Mesures : statut, en-têtes utiles, taille, octets nuls, titre et ligne d'embargo,
// délais, écart d'horloge de la fonction (en-tête Date du BLS, heure OKX), coût CPU
// de la recherche de l'embargo et d'une lecture complète (budget de 2 s par requête).
//
// Module pur : réseau, horloges et variables injectés, testé par Vitest.

export interface HeadersLike { get(name: string): string | null }
export interface ProbeResponse { status: number; headers: HeadersLike; text(): Promise<string> }
export interface ProbeInit { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
export type ProbeFetch = (url: string, init?: ProbeInit) => Promise<ProbeResponse>;

export interface ExploreDeps {
  fetch: ProbeFetch;
  now: () => number;              // horloge murale (ms)
  perf: () => number;             // horloge monotone fine (ms), pour le coût CPU
  sleep: (ms: number) => Promise<void>;
  env: (name: string) => string | undefined;
}

export const BLS = 'https://www.bls.gov';
export const BLS_API = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
export const FF_XML = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
export const OKX_TIME = 'https://eea.okx.com/api/v5/public/time';
export const TELEGRAM = 'https://api.telegram.org';
const BLS_SPACING_MS = 1_000;
const TIMEOUT_MS = 10_000;
const KEPT_HEADERS = ['date', 'last-modified', 'etag', 'cache-control', 'age', 'server', 'content-type',
  'content-length', 'x-cache', 'akamai-grn', 'pool-info', 'via', 'retry-after'];

export const BLS_PAGES = [
  { label: 'bls-cpi-nr0', url: `${BLS}/news.release/cpi.nr0.htm` },
  { label: 'bls-empsit-nr0', url: `${BLS}/news.release/empsit.nr0.htm` },
  { label: 'bls-cpi-complete', url: `${BLS}/news.release/cpi.htm` },
  { label: 'bls-calendar-ics', url: `${BLS}/schedule/news_release/bls.ics` },
  { label: 'bls-cpi-archives-index', url: `${BLS}/bls/news-release/cpi.htm` },
];

export interface ProbeLine {
  label: string;
  url: string;
  status: number | null;
  ms_headers: number | null;      // envoi -> en-têtes reçus
  ms_total: number | null;        // envoi -> corps lu
  size: number | null;
  null_bytes: number | null;
  headers: Record<string, string>;
  clock_skew_ms?: number | null;  // horloge de la fonction - en-tête Date (à ±0,5 s : Date est à la seconde)
  title?: string | null;
  embargo?: string | null;
  extract?: unknown;
  cpu_ms?: { embargo_scan: number; full_strip: number } | null;
  error?: string | null;
}

export interface ExploreReport {
  job: 'explore';
  started_at: string;
  finished_at: string;
  region: string | null;
  bls_contact: boolean;
  lines: ProbeLine[];
  verdict: Record<string, string>;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const EMBARGO = /embargoed\s+until[^<\n]{0,120}/i;

/** Remplace un secret par « <masqué> » dans toute chaîne qui sort de la sonde. */
export function scrub(text: string, secrets: (string | undefined)[]): string {
  return secrets.reduce<string>((t, s) => (s && s.length >= 8 ? t.split(s).join('<masqué>') : t), text);
}

function kept(h: HeadersLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEPT_HEADERS) {
    const v = h.get(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

async function probe(deps: ExploreDeps, label: string, url: string, init: ProbeInit,
  secrets: (string | undefined)[], shownUrl = url): Promise<{ line: ProbeLine; body: string | null }> {
  const line: ProbeLine = { label, url: shownUrl, status: null, ms_headers: null, ms_total: null, size: null,
    null_bytes: null, headers: {} };
  const t0 = deps.now();
  try {
    const r = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const t1 = deps.now();
    const body = await r.text();
    const t2 = deps.now();
    line.status = r.status;
    line.ms_headers = t1 - t0;
    line.ms_total = t2 - t0;
    line.size = body.length;
    line.null_bytes = (body.match(/\u0000/g) ?? []).length;
    line.headers = kept(r.headers);
    const date = r.headers.get('date');
    if (date) {
      const server = Date.parse(date);
      // La réponse a été datée entre l'envoi et la réception des en-têtes : on prend le milieu.
      if (Number.isFinite(server)) line.clock_skew_ms = Math.round((t0 + t1) / 2 - server);
    }
    return { line, body };
  } catch (e) {
    line.error = scrub(String((e as Error)?.message ?? e).slice(0, 300), secrets);
    line.ms_total = deps.now() - t0;
    return { line, body: null };
  }
}

/** Coût de la recherche de l'embargo seule, et d'une lecture complète (balises retirées). */
export function cpuCost(body: string, perf: () => number): { embargo_scan: number; full_strip: number } {
  const a = perf();
  EMBARGO.exec(body);
  const b = perf();
  body.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
  const c = perf();
  return { embargo_scan: Math.round((b - a) * 100) / 100, full_strip: Math.round((c - b) * 100) / 100 };
}

function verdictFor(line: ProbeLine | undefined): string {
  if (!line) return 'non sondé';
  if (line.error) return `injoignable : ${line.error}`;
  if (line.status === 200) return line.null_bytes ? `200 mais ${line.null_bytes} octets nuls` : 'ok';
  if (line.status === 403 || line.status === 429) return `refusé (HTTP ${line.status}) : no-go pour cette source`;
  return `HTTP ${line.status}`;
}

export async function explore(deps: ExploreDeps): Promise<ExploreReport> {
  const started = deps.now();
  const email = deps.env('BLS_CONTACT_EMAIL')?.trim();
  const token = deps.env('TELEGRAM_BOT_TOKEN')?.trim();
  const secrets = [token, email];
  const lines: ProbeLine[] = [];

  // BLS : pages, une par seconde, avec l'adresse de contact dans le User-Agent (T-023).
  if (email) {
    const ua = { 'User-Agent': `terminal-trading/0.1 (${email})`, 'Accept-Encoding': 'gzip' };
    for (const [i, p] of BLS_PAGES.entries()) {
      if (i) await deps.sleep(BLS_SPACING_MS);
      const { line, body } = await probe(deps, p.label, p.url, { headers: ua }, secrets);
      if (body !== null) {
        line.title = TITLE.exec(body)?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null;
        line.embargo = EMBARGO.exec(body)?.[0]?.replace(/\s+/g, ' ').trim() ?? null;
        if (p.label === 'bls-cpi-nr0') line.cpu_ms = cpuCost(body, deps.perf);
      }
      lines.push(line);
    }
    await deps.sleep(BLS_SPACING_MS);
    const { line, body } = await probe(deps, 'bls-api-v1', BLS_API, {
      method: 'POST', headers: { ...ua, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seriesid: ['CUSR0000SA0', 'WPSFD49104'] }),
    }, secrets);
    if (body !== null) {
      try {
        const doc = JSON.parse(body) as { status?: string; message?: string[]; Results?: { series?: { seriesID: string; data: { year: string; period: string; value: string; latest?: string }[] }[] } };
        line.extract = {
          status: doc.status, message: doc.message,
          latest: (doc.Results?.series ?? []).map((s) => ({ series: s.seriesID, ...s.data.find((d) => d.latest === 'true') })),
        };
      } catch {
        line.extract = { error: 'réponse non JSON', start: body.slice(0, 200) };
      }
    }
    lines.push(line);
  }

  // ForexFactory : une requête, comme le relevé horaire.
  {
    const { line, body } = await probe(deps, 'forexfactory-xml', FF_XML,
      { headers: { 'User-Agent': 'terminal-trading/0.1' } }, secrets);
    if (body !== null) line.extract = { events: (body.match(/<event>/g) ?? []).length, start: body.slice(0, 120) };
    lines.push(line);
  }

  // Telegram : getMe vérifie le jeton depuis Supabase, sans envoyer de message.
  if (token) {
    const { line, body } = await probe(deps, 'telegram-getme', `${TELEGRAM}/bot${token}/getMe`, {}, secrets,
      `${TELEGRAM}/bot<masqué>/getMe`);
    if (body !== null) {
      try {
        const doc = JSON.parse(body) as { ok?: boolean; result?: { username?: string }; description?: string };
        line.extract = { ok: doc.ok, username: doc.result?.username ?? null, description: doc.description ?? null };
      } catch {
        line.extract = { error: 'réponse non JSON' };
      }
    }
    lines.push(line);
  }

  // OKX EEA : écart entre l'horloge de la fonction et celle d'OKX.
  {
    const t0 = deps.now();
    const { line, body } = await probe(deps, 'okx-time', OKX_TIME, {}, secrets);
    const t1 = t0 + (line.ms_headers ?? 0);
    if (body !== null) {
      try {
        const ts = Number((JSON.parse(body) as { data?: { ts?: string }[] }).data?.[0]?.ts);
        line.extract = Number.isFinite(ts) ? { okx_ts: ts, clock_skew_vs_okx_ms: Math.round((t0 + t1) / 2 - ts) } : { error: 'ts absent' };
      } catch {
        line.extract = { error: 'réponse non JSON' };
      }
    }
    lines.push(line);
  }

  const by = (label: string) => lines.find((l) => l.label === label);
  const verdict: Record<string, string> = {
    bls_pages: email ? verdictFor(by('bls-cpi-nr0')) : 'non sondé : BLS_CONTACT_EMAIL absent des secrets',
    bls_api: email ? verdictFor(by('bls-api-v1')) : 'non sondé : BLS_CONTACT_EMAIL absent des secrets',
    forexfactory: verdictFor(by('forexfactory-xml')),
    telegram: token ? verdictFor(by('telegram-getme')) : 'non sondé : TELEGRAM_BOT_TOKEN absent des secrets',
    okx: verdictFor(by('okx-time')),
  };
  return {
    job: 'explore', started_at: new Date(started).toISOString(), finished_at: new Date(deps.now()).toISOString(),
    region: deps.env('SB_REGION') ?? null, bls_contact: !!email,
    lines: lines.map((l) => JSON.parse(scrub(JSON.stringify(l), secrets)) as ProbeLine),
    verdict,
  };
}
