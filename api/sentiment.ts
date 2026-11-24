// /api/sentiment/* — P4 (sentiment et liquidité) : une seule fonction Vercel, atteinte par la
// réécriture de vercel.json. Logique et tests : api/_lib/sentiment.ts, api/_tests/sentiment.test.ts.
import { handleSentiment } from './_lib/sentiment.js';
import { defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleSentiment(request, defaultContext());
}
