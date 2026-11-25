// Alertes (étape E4, plan P1 § 11) : clés alert:rule:<id>, alert:fired:<id> et alert:summary
// publiées par le service « alert » de la passerelle (gateway/terminal_gateway/alert_service.py),
// et les écritures REST /api/alerts/*. Logique pure, testée par Vitest ; les appels réseau
// passent par fetchJson (adresse du mode actif).

import { fetchJson } from '../data/gateway';
import { refreshAlertsAfterWrite } from '../data/online/alerts';
import { fmtHm } from '../lib/time';

export type AlertKind = 'price' | 'funding' | 'event_soon' | 'release' | 'surprise' | 'keyword' | 'event_watch' | 'news_category' | 'rate_gap' | 'liquidations' | 'wall';
export type AlertState = 'armée' | 'déclenchée' | 'désactivée';
export type Channel = 'écran' | 'telegram' | 'voix';

export interface AlertRule {
  id: number;
  kind: AlertKind;
  params: Record<string, unknown>;
  channels: Channel[];
  state: AlertState;
  label: string;          // « BTC franchit 110 000 »
  category: string;       // « Prix · OKX »
  created_ms: number;
  updated_ms: number;
  last_fired_ms: number | null;
}

export interface AlertEvent {
  id: string;
  rule_id: number;
  kind: AlertKind | null;
  rule_label: string | null;
  category: string | null;
  fired_ms: number;
  title: string;
  body: string | null;
  source: string | null;
  source_ms: number | null;
  data: Record<string, unknown>;
  telegram: 'en attente' | 'envoyé' | 'échec' | 'non configuré' | null;
  telegram_ms: number | null;
  telegram_error: string | null;
  acked_ms: number | null;
  voice: boolean;
}

export interface TelegramHealth { configured: boolean; last_ok: boolean | null; last_ms: number | null; last_error: string | null }

export interface AlertSummary {
  rules: number;
  armed: number;
  unacked: number;
  last_fired_ms: number | null;
  telegram: TelegramHealth | null;
  computed_ms: number;
}

export const KIND_LABEL: Record<AlertKind, string> = {
  price: 'Prix OKX', funding: 'Funding OKX', event_soon: 'Avant une publication',
  release: 'Chiffre publié', surprise: 'Surprise', keyword: 'Mot-clé (fil d’actus)',
  event_watch: 'Réel d’un événement (cloche du calendrier)', news_category: 'Catégorie du fil d’actus',
  rate_gap: 'Écart entre sources (Taux)',
  liquidations: 'Liquidations (microstructure)', wall: 'Mur retiré (microstructure)',
};

/** Banques de l'écran Taux (règle rate_gap) ; '' : toutes. */
export const GAP_BANKS = ['', 'FED', 'BCE', 'BOE', 'BOJ', 'BNS', 'BOC', 'RBA', 'RBNZ'] as const;

/** Une règle récurrente (agenda, chiffres, mots-clés) reste armée : on montre son dernier déclenchement récent. */
export const RECENT_FIRE_MS = 30 * 60_000;

export function ruleChip(r: AlertRule, now: number): { text: string; variant: 'armed' | 'fired' | 'off' } {
  if (r.state === 'désactivée') return { text: 'Désactivée', variant: 'off' };
  const recent = r.last_fired_ms !== null && now - r.last_fired_ms < RECENT_FIRE_MS;
  if (r.state === 'déclenchée' || recent) {
    return { text: `Déclenchée ${r.last_fired_ms ? fmtHm(r.last_fired_ms, 'Europe/Paris') : ''}`.trim(), variant: 'fired' };
  }
  return { text: 'Armée', variant: 'armed' };
}

/** Règles : déclenchées d'abord, puis armées, puis désactivées ; à état égal, les plus récentes. */
export function sortRules(rules: AlertRule[]): AlertRule[] {
  const rank = { déclenchée: 0, armée: 1, désactivée: 2 } as const;
  return [...rules].sort((a, b) => rank[a.state] - rank[b.state] || (b.last_fired_ms ?? 0) - (a.last_fired_ms ?? 0) || b.id - a.id);
}

export function sortEvents(events: AlertEvent[]): AlertEvent[] {
  return [...events].sort((a, b) => b.fired_ms - a.fired_ms);
}

export function unacked(events: AlertEvent[], now: number): AlertEvent[] {
  return events.filter((e) => !e.acked_ms && now - e.fired_ms < 86_400_000);
}

