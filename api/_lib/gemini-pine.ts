// Gemini pour le Pine Script (section Backtest, T-063, T-064) : consignes, schémas JSON et appel.
// Module sans import, partagé par l'assistant (api/_lib/backtest-ai.ts, Vercel) et par la
// recherche autonome (bt-jobs, Supabase : regroupé dans research-core.gen.js par
// web/scripts/build-research-core.mjs). Offre gratuite seulement, modèle le moins cher.

export const MODEL = 'gemini-3.1-flash-lite';        // T-063 : le moins cher, offre gratuite
export const DAILY_CALLS = 50;                       // plafond du terminal, sous le quota gratuit de Google
export const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 50_000;

/** generate, repair, explain : assistant (S3) ; evolve : réécriture dans la recherche autonome (S4). */
export type GeminiTask = 'generate' | 'repair' | 'explain' | 'evolve';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const PINE_RULES = `Rules for the Pine Script you write:
- Pine Script v6, starting with //@version=6, then exactly one strategy("<short French title>", overlay=true) declaration.
- Every tunable value is an input.int / input.float / input.string with a short French title.
- Orders only with strategy.entry, strategy.close, strategy.exit; long and short allowed.
- Only the chart's own OHLCV series and ta.* / math.* functions. No request.security, no libraries, no alerts, no drawings, no tables.
- No lookahead, no future data, no repainting tricks.
- Do not set capital, commission, slippage, quantity or margin in strategy(): the terminal sets them.
- Keep it under 150 lines.`;

export const SYSTEM: Record<GeminiTask, string> = {
  generate: `You write trading strategies in Pine Script v6 for a personal backtesting terminal. ${PINE_RULES}
Reply in JSON: title (French, short), code (the full script), summary (French, 3 sentences at most, the logic only, no performance claims, no numbers you were not given), assumptions (French, list of the choices you had to make).`,
  repair: `You fix Pine Script v6 strategies that fail to compile or run in PineTS (a TypeScript runtime for Pine Script). ${PINE_RULES}
Keep the strategy's logic; change only what the error requires. Reply in JSON: code (the full corrected script), change (French, one sentence).`,
  explain: `You explain backtest results for a personal trading terminal, in French, in 120 words at most.
Use ONLY the numbers given in "facts", written exactly as given. Never compute, round differently, or introduce any other number, date or percentage.
No advice to trade, no forecast. Point out what the deflated Sharpe, the t-stat and the out-of-sample figures say about chance.
Reply in JSON: text.`,
  evolve: `You improve a trading strategy inside an automated research loop of a personal backtesting terminal. ${PINE_RULES}
You receive the current best strategy, the pass criteria with its in-sample values and partial credit (1 = met), and a short history of earlier attempts.
Change the trading LOGIC (entries, exits, filters, stops, regime conditions) to raise the weakest criteria; parameter tweaks alone are tried by the loop itself, do not just change numbers.
Avoid overfitting: few inputs, round default values, rules that make economic sense. Never mention performance you were not given.
Reply in JSON: title (French, short), code (the full script), change (French, one sentence: what you changed and why).`,
};

export const SCHEMA: Record<GeminiTask, unknown> = {
  generate: { type: 'OBJECT', properties: { title: { type: 'STRING' }, code: { type: 'STRING' }, summary: { type: 'STRING' },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['title', 'code', 'summary', 'assumptions'] },
  repair: { type: 'OBJECT', properties: { code: { type: 'STRING' }, change: { type: 'STRING' } }, required: ['code', 'change'] },
  explain: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
  evolve: { type: 'OBJECT', properties: { title: { type: 'STRING' }, code: { type: 'STRING' }, change: { type: 'STRING' } }, required: ['title', 'code', 'change'] },
};

export interface GeminiReply { data: Record<string, unknown>; input_tokens: number | null; output_tokens: number | null }
export class GeminiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function callGemini(fetchFn: FetchLike, key: string, task: GeminiTask, userText: string, image?: { mime: string; data: string }): Promise<GeminiReply> {
  const parts: unknown[] = [{ text: userText }];
  if (image) parts.push({ inlineData: { mimeType: image.mime, data: image.data } });
  let r: Response;
  try {
    r = await fetchFn(`${GEMINI}/${MODEL}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM[task] }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA[task], temperature: task === 'explain' ? 0.2 : task === 'evolve' ? 0.7 : 0.4 },
      }),
    });
  } catch (e) {
    throw new GeminiError(0, `Gemini injoignable : ${(e as Error).message}`.slice(0, 200));
  }
  const text = await r.text();
  if (r.status !== 200) {
    let msg = text.slice(0, 200);
    try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message?.slice(0, 200) ?? msg; } catch { /* corps non JSON */ }
    throw new GeminiError(r.status, msg.split(key).join('<clé>'));
  }
  const d = JSON.parse(text) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } };
  const out = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let data: Record<string, unknown>;
  try { data = JSON.parse(out) as Record<string, unknown>; } catch { throw new GeminiError(502, `réponse de Gemini illisible (${d.candidates?.[0]?.finishReason ?? 'sans motif'})`); }
  const u = d.usageMetadata;
  return { data, input_tokens: u?.promptTokenCount ?? null, output_tokens: u ? (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) : null };
}

/** Jour de Paris (plafond quotidien des appels). */
export function parisDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
