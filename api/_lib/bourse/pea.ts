// Éligibilité au PEA (docs/plan-bourse.md § 1 et 2, docs/plan-b0.md B0.4).
//
// Règle appliquée, volontairement prudente :
// - action : éligible si le siège de l'émetteur est dans l'Union européenne ou
//   dans l'Espace économique européen (Islande, Liechtenstein, Norvège). Le
//   pays vient de GLEIF (adresse du siège de l'entité LEI), jamais du préfixe
//   de l'ISIN : une société néerlandaise peut avoir un ISIN FR, et l'inverse.
//   Condition d'impôt sur les sociétés au taux normal supposée remplie : à
//   vérifier pour les cas particuliers (SIIC, sociétés exonérées) ;
// - ETF : éligible seulement s'il figure dans la table ci-dessous (fonds dont
//   la documentation annonce l'éligibilité) ; sinon « inconnu », jamais
//   « éligible » par défaut. Le préfixe FR d'un ETF ne prouve rien.
// Le verdict garde sa raison et sa source, affichées à côté de la ligne.

/** Union européenne (27) et Espace économique européen (IS, LI, NO), codes ISO 3166-1. */
export const EEA = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU',
  'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'IS', 'LI', 'NO',
]);

/**
 * ETF éligibles au PEA : ISIN → [mnémonique Euronext Paris, nom]. Reprise de
 * la table du Trading Desk (T-032), complétée des lignes du portefeuille ;
 * mnémoniques contrôlés sur OpenFIGI le 19/11/2026.
 */
export const PEA_ETFS: Record<string, readonly [string, string]> = {
  FR0011550185: ['ESE', 'BNP Paribas Easy S&P 500 UCITS ETF EUR C'],
  FR0011871128: ['PSP5', 'Amundi PEA S&P 500 UCITS ETF Acc'],
  FR0013412285: ['PE500', 'Amundi PEA S&P 500 Screened UCITS ETF Acc'],
  FR0011871110: ['PUST', 'Amundi PEA Nasdaq-100 UCITS ETF Acc'],
  FR001400ZGR7: ['PNAS', 'Amundi PEA Nasdaq-100 UCITS ETF S Acc'],
  FR0013412269: ['PANX', 'Amundi PEA US Tech ESG UCITS ETF'],
  FR0010342592: ['LQQ', 'Amundi Nasdaq-100 Daily (2x) Leveraged UCITS ETF'],
  LU1681043599: ['CW8', 'Amundi MSCI World Swap UCITS ETF EUR Acc'],
  LU2655993207: ['EWLD', 'Amundi MSCI World Swap UCITS ETF Dist'],
  IE0002XZSHO1: ['WPEA', 'iShares MSCI World Swap PEA UCITS ETF EUR Acc'],
  FR001400U5Q4: ['DCAM', 'Amundi PEA Monde (MSCI World) UCITS ETF Acc'],
  FR0013412020: ['PAEEM', 'Amundi PEA MSCI Emerging ESG Transition UCITS ETF'],
  FR0007052782: ['CAC', 'Amundi CAC 40 UCITS ETF Acc'],
};

export type InstrumentKind = 'action' | 'etf' | 'fonds' | 'uc' | 'fonds_euros' | 'livret';

export interface PeaVerdict { eligible: boolean | null; reason: string; source: string }

export function peaVerdict(input: { kind: InstrumentKind; isin: string | null; hqCountry: string | null }): PeaVerdict {
  const { kind, isin, hqCountry } = input;
  if (kind === 'etf') {
    if (isin && PEA_ETFS[isin]) return { eligible: true, reason: 'ETF de la table des fonds éligibles', source: 'table ETF' };
    return { eligible: null, reason: 'ETF absent de la table : vérifier le document d’information de l’émetteur', source: 'table ETF' };
  }
  if (kind === 'action') {
    if (!hqCountry) return { eligible: null, reason: 'pays du siège inconnu', source: 'GLEIF' };
    return EEA.has(hqCountry)
      ? { eligible: true, reason: `siège dans l’EEE (${hqCountry})`, source: 'GLEIF' }
      : { eligible: false, reason: `siège hors de l’EEE (${hqCountry})`, source: 'GLEIF' };
  }
  return { eligible: false, reason: 'seuls les actions et les ETF éligibles entrent dans un PEA', source: 'règle' };
}
