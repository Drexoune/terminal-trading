// Calculs de P4 (plan P4, étape S2), fonctions pures testées par Vitest :
//
// - indice de risque : 7 composantes, chacune en percentile sur les 252 dernières séances
//   américaines (« plus haut = risk-on » : VIX et crédit inversés), indice = moyenne des
//   composantes disponibles (4 au moins), 5 zones de la maquette ;
// - COT : position nette par catégorie et son percentile sur 3 ans (156 semaines) ;
// - sentiment retail : écart du ratio long/short à sa moyenne sur 30 jours ;
// - liquidité nette de la Fed : WALCL − WDTGAL − RRPONTSYD × 1 000 (décision T-060).
//
// Aucun chiffre n'est inventé : une composante sans assez d'historique, ou dont la série s'est
// arrêtée, est exclue avec sa raison.

export interface Obs { date: string; value: number; adj?: number | null }

export const WINDOW = 252;          // séances : percentile sur un an
export const MIN_COMPONENTS = 4;    // sous ce nombre, pas d'indice
export const MAX_STALE_DAYS = 7;    // au-delà, la série est jugée arrêtée à cette séance
export const ZONES = [
  { id: 'risk_off_strong', label: 'Risk-off fort', from: 0, to: 25 },
  { id: 'risk_off', label: 'Risk-off', from: 25, to: 45 },
  { id: 'neutral', label: 'Neutre', from: 45, to: 55 },
  { id: 'risk_on', label: 'Risk-on', from: 55, to: 75 },
  { id: 'risk_on_strong', label: 'Risk-on fort', from: 75, to: 100 },
] as const;

