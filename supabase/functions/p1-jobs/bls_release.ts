// Lecture des communiqués du BLS en ligne (plan « Tout en ligne », étape O3) : portage
// TypeScript de gateway/terminal_gateway/bls_release.py. Mêmes règles, mêmes tournures,
// mêmes messages ; bls_release.test.ts vérifie qu'il redonne exactement la lecture Python
// des 124 pages du corpus réel (gateway/tests/fixtures/bls/golden_parser.json).
//
// Règle : échouer fermé. Une forme inconnue donne value = null avec la raison, jamais un
// chiffre deviné ; une valeur hors bornes est gardée et signalée.

import { NEW_YORK, zonedToUtc } from './calendar.ts';

export const BLS = 'https://www.bls.gov';

export interface Release {
  key: string; title: string; url: string; fallback: string; indicators: string[]; quarterly: boolean;
}

export const RELEASES: Record<string, Release> = {
  cpi: { key: 'cpi', title: 'Consumer Price Index', url: `${BLS}/news.release/cpi.nr0.htm`, fallback: `${BLS}/news.release/cpi.htm`,
    indicators: ['us-cpi-mm', 'us-cpi-yy', 'us-core-cpi-mm', 'us-core-cpi-yy'], quarterly: false },
  empsit: { key: 'empsit', title: 'Employment Situation', url: `${BLS}/news.release/empsit.nr0.htm`, fallback: `${BLS}/news.release/empsit.htm`,
    indicators: ['us-nfp', 'us-unemployment', 'us-ahe-mm'], quarterly: false },
  ppi: { key: 'ppi', title: 'Producer Price Index', url: `${BLS}/news.release/ppi.nr0.htm`, fallback: `${BLS}/news.release/ppi.htm`,
    indicators: ['us-ppi-mm', 'us-core-ppi-mm'], quarterly: false },
  prod2: { key: 'prod2', title: 'Productivity and Costs', url: `${BLS}/news.release/prod2.nr0.htm`, fallback: `${BLS}/news.release/prod2.htm`,
    indicators: ['us-prod-qq', 'us-ulc-qq'], quarterly: true },
};
export const BY_TITLE: Record<string, Release> = Object.fromEntries(Object.values(RELEASES).map((r) => [r.title, r]));

const BOUNDS: Record<string, [number, number]> = {
  'us-cpi-mm': [-3, 3], 'us-core-cpi-mm': [-3, 3], 'us-cpi-yy': [-5, 20], 'us-core-cpi-yy': [-5, 20],
  'us-nfp': [-25000, 10000], 'us-unemployment': [0, 30], 'us-ahe-mm': [-3, 3],
  'us-ppi-mm': [-5, 5], 'us-core-ppi-mm': [-5, 5], 'us-prod-qq': [-30, 40], 'us-ulc-qq': [-30, 40],
};

const UP = 'increased|rose|advanced|moved up|edged up|climbed|jumped|gained|was up';
const DOWN = 'decreased|declined|fell|edged down|moved down|dropped|was down';
const FLAT = 'was unchanged|were unchanged|was essentially unchanged|remained unchanged';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const QUARTERS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const full = (alt: string) => new RegExp(`^(?:${alt})$`);

export interface Figure {
  indicator: string;
  value: string | null;          // texte décimal tel que publié (milliers pour l'emploi)
  reason: string | null;
  part: string | null;           // « tableau A », « texte »
  excerpt: string | null;        // passage lu, pour citer la source
  flags: string[];
}

const fig = (indicator: string, value: string | null, reason: string | null = null, part: string | null = null,
  excerpt: string | null = null, flags: string[] = []): Figure => ({ indicator, value, reason, part, excerpt, flags });

export interface Parsed {
  release: string;
  page: string;                  // « ok », « vide », « octets nuls », « page d'erreur », « forme inconnue »
  title: string | null;
  period: string | null;
  edition: string | null;
  embargo_text: string | null;
  embargo_ms: number | null;
  embargo_date: string | null;
  figures: Record<string, Figure>;
  problems: string[];
}

const blank = (release: string, page: string, problems: string[] = []): Parsed => ({
  release, page, title: null, period: null, edition: null, embargo_text: null, embargo_ms: null, embargo_date: null, figures: {}, problems,
});

