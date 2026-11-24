// Web Worker du moteur (T-062) : PineTS hors du fil principal, pour que l'écran reste fluide sur
// 50 000 bougies. Un message = un backtest ; la réponse porte le même identifiant.
import { runStrategy, type Settings } from './engine';
import type { Candle } from './metrics';

export interface RunMessage { id: number; source: string; candles: Candle[]; tf: string; settings: Settings; inputs: Record<string, unknown> }

self.onmessage = async (e: MessageEvent<RunMessage>) => {
  const m = e.data;
  const result = await runStrategy(m.source, m.candles, m.tf, m.settings, m.inputs);
  (self as unknown as Worker).postMessage({ id: m.id, result });
};
