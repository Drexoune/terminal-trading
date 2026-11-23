// Chiffres captés à la source (étape E3) : clés release:<indicateur>:<période>[:<édition>]
// publiées par le service « release » de la passerelle
// (gateway/terminal_gateway/release_service.py). Logique pure, testée par Vitest.

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
