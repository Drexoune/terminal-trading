// Client du Web Worker du moteur : un backtest à la fois (le précédent est abandonné), repli sur le
// fil principal quand les workers ne sont pas disponibles (tests).
import { runStrategy, type RunResult, type Settings } from './engine';
import type { Candle } from './metrics';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: RunResult) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: RunResult }>) => {
      pending.get(e.data.id)?.(e.data.result);
      pending.delete(e.data.id);
    };
    worker.onerror = (e) => {
      for (const [, resolve] of pending) resolve({ ok: false, error: `moteur interrompu : ${e.message}`, line: null, column: null });
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch { return null; }
}

export function runBacktest(source: string, candles: Candle[], tf: string, settings: Settings, inputs: Record<string, unknown>): Promise<RunResult> {
  const w = getWorker();
  if (!w) return runStrategy(source, candles, tf, settings, inputs);
  const id = ++seq;
  for (const [k, resolve] of pending) { resolve({ ok: false, error: 'remplacé par un nouveau backtest', line: null, column: null }); pending.delete(k); }
  return new Promise((resolve) => { pending.set(id, resolve); w.postMessage({ id, source, candles, tf, settings, inputs }); });
}
