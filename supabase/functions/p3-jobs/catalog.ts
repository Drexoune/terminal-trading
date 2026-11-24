// Catalogue des séries de P3 (décision T-056, codes relevés en M0 le 24/11/2026,
// docs/exploration-p3.md). Une série = une économie × un indicateur × une source.
//
// - États-Unis : FRED ; zone euro : BCE (inflation, chômage, PIB) et OCDE (confiance, ventes) ;
//   6 autres économies : OCDE (relevé hors Supabase, décision T-057) ; taux : BIS mensuel.
// - `transform` : `level` (valeur publiée telle quelle), `yoy` (variation sur un an calculée depuis
//   un indice : 12 mois ou 4 trimestres). Une série sans source porte sa raison.

export const ECONOMIES = ['US', 'EA', 'GB', 'JP', 'CH', 'CA', 'AU', 'NZ'] as const;
export type Economy = (typeof ECONOMIES)[number];

export const CURRENCY: Record<Economy, string> = { US: 'USD', EA: 'EUR', GB: 'GBP', JP: 'JPY', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD' };
/** Banque centrale (codes de P2, p2-jobs/meetings.ts). */
export const BANK: Record<Economy, string> = { US: 'FED', EA: 'BCE', GB: 'BOE', JP: 'BOJ', CH: 'BNS', CA: 'BOC', AU: 'RBA', NZ: 'RBNZ' };
/** Code de zone du BIS (WS_CBPOL) et de l'OCDE. */
export const BIS_AREA: Record<Economy, string> = { US: 'US', EA: 'XM', GB: 'GB', JP: 'JP', CH: 'CH', CA: 'CA', AU: 'AU', NZ: 'NZ' };
export const OECD_AREA: Record<Economy, string> = { US: 'USA', EA: 'EA20', GB: 'GBR', JP: 'JPN', CH: 'CHE', CA: 'CAN', AU: 'AUS', NZ: 'NZL' };
/** Cible d'inflation de chaque banque (milieu de la fourchette quand elle en publie une). */
export const INFLATION_TARGET: Record<Economy, { mid: number; text: string }> = {
  US: { mid: 2, text: '2 %' }, EA: { mid: 2, text: '2 %' }, GB: { mid: 2, text: '2 %' }, JP: { mid: 2, text: '2 %' },
  CH: { mid: 1, text: '0–2 %' }, CA: { mid: 2, text: '2 % (1–3 %)' }, AU: { mid: 2.5, text: '2–3 %' }, NZ: { mid: 2, text: '2 % (1–3 %)' },
};

export const INDICATORS = ['policy', 'cpi', 'cpi_core', 'gdp', 'unemployment', 'confidence', 'retail'] as const;
export type Indicator = (typeof INDICATORS)[number];
export const INDICATOR_LABEL: Record<Indicator, string> = {
  policy: 'Taux directeur', cpi: 'IPC sur un an', cpi_core: 'IPC sous-jacent sur un an', gdp: 'PIB sur un an',
  unemployment: 'Taux de chômage', confidence: 'Confiance des consommateurs', retail: 'Ventes au détail sur un an',
};

export type Source = 'fred' | 'ecb' | 'oecd' | 'bis';
export interface SeriesSpec {
  id: string;                 // « US:cpi »
  economy: Economy;
  indicator: Indicator;
  source: Source;
  code: string;               // identifiant FRED, clé BCE, clé OCDE (flux|clé) ou zone BIS
  freq: 'M' | 'Q';
  transform: 'level' | 'yoy';
  unit: '%' | 'pts';
  url: string;                // page publique de la série
}
export interface MissingSpec { id: string; economy: Economy; indicator: Indicator; reason: string }

const OECD_CPI18 = 'OECD.SDD.TPS,DSD_PRICES_COICOP2018@DF_PRICES_C2018_ALL,1.0';
const OECD_CPI99 = 'OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0';
const OECD_UNE = 'OECD.SDD.TPS,DSD_LFS@DF_IALFS_UNE_M,1.0';
const OECD_QNA = 'OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA,1.1';
const OECD_CS = 'OECD.SDD.STES,DSD_STES@DF_CS,4.0';
const OECD_KEI = 'OECD.SDD.STES,DSD_KEI@DF_KEI,4.0';
const OECD_EXPLORER = 'https://data-explorer.oecd.org/';

function fred(economy: Economy, indicator: Indicator, code: string, freq: 'M' | 'Q', transform: 'level' | 'yoy', unit: '%' | 'pts' = '%'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'fred', code, freq, transform, unit,
    url: `https://fred.stlouisfed.org/series/${code}` };
}
function ecb(economy: Economy, indicator: Indicator, code: string, freq: 'M' | 'Q'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'ecb', code, freq, transform: 'level', unit: '%',
    url: `https://data.ecb.europa.eu/data/datasets/${code.split('/')[0]}/${code.replace('/', '.')}` };
}
function oecd(economy: Economy, indicator: Indicator, flow: string, key: string, freq: 'M' | 'Q', unit: '%' | 'pts' = '%'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'oecd', code: `${flow}|${key}`, freq, transform: 'level', unit, url: OECD_EXPLORER };
}

