// GET /api/collector-health — État du collecteur Supabase (Mode Online).
// Logique et tests : api/_lib/routes.ts, api/_tests/.
import { handleCollectorHealth, defaultContext } from './_lib/routes.js';

export function GET(request: Request): Promise<Response> {
  return handleCollectorHealth(request, defaultContext());
}