// --- page ----------------------------------------------------------------------------

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const PRE = /<pre[^>]*>([\s\S]*?)<\/pre>/i;
const PERIOD_M = /(\d{4}) M(\d{2}) Results/;
const EMBARGO = /embargoed until (?:USDL[- ]?\d{2}-\d+ )?(\d{1,2}):(\d{2}) ([ap])\.m\. \(ET\) ([A-Z][a-z]+),? ([A-Z][a-z]+)\.? (\d{1,2}), (\d{4})/;
// Mois insensibles à la casse (Python : groupe « (?i:…) ») ; le reste de l'en-tête l'est.
const ci = (w: string) => [...w].map((c) => `[${c.toUpperCase()}${c}]`).join('');
const HEADING_M = new RegExp(`(?:CONSUMER PRICE INDEX|PRODUCER PRICE INDEXES|THE EMPLOYMENT SITUATION) ?-+ ?(${MONTHS.map(ci).join('|')}) (\\d{4})`);
const HEADING_Q = /(First|Second|Third|Fourth) Quarter(?: and Annual Averages)? (\d{4}),? (Preliminary|Revised)/;

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”',
  ldquo: '“', mdash: '—', ndash: '–', minus: '−', hellip: '…', deg: '°', middot: '·',
};

function unescapeHtml(s: string): string {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�';
    }
    return NAMED[e] ?? all;
  });
}

/** HTML -> texte sur une ligne : balises retirées, entités décodées, espaces fusionnés. */
export function normalize(fragment: string): string {
  let t = fragment.replace(/<br\s*\/?>/gi, ' ');
  t = unescapeHtml(t.replace(/<[^>]+>/g, ''));
  t = t.replace(/ /g, ' ').replace(/−/g, '-').replace(/–/g, '-').replace(/’/g, "'").replace(/�/g, ' ');
  return t.split(/[\s\u001c-\u001f\u0085]+/).filter(Boolean).join(' ');
}

export function pageText(body: string): string {
  const m = PRE.exec(body);
  return m ? normalize(m[1]) : '';
}

function embargo(text: string): [string | null, number | null, string | null, string | null] {
  const m = EMBARGO.exec(text.slice(0, 600));
  if (!m) return [null, null, null, null];
  const [, hour, minute, ampm, weekday, month, day, year] = m;
  const mon = MONTHS.findIndex((n) => n.startsWith(month.toLowerCase().slice(0, 3))) + 1;
  const d = Number(day);
  const h = (Number(hour) % 12) + (ampm === 'p' ? 12 : 0);
  const valid = mon > 0 && d >= 1 && new Date(Date.UTC(Number(year), mon - 1, d)).getUTCDate() === d && h < 24 && Number(minute) < 60;
  if (!valid) return [m[0], null, null, `date d'embargo illisible : '${m[0]}'`];
  const ms = zonedToUtc(Number(year), mon, d, h, Number(minute), NEW_YORK);
  const actual = WEEKDAYS[new Date(Date.UTC(Number(year), mon - 1, d)).getUTCDay()];
  const problem = actual !== weekday ? `jour de semaine incohérent dans l'embargo : ${weekday} ≠ ${actual}` : null;
  return [m[0], ms, `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`, problem];
}

function countZero(raw: Uint8Array): number {
  let n = 0;
  for (const b of raw) if (b === 0) n++;
  return n;
}

const isSpace = (b: number) => b === 32 || (b >= 9 && b <= 13);

