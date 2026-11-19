// ISIN (ISO 6166) : deux lettres de pays, neuf caractères, une clé de contrôle
// (Luhn sur les chiffres obtenus en remplaçant chaque lettre par 10 à 35).

const SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** ISIN mis en forme (majuscules, sans espaces) si sa clé est juste, sinon null. */
export function normalizeIsin(raw: string): string | null {
  const isin = raw.replace(/\s+/g, '').toUpperCase();
  if (!SHAPE.test(isin)) return null;
  const digits = [...isin.slice(0, 11)].map((c) => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('');
  let sum = 0;
  // Luhn : en partant de la droite, un chiffre sur deux est doublé, à commencer par le dernier.
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]) ? isin : null;
}
