// GET /api/health — Santé des fonctions Vercel (bouton « Tester » des Paramètres).
// Logique et tests : api/_lib/routes.ts, api/_tests/.
import { handleHealth, defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleHealth(request, defaultContext());
}
