// Mesure de la latence de bout en bout, indépendante de l'horloge du navigateur.
//
// La passerelle répond aux pings avec son heure : on en déduit l'écart entre
// l'horloge du navigateur et la sienne, en gardant l'échantillon au plus
// court aller-retour (méthode NTP). Toutes les heures du trajet sont alors
// ramenées sur l'horloge de la passerelle, elle-même contrôlée contre OKX.
// En Mode Online, même méthode sans passerelle : la référence est l'heure
// d'OKX, lue par GET /api/okx-time (sources/okxSource.ts).

export interface PingSample { offsetMs: number; rttMs: number }

export function pingSample(t0: number, serverTs: number, t3: number): PingSample {
  const rtt = t3 - t0;
  return { offsetMs: serverTs - (t0 + t3) / 2, rttMs: rtt };
}

/** L'échantillon au plus court aller-retour est le moins incertain (méthode NTP). */
export function bestSample(samples: PingSample[]): PingSample | null {
  const valid = samples.filter((s) => s.rttMs >= 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (b.rttMs < a.rttMs ? b : a));
}

export class ClockSync {
  private samples: PingSample[] = [];
  constructor(private readonly keep = 8) {}

  add(s: PingSample): void {
    if (s.rttMs < 0) return;
    this.samples.push(s);
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get best(): PingSample | null {
    return bestSample(this.samples);
  }

  /** Heure de la référence (passerelle) correspondant à l'heure navigateur `localMs`. */
  toGateway(localMs: number): number {
    return localMs + (this.best?.offsetMs ?? 0);
  }
}

export class RollingMedian {
  private values: number[] = [];
  constructor(private readonly size = 31) {}

  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
  }

  get value(): number | null {
    if (!this.values.length) return null;
    const s = [...this.values].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  get count(): number {
    return this.values.length;
  }
}

/** Découpe d'un trajet : OKX -> passerelle -> navigateur (heures passerelle).
 *  En direct (Mode Online), un seul tronçon : réception corrigée − ts_source. */
export function legs(tsSource: number, tsRecv: number, browserAsGateway: number) {
  return {
    okxToGateway: tsRecv - tsSource,
    gatewayToScreen: browserAsGateway - tsRecv,
    total: browserAsGateway - tsSource,
  };
}

/** Statut d'un flux selon l'âge du dernier message (seuils du design system). */
export type Freshness = 'live' | 'late' | 'stale' | 'down';

export const LATE_AFTER_MS = 2_000;   // point or : retard > 2 s
export const STALE_AFTER_MS = 15_000; // badge « périmé »

export function freshness(ageMs: number | null, connected: boolean): Freshness {
  if (!connected || ageMs === null) return 'down';
  if (ageMs > STALE_AFTER_MS) return 'stale';
  if (ageMs > LATE_AFTER_MS) return 'late';
  return 'live';
}