export function telegramText(e: AlertEvent): string | null {
  switch (e.telegram) {
    case null: return null;
    case 'envoyé': return `Telegram : envoyé${e.telegram_ms ? ` à ${fmtHm(e.telegram_ms, 'Europe/Paris')}` : ''}`;
    case 'échec': return `Telegram : échec (${e.telegram_error ?? 'raison inconnue'})`;
    case 'non configuré': return 'Telegram : non configuré sur la passerelle';
    default: return 'Telegram : en attente';
  }
}

// --- machine Oracle (T-071) -----------------------------------------------------------------

/** Battement de cœur de terminal-alerts (server/alerts/main.ts), toutes les 30 s. */
export interface OracleAlerts { ok: boolean; at: number; armed: number; fired: number; ws: { status: string; reconnects: number; last_error: string | null } | null;
  last_trade_ms: Record<string, number>; micro_stream: { connected: boolean; error: string | null } }

/** Qui juge les prix : Oracle à la seconde si son battement a moins de 90 s et sa WebSocket est connectée, sinon Supabase à la minute. */
export function judgeOf(o: OracleAlerts | undefined, now: number): { text: string; live: boolean; title: string } {
  if (o && now - o.at < 90_000 && o.ok) {
    return { text: 'Prix · Oracle à la seconde', live: true,
      title: `Machine Oracle : trades OKX en direct, ${o.armed} règle(s) armée(s), microstructure ${o.micro_stream.connected ? 'reçue' : `injoignable (${o.micro_stream.error ?? '—'})`} (T-071)` };
  }
  return { text: 'Prix · Supabase à la minute', live: false,
    title: o ? `Machine Oracle muette depuis ${Math.round((now - o.at) / 1000)} s ou WebSocket coupée : repli Supabase (bougies 1 min, 2 à 3 min de retard) ; liquidations et murs retirés en pause`
      : 'Machine Oracle jamais vue : alertes de prix à la minute (Supabase) ; liquidations et murs retirés indisponibles' };
}

// --- formulaire de création --------------------------------------------------------------

export interface RuleDraft {
  kind: AlertKind;
  inst: string;
  level: string;
  direction: 'hausse' | 'baisse' | 'les deux';
  threshold: string;
  side: 'au-dessus' | 'en dessous';
  minutes: string;
  capturedOnly: boolean;
  impacts: string[];
  currencies: string;
  release: string;           // '' : toutes
  indicator: string;         // '' : tous
  zMin: string;
  rawMin: string;
  words: string;
  gapBank: string;           // '' : toutes les banques
  gapPts: string;            // seuil d'écart en points
  liqUsd: string;            // liquidations : montant en M$ (T-071)
  liqWindow: string;         // liquidations : fenêtre en minutes
  liqSide: 'long' | 'short' | 'les deux';
  wallBtc: string;           // mur retiré : taille minimale en BTC
  wallSide: 'achat' | 'vente' | 'les deux';
  telegram: boolean;
  voice: boolean;
}

export const EMPTY_DRAFT: RuleDraft = {
  kind: 'price', inst: 'BTC-USDT-SWAP', level: '', direction: 'les deux', threshold: '', side: 'au-dessus',
  minutes: '5', capturedOnly: true, impacts: [], currencies: '', release: '', indicator: '', zMin: '', rawMin: '',
  words: '', gapBank: 'FED', gapPts: '5', liqUsd: '10', liqWindow: '5', liqSide: 'les deux', wallBtc: '200', wallSide: 'les deux',
  telegram: true, voice: false,
};

/** Saisie à la française (« 110 000,5 ») -> texte décimal (« 110000.5 ») ; null si illisible. */
export function parseDecimal(s: string): string | null {
  const t = s.replace(/[\s  ]/g, '').replace(',', '.').replace('−', '-');
  return /^-?\d+(\.\d+)?$/.test(t) ? t : null;
}

