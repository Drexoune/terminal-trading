// Catalogue des séries de P3 (décisions T-056 et T-058, codes relevés le 24/11/2026,
// docs/exploration-p3.md § 7 et § 8). Une série = une économie × un indicateur × une source.
//
// - États-Unis : FRED ; zone euro : BCE ; Royaume-Uni : ONS (copie DBnomics) ; Japon : Statistics
//   Japan (copie DBnomics) et FRED ; Suisse : BNS ; Canada : Statistics Canada ; Australie : RBA
//   (copie DBnomics) ; Nouvelle-Zélande : FRED ; taux directeurs : BIS mensuel. L'OCDE refuse
//   Supabase et Vercel (T-057, T-058) : aucune série n'en dépend.
// - `transform` : `level` (valeur publiée telle quelle), `yoy` (variation sur un an calculée depuis
//   un indice ou un niveau : 12 mois ou 4 trimestres), `yoy_qoq` (variation sur un an chaînée depuis
//   quatre variations trimestrielles publiées, marquée « calculé »). Une série sans source porte sa raison.

export const ECONOMIES = ['US', 'EA', 'GB', 'JP', 'CH', 'CA', 'AU', 'NZ'] as const;
export type Economy = (typeof ECONOMIES)[number];

export const CURRENCY: Record<Economy, string> = { US: 'USD', EA: 'EUR', GB: 'GBP', JP: 'JPY', CH: 'CHF', CA: 'CAD', AU: 'AUD', NZ: 'NZD' };
/** Banque centrale (codes de P2, p2-jobs/meetings.ts). */
export const BANK: Record<Economy, string> = { US: 'FED', EA: 'BCE', GB: 'BOE', JP: 'BOJ', CH: 'BNS', CA: 'BOC', AU: 'RBA', NZ: 'RBNZ' };
/** Code de zone du BIS (WS_CBPOL). */
export const BIS_AREA: Record<Economy, string> = { US: 'US', EA: 'XM', GB: 'GB', JP: 'JP', CH: 'CH', CA: 'CA', AU: 'AU', NZ: 'NZ' };
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

export type Source = 'fred' | 'ecb' | 'bis' | 'dbnomics' | 'statcan' | 'snb';
export interface SeriesSpec {
  id: string;                 // « US:cpi »
  economy: Economy;
  indicator: Indicator;
  source: Source;
  code: string;               // identifiant FRED, clé BCE, zone BIS, série DBnomics (fournisseur/jeu/série, « + » pour fusionner),
                              // vecteur Statistics Canada, cube BNS et dimensions (« cube|D0|D1 »)
  freq: 'M' | 'Q';
  transform: 'level' | 'yoy' | 'yoy_qoq';
  unit: '%' | 'pts';
  url: string;                // page publique de la série
}
export interface MissingSpec { id: string; economy: Economy; indicator: Indicator; reason: string }

function fred(economy: Economy, indicator: Indicator, code: string, freq: 'M' | 'Q', transform: SeriesSpec['transform'], unit: '%' | 'pts' = '%'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'fred', code, freq, transform, unit,
    url: `https://fred.stlouisfed.org/series/${code}` };
}
function ecb(economy: Economy, indicator: Indicator, code: string, freq: 'M' | 'Q'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'ecb', code, freq, transform: 'level', unit: '%',
    url: `https://data.ecb.europa.eu/data/datasets/${code.split('/')[0]}/${code.replace('/', '.')}` };
}
function dbn(economy: Economy, indicator: Indicator, code: string, freq: 'M' | 'Q', transform: SeriesSpec['transform'] = 'level'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'dbnomics', code, freq, transform, unit: '%',
    url: `https://db.nomics.world/${code.split('+')[0]}` };
}
function statcan(economy: Economy, indicator: Indicator, vector: number, freq: 'M' | 'Q', transform: SeriesSpec['transform'] = 'level'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'statcan', code: String(vector), freq, transform, unit: '%',
    url: `https://www150.statcan.gc.ca/t1/tbl1/en/cv.action?vectorId=${vector}` };
}
function snb(economy: Economy, indicator: Indicator, code: string, freq: 'M' | 'Q'): SeriesSpec {
  return { id: `${economy}:${indicator}`, economy, indicator, source: 'snb', code, freq, transform: 'level', unit: '%',
    url: `https://data.snb.ch/en/topics/uvo/cube/${code.split('|')[0]}` };
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
  dbn('GB', 'cpi', 'ONS/MM23/D7G7.M', 'M'),
  dbn('GB', 'cpi_core', 'ONS/MM23/DKO8.M', 'M'),
  dbn('GB', 'unemployment', 'ONS/LMS/MGSX.M', 'M'),
  dbn('GB', 'gdp', 'ONS/QNA/IHYR.Q+ONS/PN2/IHYR.Q', 'Q'),   // QNA révisé d'abord, PN2 pour le trimestre le plus récent
  dbn('GB', 'retail', 'ONS/DRSI/J5EK.M', 'M', 'yoy'),
  dbn('JP', 'cpi', 'STATJP/CPIm/001', 'M', 'yoy'),
  dbn('JP', 'cpi_core', 'STATJP/CPIm/740', 'M', 'yoy'),   // hors produits frais et énergie
  fred('JP', 'unemployment', 'LRHUTTTTJPM156S', 'M', 'level'),
  fred('JP', 'gdp', 'JPNRGDPEXP', 'Q', 'yoy'),
  snb('CH', 'cpi', 'plkopr|VVP', 'M'),
  snb('CH', 'unemployment', 'amarbma|S1', 'M'),            // chômeurs inscrits, corrigé des variations saisonnières (SECO)
  snb('CH', 'gdp', 'gdpap|VVP|BBIPS', 'Q'),                // corrigé des événements sportifs (SECO)
  statcan('CA', 'cpi', 41690973, 'M', 'yoy'),
  statcan('CA', 'cpi_core', 108785714, 'M'),               // IPC-médian, sur un an
  statcan('CA', 'unemployment', 2062815, 'M'),
  statcan('CA', 'gdp', 62305752, 'Q', 'yoy'),
  dbn('AU', 'cpi', 'RBA/G1/GCPIAGYP', 'Q'),
  dbn('AU', 'cpi_core', 'RBA/G1/GCPIOCPMTMYP', 'Q'),        // moyenne tronquée
  dbn('AU', 'unemployment', 'RBA/H5/GLFSURSA', 'M'),
  dbn('AU', 'gdp', 'RBA/H1/GGDPCVGDPY', 'Q'),
  fred('NZ', 'unemployment', 'LRUN64TTNZQ156S', 'Q', 'level'),
  fred('NZ', 'gdp', 'NAEXKP01NZQ657S', 'Q', 'yoy_qoq'),
  ...[...ECONOMIES].map((e): SeriesSpec => ({ id: `${e}:policy`, economy: e, indicator: 'policy', source: 'bis', code: BIS_AREA[e],
    freq: 'M', transform: 'level', unit: '%', url: 'https://data.bis.org/topics/CBPOL' })),
];

