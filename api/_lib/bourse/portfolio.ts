// Moteur du portefeuille (étape B1, docs/plan-b1.md § 3) : fonctions pures,
// sans base ni réseau, testées par Vitest (api/_tests/bourse-portfolio.test.ts).
//
// Entrées : opérations au format d'import Baggr (nombres positifs, le type
// donne le sens), clôtures par cotation, cours BCE. Sorties : positions,
// valorisation quotidienne en euros, flux externes, indice TWR, Dietz modifié,
// TRI (comme XIRR d'Excel), volatilité, perte maximale, bêta, corrélation.
//
// Règles :
//  - montants en décimal exact (decimal.ts) ; rendements en nombres ordinaires ;
//  - une valeur manquante (cours ou change) rend la journée incomplète : jamais
//    de cours recopié au-delà de la dernière clôture connue, jamais de prix
//    d'achat utilisé comme cours ;
//  - coût moyen pondéré (règle du PEA), coût et PRU en euros ;
//  - flux externes : versements, retraits, transferts de titres ; sans gestion
//    des liquidités (fichier sans aucune opération d'espèces), les achats et
//    les ventes deviennent eux-mêmes les flux externes.

import { add, dec, decOrZero, div, type Dec, isZero, mul, neg, ONE, sub, toNumber, ZERO } from './decimal.js';

export const KINDS = [
  'achat', 'vente', 'dividende', 'remboursement_capital', 'actions_gratuites', 'split',
  'transfert_entrant', 'transfert_sortant', 'depot', 'retrait', 'change', 'interets',
  'frais', 'remboursement_frais', 'taxes',
] as const;
export type Kind = typeof KINDS[number];

/** Types qui activent la gestion des liquidités (feuille « Aide » de Baggr). */
const CASH_KINDS: ReadonlySet<Kind> = new Set(['depot', 'retrait', 'change', 'interets', 'frais', 'remboursement_frais', 'taxes']);

export interface Txn {
  id: number;
  envelope_id: number;
  trade_date: string;            // AAAA-MM-JJ, Paris
  kind: Kind;
  listing_id: number | null;
  quantity: string | null;
  price: string | null;          // en devise de cotation du titre
  amount: string | null;         // en devise du compte espèces (currency)
  fees: string;
  taxes: string;
  currency: string;              // devise du compte espèces
  fx_rate: string | null;        // 1 unité de la devise du titre = x currency ; Change : 1 currency = x target
  target_currency: string | null;
  ratio_new: string | null;
  ratio_old: string | null;
}

export interface Listing { id: number; currency: string }
export interface Close { date: string; close: string }
/** Cours BCE : 1 EUR = per_eur unités de la devise. */
export interface FxPoint { date: string; per_eur: string }

export interface Market {
  listings: Map<number, Listing>;
  closes: Map<number, Close[]>;   // triées par date croissante
  fx: Map<string, FxPoint[]>;     // par devise, triées par date croissante
}

// --- dates ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
export const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const isWeekday = (d: string): boolean => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Dernier point de date ≤ d (recherche dichotomique), ou null. */
export function lastAtOrBefore<T extends { date: string }>(points: readonly T[] | undefined, d: string): T | null {
  if (!points?.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (points[0].date > d) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].date <= d) lo = mid; else hi = mid - 1;
  }
  return points[lo];
}

// --- change --------------------------------------------------------------------------

/** Montant en `currency` converti en euros au dernier cours BCE ≤ d ; null sans cours. */
export function toEur(amount: Dec, currency: string, d: string, market: Market): Dec | null {
  if (currency === 'EUR') return amount;
  const p = lastAtOrBefore(market.fx.get(currency), d);
  const rate = p ? dec(p.per_eur) : null;
  return rate && !isZero(rate) ? div(amount, rate) : null;
}

// --- registre ------------------------------------------------------------------------

export interface Position { qty: Dec; cost: Dec /* EUR */; realized: Dec /* EUR */ }

export interface Ledger {
  positions: Map<number, Position>;
  cash: Map<string, Dec>;
  cashTracked: boolean;
}

export interface DayEvent {
  flow: Dec;            // flux externe du jour, en euros (positif = apport)
  dividends: Dec;       // dividendes nets du jour, en euros
  incomeOther: Dec;     // intérêts nets, en euros
  costs: Dec;           // frais et taxes du jour, en euros
  problems: string[];   // conversions impossibles
}

const emptyEvent = (): DayEvent => ({ flow: ZERO, dividends: ZERO, incomeOther: ZERO, costs: ZERO, problems: [] });

export function newLedger(txns: readonly Txn[]): Ledger {
  return { positions: new Map(), cash: new Map(), cashTracked: txns.some((t) => CASH_KINDS.has(t.kind)) };
}