/** Page du BLS -> métadonnées et chiffres. Ne lève jamais : tout problème est noté. */
export function parsePage(release: string, raw: Uint8Array): Parsed {
  const rel = RELEASES[release];
  if (raw.every(isSpace)) return blank(release, 'vide');
  const zeros = countZero(raw);
  if (zeros) return blank(release, 'octets nuls', [`${zeros} octets nuls`]);
  const body = new TextDecoder('utf-8').decode(raw);
  const out = blank(release, 'ok');
  const tm = TITLE.exec(body.slice(0, 20_000));
  out.title = tm ? unescapeHtml(tm[1]).split(/\s+/).filter(Boolean).join(' ') : null;
  if (out.title && (out.title.includes('cannot be found') || out.title.startsWith('Sorry'))) {
    out.page = "page d'erreur";
    return out;
  }
  const text = pageText(body);
  if (!text) {
    out.page = 'forme inconnue';
    out.problems.push('aucun bloc <pre> : forme du communiqué inconnue');
    return out;
  }
  const [etext, ems, edate, problem] = embargo(text);
  [out.embargo_text, out.embargo_ms, out.embargo_date] = [etext, ems, edate];
  if (problem) out.problems.push(problem);
  if (out.embargo_ms === null) out.problems.push("ligne d'embargo absente ou illisible");
  if (rel.quarterly) {
    const q = HEADING_Q.exec(text.slice(0, 1500));
    if (q) {
      out.period = `${q[2]}-Q${QUARTERS[q[1].toLowerCase()]}`;
      out.edition = q[3];
    }
  } else {
    const h = HEADING_M.exec(text.slice(0, 1500));
    if (h) {
      out.period = `${h[2]}-${String(MONTHS.indexOf(h[1].toLowerCase()) + 1).padStart(2, '0')}`;
      const p = PERIOD_M.exec(out.title ?? '');
      if (p && Number(p[2]) <= 12 && `${p[1]}-${p[2]}` !== out.period) {
        out.problems.push(`période du titre (${p[0]}) ≠ en-tête (${out.period})`);
        out.page = 'forme inconnue';
        return out;
      }
    }
  }
  if (out.period === null) {
    out.problems.push('période introuvable (titre ou en-tête)');
    out.page = 'forme inconnue';
    return out;
  }
  const reader = { cpi: readCpi, empsit: readEmpsit, ppi: readPpi, prod2: readProd2 }[release as 'cpi']!;
  out.figures = reader(body, text, out.period);
  for (const f of Object.values(out.figures)) {
    if (f.value !== null) {
      const [lo, hi] = BOUNDS[f.indicator];
      const v = Number(f.value);
      if (!(lo <= v && v <= hi)) out.figures[f.indicator] = { ...f, flags: [...f.flags, 'hors bornes'] };
    }
  }
  return out;
}

// --- outils ----------------------------------------------------------------------------

function dec(s: string): string | null {
  const t = s.trim();
  return /^-?\d+(?:\.\d+)?$/.test(t) ? t : null;
}

/** Verbe + nombre -> texte décimal signé ; « unchanged » -> « 0.0 ». */
function signed(verb: string, number: string | undefined): string | null {
  const v = verb.toLowerCase();
  if (full(FLAT).test(v)) return number === undefined ? '0.0' : null;
  if (number === undefined) return null;
  if (full(UP).test(v)) return number;
  if (full(DOWN).test(v)) return number === '0.0' ? number : `-${number}`;
  return null;
}

/** « +165,000 » -> « 165 » ; « -23,000 » -> « -23 » (milliers, exact). */
function thousands(raw: string): string {
  const sign = raw.startsWith('-') || raw.startsWith('−') ? '-' : '';
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const padded = digits.padStart(4, '0');
  const int = padded.slice(0, -3).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(-3).replace(/0+$/, '');
  const s = frac ? `${int}.${frac}` : int;
  return s !== '0' ? `${sign}${s}` : '0';
}

const excerpt = (text: string, m: RegExpExecArray, width = 200) => text.slice(m.index, Math.min(text.length, m.index + width));

function monthAbbr(period: string): [string, string] {
  const [y, m] = period.split('-');
  return [MONTHS[Number(m) - 1].slice(0, 3), y];
}

// --- tableaux HTML du BLS -----------------------------------------------------------------

interface Table { columns: string[]; rows: [string, string[]][] }

export function readTable(body: string, tableId: string): Table | null {
  const id = tableId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`<table[^>]*id="${id}"[^>]*>([\\s\\S]*?)</table>`).exec(body);
  if (!m) return null;
  const inner = m[1];
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(inner);
  const headRows = [...(head ? head[1] : '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((x) => x[1]);
  const cols: string[] = [];
  if (headRows.length) {
    const first = [...headRows[0].matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/g)];
    let second = [...(headRows[1] ?? '').matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/g)].map((x) => normalize(x[2]));
    for (const [, attrs, cell] of first.slice(1)) {
      const span = /colspan="(\d+)"/.exec(attrs);
      if (span) {
        const n = Number(span[1]);
        cols.push(...second.slice(0, n));
        second = second.slice(n);
      } else {
        cols.push(normalize(cell));
      }
    }
  }
  const bodyHtml = head ? inner.slice(head.index + head[0].length) : inner;
  const rows: [string, string[]][] = [];
  for (const [, tr] of bodyHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const th = /<th[^>]*>([\s\S]*?)<\/th>/.exec(tr);
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => normalize(x[1]));
    if (th === null) continue;
    rows.push([normalize(th[1]), cells]);
  }
  return { columns: cols, rows };
}

