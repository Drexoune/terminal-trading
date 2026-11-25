// Lecture de l'état de la microstructure pour l'écran (P5, S3) : fraîcheur des flux par panneau,
// regroupement par plateforme pour la barre de flux, comptes à rebours, couleurs de la carte.
// Fonctions pures, testées ; aucune valeur inventée (« — » avec la raison).

import { freshness, type Freshness } from '../data/latency';
import { fmtDuration, NBSP } from '../lib/format';
import { fmtHms } from '../lib/time';
import type { MicroFeedState } from './stream';
import { VENUE_LABEL, type Venue } from './types';

export const FRESH_LABEL: Record<Freshness, string> = { live: 'direct', late: 'en retard', stale: 'périmé', down: 'coupé' };

export function microFreshness(f: MicroFeedState | undefined, now: number): Freshness {
  if (!f || f.status !== 'connected') return 'down';
  return freshness(f.last_message_ms != null ? now - f.last_message_ms : null, true, f.late_after_ms, f.stale_after_ms);
}

const RANK: Record<Freshness, number> = { live: 0, late: 1, stale: 2, down: 3 };
export const worst = (states: Freshness[]): Freshness => states.reduce<Freshness>((w, s) => (RANK[s] > RANK[w] ? s : w), 'live');

/** Flux par plateforme (noms des VenueStream). */
export const VENUE_FEEDS: Record<Venue, string[]> = {
  okx: ['okx-micro'], binance: ['binance-book', 'binance-perp', 'binance-spot'], bybit: ['bybit'], hyperliquid: ['hyperliquid'], coinbase: ['coinbase'],
};

/** Flux dont dépend chaque panneau. */
export const PANEL_FEEDS = {
  book: ['okx-micro', 'binance-book', 'bybit', 'hyperliquid'],
  depth: ['okx-micro', 'binance-book', 'binance-perp', 'bybit', 'hyperliquid'],
  cvd: ['okx-micro', 'binance-perp', 'binance-spot', 'bybit', 'hyperliquid', 'coinbase'],
  liqs: ['okx-micro', 'binance-perp', 'bybit'],
  funding: ['okx-micro', 'binance-perp', 'bybit', 'hyperliquid'],
} as const;

export interface PanelFresh { state: Freshness; text: string; title: string; last: number | null }

/** Puce d'un panneau : « Direct · 14:02:11 » ou « Binance WS (carnet) coupé · … ». */
export function panelFresh(names: readonly string[], feeds: Map<string, MicroFeedState>, now: number): PanelFresh {
  const rows = names.map((n) => ({ n, f: feeds.get(n), s: microFreshness(feeds.get(n), now) }));
  const state = worst(rows.map((r) => r.s));
  const last = Math.max(0, ...rows.map((r) => r.f?.last_message_ms ?? 0)) || null;
  const bad = rows.filter((r) => r.s !== 'live');
  const at = last ? fmtHms(last, 'Europe/Paris') : '—';
  const plural: Record<Freshness, string> = { live: 'en direct', late: 'en retard', stale: 'périmés', down: 'coupés' };
  const text = !feeds.size ? 'Connexion aux plateformes…'
    : !bad.length ? `Direct · màj ${at}`
      : bad.length === 1 ? `${bad[0].f?.label ?? bad[0].n} ${FRESH_LABEL[bad[0].s]} · màj ${at}`
        : `${bad.length} flux ${plural[worst(bad.map((r) => r.s))]} · màj ${at}`;
  const title = rows.map((r) => `${r.f?.label ?? r.n} : ${FRESH_LABEL[r.s]}${r.f?.last_error ? ` (${r.f.last_error})` : ''}`).join('\n');
  return { state, text, title, last };
}

/** Barre de flux : une pastille par plateforme, état le plus dégradé de ses flux. */
export function venueDots(feeds: Map<string, MicroFeedState>, now: number): { venue: Venue; label: string; state: Freshness; detail: string }[] {
  const out: { venue: Venue; label: string; state: Freshness; detail: string }[] = [];
  for (const [v, names] of Object.entries(VENUE_FEEDS) as [Venue, string[]][]) {
    const fs = names.map((n) => feeds.get(n)).filter((f): f is MicroFeedState => !!f);
    if (!fs.length) continue;
    const state = worst(fs.map((f) => microFreshness(f, now)));
    const detail = fs.map((f) => {
      const st = microFreshness(f, now);
      const o = f.outages[f.outages.length - 1];
      return [`${f.label} : ${FRESH_LABEL[st]}`, `${f.reconnects} reconnexion(s)`,
        o ? `dernière coupure ${fmtHms(o.from_ms, 'Europe/Paris')}, ${fmtDuration(o.duration_ms)}` : null,
        f.gaps.length ? `${f.gaps.length} trou(s), dernier ${fmtHms(f.gaps[f.gaps.length - 1].at_ms, 'Europe/Paris')}` : null,
        f.last_error ? `erreur : ${f.last_error}` : null].filter(Boolean).join(' · ');
    }).join('\n');
    out.push({ venue: v, label: `${VENUE_LABEL[v]} WS${v === 'okx' ? ' (micro)' : ''}`, state, detail });
  }
  return out;
}

/** « dans 2 h 24 », « dans 24 min », « dans 40 s ». */
export function countdown(target: number | null, now: number): string {
  if (target === null) return '—';
  const s = Math.max(0, Math.round((target - now) / 1000));
  if (s < 60) return `dans ${s}${NBSP}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `dans ${m}${NBSP}min`;
  return `dans ${Math.floor(m / 60)}${NBSP}h${NBSP}${String(m % 60).padStart(2, '0')}`;
}

/** Niveau d'or d'une cellule de la carte (0 : rien) selon les seuils publiés. */
export function depthLevel(sz: number, levels: number[]): 0 | 1 | 2 | 3 | 4 {
  if (!levels.length || sz <= 0) return 0;
  if (sz >= levels[3]) return 4;
  if (sz >= levels[2]) return 3;
  if (sz >= levels[1]) return 2;
  if (sz >= levels[0]) return 1;
  return 0;
}

/** Graduations d'un axe de prix : `n` valeurs rondes dans [lo, hi]. */
export function priceTicks(lo: number, hi: number, n = 3): number[] {
  if (!(hi > lo)) return [];
  const raw = (hi - lo) / (n + 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
