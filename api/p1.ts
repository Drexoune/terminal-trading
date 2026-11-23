// /api/p1/* — P1 en Mode Online (plan « Tout en ligne ») : une seule fonction Vercel,
// atteinte par la réécriture de vercel.json. Logique et tests : api/_lib/p1.ts, api/_tests/p1.test.ts.
import { handleP1 } from './_lib/p1.js';
import { defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleP1(request, defaultContext());
}

export function POST(request: Request): Promise<Response> {
  return handleP1(request, defaultContext());
}