function pos(l: Ledger, id: number): Position {
  let p = l.positions.get(id);
  if (!p) { p = { qty: ZERO, cost: ZERO, realized: ZERO }; l.positions.set(id, p); }
  return p;
}

const addCash = (l: Ledger, cur: string, v: Dec) => l.cash.set(cur, add(l.cash.get(cur) ?? ZERO, v));

/** Montant brut d'un achat ou d'une vente : Montant, sinon Quantité × Prix × taux. */
function grossAmount(t: Txn): Dec {
  const a = dec(t.amount);
  if (a !== null) return a;
  return mul(mul(decOrZero(t.quantity), decOrZero(t.price)), dec(t.fx_rate) ?? ONE);
}

/** Applique une opération au registre ; renvoie ses effets du jour en euros. */
export function apply(l: Ledger, t: Txn, market: Market, ev: DayEvent = emptyEvent()): DayEvent {
  const fees = decOrZero(t.fees);
  const taxes = decOrZero(t.taxes);
  const eur = (v: Dec, cur = t.currency): Dec => {
    const r = toEur(v, cur, t.trade_date, market);
    if (r === null) { ev.problems.push(`change ${cur}/EUR absent au ${t.trade_date}`); return ZERO; }
    return r;
  };
  const qty = decOrZero(t.quantity);
  switch (t.kind) {
    case 'achat': {
      const total = add(add(grossAmount(t), fees), taxes);
      const p = pos(l, t.listing_id!);
      p.qty = add(p.qty, qty);
      p.cost = add(p.cost, eur(total));
      if (l.cashTracked) addCash(l, t.currency, neg(total)); else ev.flow = add(ev.flow, eur(total));
      ev.costs = add(ev.costs, eur(add(fees, taxes)));
      break;
    }
    case 'vente': {
      const net = sub(sub(grossAmount(t), fees), taxes);
      const p = pos(l, t.listing_id!);
      const share = isZero(p.qty) ? ZERO : mul(p.cost, div(qty, p.qty));
      p.qty = sub(p.qty, qty);
      p.cost = isZero(p.qty) ? ZERO : sub(p.cost, share);
      p.realized = add(p.realized, sub(eur(net), share));
      if (l.cashTracked) addCash(l, t.currency, net); else ev.flow = sub(ev.flow, eur(net));
      ev.costs = add(ev.costs, eur(add(fees, taxes)));
      break;
    }
    case 'dividende': {
      const net = sub(sub(decOrZero(t.amount), taxes), fees);
      ev.dividends = add(ev.dividends, eur(net));
      ev.costs = add(ev.costs, eur(add(fees, taxes)));
      if (l.cashTracked) addCash(l, t.currency, net); else ev.flow = sub(ev.flow, eur(net));
      break;
    }
    case 'remboursement_capital': {
      const a = decOrZero(t.amount);
      const p = pos(l, t.listing_id!);
      const c = sub(p.cost, eur(a));
      p.cost = c < ZERO ? ZERO : c;
      if (l.cashTracked) addCash(l, t.currency, a); else ev.flow = sub(ev.flow, eur(a));
      break;
    }
    case 'actions_gratuites': { const p = pos(l, t.listing_id!); p.qty = add(p.qty, qty); break; }
    case 'split': {
      const p = pos(l, t.listing_id!);
      const n = dec(t.ratio_new);
      const o = dec(t.ratio_old);
      if (n && o) p.qty = div(mul(p.qty, n), o);
      break;
    }
    case 'transfert_entrant':
    case 'transfert_sortant': {
      const value = mul(mul(qty, decOrZero(t.price)), dec(t.fx_rate) ?? ONE);
      const p = pos(l, t.listing_id!);
      if (t.kind === 'transfert_entrant') {
        p.qty = add(p.qty, qty); p.cost = add(p.cost, eur(value)); ev.flow = add(ev.flow, eur(value));
      } else {
        const share = isZero(p.qty) ? ZERO : mul(p.cost, div(qty, p.qty));
        p.qty = sub(p.qty, qty); p.cost = isZero(p.qty) ? ZERO : sub(p.cost, share); ev.flow = sub(ev.flow, eur(value));
      }
      break;
    }
    case 'depot': { const a = decOrZero(t.amount); addCash(l, t.currency, a); ev.flow = add(ev.flow, eur(a)); break; }
    case 'retrait': { const a = decOrZero(t.amount); addCash(l, t.currency, neg(a)); ev.flow = sub(ev.flow, eur(a)); break; }
    case 'change': {
      const a = decOrZero(t.amount);
      addCash(l, t.currency, neg(a));
      if (t.target_currency) addCash(l, t.target_currency, mul(a, dec(t.fx_rate) ?? ONE));
      break;
    }
    case 'interets': { const a = decOrZero(t.amount); addCash(l, t.currency, a); ev.incomeOther = add(ev.incomeOther, eur(a)); break; }
    case 'frais': { const a = decOrZero(t.amount); addCash(l, t.currency, neg(a)); ev.costs = add(ev.costs, eur(a)); break; }
    case 'remboursement_frais': { const a = decOrZero(t.amount); addCash(l, t.currency, a); ev.costs = sub(ev.costs, eur(a)); break; }
    case 'taxes': { const a = decOrZero(t.amount); addCash(l, t.currency, neg(a)); ev.costs = add(ev.costs, eur(a)); break; }
  }
  return ev;
}

