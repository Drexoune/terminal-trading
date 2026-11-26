// Indicateurs (P7, S2 ; commande IND ; T-075) : fiche d'un actif, valeurs par unité de temps (EMA,
// RSI, MACD, ATR, distance au plus haut), signaux de la tendance et clôtures des 120 derniers jours.

import { Tip } from '../../help/Tip';
import type { Term } from '../../help/content';
import './analysis.css';
import { useSearchParams } from 'react-router-dom';
import { useAnalysis } from '../../analysis/client';
import { Panel } from '../../components/Panel';
import { Cell, Chip } from '../../components/ui';
import { fmtNumber, fmtPctChange, fmtSigned } from '../../lib/format';
import { SubHeader } from '../../shell/SubHeader';
import { Empty, FreshChip, LineChart } from './parts';
import { level, TREND_LABEL, type Tech } from './TechMap';

const dayFmt = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' }).format(ms);

export function IndicatorsScreen() {
  const s = useAnalysis<Tech>('tech');
  const [params, setParams] = useSearchParams();
  const v = s.value;
  const id = params.get('actif') ?? 'BTC';
  const a = v?.assets.find((x) => x.asset === id) ?? v?.assets[0];
  const dec = a && a.cells.some((c) => (c.snap?.close ?? 0) > 1000) ? 0 : 2;
  return (
    <>
      <SubHeader icon="indicators" title="Indicateurs · fiche technique"
        chips={v ? <label className="an-select"><span className="lbl lbl--s">Actif</span>
          <select className="input" value={a?.asset ?? ''} onChange={(e) => setParams({ actif: e.target.value })}>
            {v.assets.map((x) => <option key={x.asset} value={x.asset}>{x.label}</option>)}
          </select></label> : undefined} />
      <div className="content an" data-screen="indicators">
        {!v || !a ? <Panel title="Indicateurs" controls="none"><Empty reason={s.reason ?? '—'} /></Panel> : <>
          <Panel title={`${a.label} · par unité de temps`} controls="none" chips={<FreshChip s={s} source={a.source} />}>
            <div className="an-scroll">
              <table className="an-table" data-testid="indicators">
                <thead><tr>{(([['UT'], ['Tendance', 'trendScore'], ['Clôture'], ['EMA 20', 'ema'], ['EMA 50', 'ema'], ['EMA 200', 'ema'], ['RSI 14', 'rsi'], ['MACD − signal', 'macd'], ['ATR', 'atr'], ['Depuis le plus haut', 'fromHigh'], ['Bougies']]) as [string, Term?][]).map(([h, t]) => <th key={h} className="lbl"><span className="lbl-tip">{h}{t && <Tip term={t} label={h} />}</span></th>)}</tr></thead>
                <tbody>{a.cells.map((c) => {
                  const x = c.snap;
                  return (
                    <tr key={c.tf}>
                      <th scope="row">{c.tf}</th>
                      {!x ? <td colSpan={10} className="an-na-row">{`— ${c.reason ?? 'historique insuffisant'}`}</td> : <>
                        <td>{x.trend ? <Cell level={level(x.score)}>{`${TREND_LABEL[x.trend]} ${fmtSigned(x.score, 0)}`}</Cell> : <span className="an-na">—</span>}</td>
                        <td className="num">{fmtNumber(x.close, dec)}</td>
                        <td className="num">{fmtNumber(x.ema20, dec)}</td>
                        <td className="num">{fmtNumber(x.ema50, dec)}</td>
                        <td className="num">{fmtNumber(x.ema200, dec)}</td>
                        <td className="num">{fmtNumber(x.rsi, 1)}</td>
                        <td className={`num ${(x.macd_hist ?? 0) >= 0 ? 'up' : 'dn'}`}>{fmtSigned(x.macd_hist, dec)}</td>
                        <td className="num">{fmtPctChange(x.atr_pct, 2).replace('+', '')}</td>
                        <td className="num">{fmtPctChange(x.from_high, 1)}</td>
                        <td className="num">{c.bars}</td>
                      </>}
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Panel>
          <div className="an-grid">
            <Panel title="Signaux · quotidien" controls="none" chips={<Chip small>+1 haussier · −1 baissier</Chip>}>
              {(() => { const d = a.cells.find((c) => c.tf === '1D')?.snap; return d ? (
                <ul className="an-signals" data-testid="indicators-signals">{d.signals.map((g) => (
                  <li key={g.label} className={g.bull === null ? '' : g.bull ? 'up' : 'dn'}>{`${g.bull === null ? '—' : g.bull ? '+1' : '−1'} · ${g.label}`}</li>
                ))}</ul>) : <Empty reason="quotidien indisponible" />; })()}
            </Panel>
            <Panel title="Clôtures · 120 jours" controls="none">
              <LineChart label={`Clôtures quotidiennes, ${a.label}`} xFmt={dayFmt} yFmt={(y) => fmtNumber(y, dec)} series={[{ points: a.closes, cls: 'c-gold', label: 'Clôture' }]} />
            </Panel>
          </div>
        </>}
      </div>
    </>
  );
}
