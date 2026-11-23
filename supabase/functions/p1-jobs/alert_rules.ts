// Règles d'alerte en ligne (plan « Tout en ligne », O4) : portage TypeScript de
// gateway/terminal_gateway/alert_rules.py — validation, libellés, conditions, messages en
// français. alert_rules.test.ts vérifie qu'il redonne le fichier doré produit par Python
// (gateway/tests/fixtures/alerts_golden.json, scripts/make_alerts_golden.py).

import { INDICATORS } from './calendar.ts';

export const KINDS = ['price', 'funding', 'event_soon', 'release', 'surprise', 'keyword', 'event_watch', 'news_category'] as const;
/** Catégories du fil d'actus (news_rules.ts). */
export const NEWS_CATEGORIES: Record<string, string> = {
  'banque-centrale': 'Banque centrale', macro: 'Macro', crypto: 'Crypto', 'matieres-premieres': 'Matières premières', general: 'Général',
};
/** Identifiant d'un événement de l'agenda : « 552-us-flash-manufacturing-pmi|USD|2026-11-23|1 ». */
export const EVENT_ID = /^\d+-[a-z]{2}-[a-z0-9-]+\|[A-Z]{3}\|\d{4}-\d{2}-\d{2}\|\d+$/;
export const CHANNELS = ['écran', 'telegram', 'voix'] as const;
const IMPACTS = ['High', 'Medium', 'Low'];
const LABELS = new Map(INDICATORS.map((i) => [i.id, i]));
const RELEASE_FR: Record<string, string> = { cpi: 'IPC', empsit: 'emploi', ppi: 'prix à la production', prod2: 'productivité' };
const NBSP = ' ';
const THIN = ' ';
const MINUS = '−';
const NEWS_FR = 'fil d’actus';

export class RuleError extends Error {}
export type Params = Record<string, unknown>;

// --- décimal (Decimal de Python : exposant, normalisation, arrondi au pair) -------------------

interface D { n: bigint; scale: number }   // valeur = n * 10^-scale ; scale peut être négatif

/** Decimal(str(x)) de Python ; null si illisible (booléens compris). */
export function dec(x: unknown): D | null {
  if (x === null || x === undefined || typeof x === 'boolean') return null;
  const s = (typeof x === 'number' ? pyStr(x) : String(x)).trim().replace(',', '.').replace(MINUS, '-');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] ?? '';
  const n = BigInt((m[2] || '0') + frac) * (m[1] === '-' ? -1n : 1n);
  return { n, scale: frac.length - Number(m[4] ?? 0) };
}

/** str(float) de Python : « 110000.0 », « 0.000312 », « 1e-07 ». */
export function pyStr(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return `${x}.0`;
  const s = String(x);
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}

const pow10 = (k: number) => 10n ** BigInt(k);
const isZero = (d: D) => d.n === 0n;
const neg = (d: D) => d.n < 0n;

function align(a: D, b: D): [bigint, bigint] {
  const s = Math.max(a.scale, b.scale);
  return [a.n * pow10(s - a.scale), b.n * pow10(s - b.scale)];
}

export function cmp(a: D, b: D): number {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const abs = (d: D): D => ({ n: d.n < 0n ? -d.n : d.n, scale: d.scale });

/** Arrondi au pair à `places` décimales (contexte par défaut de Decimal). */
function quantize(d: D, places: number): D {
  if (d.scale <= places) return { n: d.n * pow10(places - d.scale), scale: places };
  const div = pow10(d.scale - places);
  const sign = d.n < 0n ? -1n : 1n;
  const a = d.n * sign;
  let q = a / div;
  const r = a % div;
  if (r * 2n > div || (r * 2n === div && q % 2n === 1n)) q += 1n;
  return { n: q * sign, scale: places };
}

/** format(d, "f") de Python, avec séparateur de milliers optionnel. */
function fixed(d: D, thousands: string | null = null): string {
  const a = abs(d);
  let s: string;
  if (a.scale <= 0) s = (a.n * pow10(-a.scale)).toString();
  else {
    const t = a.n.toString().padStart(a.scale + 1, '0');
    s = `${t.slice(0, -a.scale)}.${t.slice(-a.scale)}`;
  }
  if (thousands !== null) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (f !== undefined ? `.${f}` : '');
  }
  return s;
}

/** format(d.normalize(), "f") : zéros de fin retirés. */
function normalized(d: D): string {
  let s = fixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return (neg(d) && s !== '0' ? '-' : '') + s;
}

