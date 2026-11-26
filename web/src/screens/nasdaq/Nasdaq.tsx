// Onglet « Nasdaq 100 » des pages dédiées au BTC (Graphiques, Microstructure, Options BTC). Données
// gratuites et autorisées seulement (T-051, T-075) : QQQ en bougies quotidiennes (Tiingo, ajusté),
// meilleur prix IEX toutes les 3 min (Tiingo), VXN et VIX quotidiens (Cboe, FRED). Ce qu'aucune
// source gratuite ne donne (profondeur, transactions avec côté, chaîne d'options) : « — » et la raison.

import '../analysis/analysis.css';
import './nasdaq.css';
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CandlestickSeries, ColorType, createChart, type Time } from 'lightweight-charts';
import { useDaily, dailyReason } from '../../analysis/daily';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Segmented } from '../../components/ui';
import { useValue } from '../../data/store';
import { fmtNumber, fmtPctChange, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm, isMarketOpen, MARKETS } from '../../lib/time';
import { useNow } from '../../shell/useNow';
import { WATCH_KEY, type WatchAsset, type WatchState } from '../../watch/watch';
import { Empty, LineChart } from '../analysis/parts';

export type MarketTab = 'btc' | 'nasdaq';
const NY = MARKETS.find((m) => m.code === 'NY')!;
const PARIS = 'Europe/Paris';
const dayFmt = (t: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' }).format(t);
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const token = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';

/** Onglet choisi (?marche=nasdaq), gardé dans l'adresse pour pouvoir partager le lien. */
export function useMarketTab(): [MarketTab, (t: MarketTab) => void] {
  const [p, setP] = useSearchParams();
  const tab: MarketTab = p.get('marche') === 'nasdaq' ? 'nasdaq' : 'btc';
  return [tab, (t) => setP(t === 'nasdaq' ? { marche: 'nasdaq' } : {}, { replace: true })];
}

export function MarketTabs({ tab, onChange }: { tab: MarketTab; onChange: (t: MarketTab) => void }) {
  return <span className="mkt-tabs"><Segmented label="Marché" value={tab} onChange={onChange} options={[{ value: 'btc', label: 'BTC' }, { value: 'nasdaq', label: 'Nasdaq 100' }]} /></span>;
}

function useQqq(): { a: WatchAsset | null; reason: string | null } {
  const st = useValue<WatchState>(WATCH_KEY);
  const a = st?.assets.find((x) => x.asset === 'QQQ') ?? null;
  return { a, reason: !st ? 'watchlist en cours de chargement (Mode Online)' : !st.configured ? `non configuré : ${st.reason ?? ''}` : !a?.last ? 'aucune cotation QQQ reçue' : null };
}

function NyState({ now }: { now: number }) {
  const open = isMarketOpen(NY, now);
  return <Chip small variant={open ? 'live' : 'neutral'}>{open ? 'Séance de New York ouverte' : 'Séance de New York fermée'}</Chip>;
}

/** Bougies quotidiennes (lightweight-charts), un an. */
function DailyCandles({ points, label }: { points: { d: string; o?: number; h?: number; l?: number; c: number }[]; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      height: 380, autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: token('--text-3'), fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: token('--line') } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
      localization: { locale: 'fr-FR', priceFormatter: (p: number) => fmtNumber(p, 2) },
    });
    const s = chart.addSeries(CandlestickSeries, { upColor: token('--up'), downColor: token('--down'), wickUpColor: token('--up'), wickDownColor: token('--down'), borderVisible: false });
    s.setData(points.filter((p) => p.o !== undefined).map((p) => ({ time: p.d as Time, open: p.o!, high: p.h!, low: p.l!, close: p.c })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={host} className="nq-chart" role="img" aria-label={label} />;
}

// --- Graphiques ---------------------------------------------------------------------------------

export function NasdaqChart() {
  const now = useNow(30_000);
  const d = useDaily('QQQ', 380);
  const why = dailyReason(d.reply, d.error);
  const { a, reason } = useQqq();
  const pts = d.reply?.points ?? [];
  const last = pts.at(-1), prev = pts.at(-2);
  return (
    <div className="content nq" data-screen="charts-nasdaq">
      <Panel title="Nasdaq 100 · QQQ · bougies quotidiennes" label="Nasdaq 100 quotidien" controls="none"
        chips={<><NyState now={now} /><Chip small>{last ? `Clôture du ${dayFmt(ms(last.d))} · Tiingo, ajusté` : 'Tiingo'}</Chip></>}>
        {why ? <Empty reason={why} /> : <DailyCandles points={pts} label="Bougies quotidiennes du QQQ sur un an" />}
        <div className="nq-kpis">
          <div className="nq-kpi"><span className="lbl lbl--s">Dernière clôture</span><span className="num">{last ? fmtNumber(last.c, 2) : '—'}</span></div>
          <div className="nq-kpi"><span className="lbl lbl--s">Variation de la séance</span><span className={`num ${last && prev && last.c >= prev.c ? 'up' : 'dn'}`}>{last && prev ? fmtPctChange(last.c / prev.c - 1, 2) : '—'}</span></div>
          <div className="nq-kpi"><span className="lbl lbl--s">Cours IEX (3 min)</span><span className="num">{a?.last ? `${fmtNumber(a.last.price, 2)} · ${fmtHm(a.last.ts_source, PARIS)}` : <Missing reason={reason ?? '—'} />}</span></div>
        </div>
        <p className="nq-note lbl lbl--s">QQQ : fonds coté qui suit le Nasdaq 100. Pas de bougies intrajournalières gratuites (T-051) : quotidien ici, cours IEX toutes les 3 min pendant la séance. Futures Nasdaq : aucune source gratuite.</p>
      </Panel>
    </div>
  );
}

// --- Microstructure -----------------------------------------------------------------------------

const MISSING_MICRO: [string, string, string][] = [
  ['Carte de profondeur et carnet agrégé', 'Profondeur du future NQ (CME) ou du QQQ sur toutes les Bourses : flux payants (CME, Nasdaq TotalView). Seul le meilleur prix IEX est gratuit (panneau Cotation).', '/microstructure'],
  ['Achats et ventes agressifs, CVD', 'Transactions avec leur côté (acheteur ou vendeur preneur) : flux payants. Tiingo IEX gratuit donne un prix toutes les 3 min, sans les transactions.', '/microstructure'],
  ['Liquidations', 'N’existent pas sous forme publique : les appels de marge des courtiers ne sont pas publiés.', '/microstructure'],
  ['Funding', 'Pas de financement périodique sur les futures ni sur les fonds ; l’équivalent est la base future/comptant, qui demande le prix du NQ (payant).', '/microstructure'],
  ['Open interest du NQ', 'Publié chaque jour par le CME ; aucun accès gratuit sous licence trouvé.', '/microstructure'],
];

export function NasdaqMicro() {
  const now = useNow(30_000);
  const { a, reason } = useQqq();
  const l = a?.last;
  const spread = l && l.bid !== null && l.ask !== null ? l.ask - l.bid : null;
  const mid = l && l.bid !== null && l.ask !== null ? (l.ask + l.bid) / 2 : null;
  const vxn = useDaily('VXN', 40);
  const v = vxn.reply?.points.at(-1);
  return (
    <div className="content nq" data-screen="micro-nasdaq">
      <div className="nq-row">
        <Panel title="Cotation QQQ" label="Cotation QQQ" controls="none" style={{ flex: '1 1 340px' }}
          chips={<><NyState now={now} /><Chip small>{l ? `Tiingo IEX · ${fmtHm(l.ts_source, PARIS)}` : 'Tiingo IEX'}</Chip></>}>
          {!l ? <Empty reason={reason ?? '—'} /> : (
            <dl className="nq-dl" data-testid="nq-quote">
              <dt>Meilleure demande (achat)</dt><dd className="num up">{l.bid === null ? '—' : fmtNumber(l.bid, 2)}</dd>
              <dt>Meilleure offre (vente)</dt><dd className="num dn">{l.ask === null ? '—' : fmtNumber(l.ask, 2)}</dd>
              <dt>Spread</dt><dd className="num">{spread === null ? '—' : `${fmtNumber(spread, 2)}${NBSP}$ (${fmtNumber((spread / mid!) * 10_000, 1)}${NBSP}pb)`}</dd>
              <dt>Dernier prix</dt><dd className="num">{fmtNumber(l.price, 2)}</dd>
              <dt>Variation</dt><dd className={`num ${a?.ref && l.price >= a.ref.price ? 'up' : 'dn'}`}>{a?.ref ? `${fmtPctChange(l.price / a.ref.price - 1, 2)} (${a.ref.kind === 'veille' ? 'depuis la veille' : 'sur 24 h'})` : '—'}</dd>
            </dl>)}
        </Panel>
        <Panel title="Séance · cours toutes les 3 min" label="Séance QQQ" controls="none" style={{ flex: '2 1 520px' }}>
          {a && a.series.length > 1 ? <LineChart label="Cours du QQQ toutes les 3 minutes sur 24 h" height={200} xFmt={(t) => fmtHm(t, PARIS)} yFmt={(y) => fmtNumber(y, 2)}
            series={[{ points: a.series.map((p) => [p.t, p.price]), cls: 'c-gold', label: 'QQQ (IEX, 3 min)' }]} /> : <Empty reason={reason ?? 'pas assez de cours sur 24 h'} />}
          <p className="nq-note lbl lbl--s">{`Volatilité implicite du Nasdaq 100 (VXN) : ${v ? `${fmtNumber(v.c, 2)} au ${dayFmt(ms(v.d))}` : '—'} · détail dans Options BTC, onglet Nasdaq 100.`}</p>
        </Panel>
      </div>
      <Panel title="Microstructure du Nasdaq · ce qui manque et pourquoi" label="Données de microstructure Nasdaq" controls="none">
        <table className="an-table nq-missing" data-testid="nq-missing">
          <thead><tr><th className="lbl">Donnée de l’onglet BTC</th><th className="lbl">Nasdaq 100</th><th className="lbl">Raison</th></tr></thead>
          <tbody>{MISSING_MICRO.map(([what, why]) => <tr key={what}><td>{what}</td><td><Missing reason={why} /></td><td className="nq-why">{why}</td></tr>)}</tbody>
        </table>
      </Panel>
    </div>
  );
}

// --- Options ------------------------------------------------------------------------------------

export function NasdaqOptions() {
  const vxn = useDaily('VXN', 400), vix = useDaily('VIX', 400);
  const why = dailyReason(vxn.reply, vxn.error);
  const pn = vxn.reply?.points ?? [], px = vix.reply?.points ?? [];
  const ln = pn.at(-1), lx = px.at(-1), n20 = pn.at(-21);
  const sameDay = ln && lx && ln.d === lx.d;
  return (
    <div className="content nq" data-screen="options-nasdaq">
      <Panel title="Volatilité implicite du Nasdaq 100 · VXN" label="VXN" controls="none" chips={<Chip small>{ln ? `Cboe via FRED · ${dayFmt(ms(ln.d))}` : 'Cboe via FRED'}</Chip>}>
        <div className="nq-kpis" data-testid="nq-vxn">
          <div className="nq-kpi"><span className="lbl lbl--s">VXN</span><span className="num nq-big">{ln ? fmtNumber(ln.c, 2) : '—'}</span></div>
          <div className="nq-kpi"><span className="lbl lbl--s">Sur 20 séances</span><span className="num">{ln && n20 ? fmtSigned(ln.c - n20.c, 2) : '—'}</span></div>
          <div className="nq-kpi"><span className="lbl lbl--s">VIX (S&amp;P 500)</span><span className="num">{lx ? fmtNumber(lx.c, 2) : '—'}</span></div>
          <div className="nq-kpi"><span className="lbl lbl--s">Écart VXN − VIX</span><span className="num">{sameDay ? fmtSigned(ln.c - lx.c, 2) : '—'}</span></div>
        </div>
        {why ? <Empty reason={`${why} (série ajoutée le 26/11/2026 : premier relevé au prochain passage de p4-jobs)`} />
          : <LineChart label="VXN et VIX sur un an" height={240} xFmt={(t) => dayFmt(t)} yFmt={(y) => fmtNumber(y, 0)}
              series={[{ points: pn.map((p) => [ms(p.d), p.c]), cls: 'c-gold', label: 'VXN (Nasdaq 100)' }, { points: px.map((p) => [ms(p.d), p.c]), cls: 'c-up', label: 'VIX (S&P 500)' }]} />}
      </Panel>
      <Panel title="Chaîne d’options QQQ · sourire, skew, open interest" label="Chaîne d’options Nasdaq" controls="none">
        <Empty reason="chaîne d’options du QQQ et du NDX : données OPRA et Cboe payantes, aucune source gratuite sous licence trouvée (T-075)">
          Sourire, skew 25 delta et open interest par strike : aucune source gratuite autorisée pour les options du Nasdaq (OPRA, Cboe : payants). Le VXN ci-dessus résume la volatilité implicite à 30 jours.
        </Empty>
      </Panel>
    </div>
  );
}
