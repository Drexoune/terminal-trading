// /api/rates/* — écran Taux (plan P2, étape R2) : une seule fonction Vercel, atteinte par la
// réécriture de vercel.json. Logique et tests : api/_lib/rates.ts, api/_tests/rates.test.ts.
import { handleRates } from './_lib/rates.js';
import { defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleRates(request, defaultContext());
}
