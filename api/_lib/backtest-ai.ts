// Assistant IA de la section Backtest (étape S3, décision T-063) : Gemini, offre gratuite seulement,
// modèle le moins cher. Trois tâches, toutes en JSON :
//   - generate : texte, capture d'écran ou stratégie connue -> code Pine Script v6 ;
//   - repair   : code et erreur de compilation ou d'exécution -> code corrigé ;
//   - explain  : mesures calculées par notre moteur -> lecture courte qui ne cite que ces chiffres
//                (contrôle : tout nombre absent des mesures fait rejeter la lecture).
// L'IA ne calcule rien : le code est compilé et exécuté par PineTS dans le navigateur, les mesures
// viennent de metrics.ts. Session exigée (appels comptés), plafond d'appels par jour, cache.

import { createBourseDb, type BourseDb } from './bourse/db.js';
import { sameOriginJson } from './bourse/auth.js';
import { sessionProblem } from './bourse/routes.js';
import { HttpError, json, NO_STORE, type Env } from './http.js';
import type { FetchFn } from './okx.js';
import type { SupabaseConfig } from './supabase.js';

export const MODEL = 'gemini-3.1-flash-lite';        // T-063 : le moins cher, offre gratuite
export const DAILY_CALLS = 50;                       // plafond du terminal, sous le quota gratuit de Google
export const PROMPT_VERSION = 'bt-ai-1';
export const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_BODY = 4 * 1024 * 1024;                    // capture d'écran comprise (limite de Vercel : 4,5 Mo)
const TIMEOUT_MS = 50_000;
export const TASKS = ['generate', 'repair', 'explain'] as const;
export type Task = (typeof TASKS)[number];

// --- Consignes ---------------------------------------------------------------------------------

const PINE_RULES = `Rules for the Pine Script you write:
- Pine Script v6, starting with //@version=6, then exactly one strategy("<short French title>", overlay=true) declaration.
- Every tunable value is an input.int / input.float / input.string with a short French title.
- Orders only with strategy.entry, strategy.close, strategy.exit; long and short allowed.
- Only the chart's own OHLCV series and ta.* / math.* functions. No request.security, no libraries, no alerts, no drawings, no tables.
- No lookahead, no future data, no repainting tricks.
- Do not set capital, commission, slippage, quantity or margin in strategy(): the terminal sets them.
- Keep it under 150 lines.`;

export const SYSTEM: Record<Task, string> = {
  generate: `You write trading strategies in Pine Script v6 for a personal backtesting terminal. ${PINE_RULES}
Reply in JSON: title (French, short), code (the full script), summary (French, 3 sentences at most, the logic only, no performance claims, no numbers you were not given), assumptions (French, list of the choices you had to make).`,
  repair: `You fix Pine Script v6 strategies that fail to compile or run in PineTS (a TypeScript runtime for Pine Script). ${PINE_RULES}
Keep the strategy's logic; change only what the error requires. Reply in JSON: code (the full corrected script), change (French, one sentence).`,
  explain: `You explain backtest results for a personal trading terminal, in French, in 120 words at most.
Use ONLY the numbers given in "facts", written exactly as given. Never compute, round differently, or introduce any other number, date or percentage.
No advice to trade, no forecast. Point out what the deflated Sharpe, the t-stat and the out-of-sample figures say about chance.
Reply in JSON: text.`,
};

