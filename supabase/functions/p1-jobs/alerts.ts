// Moteur d'alertes en ligne (plan « Tout en ligne », O4) : portage de
// gateway/terminal_gateway/alert_service.py dans l'Edge Function p1-jobs.
//
// - Tâche « alerts », chaque minute (pg_cron) : prix, funding, T-n min avant un événement,
//   chiffre publié (filet si l'appel direct de la capture a échoué).
// - La capture appelle fireReleaseAlerts dès qu'un chiffre est enregistré : Telegram part dans
//   la seconde, sans attendre la minute suivante.
// - Tâche « alerts-cmd » : écritures de l'écran /alertes (créer, modifier, supprimer, acquitter,
//   essai Telegram), relayées par la fonction Vercel /api/alerts derrière le mot de passe
//   d'application (T-031, T-043). Validation et secrets Telegram restent ici.
//
// Règles : mêmes sortes, validation, libellés et messages que la passerelle (alert_rules.ts,
// vérifié contre le fichier doré de Python). Un déclenchement par règle et par objet
// (unique (rule_id, dedupe)). Une publication de plus de 2 h (rattrapage d'arriéré) n'alerte pas.
//
// Prix : chaque bougie 1 min d'okx_candles_1m après un curseur gardé dans p1_state ;
// franchissement si la clôture précédente est d'un côté du niveau et que le haut (ou le bas)
// de la bougie l'atteint. Les bougies arrivent environ 2 min après leur ouverture (collecteur
// okx-collector) : une alerte de prix en ligne part donc avec 2 à 3 min de retard. Au premier
// passage, le curseur se pose sans rien déclencher.
//
// État publié dans p1_state (alert:rule:<id>, alert:fired:<id>, alert:summary), JAMAIS diffusé
// sur le canal public (le trigger p1_state_broadcast ne connaît que les clés publiques) : le
// front le relit par /api/alerts/state, derrière le mot de passe.

import * as ar from './alert_rules.ts';
import type { Json, Rest, Row } from './rest.ts';
import { sendTelegram, telegramConfigured, type TgDeps } from './telegram.ts';

const PARIS = 'Europe/Paris';
const MIN = 60_000;
const DAY = 86_400_000;
const SEEN_MS = 3 * DAY;
const FRESH_MS = 120_000;
const PUBLICATION_ALERT_MS = 2 * 3_600_000;
const PUBLISHED_EVENTS = 50;
const STALE_FIRED_MS = 7 * DAY;
export const INSTRUMENTS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];
const TEST_TEXT = 'Essai : les alertes du terminal arrivent bien sur ce téléphone (envoyé par Supabase).';

export interface AlertDeps extends TgDeps { rest: Rest }

export interface Rule {
  id: number; kind: string; params: ar.Params; channels: string[]; state: string; label: string; category: string;
  created_ms: number; updated_ms: number; last_fired_ms: number | null; error?: string | null;
}

interface Fired {
  id: string; rule_id: number; dedupe: string; fired_ms: number; title: string; body: string; source: string;
  source_ms: number | null; data: Record<string, unknown>; telegram: string | null;
}

const hm = (ms: number, seconds = false) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23' }).format(ms);
const day = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms);