const label = (s: string) => s.replace(/\(\d+\)/g, '').trim().toLowerCase();

function crossCheck(f: Figure, m: RegExpExecArray | null, text: string): Figure {
  if (f.value === null) return f;
  if (m === null) return { ...f, flags: [...f.flags, 'texte non trouvé'] };
  const said = signed(m[1], m[2]);
  if (said === null) return { ...f, flags: [...f.flags, 'texte illisible'] };
  if (Number(said) !== Number(f.value)) {
    return fig(f.indicator, null, `désaccord texte (${said}) / tableau A (${f.value})`, f.part, excerpt(text, m));
  }
  return { ...f, excerpt: excerpt(text, m), flags: [...f.flags, 'texte concordant'] };
}

// --- IPC ------------------------------------------------------------------------------------

const CPI_LEAD = new RegExp(`The Consumer Price Index for All Urban Consumers \\(CPI-U\\) (${UP}|${DOWN}|${FLAT})(?: (\\d+\\.\\d) percent)?([^.]*)`);
const CPI_CORE_MM = new RegExp(`index for all items less food and energy (${UP}|${DOWN}|${FLAT})(?: (\\d+\\.\\d) percent)?`, 'g');
const CPI_YY = new RegExp(`Over the last 12 months, the all items index (${UP}|${DOWN}|${FLAT})(?: (\\d+\\.\\d) percent)?`);
const CPI_CORE_YY = new RegExp(`all items less food and energy index (${UP}|${DOWN}|${FLAT})(?: (\\d+\\.\\d) percent)? over the last 12 months`);

function readCpi(body: string, text: string, period: string): Record<string, Figure> {
  const out: Record<string, Figure> = {};
  const lead = CPI_LEAD.exec(text);
  const irregular = !!(lead && /over the \d+ months|from \w+ \d{4} to \w+ \d{4}/.test(lead[3]));
  const table = readTable(body, 'cpi_pressa');
  const [month, year] = monthAbbr(period);
  if (table === null || table.columns.length < 2) {
    const why = 'tableau A absent : forme du communiqué inconnue';
    return Object.fromEntries(RELEASES.cpi.indicators.map((i) => [i, fig(i, null, why)]));
  }
  const monthly = table.columns[table.columns.length - 2].toLowerCase().replace(/\./g, '');
  const yearly = table.columns[table.columns.length - 1].toLowerCase().replace(/\./g, '');
  const monthlyOk = monthly.startsWith(month) && monthly.endsWith(year);
  const yearlyOk = yearly.includes('12') && yearly.includes(month) && yearly.includes(year);
  const rows = new Map(table.rows.map(([l, c]) => [label(l), c] as const));
  const cell = (row: string, col: number, ok: boolean, ind: string, what: string): Figure => {
    const cells = rows.get(row);
    if (!ok) return fig(ind, null, `colonne ${what} du tableau A ≠ période ${period}`, 'tableau A');
    if (cells === undefined || cells.length !== table.columns.length) return fig(ind, null, `ligne « ${row} » absente du tableau A`, 'tableau A');
    const c = cells[cells.length + col];
    const v = dec(c);
    if (v === null) return fig(ind, null, `non publié par le BLS (« ${c} »)`, 'tableau A');
    return fig(ind, v, null, 'tableau A', `Table A · ${row} · ${table.columns[table.columns.length + col]}`);
  };
  if (irregular) {
    const why = 'publication irrégulière : variation sur plusieurs mois (shutdown)';
    out['us-cpi-mm'] = fig('us-cpi-mm', null, why, 'texte', excerpt(text, lead!));
    out['us-core-cpi-mm'] = fig('us-core-cpi-mm', null, why, 'texte');
  } else {
    out['us-cpi-mm'] = cell('all items', -2, monthlyOk, 'us-cpi-mm', 'du mois');
    out['us-core-cpi-mm'] = cell('all items less food and energy', -2, monthlyOk, 'us-core-cpi-mm', 'du mois');
  }
  out['us-cpi-yy'] = cell('all items', -1, yearlyOk, 'us-cpi-yy', 'sur 12 mois');
  out['us-core-cpi-yy'] = cell('all items less food and energy', -1, yearlyOk, 'us-core-cpi-yy', 'sur 12 mois');
  const coreMm = [...text.matchAll(CPI_CORE_MM)].find((m) => !text.slice(m.index! + m[0].length, m.index! + m[0].length + 40).includes('12 months'));
  const checks: Record<string, RegExpExecArray | null> = {
    'us-cpi-mm': lead,
    'us-core-cpi-mm': (coreMm as RegExpExecArray | undefined) ?? null,
    'us-cpi-yy': CPI_YY.exec(text),
    'us-core-cpi-yy': CPI_CORE_YY.exec(text),
  };
  for (const [ind, m] of Object.entries(checks)) out[ind] = crossCheck(out[ind], m, text);
  return out;
}