/** Valeur du registre en euros à la fin du jour d, ou la liste de ce qui manque. */
export function valueAt(l: Ledger, d: string, market: Market): { value: Dec | null; missing: string[] } {
  let total = ZERO;
  const missing: string[] = [];
  for (const [id, p] of l.positions) {
    if (isZero(p.qty)) continue;
    const c = lastAtOrBefore(market.closes.get(id), d);
    const close = c ? dec(c.close) : null;
    const listing = market.listings.get(id);
    if (!close || !listing) { missing.push(`cours de la cotation ${id}`); continue; }
    const v = toEur(mul(p.qty, close), listing.currency, d, market);
    if (v === null) { missing.push(`change ${listing.currency}/EUR`); continue; }
    total = add(total, v);
  }
  for (const [cur, c] of l.cash) {
    if (isZero(c)) continue;
    const v = toEur(c, cur, d, market);
    if (v === null) { missing.push(`change ${cur}/EUR`); continue; }
    total = add(total, v);
  }
  return missing.length ? { value: null, missing } : { value: total, missing };
}

// --- série quotidienne ---------------------------------------------------------------

export interface DayPoint {
  date: string;
  value: number | null;   // euros, fin de journée
  flow: number;           // flux externe du jour (euros)
  index: number | null;   // indice TWR, base 100 la veille de l'origine
  missing: string[];
}

export interface Series {
  start: string;           // origine des performances
  points: DayPoint[];      // de la veille de l'origine à `end`, jours calendaires
  ledger: Ledger;          // état à `end`
  dividends: { date: string; listing_id: number | null; net: number }[];
  costs: number;
  income: number;
  problems: string[];
}

/**
 * Série quotidienne de `start − 1` à `end`. TWR à flux en début de journée :
 * r = V_j / (V_j−1 + F_j) − 1 ; base nulle → rendement nul. Une journée
 * incomplète interrompt l'indice (null) jusqu'à la fin : on ne recolle pas.
 */
export function buildSeries(txns: readonly Txn[], market: Market, start: string, end: string): Series {
  const sorted = [...txns].sort((a, b) => (a.trade_date < b.trade_date ? -1 : a.trade_date > b.trade_date ? 1 : a.id - b.id));
  const ledger = newLedger(sorted);
  const first = sorted.length ? (sorted[0].trade_date < start ? sorted[0].trade_date : addDays(start, -1)) : addDays(start, -1);
  const points: DayPoint[] = [];
  const dividends: Series['dividends'] = [];
  const problems: string[] = [];
  let costs = ZERO;
  let income = ZERO;
  let i = 0;
  let prev: number | null = null;
  let index: number | null = 100;
  for (let d = first; d <= end; d = addDays(d, 1)) {
    const ev = emptyEvent();
    while (i < sorted.length && sorted[i].trade_date <= d) {
      const t = sorted[i++];
      const before = ev.dividends;
      apply(ledger, t, market, ev);
      if (t.kind === 'dividende') dividends.push({ date: d, listing_id: t.listing_id, net: toNumber(sub(ev.dividends, before)) });
    }
    problems.push(...ev.problems);
    if (d < addDays(start, -1)) continue;
    if (d >= start) { costs = add(costs, ev.costs); income = add(income, ev.incomeOther); }
    const { value, missing } = valueAt(ledger, d, market);
    const v = value === null ? null : toNumber(value);
    const flow = toNumber(ev.flow);
    if (d === addDays(start, -1)) {
      index = v === null ? null : 100;
    } else if (index !== null) {
      if (v === null || prev === null) index = null;
      else { const base = prev + flow; index = base > 1e-9 ? index * (v / base) : index; }
    }
    points.push({ date: d, value: v, flow, index, missing });
    prev = v;
  }
  return { start, points, ledger, dividends, costs: toNumber(costs), income: toNumber(income), problems: [...new Set(problems)] };
}

// --- mesures -------------------------------------------------------------------------