export function frNum(x: unknown, decimals: number | null = null, signed = false): string {
  let d = dec(x);
  if (d === null) return '—';
  if (decimals !== null) d = quantize(d, decimals);
  const body = fixed(d, ',').replace(/,/g, THIN).replace('.', ',');
  const sign = !isZero(d) && neg(d) ? MINUS : (signed && !isZero(d) && !neg(d) ? '+' : '');
  return sign + body;
}

export const instLabel = (inst: string) => inst.replace('-SWAP', ' perp');

export function valueFr(value: string | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return frNum(value) + ({ '%': `${NBSP}%`, K: `${NBSP}k` }[unit ?? ''] ?? '');
}

// --- validation ----------------------------------------------------------------------------

/** repr() de Python pour les messages d'erreur. */
function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  const s = String(v);
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function decimalParam(p: Params, key: string, positive = true, required = true): string | null {
  if (p[key] === null || p[key] === undefined || p[key] === '') {
    if (required) throw new RuleError(`${key} manquant`);
    return null;
  }
  const d = dec(p[key]);
  if (d === null || (positive && cmp(d, { n: 0n, scale: 0 }) <= 0)) throw new RuleError(`${key} invalide : ${pyRepr(p[key])}`);
  return normalized(d);
}

export function validate(kind: string, params: unknown, channels: unknown, instruments: readonly string[]): [Params, string[]] {
  if (!(KINDS as readonly string[]).includes(kind)) throw new RuleError(`sorte de règle inconnue : ${pyRepr(kind)}`);
  if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new RuleError('paramètres attendus en objet JSON');
  const p = params as Params;
  const given = Array.isArray(channels) ? channels : [];
  const chans: string[] = CHANNELS.filter((c) => given.includes(c));
  if (!chans.includes('écran')) chans.unshift('écran');
  if ((kind === 'price' || kind === 'funding') && !instruments.includes(p.inst as string)) {
    throw new RuleError(`instrument non suivi : ${pyRepr(p.inst)}`);
  }
  let out: Params;
  if (kind === 'price') {
    const direction = p.direction ?? 'les deux';
    if (!['hausse', 'baisse', 'les deux'].includes(direction as string)) throw new RuleError('direction : hausse, baisse ou les deux');
    out = { inst: p.inst, level: decimalParam(p, 'level'), direction };
  } else if (kind === 'funding') {
    const side = p.side ?? 'au-dessus';
    if (!['au-dessus', 'en dessous'].includes(side as string)) throw new RuleError('côté : au-dessus ou en dessous');
    const thr = decimalParam(p, 'threshold_pct', false)!;
    if (cmp(abs(dec(thr)!), { n: 5n, scale: 0 }) > 0) throw new RuleError('seuil de funding hors bornes (±5 %)');
    out = { inst: p.inst, threshold_pct: thr, side };
  } else if (kind === 'event_soon') {
    const minutes = p.minutes ?? 5;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new RuleError('minutes : entier de 1 à 120');
    const impacts = (Array.isArray(p.impacts) ? p.impacts : []).filter((i) => IMPACTS.includes(i as string));
    const currencies = [...new Set((Array.isArray(p.currencies) ? p.currencies : []).map(String).filter((c) => /^[A-Za-z]{3}$/.test(c)).map((c) => c.toUpperCase()))].sort();
    out = { minutes, captured_only: !!p.captured_only, impacts, currencies };
  } else if (kind === 'release') {
    out = { releases: (Array.isArray(p.releases) ? p.releases : []).filter((r) => r in RELEASE_FR) };
  } else if (kind === 'surprise') {
    const ind = p.indicator || null;
    if (ind !== null && !LABELS.has(ind as string)) throw new RuleError(`indicateur inconnu : ${pyRepr(ind)}`);
    const zMin = decimalParam(p, 'z_min', true, false);
    const rawMin = decimalParam(p, 'raw_min', true, false);
    if (zMin === null && rawMin === null) throw new RuleError('seuil manquant : z_min ou raw_min');
    out = { indicator: ind, z_min: zMin, raw_min: rawMin };
  } else if (kind === 'event_watch') {
    // Cloche d'un événement du calendrier : le réel part dès qu'il est connu (BLS ou fil d'actus).
    const eid = String(p.event_id ?? '');
    if (!EVENT_ID.test(eid)) throw new RuleError('event_id : identifiant d\'événement de l\'agenda attendu');
    const title = String(p.title ?? '').trim();
    if (title.length < 1 || title.length > 120) throw new RuleError('title : 1 à 120 caractères');
    const t = p.time_ms ?? null;
    if (t !== null && (typeof t !== 'number' || !Number.isInteger(t) || t <= 0)) throw new RuleError('time_ms : entier positif ou absent');
    out = { event_id: eid, title, currency: eid.split('|')[1], time_ms: t };
  } else if (kind === 'news_category') {
    const cat = p.category;
    if (typeof cat !== 'string' || !(cat in NEWS_CATEGORIES)) throw new RuleError(`catégorie inconnue : ${pyRepr(cat)}`);
    out = { category: cat, urgent_only: !!p.urgent_only };
  } else {
    const words = (Array.isArray(p.words) ? p.words : []).map((w) => String(w).trim()).filter(Boolean);
    if (words.length < 1 || words.length > 20 || words.some((w) => w.length > 60)) throw new RuleError('mots-clés : de 1 à 20, 60 caractères au plus');
    out = { words };
  }
  return [out, chans];
}

