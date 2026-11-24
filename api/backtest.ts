// /api/backtest/* — section Backtest (T-061) : une seule fonction Vercel (la 12e, dernière place de
// l'offre Hobby), atteinte par la réécriture de vercel.json. Logique et tests :
// api/_lib/backtest.ts, api/_tests/backtest.test.ts.
import { handleBacktest } from './_lib/backtest.js';
import { defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleBacktest(request, defaultContext());
}

export function POST(request: Request): Promise<Response> {
  return handleBacktest(request, defaultContext());
}
