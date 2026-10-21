// GET /api/chart — Graphique BTC du Mode Online (même JSON que la passerelle).
// Logique et tests : api/_lib/routes.ts, api/_tests/.
import { handleChart, defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleChart(request, defaultContext());
}
