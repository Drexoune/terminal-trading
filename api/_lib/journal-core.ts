// Journal de trading (P6, S5, T-074) : saisie manuelle (aucune clé OKX pour l'instant). Module sans
// import, lu par la fonction Bourse (route /api/bourse/journal) et par l'écran Track record.
// Validation stricte : un trade mal saisi est refusé avec la raison, jamais complété au hasard.

export const SIDES = ['long', 'short'] as const;
export type Side = (typeof SIDES)[number];

export interface JournalTrade {
  id: number;
  opened_ms: number; closed_ms: number | null;
  asset: string; side: Side; qty: number;            // quantité dans l'unité de l'actif (BTC, parts…)
  entry: number; exit: number | null; stop: number | null;
  fees: number;                                      // dans la devise de cotation
  setup: string | null; notes: string | null;
}

export type JournalInput = Omit<JournalTrade, 'id'>;

export class JournalError extends Error {}

const num = (v: unknown, name: string, opts: { positive?: boolean; nullable?: boolean } = {}): number | null => {
  if (v === null || v === undefined || v === '') {
    if (opts.nullable) return null;
    throw new JournalError(`${name} manquant`);
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new JournalError(`${name} illisible`);
  if (opts.positive && n <= 0) throw new JournalError(`${name} doit être positif`);
  return n;
};

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
};

/** Trade saisi → trade validé (cohérence du stop et des dates comprise). */
export function validateTrade(raw: unknown, now: number): JournalInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new JournalError('objet attendu');
  const o = raw as Record<string, unknown>;
  const asset = text(o.asset, 40);
  if (!asset) throw new JournalError('actif manquant');
  if (!(SIDES as readonly string[]).includes(String(o.side))) throw new JournalError('sens : long ou short');
  const side = o.side as Side;
  const opened = num(o.opened_ms, 'date d’entrée')!;
  const closed = num(o.closed_ms, 'date de sortie', { nullable: true });
  if (opened > now + 60_000) throw new JournalError('date d’entrée dans le futur');
  const qty = num(o.qty, 'quantité', { positive: true })!;
  const entry = num(o.entry, 'prix d’entrée', { positive: true })!;
  const exit = num(o.exit, 'prix de sortie', { positive: true, nullable: true });
  const stop = num(o.stop, 'stop', { positive: true, nullable: true });
  const fees = num(o.fees ?? 0, 'frais') ?? 0;
  if (fees < 0) throw new JournalError('frais négatifs');
  if ((exit === null) !== (closed === null)) throw new JournalError('sortie : prix et date ensemble, ou aucun des deux');
  if (closed !== null && closed < opened) throw new JournalError('sortie avant l’entrée');
  if (stop !== null && (side === 'long' ? stop >= entry : stop <= entry)) throw new JournalError(`stop du mauvais côté de l’entrée pour un ${side}`);
  return { opened_ms: opened, closed_ms: closed, asset, side, qty, entry, exit, stop, fees, setup: text(o.setup, 80), notes: text(o.notes, 2000) };
}

/** Résultat d'un trade clos (devise de cotation, frais déduits) ; null s'il est ouvert. */
export function pnl(t: Pick<JournalTrade, 'side' | 'qty' | 'entry' | 'exit' | 'fees'>): number | null {
  if (t.exit === null) return null;
  return (t.side === 'long' ? t.exit - t.entry : t.entry - t.exit) * t.qty - t.fees;
}

/** Résultat en R (multiple du risque au stop) ; null sans stop ou trade ouvert. */
export function rMultiple(t: Pick<JournalTrade, 'side' | 'qty' | 'entry' | 'exit' | 'stop' | 'fees'>): number | null {
  const p = pnl(t);
  if (p === null || t.stop === null) return null;
  const risk = Math.abs(t.entry - t.stop) * t.qty;
  return risk > 0 ? p / risk : null;
}
