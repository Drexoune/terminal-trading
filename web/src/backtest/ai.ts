// Client de l'assistant IA (section Backtest, S3, T-063) : /api/backtest/ai-* (session exigée,
// Gemini en offre gratuite). Boucle de génération : le code proposé est compilé et exécuté par
// notre moteur ; une erreur part en réparation, trois fois au plus. Les chiffres d'une lecture ne
// viennent que de nos mesures (contrôlés côté serveur).

import { fmtNumber, fmtSigned, NBSP } from '../lib/format';
import type { RunError } from './engine';
import type { Metrics } from './metrics';

export interface AiStatus { configured: boolean; model?: string; calls_today?: number; daily_calls?: number; reason?: string }
export interface GenerateReply { ok: boolean; title?: string; code?: string; summary?: string; assumptions?: string[]; reason?: string; cached?: boolean; calls_today?: number }
export interface RepairReply { ok: boolean; code?: string; change?: string; reason?: string }
export interface ExplainReply { ok: boolean; text?: string; reason?: string; cached?: boolean }

export class AiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

type Fetcher = typeof fetch;

async function call<T>(path: string, body?: unknown, f: Fetcher = fetch): Promise<T> {
  const r = await f(`/api/backtest/${path}`, body === undefined ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new AiError(r.status, `réponse illisible (HTTP ${r.status})`); }
  if (!r.ok) throw new AiError(r.status, (data as { detail?: string }).detail ?? `HTTP ${r.status}`);
  return data as T;
}

export const aiStatus = (f?: Fetcher) => call<AiStatus>('ai', undefined, f);
export const aiGenerate = (b: unknown, f?: Fetcher) => call<GenerateReply>('ai-generate', b, f);
export const aiRepair = (b: unknown, f?: Fetcher) => call<RepairReply>('ai-repair', b, f);
export const aiExplain = (b: unknown, f?: Fetcher) => call<ExplainReply>('ai-explain', b, f);

export interface Step { kind: 'generate' | 'compile' | 'repair' | 'done' | 'fail'; text: string }
export const MAX_REPAIRS = 3;

/**
 * Génère une stratégie puis la fait compiler par le moteur ; chaque erreur part en réparation
 * (MAX_REPAIRS au plus). `compile` renvoie null si le script tourne, l'erreur sinon.
 */
export async function generateAndCompile(
  req: { prompt?: string; image?: { mime: string; data: string }; base_code?: string; context: { asset: string; tf: string } },
  compile: (code: string) => Promise<RunError | null>, onStep: (s: Step) => void,
  api = { generate: aiGenerate, repair: aiRepair },
): Promise<{ ok: boolean; code: string | null; reply: GenerateReply | null; repairs: number }> {
  onStep({ kind: 'generate', text: 'Génération du code Pine…' });
  const g = await api.generate(req);
  if (!g.ok || !g.code) { onStep({ kind: 'fail', text: `Génération refusée : ${g.reason ?? 'réponse vide'}` }); return { ok: false, code: null, reply: g, repairs: 0 }; }
  let code = g.code;
  for (let n = 0; ; n++) {
    const err = await compile(code);
    if (!err) { onStep({ kind: 'done', text: n ? `Le script tourne après ${n} réparation${n > 1 ? 's' : ''}.` : 'Le script compile et tourne.' }); return { ok: true, code, reply: g, repairs: n }; }
    onStep({ kind: 'compile', text: `Erreur${err.line ? ` ligne ${err.line}` : ''} : ${err.error}` });
    if (n >= MAX_REPAIRS) { onStep({ kind: 'fail', text: `Toujours en erreur après ${MAX_REPAIRS} réparations : le code reste dans l’éditeur.` }); return { ok: false, code, reply: g, repairs: n }; }
    onStep({ kind: 'repair', text: `Réparation ${n + 1}/${MAX_REPAIRS}…` });
    const r = await api.repair({ code, error: err.error, line: err.line, context: req.context });
    if (!r.ok || !r.code) { onStep({ kind: 'fail', text: `Réparation refusée : ${r.reason ?? 'réponse vide'}` }); return { ok: false, code, reply: g, repairs: n + 1 }; }
    code = r.code;
    if (r.change) onStep({ kind: 'repair', text: r.change });
  }
}

/** Faits transmis pour une lecture : nos mesures déjà mises en forme, rien d'autre. */
export function explainFacts(m: Metrics, cur: string, extra: { oos_sharpe?: number | null; is_sharpe?: number | null; mc_ruin_pct?: number | null } = {}) {
  const f = (x: number | null, d: number) => (x === null ? 'absent' : fmtNumber(x, d));
  return {
    trades: m.trades,
    winrate_pct: m.winrate === null ? 'absent' : `${fmtNumber(m.winrate * 100, 1)}${NBSP}%`,
    total_pnl: `${fmtSigned(m.total_pnl, 0)}${NBSP}${cur}`, total_pnl_pct: `${fmtSigned(m.total_pnl_pct, 1)}${NBSP}%`,
    rr: f(m.rr, 2), ex_pnl: m.ex_pnl === null ? 'absent' : `${fmtSigned(m.ex_pnl, 0)}${NBSP}${cur}`,
    max_drawdown_pct: `${fmtNumber(m.max_dd_pct, 1)}${NBSP}%`, sharpe: f(m.sharpe, 2), t_stat: f(m.t_stat, 2),
    deflated_sharpe_pct: m.dsr === null ? 'absent' : `${fmtNumber(m.dsr * 100, 1)}${NBSP}%`, trials: m.trials,
    profit_factor: f(m.profit_factor, 2),
    ...(extra.is_sharpe != null ? { in_sample_sharpe: fmtNumber(extra.is_sharpe, 2) } : {}),
    ...(extra.oos_sharpe != null ? { out_of_sample_sharpe: fmtNumber(extra.oos_sharpe, 2) } : {}),
    ...(extra.mc_ruin_pct != null ? { monte_carlo_ruin_pct: `${fmtNumber(extra.mc_ruin_pct, 1)}${NBSP}%` } : {}),
    thresholds: { t_stat: 2, deflated_sharpe_pct: 95 },
  };
}

/** Fichier image -> base64 (PNG, JPEG, WebP ; 3 Mo au plus). */
export async function readImage(file: File): Promise<{ mime: string; data: string; name: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('capture : PNG, JPEG ou WebP');
  if (file.size > 3 * 1024 * 1024) throw new Error('capture de 3 Mo au plus');
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime: file.type, data: btoa(bin), name: file.name };
}
