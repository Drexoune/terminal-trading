// Faits de l'assistant (P6, T-074) : ce que le terminal affiche, mis en phrases courtes et
// numérotées (F1, F2…), chacun avec sa source, son heure et l'écran qui le montre. Le code fait
// les calculs (variation sur 24 h, formats fr-FR) ; Gemini ne fait que recopier et citer.
// Fonction pure (buildFacts), testée ; collectFacts lit le store.

import type { Fact } from '../../../api/_lib/assistant-core';
import type { CalendarNext } from '../calendar/calendar';
import { figures, type ReleaseFigure } from '../calendar/releases';
import type { Ticker } from '../data/protocol';
import { getValue, keysWithPrefix } from '../data/store';
import { fmtNumber, fmtPctChange, fmtRatePct, fmtSigned, fmtUsdCompact, NBSP } from '../lib/format';
import { fmtHm } from '../lib/time';
import type { CvdState } from '../micro/cvd';
import type { FundingState } from '../micro/funding';
import type { LiqState } from '../micro/liqs';
import type { NewsItem } from '../news/news';
import { OUTCOME_LABEL, OUTCOMES, RATES_KEY, type Bank, type RatesReply } from '../rates/rates';

export type { Fact };

export interface FactsInput {
  article?: NewsItem | null;
  translation?: { title: string; body: string } | null;
  tickers?: Ticker[];
  funding?: FundingState | null;
  liqs?: LiqState | null;
  cvd?: CvdState | null;
  figures?: ReleaseFigure[];
  next?: CalendarNext | null;
  rates?: RatesReply | null;
  now: number;
}

const PARIS = 'Europe/Paris';
const instName = (inst: string) => inst.replace('-SWAP', ' perp');

