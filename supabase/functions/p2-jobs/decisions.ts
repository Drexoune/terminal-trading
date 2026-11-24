// Tâche « decisions » de p2-jobs (plan P2, étape R4), toutes les 10 min : dernière décision de
// chaque banque et vote du comité, pour le panneau « Comités et votes ».
//
// - L'URL de la décision vient du fil d'actus de P1 (news_items, règle decision:<BANQUE>, lecture
//   seule) : rien n'est cherché ailleurs, aucune adresse n'est devinée.
// - Fed et BoE : vote lu sur la page officielle (communiqué du FOMC, Monetary Policy Summary),
//   phrase citée. Une page illisible laisse le vote « — » avec sa raison, jamais un vote supposé.
// - BCE, BNS : vote non publié ; BoC et RBNZ : décision par consensus, vote non publié ;
//   BoJ : vote nominatif dans le communiqué PDF (lien seulement) ; RBA : lien vers le communiqué.
// - Variation décidée : lue sur la page (Fed, BoE), sinon déduite de la série du BIS autour de la
//   date (« en attente du BIS » tant que la série ne couvre pas les jours suivants).

import { civilDate } from '../p1-jobs/calendar.ts';
import type { Json, Rest, Row } from '../p1-jobs/rest.ts';
import { BANKS, CALENDARS, type Bank } from './meetings.ts';

export interface DecisionsDeps {
  fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
  now: () => number;
  rest: Rest;
}

const DAY = 86_400_000;
const LOOKBACK_MS = 150 * DAY;
const UA = 'TERMINAL/1.0 (terminal personnel, lecture seule)';

export interface Vote { kind: 'nominatif' | 'non nominatif' | 'non publié' | 'consensus' | 'lien'; for?: number; against?: number;
  unanimous?: boolean; dissents?: { name: string; preferred: string }[]; note?: string }
export interface Parsed { change_bp: number | null; rate_text: string | null; vote: Vote | null; quote: string | null; problem?: string }

export const VOTE_BY_BANK: Partial<Record<Bank, Vote>> = {
  BCE: { kind: 'non publié' },
  BNS: { kind: 'non publié' },
  BOC: { kind: 'consensus' },
  RBNZ: { kind: 'consensus' },
  BOJ: { kind: 'lien', note: 'Vote nominatif dans le communiqué (PDF)' },
  RBA: { kind: 'lien', note: 'Vote dans le communiqué' },
};

/** Texte lisible d'une page HTML (scripts, styles et balises retirés, entités courantes décodées). */
export function pageText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"')
    .replace(/&ndash;/g, '–').replace(/\s+/g, ' ').trim();
}

const FRACTION: Record<string, number> = { '1/4': 25, '1/2': 50, '3/4': 75, '1': 100 };
const PREF: Record<string, string> = { raise: 'hausse', increase: 'hausse', lower: 'baisse', reduce: 'baisse', cut: 'baisse', maintain: 'statu quo' };

/** Communiqué du FOMC : vote « by a 10 – 2 vote », décision, fourchette, dissidents et leur préférence. */
export function parseFed(html: string): Parsed {
  const t = pageText(html);
  const v = /approved the following statement for release by an? (\d+)\s*[–-]\s*(\d+) vote/i.exec(t);
  const unanimous = !v && /voting for (?:the|this) (?:monetary policy )?action were/i.test(t) && !/voting against/i.test(t);
  const d = /The Committee decided to (maintain|raise|lower) the target range for the federal funds rate (?:by (1\/4|1\/2|3\/4|1) percentage points? )?(?:at|to) ([\d\-\/]+ to [\d\-\/]+ percent)/i.exec(t);
  const dissents: { name: string; preferred: string }[] = [];
  for (const m of t.matchAll(/Voting against (?:the monetary policy action|this action) (?:were|was) (.+?), who (?:preferred|dissented)[^.]*?(?:to (raise|lower|maintain) the target range|no change)/gi)) {
    const pref = m[2] ? PREF[m[2].toLowerCase()] : 'statu quo';
    for (const name of m[1].split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean)) dissents.push({ name, preferred: pref });
  }
  if (!d) return { change_bp: null, rate_text: null, vote: null, quote: null, problem: 'décision introuvable sur la page du FOMC' };
  const sign = d[1].toLowerCase() === 'maintain' ? 0 : d[1].toLowerCase() === 'raise' ? 1 : -1;
  const change = sign === 0 ? 0 : d[2] ? sign * FRACTION[d[2]] : null;
  const vote: Vote | null = v ? { kind: 'nominatif', for: Number(v[1]), against: Number(v[2]), dissents }
    : unanimous ? { kind: 'nominatif', unanimous: true, dissents: [] } : null;
  return { change_bp: change, rate_text: d[3], vote, quote: [v?.[0], d[0]].filter(Boolean).join(' … ').slice(0, 400),
    problem: vote ? undefined : 'vote introuvable sur la page du FOMC' };
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Monetary Policy Summary de la BoE : « voted by a majority of 8–1 to increase Bank Rate by 0.25 percentage points, to 4% ». */
export function parseBoe(html: string): Parsed {
  const t = pageText(html);
  const m = /the Monetary Policy Committee \(MPC\) voted (?:by a majority of (\d+)\s*[–-]\s*(\d+)|unanimously) to (increase|reduce|cut|raise|maintain) Bank Rate(?: by ([\d.]+) percentage points?)?,?\s*(?:at|to) ([\d.]+%)/i.exec(t);
  if (!m) return { change_bp: null, rate_text: null, vote: null, quote: null, problem: 'vote introuvable dans le Monetary Policy Summary' };
  const verb = m[3].toLowerCase();
  const sign = verb === 'maintain' ? 0 : verb === 'increase' || verb === 'raise' ? 1 : -1;
  const change = sign === 0 ? 0 : m[4] ? Math.round(sign * Number(m[4]) * 100) : null;
  const dissents: { name: string; preferred: string }[] = [];
  const after = t.slice(m.index + m[0].length, m.index + m[0].length + 600);
  for (const d of after.matchAll(/\b(One|Two|Three|Four|\d) members? voted to (increase|reduce|cut|raise|maintain)/gi)) {
    const n = WORDS[d[1].toLowerCase()] ?? Number(d[1]);
    for (let i = 0; i < n; i++) dissents.push({ name: 'membre du MPC', preferred: PREF[d[2].toLowerCase()] });
  }
  const vote: Vote = m[1] ? { kind: 'nominatif', for: Number(m[1]), against: Number(m[2]), dissents } : { kind: 'nominatif', unanimous: true, dissents: [] };
  const end = t.indexOf('.', m.index + m[0].length + 1);
  return { change_bp: change, rate_text: m[5], vote, quote: t.slice(m.index, end > 0 ? Math.min(end + 1, m.index + 400) : m.index + 300) };
}

