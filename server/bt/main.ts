// Recherche autonome du backtest sur la machine Oracle (T-064, T-070) : la boucle de l'Edge
// Function bt-jobs (supabase/functions/bt-jobs/loop.ts) appelée en continu, sans la limite de
// 2 s de calcul des Edge Functions. Passages de 5 min au plus, bail de 6 min renouvelé après
// chaque essai ; rien à faire : nouvel essai dans 15 s ; erreur : 60 s. Si ce service s'arrête,
// le bail expire et le cron de Supabase reprend la recherche (repli automatique).
//
// Secrets (T-070) : SUPABASE_URL, SUPABASE_SECRET_KEY (clé dédiée « oracle », révocable) et
// GEMINI_API_KEY, lus dans /etc/terminal/bt.env par systemd ; jamais écrits ailleurs.
// État lisible sans secret : /var/lib/terminal-bt/status.json, repris par /micro/health.

import { pathToFileURL } from 'node:url';
import { saveJson } from '../micro/persist';
import { runLoop, type LoopDeps } from '../../supabase/functions/bt-jobs/loop';
import { createRest, type Json, type Rest } from '../../supabase/functions/p1-jobs/rest';
import type { FetchLike } from '../../supabase/functions/okx-collector/postgrest';

export const PASS_MS = 300_000;
export const LEASE_MS = 360_000;
export const IDLE_MS = 15_000;
export const ERROR_MS = 60_000;

export interface PassStatus {
  at: number; loop: string | null; idle: boolean; attempts: number | null; compute_ms: number | null;
  status: string | null; waiting: string | null; lost: boolean; error: string | null; passes: number;
}

export interface RunnerDeps {
  rest: Rest; env: (n: string) => string | undefined;
  fetch: LoopDeps['fetch']; now: () => number;
  sleep: (ms: number) => Promise<void>;
  writeStatus: (s: PassStatus) => void;
  run?: typeof runLoop;                      // remplaçable en test
}

/** Un passage, puis le délai avant le suivant (0 : enchaîner). */
export async function onePass(d: RunnerDeps, passes: number): Promise<{ status: PassStatus; delay: number }> {
  const at = d.now();
  try {
    const r = await (d.run ?? runLoop)({ rest: d.rest, env: d.env, fetch: d.fetch, now: d.now, wallBudgetMs: PASS_MS, computeBudgetMs: PASS_MS, leaseMs: LEASE_MS }) as Record<string, Json>;
    const idle = r.idle === true || typeof r.busy === 'string';
    const status: PassStatus = {
      at, loop: typeof r.loop === 'string' ? r.loop : null, idle, attempts: typeof r.attempts === 'number' ? r.attempts : null,
      compute_ms: typeof r.compute_ms === 'number' ? r.compute_ms : null, status: typeof r.status === 'string' ? r.status : null,
      waiting: typeof r.waiting === 'string' ? r.waiting : null, lost: r.lost === true, error: null, passes,
    };
    return { status, delay: idle || status.waiting ? IDLE_MS : 0 };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    return { status: { at, loop: null, idle: false, attempts: null, compute_ms: null, status: null, waiting: null, lost: false, error: msg, passes }, delay: ERROR_MS };
  }
}

/** Boucle du service ; `stopped()` est relu entre deux passages (SIGTERM). */
export async function runForever(d: RunnerDeps, stopped: () => boolean): Promise<void> {
  let passes = 0;
  while (!stopped()) {
    const { status, delay } = await onePass(d, ++passes);
    d.writeStatus(status);
    if (status.error) console.error(`bt : ${status.error}`);
    else if (!status.idle) console.log(`bt : recherche ${status.loop}, ${status.attempts ?? '?'} essais, ${status.compute_ms ?? 0} ms de calcul${status.status ? `, ${status.status}` : ''}${status.waiting ? `, attente : ${status.waiting}` : ''}${status.lost ? ', bail repris ailleurs' : ''}`);
    if (delay && !stopped()) await d.sleep(delay);
  }
}

// Lancement par systemd (deploy/oracle/terminal-bt.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (n: string) => process.env[n];
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) { console.error('bt : SUPABASE_URL ou SUPABASE_SECRET_KEY absente de /etc/terminal/bt.env'); process.exit(2); }
  const statusFile = env('BT_STATUS') ?? '/var/lib/terminal-bt/status.json';
  let stop = false;
  process.on('SIGTERM', () => { console.log('bt : SIGTERM, arrêt après le passage en cours (le bail expire sinon)'); stop = true; });
  console.log('bt : service démarré');
  void runForever({
    rest: createRest(url, key, ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as FetchLike),
    env, fetch: (u, i) => fetch(u, i), now: () => Date.now(),
    sleep: (ms) => new Promise((r) => { const t = setInterval(() => { if (stop) { clearInterval(t); r(); } }, 1_000); setTimeout(() => { clearInterval(t); r(); }, ms); }),
    writeStatus: (s) => { try { saveJson(statusFile, s); } catch (e) { console.error('bt : état illisible', e); } },
  }, () => stop).then(() => process.exit(0));
}