export const SCHEMA: Record<Task, unknown> = {
  generate: { type: 'OBJECT', properties: { title: { type: 'STRING' }, code: { type: 'STRING' }, summary: { type: 'STRING' },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['title', 'code', 'summary', 'assumptions'] },
  repair: { type: 'OBJECT', properties: { code: { type: 'STRING' }, change: { type: 'STRING' } }, required: ['code', 'change'] },
  explain: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
};

// --- Contrôle des chiffres ------------------------------------------------------------------------

/** Nombres d'un texte français (« −1 234,5 », « 62,5 % », « 0.9 ») en valeur absolue. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d   ]*(?:[.,]\d+)?/g)) {
    const raw = m[0].trim().replace(/[   ]/g, '').replace(',', '.');
    const v = Number(raw);
    if (Number.isFinite(v)) out.push(Math.abs(v));
  }
  return out;
}

/** Nombres des faits (valeurs numériques et chaînes), en valeur absolue. */
export function allowedNumbers(facts: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(Math.abs(v));
    else if (typeof v === 'string') out.push(...numbersIn(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** Nombres du texte absents des faits (tolérance d'arrondi : 0,05 ou 0,5 %). */
export function inventedNumbers(text: string, facts: unknown): number[] {
  const ok = allowedNumbers(facts);
  return numbersIn(text).filter((n) => !ok.some((a) => Math.abs(a - n) <= Math.max(0.051, Math.abs(a) * 0.005)));
}

// --- Gemini --------------------------------------------------------------------------------------

export interface GeminiReply { data: Record<string, unknown>; input_tokens: number | null; output_tokens: number | null }
export class GeminiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function callGemini(fetchFn: FetchFn, key: string, task: Task, userText: string, image?: { mime: string; data: string }): Promise<GeminiReply> {
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
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA[task], temperature: task === 'explain' ? 0.2 : 0.4 },
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

// --- Requêtes ------------------------------------------------------------------------------------

export interface AiBody {
  prompt?: string; image?: { mime: string; data: string }; base_code?: string;       // generate
  code?: string; error?: string; line?: number | null;                               // repair
  facts?: Record<string, unknown>;                                                   // explain
  context?: { asset?: string; tf?: string };
}

/** Demande envoyée à Gemini pour une tâche, après contrôle des champs. */
export function userText(task: Task, b: AiBody): string {
  const ctx = `Market: ${b.context?.asset ?? '?'} on ${b.context?.tf ?? '?'} bars.`;
  if (task === 'generate') {
    if (!b.prompt?.trim() && !b.image && !b.base_code) throw new HttpError(400, 'demande vide : un texte, une capture ou une stratégie de départ');
    return [ctx, b.prompt?.trim() ? `Request: ${b.prompt.trim().slice(0, 4000)}` : 'Request: turn the attached chart into a testable strategy.',
      b.image ? 'A chart screenshot is attached: infer the setup it shows (indicators, entry and exit logic).' : '',
      b.base_code ? `Start from this existing strategy:\n${b.base_code.slice(0, 20_000)}` : ''].filter(Boolean).join('\n\n');
  }
  if (task === 'repair') {
    if (!b.code || !b.error) throw new HttpError(400, 'code et erreur exigés');
    return `${ctx}\n\nError${b.line ? ` at line ${b.line}` : ''}: ${b.error.slice(0, 1000)}\n\nScript:\n${b.code.slice(0, 20_000)}`;
  }
  if (!b.facts || typeof b.facts !== 'object') throw new HttpError(400, 'mesures exigées');
  return `${ctx}\n\nfacts = ${JSON.stringify(b.facts).slice(0, 8000)}`;
}

export function parisDay(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

async function sha256(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Contrôle d'une réponse : code présent pour generate et repair, aucun chiffre inventé pour explain. */
export function checkReply(task: Task, data: Record<string, unknown>, b: AiBody): string | null {
  if ((task === 'generate' || task === 'repair') && (typeof data.code !== 'string' || !/strategy\s*\(/.test(data.code))) {
    return 'réponse sans script strategy()';
  }
  if (task === 'explain') {
    if (typeof data.text !== 'string' || !data.text.trim()) return 'lecture vide';
    const bad = inventedNumbers(data.text, { facts: b.facts, context: b.context });
    if (bad.length) return `lecture rejetée : chiffre absent de nos mesures (${bad.slice(0, 3).join(', ')})`;
  }
  return null;
}

export async function handleAi(request: Request, env: Env, fetchFn: FetchFn, cfg: SupabaseConfig, now: number, task: string): Promise<Response> {
  if (!(TASKS as readonly string[]).includes(task)) throw new HttpError(404, `tâche inconnue (attendues : ${TASKS.join(', ')})`);
  const problem = await sessionProblem(request, env, now);
  if (problem) throw new HttpError(problem.status, problem.reason);
  if (!sameOriginJson(request)) throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new HttpError(503, 'clé Gemini absente des variables de Vercel');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'demande trop longue (capture de 3 Mo au plus)');
  let body: AiBody;
  try { body = JSON.parse(raw) as AiBody; } catch { throw new HttpError(400, 'corps JSON illisible'); }
  if (body.image && (!/^image\/(png|jpeg|webp)$/.test(body.image.mime) || typeof body.image.data !== 'string')) throw new HttpError(400, 'capture : PNG, JPEG ou WebP en base64');
  const t = task as Task;
  const text = userText(t, body);
  const db: BourseDb = createBourseDb(cfg, fetchFn);
  const day = parisDay(now);
  const hash = await sha256([PROMPT_VERSION, MODEL, t, text, body.image?.data ?? ''].join('\u0000'));
  const hit = await db.select<{ response: Record<string, unknown> }>('bt_ai_cache', { select: 'response', hash: `eq.${hash}`, limit: '1' });
  if (hit[0]) {
    await db.insert('bt_ai_calls', [{ day, route: t, model: MODEL, status: 200, cached: true }]);
    return json({ ok: true, task: t, model: MODEL, cached: true, ...hit[0].response }, NO_STORE);
  }
  const used = await db.count('bt_ai_calls', { day: `eq.${day}`, cached: 'eq.false' });
  if (used >= DAILY_CALLS) throw new HttpError(429, `plafond du terminal atteint : ${DAILY_CALLS} appels à Gemini aujourd’hui (offre gratuite, T-063)`);
  let reply: GeminiReply;
  try {
    reply = await callGemini(fetchFn, key, t, text, body.image);
  } catch (e) {
    const g = e as GeminiError;
    await db.insert('bt_ai_calls', [{ day, route: t, model: MODEL, status: g.status ?? 0, error: String(g.message).slice(0, 300) }]);
    if (g.status === 429) throw new HttpError(429, 'quota gratuit de Google atteint : nouvel essai plus tard (offre gratuite seulement, T-063)');
    throw new HttpError(502, `Gemini : ${g.message}`);
  }
  await db.insert('bt_ai_calls', [{ day, route: t, model: MODEL, status: 200, input_tokens: reply.input_tokens, output_tokens: reply.output_tokens }]);
  const bad = checkReply(t, reply.data, body);
  if (bad) return json({ ok: false, task: t, model: MODEL, reason: bad, calls_today: used + 1, daily_calls: DAILY_CALLS }, NO_STORE);
  try { await db.insert('bt_ai_cache', [{ hash, route: t, model: MODEL, response: reply.data }]); } catch { /* déjà en cache (course) : sans effet */ }
  return json({ ok: true, task: t, model: MODEL, cached: false, ...reply.data, calls_today: used + 1, daily_calls: DAILY_CALLS }, NO_STORE);
}

/** État de l'assistant : clé présente, appels du jour, plafond. */
export async function aiStatus(env: Env, fetchFn: FetchFn, cfg: SupabaseConfig, now: number) {
  const day = parisDay(now);
  const used = await createBourseDb(cfg, fetchFn).count('bt_ai_calls', { day: `eq.${day}`, cached: 'eq.false' });
  return { configured: Boolean(env.GEMINI_API_KEY?.trim()), model: MODEL, calls_today: used, daily_calls: DAILY_CALLS, day, tier: 'gratuite (T-063)' };
}
