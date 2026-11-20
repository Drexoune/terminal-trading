// Décimal exact pour les montants du portefeuille (plan B1, § 3) : entier
// BigInt à 10 décimales. Les montants ne passent jamais par un flottant ; seuls
// les rendements et les statistiques se calculent en nombres ordinaires.

export type Dec = bigint;

const PLACES = 10;
const SCALE = 10n ** BigInt(PLACES);

export const ZERO: Dec = 0n;

/** Texte décimal (« 1234.5 », « -0.25 », « 1e3 » refusé) → Dec ; null si illisible. */
export function dec(text: string | number | null | undefined): Dec | null {
  if (text === null || text === undefined) return null;
  const s = typeof text === 'number' ? (Number.isFinite(text) ? numberText(text) : '') : text.trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? '');
  let v = BigInt(m[2]) * SCALE + BigInt((frac.slice(0, PLACES)).padEnd(PLACES, '0'));
  // Arrondi au plus proche au-delà de 10 décimales.
  if (frac.length > PLACES && Number(frac[PLACES]) >= 5) v += 1n;
  return m[1] === '-' ? -v : v;
}

/** Nombre JS → texte décimal sans notation exponentielle. */
function numberText(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toPrecision(15);
  return s.includes('e') ? n.toFixed(PLACES) : String(Number(s));
}

export function decOrZero(text: string | number | null | undefined): Dec {
  return dec(text) ?? ZERO;
}

const absB = (a: bigint) => (a < 0n ? -a : a);

/** Division entière arrondie au plus proche (demi vers l'extérieur). */
function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new RangeError('division par zéro');
  const q = n / d;
  const r = n % d;
  if (absB(r) * 2n >= absB(d)) return q + ((n < 0n) !== (d < 0n) ? -1n : 1n);
  return q;
}

export const add = (a: Dec, b: Dec): Dec => a + b;
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const neg = (a: Dec): Dec => -a;
export const mul = (a: Dec, b: Dec): Dec => divRound(a * b, SCALE);
export const div = (a: Dec, b: Dec): Dec => divRound(a * SCALE, b);
export const isZero = (a: Dec): boolean => a === 0n;
export const sign = (a: Dec): -1 | 0 | 1 => (a < 0n ? -1 : a > 0n ? 1 : 0);
export const sum = (xs: Iterable<Dec>): Dec => { let s = ZERO; for (const x of xs) s += x; return s; };

/** Arrondi à `places` décimales (au plus proche), rendu en texte : « -1234.50 ». */
export function toText(a: Dec, places = 2): string {
  const step = 10n ** BigInt(PLACES - places);
  const r = divRound(a, step);
  const s = absB(r).toString().padStart(places + 1, '0');
  const int = places ? s.slice(0, -places) : s;
  const frac = places ? `.${s.slice(-places)}` : '';
  return `${r < 0n ? '-' : ''}${int}${frac}`;
}

/** Valeur approchée en nombre JS (rendements, statistiques, graphiques). */
export function toNumber(a: Dec): number {
  return Number(a) / Number(SCALE);
}

export const ONE: Dec = SCALE;
