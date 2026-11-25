// Récap de séance sur la machine Oracle (P6, S4, T-074), service terminal-recap.
//
// - Registre de 24 h tenu en continu sur le flux local de la microstructure (CVD minute par
//   minute, liquidations, murs retirés, funding), sauvegardé toutes les minutes.
// - À la clôture de chaque séance (Asie, Londres, New York, fuseaux IANA) plus 5 min : faits
//   calculés par le code (web/src/recap/recap.ts) avec les bougies 1 min, les chiffres captés et
//   les titres urgents lus dans Supabase ; lecture de Gemini (offre gratuite, 6 par jour)
//   contrôlée (aucun chiffre non sourcé, réécrite une fois) ; sans lecture valable : faits seuls
//   (« lecture automatique »). Écrit dans p1_state (recap:<date>:<séance>), lu par /api/p1/recaps.
//
// Secrets (T-070, T-074) dans /etc/terminal/bt.env : SUPABASE_URL, SUPABASE_SECRET_KEY
// (« oracle »), GEMINI_API_KEY. État sans secret : /var/lib/terminal-recap/status.json.

import { pathToFileURL } from 'node:url';
import { factsText, PROMPTS, verifyAnswer, DAILY_CAPS } from '../../api/_lib/assistant-core';
import { callGeminiWith, MODEL, parisDay } from '../../api/_lib/gemini-pine';
import { createRest, type Json, type Rest } from '../../supabase/functions/p1-jobs/rest';
import type { FetchLike as PgFetch } from '../../supabase/functions/okx-collector/postgrest';
import { closedSessions, Ledger, recapFacts, recapKey, type Candle, type Figure, type Headline, type LedgerSave, type LiqRow, type Recap, type WallRow, type Window } from '../../web/src/recap/recap';
import { SseParser } from '../shared/sse-client';
import { loadJson, saveJson } from '../micro/persist';

export const CHECK_MS = 60_000;
export const AFTER_CLOSE_MS = 5 * 60_000;
export const LOOKBACK_MS = 3 * 3_600_000;           // rattrape une séance manquée (redémarrage) pendant 3 h
export const KEEP_MS = 30 * 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

export interface RecapDeps {
  rest: Rest; env: (n: string) => string | undefined;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  sseFetch: (url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;
  now: () => number; sleep: (ms: number) => Promise<void>;
  microUrl: string; stateFile?: string; writeStatus?: (s: Record<string, unknown>) => void;
}

export class RecapService {
  readonly ledger = new Ledger();
  funding8h: number | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  status: Record<string, unknown> = {};

  constructor(private readonly d: RecapDeps) {
    const saved = d.stateFile ? loadJson<LedgerSave>(d.stateFile) : null;
    if (saved) this.ledger.restore(saved, d.now());
  }

