// Texte décimal exact (BigInt) pour les chiffres officiels : jamais de flottant pour une
// valeur publiée (règle de storage.py). Sous-ensemble utile à P1 : lecture, soustraction,
// division arrondie au demi supérieur (ROUND_HALF_UP de Python : loin de zéro).

export interface Dec { n: bigint; scale: number }   // valeur = n / 10^scale

const DEC = /^-?\d+(?:\.\d+)?$/;

export function parseDec(s: string | null | undefined): Dec | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  if (!DEC.test(t)) return null;
  const [i, f = ''] = t.replace('-', '').split('.');
  const n = BigInt(i + f) * (t.startsWith('-') ? -1n : 1n);
  return { n, scale: f.length };
}

export const decimals = (s: string) => (s.includes('.') ? s.split('.', 2)[1].length : 0);

function rescale(d: Dec, scale: number): bigint {
  return d.n * 10n ** BigInt(scale - d.scale);
}

/** Écriture « f » de Python Decimal ; « -0.0 » ramené à « 0.0 » si keepNegZero est faux. */
export function formatDec(n: bigint, scale: number, negative = n < 0n): string {
  const abs = n < 0n ? -n : n;
  let s = abs.toString().padStart(scale + 1, '0');
  if (scale > 0) s = `${s.slice(0, -scale)}.${s.slice(-scale)}`;
  return negative ? `-${s}` : s;
}

export function subDec(a: Dec, b: Dec): Dec {
  const scale = Math.max(a.scale, b.scale);
  return { n: rescale(a, scale) - rescale(b, scale), scale };
}

export function cmpDec(a: Dec, b: Dec): number {
  const scale = Math.max(a.scale, b.scale);
  const x = rescale(a, scale);
  const y = rescale(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** num/den arrondi au demi supérieur (loin de zéro), entier. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  const neg = (num < 0n) !== (den < 0n);
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (2n * a + b) / (2n * b);
  return neg ? -q : q;
}
