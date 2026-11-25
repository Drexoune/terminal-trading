// Évaluateurs purs des alertes jugées sur la machine Oracle (T-071).
//
// - Prix : franchissement entre deux trades consécutifs (ar.priceCrossed) ; clé de dédoublonnage =
//   minute du trade au format que PostgREST renvoie pour okx_candles_1m.t (« …T17:42:00+00:00 »),
//   la même que la tâche alerts de Supabase : les deux machines ne peuvent pas doubler une alerte.
// - Liquidations : somme sur une fenêtre glissante (lignes de micro:liqs, doublons écartés) ; au
//   plus une alerte par tranche de fenêtre ; la règle reste armée.
// - Mur retiré : chaque mur de micro:depth.walls une seule fois ; la règle reste armée.

import * as ar from '../../supabase/functions/p1-jobs/alert_rules';
import type { Rule } from '../../supabase/functions/p1-jobs/alerts';

export interface Fire { rule: Rule; dedupe: string; title: string; body: string; source: string; sourceMs: number; data: Record<string, unknown>; newState: string | null }

/** Minute d'un instant au format de PostgREST pour okx_candles_1m.t. */
export const minuteKey = (ms: number) => `${new Date(Math.floor(ms / 60_000) * 60_000).toISOString().slice(0, 19)}+00:00`;

const hmParis = (ms: number, seconds = false) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(ms);

export class PriceJudge {
  private prev = new Map<string, number>();

  /** Un trade ; renvoie les règles de prix franchies (armées, même instrument). */
  onTrade(inst: string, px: number, ts: number, rules: Rule[]): Fire[] {
    const prev = this.prev.get(inst) ?? null;
    this.prev.set(inst, px);
    if (prev === null) return [];
    const out: Fire[] = [];
    for (const r of rules) {
      if (r.kind !== 'price' || r.state !== 'armée' || r.params.inst !== inst) continue;
      if (!ar.priceCrossed(r.params, prev, px)) continue;
      const [title] = ar.priceMessage(r.params, prev, px);
      out.push({ rule: r, dedupe: minuteKey(ts), title,
        body: `Trade de ${hmParis(ts, true)} (Paris) à ${ar.frNum(String(px))} ; trade précédent ${ar.frNum(String(prev))} · OKX, jugé sur chaque trade (machine Oracle)`,
        source: `OKX · trade de ${hmParis(ts, true)}`, sourceMs: ts, data: { px, prev }, newState: 'déclenchée' });
    }
    return out;
  }
}

export interface LiqRow { venue: string; ts: number; side: 'long' | 'short'; px: number; sz: number; usd: number }

export class LiqWindow {
  private rows: LiqRow[] = [];
  private seen = new Set<string>();

  add(rows: LiqRow[]): void {
    for (const l of rows) {
      const k = `${l.venue}|${l.ts}|${l.px}|${l.sz}`;
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      this.rows.push(l);
    }
  }

  prune(now: number, keepMs = 3_600_000): void {
    const cut = now - keepMs;
    if (!this.rows.some((l) => l.ts < cut)) return;
    this.rows = this.rows.filter((l) => l.ts >= cut);
    this.seen = new Set(this.rows.map((l) => `${l.venue}|${l.ts}|${l.px}|${l.sz}`));
  }

  judge(now: number, rules: Rule[]): Fire[] {
    this.prune(now);
    const out: Fire[] = [];
    for (const r of rules) {
      if (r.kind !== 'liquidations' || r.state !== 'armée') continue;
      const win = Number(r.params.window_min) * 60_000;
      const side = r.params.side as string;
      const hit = this.rows.filter((l) => l.ts > now - win && (side === 'les deux' || l.side === side));
      const total = hit.reduce((s, l) => s + l.usd, 0);
      if (total < Number(r.params.min_usd)) continue;
      const byVenue: Record<string, number> = {};
      for (const l of hit) byVenue[l.venue] = (byVenue[l.venue] ?? 0) + l.usd;
      const [title, body] = ar.liquidationsMessage(r.params, total, byVenue, hit.length);
      out.push({ rule: r, dedupe: `liq:${Math.floor(now / win)}`, title, body: `${body} · machine Oracle`,
        source: 'Microstructure · liquidations observées', sourceMs: Math.max(...hit.map((l) => l.ts)), data: { total, by_venue: byVenue, count: hit.length }, newState: null });
    }
    return out;
  }
}

export interface WallSeen { t: number; px: number; sz: number; side: 'bid' | 'ask'; left: number }

export function judgeWalls(walls: WallSeen[], rules: Rule[]): Fire[] {
  const out: Fire[] = [];
  for (const r of rules) {
    if (r.kind !== 'wall' || r.state !== 'armée') continue;
    const side = r.params.side as string;
    for (const w of walls) {
      if (w.sz < Number(r.params.min_btc)) continue;
      if (side === 'achat' && w.side !== 'bid') continue;
      if (side === 'vente' && w.side !== 'ask') continue;
      const [title, body] = ar.wallMessage(w, hmParis(w.t));
      out.push({ rule: r, dedupe: `wall:${w.t}|${w.px}`, title, body: `${body} · machine Oracle`, source: 'Microstructure · carnet agrégé',
        sourceMs: w.t, data: { ...w }, newState: null });
    }
  }
  return out;
}