export function zoneOf(v: number): (typeof ZONES)[number] {
  return ZONES.find((z) => v < z.to) ?? ZONES[ZONES.length - 1];
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;

/**
 * Rang centile de la dernière valeur dans sa fenêtre (dernière valeur comprise) : part des autres
 * valeurs strictement inférieures, les égalités comptant pour moitié. 0 à 100.
 */
export function percentileRank(window: number[]): number {
  const x = window[window.length - 1];
  const n = window.length - 1;
  if (n <= 0) return 50;
  let below = 0, equal = 0;
  for (let i = 0; i < n; i++) { if (window[i] < x) below++; else if (window[i] === x) equal++; }
  return (100 * (below + equal / 2)) / n;
}

/** Valeur connue à chaque séance (dernière observation à cette date ou avant, MAX_STALE_DAYS au plus). */
export function asOf(sessions: string[], obs: Obs[], field: 'value' | 'adj' = 'value'): (number | null)[] {
  const sorted = [...obs].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: (number | null)[] = [];
  let j = -1;
  for (const d of sessions) {
    while (j + 1 < sorted.length && sorted[j + 1].date <= d) j++;
    const o = j >= 0 ? sorted[j] : null;
    const v = o ? (field === 'adj' ? (o.adj ?? o.value) : o.value) : null;
    out.push(o && v !== null && days(o.date, d) <= MAX_STALE_DAYS ? v : null);
  }
  return out;
}

const change = (a: (number | null)[], i: number, lag: number, kind: 'pct' | 'diff'): number | null => {
  const x = a[i], y = i - lag >= 0 ? a[i - lag] : null;
  if (x === null || y === null) return null;
  return kind === 'diff' ? x - y : y === 0 ? null : (x / y - 1) * 100;
};

// ---------------------------------------------------------------------------------------------
// Indice de risque

export interface ComponentSpec {
  id: string; label: string; description: string; unit: '%' | 'pts'; invert: boolean;
  series: string[]; source: string;
  /** Valeur brute à la séance i, à partir des séries alignées sur les séances. */
  metric: (a: Record<string, (number | null)[]>, i: number) => number | null;
}

const LAG = 20, MA = 125;

export const COMPONENTS: ComponentSpec[] = [
  { id: 'vix', label: 'VIX', description: 'Volatilité implicite du S&P 500', unit: 'pts', invert: true, series: ['VIX'], source: 'Cboe (FRED en repli)',
    metric: (a, i) => a.VIX[i] },
  { id: 'trend', label: 'Tendance actions', description: 'SPY vs moyenne mobile 125 séances', unit: '%', invert: false, series: ['SPY'], source: 'Tiingo',
    metric: (a, i) => {
      if (i < MA - 1) return null;
      const w = a.SPY_ADJ.slice(i - MA + 1, i + 1);
      if (w.some((x) => x === null)) return null;
      const ma = (w as number[]).reduce((s, x) => s + x, 0) / MA;
      return (a.SPY_ADJ[i]! / ma - 1) * 100;
    } },
  { id: 'credit', label: 'Crédit', description: 'Écart haut rendement · variation sur 20 séances', unit: 'pts', invert: true, series: ['HY_OAS'], source: 'FRED (ICE BofA)',
    metric: (a, i) => change(a.HY_OAS, i, LAG, 'diff') },
  { id: 'audjpy', label: 'AUD/JPY', description: 'Variation sur 20 séances', unit: '%', invert: false, series: ['AUDJPY'], source: 'Tiingo',
    metric: (a, i) => change(a.AUDJPY, i, LAG, 'pct') },
  { id: 'copper_gold', label: 'Cuivre / or', description: 'Ratio CPER / GLD · variation sur 20 séances', unit: '%', invert: false, series: ['CPER', 'GLD'], source: 'Tiingo',
    metric: (a, i) => change(a.CPER_GLD, i, LAG, 'pct') },
  { id: 'stocks_bonds', label: 'Actions vs refuge', description: 'SPY − TLT · rendement sur 20 séances', unit: 'pts', invert: false, series: ['SPY', 'TLT'], source: 'Tiingo',
    metric: (a, i) => { const s = change(a.SPY_ADJ, i, LAG, 'pct'), t = change(a.TLT_ADJ, i, LAG, 'pct'); return s === null || t === null ? null : s - t; } },
  { id: 'crypto', label: 'Momentum crypto', description: 'BTC et ETH · rendement moyen sur 20 séances', unit: '%', invert: false, series: ['BTC', 'ETH'], source: 'OKX',
    metric: (a, i) => { const b = change(a.BTC, i, LAG, 'pct'), e = change(a.ETH, i, LAG, 'pct'); return b === null || e === null ? null : (b + e) / 2; } },
];

export interface ComponentState {
  id: string; label: string; description: string; unit: string; source: string;
  raw: number | null; percentile: number | null; reason: string | null;
  last_dates: Record<string, string | null>;
}
export interface RiskState {
  date: string; index: number | null; zone: string | null; components_used: number;
  week_ago: { date: string; value: number | null } | null; month_ago: { date: string; value: number | null } | null;
  components: ComponentState[];
  history: { date: string; value: number }[];
  spy: { date: string; value: number }[]; vix: { date: string; value: number }[];
  zones: typeof ZONES; window: number; min_components: number;
}

/** Séries alignées sur les séances (dates de SPY) ; VIX de Cboe complété par FRED ; ratio CPER/GLD. */
export function align(series: Record<string, Obs[]>): { sessions: string[]; a: Record<string, (number | null)[]> } {
  const sessions = [...new Set((series.SPY ?? []).map((o) => o.date))].sort();
  const vix = new Map((series.VIX_FRED ?? []).map((o) => [o.date, o]));
  for (const o of series.VIX ?? []) vix.set(o.date, o);
  const a: Record<string, (number | null)[]> = {
    VIX: asOf(sessions, [...vix.values()]),
    SPY_ADJ: asOf(sessions, series.SPY ?? [], 'adj'),
    TLT_ADJ: asOf(sessions, series.TLT ?? [], 'adj'),
    HY_OAS: asOf(sessions, series.HY_OAS ?? []),
    AUDJPY: asOf(sessions, series.AUDJPY ?? []),
    BTC: asOf(sessions, series.BTC ?? []),
    ETH: asOf(sessions, series.ETH ?? []),
  };
  const cper = asOf(sessions, series.CPER ?? [], 'adj'), gld = asOf(sessions, series.GLD ?? [], 'adj');
  a.CPER_GLD = cper.map((c, i) => (c === null || gld[i] === null || gld[i] === 0 ? null : c / gld[i]!));
  return { sessions, a };
}

/** Percentile de chaque composante à chaque séance (null sans 252 valeurs consécutives). */
export function componentPercentiles(a: Record<string, (number | null)[]>, n: number): { raw: (number | null)[]; pct: (number | null)[] }[] {
  return COMPONENTS.map((c) => {
    const raw = Array.from({ length: n }, (_, i) => c.metric(a, i));
    const pct = raw.map((_, i) => {
      if (i < WINDOW - 1) return null;
      const w = raw.slice(i - WINDOW + 1, i + 1);
      if (w.some((x) => x === null)) return null;
      const p = percentileRank(w as number[]);
      return c.invert ? 100 - p : p;
    });
    return { raw, pct };
  });
}

function reasonFor(c: ComponentSpec, raw: (number | null)[], last: number, lastDates: Record<string, string | null>, date: string): string {
  for (const s of c.series) {
    const d = lastDates[s];
    if (!d) return `série ${s} absente`;
    if (days(d, date) > MAX_STALE_DAYS) return `série ${s} arrêtée au ${d}`;
  }
  const have = raw.slice(Math.max(0, last - WINDOW + 1), last + 1).filter((x) => x !== null).length;
  return `historique insuffisant (${have} séances sur ${WINDOW})`;
}

export function computeRisk(series: Record<string, Obs[]>): RiskState | null {
  const { sessions, a } = align(series);
  if (!sessions.length) return null;
  const n = sessions.length, last = n - 1, date = sessions[last];
  const comps = componentPercentiles(a, n);
  const indexAt = (i: number): { value: number | null; used: number } => {
    const ps = comps.map((c) => c.pct[i]).filter((p): p is number => p !== null);
    return { value: ps.length >= MIN_COMPONENTS ? ps.reduce((s, p) => s + p, 0) / ps.length : null, used: ps.length };
  };
  const lastDate = (id: string): string | null => {
    const obs = id === 'VIX' ? [...(series.VIX ?? []), ...(series.VIX_FRED ?? [])] : series[id] ?? [];
    return obs.reduce<string | null>((m, o) => (m === null || o.date > m ? o.date : m), null);
  };
  const components: ComponentState[] = COMPONENTS.map((c, k) => {
    const last_dates = Object.fromEntries(c.series.map((s) => [s, lastDate(s)]));
    const raw = comps[k].raw[last], pct = comps[k].pct[last];
    return { id: c.id, label: c.label, description: c.description, unit: c.unit, source: c.source,
      raw: raw === null ? null : round(raw, 2), percentile: pct === null ? null : round(pct, 1),
      reason: pct === null ? reasonFor(c, comps[k].raw, last, last_dates, date) : null, last_dates };
  });
  const now = indexAt(last);
  const ago = (lag: number) => (last - lag >= 0 ? { date: sessions[last - lag], value: (() => { const v = indexAt(last - lag).value; return v === null ? null : round(v, 1); })() } : null);
  const history: { date: string; value: number }[] = [];
  for (let i = Math.max(0, n - WINDOW); i < n; i++) { const v = indexAt(i).value; if (v !== null) history.push({ date: sessions[i], value: round(v, 1) }); }
  // Graphiques sur un an : clôture de SPY (non ajustée, comme à l'écran) et VIX, aux séances.
  const spyClose = new Map((series.SPY ?? []).map((o) => [o.date, o.value]));
  const start = Math.max(0, n - WINDOW);
  const spy = sessions.slice(start).flatMap((d) => { const v = spyClose.get(d); return v === undefined ? [] : [{ date: d, value: v }]; });
  const vix = sessions.slice(start).flatMap((d, j) => { const v = a.VIX[start + j]; return v === null ? [] : [{ date: d, value: v }]; });
  return {
    date, index: now.value === null ? null : round(now.value, 1), zone: now.value === null ? null : zoneOf(now.value).id, components_used: now.used,
    week_ago: ago(5), month_ago: ago(21), components, history,
    spy, vix, zones: ZONES, window: WINDOW, min_components: MIN_COMPONENTS,
  };
}

// ---------------------------------------------------------------------------------------------
// COT

export interface CotInput { market_code: string; date: string; category: string; long: number; short: number; open_interest: number }
export const COT_WEEKS = 156;
export const COT_MIN_WEEKS = 52;

export interface CotCategoryState {
  long: number; short: number; net: number; net_change_1w: number | null; net_pct_oi: number;
  percentile_3y: number | null; weeks: number;
}
export interface CotMarketState {
  code: string; label: string; group: string; date: string; open_interest: number;
  categories: Record<string, CotCategoryState>;
  history: { dates: string[]; net: Record<string, number[]> };
}

export function cotSummary(rows: CotInput[], markets: Record<string, { label: string; group: string }>): { report_date: string | null; markets: CotMarketState[] } {
  const out: CotMarketState[] = [];
  let report: string | null = null;
  for (const [code, m] of Object.entries(markets)) {
    const mine = rows.filter((r) => r.market_code === code);
    const dates = [...new Set(mine.map((r) => r.date))].sort().slice(-COT_WEEKS);
    if (!dates.length) continue;
    const date = dates[dates.length - 1];
    if (report === null || date > report) report = date;
    const cats = [...new Set(mine.map((r) => r.category))].sort();
    const byKey = new Map(mine.map((r) => [`${r.category}|${r.date}`, r]));
    const categories: Record<string, CotCategoryState> = {};
    const net: Record<string, number[]> = {};
    let oi = 0;
    for (const c of cats) {
      const series = dates.map((d) => byKey.get(`${c}|${d}`)).filter((r): r is CotInput => !!r);
      const nets = series.map((r) => r.long - r.short);
      const cur = byKey.get(`${c}|${date}`);
      if (!cur) continue;
      oi = cur.open_interest;
      const prev = dates.length > 1 ? byKey.get(`${c}|${dates[dates.length - 2]}`) : undefined;
      categories[c] = { long: cur.long, short: cur.short, net: cur.long - cur.short,
        net_change_1w: prev ? cur.long - cur.short - (prev.long - prev.short) : null,
        net_pct_oi: round(((cur.long - cur.short) / cur.open_interest) * 100, 1),
        percentile_3y: nets.length >= COT_MIN_WEEKS ? round(percentileRank(nets), 1) : null, weeks: nets.length };
      net[c] = nets;
    }
    out.push({ code, label: m.label, group: m.group, date, open_interest: oi, categories, history: { dates, net } });
  }
  return { report_date: report, markets: out };
}

// ---------------------------------------------------------------------------------------------
// Sentiment retail

export interface CrowdInput { exchange: string; symbol: string; metric: string; ts: string; value: number; long_share: number | null }
export const CROWD_DAYS = 30;

export interface CrowdMetricState {
  last: number; ts: string; long_share: number | null; avg_30d: number | null; deviation_pct: number | null;
  days_covered: number; partial: boolean; spark: number[];
}

export function crowdingSummary(rows: CrowdInput[], now: number): Record<string, Record<string, Record<string, CrowdMetricState>>> {
  const out: Record<string, Record<string, Record<string, CrowdMetricState>>> = {};
  const groups = new Map<string, CrowdInput[]>();
  for (const r of rows) {
    const k = `${r.symbol}|${r.exchange}|${r.metric}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const since = now - CROWD_DAYS * DAY;
  for (const [k, g] of groups) {
    const [symbol, exchange, metric] = k.split('|');
    const pts = g.filter((r) => Date.parse(r.ts) >= since).sort((x, y) => (x.ts < y.ts ? -1 : 1));
    if (!pts.length) continue;
    const lastP = pts[pts.length - 1];
    const covered = (Date.parse(lastP.ts) - Date.parse(pts[0].ts)) / DAY;
    const avg = metric === 'funding' ? null : pts.reduce((s, p) => s + p.value, 0) / pts.length;
    ((out[symbol] ??= {})[exchange] ??= {})[metric] = {
      last: lastP.value, ts: lastP.ts, long_share: lastP.long_share,
      avg_30d: avg === null ? null : round(avg, 4),
      deviation_pct: avg ? round((lastP.value / avg - 1) * 100, 1) : null,
      days_covered: round(covered, 1), partial: covered < CROWD_DAYS - 1,
      spark: pts.slice(-72).map((p) => p.value),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Liquidité nette de la Fed

export interface LiquidityPoint { date: string; net: number; walcl: number; tga: number; rrp: number }

/** Mercredis où l'actif et le compte du Trésor sont publiés ; reverse repo du jour ou d'avant (7 jours au plus), milliards -> millions. */
export function netLiquidity(walcl: Obs[], tga: Obs[], rrp: Obs[]): {
  last: LiquidityPoint | null; changes: Record<'w1' | 'w4' | 'w13' | 'w52', number | null>; history: LiquidityPoint[];
} {
  const t = new Map(tga.map((o) => [o.date, o.value]));
  const dates = walcl.map((o) => o.date).filter((d) => t.has(d)).sort();
  const r = asOf(dates, rrp);
  const w = new Map(walcl.map((o) => [o.date, o.value]));
  const history: LiquidityPoint[] = dates.flatMap((d, i) => (r[i] === null ? [] : [{
    date: d, walcl: w.get(d)!, tga: t.get(d)!, rrp: round(r[i]! * 1000, 0), net: round(w.get(d)! - t.get(d)! - r[i]! * 1000, 0) }]));
  const last = history[history.length - 1] ?? null;
  // Variation sur k semaines : point daté exactement 7·k jours plus tôt, sinon rien (jamais un autre écart).
  const byDate = new Map(history.map((p) => [p.date, p.net]));
  const ch = (k: number) => {
    if (!last) return null;
    const before = byDate.get(new Date(Date.parse(`${last.date}T00:00:00Z`) - 7 * k * DAY).toISOString().slice(0, 10));
    return before === undefined ? null : last.net - before;
  };
  return { last, changes: { w1: ch(1), w4: ch(4), w13: ch(13), w52: ch(52) }, history };
}

// ---------------------------------------------------------------------------------------------
// Bank Participation Report

export interface BprInput { report_date: string; market: string; banks: number | null; long: number; long_pct: number; short: number; short_pct: number; open_interest: number }
export interface BprMarketState {
  market: string; label: string; group: string; date: string; banks: number | null;
  long: number; short: number; net: number; long_pct: number; short_pct: number; net_pct_oi: number; open_interest: number;
  net_change_1m: number | null; history: { date: string; net: number }[];
}

/** Dernier mois par marché suivi, variation sur un mois, historique des positions nettes. */
export function bprSummary(rows: BprInput[], markets: Record<string, { label: string; group: string }>): { report_date: string | null; markets: BprMarketState[] } {
  let report: string | null = null;
  const out: BprMarketState[] = [];
  for (const [market, m] of Object.entries(markets)) {
    const mine = rows.filter((r) => r.market === market).sort((a, b) => (a.report_date < b.report_date ? -1 : 1));
    const cur = mine[mine.length - 1];
    if (!cur) continue;
    if (report === null || cur.report_date > report) report = cur.report_date;
    const prev = mine[mine.length - 2];
    const net = cur.long - cur.short;
    out.push({ market, label: m.label, group: m.group, date: cur.report_date, banks: cur.banks, long: cur.long, short: cur.short, net,
      long_pct: cur.long_pct, short_pct: cur.short_pct, net_pct_oi: round((net / cur.open_interest) * 100, 1), open_interest: cur.open_interest,
      net_change_1m: prev ? net - (prev.long - prev.short) : null, history: mine.map((r) => ({ date: r.report_date, net: r.long - r.short })) });
  }
  return { report_date: report, markets: out };
}
