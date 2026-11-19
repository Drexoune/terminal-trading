// GLEIF : ISIN → entité LEI → pays du siège (sert la règle PEA d'une action).
// GET https://api.gleif.org/api/v1/lei-records?filter[isin]=<ISIN>, sans clé ;
// réponse réelle du 19/11/2026 dans supabase/functions/bourse-jobs/fixtures.
// Les ETF (ISIN de fonds) n'y sont généralement pas : réponse vide.

export const GLEIF_URL = 'https://api.gleif.org/api/v1/lei-records';

export interface GleifEntity { lei: string; legalName: string; hqCountry: string | null; legalCountry: string | null; status: string | null }

export function gleifUrl(isin: string): string {
  return `${GLEIF_URL}?${new URLSearchParams({ 'filter[isin]': isin })}`;
}

/** Première entité LEI de la réponse, ou null si l'ISIN n'est rattaché à aucune. */
export function parseGleifIsin(body: unknown): GleifEntity | null {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('GLEIF : champ data attendu');
  const first = data[0] as { attributes?: Record<string, any> } | undefined;
  if (!first?.attributes) return null;
  const a = first.attributes;
  const country = (v: unknown) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : null);
  if (typeof a.lei !== 'string' || !/^[A-Z0-9]{18}[0-9]{2}$/.test(a.lei)) throw new Error('GLEIF : LEI illisible');
  return {
    lei: a.lei,
    legalName: String(a.entity?.legalName?.name ?? '').slice(0, 200),
    hqCountry: country(a.entity?.headquartersAddress?.country),
    legalCountry: country(a.entity?.legalAddress?.country),
    status: typeof a.registration?.status === 'string' ? a.registration.status : null,
  };
}
