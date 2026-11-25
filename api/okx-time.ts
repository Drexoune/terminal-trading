// GET /api/okx-time — Heure OKX pour l'écart d'horloge du navigateur (Mode Online).
// GET /api/okx-time?stat=… — statistiques publiques d'OKX relayées pour la microstructure (T-068) :
// même fonction, pour rester à 12 fonctions Vercel.
// Logique et tests : api/_lib/routes.ts, api/_tests/.
import { handleOkxStats, handleOkxTime, defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  const ctx = defaultContext();
  return new URL(request.url).searchParams.has('stat') ? handleOkxStats(request, ctx) : handleOkxTime(request, ctx);
}
