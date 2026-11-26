// Options BTC (P7, S3 ; commande OPT ; T-075) : API publique de Deribit relevée toutes les 5 min par
// la machine Oracle. Vol implicite ATM, skew (risk reversal 25 delta), butterfly, structure par terme,
// sourire et open interest d'une échéance, historique du DVOL et de nos relevés.

import { Tip } from '../../help/Tip';
import type { Term } from '../../help/content';
import './analysis.css';
import { useState } from 'react';
import { useAnalysis } from '../../analysis/client';
import type { HistPoint, OptionsSnapshot } from '../../analysis/options';
import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';
import { fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { SubHeader } from '../../shell/SubHeader';
import { Empty, fmtDayHm, FreshChip, LineChart } from './parts';

const SRC = 'Deribit, API publique';
const vol = (x: number | null | undefined) => (x == null ? '—' : `${fmtNumber(x, 1)}${NBSP}%`);
const pts = (x: number | null | undefined) => (x == null ? '—' : `${fmtSigned(x, 2)}${NBSP}pt`);
const dayFmt = (ms: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }).format(ms);

export function OptionsScreen() {
  const s = useAnalysis<OptionsSnapshot>('options');
  const h = useAnalysis<{ points: HistPoint[]; dvol: [number, number][] }>('options-history');
  const v = s.value;
  const [pick, setPick] = useState<number | null>(null);
  const exp = v?.expiries.find((e) => e.expiry === pick) ?? v?.expiries.find((e) => e.days >= 7) ?? v?.expiries[0];
  const near = exp ? exp.smile.filter((p) => p.strike >= exp.forward * 0.6 && p.strike <= exp.forward * 1.6) : [];
  const kpi = (label: string, value: string, title?: string, term?: Term) => <div className="an-kpi" title={title}><span className="lbl lbl--s lbl-tip">{label}{term && <Tip term={term} label={label} />}</span><span className="num an-kpi__v">{value}</span></div>;
  const hist = h.value;
  return (
    <>
      <SubHeader icon="options" title="Options BTC · volatilité implicite et skew" chips={<Chip variant="hot" round>Deribit · relevé toutes les 5 min</Chip>} />
      <div className="content an" data-screen="options">
        {!v ? <Panel title="Options BTC" controls="none"><Empty reason={s.reason ?? '—'} /></Panel> : <>
          <Panel title="Vue d’ensemble · 30 jours constants" controls="none" chips={<FreshChip s={s} source={SRC} />}>
            <div className="an-kpis" data-testid="options-kpis">
              {kpi('Indice BTC (Deribit)', v.index == null ? '—' : `${fmtNumber(v.index, 0)}${NBSP}$`)}
              {kpi('DVOL', vol(v.dvol), 'indice de volatilité de Deribit (30 jours)', 'dvol')}
              {kpi('Vol ATM 30 j', vol(v.atm30), 'interpolée en variance totale entre les deux échéances qui encadrent 30 jours', 'atm')}
              {kpi('Risk reversal 25Δ', pts(v.rr25_30), 'vol du call 25 delta − vol du put 25 delta ; négatif : puts plus chers', 'rr25')}
              {kpi('Butterfly 25Δ', pts(v.bf25_30), 'moyenne des vols 25 delta − vol ATM', 'bf25')}
              {kpi('Put / call (OI)', v.pcr == null ? '—' : fmtNumber(v.pcr, 2), `${fmtNumber(v.oi_p, 0)} puts / ${fmtNumber(v.oi_c, 0)} calls (BTC)`, 'pcr')}
            </div>
          </Panel>
          <Panel title="Structure par terme" controls="none" chips={<Chip small>{`${v.instruments} options · ${v.expiries.length} échéances`}</Chip>}>
            <LineChart label="Vol ATM par échéance" height={150} xFmt={(d) => `${fmtNumber(d, 0)} j`} yFmt={(y) => vol(y)}
              series={[{ points: v.expiries.filter((e) => e.atm !== null).map((e) => [e.days, e.atm!]), cls: 'c-gold', label: 'Vol ATM' }]} />
            <div className="an-scroll">
              <table className="an-table" data-testid="options-term">
                <thead><tr>{['Échéance', 'Jours', 'Prix à terme', 'Vol ATM', 'RR 25Δ', 'BF 25Δ', 'OI calls', 'OI puts'].map((x) => <th key={x} className="lbl">{x}</th>)}</tr></thead>
                <tbody>{v.expiries.map((e) => (
                  <tr key={e.expiry} className={e.expiry === exp?.expiry ? 'an-sel' : ''} onClick={() => setPick(e.expiry)}>
                    <th scope="row"><button type="button" className="an-linkbtn" onClick={() => setPick(e.expiry)}>{e.label}</button></th>
                    <td className="num">{fmtNumber(e.days, 1)}</td><td className="num">{fmtNumber(e.forward, 0)}</td>
                    <td className="num">{vol(e.atm)}</td>
                    <td className={`num ${(e.rr25 ?? 0) >= 0 ? 'up' : 'dn'}`}>{pts(e.rr25)}</td><td className="num">{pts(e.bf25)}</td>
                    <td className="num">{fmtNumber(e.oi_c, 0)}</td><td className="num">{fmtNumber(e.oi_p, 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
          {exp && <div className="an-grid">
            <Panel title={`Sourire · ${exp.label}`} controls="none" chips={<Chip small>option hors de la monnaie à chaque strike</Chip>}>
              <LineChart label={`Vol implicite par strike, échéance ${exp.label}`} markX={exp.forward} xFmt={(k) => fmtNumber(k, 0)} yFmt={(y) => vol(y)}
                series={[{ points: near.map((p) => [p.strike, p.iv]), cls: 'c-gold', label: 'Vol « mark » de Deribit' }]} />
            </Panel>
            <Panel title={`Open interest · ${exp.label}`} controls="none" chips={<Chip small>BTC</Chip>}>
              <LineChart label={`Open interest par strike, échéance ${exp.label}`} markX={exp.forward} xFmt={(k) => fmtNumber(k, 0)} yFmt={(y) => fmtNumber(y, 0)}
                series={[{ points: near.map((p) => [p.strike, p.oi_c]), cls: 'c-up', label: 'Calls' }, { points: near.map((p) => [p.strike, p.oi_p]), cls: 'c-dn', label: 'Puts' }]} />
            </Panel>
          </div>}
          <Panel title="Historique · 90 jours" controls="none" chips={<FreshChip s={h} source="DVOL horaire de Deribit, nos relevés réduits à l’heure" />}>
            {!hist ? <Empty reason={h.reason ?? '—'} /> : <div className="an-grid">
              <LineChart label="DVOL et vol ATM 30 jours" xFmt={dayFmt} yFmt={(y) => vol(y)} series={[
                { points: hist.dvol, cls: 'c-up', label: 'DVOL' },
                { points: hist.points.filter((p) => p.atm30 !== null).map((p) => [p.t, p.atm30!]), cls: 'c-gold', label: 'Vol ATM 30 j (nos relevés)' }]} />
              <LineChart label="Risk reversal 25 delta à 30 jours" zero xFmt={dayFmt} yFmt={(y) => pts(y)} series={[
                { points: hist.points.filter((p) => p.rr25 !== null).map((p) => [p.t, p.rr25!]), cls: 'c-gold', label: 'RR 25Δ 30 j (nos relevés)' }]} />
            </div>}
          </Panel>
          <p className="an-foot lbl lbl--s">{`Relevé du ${fmtDayHm(v.at)} (Paris) · deltas de Black-Scholes sur le prix à terme de chaque échéance, taux nul (convention de Deribit) · aucune estimation de liquidations ni de « max pain ».`}</p>
        </>}
      </div>
    </>
  );
}
