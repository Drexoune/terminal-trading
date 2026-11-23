// Alertes (étape E4, plan P1 § 11) : clés alert:rule:<id>, alert:fired:<id> et alert:summary
// publiées par le service « alert » de la passerelle (gateway/terminal_gateway/alert_service.py),
// et les écritures REST /api/alerts/*. Logique pure, testée par Vitest ; les appels réseau
// passent par fetchJson (adresse du mode actif).

import { fetchJson } from '../data/gateway';
import { fmtHm } from '../lib/time';

export type AlertKind = 'price' | 'funding' | 'event_soon' | 'release' | 'surprise' | 'keyword';
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
};

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
  telegram: boolean;
  voice: boolean;
}

export const EMPTY_DRAFT: RuleDraft = {
  kind: 'price', inst: 'BTC-USDT-SWAP', level: '', direction: 'les deux', threshold: '', side: 'au-dessus',
  minutes: '5', capturedOnly: true, impacts: [], currencies: '', release: '', indicator: '', zMin: '', rawMin: '',
  words: '', telegram: true, voice: false,
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
  }
}

// --- écritures ------------------------------------------------------------------------------

const T = { timeoutMs: 8000 };
export const createRule = (body: unknown) => fetchJson<AlertRule>('/api/alerts/rules', { ...T, method: 'POST', json: body });
export const setRuleState = (id: number, state: 'armée' | 'désactivée') =>
  fetchJson<AlertRule>(`/api/alerts/rules/${id}`, { ...T, method: 'PATCH', json: { state } });
export const setRuleChannels = (id: number, channels: Channel[]) =>
  fetchJson<AlertRule>(`/api/alerts/rules/${id}`, { ...T, method: 'PATCH', json: { channels } });
export const deleteRule = (id: number) => fetchJson<{ ok: boolean }>(`/api/alerts/rules/${id}`, { ...T, method: 'DELETE' });
export const ackAlerts = (ids?: string[]) => fetchJson<{ acked: number }>('/api/alerts/ack', { ...T, method: 'POST', json: ids ? { ids } : {} });
export const testTelegram = () => fetchJson<{ ok: boolean; error: string | null }>('/api/alerts/test-telegram', { timeoutMs: 20_000, method: 'POST', json: {} });
