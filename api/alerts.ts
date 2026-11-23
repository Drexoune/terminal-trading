// /api/alerts/* — alertes en Mode Online (O4) : une seule fonction Vercel, atteinte par la
// réécriture de vercel.json. Logique et tests : api/_lib/alerts.ts, api/_tests/alerts.test.ts.
import { handleAlerts } from './_lib/alerts.js';
import { defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleAlerts(request, defaultContext());
}

export function POST(request: Request): Promise<Response> {
  return handleAlerts(request, defaultContext());
}

export function PATCH(request: Request): Promise<Response> {
  return handleAlerts(request, defaultContext());
}

export function DELETE(request: Request): Promise<Response> {
  return handleAlerts(request, defaultContext());
}
