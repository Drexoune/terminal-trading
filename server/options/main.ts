// Options BTC sur la machine Oracle (P7, S3, T-075), service terminal-options.
//
// Toutes les 5 min, API publique de Deribit sans clé (3 requêtes) : indice btc_usd, DVOL (dernier
// point), résumé de toutes les options BTC. Calcul web/src/analysis/options.ts (sourire, vol ATM,
// risk reversal et butterfly 25 delta, structure par terme, open interest). Écrit :
// - options:latest dans p1_state (toutes les 5 min) ;
// - options:history dans p1_state (chaque heure) : nos relevés réduits à un point par heure sur
//   90 jours, et le DVOL horaire de Deribit sur 90 jours (repris au démarrage, complété ensuite).
// Historique complet de nos relevés sur le disque de la machine (un fichier JSONL par mois).
// Secrets : /etc/terminal/bt.env (SUPABASE_URL, SUPABASE_SECRET_KEY). Trous journalisés dans l'état.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRest, type Json, type Rest } from '../../supabase/functions/p1-jobs/rest';
import type { FetchLike as PgFetch } from '../../supabase/functions/okx-collector/postgrest';
import { downsample, histPoint, snapshotOptions, type HistPoint, type SummaryRow } from '../../web/src/analysis/options';
import { saveJson } from '../micro/persist';

export const DERIBIT = 'https://www.deribit.com/api/v2/public';
export const EVERY_MS = 5 * 60_000;
export const KEEP_MS = 90 * 86_400_000;
const HOUR = 3_600_000;
const UA = 'TERMINAL/0.1 (terminal personnel, lecture seule)';

export interface OptionsDeps {
  rest: Rest; fetch: (url: string, init?: RequestInit) => Promise<Response>; now: () => number;
  dir?: string; writeStatus?: (s: Record<string, unknown>) => void;
}

const month = (ms: number) => new Date(ms).toISOString().slice(0, 7);

export class OptionsService {
  points: HistPoint[] = [];
  dvol = new Map<number, number>();            // heure (ms) → clôture du DVOL
  status: Record<string, unknown> = { gaps: [] as { from: number; to: number }[] };
  lastOk = 0; lastHistory = -1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly d: OptionsDeps) {
    if (d.dir) {
      try {
        for (const f of readdirSync(d.dir).filter((x) => /^snap-\d{4}-\d{2}\.jsonl$/.test(x)).sort()) {
          for (const line of readFileSync(join(d.dir, f), 'utf8').split('\n')) if (line.trim()) { try { this.points.push(JSON.parse(line) as HistPoint); } catch { /* ligne coupée */ } }
        }
      } catch { /* premier démarrage */ }
      const from = d.now() - KEEP_MS;
      this.points = this.points.filter((p) => p.t >= from);
    }
  }

  start(): void { void this.tick(); this.timer = setInterval(() => { void this.tick(); }, 30_000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }

  private async get<T>(method: string, params: Record<string, string>): Promise<T> {
    const r = await this.d.fetch(`${DERIBIT}/${method}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    const body = await r.json().catch(() => ({})) as { result?: T; error?: { message?: string } };
    if (!r.ok || body.result === undefined) throw new Error(`Deribit ${method} : HTTP ${r.status}${body.error?.message ? ` (${body.error.message})` : ''}`);
    return body.result;
  }

  /** DVOL horaire entre deux instants, pages de Deribit suivies par « continuation ». */
  async loadDvol(from: number, to: number): Promise<void> {
    let end = to;
    for (let page = 0; page < 10 && end > from; page++) {
      const r = await this.get<{ data: [number, number, number, number, number][]; continuation: number | null }>('get_volatility_index_data',
        { currency: 'BTC', start_timestamp: String(from), end_timestamp: String(end), resolution: '3600' });
      for (const [t, , , , c] of r.data) this.dvol.set(t, c);
      if (!r.continuation || r.continuation >= end) break;
      end = r.continuation;
    }
    const keep = this.d.now() - KEEP_MS;
    for (const t of this.dvol.keys()) if (t < keep) this.dvol.delete(t);
  }

  async pass(): Promise<void> {
    const now = this.d.now();
    const index = (await this.get<{ index_price: number }>('get_index_price', { index_name: 'btc_usd' })).index_price;
    const rows = await this.get<SummaryRow[]>('get_book_summary_by_currency', { currency: 'BTC', kind: 'option' });
    await this.loadDvol(this.dvol.size ? now - 3 * HOUR : now - KEEP_MS, now);
    const lastDvol = [...this.dvol.entries()].sort((a, b) => a[0] - b[0]).at(-1)?.[1] ?? null;
    const snap = snapshotOptions(rows, index, lastDvol, now);
    if (!snap.expiries.length) throw new Error('aucune échéance lisible dans le résumé de Deribit');
    const p = histPoint(snap);
    this.points.push(p);
    if (this.d.dir) { mkdirSync(this.d.dir, { recursive: true }); appendFileSync(join(this.d.dir, `snap-${month(now)}.jsonl`), `${JSON.stringify(p)}\n`); }
    this.points = this.points.filter((x) => x.t >= now - KEEP_MS);
    await this.d.rest.upsert('p1_state', [{ key: 'options:latest', value: { ...snap, source: 'Deribit, API publique (get_book_summary_by_currency, DVOL)' } as unknown as Json, updated_ms: now }], 'key');
    if (this.lastOk && now - this.lastOk > 2 * EVERY_MS) (this.status.gaps as { from: number; to: number }[]).push({ from: this.lastOk, to: now });
    this.status.gaps = (this.status.gaps as { from: number; to: number }[]).slice(-20);
    this.lastOk = now;
    this.status.last = { at: now, expiries: snap.expiries.length, instruments: snap.instruments, atm30: snap.atm30, dvol: lastDvol };
    const hour = Math.floor(now / HOUR);
    if (hour !== this.lastHistory) {
      const dvol = [...this.dvol.entries()].sort((a, b) => a[0] - b[0]);
      await this.d.rest.upsert('p1_state', [{ key: 'options:history', value: { points: downsample(this.points, HOUR, now - KEEP_MS), dvol, computed_ms: now } as unknown as Json, updated_ms: now }], 'key');
      this.lastHistory = hour;
    }
  }

  async tick(): Promise<void> {
    const now = this.d.now();
    if (now - this.lastOk >= EVERY_MS - 15_000) {
      try { await this.pass(); this.status.error = null; } catch (e) { this.status.error = `${new Date(now).toISOString()} ${(e as Error).message}`.slice(0, 300); console.error('options', e); }
    }
    this.d.writeStatus?.({ at: now, points: this.points.length, dvol_hours: this.dvol.size, ...this.status });
  }
}

// Lancement par systemd (deploy/oracle/terminal-options.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (n: string) => process.env[n];
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) { console.error('options : SUPABASE_URL ou SUPABASE_SECRET_KEY absente de /etc/terminal/bt.env'); process.exit(2); }
  const s = new OptionsService({
    rest: createRest(url, key, ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as PgFetch),
    fetch: (u, i) => fetch(u, i), now: () => Date.now(), dir: env('OPTIONS_DIR') ?? '/var/lib/terminal-options',
    writeStatus: (v) => { try { saveJson(env('OPTIONS_STATUS') ?? '/var/lib/terminal-options/status.json', v); } catch { /* état seulement */ } },
  });
  s.start();
  console.log(`options : service démarré (${s.points.length} relevés relus)`);
  process.on('SIGTERM', () => { console.log('options : SIGTERM'); s.stop(); setTimeout(() => process.exit(0), 500); });
}
