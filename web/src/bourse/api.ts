// Client du module Bourse : routes /api/bourse/* servies par la fonction
// Vercel (ou par Vite en développement), sur l'origine du front. Le cookie de
// session est HttpOnly : le navigateur l'envoie, le code ne le lit jamais.

export const BOURSE_TIMEOUT_MS = 8000;

export interface SessionReply { authenticated: boolean; configured?: boolean; reason?: string; expires_at?: string | null }

export interface RunReply { job: string; started_at: string; finished_at: string; ok: boolean; error: string | null; rows: number; requests: number; note: string | null }
export interface JobReply { job: string; label: string; source: string; next_run: string; last_run: RunReply | null }
export interface CloseReply { value_date: string; close: string; currency: string; source: string; received_at: string }
export interface ListingReply {
  id: number; name: string; isin: string | null; kind: string | null; symbol: string; currency: string;
  price_source: string; source_symbol: string; pea_eligible: boolean | null; pea_reason: string | null; last: CloseReply | null;
}
export interface SourcesReply {
  generated_at: string;
  jobs: JobReply[];
  quota: { source: string; day: string; used: number; max: number | null };
  fx: { pair: string; per_eur: string; value_date: string; received_at: string; source: string } | null;
  listings: ListingReply[];
}

/** Échec lisible : statut HTTP (0 = réseau) et raison en français. */
export interface Failure { ok: false; status: number; detail: string; retryAt?: string }
export type Result<T> = { ok: true; data: T } | Failure;

/** Raison d'un échec, sans jamais inventer de valeur. */
export function failureReason(status: number, detail: string | undefined): string {
  if (status === 0) return detail ?? 'serveur injoignable';
  if (status === 404 && (!detail || /route inconnue : \/api\/bourse/.test(detail))) {
    return 'module Bourse absent de ce serveur : il est servi par le site en ligne (Vercel) ou par npm run dev';
  }
  return detail ?? `HTTP ${status}`;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  let r: Response;
  try {
    r = await fetch(`/api/bourse/${path}`, {
      credentials: 'same-origin', ...init, signal: AbortSignal.timeout(BOURSE_TIMEOUT_MS),
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch (e) {
    return { ok: false, status: 0, detail: e instanceof DOMException && e.name === 'TimeoutError' ? 'délai dépassé' : 'serveur injoignable' };
  }
  let body: unknown = null;
  try { body = await r.json(); } catch { /* réponse non JSON */ }
  if (!r.ok) {
    const b = (body ?? {}) as { detail?: unknown; retry_at?: unknown };
    return { ok: false, status: r.status, detail: failureReason(r.status, typeof b.detail === 'string' ? b.detail : undefined),
      ...(typeof b.retry_at === 'string' ? { retryAt: b.retry_at } : {}) };
  }
  if (body === null) return { ok: false, status: r.status, detail: 'réponse illisible' };
  return { ok: true, data: body as T };
}

export const getSession = () => call<SessionReply>('session');
export const login = (password: string) => call<SessionReply>('session', { method: 'POST', body: JSON.stringify({ password }) });
export const logout = () => call<SessionReply>('session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
export const getSources = () => call<SourcesReply>('sources');
