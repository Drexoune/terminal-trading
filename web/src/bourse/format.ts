// Mise en forme du module Bourse : nombres décimaux reçus en texte (jamais
// passés par un flottant), dates de valeur et heures de réception à Paris.

import { DASH, NBSP } from '../lib/format';

const PARIS = 'Europe/Paris';

/** « 1234.5678 » → « 1 234,5678 » ; zéros finals retirés au-delà de `minDecimals`. */
export function fmtDecimalText(text: string | null | undefined, minDecimals = 2): string {
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return DASH;
  const [int, frac = ''] = text.split('.');
  let f = frac.replace(/0+$/, '');
  if (f.length < minDecimals) f = f.padEnd(minDecimals, '0');
  const grouped = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return f ? `${grouped},${f}` : grouped;
}

/** « 2026-11-18 » → « 18/11/2026 ». */
export function fmtValueDate(date: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : DASH;
}

const parisFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Instant ISO → « 19/11 07:30 » à Paris. */
export function fmtParis(iso: string | null | undefined): string {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? parisFmt.format(new Date(t)).replace(' ', NBSP).replace(',', '') : DASH;
}

/** Dernier jour ouvré (lundi à vendredi) strictement avant la date civile de Paris à `nowMs`. */
export function previousBusinessDay(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  const d = new Date(`${parts}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Clôture périmée : plus ancienne que le dernier jour ouvré. Les jours fériés
 * de la place ne sont pas connus : un lendemain de férié peut sortir « périmé »
 * à tort, jamais l'inverse.
 */
export function isStaleClose(valueDate: string | null | undefined, nowMs: number): boolean {
  return !valueDate || valueDate < previousBusinessDay(nowMs);
}