const PRIVATE = 'indice privé (T-058)';
export const MISSING: MissingSpec[] = [
  { id: 'NZ:cpi', economy: 'NZ', indicator: 'cpi', reason: 'Stats NZ exige une clé ; pas encore demandée (T-058)' },
  { id: 'NZ:cpi_core', economy: 'NZ', indicator: 'cpi_core', reason: 'Stats NZ exige une clé ; pas encore demandée (T-058)' },
  { id: 'CH:cpi_core', economy: 'CH', indicator: 'cpi_core', reason: 'série de la BNS pas encore identifiée' },
  { id: 'EA:confidence', economy: 'EA', indicator: 'confidence', reason: 'Commission européenne : source à vérifier (T-058)' },
  { id: 'JP:confidence', economy: 'JP', indicator: 'confidence', reason: 'Cabinet Office : source à vérifier (T-058)' },
  { id: 'CH:confidence', economy: 'CH', indicator: 'confidence', reason: 'SECO : source à vérifier (T-058)' },
  { id: 'GB:confidence', economy: 'GB', indicator: 'confidence', reason: `GfK : ${PRIVATE}` },
  { id: 'CA:confidence', economy: 'CA', indicator: 'confidence', reason: `Conference Board of Canada : ${PRIVATE}` },
  { id: 'AU:confidence', economy: 'AU', indicator: 'confidence', reason: `Westpac : ${PRIVATE}` },
  { id: 'NZ:confidence', economy: 'NZ', indicator: 'confidence', reason: `ANZ et Westpac : ${PRIVATE}` },
  { id: 'EA:retail', economy: 'EA', indicator: 'retail', reason: 'série de la BCE pas encore identifiée' },
  { id: 'JP:retail', economy: 'JP', indicator: 'retail', reason: 'METI : copie DBnomics arrêtée en 2023' },
  { id: 'CA:retail', economy: 'CA', indicator: 'retail', reason: 'vecteur 52367097 arrêté en 2022-12 (table remplacée) : nouveau vecteur à identifier' },
  { id: 'CH:retail', economy: 'CH', indicator: 'retail', reason: 'source pas encore identifiée' },
  { id: 'AU:retail', economy: 'AU', indicator: 'retail', reason: 'l’ABS a remplacé la série par un indicateur de dépenses des ménages' },
  { id: 'NZ:retail', economy: 'NZ', indicator: 'retail', reason: 'aucune série mensuelle libre' },
];

export const FX_SERIES: Record<Exclude<Economy, 'US'>, { code: string; invert: boolean }> = {
  // Dollars par unité (DEXUS..) ou unités par dollar (DEX..US) : tout est ramené en dollars par unité.
  EA: { code: 'DEXUSEU', invert: false }, GB: { code: 'DEXUSUK', invert: false }, AU: { code: 'DEXUSAL', invert: false },
  NZ: { code: 'DEXUSNZ', invert: false }, JP: { code: 'DEXJPUS', invert: true }, CH: { code: 'DEXSZUS', invert: true },
  CA: { code: 'DEXCAUS', invert: true },
};

export const seriesById = (id: string) => SERIES.find((s) => s.id === id);
