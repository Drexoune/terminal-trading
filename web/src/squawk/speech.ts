// Squawk (étape E4, plan P1 § 10) : phrases à dire, en français, composées avec nos
// données seulement, et normaliseur du texte parlé (« − » -> « moins », « % » -> « pour
// cent », « pb » -> « points de base »). Logique pure, testée par Vitest.

import type { ReleaseFigure, ReleaseLast } from '../calendar/releases';
import type { AlertEvent } from '../alerts/alerts';

export type Lang = 'fr' | 'en';

const LABEL_SPOKEN: [RegExp, string][] = [
  [/\(m\/m\)/g, 'sur un mois'],
  [/\(t\/t\)/g, 'sur un trimestre'],
  [/\(sur un an\)/g, 'sur un an'],
  [/\bIPC\b/g, 'IPC'],
];

/** Texte écrit -> texte à dire. Idempotent sur un texte déjà normalisé. */
export function normalizeSpeech(text: string, lang: Lang = 'fr'): string {
  let t = text.replace(/[  ]/g, ' ');
  t = t.replace(/(\d) (?=\d{3}\b)/g, '$1');            // « 110 000 » -> « 110000 »
  t = t.replace(/-SWAP\b/g, '').replace(/\bBTC-USDT perp\b/g, lang === 'fr' ? 'Bitcoin perpétuel' : 'Bitcoin perpetual');
  if (lang === 'fr') {
    t = t.replace(/[−-](?=\s?\d)/g, 'moins ');
    t = t.replace(/\+(?=\s?\d)/g, 'plus ');
    t = t.replace(/(\d)\s?%/g, '$1 pour cent');
    t = t.replace(/(\d)\s?pb\b/g, '$1 points de base');
    t = t.replace(/(\d)\s?k\b/g, '$1 mille');
    t = t.replace(/\bT\s?moins\s(\d+)\s?min\b/g, '$1 minutes avant');
    t = t.replace(/(\d)\s?min\b/g, '$1 minutes');
    t = t.replace(/\|z\|/g, 'z en valeur absolue').replace(/≥/g, 'au moins');
  } else {
    t = t.replace(/[−-](?=\s?\d)/g, 'minus ');
    t = t.replace(/\+(?=\s?\d)/g, 'plus ');
    t = t.replace(/(\d)\s?%/g, '$1 percent');
    t = t.replace(/(\d)\s?bp\b/g, '$1 basis points');
  }
  t = t.replace(/\s?·\s?/g, ', ').replace(/[«»"]/g, '').replace(/\s{2,}/g, ' ');
  return t.trim();
}

function spokenLabel(label: string): string {
  return LABEL_SPOKEN.reduce((s, [re, by]) => s.replace(re, by), label);
}

/** Une variation se dit avec son signe (« plus 0,3 ») ; un niveau (chômage) sans. */
function isChange(f: ReleaseFigure): boolean {
  return f.unit === 'K' || /\((m\/m|t\/t|sur un an)\)/.test(f.label_fr ?? '');
}

function spokenValue(v: string, f: ReleaseFigure): string {
  const n = Number(v);
  const body = v.replace('-', '').replace('.', ',');
  const sign = isChange(f) ? (n > 0 ? 'plus ' : n < 0 ? 'moins ' : '') : (n < 0 ? 'moins ' : '');
  const unit = f.unit === '%' ? ' pour cent' : f.unit === 'K' ? ' mille' : '';
  return `${sign}${body}${unit}`;
}

/** « IPC sur un mois : plus 0,4 pour cent, prévision plus 0,3. » */
export function figurePhrase(f: ReleaseFigure): string {
  const label = spokenLabel(f.label_fr ?? f.indicator);
  if (f.value === null) return `${label} : chiffre non lu.`;
  let s = `${label} : ${spokenValue(f.value, f)}`;
  if (f.forecast !== null) s += `, prévision ${spokenValue(f.forecast, f).replace(/ pour cent$| mille$/, '')}`;
  return `${s}.`;
}

/** Annonce d'une publication captée : un chiffre par phrase, sans calcul. */
export function releasePhrase(last: ReleaseLast & { nature?: string }, figs: ReleaseFigure[]): string {
  const intro = last.nature && last.nature !== 'officielle' ? 'Rattrapage, chiffres américains.' : 'Chiffres américains.';
  return [intro, ...figs.map(figurePhrase)].join(' ');
}

export function alertPhrase(e: AlertEvent): string {
  return normalizeSpeech(`Alerte. ${e.title}.`, 'fr');
}