/** Variation déduite du BIS : taux avant la date, puis premier écart dans les 10 jours ; null tant que la série ne couvre pas 8 jours. */
export function changeFromBis(rows: { obs_date: string; rate: number }[], date: string): number | null {
  const sorted = [...rows].sort((a, b) => (a.obs_date < b.obs_date ? -1 : 1));
  const before = sorted.filter((r) => r.obs_date < date).at(-1);
  if (!before) return null;
  const limit = civilDate(Date.parse(`${date}T00:00:00Z`) + 10 * DAY, 'UTC');
  const after = sorted.filter((r) => r.obs_date >= date && r.obs_date <= limit);
  const moved = after.find((r) => Number(r.rate) !== Number(before.rate));
  if (moved) return Math.round((Number(moved.rate) - Number(before.rate)) * 1000) / 10;
  const covered = after.at(-1);
  return covered && covered.obs_date >= civilDate(Date.parse(`${date}T00:00:00Z`) + 8 * DAY, 'UTC') ? 0 : null;
}

interface NewsRow { url: string | null; title: string; rule: string; published_ms: number | null; received_ms: number }
interface DecisionRow { bank: string; decision_date: string; change_bp: number | null; source_url: string; vote: Vote }

export async function runDecisions(deps: DecisionsDeps): Promise<Record<string, unknown>> {
  const { rest } = deps;
  const now = deps.now();
  const problems: string[] = [];
  const done: string[] = [];
  const news = await rest.select<NewsRow>('news_items', { select: 'url,title,rule,published_ms,received_ms', rule: 'like.decision:*',
    received_ms: `gte.${now - LOOKBACK_MS}`, order: 'received_ms.desc', limit: '200' });
  const known = await rest.select<DecisionRow>('rate_decisions', { select: 'bank,decision_date,change_bp,source_url,vote', limit: '1000' });
  for (const bank of BANKS) {
    // Dernier titre de décision de la banque (la Fed publie aussi ses minutes sous la même règle).
    const item = news.find((n) => n.rule === `decision:${bank}` && n.url && !(bank === 'FED' && !/FOMC statement/i.test(n.title)));
    if (!item?.url) continue;
    const date = civilDate(item.published_ms ?? item.received_ms, CALENDARS[bank].tz);
    const old = known.find((k) => k.bank === bank && k.decision_date === date);
    if (old && old.change_bp !== null && old.vote) continue;   // décision complète : rien à relire
    let parsed: Parsed = { change_bp: null, rate_text: null, vote: VOTE_BY_BANK[bank] ?? null, quote: null };
    if (bank === 'FED' || bank === 'BOE') {
      try {
        const r = await deps.fetch(item.url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
        const html = await r.text();
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        parsed = bank === 'FED' ? parseFed(html) : parseBoe(html);
        if (parsed.problem) problems.push(`${bank} : ${parsed.problem}`);
      } catch (e) {
        problems.push(`${bank} : page de décision illisible (${String((e as Error).message).slice(0, 120)})`);
        parsed = { change_bp: null, rate_text: null, vote: null, quote: null };
      }
    }
    if (parsed.change_bp === null) {
      const from = civilDate(Date.parse(`${date}T00:00:00Z`) - 30 * DAY, 'UTC');
      const rows = await rest.select<{ obs_date: string; rate: number }>('policy_rates', { select: 'obs_date,rate', bank: `eq.${bank}`,
        obs_date: `gte.${from}`, order: 'obs_date.asc', limit: '60' });
      parsed.change_bp = changeFromBis(rows, date);
    }
    const vote: Vote = parsed.vote ?? { kind: 'lien', note: 'vote non lu : voir la page officielle' };
    await rest.upsert('rate_decisions', [{ bank, decision_date: date, change_bp: parsed.change_bp, rate_text: parsed.rate_text,
      vote: vote as unknown as Json, quote: parsed.quote, source_url: item.url, ts_recv: new Date(now).toISOString() } as Row], 'bank,decision_date');
    done.push(`${bank} ${date}`);
  }
  return { job: 'decisions', ok: problems.length === 0, done, problems };
}
