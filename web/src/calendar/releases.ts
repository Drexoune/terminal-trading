// Chiffres captés à la source (étape E3) : clés release:<indicateur>:<période>[:<édition>]
// publiées par le service « release » de la passerelle
// (gateway/terminal_gateway/release_service.py), révisions lues par l'API v1 du BLS, et
// réaction du BTC (clés reaction:<publication>:<jour à New York>). Logique pure, testée par Vitest.

import { DASH, MINUS, NBSP } from '../lib/format';
import { fmtValue, type CalendarEvent } from './calendar';

export interface ReleaseFigure {
  indicator: string;
  label_fr: string | null;
  unit: string | null;
  release: string;               // « cpi », « empsit », « ppi », « prod2 »
  period: string;                // « 2026-11 », « 2026-Q3 »
  edition: string;               // « Revised » pour la productivité révisée, sinon ''
  ny_date: string;
  value: string | null;          // texte décimal tel que publié
  reason: string | null;
  part: string | null;           // « tableau A », « texte »
  excerpt: string | null;
  flags: string[];
  timing: 'attendue' | 'en avance' | 'en retard' | string;
  nature: string;
  source: 'BLS';
  url: string;
  machine: string;
  scheduled_ms: number;
  embargo_ms: number | null;
  first_byte_ms: number | null;
  received_ms: number;
  capture_delay_ms: number | null;
  clock_corrected: boolean;
  bus_ms: number | null;
  forecast: string | null;
  forecast_raw: string | null;
  forecast_age_ms: number | null;
  surprise: string | null;
  z: string | null;
  z_n: number | null;
  z_provisional: boolean;
  z_reason: string | null;
  regular: boolean;
  display_ms: number | null;
  display_delay_ms?: number | null;
  revisions?: Revision[];
}

/** Valeur nouvelle lue par l'API v1 ; la première publication n'est jamais modifiée. */
export interface Revision {
  kind: 'révision' | 'écart' | string;   // « écart » : publication de moins de 7 jours
  previous: string;
  value: string;
  source: string;                        // « BLS API v1 »
  series: string | null;
  excerpt: string | null;
  seen_ms: number;
}

/** Bougies 1 min du perpétuel BTC-USDT d'OKX de T−5 à T+30 min (passerelle, reaction.py). */
export interface Reaction {
  release: string;
  title: string;
  indicators: string[];
  ny_date: string;
  scheduled_ms: number;
  inst: string;
  source: string;                        // « OKX EEA REST »
  candles: { t: number; o: number; h: number; l: number; c: number }[];
  ref_price: string | null;
  end_price: string | null;
  change_pct: string | null;             // texte décimal, deux décimales
  missing: number[];
  reason: string | null;
  received_ms: number;
}

export interface ReleaseLast {
  release: string; title: string; period: string; edition: string | null; ny_date: string;
  keys: string[]; timing: string; scheduled_ms: number; bus_ms: number;
}

/** Les clés release:… qui portent un chiffre (pas release:last ni release:state). */
export function figures(entries: [string, unknown][]): [string, ReleaseFigure][] {
  return entries.filter(([k, v]) => k !== 'release:last' && k !== 'release:state'
    && typeof v === 'object' && v !== null && 'indicator' in v) as [string, ReleaseFigure][];
}

/** Chiffre capté pour un événement du calendrier : même indicateur, même jour à New York. */
export function figureIndex(entries: [string, ReleaseFigure][]): Map<string, ReleaseFigure> {
  const out = new Map<string, ReleaseFigure>();
  for (const [, f] of entries) {
    const k = `${f.indicator}|${f.ny_date}`;
    const prev = out.get(k);
    if (!prev || (f.bus_ms ?? 0) > (prev.bus_ms ?? 0)) out.set(k, f);
  }
  return out;
}

export function figureFor(ev: CalendarEvent, index: Map<string, ReleaseFigure>): ReleaseFigure | null {
  return ev.indicator ? index.get(`${ev.indicator}|${ev.ny_date}`) ?? null : null;
}

/** « 0,4 % », « 165 k » ; un chiffre non lu n'a pas de valeur affichable. */
export function fmtFigure(f: ReleaseFigure): string {
  return f.value === null ? DASH : fmtValue(f.value, f.unit, null);
}

/** « +0,1 » ; le signe « + » est explicite, le moins est « − ». */
export function fmtSignedText(v: string): string {
  const s = v.replace('.', ',');
  return s.startsWith('-') ? `${MINUS}${s.slice(1)}` : /^0(,0+)?$/.test(s) ? s : `+${s}`;
}