export function buildFacts(i: FactsInput): Fact[] {
  const out: Omit<Fact, 'id'>[] = [];
  const add = (f: Omit<Fact, 'id'>) => out.push(f);

  if (i.article) {
    const a = i.article;
    const at = a.published_ms ?? a.received_ms;
    add({ label: 'Article ouvert · titre (VO)', value: a.title, source: `article : ${a.source}`, at_ms: at, href: '/actus' });
    if (a.summary) add({ label: 'Article ouvert · texte (VO)', value: a.summary, source: `article : ${a.source}`, at_ms: at, href: '/actus' });
    add({ label: 'Article ouvert · heure de la source', value: `${fmtHm(at, PARIS)} (Paris)`, source: `article : ${a.source}`, at_ms: at, href: '/actus' });
    if (i.translation) add({ label: 'Article ouvert · traduction (Gemini, à vérifier)', value: `${i.translation.title}${i.translation.body ? ` — ${i.translation.body}` : ''}`, source: 'traduction', at_ms: at, href: '/actus' });
  }
  for (const t of i.tickers ?? []) {
    add({ label: `${instName(t.inst)} · dernier prix`, value: `${fmtNumber(t.last, 1)}${NBSP}$`, source: 'OKX', at_ms: t.ts_source ?? null, href: '/graphiques' });
    if (t.open24h) add({ label: `${instName(t.inst)} · variation sur 24 h`, value: fmtPctChange(t.last / t.open24h - 1, 2), source: 'OKX (calcul du terminal)', at_ms: t.ts_source ?? null, href: '/graphiques' });
    if (t.high24h && t.low24h) add({ label: `${instName(t.inst)} · plus haut et plus bas 24 h`, value: `${fmtNumber(t.high24h, 1)}${NBSP}$ et ${fmtNumber(t.low24h, 1)}${NBSP}$`, source: 'OKX', at_ms: t.ts_source ?? null, href: '/graphiques' });
  }
  if (i.funding) {
    const t = i.funding.total;
    if (t.rate_8h !== null) add({ label: 'Funding BTC moyen (4 plateformes, équivalent 8 h)', value: fmtRatePct(t.rate_8h, 4), source: 'OKX, Binance, Bybit, Hyperliquid', at_ms: i.now, href: '/microstructure' });
    if (t.oi_usd !== null) add({ label: 'Open interest BTC total', value: fmtUsdCompact(t.oi_usd), source: 'OKX, Binance, Bybit, Hyperliquid', at_ms: i.now, href: '/microstructure' });
    if (t.oi_24h !== null) add({ label: 'Variation 24 h de l’open interest BTC (en BTC)', value: fmtPctChange(t.oi_24h, 1), source: t.oi_24h_venues.join(', '), at_ms: i.now, href: '/microstructure' });
  }
  if (i.liqs) add({ label: 'Liquidations BTC sur la dernière heure', value: `longs ${fmtUsdCompact(i.liqs.long_usd)}, shorts ${fmtUsdCompact(i.liqs.short_usd)} (Binance et OKX : minimums)`, source: 'OKX, Binance, Bybit', at_ms: i.now, href: '/microstructure' });
  if (i.cvd?.ready && i.cvd.perp !== null && i.cvd.spot !== null) {
    add({ label: 'CVD BTC sur 4 h', value: `perpétuel ${fmtSigned(i.cvd.perp, 0)}${NBSP}BTC, spot ${fmtSigned(i.cvd.spot, 0)}${NBSP}BTC${i.cvd.divergence ? ', divergence' : ''}`, source: 'Binance, OKX', at_ms: i.now, href: '/microstructure' });
  }
  for (const f of (i.figures ?? []).filter((x) => x.value !== null).slice(0, 8)) {
    add({ label: `${f.label_fr ?? f.indicator} · ${f.period}${f.edition ? ` (${f.edition})` : ''}`, value: `${f.value}${f.unit ? ` ${f.unit}` : ''} (publié le ${f.ny_date}, heure de New York)`,
      source: 'BLS', at_ms: null, href: '/calendrier' });
  }
  for (const e of (i.next?.events ?? []).slice(0, 5)) {
    if (e.time_ms === null) continue;
    add({ label: `Agenda · ${e.title_fr ?? e.title} (${e.currency})`, value: `prévu à ${fmtHm(e.time_ms, PARIS)} (Paris), impact ${e.impact === 'High' ? 'fort' : 'moyen'}`,
      source: 'ForexFactory', at_ms: e.time_ms, href: '/calendrier' });
  }
  const banks = i.rates?.state?.banks;
  for (const b of ['FED', 'BCE'] as Bank[]) {
    const nx = banks?.[b]?.next;
    const pm = nx?.sources.polymarket ?? nx?.sources.kalshi;
    if (!nx || !pm?.probs) continue;
    const parts = OUTCOMES.flatMap((o) => (pm.probs![o]?.p != null ? [`${OUTCOME_LABEL[o]} ${fmtNumber(pm.probs![o]!.p! * 100, 1)}${NBSP}%`] : []));
    if (parts.length) add({ label: `${b} · réunion du ${nx.date}`, value: parts.join(', '), source: nx.sources.polymarket ? 'Polymarket' : 'Kalshi', at_ms: pm.ts_source ?? null, href: '/taux' });
  }
  return out.map((f, k) => ({ id: `F${k + 1}`, ...f }));
}

/** Faits depuis le store (ce que l'écran affiche à cet instant). */
export function collectFacts(now: number, article: NewsItem | null, translation: { title: string; body: string } | null = null): Fact[] {
  const tickers = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'].map((k) => getValue<Ticker>(`ticker:${k}`)).filter((t): t is Ticker => !!t);
  const figs = figures(keysWithPrefix<unknown>('release:')).map(([, f]) => f).sort((a, b) => (b.bus_ms ?? 0) - (a.bus_ms ?? 0));
  return buildFacts({
    article, translation, tickers, now,
    funding: getValue<FundingState>('micro:funding') ?? null, liqs: getValue<LiqState>('micro:liqs') ?? null, cvd: getValue<CvdState>('micro:cvd') ?? null,
    figures: figs, next: getValue<CalendarNext>('calendar:next') ?? null, rates: getValue<RatesReply>(RATES_KEY) ?? null,
  });
}