// --- libellés -------------------------------------------------------------------------------

export function describe(kind: string, p: Params): [string, string] {
  if (kind === 'price') {
    const way = ({ hausse: ' à la hausse', baisse: ' à la baisse' } as Record<string, string>)[p.direction as string] ?? '';
    return [`${instLabel(p.inst as string).split('-')[0]} franchit ${frNum(p.level)}${way}`, 'Prix · OKX'];
  }
  if (kind === 'funding') {
    return [`Funding OKX ${p.side} de ${frNum(p.threshold_pct)}${NBSP}%`, `Dérivés · ${instLabel(p.inst as string)}`];
  }
  if (kind === 'event_soon') {
    const what = p.captured_only ? 'une publication captée' : 'un événement';
    const filt: string[] = [];
    const impacts = p.impacts as string[];
    if (impacts.length) filt.push('impact ' + [...new Set(impacts.map((i) => ({ High: 'fort', Medium: 'moyen', Low: 'faible' } as Record<string, string>)[i]))].join('/'));
    if ((p.currencies as string[]).length) filt.push((p.currencies as string[]).join(', '));
    return [`T${MINUS}${p.minutes}${NBSP}min avant ${what}${filt.length ? ` (${filt.join(' · ')})` : ''}`, 'Calendrier'];
  }
  if (kind === 'release') {
    const names = (p.releases as string[]).map((r) => RELEASE_FR[r]).join(', ') || 'tous les indicateurs suivis';
    return [`Chiffre publié : ${names}`, 'Calendrier · BLS'];
  }
  if (kind === 'surprise') {
    const ind = p.indicator ? LABELS.get(p.indicator as string)!.label_fr : 'chiffre capté';
    const s: string[] = [];
    if (p.z_min) s.push(`|z| ≥ ${frNum(p.z_min)}`);
    if (p.raw_min) s.push(`|surprise| ≥ ${frNum(p.raw_min)}`);
    return [`Surprise ${ind} : ${s.join(' ou ')}`, 'Calendrier · surprise'];
  }
  if (kind === 'event_watch') return [`Réel publié : ${p.title} (${p.currency})`, 'Calendrier · événement'];
  if (kind === 'news_category') {
    return [`Fil d’actus : ${NEWS_CATEGORIES[p.category as string]}${p.urgent_only ? ' · fort impact' : ''}`, 'Fil d’actus · catégorie'];
  }
  return [`Mot-clé : ${(p.words as string[]).join(', ')}`, 'Fil d’actus'];
}

// --- conditions -----------------------------------------------------------------------------

export function priceCrossed(p: Params, prev: number | null, px: number): boolean {
  if (prev === null) return false;
  const level = Number(p.level);
  const up = prev < level && level <= px;
  const down = prev > level && level >= px;
  return p.direction === 'hausse' ? up : p.direction === 'baisse' ? down : up || down;
}

export function fundingHit(p: Params, rate: number): boolean {
  const r = dec(pyStr(rate))!;
  const pct: D = { n: r.n * 100n, scale: r.scale };
  const c = cmp(pct, dec(p.threshold_pct)!);
  return p.side === 'au-dessus' ? c >= 0 : c <= 0;
}

export function eventMatches(p: Params, ev: Record<string, unknown>): boolean {
  if (p.captured_only && !ev.capture) return false;
  if ((p.impacts as string[]).length && !(p.impacts as string[]).includes(ev.impact as string)) return false;
  return !(p.currencies as string[]).length || (p.currencies as string[]).includes(ev.currency as string);
}

export function releaseMatches(p: Params, last: Record<string, unknown>): boolean {
  return !(p.releases as string[]).length || (p.releases as string[]).includes(last.release as string);
}

export function surpriseHit(p: Params, fig: Record<string, unknown>): boolean {
  if (fig.value === null || fig.value === undefined || (p.indicator && fig.indicator !== p.indicator)) return false;
  const z = dec(fig.z);
  const raw = dec(fig.surprise);
  return !!((p.z_min && z !== null && cmp(abs(z), dec(p.z_min)!) >= 0) || (p.raw_min && raw !== null && cmp(abs(raw), dec(p.raw_min)!) >= 0));
}

