// Client de la recherche autonome (section Backtest, S4, T-064) : /api/backtest/loops, loop,
// loop-create, loop-stop (session exigée). Les essais tournent dans bt-jobs, navigateur fermé.
import { AiError } from './ai';
import type { AttemptRow, LoopReport, MarketSpec } from './research';

export interface LoopListItem {
  id: string; created_at: string; updated_at: string; status: string; title: string; attempts: number; gemini_calls: number;
  best_score: number | null; best_n: number | null; verdict: 'passed' | 'none' | null; note: string | null; next_run_at: string; finished_at: string | null;
  max_attempts: number | null; max_gemini: number | null; markets: MarketSpec[];
}
export interface LoopDetail {
  loop: LoopListItem & { spec: import('./research').LoopSpec & { period?: string; is_share?: number }; report: LoopReport | null };
  attempts: (AttemptRow & { created_at: string; oos_reasons: string[] | null })[];
  oos_hidden: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/backtest/${path}`, body === undefined ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new AiError(r.status, `réponse illisible (HTTP ${r.status})`); }
  if (!r.ok) throw new AiError(r.status, (data as { detail?: string }).detail ?? `HTTP ${r.status}`);
  return data as T;
}

export const listLoops = () => call<{ loops: LoopListItem[] }>('loops');
export const getLoop = (id: string) => call<LoopDetail>(`loop?id=${encodeURIComponent(id)}`);
export const createLoop = (plan: unknown) => call<{ ok: boolean; id: string }>('loop-create', plan);
export const stopLoop = (id: string) => call<{ ok: boolean }>('loop-stop', { id });

export const STATUS_LABEL: Record<string, string> = {
  running: 'en cours', waiting: 'en attente', stopping: 'arrêt demandé', done: 'finie', stopped: 'arrêtée', failed: 'en échec',
};
export const KIND_LABEL: Record<string, string> = { start: 'départ', generate: 'Gemini · génération', rewrite: 'Gemini · réécriture', params: 'paramètres' };