/** Dietz modifié sur [from, to] (flux en début de journée). */
export function modifiedDietz(points: readonly DayPoint[], from: string, to: string): number | null {
  const open = points.find((p) => p.date === addDays(from, -1));
  const close = points.find((p) => p.date === to);
  if (!open || !close || open.value === null || close.value === null) return null;
  const n = daysBetween(from, to) + 1;
  let flows = 0;
  let weighted = 0;
  for (const p of points) {
    if (p.date < from || p.date > to || p.flow === 0) continue;
    flows += p.flow;
    weighted += p.flow * ((daysBetween(p.date, to) + 1) / n);
  }
  const denom = open.value + weighted;
  return denom > 1e-9 ? (close.value - open.value - flows) / denom : null;
}

/**
 * TRI, comme XIRR d'Excel : Σ Pᵢ / (1 + r)^((dᵢ − d₀)/base) = 0, avec base =
 * 365 (TRI annualisé). Une base égale à la durée de la période donne le TRI de
 * la période, non annualisé : c'est ce qu'on affiche sous un an (on n'annualise
 * pas une période courte, règle des normes GIPS).
 * Newton depuis 10 %, puis dichotomie sur ]−0,9999 ; 100[ si Newton échoue.
 * null si les flux ne changent pas de signe (TRI non défini).
 */
export function xirr(flows: readonly { date: string; amount: number }[], basisDays = 365): number | null {
  const fs = flows.filter((f) => f.amount !== 0);
  if (!fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return null;
  const d0 = fs.reduce((m, f) => (f.date < m ? f.date : m), fs[0].date);
  const ts = fs.map((f) => ({ t: daysBetween(d0, f.date) / basisDays, a: f.amount }));
  const npv = (r: number) => ts.reduce((s, f) => s + f.a / (1 + r) ** f.t, 0);
  const dnpv = (r: number) => ts.reduce((s, f) => s - (f.t * f.a) / (1 + r) ** (f.t + 1), 0);
  let r = 0.1;
  for (let k = 0; k < 100; k++) {
    const f = npv(r);
    const g = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(g) || g === 0) break;
    const next = r - f / g;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  let lo = -0.9999;
  let hi = 100;
  let flo = npv(lo);
  if (Math.sign(flo) === Math.sign(npv(hi))) return null;
  for (let k = 0; k < 300; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-10 || hi - lo < 1e-13) return mid;
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Flux de l'investisseur sur [from, to] pour le TRI : valeur d'entrée, apports, valeur de sortie. */
export function investorFlows(points: readonly DayPoint[], from: string, to: string): { date: string; amount: number }[] | null {
  const open = points.find((p) => p.date === addDays(from, -1));
  const close = points.find((p) => p.date === to);
  if (!open || !close || open.value === null || close.value === null) return null;
  const out = [{ date: open.date, amount: -open.value }];
  for (const p of points) if (p.date >= from && p.date <= to && p.flow !== 0) out.push({ date: p.date, amount: -p.flow });
  out.push({ date: to, amount: close.value });
  return out;
}

/** Rendements quotidiens d'une série de niveaux, jours ouvrés seulement (lundi à vendredi). */
export function weekdayReturns(levels: readonly { date: string; level: number | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  let prev: number | null = null;
  for (const p of levels) {
    if (!isWeekday(p.date)) continue;
    if (p.level !== null && prev !== null && prev > 0) out.set(p.date, p.level / prev - 1);
    prev = p.level;
  }
  return out;
}

export const MIN_DAYS_FOR_RISK = 60;

function mean(xs: readonly number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }

/** Volatilité annualisée (écart-type d'échantillon × √252). */
export function volatility(returns: readonly number[]): number | null {
  if (returns.length < MIN_DAYS_FOR_RISK) return null;
  const m = mean(returns);
  const v = returns.reduce((s, x) => s + (x - m) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

/** Perte maximale d'une série de niveaux (≤ 0), avec ses dates de sommet et de creux. */
export function maxDrawdown(levels: readonly { date: string; level: number | null }[]): { value: number; peak: string; trough: string } | null {
  let peak: { date: string; level: number } | null = null;
  let best = { value: 0, peak: '', trough: '' };
  for (const p of levels) {
    if (p.level === null) continue;
    if (!peak || p.level > peak.level) peak = { date: p.date, level: p.level };
    const dd = p.level / peak.level - 1;
    if (dd < best.value) best = { value: dd, peak: peak.date, trough: p.date };
  }
  return peak ? best : null;
}

/** Bêta et corrélation du portefeuille contre un benchmark, sur les jours communs. */
export function betaCorrelation(port: Map<string, number>, bench: Map<string, number>): { beta: number; correlation: number; days: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, r] of port) { const b = bench.get(d); if (b !== undefined) { xs.push(b); ys.push(r); } }
  if (xs.length < MIN_DAYS_FOR_RISK) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0; let vx = 0; let vy = 0;
  for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2; vy += (ys[k] - my) ** 2; }
  if (vx === 0 || vy === 0) return null;
  return { beta: cov / vx, correlation: cov / Math.sqrt(vx * vy), days: xs.length };
}
