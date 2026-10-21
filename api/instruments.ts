// GET /api/instruments — Paramètres de contrat OKX (ctVal, lotSz, tickSz…).
// Logique et tests : api/_lib/routes.ts, api/_tests/.
import { handleInstruments, defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleInstruments(request, defaultContext());
}
