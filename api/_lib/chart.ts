// Graphique BTC du Mode Online : même calcul et même JSON que
// gateway/terminal_gateway/okx_service.py::OkxService.chart (seule `source`
// diffère). La parité est vérifiée contre une sortie réelle de la passerelle
// (api/_tests/fixtures/chart_golden.json, régénérée par
// api/_tests/make_chart_golden.py). Toute modification de OkxService.chart
// doit être reportée ici, et inversement.

import type { ChartData } from '../../web/src/data/protocol.js';
import type { OkxRest } from './okx.js';

export type Range = ChartData['range'];

// Période du graphique -> (taille de bougie OKX, durée d'une bougie, jours couverts).
// 1 J : journée UTC en cours en 1 min (≤ 1 440 bougies) ;
// 5 J : 5 jours en 5 min (1 440) ; 1 M : 30 jours en 1 h (720).
// OKX ne sert que les 1 440 dernières bougies de chaque taille, d'où ces tailles.
export const RANGES: Record<Range, readonly [bar: string, barMs: number, days: number]> = {
  '1D': ['1m', 60_000, 1],
  '5D': ['5m', 300_000, 5],
  '1M': ['1H', 3_600_000, 30],
};

export const DAY_MS = 86_400_000;
export const CHART_CACHE_MS = 15_000; // comme CHART_CACHE_S de la passerelle
export const CHART_SOURCE = 'OKX EEA REST · Vercel';

export function isRange(x: string): x is Range {
  return Object.prototype.hasOwnProperty.call(RANGES, x);
}

/** Début (00:00 UTC) du jour UTC contenant `ms`. */
export function utcDayStart(ms: number): number {
  return ms - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
}

export async function buildChart(okx: OkxRest, inst: string, range: Range, now: () => number): Promise<ChartData> {
  const [bar, barMs, days] = RANGES[range];
  const today = utcDayStart(now());
  const start = today - (days - 1) * DAY_MS;
  const end = today + DAY_MS;
  const candles = await okx.candles(inst, bar, start);
  // Veille UTC (PDH / PDL) : bougie quotidienne alignée sur 00:00 UTC.
  const daily = await okx.candles(inst, '1Dutc', today - DAY_MS, 2);
  const prev = daily.find((c) => c.t === today - DAY_MS);
  return {
    inst, range, bar, bar_ms: barMs,
    from_ms: start, to_ms: end,
    candles: candles.map(({ t, o, h, l, c, vol_base, vol_quote }) => ({ t, o, h, l, c, vol_base, vol_quote })),
    prev_day: prev ? { t: prev.t, h: prev.h, l: prev.l, confirmed: prev.confirmed } : null,
    source: CHART_SOURCE,
    ts_recv: now(),
  };
}

/**
 * Cache des graphiques, par instance de fonction (15 s, comme la passerelle).
 * Le CDN de Vercel garde aussi la réponse 15 s (s-maxage) ; ce cache sert en
 * développement et quand plusieurs requêtes arrivent ensemble sur une même
 * instance : elles partagent alors le même appel à OKX. Un échec n'est pas gardé.
 */
export class ChartCache {
  private readonly entries = new Map<string, { at: number; value: Promise<ChartData> }>();

  constructor(private readonly ttlMs = CHART_CACHE_MS) {}

  get(key: string, nowMono: number, load: () => Promise<ChartData>): Promise<ChartData> {
    const hit = this.entries.get(key);
    if (hit && nowMono - hit.at < this.ttlMs) return hit.value;
    const value = load();
    const entry = { at: nowMono, value };
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }
}