// --- PPI ------------------------------------------------------------------------------------

const PPI_LEAD = new RegExp(`The Producer Price Index for final demand (${UP}|${DOWN}|${FLAT})(?: (\\d+\\.\\d) percent)?`);

function readPpi(body: string, text: string, period: string): Record<string, Figure> {
  const coreWhy = "indice « final demand less foods and energy » absent du résumé du BLS : complété par l'API v1 (série WPSFD49104) dès sa mise à jour";
  const out: Record<string, Figure> = { 'us-core-ppi-mm': fig('us-core-ppi-mm', null, coreWhy) };
  const table = readTable(body, 'ppi_nrtablea');
  const lead = PPI_LEAD.exec(text);
  if (table === null) {
    out['us-ppi-mm'] = fig('us-ppi-mm', null, 'tableau A absent : forme inconnue');
    return out;
  }
  const [month, year] = monthAbbr(period);
  let curYear: string | null = null;
  let last: [string | null, string, string[]] | null = null;
  for (const [lbl, cells] of table.rows) {
    if (/^\d{4}$/.test(lbl)) curYear = lbl;
    else if (cells.length) last = [curYear, lbl, cells];
  }
  if (last === null || last[0] !== year || !last[1].toLowerCase().startsWith(month)) {
    const got = last ? `${last[1]} ${last[0]}` : 'aucune';
    out['us-ppi-mm'] = fig('us-ppi-mm', null, `dernière ligne du tableau A (${got}) ≠ période ${period}`, 'tableau A');
    return out;
  }
  const total = (table.columns[0] ?? '').toLowerCase().replace(/ /g, '');
  if (!total.includes('totalfinaldemand')) {
    out['us-ppi-mm'] = fig('us-ppi-mm', null, '1re colonne du tableau A ≠ « Total final demand »', 'tableau A');
    return out;
  }
  const v = dec(last[2][0]);
  if (v === null) {
    out['us-ppi-mm'] = fig('us-ppi-mm', null, `non publié (« ${last[2][0]} »)`, 'tableau A');
    return out;
  }
  out['us-ppi-mm'] = crossCheck(fig('us-ppi-mm', v, null, 'tableau A', `Table A · ${last[1]} ${last[0]} · Total final demand`), lead, text);
  return out;
}

// --- emploi ---------------------------------------------------------------------------------

