// Mise en forme des résultats (section Backtest) : tuiles notées E → S (T-061), journal des
// transactions. Fonctions pures, testées par Vitest ; aucune valeur inventée (« — » et la raison).
import { fmtNumber, fmtSigned, NBSP } from '../lib/format';
import { GRADED, type Metrics } from './metrics';

export interface Tile {
  key: string; label: string; grade: string; value: string; sub: string; formula: string;
  tone: 'up' | 'dn' | 'nt'; missing: string | null;
}

const pct = (x: number, d = 1) => `${fmtNumber(x, d)}${NBSP}%`;
const money = (x: number, cur: string, signed = false) => `${signed ? fmtSigned(x, 0) : fmtNumber(x, 0)}${NBSP}${cur}`;
const tone = (x: number | null, good = 0): 'up' | 'dn' | 'nt' => (x === null ? 'nt' : x > good ? 'up' : x < good ? 'dn' : 'nt');

export function tiles(m: Metrics, cur: string): Tile[] {
  const none = m.trades === 0 ? 'aucune transaction close' : null;
  const out: Record<string, Omit<Tile, 'key' | 'label' | 'grade'>> = {
    winrate: { value: m.winrate === null ? '—' : pct(m.winrate * 100), sub: `${m.wins} gagnant${m.wins > 1 ? 's' : ''} sur ${m.trades} trade${m.trades > 1 ? 's' : ''}`,
      formula: 'trades à PnL > 0 / trades clos', tone: 'nt', missing: none },
    total_pnl: { value: money(m.total_pnl, cur, true), sub: `${fmtSigned(m.total_pnl_pct, 1)}${NBSP}% du capital · facteur de profit ${m.profit_factor === null ? '—' : fmtNumber(m.profit_factor, 2)}`,
      formula: 'somme des PnL nets des trades clos', tone: tone(m.total_pnl), missing: none },
    rr: { value: m.rr === null ? '—' : fmtNumber(m.rr, 2), sub: m.rr === null ? 'il faut au moins un gain et une perte' : `gain moyen / perte moyenne`,
      formula: 'gain moyen / |perte moyenne|', tone: m.rr === null ? 'nt' : tone(m.rr, 1), missing: m.rr === null ? (none ?? 'aucun gain ou aucune perte') : null },
    ex: { value: m.ex_pnl === null ? '—' : `${money(m.ex_pnl, cur, true)}${NBSP}/ trade`, sub: m.ex_ret_pct === null ? '—' : `${fmtSigned(m.ex_ret_pct, 2)}${NBSP}% par trade (notionnel)`,
      formula: 'PnL moyen par trade ; rendement moyen sur le notionnel', tone: tone(m.ex_pnl), missing: none },
    max_dd: { value: m.max_dd_pct === 0 ? pct(0) : `−${pct(m.max_dd_pct)}`, sub: `−${money(m.max_dd, cur)} depuis le plus haut du capital`,
      formula: 'plus forte baisse du capital (marqué à chaque clôture) depuis son plus haut', tone: m.max_dd_pct > 0 ? 'dn' : 'nt', missing: null },
    sharpe: { value: m.sharpe === null ? '—' : fmtNumber(m.sharpe, 2), sub: 'annualisé, rendements par barre, taux sans risque nul',
      formula: 'moyenne / écart type des rendements par barre × √(barres par an)', tone: tone(m.sharpe), missing: m.sharpe === null ? 'capital constant' : null },
    t_stat: { value: m.t_stat === null ? '—' : fmtNumber(m.t_stat, 2), sub: m.t_stat === null ? 'au moins 2 trades' : `${Math.abs(m.t_stat) >= 2 ? 'au-delà' : 'en deçà'} du seuil de 2 (≈ 5 %)`,
      formula: 'rendement moyen par trade / (écart type / √n)', tone: m.t_stat === null ? 'nt' : Math.abs(m.t_stat) >= 2 ? tone(m.t_stat) : 'nt',
      missing: m.t_stat === null ? (none ?? 'un seul trade') : null },
    dsr: { value: m.dsr === null ? '—' : pct(m.dsr * 100), sub: `N = ${m.trials} essai${m.trials > 1 ? 's' : ''} · probabilité que le Sharpe ne doive rien au hasard`,
      formula: 'Bailey et López de Prado (2014) : Φ((SR − SR0)·√(T − 1) / √(1 − γ3·SR + (γ4 − 1)/4·SR²)), SR0 = Sharpe maximal attendu parmi N essais',
      tone: m.dsr === null ? 'nt' : m.dsr >= 0.95 ? 'up' : m.dsr < 0.5 ? 'dn' : 'nt', missing: m.dsr === null ? 'rendements insuffisants ou trop asymétriques' : null },
  };
  return GRADED.map((g) => ({ key: g.key, label: g.label, grade: g.grade, ...out[g.key] }));
}

/** Cause d'une sortie, d'après l'ordre qui l'a fermée (identifiants des stratégies connues). */
export function exitReason(exitId: string | null, side: 'long' | 'short'): string {
  if (!exitId) return '—';
  if (exitId === 'XL' || exitId === 'XS') return 'stop ou objectif';
  if ((side === 'long' && exitId === 'S') || (side === 'short' && exitId === 'L')) return 'retournement';
  if (/close/i.test(exitId)) return 'sortie sur signal';
  return exitId.slice(0, 24);
}
