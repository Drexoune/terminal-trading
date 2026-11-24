// Publication de l'état de P4 (plan P4, étape S2) : lit les tables, calcule (sentiment.ts) et écrit
// p4_state, lu par /api/sentiment (étape S3). Appelée à la fin de chaque tâche de collecte :
// closes -> risk, liquidity -> liquidity, cot -> cot, crowding -> crowding ; la tâche « publish »
// refait les quatre.

import type { Json, Rest } from '../p1-jobs/rest.ts';
import { CLOSES, COT_MARKETS } from './catalog.ts';
import { computeRisk, cotSummary, COT_WEEKS, crowdingSummary, CROWD_DAYS, type CotInput, type CrowdInput, netLiquidity, type Obs } from './sentiment.ts';

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function save(rest: Rest, key: string, value: unknown, now: number): Promise<void> {
  await rest.upsert('p4_state', [{ key, value: value as Json, updated_ms: now }], 'key');
}

/** Une série depuis une date (PostgREST plafonne à 1 000 lignes : 900 jours y tiennent). */
async function series(rest: Rest, id: string, from: string): Promise<Obs[]> {
  const rows = await rest.select<{ date: string; value: number | string; adj: number | string | null }>('sentiment_series',
    { select: 'date,value,adj', series_id: `eq.${id}`, date: `gte.${from}`, order: 'date.asc', limit: '1000' });
  return rows.map((r) => ({ date: r.date, value: Number(r.value), adj: r.adj === null ? null : Number(r.adj) }));
}

export async function publishRisk(rest: Rest, now: number): Promise<{ date: string | null; index: number | null; used: number }> {
  // 252 séances de fenêtre + 252 d'historique + 125 de moyenne mobile ≈ 630 séances ≈ 900 jours.
  const from = isoDay(now - 900 * DAY);
  const data: Record<string, Obs[]> = {};
  for (const s of CLOSES) data[s.id] = await series(rest, s.id, from);
  const st = computeRisk(data);
  if (st) await save(rest, 'risk', { ...st, computed_ms: now }, now);
  return { date: st?.date ?? null, index: st?.index ?? null, used: st?.components_used ?? 0 };
}

export async function publishLiquidity(rest: Rest, now: number): Promise<{ date: string | null }> {
  const from = isoDay(now - 900 * DAY);
  const [w, t, r] = [await series(rest, 'WALCL', from), await series(rest, 'WDTGAL', from), await series(rest, 'RRP', from)];
  const st = netLiquidity(w, t, r);
  await save(rest, 'liquidity', { ...st, unit: 'M USD', formula: 'WALCL − WDTGAL − RRPONTSYD × 1 000', computed_ms: now }, now);
  return { date: st.last?.date ?? null };
}

export async function publishCot(rest: Rest, now: number): Promise<{ report_date: string | null }> {
  const from = isoDay(now - (COT_WEEKS * 7 + 14) * DAY);
  const rows: CotInput[] = [];
  for (const code of Object.keys(COT_MARKETS)) {
    const got = await rest.select<CotInput>('cot_positions', { select: 'market_code,date,category,long,short,open_interest',
      report: 'eq.tff', market_code: `eq.${code}`, date: `gte.${from}`, order: 'date.asc', limit: '1000' });
    rows.push(...got.map((r) => ({ ...r, long: Number(r.long), short: Number(r.short), open_interest: Number(r.open_interest) })));
  }
  const st = cotSummary(rows, COT_MARKETS);
  await save(rest, 'cot', { ...st, report: 'TFF, futures seuls', computed_ms: now }, now);
  return { report_date: st.report_date };
}

export async function publishCrowding(rest: Rest, now: number): Promise<{ groups: number }> {
  const since = new Date(now - CROWD_DAYS * DAY).toISOString();
  const rows: CrowdInput[] = [];
  for (const ex of ['binance', 'okx', 'bybit']) {
    for (const sym of ['BTC', 'ETH']) {
      for (const metric of ['account', 'top_account', 'top_position', 'funding']) {
        rows.push(...await rest.select<CrowdInput>('crowding', { select: 'exchange,symbol,metric,ts,value,long_share',
          exchange: `eq.${ex}`, symbol: `eq.${sym}`, metric: `eq.${metric}`, ts: `gte.${since}`, order: 'ts.desc', limit: '1000' }));
      }
    }
  }
  const st = crowdingSummary(rows.map((r) => ({ ...r, value: Number(r.value), long_share: r.long_share === null ? null : Number(r.long_share) })), now);
  await save(rest, 'crowding', { assets: st, days: CROWD_DAYS, computed_ms: now }, now);
  return { groups: rows.length };
}

export async function publishAll(rest: Rest, now: number): Promise<Record<string, unknown>> {
  return { job: 'publish', ok: true, risk: await publishRisk(rest, now), liquidity: await publishLiquidity(rest, now),
    cot: await publishCot(rest, now), crowding: await publishCrowding(rest, now) };
}