  start(): void {
    void this.sseLoop();
    this.timer = setInterval(() => { void this.tick(); }, CHECK_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.save();
  }

  save(): void { if (this.d.stateFile) { try { saveJson(this.d.stateFile, this.ledger.save()); } catch (e) { console.error('récap : registre non sauvegardé', e); } } }

  onMicro(items: [string, unknown][], now: number): void {
    for (const [k, v] of items) {
      if (k === 'micro:cvd') { const c = v as { series?: { t: number[]; perp: number[]; spot: number[] }; ready?: boolean }; if (c.ready && c.series) this.ledger.addCvd(c.series, now); }
      else if (k === 'micro:liqs') this.ledger.addLiqs(((v as { rows?: LiqRow[] }).rows ?? []));
      else if (k === 'micro:depth') this.ledger.addWalls(((v as { walls?: WallRow[] }).walls ?? []));
      else if (k === 'micro:funding') this.funding8h = (v as { total?: { rate_8h?: number | null } }).total?.rate_8h ?? null;
    }
  }

  private async sseLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const r = await this.d.sseFetch(`${this.d.microUrl}/micro/stream`);
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
        const parser = new SseParser();
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done || this.stopped) break;
          for (const ev of parser.push(dec.decode(value, { stream: true }))) {
            if (ev.event === 'state' || ev.event === 'items') this.onMicro(JSON.parse(ev.data) as [string, unknown][], this.d.now());
          }
        }
      } catch (e) { this.status.micro_error = (e as Error).message; }
      if (!this.stopped) await this.d.sleep(5_000);
    }
  }

  /** Chaque minute : registre sauvegardé, séances closes depuis 5 min à 3 h sans récap → récap. */
  async tick(): Promise<void> {
    const now = this.d.now();
    this.ledger.prune(now);
    this.save();
    for (const w of closedSessions(now, LOOKBACK_MS).filter((x) => now - x.to >= AFTER_CLOSE_MS)) {
      const key = recapKey(w);
      const have = await this.d.rest.select('p1_state', { select: 'key', key: `eq.${key}`, limit: '1' });
      if (have.length) continue;
      try { await this.produce(w); } catch (e) { this.status.last_error = `${key} : ${(e as Error).message}`.slice(0, 300); console.error('récap', e); }
    }
    await this.d.rest.remove('p1_state', { key: 'like.recap:*', updated_ms: `lt.${now - KEEP_MS}` });
    this.d.writeStatus?.({ at: now, cvd_minutes: this.ledger.cvd.perp.size, liqs: this.ledger.liqs.length, walls: this.ledger.walls.length, ...this.status });
  }

  async produce(w: Window): Promise<Recap> {
    const { rest } = this.d;
    const now = this.d.now();
    const rows = await rest.select<{ t: string; o: number; h: number; l: number; c: number }>('okx_candles_1m', {
      select: 't,o,h,l,c', inst: 'eq.BTC-USDT-SWAP', t: `gte.${iso(w.from)}`, order: 't.asc', limit: '700' });   // séance ≤ 510 min
    const candles: Candle[] = rows.map((r) => ({ t: Date.parse(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c) })).filter((k) => k.t < w.to);
    const rel = await rest.select<{ value: { label_fr?: string | null; indicator?: string; value?: string | null; unit?: string | null; bus_ms?: number | null } }>('p1_state', {
      select: 'value', key: 'like.release:us-*', limit: '200' });
    const figures: Figure[] = rel.map((r) => r.value).filter((f) => f.value && f.bus_ms && f.bus_ms >= w.from && f.bus_ms < w.to)
      .map((f) => ({ label: f.label_fr ?? f.indicator ?? '—', value: String(f.value), unit: f.unit ?? null, at: f.bus_ms ?? null }));
    const news = await rest.select<{ title: string; source: string; published_ms: number | null; received_ms: number }>('news_items', {
      select: 'title,source,published_ms,received_ms', urgent: 'eq.true', received_ms: `gte.${w.from}`, order: 'received_ms.asc', limit: '50' });
    const headlines: Headline[] = news.filter((n) => n.received_ms < w.to).slice(0, 5).map((n) => ({ title: n.title, source: n.source, at: n.published_ms ?? n.received_ms }));
    const facts = recapFacts(w, { candles, ledger: this.ledger, funding8h: this.funding8h, figures, headlines });

    let text: string | null = null, sources: string[] = [], reason: string | null = null, model: string | null = null;
    const key = this.d.env('GEMINI_API_KEY')?.trim();
    const day = parisDay(now);
    if (!key) reason = 'clé Gemini absente : faits seuls (lecture automatique)';
    else {
      let prompt = `Séance ${w.label} du ${w.date}.\n\nfacts :\n${factsText(facts)}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        const used = (await rest.select('bt_ai_calls', { select: 'id', day: `eq.${day}`, cached: 'eq.false', route: 'eq.recap' })).length;
        if (used >= DAILY_CAPS.recap) { reason = `plafond de ${DAILY_CAPS.recap} récaps par jour atteint (offre gratuite) : faits seuls`; break; }
        try {
          const r = await callGeminiWith(this.d.fetch, key, PROMPTS.recap, prompt);
          const answer = typeof r.data.answer === 'string' ? r.data.answer : '';
          const src = Array.isArray(r.data.sources) ? r.data.sources.map(String) : [];
          const v = verifyAnswer(answer, src, facts);
          await rest.insert('bt_ai_calls', [{ day, route: 'recap', model: MODEL, status: v.ok ? 200 : 422, input_tokens: r.input_tokens, output_tokens: r.output_tokens, error: v.ok ? null : `écartée : ${v.reason}` }]);
          if (v.ok) { text = answer; sources = src; model = MODEL; reason = null; break; }
          reason = `lecture écartée (${v.reason}) : faits seuls`;
          prompt += `\n\nTa lecture précédente a été écartée (${v.reason}). Recopie exactement les nombres des faits cités, sans aucun calcul.`;
        } catch (e) {
          const g = e as { status?: number; message?: string };
          await rest.insert('bt_ai_calls', [{ day, route: 'recap', model: MODEL, status: g.status ?? 0, error: String(g.message).slice(0, 300) }]);
          reason = g.status === 429 ? 'quota gratuit de Google atteint : faits seuls' : `Gemini indisponible (${g.status ?? 0}) : faits seuls`;
          break;
        }
      }
    }
    const recap: Recap = { key: recapKey(w), session: w.session, label: w.label, date: w.date, from: w.from, to: w.to, facts, text, sources, reason, model, generated_ms: now };
    await rest.upsert('p1_state', [{ key: recap.key, value: recap as unknown as Json, updated_ms: now }], 'key');
    this.status.last_recap = { key: recap.key, at: now, text: !!text, facts: facts.length };
    return recap;
  }
}

// Lancement par systemd (deploy/oracle/terminal-recap.service).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (n: string) => process.env[n];
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SECRET_KEY');
  if (!url || !key) { console.error('récap : SUPABASE_URL ou SUPABASE_SECRET_KEY absente de /etc/terminal/bt.env'); process.exit(2); }
  const s = new RecapService({
    rest: createRest(url, key, ((u: string, i?: RequestInit) => fetch(u, i)) as unknown as PgFetch), env,
    fetch: (u, i) => fetch(u, i), sseFetch: (u) => fetch(u), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    microUrl: env('MICRO_URL') ?? 'http://127.0.0.1:8720', stateFile: env('RECAP_STATE') ?? '/var/lib/terminal-recap/ledger.json',
    writeStatus: (v) => { try { saveJson(env('RECAP_STATUS') ?? '/var/lib/terminal-recap/status.json', v); } catch { /* état seulement */ } },
  });
  s.start();
  console.log('récap : service démarré');
  process.on('SIGTERM', () => { console.log('récap : SIGTERM, registre sauvegardé'); s.stop(); setTimeout(() => process.exit(0), 1_000); });
}
