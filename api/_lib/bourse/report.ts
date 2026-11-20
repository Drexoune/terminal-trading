// Rapport du portefeuille (étape B1.6) : charge enveloppes, opérations,
// clôtures et cours BCE, puis assemble la réponse de GET /api/bourse/portfolio
// avec le moteur pur (portfolio.ts). La valorisation se calcule à la demande :
// rien n'est stocké, tout suit les dernières clôtures relevées la nuit.
//
// Chaque montant porte sa source et sa date ; un calcul impossible renvoie
// null avec sa raison, jamais une valeur de remplacement.

import { add, dec, div, type Dec, isZero, mul, sub, toNumber, toText, ZERO } from './decimal.js';
import type { BourseDb } from './db.js';
import {
  addDays, betaCorrelation, buildSeries, daysBetween, type DayPoint, investorFlows, isWeekday, lastAtOrBefore, type Market,
  maxDrawdown, MIN_DAYS_FOR_RISK, modifiedDietz, toEur, type Txn, volatility, weekdayReturns, xirr,
} from './portfolio.js';

/** Origine des performances quand l'enveloppe n'en a pas (T-038). */
export const DEFAULT_PERF_START = '2026-09-28';
/** Benchmarks (T-038) : ETF de référence capitalisants, par ISIN. */
export const BENCHMARKS = [
  { key: 'msci-world', label: 'MSCI World', isin: 'LU1681043599' },
  { key: 'sp500', label: 'S&P 500', isin: 'FR0011550185' },
] as const;
/** Pays du siège (code ISO, GLEIF) → nom, pour l'allocation par pays. */
const COUNTRY: Record<string, string> = {
  FR: 'France', US: 'États-Unis', DE: 'Allemagne', NL: 'Pays-Bas', GB: 'Royaume-Uni', CH: 'Suisse', IT: 'Italie',
  ES: 'Espagne', BE: 'Belgique', IE: 'Irlande', LU: 'Luxembourg', JP: 'Japon', CA: 'Canada', DK: 'Danemark',
  SE: 'Suède', FI: 'Finlande', NO: 'Norvège', PT: 'Portugal', AT: 'Autriche',
};
/** Une fiche d'émetteur de plus de 92 jours est marquée périmée. */
export const EXPOSURE_STALE_DAYS = 92;

export interface EnvelopeRow { id: number; kind: string; broker: string; name: string; currency: string; perf_start: string | null }
interface TxnRow extends Omit<Txn, 'fees' | 'taxes' | 'quantity' | 'price' | 'amount' | 'fx_rate' | 'ratio_new' | 'ratio_old'> {
  quantity: string | number | null; price: string | number | null; amount: string | number | null; fees: string | number;
  taxes: string | number; fx_rate: string | number | null; ratio_new: string | number | null; ratio_old: string | number | null;
}
interface InstrumentRow { id: number; name: string; isin: string | null; kind: string; hq_country: string | null; pea_eligible: boolean | null; pea_reason: string | null }
interface ListingRow { id: number; symbol: string; mic: string | null; currency: string; price_source: string; source_symbol: string; tracked: boolean; instruments: InstrumentRow | null }
interface PriceRow { listing_id: number; value_date: string; close: string | number; source: string; received_at: string }
interface FxRow { value_date: string; currency: string; per_eur: string | number }
interface ExposureRow { instrument_id: number; axis: string; bucket: string; weight: string | number; as_of: string; source_url: string; source_label: string }

const str = (v: string | number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));

/** Date civile de Paris. */
export function parisDate(nowMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
}

/** Jour ouvré précédent (lundi à vendredi). */
export function previousWeekday(d: string): string {
  let x = addDays(d, -1);
  while (!isWeekday(x)) x = addDays(x, -1);
  return x;
}

const addMonths = (d: string, n: number): string => {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
};

export interface LoadedData {
  envelopes: EnvelopeRow[];
  txns: Txn[];
  listings: ListingRow[];
  prices: PriceRow[];
  fx: FxRow[];
  exposures: ExposureRow[];
}

