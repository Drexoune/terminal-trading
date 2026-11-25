// Récap de séance (P6, S4, T-074) : fenêtres des séances (fuseaux IANA, jamais d'heure UTC en
// dur), registre de 24 h tenu par la machine Oracle (CVD minute par minute, liquidations, murs
// retirés) et faits de la séance calculés par le code. Gemini n'écrit que la lecture, en citant
// ces faits (contrôleur d'api/_lib/assistant-core.ts). Module pur, partagé par server/recap et
// l'écran /recap.

import type { Fact } from '../../../api/_lib/assistant-core';
import { fmtNumber, fmtPctChange, fmtSigned, fmtUsdCompact, NBSP } from '../lib/format';
import { fmtHm, SESSIONS, zonedParts, zonedToUtc, type SessionDef } from '../lib/time';

export const RECAP_PREFIX = 'recap:';
export const LEDGER_MS = 26 * 3_600_000;
const MIN = 60_000;

export interface Window { session: SessionDef['id']; label: string; date: string; from: number; to: number }

const ymd = (p: { y: number; m: number; d: number }) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

/** Fenêtre d'une séance pour une date locale de son fuseau (« 2026-11-25 »). */
export function sessionWindow(s: SessionDef, date: string): Window {
  const [y, m, d] = date.split('-').map(Number);
  return { session: s.id, label: s.label, date, from: zonedToUtc(y, m, d, s.open, s.tz), to: zonedToUtc(y, m, d, s.close, s.tz) };
}

/** Séances closes depuis moins de `withinMs` (jours ouvrés seulement), plus récente en dernier. */
export function closedSessions(now: number, withinMs: number, sessions = SESSIONS): Window[] {
  const out: Window[] = [];
  for (const s of sessions) {
    for (const back of [0, 1]) {
      const p = zonedParts(now - back * 86_400_000, s.tz);
      if (p.wd === 0 || p.wd === 6) continue;                        // samedi, dimanche
      const w = sessionWindow(s, ymd(p));
      if (w.to <= now && now - w.to <= withinMs && !out.some((x) => x.session === w.session && x.date === w.date)) out.push(w);
    }
  }
  return out.sort((a, b) => a.to - b.to);
}

export const recapKey = (w: Pick<Window, 'date' | 'session'>) => `${RECAP_PREFIX}${w.date}:${w.session}`;

// --- registre de 24 h (machine Oracle) -------------------------------------------------------------

export interface LiqRow { venue: string; ts: number; side: 'long' | 'short'; px: number; sz: number; usd: number }
export interface WallRow { t: number; px: number; sz: number; side: 'bid' | 'ask'; left: number }
export interface LedgerSave { cvd: Record<'perp' | 'spot', [number, number][]>; liqs: LiqRow[]; walls: WallRow[] }

export class Ledger {
  readonly cvd = { perp: new Map<number, number>(), spot: new Map<number, number>() };   // minute → delta (BTC)
  liqs: LiqRow[] = [];
  walls: WallRow[] = [];
  private liqSeen = new Set<string>();
  private wallSeen = new Set<string>();

  /** Série cumulée de micro:cvd (4 h) → deltas par minute ; une minute déjà connue est réécrite (la plus récente fait foi). */
  addCvd(series: { t: number[]; perp: number[]; spot: number[] }, upTo: number): void {
    for (const k of ['perp', 'spot'] as const) {
      const v = series[k];
      for (let i = 1; i < series.t.length; i++) {
        if (series.t[i] + MIN > upTo) break;                           // minute en cours : pas encore close
        this.cvd[k].set(series.t[i], Math.round((v[i] - v[i - 1]) * 1e6) / 1e6);
      }
    }
  }

  addLiqs(rows: LiqRow[]): void {
    for (const l of rows) {
      const k = `${l.venue}|${l.ts}|${l.px}|${l.sz}`;
      if (this.liqSeen.has(k)) continue;
      this.liqSeen.add(k);
      this.liqs.push({ venue: l.venue, ts: l.ts, side: l.side, px: l.px, sz: l.sz, usd: l.usd });
    }
  }

  addWalls(rows: WallRow[]): void {
    for (const w of rows) {
      const k = `${w.t}|${w.px}`;
      if (this.wallSeen.has(k)) continue;
      this.wallSeen.add(k);
      this.walls.push({ t: w.t, px: w.px, sz: w.sz, side: w.side, left: w.left });
    }
  }

  prune(now: number): void {
    const cut = now - LEDGER_MS;
    for (const m of [this.cvd.perp, this.cvd.spot]) for (const t of [...m.keys()]) if (t < cut) m.delete(t);
    this.liqs = this.liqs.filter((l) => l.ts >= cut);
    this.walls = this.walls.filter((w) => w.t >= cut);
    this.liqSeen = new Set(this.liqs.map((l) => `${l.venue}|${l.ts}|${l.px}|${l.sz}`));
    this.wallSeen = new Set(this.walls.map((w) => `${w.t}|${w.px}`));
  }

  save(): LedgerSave { return { cvd: { perp: [...this.cvd.perp], spot: [...this.cvd.spot] }, liqs: this.liqs, walls: this.walls }; }
  restore(s: LedgerSave, now: number): void {
    for (const k of ['perp', 'spot'] as const) for (const [t, v] of s.cvd?.[k] ?? []) this.cvd[k].set(t, v);
    this.addLiqs(s.liqs ?? []); this.addWalls(s.walls ?? []);
    this.prune(now);
  }
}

// --- faits de la séance ------------------------------------------------------------------------

