// Assistant de P6 (T-074), dans la fonction Vercel p1 (12 fonctions : jamais une 13e) :
//   POST /api/p1/assistant   { question, facts }  → { answer, sources } contrôlée
//   POST /api/p1/translate   { title, summary }   → { title, body } (traduction à la demande)
// Gemini en offre gratuite seulement (T-063) ; session du mot de passe d'application (T-031) ;
// plafond par usage et par jour de Paris (bt_ai_calls, route = tâche) ; cache (bt_ai_cache).
// Une réponse dont un nombre n'est pas dans un fait cité est réécrite une fois, puis écartée et
// journalisée (relue pour la porte de P6).

import { createBourseDb, type BourseDb } from './bourse/db.js';
import { sameOriginJson } from './bourse/auth.js';
import { sessionProblem } from './bourse/routes.js';
import { HttpError, json, NO_STORE, type Env } from './http.js';
import type { FetchFn } from './okx.js';
import type { SupabaseConfig } from './supabase.js';
import { callGeminiWith, GeminiError, MODEL, parisDay, type GeminiReply } from './gemini-pine.js';
import { cleanFacts, DAILY_CAPS, factsText, NO_DATA, PROMPTS, QUESTION_MAX, verifyAnswer, type AssistantTask, type Fact } from './assistant-core.js';

export const PROMPT_VERSION = 'assistant-1';
const MAX_BODY = 512 * 1024;
type Task = Extract<AssistantTask, 'ask' | 'translate'>;

async function sha256(s: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Demande envoyée à Gemini, et faits contre lesquels la réponse est contrôlée. */
export function buildRequest(task: Task, body: Record<string, unknown>): { text: string; facts: Fact[]; question: string } {
  if (task === 'ask') {
    const question = String(body.question ?? '').trim();
    if (!question) throw new HttpError(400, 'question vide');
    if (question.length > QUESTION_MAX) throw new HttpError(400, `question trop longue (${QUESTION_MAX} caractères au plus)`);
    const facts = cleanFacts(body.facts);
    return { text: `Question : ${question}\n\nfacts :\n${factsText(facts) || '(aucun fait)'}`, facts, question };
  }
  const title = String(body.title ?? '').trim().slice(0, 600);
  const summary = String(body.summary ?? '').trim().slice(0, 4000);
  if (!title) throw new HttpError(400, 'titre à traduire absent');
  // La traduction ne doit contenir que les nombres du texte d'origine.
  return { text: `Titre : ${title}${summary ? `\n\nTexte : ${summary}` : ''}`, facts: [{ id: 'F1', label: 'texte d’origine', value: `${title} ${summary}`, source: 'article', at_ms: null, href: null }], question: '' };
}

/** Contrôle d'une réponse de Gemini selon la tâche. */
export function check(task: Task, data: Record<string, unknown>, req: { facts: Fact[]; question: string }): { ok: true } | { ok: false; reason: string } {
  if (task === 'ask') {
    if (typeof data.answer !== 'string' || !data.answer.trim()) return { ok: false, reason: 'réponse vide' };
    const sources = Array.isArray(data.sources) ? data.sources.map(String) : [];
    const v = verifyAnswer(data.answer, sources, req.facts, req.question);
    return v.ok ? { ok: true } : { ok: false, reason: v.reason ?? 'réponse invalide' };
  }
  if (typeof data.title !== 'string' || !data.title.trim()) return { ok: false, reason: 'traduction vide' };
  const v = verifyAnswer(`${data.title} ${data.body ?? ''}`, ['F1'], req.facts);
  return v.ok ? { ok: true } : { ok: false, reason: v.reason ?? 'traduction invalide' };
}

export async function handleAssistant(request: Request, env: Env, fetchFn: FetchFn, cfg: SupabaseConfig, now: number, task: Task): Promise<Response> {
  const problem = await sessionProblem(request, env, now);
  if (problem) throw new HttpError(problem.status, problem.reason);
  if (!sameOriginJson(request)) throw new HttpError(403, 'requête refusée : même origine et corps JSON exigés');
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new HttpError(503, 'clé Gemini absente des variables de Vercel');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'demande trop longue');
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { throw new HttpError(400, 'corps JSON illisible'); }
  const req = buildRequest(task, body);
  const db: BourseDb = createBourseDb(cfg, fetchFn);
  const day = parisDay(now);
  const cap = DAILY_CAPS[task];
  const hash = await sha256([PROMPT_VERSION, MODEL, task, req.text].join('\u0000'));
  const hit = await db.select<{ response: Record<string, unknown> }>('bt_ai_cache', { select: 'response', hash: `eq.${hash}`, limit: '1' });
  if (hit[0]) {
    await db.insert('bt_ai_calls', [{ day, route: task, model: MODEL, status: 200, cached: true }]);
    return json({ ok: true, task, model: MODEL, cached: true, ...hit[0].response }, NO_STORE);
  }
  const usedBefore = await db.count('bt_ai_calls', { day: `eq.${day}`, cached: 'eq.false', route: `eq.${task}` });
  if (usedBefore >= cap) throw new HttpError(429, `plafond atteint : ${cap} appels à Gemini aujourd’hui pour ${task === 'ask' ? 'l’assistant' : 'la traduction'} (offre gratuite, T-074)`);

  let used = usedBefore;
  let text = req.text;
  let verdict: { ok: true } | { ok: false; reason: string } = { ok: false, reason: 'aucun appel' };
  let reply: GeminiReply | null = null;
  for (let attempt = 0; attempt < 2 && used < cap; attempt++) {
    try {
      reply = await callGeminiWith(fetchFn, key, PROMPTS[task], text);
    } catch (e) {
      const g = e as GeminiError;
      await db.insert('bt_ai_calls', [{ day, route: task, model: MODEL, status: g.status ?? 0, error: String(g.message).slice(0, 300) }]);
      if (g.status === 429) throw new HttpError(429, 'quota gratuit de Google atteint : nouvel essai plus tard (offre gratuite seulement, T-074)');
      throw new HttpError(502, `Gemini : ${g.message}`);
    }
    used++;
    verdict = check(task, reply.data, req);
    await db.insert('bt_ai_calls', [{ day, route: task, model: MODEL, status: verdict.ok ? 200 : 422, input_tokens: reply.input_tokens, output_tokens: reply.output_tokens,
      error: verdict.ok ? null : `écartée : ${verdict.reason}`.slice(0, 300) }]);
    if (verdict.ok) break;
    text = `${req.text}\n\nTa réponse précédente a été écartée (${verdict.reason}). Réécris-la en recopiant exactement les nombres des faits cités, sans aucun calcul, ou réponds « ${NO_DATA} ».`;
  }
  if (!verdict.ok || !reply) {
    return json({ ok: false, task, model: MODEL, reason: `réponse écartée : ${verdict.ok ? 'plafond atteint' : verdict.reason}`, calls_today: used, cap }, NO_STORE);
  }
  try { await db.insert('bt_ai_cache', [{ hash, route: task, model: MODEL, response: reply.data }]); } catch { /* déjà en cache (course) */ }
  return json({ ok: true, task, model: MODEL, cached: false, ...reply.data, calls_today: used, cap }, NO_STORE);
}