const NFP = [
  new RegExp(`(?:[Tt]otal )?nonfarm payroll employment (${UP}|${DOWN}) by (\\d{1,3}(?:,\\d{3})+)`),
  /[Tt]otal nonfarm payroll employment (?:changed little|was little changed|was essentially unchanged|was unchanged|edged (?:up|down))[^()]{0,40}\(([+-]\d{1,3}(?:,\d{3})*)\)/,
  /(?:[Tt]otal )?nonfarm payroll employment \(([+-]\d{1,3}(?:,\d{3})*)\)/,
];
const UR = /[Uu]nemployment rate[^.()]{0,45}?\(?(\d{1,2}\.\d) percent/;
const AHE = new RegExp(`[Aa]verage hourly earnings for all employees on private nonfarm payrolls (${UP}|${DOWN}|${FLAT}|were little changed)((?:[^.]|\\.\\d){0,90})`);

function readEmpsit(_body: string, text: string): Record<string, Figure> {
  const out: Record<string, Figure> = {};
  const start = text.indexOf('THE EMPLOYMENT SITUATION');
  const end = text.indexOf('Household Survey Data', start);
  const lead = start >= 0 ? text.slice(start, end > 0 ? end : start + 1500) : '';
  if (!lead) {
    const why = 'titre « THE EMPLOYMENT SITUATION » absent : forme inconnue';
    return Object.fromEntries(RELEASES.empsit.indicators.map((i) => [i, fig(i, null, why)]));
  }
  let nfp: [number, RegExpExecArray] | null = null;
  NFP.forEach((pat, k) => {
    const m = pat.exec(lead);
    if (m && (nfp === null || m.index < nfp[1].index)) nfp = [k, m];
  });
  if (nfp === null) {
    out['us-nfp'] = fig('us-nfp', null, "tournure de l'emploi salarié non reconnue", 'texte');
  } else {
    const [k, m] = nfp as [number, RegExpExecArray];
    const raw = k === 0 ? (full(DOWN).test(m[1].toLowerCase()) ? '-' : '+') + m[2] : m[1];
    out['us-nfp'] = fig('us-nfp', thousands(raw), null, 'texte', excerpt(lead, m));
  }
  const u = UR.exec(lead);
  out['us-unemployment'] = u ? fig('us-unemployment', u[1], null, 'texte', excerpt(lead, u))
    : fig('us-unemployment', null, 'taux de chômage absent du résumé', 'texte');
  const a = AHE.exec(text);
  if (a === null) {
    out['us-ahe-mm'] = fig('us-ahe-mm', null, 'phrase du salaire horaire non reconnue', 'texte');
  } else {
    const pct = /or (\d+\.\d) percent/.exec(a[2]);
    if (full(FLAT).test(a[1].toLowerCase()) && !pct) {
      out['us-ahe-mm'] = fig('us-ahe-mm', '0.0', null, 'texte', excerpt(text, a));
    } else if (pct) {
      const v = signed(a[1], pct[1]);
      out['us-ahe-mm'] = v ? fig('us-ahe-mm', v, null, 'texte', excerpt(text, a)) : fig('us-ahe-mm', null, 'verbe non reconnu', 'texte', excerpt(text, a));
    } else {
      out['us-ahe-mm'] = fig('us-ahe-mm', null, 'variation publiée en cents seulement, sans pourcentage', 'texte', excerpt(text, a));
    }
  }
  return out;
}

// --- productivité --------------------------------------------------------------------------

function readProd2(_body: string, text: string, period: string): Record<string, Figure> {
  const [year, q] = period.split('-Q');
  const quarter = Object.entries(QUARTERS).find(([, n]) => n === Number(q))![0];
  const out: Record<string, Figure> = {};
  for (const [ind, subject] of [['us-prod-qq', 'Nonfarm business sector labor productivity'], ['us-ulc-qq', 'Unit labor costs in the nonfarm business sector']]) {
    const m = new RegExp(`${subject} (${UP}|${DOWN}|${FLAT})(?: (\\d+\\.\\d) percent)? (?:in|during) the (\\w+) quarter of (\\d{4})`).exec(text);
    if (m === null) out[ind] = fig(ind, null, "phrase d'ouverture non reconnue", 'texte');
    else if (m[3].toLowerCase() !== quarter || m[4] !== year) out[ind] = fig(ind, null, `trimestre du texte ≠ période ${period}`, 'texte', excerpt(text, m));
    else {
      const v = signed(m[1], m[2]);
      out[ind] = v !== null ? fig(ind, v, null, 'texte', excerpt(text, m)) : fig(ind, null, 'verbe non reconnu', 'texte', excerpt(text, m));
    }
  }
  return out;
}

// --- nouveauté --------------------------------------------------------------------------------

/** « attendue », « en avance », « en retard », ou null (rien de nouveau, page inexploitable). */
export function classify(p: Parsed, expectedDate: string, baseline: [string | null, string | null] | null): string | null {
  if (p.page !== 'ok' || p.period === null || p.embargo_date === null) return null;
  if (baseline !== null && p.period === baseline[0] && p.embargo_date === baseline[1]) return null;
  if (p.embargo_date === expectedDate) return 'attendue';
  if (baseline === null) return null;
  return p.embargo_date < expectedDate ? 'en avance' : 'en retard';
}