export function newsCategoryHit(p: Params, item: Record<string, unknown>): boolean {
  return item.category === p.category && (!p.urgent_only || !!item.urgent);
}

export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function keywordHit(p: Params, text: string): string | null {
  const hay = fold(text);
  for (const w of p.words as string[]) {
    const needle = fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}_])${needle}(?![\\p{L}\\p{N}_])`, 'u').test(hay)) return w;
  }
  return null;
}

// --- messages -------------------------------------------------------------------------------

export function priceMessage(p: Params, prev: number, px: number): [string, string] {
  const way = px >= prev ? 'à la hausse' : 'à la baisse';
  return [`${instLabel(p.inst as string)} franchit ${frNum(p.level)} ${way}`, `Dernier ${frNum(px)} (précédent ${frNum(prev)}) · OKX`];
}

export function fundingMessage(p: Params, rate: number): [string, string] {
  const r = dec(pyStr(rate))!;
  const pct = { n: r.n * 100n, scale: r.scale };
  return [`Funding ${instLabel(p.inst as string)} à ${frNum(`${neg(pct) ? '-' : ''}${fixed(pct)}`, 4, true)}${NBSP}%`,
    `Seuil ${p.side} de ${frNum(p.threshold_pct)}${NBSP}% · OKX`];
}

export function eventMessage(p: Params, ev: Record<string, unknown>, hmParis: string): [string, string] {
  const title = (ev.title_fr || ev.title || 'événement') as string;
  const fc = ev.forecast_raw as string | null;
  return [`Dans ${p.minutes}${NBSP}min : ${title} (${ev.currency})`,
    `${hmParis} Paris${fc ? ` · consensus ${fc}` : ' · aucun consensus publié'}${ev.capture ? ' · capté à la source' : ''}`];
}

export function figureLine(fig: Record<string, unknown>): string {
  const unit = fig.unit as string | null;
  let line = `${fig.label_fr || fig.indicator} : ${valueFr(fig.value as string | null, unit)}`;
  if (fig.value === null || fig.value === undefined) return `${line} (${fig.reason || 'non lu'})`;
  if (fig.forecast !== null && fig.forecast !== undefined) {
    line += ` (prév. ${valueFr(fig.forecast as string, unit)}`;
    if (fig.surprise !== null && fig.surprise !== undefined) line += `, surprise ${frNum(fig.surprise, null, true)}`;
    if (fig.z !== null && fig.z !== undefined) line += `, z ${frNum(fig.z, null, true)}`;
    line += ')';
  }
  return line;
}

export function releaseMessage(last: Record<string, unknown>, figs: Record<string, unknown>[]): [string, string] {
  const nature = (last.nature || 'officielle') as string;
  const head = `${last.title || last.release} · ${last.period || ''}${last.edition === 'Revised' ? ' (révisé)' : ''}`;
  const tail = `BLS${nature === 'officielle' ? '' : ` · ${nature}`}`;
  return [head, [...figs.map(figureLine), tail].join('\n')];
}

export function surpriseMessage(fig: Record<string, unknown>): [string, string] {
  return [`Surprise : ${fig.label_fr || fig.indicator}`, `${figureLine(fig)} · BLS`];
}

export function keywordMessage(word: string, item: Record<string, unknown>): [string, string] {
  return [`« ${word} » : ${item.title || ''}`.slice(0, 200), `${item.source || NEWS_FR} · VO`];
}

export function eventWatchMessage(p: Params, ev: Record<string, unknown>, actual: string, source: string): [string, string] {
  const title = (ev.title_fr || ev.title || p.title) as string;
  return [`${title} (${p.currency}) : ${actual}`,
    `Consensus ${ev.forecast_raw || '—'} · précédent ${ev.previous_raw || '—'} · source : ${source}`];
}

export function eventMissingMessage(p: Params, ev: Record<string, unknown>, hmParis: string): [string, string] {
  const title = (ev.title_fr || ev.title || p.title) as string;
  return [`${title} (${p.currency}) : réel non capté`,
    `Publication prévue à ${hmParis} (Paris). ForexFactory ne publie pas le réel et aucun titre FinancialJuice n’a été rattaché dans les 30 min.`];
}

export function newsCategoryMessage(p: Params, item: Record<string, unknown>): [string, string] {
  const label = NEWS_CATEGORIES[p.category as string];
  return [`${label} : ${item.title || ''}`.slice(0, 200), `${item.source || NEWS_FR}${item.urgent ? ' · fort impact' : ''} · VO`];
}

