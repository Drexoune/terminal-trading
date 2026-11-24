// Panneaux de diagnostic du backtest (étape S2) : Monte Carlo, sociétés de financement (FTMO,
// Lucid), dans et hors échantillon. Recalculés à partir du dernier backtest quand un réglage
// change, sans relancer le moteur.

import { useMemo, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Segmented } from '../../components/ui';
import { evaluateFirm, firmInput, firms, monteCarlo, rollingStarts, splitSample, type FirmResult, type Pctl } from '../../backtest/diagnostics';
import type { Candle, Metrics, OpenTrade, Trade, Trials } from '../../backtest/metrics';
import { fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { Empty } from '../../sentiment/ui';

export interface DiagInput { candles: Candle[]; trades: Trade[]; open: OpenTrade[]; equity: number[]; capital: number; bpy: number; trials: Trials; tf: string; cur: string }

const pct = (x: number, d = 1) => `${fmtNumber(x, d)}${NBSP}%`;
const day = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—');

function PctlRow({ label, p, neg }: { label: string; p: Pctl; neg?: boolean }) {
  const f = (x: number) => (neg ? (x === 0 ? pct(0) : `−${pct(x)}`) : `${fmtSigned(x, 1)}${NBSP}%`);
  return <tr><td>{label}</td>{(['p5', 'p25', 'p50', 'p75', 'p95'] as const).map((k) => <td key={k} className="r num">{f(p[k])}</td>)}</tr>;
}

export function MonteCarloPanel({ x }: { x: DiagInput }) {
  const [ruin, setRuin] = useState(50);
  const mc = useMemo(() => monteCarlo(x.trades, x.capital, { iterations: 1000, seed: 42, ruinDdPct: ruin }), [x, ruin]);
  return (
    <Panel title="Monte Carlo" label="Monte Carlo" controls="none" chips={<Chip>1 000 tirages · graine 42</Chip>}>
      {mc ? <>
        <div className="bt-kpis">
          <div><span className="lbl lbl--s">Risque de ruine</span><b className={`num ${mc.bootstrap.p_ruin > 5 ? 'dn' : ''}`} data-testid="mc-ruin">{pct(mc.bootstrap.p_ruin)}</b>
            <span className="bt-sub">{`drawdown de ${ruin} % ou plus, tirage avec remise`}</span></div>
          <div><span className="lbl lbl--s">Probabilité de perte</span><b className="num">{pct(mc.bootstrap.p_loss)}</b><span className="bt-sub">résultat final négatif</span></div>
          <div><span className="lbl lbl--s">Ordre défavorable</span><b className="num">{pct(mc.shuffle.worse_than_original_pct)}</b>
            <span className="bt-sub">{`des ordres tirés font un pire drawdown que l’historique (−${pct(mc.original.dd_pct)})`}</span></div>
        </div>
        <div className="bt-scroll"><table className="bt-table">
          <thead><tr className="lbl lbl--s"><th>Centile</th><th className="r">5 %</th><th className="r">25 %</th><th className="r">50 %</th><th className="r">75 %</th><th className="r">95 %</th></tr></thead>
          <tbody>
            <PctlRow label="Drawdown, ordre permuté" p={mc.shuffle.dd_pct} neg />
            <PctlRow label="Drawdown, tirage avec remise" p={mc.bootstrap.dd_pct} neg />
            <PctlRow label="Résultat final, tirage avec remise" p={mc.bootstrap.final_pct} />
          </tbody>
        </table></div>
        <label className="bt-field bt-inline"><span className="lbl lbl--s">Seuil de ruine (drawdown, %)</span>
          <input type="number" className="num" min={5} max={95} step={5} value={ruin} onChange={(e) => setRuin(Number(e.target.value) || 50)} /></label>
      </> : <Empty reason="il faut au moins 2 trades clos" />}
      <div className="lbl lbl--s bt-src" data-fresh>{`${x.trades.length} trades clos · rendements composés sur le capital · drawdown au pas des trades`}</div>
    </Panel>
  );
}

function FirmRow({ r, roll }: { r: FirmResult; roll: ReturnType<typeof rollingStarts> }) {
  const tone = r.status === 'passed' ? 'up' : r.status === 'failed' ? 'dn' : 'nt';
  const word = r.status === 'passed' ? 'Réussi' : r.status === 'failed' ? 'Échoué' : 'En cours';
  return (
    <tr data-testid={`firm-${r.id}`}>
      <td><b>{r.label}</b><span className="bt-sub">{`compte de ${fmtNumber(r.account, 0)} $ · PnL × ${fmtNumber(r.scale, 2)}`}</span></td>
      <td><span className={`bt-verdict bt-verdict--${tone}`}>{word}</span><span className="bt-sub">{r.at ? `le ${day(r.at)}` : ''}</span></td>
      <td className="bt-reason">{r.reason}{r.dll_days > 0 && <span className="bt-sub">{`DLL atteinte ${r.dll_days} séance${r.dll_days > 1 ? 's' : ''} (séance bloquée, pas d’échec)`}</span>}
        {r.session_holds > 0 && <span className="bt-sub">{`${r.session_holds} trade${r.session_holds > 1 ? 's' : ''} gardé${r.session_holds > 1 ? 's' : ''} au-delà de 16:45 New York : Lucid les liquide`}</span>}</td>
      <td className="r num">{r.trading_days}<span className="bt-sub">{`${r.days} j`}</span></td>
      <td className="r num">{r.best_day_pct === null ? <Missing reason="aucun profit net" /> : pct(r.best_day_pct, 0)}</td>
      <td className="r num">{roll.starts ? pct((roll.passed / roll.starts) * 100, 0) : '—'}
        <span className="bt-sub">{`${roll.passed} / ${roll.starts} départs${roll.median_days !== null ? ` · ${fmtNumber(roll.median_days, 0)} j méd.` : ''}`}</span></td>
    </tr>
  );
}

export function FirmsPanel({ x }: { x: DiagInput }) {
  const [account, setAccount] = useState(100_000);
  const [dll, setDll] = useState(false);
  const [cons, setCons] = useState<'0.4' | '0.5'>('0.4');
  const input = useMemo(() => {
    const step = x.candles.length > 1 ? x.candles[1].t - x.candles[0].t : 86_400_000;
    return firmInput(x.candles.map((c) => c.t), step, x.equity, x.trades, x.open, x.capital);
  }, [x]);
  const rows = useMemo(() => firms({ ftmoAccount: account, lucidDll: dll, lucidConsistency: cons === '0.5' ? 0.5 : 0.4 })
    .map((r) => ({ r: evaluateFirm(r, input), roll: rollingStarts(r, input) })), [input, account, dll, cons]);
  return (
    <Panel title="Sociétés de financement" label="Sociétés de financement" controls="none">
      <div className="bt-form bt-form--inline">
        <label className="bt-field"><span className="lbl lbl--s">Compte FTMO ($)</span>
          <select value={account} onChange={(e) => setAccount(Number(e.target.value))}>{[10_000, 25_000, 50_000, 100_000, 200_000].map((a) => <option key={a} value={a}>{fmtNumber(a, 0)}</option>)}</select></label>
        <label className="bt-field"><span className="lbl lbl--s">Constance Lucid</span>
          <Segmented label="Constance Lucid" value={cons} onChange={setCons} options={[{ value: '0.4', label: '40 %' }, { value: '0.5', label: '50 %' }]} /></label>
        <label className="bt-field bt-check"><input type="checkbox" checked={dll} onChange={(e) => setDll(e.target.checked)} /><span>DLL Lucid de 600 $</span></label>
      </div>
      <div className="bt-scroll"><table className="bt-table bt-table--firms">
        <thead><tr className="lbl lbl--s"><th>Évaluation</th><th>Verdict</th><th>Raison</th><th className="r">Jours</th><th className="r">Meilleur jour</th><th className="r">Départs mensuels</th></tr></thead>
        <tbody>{rows.map(({ r, roll }) => <FirmRow key={r.id} r={r} roll={roll} />)}</tbody>
      </table></div>
      <div className="lbl lbl--s bt-src" data-fresh>
        {`FTMO : objectifs officiels relevés le 24/11/2026, journées à minuit (Prague) · Lucid : règles transmises par Clément, consolidation non officielle à vérifier sur le tableau de bord, séance 18:00 → 16:45 (New York) · pertes contrôlées aux clôtures de barre${x.tf === '1D' ? ' (en 1 j, les plus bas de la journée ne sont pas vus)' : ''} · tailles de contrats non vérifiables (actifs hors futures)`}
      </div>
    </Panel>
  );
}

const ROWS: { key: keyof Metrics; label: string; fmt: (v: number) => string }[] = [
  { key: 'trades', label: 'Trades', fmt: (v) => fmtNumber(v, 0) },
  { key: 'winrate', label: 'Taux de réussite', fmt: (v) => pct(v * 100) },
  { key: 'total_pnl_pct', label: 'PnL total (% du capital de départ)', fmt: (v) => `${fmtSigned(v, 1)}${NBSP}%` },
  { key: 'rr', label: 'RR', fmt: (v) => fmtNumber(v, 2) },
  { key: 'ex_ret_pct', label: 'E[X] par trade', fmt: (v) => `${fmtSigned(v, 2)}${NBSP}%` },
  { key: 'max_dd_pct', label: 'Drawdown maximal', fmt: (v) => (v === 0 ? pct(0) : `−${pct(v)}`) },
  { key: 'sharpe', label: 'Sharpe', fmt: (v) => fmtNumber(v, 2) },
  { key: 't_stat', label: 't-stat', fmt: (v) => fmtNumber(v, 2) },
  { key: 'dsr', label: 'Sharpe déflaté', fmt: (v) => pct(v * 100) },
];

export function SamplePanel({ x }: { x: DiagInput }) {
  const [share, setShare] = useState(70);
  const bar = Math.round((x.candles.length * share) / 100);
  const s = useMemo(() => splitSample(x.trades, x.equity, bar, x.capital, x.bpy, x.trials), [x, bar]);
  const at = x.candles[Math.min(bar, x.candles.length - 1)];
  const cut = at ? new Date(at.t).toISOString().slice(0, 10) : null;
  return (
    <Panel title="Dans et hors échantillon" label="Dans et hors échantillon" controls="none"
      chips={s?.ratio_sharpe != null ? <Chip variant={s.ratio_sharpe >= 0.5 ? 'live' : 'down'} title="Sharpe hors échantillon / Sharpe dans l’échantillon">{`Tenue du Sharpe ${fmtNumber(s.ratio_sharpe, 2)}`}</Chip> : undefined}>
      <label className="bt-field bt-inline"><span className="lbl lbl--s">{`Coupure : ${share} % de la période dans l’échantillon, jusqu’au ${day(cut)}`}</span>
        <input type="range" min={30} max={90} step={5} value={share} onChange={(e) => setShare(Number(e.target.value))} aria-label="Part de la période dans l’échantillon" /></label>
      {s ? <div className="bt-scroll"><table className="bt-table">
        <thead><tr className="lbl lbl--s"><th>Mesure</th><th className="r">Dans l’échantillon</th><th className="r">Hors échantillon</th></tr></thead>
        <tbody>{ROWS.map((row) => {
          const a = s.is[row.key] as number | null, b = s.oos[row.key] as number | null;
          return <tr key={row.key} data-testid={`split-${row.key}`}><td>{row.label}</td>
            <td className="r num">{a === null ? <Missing reason="mesure absente sur ce segment" /> : row.fmt(a)}</td>
            <td className="r num">{b === null ? <Missing reason="mesure absente sur ce segment" /> : row.fmt(b)}</td></tr>;
        })}</tbody>
      </table></div> : <Empty reason="période trop courte pour une coupure" />}
      <div className="lbl lbl--s bt-src" data-fresh>Trades répartis selon leur entrée ; le hors échantillon part du capital à la coupure. En recherche autonome (S4), il restera à l’aveugle : réussite ou échec seulement.</div>
    </Panel>
  );
}