/** Charge tout ce qu'il faut pour le rapport (quelques requêtes PostgREST). */
export async function loadData(db: BourseDb): Promise<LoadedData> {
  const [envelopes, rows, listings] = await Promise.all([
    db.select<EnvelopeRow>('envelopes', { select: 'id,kind,broker,name,currency,perf_start', order: 'id.asc' }),
    db.select<TxnRow>('transactions', {
      select: 'id,envelope_id,trade_date,kind,listing_id,quantity,price,amount,fees,taxes,currency,fx_rate,target_currency,ratio_new,ratio_old',
      order: 'trade_date.asc,id.asc' }),
    db.select<ListingRow>('instrument_listings', {
      select: 'id,symbol,mic,currency,price_source,source_symbol,tracked,instruments(id,name,isin,kind,hq_country,pea_eligible,pea_reason)',
      order: 'id.asc' }),
  ]);
  const txns: Txn[] = rows.map((r) => ({
    ...r, quantity: str(r.quantity), price: str(r.price), amount: str(r.amount), fees: str(r.fees) ?? '0', taxes: str(r.taxes) ?? '0',
    fx_rate: str(r.fx_rate), ratio_new: str(r.ratio_new), ratio_old: str(r.ratio_old),
  }));
  const benchIds = listings.filter((l) => l.tracked && BENCHMARKS.some((b) => b.isin === l.instruments?.isin)).map((l) => l.id);
  const used = [...new Set([...txns.map((t) => t.listing_id).filter((x): x is number => x !== null), ...benchIds])];
  const starts = [...envelopes.map((e) => e.perf_start ?? DEFAULT_PERF_START), ...txns.map((t) => t.trade_date)];
  const since = addDays(starts.reduce((m, d) => (d < m ? d : m), DEFAULT_PERF_START), -10);
  const instrumentIds = [...new Set(listings.filter((l) => used.includes(l.id)).map((l) => l.instruments?.id).filter((x): x is number => !!x))];
  const [prices, fx, exposures] = await Promise.all([
    used.length ? db.select<PriceRow>('prices', {
      select: 'listing_id,value_date,close,source,received_at', listing_id: `in.(${used.join(',')})`, value_date: `gte.${since}`,
      order: 'value_date.asc', limit: '20000' }) : Promise.resolve([]),
    db.select<FxRow>('fx_rates', { select: 'value_date,currency,per_eur', value_date: `gte.${since}`, order: 'value_date.asc', limit: '20000' }),
    instrumentIds.length ? db.select<ExposureRow>('instrument_exposures', {
      select: 'instrument_id,axis,bucket,weight,as_of,source_url,source_label', instrument_id: `in.(${instrumentIds.join(',')})` })
      : Promise.resolve([]),
  ]);
  return { envelopes, txns, listings, prices, fx, exposures };
}

function marketOf(data: LoadedData): Market {
  const closes = new Map<number, { date: string; close: string }[]>();
  for (const p of data.prices) {
    const list = closes.get(p.listing_id) ?? [];
    if (list.at(-1)?.date !== p.value_date) list.push({ date: p.value_date, close: String(p.close) });
    closes.set(p.listing_id, list);
  }
  const fx = new Map<string, { date: string; per_eur: string }[]>();
  for (const r of data.fx) {
    const list = fx.get(r.currency) ?? [];
    list.push({ date: r.value_date, per_eur: String(r.per_eur) });
    fx.set(r.currency, list);
  }
  return { listings: new Map(data.listings.map((l) => [l.id, { id: l.id, currency: l.currency }])), closes, fx };
}

const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? null : x);

