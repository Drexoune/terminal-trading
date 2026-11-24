// /api/macro/* — P3 (macro et heatmap) : une seule fonction Vercel, atteinte par la réécriture de
// vercel.json. Logique et tests : api/_lib/macro.ts, api/_tests/macro.test.ts.
import { handleMacro } from './_lib/macro.js';
import { defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleMacro(request, defaultContext());
}
