// GET /api/okx-time — Heure OKX pour l'écart d'horloge du navigateur (Mode Online).
// Logique et tests : api/_lib/routes.ts, api/_tests/.
import { handleOkxTime, defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleOkxTime(request, defaultContext());
}
