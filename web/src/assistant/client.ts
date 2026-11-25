// Client de l'assistant (P6, T-074) : /api/p1/assistant et /api/p1/translate (fonction Vercel,
// même origine, session du mot de passe d'application). La réponse est contrôlée côté serveur ;
// le front la recontrôle contre les mêmes faits avant de l'afficher (défense en profondeur).

import { verifyAnswer, type Fact } from '../../../api/_lib/assistant-core';

export interface AskReply { ok: boolean; answer?: string; sources?: string[]; reason?: string; cached?: boolean; calls_today?: number; cap?: number }
export interface TranslateReply { ok: boolean; title?: string; body?: string; reason?: string; cached?: boolean }

export class AssistantError extends Error { constructor(readonly status: number, message: string) { super(message); } }

type Fetcher = typeof fetch;

async function call<T>(path: string, body: unknown, f: Fetcher = fetch): Promise<T> {
  const r = await f(`/api/p1/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new AssistantError(r.status, `réponse illisible (HTTP ${r.status})`); }
  if (!r.ok) throw new AssistantError(r.status, (data as { detail?: string }).detail ?? `HTTP ${r.status}`);
  return data as T;
}

/** Question à l'assistant ; une réponse qui ne passe pas le contrôle local est refusée. */
export async function ask(question: string, facts: Fact[], f?: Fetcher): Promise<AskReply> {
  const r = await call<AskReply>('assistant', { question, facts }, f);
  if (!r.ok || !r.answer) return r;
  const v = verifyAnswer(r.answer, r.sources ?? [], facts, question);
  return v.ok ? r : { ok: false, reason: `réponse écartée : ${v.reason}` };
}

export const translate = (title: string, summary: string | null, f?: Fetcher) => call<TranslateReply>('translate', { title, summary: summary ?? '' }, f);