/** Surprise affichée : brute toujours, z quand l'historique le permet ; sinon la raison. */
export function surpriseText(f: ReleaseFigure): { text: string; reason: string | null; tone: 'up' | 'down' | null } {
  if (f.value === null) return { text: DASH, reason: f.reason ?? 'chiffre non lu', tone: null };
  if (f.surprise === null) return { text: DASH, reason: 'aucune prévision ForexFactory relevée avant la publication', tone: null };
  const unit = f.unit === '%' ? `${NBSP}pt` : f.unit === 'K' ? `${NBSP}k` : '';
  const raw = `${fmtSignedText(f.surprise)}${unit}`;
  if (f.z === null) return { text: raw, reason: `z : ${f.z_reason ?? 'indisponible'}`, tone: null };
  const z = Number(f.z);
  // Une seule règle de couleur (plan P1 § 12) : |z| ≥ 0,25.
  const tone = Math.abs(z) >= 0.25 ? (z > 0 ? 'up' : 'down') : null;
  return { text: `${raw} · z ${fmtSignedText(f.z)}${f.z_provisional ? ` (provisoire, n${NBSP}=${NBSP}${f.z_n})` : ''}`, reason: null, tone };
}

/** « 1,23 s » ; délai de capture ou d'affichage depuis l'heure prévue. */
export function fmtDelay(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return DASH;
  const s = (ms / 1000).toFixed(2).replace('.', ',');
  return `${ms < 0 ? MINUS : ''}${s.replace('-', '')}${NBSP}s`;
}

/** Bandeau : la dernière publication captée reste affichée 15 minutes. */
export const BANNER_MS = 15 * 60_000;
export function bannerVisible(last: ReleaseLast | undefined, now: number): boolean {
  return !!last && now - last.bus_ms < BANNER_MS;
}

// --- nature, révisions ------------------------------------------------------------------

/** « capté 1,23 s » ; un rattrapage ne mesure aucun délai et le dit. */
export function captureLabel(f: ReleaseFigure): string {
  if (f.nature === 'rattrapage') return 'rattrapé : communiqué relu après la fenêtre de capture';
  if (f.nature === 'rattrapage API') return 'rattrapé : recalculé depuis l’API v1 du BLS (page illisible)';
  if (f.nature !== 'officielle') return f.nature;
  return `capté ${fmtDelay(f.capture_delay_ms)}`;
}

/** Dernière valeur connue après révisions, avec sa provenance ; null sans révision. */
export function revisionText(f: ReleaseFigure): string | null {
  const r = f.revisions?.at(-1);
  if (!r) return null;
  const v = fmtValue(r.value, f.unit, null);
  const day = fmtDayParis(r.seen_ms);
  return r.kind === 'écart'
    ? `écart à vérifier : l’API v1 du BLS donne ${v} (lu le ${day})`
    : `révisé à ${v} (API v1 du BLS, lu le ${day})${(f.revisions?.length ?? 0) > 1 ? ` · ${f.revisions!.length} révisions` : ''}`;
}

// --- réaction du BTC ----------------------------------------------------------------------

/** Les clés reaction:… du store. */
export function reactions(entries: [string, unknown][]): Reaction[] {
  return entries.filter(([k, v]) => k.startsWith('reaction:') && typeof v === 'object' && v !== null && 'candles' in v)
    .map(([, v]) => v as Reaction);
}

/**
 * Réaction à montrer pour l'événement choisi : celle de sa publication (même indicateur, même
 * jour à New York), sinon la dernière publication de l'indicateur avant ce jour.
 */
export function pickReaction(ev: CalendarEvent | null, all: Reaction[]): { reaction: Reaction | null; reason: string } {
  if (!ev) return { reaction: null, reason: 'Sélectionner un événement.' };
  if (!ev.capture || !ev.indicator) {
    return { reaction: null, reason: 'Réaction du BTC : seulement pour les publications suivies à la source (BLS).' };
  }
  const mine = all.filter((r) => r.indicators.includes(ev.indicator!) && r.ny_date <= ev.ny_date)
    .sort((a, b) => b.scheduled_ms - a.scheduled_ms);
  if (mine.length) return { reaction: mine[0], reason: '' };
  return {
    reaction: null,
    reason: 'Réaction du BTC : enregistrée 31 min après la publication, par la passerelle du Mac. Aucune encore pour cet indicateur.',
  };
}

/** « −0,92 % », « +1,05 % ». */
export function fmtChangePct(v: string | null): string {
  return v === null ? DASH : `${fmtSignedText(v)}${NBSP}%`;
}

export function changeTone(v: string | null): 'up' | 'down' | null {
  if (v === null || Number(v) === 0) return null;
  return Number(v) > 0 ? 'up' : 'down';
}

/** « BTC-USDT perp OKX, du 15/10/2026 14:25 au 14:55 (heure de Paris) ». */
export function reactionCaption(r: Reaction): string {
  const inst = r.inst === 'BTC-USDT-SWAP' ? 'BTC-USDT perp' : r.inst;
  const from = r.scheduled_ms - 5 * 60_000;
  const to = r.scheduled_ms + 30 * 60_000;
  return `${inst} ${r.source}, du ${fmtDayParis(from)} ${fmtHmParis(from)} au ${fmtHmParis(to)} (heure de Paris)`;
}

/** Points du graphique : clôture de chaque bougie à sa fin, en minutes depuis T. */
export function reactionPoints(r: Reaction): { x: number; y: number }[] {
  return r.candles.map((c) => ({ x: (c.t + 60_000 - r.scheduled_ms) / 60_000, y: c.c }));
}

const DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
const HM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function fmtDayParis(ms: number): string { return DAY.format(ms); }
function fmtHmParis(ms: number): string { return HM.format(ms); }
