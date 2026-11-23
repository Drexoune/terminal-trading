// Réaction du BTC à une publication (E3, plan P1 § 7.8) : portage de
// gateway/terminal_gateway/reaction.py. En ligne, les bougies viennent de la table
// okx_candles_1m remplie chaque minute par okx-collector (gardée 90 jours).
// Référence : clôture de la bougie T-1 min ; fin : clôture de la bougie T+29 min ;
// variation en %, deux décimales, en décimal exact (demi vers le haut).

import { divHalfUp, formatDec, parseDec } from './decimal.ts';

export const INST = 'BTC-USDT-SWAP';
export const BAR_MS = 60_000;
export const BEFORE_MS = 5 * BAR_MS;
export const AFTER_MS = 30 * BAR_MS;
export const DUE_AFTER_MS = AFTER_MS + BAR_MS;
export const FINAL_AFTER_MS = 45 * BAR_MS;   // au-delà, une bougie absente est enregistrée comme telle

export interface Candle { t: number; o: number; h: number; l: number; c: number; confirmed?: boolean }

/** Écriture courte d'un prix (repr Python d'un flottant : « 91234.5 », « 100000.0 »). */
export const priceText = (x: number) => (Number.isInteger(x) ? `${x}.0` : String(x));

export function btcReaction(candles: Candle[], t: number) {
  const lo = t - BEFORE_MS;
  const hi = t + AFTER_MS;
  const byT = new Map(candles.filter((c) => c.t >= lo && c.t < hi).map((c) => [c.t, c] as const));
  const expected: number[] = [];
  for (let x = lo; x < hi; x += BAR_MS) expected.push(x);
  const missing = expected.filter((x) => !byT.has(x));
  const unconfirmed = [...byT.values()].filter((c) => c.confirmed === false).map((c) => c.t).sort((a, b) => a - b);
  const refC = byT.get(t - BAR_MS);
  const endC = byT.get(hi - BAR_MS);
  let reason: string | null = null;
  let change: string | null = null;
  if (!refC) reason = 'bougie T-1 min absente : pas de prix de référence';
  else if (!endC || endC.confirmed === false) reason = 'bougie T+29 min absente ou non clôturée : pas de prix à T+30 min';
  else {
    const ref = parseDec(priceText(refC.c))!;
    const end = parseDec(priceText(endC.c))!;
    const s = Math.max(ref.scale, end.scale);
    const r = ref.n * 10n ** BigInt(s - ref.scale);
    const e = end.n * 10n ** BigInt(s - end.scale);
    const hundredths = divHalfUp((e - r) * 10_000n, r);
    change = formatDec(hundredths, 2, hundredths < 0n);
  }
  return {
    inst: INST, bar: '1m', scheduled_ms: t, from_ms: lo, to_ms: hi,
    candles: expected.filter((x) => byT.has(x)).map((x) => { const c = byT.get(x)!; return { t: x, o: c.o, h: c.h, l: c.l, c: c.c }; }),
    ref_price: refC ? priceText(refC.c) : null,
    end_price: endC && change !== null ? priceText(endC.c) : null,
    change_pct: change, missing, unconfirmed, reason,
  };
}
