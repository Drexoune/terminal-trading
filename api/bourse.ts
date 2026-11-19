// /api/bourse/* — Module Bourse (étape B0) : une seule fonction Vercel pour
// toutes les routes du module, atteinte par la réécriture de vercel.json.
// Logique et tests : api/_lib/bourse/routes.ts, api/_tests/bourse-*.test.ts.
import { defaultContext } from './_lib/routes.js';
import { handleBourse } from './_lib/bourse/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleBourse(request, defaultContext());
}

export function POST(request: Request): Promise<Response> {
  return handleBourse(request, defaultContext());
}

export function DELETE(request: Request): Promise<Response> {
  return handleBourse(request, defaultContext());
}
