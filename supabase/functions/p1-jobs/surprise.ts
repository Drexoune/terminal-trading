// Surprise brute et surprise z (T-018) : portage de gateway/terminal_gateway/surprise.py.
// - surprise brute = réel - prévision, texte décimal exact ;
// - z = surprise / sigma des surprises passées (écart type d'échantillon), plancher de sigma à
//   la moitié de la dernière décimale publiée ; z dès n = 8, « provisoire » jusqu'à n = 24 ;
//   arrondi au centième, au plus proche pair (contexte Decimal de Python).
// L'écart type est calculé en double précision (Python le calcule en Decimal à 28 chiffres) :
// seul un z tombant à 1e-9 près d'une demi-centième pourrait différer ; p1_math.test.ts compare
// au fichier doré de Python.

import { decimals, formatDec, parseDec, subDec } from './decimal.ts';

export const Z_MIN_N = 8;
export const Z_FIRM_N = 24;

export function rawSurprise(actual: string | null, forecast: string | null): string | null {
  const a = parseDec(actual);
  const f = parseDec(forecast);
  if (!a || !f) return null;
  const d = subDec(a, f);
  return formatDec(d.n, d.scale, d.n < 0n);   // jamais « -0.0 »
}

export function sigmaFloor(actual: string): number {
  return 10 ** -decimals(actual) / 2;
}

export interface ZScore { z: string | null; n: number; provisional: boolean; reason: string | null }

function roundHalfEven2(v: number): string {
  const x = v * 100;
  const f = Math.floor(x);
  const diff = x - f;
  let r = Math.abs(diff - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
  if (Object.is(r, -0)) r = 0;
  const neg = v < 0;
  const abs = Math.abs(r);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;                  // Python garde le signe : « -0.00 »
}

export function zScore(surprise: string | null, history: string[], actual: string): ZScore {
  const n = history.length;
  if (surprise === null) return { z: null, n, provisional: false, reason: 'pas de prévision avant la publication' };
  if (n < Z_MIN_N) return { z: null, n, provisional: false, reason: `historique insuffisant (${n}/${Z_MIN_N})` };
  const vals = history.map(Number);
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const sigma = Math.max(sd, sigmaFloor(actual));
  return { z: roundHalfEven2(Number(surprise) / sigma), n, provisional: n < Z_FIRM_N, reason: null };
}
