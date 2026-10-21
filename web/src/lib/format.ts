// Format des nombres en fr-FR : virgule décimale, espace fine (U+202F) pour
// les milliers, espace insécable (U+00A0) avant les unités, signe moins
// typographique « − » (U+2212) au lieu du trait d'union de Intl.

export const NBSP = ' ';
export const MINUS = '−';
export const DASH = '—';

const cache = new Map<string, Intl.NumberFormat>();

function nf(decimals: number): Intl.NumberFormat {
  const key = String(decimals);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    cache.set(key, f);
  }
  return f;
}

function ok(x: number | null | undefined): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** 108420.5 -> « 108 420,5 » ; valeur absente -> « — ». */
export function fmtNumber(x: number | null | undefined, decimals = 2): string {
  if (!ok(x)) return DASH;
  return nf(decimals).format(x).replace('-', MINUS);
}

/** Nombre signé : « +1,84 », « −0,42 », « 0,00 ». */
export function fmtSigned(x: number | null | undefined, decimals = 2): string {
  if (!ok(x)) return DASH;
  const body = nf(decimals).format(Math.abs(x));
  if (Number(body.replace(/\s| /g, '').replace(',', '.')) === 0) return body;
  return (x > 0 ? '+' : MINUS) + body;
}

/** Variation en pourcentage, x en fraction (0.0184 -> « +1,84 % »). */
export function fmtPctChange(x: number | null | undefined, decimals = 2): string {
  if (!ok(x)) return DASH;
  return `${fmtSigned(x * 100, decimals)}${NBSP}%`;
}

/** Taux exprimé en fraction, affiché en % signé (funding : 0.0000246 -> « +0,0025 % »). */
export function fmtRatePct(x: number | null | undefined, decimals = 4): string {
  return fmtPctChange(x, decimals);
}

/** Montant en dollars compact : « 31,2 Md$ », « 840,5 M$ ». */
export function fmtUsdCompact(x: number | null | undefined): string {
  if (!ok(x)) return DASH;
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${fmtNumber(x / 1e9, 1)}${NBSP}Md$`;
  if (abs >= 1e6) return `${fmtNumber(x / 1e6, 1)}${NBSP}M$`;
  if (abs >= 1e3) return `${fmtNumber(x / 1e3, 1)}${NBSP}k$`;
  return `${fmtNumber(x, 0)}${NBSP}$`;
}

/** Nombre de décimales d'un pas de prix OKX (0.1 -> 1, 0.01 -> 2, 1 -> 0). */
export function decimalsOf(step: number | null | undefined, fallback = 2): number {
  if (!ok(step) || step <= 0) return fallback;
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Flèche + variation, pour que la couleur ne porte jamais seule l'information. */
export function arrow(x: number | null | undefined): string {
  if (!ok(x) || x === 0) return '';
  return x > 0 ? '▲' : '▼';
}

export function direction(x: number | null | undefined): 'up' | 'dn' | 'nt' {
  if (!ok(x) || x === 0) return 'nt';
  return x > 0 ? 'up' : 'dn';
}

/** Durée courte : « 41 ms », « 1,2 s », « 3 min ». */
export function fmtDuration(ms: number | null | undefined): string {
  if (!ok(ms)) return DASH;
  const a = Math.abs(ms);
  if (a < 1000) return `${Math.round(ms)}${NBSP}ms`;
  if (a < 60_000) return `${fmtNumber(ms / 1000, 1)}${NBSP}s`;
  return `${Math.round(ms / 60_000)}${NBSP}min`;
}
