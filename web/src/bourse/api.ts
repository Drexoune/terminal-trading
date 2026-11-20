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

// --- Portefeuille (B1) ---------------------------------------------------------------

export interface EnvelopeReply { id: number; kind: string; broker: string; name: string; currency: string; perf_start: string }
export interface LineReply {
  listing_id: number; envelope_ids: number[]; name: string; symbol: string | null; isin: string | null; kind: string | null;
  currency: string | null; quantity: string; pru: string | null; cost: string;
  close: { value: string; date: string; source: string | null; received_at: string | null; stale: boolean } | null;
  value: string | null; weight: number | null; unrealized: string | null; unrealized_pct: number | null; realized: string;
  pea_eligible: boolean | null; pea_reason: string | null; missing_reason: string | null;
}
export interface PeriodReply {
  key: string; label: string; from: string; to: string; days: number; twr: number | null; dietz: number | null;
  irr: number | null; irr_annualized: boolean; benchmarks: { key: string; twr: number | null }[]; reason: string | null;
}
export interface BucketReply { label: string; value: number; pct: number }
export interface PortfolioReply {
  generated_at: string; as_of: string; scope: number | null; perf_start: string; envelopes: EnvelopeReply[];
  summary: {
    value: string | null; partial_value: string; invested: string; unrealized: string | null; day_change: number | null;
    day_change_pct: number | null; day_change_date: string | null; complete: boolean; missing: string[]; costs: number; income: number; transactions: number;
  };
  lines: LineReply[];
  cash: { currency: string; amount: string; value_eur: string | null }[];
  performance: {
    periods: PeriodReply[];
    chart: { date: string; index: number | null; value: number | null }[];
    benchmarks: { key: string; label: string; isin: string; symbol: string | null; reason: string | null; series: { date: string; index: number | null }[] }[];
  };
  risk: {
    days: number; min_days: number; volatility: number | null; max_drawdown: { value: number; peak: string; trough: string } | null;
    reason: string | null; vs: { key: string; label: string; beta: number | null; correlation: number | null; days: number | null }[];
  };
  allocation: {
    total: number; lines: BucketReply[]; currency: BucketReply[]; country: BucketReply[]; sector: BucketReply[];
    sources: { instrument: string; as_of: string; url: string; label: string; stale: boolean }[];
  };
  dividends: { total: number; by_month: { month: string; net: number }[]; items: { date: string; name: string; net: number }[] };
  problems: string[];
}
export interface TransactionReply {
  id: number; envelope_id: number; trade_date: string; kind: string; listing_id: number | null; quantity: string | null; price: string | null;
  amount: string | null; fees: string; taxes: string; currency: string; reference: string | null; batch_id: number | null; source: string;
  symbol: string | null; name: string | null;
}
export interface BatchReply { id: number; envelope_id: number; source: string; file_name: string | null; rows: number; inserted: number; imported_at: string }
export interface ImportIssue { line: number; message: string }
export interface ImportReply {
  envelope: string; rows: number; errors: ImportIssue[]; warnings: ImportIssue[]; dry?: boolean;
  preview: { line: number; trade_date: string; kind: string; listing: string | null; quantity: string | null; price: string | null; amount: string | null; currency: string }[];
  result?: { envelope_id: number; batch_id: number | null; rows: number; inserted: number };
}

const scope = (envelope: number | null) => `envelope=${envelope ?? 'all'}`;
export const getPortfolio = (envelope: number | null) => call<PortfolioReply>(`portfolio?${scope(envelope)}`);
export const getTransactions = (envelope: number | null) => call<{ transactions: TransactionReply[]; batches: BatchReply[] }>(`transactions?${scope(envelope)}`);
export const deleteBatch = (id: number) => call<{ deleted: number }>(`import?batch=${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });

/** Import : à blanc (dry) pour l'aperçu, puis pour de bon. Une réponse 422 porte les erreurs ligne par ligne. */
export async function postImport(body: { kind: string; broker: string; file_name: string; file_sha256: string; rows: unknown[]; dry: boolean }):
  Promise<Result<ImportReply> | { ok: false; status: 422; detail: string; report: ImportReply }> {
  let r: Response;
  try {
    r = await fetch('/api/bourse/import', {
      method: 'POST', credentials: 'same-origin', body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  } catch {
    return { ok: false, status: 0, detail: 'serveur injoignable' };
  }
  const data = await r.json().catch(() => null) as (ImportReply & { detail?: string }) | null;
  if (r.status === 422 && data) return { ok: false, status: 422, detail: `${data.errors.length} erreur(s) dans le fichier`, report: data };
  if (!r.ok || !data) return { ok: false, status: r.status, detail: failureReason(r.status, data?.detail) };
  return { ok: true, data };
}