/** Clés de l'OCDE par économie (zone à la première place, sauf le PIB). */
function oecdSeries(e: Exclude<Economy, 'US' | 'EA'>): SeriesSpec[] {
  const a = OECD_AREA[e];
  // IPC : COICOP 2018 pour le Japon, la Suisse et le Canada (l'ancien jeu s'y arrête) ; ancien jeu ailleurs.
  const cpi18 = e === 'JP' || e === 'CH' || e === 'CA';
  const cpiFreq: 'M' | 'Q' = e === 'NZ' || e === 'AU' ? 'Q' : 'M';   // Australie : mensuel seulement depuis 2025-04
  const cpiKey = (exp: string) => (cpi18 ? `${a}.${cpiFreq}.N.CPI..${exp}..GY` : `${a}.${cpiFreq}.N.CPI.PA.${exp}.N.GY`);
  const quarterlyLabour = e === 'CH' || e === 'NZ';
  return [
    oecd(e, 'cpi', cpi18 ? OECD_CPI18 : OECD_CPI99, cpiKey('_T'), cpiFreq),
    oecd(e, 'cpi_core', cpi18 ? OECD_CPI18 : OECD_CPI99, cpiKey('_TXCP01_NRG'), cpiFreq),
    oecd(e, 'unemployment', OECD_UNE, `${a}.UNE_LF_M...Y._T.Y_GE15..${quarterlyLabour ? 'Q' : 'M'}`, quarterlyLabour ? 'Q' : 'M'),
    oecd(e, 'gdp', OECD_QNA, `Q.Y.${a}.S1.S1.B1GQ._Z._Z._Z.PC.L.GY.T0102`, 'Q'),
    ...(e === 'CA' ? [] : [oecd(e, 'confidence', OECD_CS, `${a}.${quarterlyLabour ? 'Q' : 'M'}.CCICP......`, quarterlyLabour ? 'Q' : 'M', 'pts')]),
    ...(e === 'AU' || e === 'NZ' ? [] : [oecd(e, 'retail', OECD_KEI, `${a}.M.TOVM.GR.G47.Y.GY`, 'M')]),
  ];
}

export const SERIES: SeriesSpec[] = [
  fred('US', 'cpi', 'CPIAUCSL', 'M', 'yoy'),
  fred('US', 'cpi_core', 'CPILFESL', 'M', 'yoy'),
  fred('US', 'gdp', 'GDPC1', 'Q', 'yoy'),
  fred('US', 'unemployment', 'UNRATE', 'M', 'level'),
  fred('US', 'confidence', 'UMCSENT', 'M', 'level', 'pts'),
  fred('US', 'retail', 'RSAFS', 'M', 'yoy'),
  ecb('EA', 'cpi', 'HICP/M.U2.N.000000.4D0.ANR', 'M'),
  ecb('EA', 'cpi_core', 'HICP/M.U2.N.XEF000.4D0.ANR', 'M'),
  ecb('EA', 'unemployment', 'LFSI/M.I10.S.UNEHRT.TOTAL0.15_74.T', 'M'),
  ecb('EA', 'gdp', 'MNA/Q.Y.I10.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.GY', 'Q'),
  oecd('EA', 'confidence', OECD_CS, 'EA20.M.CCICP......', 'M', 'pts'),
  oecd('EA', 'retail', OECD_KEI, 'EA20.M.TOVM.GR.G47.Y.GY', 'M'),
  ...(['GB', 'JP', 'CH', 'CA', 'AU', 'NZ'] as const).flatMap(oecdSeries),
  ...[...ECONOMIES].map((e): SeriesSpec => ({ id: `${e}:policy`, economy: e, indicator: 'policy', source: 'bis', code: BIS_AREA[e],
    freq: 'M', transform: 'level', unit: '%', url: 'https://data.bis.org/topics/CBPOL' })),
];

export const MISSING: MissingSpec[] = [
  { id: 'CA:confidence', economy: 'CA', indicator: 'confidence', reason: 'indice du Conference Board of Canada, privé (T-056)' },
  { id: 'AU:retail', economy: 'AU', indicator: 'retail', reason: 'série de l’OCDE arrêtée en 2026-05 (T-056)' },
  { id: 'NZ:retail', economy: 'NZ', indicator: 'retail', reason: 'aucune série mensuelle libre (T-056)' },
];

export const FX_SERIES: Record<Exclude<Economy, 'US'>, { code: string; invert: boolean }> = {
  // Dollars par unité (DEXUS..) ou unités par dollar (DEX..US) : tout est ramené en dollars par unité.
  EA: { code: 'DEXUSEU', invert: false }, GB: { code: 'DEXUSUK', invert: false }, AU: { code: 'DEXUSAL', invert: false },
  NZ: { code: 'DEXUSNZ', invert: false }, JP: { code: 'DEXJPUS', invert: true }, CH: { code: 'DEXSZUS', invert: true },
  CA: { code: 'DEXCAUS', invert: true },
};

export const seriesById = (id: string) => SERIES.find((s) => s.id === id);
