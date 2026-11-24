// Moteur du backtest (T-062) : PineTS exécute le Pine Script v5/v6 natif sur nos bougies, avec
// son émulateur de courtier (sémantique de TradingView : exécution à l'ouverture de la barre
// suivante, commissions, glissement). Les réglages de l'écran (capital, frais, glissement, taille,
// marge) remplacent ceux de la déclaration strategy() du script. Tourne dans un Web Worker
// (engine.worker.ts) et sous Node pour les tests.

import { Indicator, PineTS } from 'pinets';
import type { Candle, OpenTrade, Trade } from './metrics';

export interface Settings {
  capital: number;            // capital initial, en devise de cotation
  commissionPct: number;      // commission par ordre, en % du montant
  slippageTicks: number;      // glissement par ordre, en ticks
  qtyPct: number;             // taille de chaque entrée, en % du capital
  margin: boolean;            // appels de marge de TradingView (désactivés par défaut, T-062)
}
export const DEFAULT_SETTINGS: Settings = { capital: 10_000, commissionPct: 0.05, slippageTicks: 1, qtyPct: 100, margin: false };

export interface RunOk {
  ok: true; trades: Trade[]; open: OpenTrade[]; ms: number;
  /** Mesures propres à l'émulateur, gardées comme contrôle des nôtres. */
  emulator: { netprofit: number | null; sharpe: number | null; wins: number | null; losses: number | null };
  title: string | null;
}
export interface RunError { ok: false; error: string; line: number | null; column: number | null }
export type RunResult = RunOk | RunError;

/** Unité de temps de PineTS : « D », « 240 », « 60 ». */
export const PINE_TF: Record<string, string> = { '1D': 'D', '4H': '240', '1H': '60' };

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Erreur de transpilation ou d'exécution : message court, ligne et colonne quand PineTS les donne. */
export function parseError(e: unknown): RunError {
  const msg = String((e as Error)?.message ?? e);
  const m = /\bat (\d+):(\d+)\b/.exec(msg) ?? /line (\d+)(?:,? col(?:umn)? (\d+))?/i.exec(msg);
  return { ok: false, error: msg.replace(/\s+/g, ' ').slice(0, 300), line: m ? Number(m[1]) : null, column: m?.[2] ? Number(m[2]) : null };
}

export async function runStrategy(source: string, candles: Candle[], tf: string, settings: Settings = DEFAULT_SETTINGS,
  inputs: Record<string, unknown> = {}, now: () => number = () => performance.now()): Promise<RunResult> {
  const t0 = now();
  try {
    const ind = new Indicator(source);
    ind.prepare();
    if (ind.getDeclarationType() !== 'strategy') {
      return { ok: false, error: 'script sans déclaration strategy() : un indicator() ne passe aucun ordre à tester', line: null, column: null };
    }
    Object.assign(ind.prop as Record<string, unknown>, {
      initial_capital: settings.capital, default_qty_type: 'percent_of_equity', default_qty_value: settings.qtyPct,
      commission_type: 'percent', commission_value: settings.commissionPct, slippage: settings.slippageTicks,
      ...(settings.margin ? {} : { margin_long: 0, margin_short: 0 }),
    });
    for (const [k, v] of Object.entries(inputs)) (ind.input as Record<string, unknown>)[k] = v;
    const step = candles.length > 1 ? candles[1].t - candles[0].t : 86_400_000;
    const klines = candles.map((b) => ({ openTime: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: 0, closeTime: b.t + step - 1 }));
    const ctx = await new PineTS(klines, 'TERMINAL', PINE_TF[tf] ?? 'D').run(ind);
    const st = (ctx as unknown as { strategy?: Record<string, unknown> }).strategy;
    if (!st) return { ok: false, error: 'script sans déclaration strategy() : aucune transaction à tester', line: null, column: null };
    const closed = (st.closedtrades as Record<string, unknown>[]) ?? [];
    const opened = (st.opentrades as Record<string, unknown>[]) ?? [];
    const trades: Trade[] = closed.map((t) => {
      const size = Number(t.size);
      return {
        side: size >= 0 ? 'long' : 'short', size, entry_id: String(t.entry_id ?? ''), exit_id: t.exit_id == null ? null : String(t.exit_id),
        entry_bar: Number(t.entry_bar_index), entry_time: Number(t.entry_time), entry_price: Number(t.entry_price),
        exit_bar: Number(t.exit_bar_index), exit_time: Number(t.exit_time), exit_price: Number(t.exit_price),
        pnl: Number(t.profit ?? 0), commission: Number(t.commission ?? 0),
      };
    });
    const open: OpenTrade[] = opened.map((t) => ({ side: Number(t.size) >= 0 ? 'long' : 'short', size: Number(t.size),
      entry_bar: Number(t.entry_bar_index), entry_price: Number(t.entry_price) }));
    const cfg = st.config as { title?: string } | undefined;
    return { ok: true, trades, open, ms: Math.round(now() - t0), title: cfg?.title ?? null,
      emulator: { netprofit: num(st.netprofit), sharpe: num(st.sharpe_ratio), wins: num(st.wintrades), losses: num(st.losstrades) } };
  } catch (e) {
    return parseError(e);
  }
}

/** Paramètres d'un script : variables des input.*(), avec leur titre, leur valeur et leurs bornes. */
export interface ScriptInput { id: string; title: string; type: string; value: unknown; options?: unknown[]; min?: number; max?: number; step?: number }
export function scriptInputs(source: string): ScriptInput[] | RunError {
  try {
    const ind = new Indicator(source);
    ind.prepare();
    return ind.getInputsMeta().map((x) => ({ id: x.varId ?? x.id, title: x.title ?? x.varId ?? x.id, type: String(x.type), value: x.defval,
      ...(x.options ? { options: x.options } : {}), ...(x.minval != null ? { min: x.minval } : {}), ...(x.maxval != null ? { max: x.maxval } : {}),
      ...(x.step != null ? { step: x.step } : {}) }));
  } catch (e) {
    return parseError(e);
  }
}
