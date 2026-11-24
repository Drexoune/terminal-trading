// Écrans Heatmap et Macro (plan P3, M5) : forme des données de /api/macro/* et logique d'affichage
// pure, testée. Données : clé de store « macro:state » ; séries « macro:series:<ÉCO>:<IND>:<ANS> ».
// Rien n'est calculé ici hors des écarts affichés (paire) : scores, z et niveaux viennent de p3-jobs.

import { fmtNumber, fmtSigned, MINUS, NBSP } from '../lib/format';

export const MACRO_KEY = 'macro:state';
export const seriesKey = (economy: string, indicator: string, years: number) => `macro:series:${economy}:${indicator}:${years}`;

export const ECONOMIES = ['US', 'EA', 'GB', 'JP', 'CH', 'CA', 'AU', 'NZ'] as const;
export type Economy = (typeof ECONOMIES)[number];
export const CURRENCY: Record<Economy, string> = { US: 'USD', EA: 'EUR', GB: 'GBP', JP: 'JPY', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD' };
export const FLAG: Record<Economy, string> = { US: 'us', EA: 'eu', GB: 'gb', JP: 'jp', CH: 'ch', CA: 'ca', AU: 'au', NZ: 'nz' };
export const BANK_NAME: Record<Economy, string> = {
  US: 'Réserve fédérale', EA: 'Banque centrale européenne', GB: 'Banque d’Angleterre', JP: 'Banque du Japon', CH: 'Banque nationale suisse',
  CA: 'Banque du Canada', AU: 'Banque de réserve d’Australie', NZ: 'Banque de réserve de Nouvelle-Zélande',
};
export const ECONOMY_NAME: Record<Economy, string> = {
  US: 'États-Unis', EA: 'Zone euro', GB: 'Royaume-Uni', JP: 'Japon', CH: 'Suisse', CA: 'Canada', AU: 'Australie', NZ: 'Nouvelle-Zélande',
};
export const economyOf = (code: string): Economy | undefined =>
  (ECONOMIES as readonly string[]).includes(code) ? code as Economy : ECONOMIES.find((e) => CURRENCY[e] === code);

export const THEMES = ['rates', 'inflation', 'growth', 'employment', 'activity', 'sentiment', 'surprises'] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABEL: Record<Theme, string> = {
  rates: 'Taux', inflation: 'Inflation', growth: 'Croissance', employment: 'Emploi', activity: 'Activité', sentiment: 'Sentiment', surprises: 'Surprises',
};
export const INDICATORS = ['policy', 'cpi', 'cpi_core', 'gdp', 'unemployment', 'confidence', 'retail'] as const;
export type Indicator = (typeof INDICATORS)[number];
export const INDICATOR_LABEL: Record<Indicator, string> = {
  policy: 'Taux directeur', cpi: 'IPC sur un an', cpi_core: 'IPC sous-jacent sur un an', gdp: 'PIB sur un an',
  unemployment: 'Taux de chômage', confidence: 'Confiance des consommateurs', retail: 'Ventes au détail sur un an',
};
export const SOURCE_LABEL: Record<string, string> = {
  fred: 'FRED', ecb: 'BCE', bis: 'BIS', dbnomics: 'DBnomics', statcan: 'Statistics Canada', snb: 'BNS',
};

export type Bias = 'BULLISH' | 'NEUTRAL' | 'BEARISH';
export interface ScoreCell {
  theme: Theme; x: number | null; value: number | null; unit: '%' | 'pts' | ''; period: string | null; indicator: Indicator | null;
  reason: string | null; stale: boolean; z: number | null; level: number | null;
}
export interface ScoreRow { economy: Economy; score: number; rank: number; bias: Bias; cells: ScoreCell[] }
export interface Scores { date: string; themes: Theme[]; excluded: { theme: Theme; reason: string }[]; rows: ScoreRow[]; computed_ms: number }
export interface SheetValue {
  indicator: Indicator; label: string; value: number | null; period: string | null; previous: { value: number; period: string } | null;
  source: string | null; url: string | null; transform: string | null; stale: boolean; reason: string | null;
}
export interface Sheet { currency: string; bank: string; target: { mid: number; text: string }; values: SheetValue[] }
export interface Measure { horizon: number; signal: 'niveau' | 'variation'; ic: number; t: number | null; n: number;
  halves: { ic: number; t: number | null; n: number }[]; spread_bp: number | null }
export interface Backtest { from: string; to: string; months: number; themes: string[]; measures: Measure[]; proven: boolean; verdict: string;
  caveats: string[]; computed_ms: number }
export interface RatesInfo { bank: string; name: string | null; tz: string | null;
  policy: { display?: number; range?: [number, number] | null; date?: string; last_change?: { date: string; from: number; to: number } | null; label?: string } | null;
  next: { date: string | null } | null }
export interface MacroReply {
  configured: boolean; reason?: string;
  scores: Scores | null; sheets: { date: string; economies: Record<Economy, Sheet>; computed_ms: number } | null;
  backtest: Backtest | null; feed: { status?: string; last_error?: string | null; last_message_ms?: number | null } | null;
  series: { id: string; source: string; last_period: string | null; last_ok_ms: number | null; last_error: string | null }[];
  rates: Partial<Record<Economy, RatesInfo | null>>; computed_ms: number;
}
export interface SeriesReply { economy: Economy; indicator: Indicator; years: number; points: { period: string; value: number }[]; computed_ms: number }

// --- formats -----------------------------------------------------------------------------------

/** « 2026-10 » -> « 10/2026 » ; « 2026-Q3 » -> « T3 2026 ». */
export function fmtPeriod(p: string | null | undefined): string {
  if (!p) return '—';
  const q = /^(\d{4})-Q([1-4])$/.exec(p);
  if (q) return `T${q[2]} ${q[1]}`;
  return `${p.slice(5, 7)}/${p.slice(0, 4)}`;
}
/** Valeur d'une case de la matrice : « 3,85 % », « +1,1 », « — ». */
export function fmtCellValue(c: ScoreCell): string {
  if (c.value === null) return '—';
  if (c.theme === 'sentiment') return fmtSigned(c.value, 1);
  if (c.theme === 'surprises') return fmtSigned(c.value, 0);
  return `${fmtNumber(c.value, c.theme === 'rates' ? 2 : 1)}${c.unit === '%' ? `${NBSP}%` : ''}`;
}
/** Niveau de couleur (−2 à +2) -> classe du composant Cell du design system. */
export function cellLevel(level: number | null): 'up-2' | 'up-1' | 'neutral' | 'down-1' | 'down-2' {
  return level === 2 ? 'up-2' : level === 1 ? 'up-1' : level === -1 ? 'down-1' : level === -2 ? 'down-2' : 'neutral';
}
export const fmtScore = (s: number) => (s > 0 ? `+${s}` : s < 0 ? `${MINUS}${-s}` : '0');
export const valueOf = (sheet: Sheet | undefined, ind: Indicator) => sheet?.values.find((v) => v.indicator === ind);

// --- paire ---------------------------------------------------------------------------------

/** Indicateurs du comparateur de paire ; `higherIsBetter` : un chiffre plus haut favorise la devise. */
export const PAIR_ROWS: { indicator: Indicator; label: string; higherIsBetter: boolean }[] = [
  { indicator: 'policy', label: 'Taux directeur', higherIsBetter: true },
  { indicator: 'cpi', label: 'IPC 1 an', higherIsBetter: true },
  { indicator: 'cpi_core', label: 'IPC sous-jacent', higherIsBetter: true },
  { indicator: 'gdp', label: 'PIB 1 an', higherIsBetter: true },
  { indicator: 'unemployment', label: 'Chômage', higherIsBetter: false },
  { indicator: 'retail', label: 'Ventes au détail', higherIsBetter: true },
];

/** Contre-devise par défaut : l'USD, ou l'EUR quand l'USD est sélectionné. */
export const counterpart = (e: Economy): Economy => (e === 'US' ? 'EA' : 'US');

export interface PairRow { indicator: Indicator; label: string; a: SheetValue | undefined; b: SheetValue | undefined; diff: number | null; favors: 'a' | 'b' | null }

/** Article devant un code de devise : « l'USD », « l'EUR », « le JPY ». */
export const withArticle = (code: string) => (/^[AEIOUY]/.test(code) ? `l’${code}` : `le ${code}`);

export function pair(a: Sheet | undefined, b: Sheet | undefined): { rows: PairRow[]; verdict: string | null; winsA: number; winsB: number; compared: number } {
  const rows = PAIR_ROWS.map((r): PairRow => {
    const va = valueOf(a, r.indicator), vb = valueOf(b, r.indicator);
    if (va?.value == null || vb?.value == null) return { indicator: r.indicator, label: r.label, a: va, b: vb, diff: null, favors: null };
    const diff = Math.round((va.value - vb.value) * 100) / 100;
    const favors = diff === 0 ? null : (diff > 0) === r.higherIsBetter ? 'a' : 'b';
    return { indicator: r.indicator, label: r.label, a: va, b: vb, diff, favors };
  });
  const winsA = rows.filter((r) => r.favors === 'a').length, winsB = rows.filter((r) => r.favors === 'b').length;
  const compared = rows.filter((r) => r.diff !== null).length;
  const verdict = !a || !b || !compared ? null
    : winsA === winsB ? `Fondamentaux partagés entre ${a.currency} et ${b.currency} (${winsA} indicateurs chacun)`
      : `Les fondamentaux favorisent ${withArticle(winsA > winsB ? a.currency : b.currency)} sur ${Math.max(winsA, winsB)} indicateurs sur ${compared}`;
  return { rows, verdict, winsA, winsB, compared };
}

// --- lecture automatique (T-055) -----------------------------------------------------------------

export interface Sentence { text: string; sources: string[] }

const cite = (v: SheetValue | undefined) => (v?.value == null ? null : `${SOURCE_LABEL[v.source ?? ''] ?? v.source}, ${fmtPeriod(v.period)}`);
const pct = (x: number, d = 1) => `${fmtNumber(x, d)}${NBSP}%`;

/**
 * 4 à 6 phrases construites à partir des seuls chiffres affichés, chacune avec ses sources (T-055).
 * Aucune phrase sans chiffre ; un chiffre absent n'apparaît pas (sa raison est dans la fiche).
 */
export function reading(e: Economy, row: ScoreRow | undefined, sheet: Sheet | undefined, rates: RatesInfo | null | undefined,
  backtest: Backtest | null, days: number | null): Sentence[] {
  const out: Sentence[] = [];
  const c = CURRENCY[e];
  if (row) out.push({ text: `${c} : biais ${row.bias.toLowerCase()}, score relatif ${fmtScore(row.score)}.`, sources: ['score de la heatmap'] });
  const policy = rates?.policy?.display ?? valueOf(sheet, 'policy')?.value ?? null;
  const cpi = valueOf(sheet, 'cpi'), core = valueOf(sheet, 'cpi_core');
  if (policy !== null && cpi?.value != null) {
    const gap = cpi.value - (sheet?.target.mid ?? 2);
    const where = Math.abs(gap) <= 0.3 ? 'proche de la cible' : gap > 0 ? 'au-dessus de la cible' : 'sous la cible';
    out.push({ text: `Taux directeur à ${pct(policy, 2)} pour une inflation de ${pct(cpi.value)}${core?.value != null ? ` (sous-jacente ${pct(core.value)})` : ''}, ${where} de ${sheet?.target.text ?? '2 %'}.`,
      sources: [rates?.policy?.display != null ? 'BIS' : cite(valueOf(sheet, 'policy'))!, cite(cpi)!, ...(core?.value != null ? [cite(core)!] : [])] });
  }
  const gdp = valueOf(sheet, 'gdp'), un = valueOf(sheet, 'unemployment');
  if (gdp?.value != null || un?.value != null) {
    const parts = [gdp?.value != null ? `croissance ${pct(gdp.value)}` : null, un?.value != null ? `chômage ${pct(un.value)}` : null].filter(Boolean);
    out.push({ text: `${parts.join(', ').replace(/^./, (m) => m.toUpperCase())}.`, sources: [cite(gdp), cite(un)].filter((x): x is string => !!x) });
  }
  if (rates?.next?.date && days !== null && days >= 0) {
    out.push({ text: `Prochaine réunion le ${rates.next.date.slice(8, 10)}/${rates.next.date.slice(5, 7)}/${rates.next.date.slice(0, 4)} (J-${days}).`, sources: ['calendrier officiel'] });
  }
  // Le verdict du backtest n'entre pas dans la lecture : la puce de l'en-tête le porte déjà.
  void backtest;
  return out.slice(0, 6);
}
