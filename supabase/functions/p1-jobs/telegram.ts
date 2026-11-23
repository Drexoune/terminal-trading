// Envoi Telegram depuis Supabase (plan « Tout en ligne », O4 ; décision T-020) : portage de
// gateway/terminal_gateway/telegram.py. POST JSON sur https://api.telegram.org/bot<jeton>/sendMessage
// (documentation officielle relue le 23/11/2026) ; au plus un message par seconde dans la
// conversation, attente de retry_after sur 429 (60 s au plus), un nouvel essai sur panne réseau.
// Le jeton n'apparaît jamais dans une erreur ni en base.

export const TELEGRAM_API = 'https://api.telegram.org';
const SPACING_MS = 1100;
const MAX_WAIT_S = 60;

export interface TgDeps {
  fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  env: (name: string) => string | undefined;
}

export interface TgResult { ok: boolean; error: string | null; sent_ms: number }

let lastSend = 0;

export function telegramConfigured(env: TgDeps['env']): boolean {
  return !!(env('TELEGRAM_BOT_TOKEN')?.trim() && env('TELEGRAM_CHAT_ID')?.trim());
}

export async function sendTelegram(deps: TgDeps, text: string): Promise<TgResult> {
  const token = deps.env('TELEGRAM_BOT_TOKEN')?.trim();
  const chat = deps.env('TELEGRAM_CHAT_ID')?.trim();
  if (!token || !chat) return { ok: false, error: 'TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID absent des secrets', sent_ms: deps.now() };
  const scrub = (s: string) => s.split(token).join('<jeton>');
  const body = JSON.stringify({ chat_id: chat, text: text.slice(0, 4096), disable_notification: false, link_preview_options: { is_disabled: true } });
  let result: TgResult = { ok: false, error: 'aucun essai', sent_ms: deps.now() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastSend + SPACING_MS - deps.now();
    if (wait > 0) await deps.sleep(wait);
    let status: number | null = null;
    let doc: { ok?: boolean; description?: string; parameters?: { retry_after?: number } } | null = null;
    try {
      const r = await deps.fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
      status = r.status;
      doc = JSON.parse(new TextDecoder().decode(await r.arrayBuffer()));
    } catch (e) {
      result = { ok: false, error: scrub(`réseau : ${(e as Error).name}`), sent_ms: deps.now() };
    }
    lastSend = deps.now();
    if (doc?.ok) return { ok: true, error: null, sent_ms: deps.now() };
    if (doc) result = { ok: false, error: scrub(String(doc.description ?? `HTTP ${status}`)).slice(0, 200), sent_ms: deps.now() };
    const retry = doc?.parameters?.retry_after;
    if (status === 429 && typeof retry === 'number' && retry <= MAX_WAIT_S) { await deps.sleep(retry * 1000); continue; }
    if (status === null) { await deps.sleep(2000); continue; }
    break;
  }
  return result;
}