function newId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const parse = (v: unknown, fallback: unknown) => {
  if (typeof v !== 'string') return v ?? fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

async function getState<T>(rest: Rest, key: string): Promise<T | null> {
  const rows = await rest.select<{ value: T }>('p1_state', { select: 'value', key: `eq.${key}`, limit: '1' });
  return rows[0]?.value ?? null;
}

async function putState(rest: Rest, entries: [string, unknown][], now: number): Promise<void> {
  if (entries.length) await rest.upsert('p1_state', entries.map(([key, value]) => ({ key, value: value as Json, updated_ms: now })), 'key');
}

export function ruleFromRow(r: Row): Rule {
  const params = parse(r.params, {}) as ar.Params;
  const channels = parse(r.channels, []) as string[];
  const base = { id: Number(r.id), kind: String(r.kind), state: String(r.state), created_ms: Number(r.created_ms),
    updated_ms: Number(r.updated_ms), last_fired_ms: (r.last_fired_ms as number | null) ?? null };
  try {
    const [p, c] = ar.validate(base.kind, params, channels, INSTRUMENTS);
    const [label, category] = ar.describe(base.kind, p);
    return { ...base, params: p, channels: c, label, category, error: null };
  } catch (e) {
    // Règle illisible (modifiée à la main en base) : montrée, jamais évaluée.
    return { ...base, params, channels, state: 'désactivée', label: `Règle invalide : ${(e as Error).message}`, category: '—',
      error: (e as Error).message };
  }
}

function eventPayload(e: Row, rule: Rule | undefined): Record<string, unknown> {
  return { id: e.id, rule_id: Number(e.rule_id), kind: rule?.kind ?? null, rule_label: rule?.label ?? null,
    category: rule?.category ?? null, dedupe: e.dedupe, fired_ms: Number(e.fired_ms), title: e.title, body: e.body ?? null,
    source: e.source ?? null, source_ms: e.source_ms ?? null, data: parse(e.data, {}), telegram: e.telegram ?? null,
    telegram_ms: e.telegram_ms ?? null, telegram_error: e.telegram_error ?? null, acked_ms: e.acked_ms ?? null,
    voice: !!rule?.channels.includes('voix') };
}

export class Engine {
  rules: Rule[] = [];
  seen = new Set<string>();
  fired: Fired[] = [];
  changed = new Set<number>();
  constructor(readonly deps: AlertDeps) {}

  async load(): Promise<void> {
    const { rest } = this.deps;
    this.rules = (await rest.select<Row>('alert_rules', { select: '*', order: 'id.asc', limit: '500' })).map(ruleFromRow);
    const ev = await rest.select<{ rule_id: number; dedupe: string }>('alert_events', {
      select: 'rule_id,dedupe', fired_ms: `gte.${this.deps.now() - SEEN_MS}`, limit: '5000' });
    for (const e of ev) this.seen.add(`${e.rule_id}|${e.dedupe}`);
  }

  armed(kind: string): Rule[] {
    return this.rules.filter((r) => r.kind === kind && r.state === 'armée');
  }

  fire(rule: Rule, dedupe: string, title: string, body: string, source: string, sourceMs: number | null,
    data: Record<string, unknown> = {}, newState: string | null = null): void {
    const key = `${rule.id}|${dedupe}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const now = this.deps.now();
    this.fired.push({ id: newId(), rule_id: rule.id, dedupe, fired_ms: now, title, body, source, source_ms: sourceMs, data,
      telegram: rule.channels.includes('telegram') ? (telegramConfigured(this.deps.env) ? 'en attente' : 'non configuré') : null });
    rule.last_fired_ms = now;
    if (newState) rule.state = newState;
    this.changed.add(rule.id);
  }

  /** Base d'abord (l'unicité tranche entre deux appels simultanés), puis Telegram, puis l'état publié. */
  async flush(): Promise<void> {
    const { rest } = this.deps;
    for (const f of this.fired) {
      const made = await rest.insertIgnore('alert_events', [{
        id: f.id, rule_id: f.rule_id, dedupe: f.dedupe, fired_ms: f.fired_ms, title: f.title, body: f.body, source: f.source,
        source_ms: f.source_ms, data: JSON.stringify(f.data), telegram: f.telegram,
      }], 'rule_id,dedupe', 'id');
      if (!made.length || f.telegram !== 'en attente') continue;      // déjà enregistrée par un autre appel, ou pas de Telegram
      const r = await sendTelegram(this.deps, `${f.title}\n${f.body}\n${day(f.fired_ms)} ${hm(f.fired_ms, true)} (Paris) · source : ${f.source}`);
      await rest.update('alert_events', { id: `eq.${f.id}` }, { telegram: r.ok ? 'envoyé' : 'échec', telegram_ms: r.sent_ms, telegram_error: r.error });
      await putState(rest, [['alert:telegram', { last_ok: r.ok, last_ms: r.sent_ms, last_error: r.error }]], this.deps.now());
    }
    const now = this.deps.now();
    for (const r of this.rules.filter((x) => this.changed.has(x.id))) {
      await rest.update('alert_rules', { id: `eq.${r.id}` }, { state: r.state, last_fired_ms: r.last_fired_ms, updated_ms: now });
      r.updated_ms = now;
    }
    await this.publish();
  }

  async publish(): Promise<void> {
    const { rest } = this.deps;
    const now = this.deps.now();
    const events = await rest.select<Row>('alert_events', { select: '*', order: 'fired_ms.desc', limit: String(PUBLISHED_EVENTS) });
    const byId = new Map(this.rules.map((r) => [r.id, r]));
    const entries: [string, unknown][] = this.rules.map((r) => [`alert:rule:${r.id}`, { ...r }]);
    for (const e of events) entries.push([`alert:fired:${e.id}`, eventPayload(e, byId.get(Number(e.rule_id)))]);
    const tg = await getState<{ last_ok?: boolean; last_ms?: number; last_error?: string | null }>(rest, 'alert:telegram');
    entries.push(['alert:summary', {
      rules: this.rules.length, armed: this.rules.filter((r) => r.state === 'armée').length,
      unacked: events.filter((e) => !e.acked_ms && now - Number(e.fired_ms) < DAY).length,
      last_fired_ms: events.length ? Number(events[0].fired_ms) : null,
      telegram: { configured: telegramConfigured(this.deps.env), last_ok: tg?.last_ok ?? null, last_ms: tg?.last_ms ?? null,
        last_error: tg?.last_error ?? null },
      computed_ms: now, machine: 'supabase' }]);
    await putState(rest, entries, now);
    // Ménage : une alerte sortie des 50 dernières n'est plus rafraîchie ; sa clé part au bout de 7 jours.
    await rest.remove('p1_state', { key: 'like.alert:fired:*', updated_ms: `lt.${now - STALE_FIRED_MS}` });
  }
}

// --- évaluations ---------------------------------------------------------------------------------

interface Candle { t: string; h: number; l: number; c: number }

export async function checkPrices(e: Engine): Promise<void> {
  const { rest } = e.deps;
  const cursor = (await getState<Record<string, { t: string; c: number }>>(rest, 'alert:cursor:price')) ?? {};
  const next = { ...cursor };
  for (const inst of INSTRUMENTS) {
    const since = cursor[inst]?.t;
    const rows = await rest.select<Candle>('okx_candles_1m', since
      ? { select: 't,h,l,c', inst: `eq.${inst}`, t: `gt.${since}`, order: 't.asc', limit: '240' }
      : { select: 't,h,l,c', inst: `eq.${inst}`, order: 't.desc', limit: '1' });
    if (!rows.length) continue;
    if (!since) { next[inst] = { t: rows[0].t, c: rows[0].c }; continue; }
    let prev = cursor[inst].c;
    for (const k of rows) {
      for (const r of e.armed('price').filter((x) => x.params.inst === inst)) {
        const level = Number(r.params.level);
        const up = prev < level && k.h >= level;
        const down = prev > level && k.l <= level;
        if (!(r.params.direction === 'hausse' ? up : r.params.direction === 'baisse' ? down : up || down)) continue;
        const t = Date.parse(k.t);
        const [title] = ar.priceMessage(r.params, prev, up ? k.h : k.l);
        e.fire(r, k.t, title,
          `Bougie 1 min de ${hm(t)} (Paris) : haut ${ar.frNum(k.h)}, bas ${ar.frNum(k.l)}, clôture ${ar.frNum(k.c)} ; clôture précédente ${ar.frNum(prev)} · OKX`,
          `OKX · bougie 1 min de ${hm(t)}`, t, { high: k.h, low: k.l, close: k.c, prev }, 'déclenchée');
      }
      prev = k.c;
    }
    next[inst] = { t: rows[rows.length - 1].t, c: prev };
  }
  await putState(rest, [['alert:cursor:price', next]], e.deps.now());
}

export async function checkFunding(e: Engine): Promise<void> {
  const rules = e.rules.filter((r) => r.kind === 'funding' && (r.state === 'armée' || r.state === 'déclenchée'));
  for (const inst of new Set(rules.map((r) => String(r.params.inst)))) {
    const [snap] = await e.deps.rest.select<{ funding_rate: number | null; funding_time: string | null; ts_minute: string }>('okx_snapshots', {
      select: 'funding_rate,funding_time,ts_minute', inst: `eq.${inst}`, order: 'ts_minute.desc', limit: '1' });
    if (!snap || snap.funding_rate === null || e.deps.now() - Date.parse(snap.ts_minute) > 10 * MIN) continue;
    for (const r of rules.filter((x) => x.params.inst === inst)) {
      const hit = ar.fundingHit(r.params, snap.funding_rate);
      if (r.state === 'armée' && hit) {
        const [title, body] = ar.fundingMessage(r.params, snap.funding_rate);
        e.fire(r, `${snap.funding_time}|${snap.ts_minute}`, title, body, 'OKX · funding', Date.parse(snap.ts_minute),
          { rate: snap.funding_rate }, 'déclenchée');
      } else if (r.state === 'déclenchée' && !hit) {
        r.state = 'armée';                    // repassé de l'autre côté du seuil : réarmée
        e.changed.add(r.id);
      }
    }
  }
}

export async function checkCalendar(e: Engine): Promise<void> {
  const rules = e.armed('event_soon');
  if (!rules.length) return;
  const weeks = await e.deps.rest.select<{ value: { events?: Record<string, unknown>[] } }>('p1_state', {
    select: 'value', key: 'like.calendar:week:*', order: 'key.desc', limit: '1' });
  const now = e.deps.now();
  for (const r of rules) {
    for (const ev of weeks[0]?.value.events ?? []) {
      const t = ev.time_ms;
      if (typeof t !== 'number' || !(now < t && t <= now + Number(r.params.minutes) * MIN) || !ar.eventMatches(r.params, ev)) continue;
      const [title, body] = ar.eventMessage(r.params, ev, hm(t));
      e.fire(r, `${ev.id}|${t}`, title, body, 'ForexFactory', t, { event_id: ev.id, time_ms: t });
    }
  }
}

export function checkRelease(e: Engine, last: Record<string, unknown>, figs: Record<string, unknown>[]): void {
  const now = e.deps.now();
  const bus = last.bus_ms;
  const sched = typeof last.scheduled_ms === 'number' ? last.scheduled_ms : null;
  if (typeof bus !== 'number' || now - bus > FRESH_MS) return;
  if (sched !== null && now - sched > PUBLICATION_ALERT_MS) return;        // arriéré : pas une nouvelle
  for (const r of e.armed('release')) {
    if (!ar.releaseMatches(r.params, last)) continue;
    const [title, body] = ar.releaseMessage(last, figs);
    e.fire(r, `${last.release}|${last.ny_date}|${last.period}|${last.edition ?? ''}`, title, body, 'BLS', sched,
      { keys: last.keys, nature: last.nature });
  }
  for (const r of e.armed('surprise')) {
    for (const f of figs) {
      if (!ar.surpriseHit(r.params, f)) continue;
      const [title, body] = ar.surpriseMessage(f);
      const key = `release:${f.indicator}:${f.period}${f.edition ? `:${f.edition}` : ''}`;
      e.fire(r, key, title, body, 'BLS', sched, { key, z: f.z, surprise: f.surprise });
    }
  }
}

async function releaseFigures(rest: Rest, last: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const keys = Array.isArray(last.keys) ? last.keys as string[] : [];
  return (await Promise.all(keys.map((k) => getState<Record<string, unknown>>(rest, k)))).filter((f): f is Record<string, unknown> => !!f);
}

// --- cloche d'un événement du calendrier (event_watch) et catégories du fil (news_category) ------

const EVENT_MISSING_MS = 30 * MIN;
const EVENT_EXPIRE_MS = DAY;

interface CalEvent { id: string; title: string; title_fr?: string | null; indicator?: string | null; capture?: boolean;
  ny_date?: string; time_ms?: number | null; forecast_raw?: string | null; previous_raw?: string | null; unit?: string | null }

/**
 * Réel d'un événement suivi par sa cloche : chiffre capté au BLS (indicateur et date de New York,
 * comme l'écran), sinon chiffre structuré de FinancialJuice rattaché (calendar:actual:<id>, T-048).
 * Une seule fois ; « réel non capté » 30 min après l'heure prévue s'il n'y a rien ; abandon après 24 h.
 */
export async function checkEventWatch(e: Engine): Promise<void> {
  const rules = e.armed('event_watch');
  if (!rules.length) return;
  const { rest } = e.deps;
  const now = e.deps.now();
  const weeks = await rest.select<{ value: { events?: CalEvent[] } }>('p1_state', {
    select: 'value', key: 'like.calendar:week:*', order: 'key.desc', limit: '2' });
  const byId = new Map(weeks.flatMap((w) => w.value.events ?? []).map((ev) => [ev.id, ev]));
  for (const r of rules) {
    const ev = byId.get(String(r.params.event_id)) ?? null;
    const t = (ev?.time_ms ?? r.params.time_ms ?? null) as number | null;
    let actual: [string, string] | null = null;
    if (ev?.indicator && ev.capture) {
      const figs = await rest.select<{ value: Record<string, unknown> }>('p1_state', {
        select: 'value', key: `like.release:${ev.indicator}:*`, order: 'updated_ms.desc', limit: '6' });
      const f = figs.map((x) => x.value).find((v) => v.ny_date === ev.ny_date && v.value !== null && v.value !== undefined);
      if (f) actual = [ar.valueFr(f.value as string, f.unit as string | null), 'BLS (capté à la source)'];
    }
    if (!actual) {
      const fj = await getState<{ actual: string | null; actual_raw: string; news_title: string }>(rest, `calendar:actual:${r.params.event_id}`);
      if (fj) actual = [fj.actual_raw, 'FinancialJuice (fil d’actus)'];
    }
    if (actual) {
      const [title, body] = ar.eventWatchMessage(r.params, (ev ?? {}) as Record<string, unknown>, actual[0], actual[1]);
      e.fire(r, 'actual', title, body, actual[1], t, { event_id: r.params.event_id, actual: actual[0] }, 'déclenchée');
    } else if (t !== null && now >= t + EVENT_EXPIRE_MS) {
      r.state = 'déclenchée';            // plus rien à attendre : la cloche s'éteint sans message
      e.changed.add(r.id);
    } else if (t !== null && now >= t + EVENT_MISSING_MS) {
      const [title, body] = ar.eventMissingMessage(r.params, (ev ?? {}) as Record<string, unknown>, hm(t));
      e.fire(r, 'missing', title, body, 'Calendrier', t, { event_id: r.params.event_id });
    }
  }
}

/** Appelé quand un réel vient d'être rattaché ou capté : la cloche part sans attendre la minute. */
export async function fireEventWatch(deps: AlertDeps): Promise<number> {
  const e = new Engine(deps);
  await e.load();
  await checkEventWatch(e);
  if (!e.fired.length && !e.changed.size) return 0;
  await e.flush();
  return e.fired.length;
}

/** Appelé par la capture juste après l'enregistrement d'une publication. */
export async function fireReleaseAlerts(deps: AlertDeps, last: Record<string, unknown>, figs: Record<string, unknown>[]): Promise<number> {
  const e = new Engine(deps);
  await e.load();
  checkRelease(e, last, figs);
  await checkEventWatch(e);
  if (!e.fired.length) return 0;
  await e.flush();
  return e.fired.length;
}

/** Appelé par la tâche « news » pour les titres nouveaux (jamais un arriéré) : mots-clés et catégories. */
export async function fireNewsAlerts(deps: AlertDeps, items: { id: number; title: string; source: string; published_ms: number | null;
  received_ms: number; category?: string; urgent?: boolean }[]): Promise<number> {
  const e = new Engine(deps);
  await e.load();
  for (const r of e.armed('keyword')) {
    for (const it of items) {
      const word = ar.keywordHit(r.params, it.title);
      if (!word) continue;
      const [title, body] = ar.keywordMessage(word, { title: it.title, source: it.source });
      e.fire(r, `news:${it.id}`, title, body, it.source, it.published_ms ?? it.received_ms, { news_id: it.id, word });
    }
  }
  for (const r of e.armed('news_category')) {
    for (const it of items) {
      if (!ar.newsCategoryHit(r.params, it as unknown as Record<string, unknown>)) continue;
      const [title, body] = ar.newsCategoryMessage(r.params, it as unknown as Record<string, unknown>);
      e.fire(r, `news:${it.id}`, title, body, it.source, it.published_ms ?? it.received_ms, { news_id: it.id, category: it.category });
    }
  }
  if (!e.fired.length) return 0;
  await e.flush();
  return e.fired.length;
}

/** Tâche « alerts », chaque minute. */
export async function runAlerts(deps: AlertDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const e = new Engine(deps);
  await e.load();
  const problems: string[] = [];
  for (const [name, step] of [['prix', checkPrices], ['funding', checkFunding], ['agenda', checkCalendar], ['cloches', checkEventWatch]] as const) {
    try { await step(e); } catch (err) { problems.push(`${name} : ${(err as Error).message}`.slice(0, 200)); }
  }
  const last = await getState<Record<string, unknown>>(rest, 'release:last');
  if (last) checkRelease(e, last, await releaseFigures(rest, last));
  await e.flush();
  return { job: 'alerts', ok: problems.length === 0, rules: e.rules.length, problems,
    fired: e.fired.map((f) => ({ rule: f.rule_id, title: f.title, telegram: f.telegram })) };
}

// --- écritures de l'écran /alertes ------------------------------------------------------------

export interface CmdResult { status: number; body: unknown }
const fail = (status: number, error: string): CmdResult => ({ status, body: { ok: false, error } });

export async function runAlertCommand(deps: AlertDeps, cmd: unknown): Promise<CmdResult> {
  const { rest } = deps;
  if (typeof cmd !== 'object' || cmd === null || Array.isArray(cmd)) return fail(400, 'objet JSON attendu');
  const c = cmd as Record<string, unknown>;
  const e = new Engine(deps);
  await e.load();
  const now = deps.now();
  const find = () => e.rules.find((r) => r.id === Number(c.id));
  try {
    switch (c.op) {
      case 'create': {
        const kind = String(c.kind);
        const [p, chans] = ar.validate(kind, c.params ?? {}, c.channels ?? [], INSTRUMENTS);
        const [row] = await rest.insert<Row>('alert_rules', [{ kind, params: JSON.stringify(p), channels: JSON.stringify(chans),
          state: 'armée', created_ms: now, updated_ms: now }], 'id,kind,params,channels,state,created_ms,updated_ms,last_fired_ms');
        const rule = ruleFromRow(row);
        e.rules.push(rule);
        await e.publish();
        return { status: 200, body: rule };
      }
      case 'update': {
        const rule = find();
        if (!rule) return fail(404, `règle ${c.id} inconnue`);
        if (c.state !== undefined && c.state !== null && c.state !== 'armée' && c.state !== 'désactivée') {
          return fail(400, 'état : armée ou désactivée (« déclenchée » vient du moteur)');
        }
        const [p, chans] = ar.validate(rule.kind, c.params ?? rule.params, c.channels ?? rule.channels, INSTRUMENTS);
        const state = (c.state as string | undefined) ?? rule.state;
        await rest.update('alert_rules', { id: `eq.${rule.id}` }, { params: JSON.stringify(p), channels: JSON.stringify(chans), state, updated_ms: now });
        const [label, category] = ar.describe(rule.kind, p);
        Object.assign(rule, { params: p, channels: chans, state, updated_ms: now, label, category, error: null });
        await e.publish();
        return { status: 200, body: rule };
      }
      case 'delete': {
        const rule = find();
        if (!rule) return fail(404, `règle ${c.id} inconnue`);
        const evs = await rest.select<{ id: string }>('alert_events', { select: 'id', rule_id: `eq.${rule.id}`, limit: '5000' });
        await rest.remove('alert_rules', { id: `eq.${rule.id}` });           // ses alertes partent en cascade
        await rest.remove('p1_state', { key: `eq.alert:rule:${rule.id}` });
        for (let i = 0; i < evs.length; i += 100) {
          await rest.remove('p1_state', { key: `in.(${evs.slice(i, i + 100).map((x) => `"alert:fired:${x.id}"`).join(',')})` });
        }
        e.rules = e.rules.filter((r) => r !== rule);
        await e.publish();
        return { status: 200, body: { ok: true, removed: [`alert:rule:${rule.id}`, ...evs.map((x) => `alert:fired:${x.id}`)] } };
      }
      case 'ack': {
        const ids = c.ids;
        if (ids !== undefined && ids !== null && !(Array.isArray(ids) && ids.every((i) => typeof i === 'string' && /^[0-9a-f]{12}$/.test(i)))) {
          return fail(400, 'ids : liste d’identifiants');
        }
        const open = await rest.select<{ id: string }>('alert_events', { select: 'id', acked_ms: 'is.null', limit: '5000' });
        const target = open.filter((x) => !ids || (ids as string[]).includes(x.id));
        for (let i = 0; i < target.length; i += 100) {
          await rest.update('alert_events', { id: `in.(${target.slice(i, i + 100).map((x) => x.id).join(',')})` }, { acked_ms: now });
        }
        await e.publish();
        return { status: 200, body: { acked: target.length } };
      }
      case 'test': {
        const r = await sendTelegram(deps, `${TEST_TEXT}\n${day(now)} ${hm(now, true)} (Paris)`);
        await putState(rest, [['alert:telegram', { last_ok: r.ok, last_ms: r.sent_ms, last_error: r.error }]], deps.now());
        await e.publish();
        return { status: 200, body: { ok: r.ok, error: r.error, sent_ms: r.sent_ms } };
      }
      default:
        return fail(400, 'op : create, update, delete, ack ou test');
    }
  } catch (err) {
    if (err instanceof ar.RuleError) return fail(400, err.message);
    throw err;
  }
}
