// Compte (P6, S5) : statistiques du journal et calculateur de risque. Fonctions pures, testées ;
// aucune donnée inventée (une statistique sans trade clos vaut null, affichée « — »).

import { pnl, rMultiple, type JournalTrade } from '../../../api/_lib/journal-core';
import type { FirmRules } from '../backtest/diagnostics';

export { pnl, rMultiple };

export interface JournalStats {
  trades: number; closed: number; open: number;
  wins: number; losses: number; winRate: number | null;
  total: number; avgWin: number | null; avgLoss: number | null; profitFactor: number | null;
  expectancyR: number | null; rCount: number;
  worstStreak: number; bestTrade: number | null; worstTrade: number | null;
  curve: { t: number; cum: number }[];               // résultat cumulé, trades clos par date de sortie
}

export function journalStats(trades: JournalTrade[]): JournalStats {
  const closed = trades.filter((t) => t.exit !== null && t.closed_ms !== null).sort((a, b) => a.closed_ms! - b.closed_ms!);
  const res = closed.map((t) => pnl(t)!);
  const wins = res.filter((x) => x > 0), losses = res.filter((x) => x < 0);
  const rs = closed.map((t) => rMultiple(t)).filter((r): r is number => r !== null);
  let streak = 0, worst = 0, cum = 0;
  const curve = closed.map((t, i) => {
    streak = res[i] < 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
    cum += res[i];
    return { t: t.closed_ms!, cum: Math.round(cum * 100) / 100 };
  });
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  return {
    trades: trades.length, closed: closed.length, open: trades.length - closed.length,
    wins: wins.length, losses: losses.length, winRate: closed.length ? wins.length / closed.length : null,
    total: Math.round(sum(res) * 100) / 100,
    avgWin: wins.length ? sum(wins) / wins.length : null, avgLoss: losses.length ? sum(losses) / losses.length : null,
    profitFactor: losses.length && wins.length ? sum(wins) / Math.abs(sum(losses)) : null,
    expectancyR: rs.length ? sum(rs) / rs.length : null, rCount: rs.length,
    worstStreak: worst, bestTrade: res.length ? Math.max(...res) : null, worstTrade: res.length ? Math.min(...res) : null, curve,
  };
}

// --- calculateur de risque -------------------------------------------------------------------

export interface SizeInput {
  capital: number;                 // solde du compte (devise de cotation)
  riskPct: number | null;          // risque en % du capital, ou…
  riskAmount: number | null;       // … en montant (prioritaire s'il est donné)
  entry: number; stop: number;
  ctVal: number | null;            // taille d'un contrat en unités de l'actif (OKX BTC-USDT-SWAP : 0,01)
  lotSz: number | null;            // pas de quantité en contrats (OKX : 0,01)
}

export interface SizeResult {
  side: 'long' | 'short'; risk: number; distance: number; distancePct: number;
  qty: number;                     // unités de l'actif, arrondies au pas des contrats (vers le bas)
  contracts: number | null; notional: number; leverage: number; lossAtStop: number;
  warnings: string[];
}

export class SizeError extends Error {}

export function positionSize(i: SizeInput): SizeResult {
  if (!(i.capital > 0)) throw new SizeError('capital : un montant positif');
  if (!(i.entry > 0) || !(i.stop > 0)) throw new SizeError('entrée et stop : des prix positifs');
  if (i.entry === i.stop) throw new SizeError('le stop doit différer de l’entrée');
  const risk = i.riskAmount !== null && i.riskAmount > 0 ? i.riskAmount : i.riskPct !== null && i.riskPct > 0 ? (i.capital * i.riskPct) / 100 : NaN;
  if (!Number.isFinite(risk)) throw new SizeError('risque : un pourcentage ou un montant positif');
  const side = i.stop < i.entry ? 'long' : 'short';
  const distance = Math.abs(i.entry - i.stop);
  let qty = risk / distance;
  let contracts: number | null = null;
  if (i.ctVal && i.ctVal > 0) {
    const step = i.lotSz && i.lotSz > 0 ? i.lotSz : 1;
    contracts = Math.floor(qty / i.ctVal / step + 1e-9) * step;
    contracts = Math.round(contracts * 1e8) / 1e8;
    qty = contracts * i.ctVal;
  }
  const notional = qty * i.entry, lossAtStop = qty * distance;
  const warnings: string[] = [];
  if (contracts === 0) warnings.push('risque trop faible pour un seul pas de contrat : taille nulle');
  const leverage = notional / i.capital;
  if (leverage > 10) warnings.push(`levier de ${Math.round(leverage)} : au-delà de 10`);
  if (risk > i.capital * 0.05) warnings.push('plus de 5 % du capital risqué sur un trade');
  return { side, risk, distance, distancePct: (distance / i.entry) * 100, qty, contracts, notional, leverage, lossAtStop, warnings };
}

export interface FirmCheck { firm: string; ok: boolean; lines: { label: string; ok: boolean; detail: string }[] }

/**
 * Perte au stop contre les règles d'une société de financement (backtest/diagnostics.ts, relevées
 * le 24/11/2026) : perte journalière restante et marge avant la perte maximale.
 */
export function firmCheck(f: FirmRules, lossAtStop: number, todayPnl: number, balance: number): FirmCheck {
  const lines: FirmCheck['lines'] = [];
  if (f.dailyLoss !== null) {
    const left = f.dailyLoss + Math.min(0, todayPnl);
    lines.push({ label: 'Perte journalière', ok: lossAtStop <= left, detail: `reste ${Math.round(left)} sur ${Math.round(f.dailyLoss)}${f.dailyLossFails ? ' (échec si dépassée)' : ' (séance bloquée si dépassée)'}` });
  }
  const floor = f.account - f.maxLoss;
  const room = balance - floor;
  lines.push({ label: 'Perte maximale', ok: lossAtStop <= room, detail: `marge ${Math.round(room)} avant le seuil de ${Math.round(floor)}${f.maxLossMode === 'eod_trailing' ? ' (suiveur, fin de journée)' : ''}` });
  return { firm: f.label, ok: lines.every((l) => l.ok), lines };
}