/** Corps de POST /api/alerts/rules, ou la raison pour laquelle le formulaire est incomplet. */
export function draftToBody(d: RuleDraft): { body: { kind: AlertKind; params: Record<string, unknown>; channels: Channel[] } } | { error: string } {
  const channels: Channel[] = ['écran', ...(d.telegram ? ['telegram' as const] : []), ...(d.voice ? ['voix' as const] : [])];
  const wrap = (params: Record<string, unknown>) => ({ body: { kind: d.kind, params, channels } });
  switch (d.kind) {
    case 'price': {
      const level = parseDecimal(d.level);
      if (!level || Number(level) <= 0) return { error: 'Prix : saisir un niveau positif.' };
      return wrap({ inst: d.inst, level, direction: d.direction });
    }
    case 'funding': {
      const thr = parseDecimal(d.threshold);
      if (thr === null) return { error: 'Funding : saisir un seuil en %.' };
      return wrap({ inst: d.inst, threshold_pct: thr, side: d.side });
    }
    case 'event_soon': {
      const minutes = Number(d.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { error: 'Minutes : de 1 à 120.' };
      const currencies = d.currencies.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
      return wrap({ minutes, captured_only: d.capturedOnly, impacts: d.impacts, currencies });
    }
    case 'release':
      return wrap({ releases: d.release ? [d.release] : [] });
    case 'surprise': {
      const z = d.zMin ? parseDecimal(d.zMin) : null;
      const raw = d.rawMin ? parseDecimal(d.rawMin) : null;
      if ((d.zMin && !z) || (d.rawMin && !raw) || (!z && !raw)) return { error: 'Surprise : saisir un seuil |z| ou une surprise brute.' };
      return wrap({ indicator: d.indicator || null, z_min: z, raw_min: raw });
    }
    case 'keyword': {
      const words = d.words.split(',').map((w) => w.trim()).filter(Boolean);
      if (!words.length) return { error: 'Mots-clés : au moins un, séparés par des virgules.' };
      return wrap({ words });
    }
    case 'rate_gap': {
      const pts = parseDecimal(d.gapPts);
      if (!pts || Number(pts) <= 0 || Number(pts) > 50) return { error: 'Écart : saisir un seuil de 0 à 50 points.' };
      return wrap({ bank: d.gapBank || null, threshold_pts: pts });
    }
    case 'liquidations': {
      const m = parseDecimal(d.liqUsd), w = Number(d.liqWindow);
      if (!m || Number(m) < 0.1) return { error: 'Liquidations : saisir un montant d’au moins 0,1 M$.' };
      if (!Number.isInteger(w) || w < 1 || w > 60) return { error: 'Liquidations : fenêtre de 1 à 60 minutes.' };
      return wrap({ min_usd: String(Math.round(Number(m) * 1e6)), window_min: w, side: d.liqSide });
    }
    case 'wall': {
      const b = parseDecimal(d.wallBtc);
      if (!b || Number(b) < 10) return { error: 'Mur retiré : saisir une taille d’au moins 10 BTC.' };
      return wrap({ min_btc: b, side: d.wallSide });
    }
    default:
      return { error: 'Cette alerte se crée depuis son écran : cloche du Calendrier, ou « Alertes Telegram » du fil d’actus.' };
  }
}

/** Sortes proposées dans le formulaire de /alertes (les autres se posent depuis leur écran). */
export const FORM_KINDS: AlertKind[] = ['price', 'funding', 'event_soon', 'release', 'surprise', 'keyword', 'rate_gap', 'liquidations', 'wall'];

// --- écritures ------------------------------------------------------------------------------

const T = { timeoutMs: 8000 };
/** En Mode Online, l'état ne vient pas d'un bus : relu juste après chaque écriture. */
const after = <R>(p: Promise<R>): Promise<R> => p.then((r) => { refreshAlertsAfterWrite(); return r; });
export const createRule = (body: unknown) => after(fetchJson<AlertRule>('/api/alerts/rules', { ...T, method: 'POST', json: body }));
export const setRuleState = (id: number, state: 'armée' | 'désactivée') =>
  after(fetchJson<AlertRule>(`/api/alerts/rules/${id}`, { ...T, method: 'PATCH', json: { state } }));
export const setRuleChannels = (id: number, channels: Channel[]) =>
  after(fetchJson<AlertRule>(`/api/alerts/rules/${id}`, { ...T, method: 'PATCH', json: { channels } }));
export const deleteRule = (id: number) => after(fetchJson<{ ok: boolean }>(`/api/alerts/rules/${id}`, { ...T, method: 'DELETE' }));
export const ackAlerts = (ids?: string[]) => after(fetchJson<{ acked: number }>('/api/alerts/ack', { ...T, method: 'POST', json: ids ? { ids } : {} }));
export const testTelegram = () => after(fetchJson<{ ok: boolean; error: string | null }>('/api/alerts/test-telegram', { timeoutMs: 30_000, method: 'POST', json: {} }));