interface Bucket { label: string; value: number; pct: number }
function buckets(map: Map<string, number>, total: number): Bucket[] {
  return [...map].filter(([, v]) => Math.abs(v) > 0.005).map(([label, value]) => ({ label, value: Math.round(value * 100) / 100, pct: total > 0 ? value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}

/** Rapport complet pour une enveloppe (id) ou pour l'ensemble (null). */
export function buildReport(data: LoadedData, envelopeId: number | null, nowMs: number) {
  const today = parisDate(nowMs);
  const envs = envelopeId === null ? data.envelopes : data.envelopes.filter((e) => e.id === envelopeId);
  const txns = data.txns.filter((t) => envs.some((e) => e.id === t.envelope_id));
  const start = envs.map((e) => e.perf_start ?? DEFAULT_PERF_START).reduce((m, d) => (d < m ? d : m), DEFAULT_PERF_START);
  const market = marketOf(data);
  const listingById = new Map(data.listings.map((l) => [l.id, l]));
  const series = buildSeries(txns, market, start, today);
  const pts = series.points;
  const last = pts.at(-1)!;
  const prevWd = previousWeekday(today);

  // --- lignes ---
  let total = ZERO;
  let invested = ZERO;
  const lineRows: {
    listing_id: number; envelope_ids: number[]; value: Dec | null; cost: Dec; qty: Dec; realized: Dec; close: ReturnType<typeof lastAtOrBefore<{ date: string; close: string }>>;
  }[] = [];
  for (const [id, p] of series.ledger.positions) {
    if (isZero(p.qty) && isZero(p.realized)) continue;
    const c = lastAtOrBefore(market.closes.get(id), today);
    const l = listingById.get(id);
    const close = c ? dec(c.close) : null;
    const value = close && l ? toEur(mul(p.qty, close), l.currency, today, market) : null;
    if (!isZero(p.qty)) { if (value !== null) total = add(total, value); invested = add(invested, p.cost); }
    lineRows.push({ listing_id: id, envelope_ids: [...new Set(txns.filter((t) => t.listing_id === id).map((t) => t.envelope_id))], value, cost: p.cost, qty: p.qty, realized: p.realized, close: c });
  }
  const cash = [...series.ledger.cash].filter(([, v]) => !isZero(v)).map(([currency, amount]) => {
    const v = toEur(amount, currency, today, market);
    if (v !== null) total = add(total, v);
    return { currency, amount: toText(amount, 2), value_eur: v === null ? null : toText(v, 2) };
  });
  const totalN = toNumber(total);
  const lastPrice = (id: number) => data.prices.filter((p) => p.listing_id === id).at(-1);
  const lines = lineRows.filter((r) => !isZero(r.qty)).map((r) => {
    const l = listingById.get(r.listing_id);
    const i = l?.instruments;
    const lp = lastPrice(r.listing_id);
    const unreal = r.value === null ? null : sub(r.value, r.cost);
    return {
      listing_id: r.listing_id, envelope_ids: r.envelope_ids, name: i?.name ?? l?.symbol ?? `cotation ${r.listing_id}`,
      symbol: l?.symbol ?? null, isin: i?.isin ?? null, kind: i?.kind ?? null, currency: l?.currency ?? null,
      quantity: toText(r.qty, 4).replace(/\.?0+$/, ''), pru: isZero(r.qty) ? null : toText(div(r.cost, r.qty), 4), cost: toText(r.cost, 2),
      close: r.close ? { value: r.close.close, date: r.close.date, source: lp?.source ?? null, received_at: lp?.received_at ?? null,
        stale: r.close.date < prevWd } : null,
      value: r.value === null ? null : toText(r.value, 2),
      weight: r.value === null || totalN <= 0 ? null : toNumber(r.value) / totalN,
      unrealized: unreal === null ? null : toText(unreal, 2),
      unrealized_pct: unreal === null || isZero(r.cost) ? null : toNumber(unreal) / toNumber(r.cost),
      realized: toText(r.realized, 2),
      pea_eligible: i?.pea_eligible ?? null, pea_reason: i?.pea_reason ?? null,
      missing_reason: r.value !== null ? null : !r.close ? 'aucune clôture relevée pour cette cotation' : `cours BCE ${l?.currency}/EUR absent`,
    };
  }).sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));

  const complete = lines.every((l) => l.value !== null) && cash.every((c) => c.value_eur !== null);
  // Variation de la dernière séance : entre la dernière date de clôture des lignes détenues et le jour ouvré
  // précédent, hors flux externes. Aujourd'hui sans nouvelle clôture, elle reste celle de la veille.
  const closeDates = lines.map((l) => l.close?.date).filter((x): x is string => !!x);
  const refDate = closeDates.length ? closeDates.reduce((m, x) => (x > m ? x : m)) : null;
  const pRef = refDate ? pts.find((p) => p.date === refDate) : undefined;
  const pPrev = refDate ? pts.find((p) => p.date === previousWeekday(refDate)) : undefined;
  const flowsBetween = pRef && pPrev ? pts.filter((p) => p.date > pPrev.date && p.date <= pRef.date).reduce((x, p) => x + p.flow, 0) : 0;
  const dayChange = pRef?.value != null && pPrev?.value != null ? pRef.value - pPrev.value - flowsBetween : null;

  // --- performances ---
  const idxAt = (d: string) => pts.find((p) => p.date === d)?.index ?? null;
  const PERIODS = [
    { key: '1M', label: '1 mois', from: addDays(addMonths(today, -1), 1) },
    { key: '3M', label: '3 mois', from: addDays(addMonths(today, -3), 1) },
    { key: 'YTD', label: 'Depuis le 1er janvier', from: `${today.slice(0, 4)}-01-01` },
    { key: '1A', label: '1 an', from: addDays(addMonths(today, -12), 1) },
    { key: 'ORIGIN', label: 'Depuis l’origine', from: start },
  ];
  const bench = BENCHMARKS.map((b) => {
    const l = data.listings.find((x) => x.tracked && x.instruments?.isin === b.isin);
    const closes = l ? market.closes.get(l.id) : undefined;
    const level = (d: string) => { const c = lastAtOrBefore(closes, d); return c ? Number(c.close) : null; };
    return { ...b, listing: l, level };
  });
  const periods = PERIODS.map((p) => {
    const days = daysBetween(addDays(p.from, -1), today);
    if (p.from < start) return { key: p.key, label: p.label, from: p.from, to: today, days, twr: null, dietz: null, irr: null, irr_annualized: false, benchmarks: [], reason: 'historique plus court que la période' };
    const i0 = idxAt(addDays(p.from, -1));
    const twr = i0 && last.index ? last.index / i0 - 1 : null;
    const flows = investorFlows(pts, p.from, today);
    const irr = flows ? xirr(flows, days >= 365 ? 365 : Math.max(days, 1)) : null;
    return {
      key: p.key, label: p.label, from: p.from, to: today, days, twr: pct(twr), dietz: pct(modifiedDietz(pts, p.from, today)),
      irr: pct(irr), irr_annualized: days >= 365,
      benchmarks: bench.map((b) => { const a = b.level(addDays(p.from, -1)); const z = b.level(today); return { key: b.key, twr: a && z ? z / a - 1 : null }; }),
      reason: twr === null ? (last.missing.length ? `valorisation incomplète : ${last.missing.join(', ')}` : 'indice interrompu par une journée sans cours') : null,
    };
  });
  const chart = pts.map((p) => ({ date: p.date, index: p.index, value: p.value }));
  const benchSeries = bench.map((b) => {
    const base = b.level(addDays(start, -1));
    return { key: b.key, label: b.label, isin: b.isin, symbol: b.listing?.source_symbol ?? null,
      reason: !b.listing ? 'cotation de référence non suivie' : base === null ? 'aucune clôture à l’origine' : null,
      series: base === null ? [] : pts.map((p) => { const v = b.level(p.date); return { date: p.date, index: v === null ? null : (v / base) * 100 }; }) };
  });

  // --- risques ---
  const portRet = weekdayReturns(pts.map((p) => ({ date: p.date, level: p.index })));
  const rets = [...portRet.values()];
  const dd = maxDrawdown(pts.map((p) => ({ date: p.date, level: p.index })));
  const risk = {
    days: rets.length,
    min_days: MIN_DAYS_FOR_RISK,
    volatility: volatility(rets),
    max_drawdown: dd,
    reason: rets.length < MIN_DAYS_FOR_RISK ? `historique trop court : ${rets.length} jour(s) ouvré(s), ${MIN_DAYS_FOR_RISK} au moins` : null,
    vs: bench.map((b) => {
      const r = betaCorrelation(portRet, weekdayReturns(pts.map((p) => ({ date: p.date, level: b.level(p.date) }))));
      return { key: b.key, label: b.label, beta: r?.beta ?? null, correlation: r?.correlation ?? null, days: r?.days ?? null };
    }),
  };

  // --- allocation ---
  const byLine = new Map<string, number>();
  const byCurrency = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const bySector = new Map<string, number>();
  const sources = new Map<number, { instrument: string; as_of: string; url: string; label: string; stale: boolean }>();
  const addTo = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const l of lines) {
    const v = l.value === null ? 0 : Number(l.value);
    if (!v) continue;
    addTo(byLine, l.symbol ?? l.name, v);
    addTo(byCurrency, l.currency ?? '?', v);
    const inst = listingById.get(l.listing_id)?.instruments;
    const ex = data.exposures.filter((e) => e.instrument_id === inst?.id);
    for (const [axis, map] of [['pays', byCountry], ['secteur', bySector]] as const) {
      const rows = ex.filter((e) => e.axis === axis);
      let covered = 0;
      for (const e of rows) { const w = Number(e.weight) / 100; covered += w; addTo(map, e.bucket, v * w); }
      if (!rows.length && axis === 'pays' && l.kind === 'action' && inst?.hq_country) { addTo(map, COUNTRY[inst.hq_country] ?? inst.hq_country, v); covered = 1; }
      if (covered < 0.9995) addTo(map, 'Non ventilé', v * (1 - covered));
    }
    for (const e of ex) {
      if (inst && !sources.has(inst.id)) {
        sources.set(inst.id, { instrument: inst.name, as_of: e.as_of, url: e.source_url, label: e.source_label, stale: daysBetween(e.as_of, today) > EXPOSURE_STALE_DAYS });
      }
    }
  }
  for (const c of cash) {
    const v = c.value_eur === null ? 0 : Number(c.value_eur);
    if (!v) continue;
    for (const m of [byLine, byCountry, bySector]) addTo(m, 'Liquidités', v);
    addTo(byCurrency, c.currency, v);
  }

  // --- dividendes ---
  const nameOf = (id: number | null) => (id === null ? '—' : listingById.get(id)?.instruments?.name ?? listingById.get(id)?.symbol ?? `cotation ${id}`);
  const byMonth = new Map<string, number>();
  for (const dv of series.dividends) addTo(byMonth, dv.date.slice(0, 7), dv.net);

  return {
    generated_at: new Date(nowMs).toISOString(),
    as_of: today,
    scope: envelopeId,
    perf_start: start,
    envelopes: data.envelopes.map((e) => ({ ...e, perf_start: e.perf_start ?? DEFAULT_PERF_START })),
    summary: {
      value: complete ? toText(total, 2) : null,
      partial_value: toText(total, 2),
      invested: toText(invested, 2),
      unrealized: complete ? toText(sub(total, add(invested, sum(cash))), 2) : null,
      day_change: dayChange === null ? null : Math.round(dayChange * 100) / 100,
      day_change_pct: dayChange === null || !pPrev?.value ? null : dayChange / pPrev.value,
      day_change_date: dayChange === null ? null : refDate,
      complete,
      missing: last.missing,
      costs: Math.round(series.costs * 100) / 100,
      income: Math.round(series.income * 100) / 100,
      transactions: txns.length,
    },
    lines,
    cash,
    performance: { periods, chart, benchmarks: benchSeries },
    risk,
    allocation: {
      total: totalN,
      lines: buckets(byLine, totalN), currency: buckets(byCurrency, totalN), country: buckets(byCountry, totalN), sector: buckets(bySector, totalN),
      sources: [...sources.values()],
    },
    dividends: {
      total: Math.round(series.dividends.reduce((s, d) => s + d.net, 0) * 100) / 100,
      by_month: [...byMonth].map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 })),
      items: series.dividends.map((d) => ({ date: d.date, name: nameOf(d.listing_id), net: Math.round(d.net * 100) / 100 })).reverse(),
    },
    problems: series.problems,
  };

  function sum(cs: typeof cash): Dec {
    return cs.reduce((s, c) => (c.value_eur === null ? s : add(s, dec(c.value_eur)!)), ZERO);
  }
}

export type PortfolioReport = ReturnType<typeof buildReport>;
export type { DayPoint };