export interface Candle { t: number; o: number; h: number; l: number; c: number }
export interface Figure { label: string; value: string; unit: string | null; at: number | null }
export interface Headline { title: string; source: string; at: number }

export interface RecapInput {
  candles: Candle[];                              // BTC-USDT-SWAP 1 min (okx_candles_1m)
  ledger: Ledger;
  funding8h: number | null;                       // micro:funding total.rate_8h à la clôture
  figures: Figure[];                              // chiffres captés pendant la séance
  headlines: Headline[];                          // titres urgents pendant la séance
}

export function recapFacts(w: Window, i: RecapInput): Fact[] {
  const out: Omit<Fact, 'id'>[] = [];
  const add = (f: Omit<Fact, 'id'>) => out.push(f);
  const PARIS = 'Europe/Paris';
  const span = `${fmtHm(w.from, PARIS)}–${fmtHm(w.to, PARIS)} (Paris)`;
  add({ label: `Séance ${w.label} du ${w.date}`, value: span, source: 'terminal', at_ms: w.to, href: '/recap' });

  const c = i.candles.filter((k) => k.t >= w.from && k.t < w.to).sort((a, b) => a.t - b.t);
  if (c.length) {
    const open = c[0].o, close = c[c.length - 1].c, high = Math.max(...c.map((k) => k.h)), low = Math.min(...c.map((k) => k.l));
    add({ label: 'BTC-USDT perp · ouverture et clôture de la séance', value: `${fmtNumber(open, 1)}${NBSP}$ → ${fmtNumber(close, 1)}${NBSP}$`, source: 'OKX (bougies 1 min)', at_ms: w.to, href: '/graphiques' });
    add({ label: 'BTC-USDT perp · variation sur la séance', value: fmtPctChange(close / open - 1, 2), source: 'OKX (calcul du terminal)', at_ms: w.to, href: '/graphiques' });
    add({ label: 'BTC-USDT perp · plus haut et plus bas de la séance', value: `${fmtNumber(high, 1)}${NBSP}$ et ${fmtNumber(low, 1)}${NBSP}$`, source: 'OKX (bougies 1 min)', at_ms: w.to, href: '/graphiques' });
  }

  const minutes = Math.round((w.to - w.from) / MIN);
  for (const k of ['perp', 'spot'] as const) {
    let sum = 0, n = 0;
    for (const [t, v] of i.ledger.cvd[k]) if (t >= w.from && t < w.to) { sum += v; n++; }
    if (n) add({ label: `CVD ${k === 'perp' ? 'perpétuel' : 'spot'} sur la séance`, value: `${fmtSigned(sum, 0)}${NBSP}BTC (${n} minute${n > 1 ? 's' : ''} couverte${n > 1 ? 's' : ''} sur ${minutes})`,
      source: 'Binance, OKX (machine Oracle)', at_ms: w.to, href: '/microstructure' });
  }

  const liqs = i.ledger.liqs.filter((l) => l.ts >= w.from && l.ts < w.to);
  if (liqs.length) {
    const sum = (side: 'long' | 'short') => liqs.filter((l) => l.side === side).reduce((s, l) => s + l.usd, 0);
    const big = liqs.reduce((a, b) => (b.usd > a.usd ? b : a));
    add({ label: 'Liquidations BTC sur la séance', value: `longs ${fmtUsdCompact(sum('long'))}, shorts ${fmtUsdCompact(sum('short'))} (Binance et OKX : minimums)`, source: 'OKX, Binance, Bybit', at_ms: w.to, href: '/microstructure' });
    add({ label: 'Plus grosse liquidation BTC de la séance', value: `${fmtUsdCompact(big.usd)} (${big.side === 'long' ? 'long' : 'short'}) à ${fmtHm(big.ts, PARIS)} (Paris)`, source: big.venue, at_ms: big.ts, href: '/microstructure' });
  }
  const walls = i.ledger.walls.filter((x) => x.t >= w.from && x.t < w.to);
  if (walls.length) {
    const big = walls.reduce((a, b) => (b.sz > a.sz ? b : a));
    add({ label: 'Murs retirés du carnet BTC sur la séance', value: `${walls.length} ; le plus gros : ${fmtNumber(big.sz, 0)}${NBSP}BTC à ${fmtNumber(big.px, 0)} à ${fmtHm(big.t, PARIS)} (Paris)`,
      source: 'carnets agrégés (machine Oracle)', at_ms: big.t, href: '/microstructure' });
  }
  if (i.funding8h !== null) add({ label: 'Funding BTC moyen à la clôture (équivalent 8 h)', value: fmtPctChange(i.funding8h, 4), source: 'OKX, Binance, Bybit, Hyperliquid', at_ms: w.to, href: '/microstructure' });
  for (const f of i.figures.slice(0, 6)) add({ label: `Chiffre publié · ${f.label}`, value: `${f.value}${f.unit ? ` ${f.unit}` : ''}${f.at ? ` à ${fmtHm(f.at, PARIS)} (Paris)` : ''}`, source: 'BLS', at_ms: f.at, href: '/calendrier' });
  for (const h of i.headlines.slice(0, 5)) add({ label: `Titre urgent · ${fmtHm(h.at, PARIS)} (Paris)`, value: h.title, source: h.source, at_ms: h.at, href: '/actus' });
  return out.map((f, k) => ({ id: `F${k + 1}`, ...f }));
}

export interface Recap {
  key: string; session: Window['session']; label: string; date: string; from: number; to: number;
  facts: Fact[]; text: string | null; sources: string[]; reason: string | null; model: string | null; generated_ms: number;
}
