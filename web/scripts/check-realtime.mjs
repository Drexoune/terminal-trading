// Contrôle de bout en bout de Supabase Realtime pour P1 (plan « Tout en ligne », O5).
//
// 1. Rejoint le canal public « p1-public » avec la clé PUBLISHABLE, comme le navigateur.
// 2. Réécrit la ligne feed:calendar de p1_state (même valeur, nouvelle heure) avec la clé
//    secrète du .env du Mac (outil local, jamais dans le front) : le trigger p1_state_broadcast
//    doit la diffuser.
// 3. Mesure le délai entre l'écriture et l'arrivée du message. Rien d'autre n'est modifié.
//
// Usage, depuis web/ :  node scripts/check-realtime.mjs

import { readFileSync } from 'node:fs';
import { RealtimeClient } from '@supabase/realtime-js';

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const url = env.VITE_SUPABASE_URL;
const pub = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_SECRET_KEY;
if (!url || !pub?.startsWith('sb_publishable_') || !secret) {
  console.error('VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (sb_publishable_…) et SUPABASE_SECRET_KEY attendus dans le .env');
  process.exit(2);
}

const rest = (path, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: secret, 'Content-Type': 'application/json', ...init.headers } });
const client = new RealtimeClient(`${url.replace(/^http/i, 'ws')}/realtime/v1`, { params: { apikey: pub } });
const channel = client.channel('p1-public', { config: { broadcast: { self: false }, private: false } });
let written = null;
const timeout = setTimeout(() => { console.error('aucun message reçu en 15 s'); process.exit(1); }, 15_000);

channel.on('broadcast', { event: 'state' }, ({ payload }) => {
  if (payload?.key !== 'feed:calendar' || written === null) return;
  console.log(`message reçu : ${payload.key}, ${Date.now() - written} ms après l'écriture`);
  clearTimeout(timeout);
  client.disconnect().then(() => process.exit(0));
});

channel.subscribe(async (status, err) => {
  console.log(`canal p1-public : ${status}${err ? ` (${err.message})` : ''}`);
  if (status !== 'SUBSCRIBED') return;
  const [row] = await (await rest('p1_state?select=value&key=eq.feed:calendar')).json();
  if (!row) { console.error('feed:calendar absent de p1_state'); process.exit(1); }
  written = Date.now();
  const r = await rest('p1_state?key=eq.feed:calendar', { method: 'PATCH', body: JSON.stringify({ value: row.value, updated_ms: written }) });
  console.log(`écriture : HTTP ${r.status}`);
});
