// Saisonnalité (P7, S1 ; commande SEAS ; T-075) : rendements historiques par mois, jour de semaine,
// heure de Paris et jour du mois, et trajectoire moyenne de l'année comparée à l'année en cours.
// Calcul de nuit par la machine Oracle sur nos bougies ; aucune prévision.

import './analysis.css';
import { useState } from 'react';
import { useAnalysis, type AnalysisKey } from '../../analysis/client';
import type { Bucket, Seasonality } from '../../analysis/seasonality';
import { Panel } from '../../components/Panel';
import { Chip, Segmented } from '../../components/ui';
import { fmtNumber, fmtPctChange, NBSP } from '../../lib/format';
import { SubHeader } from '../../shell/SubHeader';
import { Empty, FreshChip, LineChart } from './parts';

const ASSETS = [{ value: 'BTC', label: 'BTC' }, { value: 'ETH', label: 'ETH' }, { value: 'QQQ', label: 'QQQ' }, { value: 'SPY', label: 'SPY' }] as const;
type Asset = typeof ASSETS[number]['value'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const year = (ms: number) => new Date(ms).getUTCFullYear();

function BucketTable({ rows, testId }: { rows: Bucket[]; testId: string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.abs(r.mean ?? 0)));
  const dec = max < 0.001 ? 3 : 2;                                  // moyennes horaires : une décimale de plus
  return (
    <div className="an-scroll">
      <table className="an-table an-buckets" data-testid={testId}>
        <thead><tr><th className="lbl">Période</th><th className="lbl an-barcol">Rendement moyen</th><th className="lbl">Moyenne</th><th className="lbl">Médiane</th><th className="lbl">Hausses</th><th className="lbl">Obs.</th></tr></thead>
        <tbody>{rows.map((r) => {
          const w = r.mean === null ? 0 : (Math.abs(r.mean) / max) * 50;
          return (
            <tr key={r.key} className={r.weak ? 'an-weak' : ''} title={r.weak ? `échantillon faible : ${r.n} observations` : `${r.n} observations, t = ${fmtNumber(r.t, 2)}`}>
              <td>{r.label}</td>
              <td className="an-barcol"><span className="an-bar"><i className={(r.mean ?? 0) >= 0 ? 'up' : 'dn'} style={{ width: `${w}%`, [(r.mean ?? 0) >= 0 ? 'left' : 'right']: '50%' }} /></span></td>
              <td className={`num ${(r.mean ?? 0) >= 0 ? 'up' : 'dn'}`}>{fmtPctChange(r.mean, dec)}</td>
              <td className="num">{fmtPctChange(r.median, dec)}</td>
              <td className="num">{r.up === null ? '—' : `${fmtNumber(r.up * 100, 0)}${NBSP}%`}</td>
              <td className="num">{r.n}{r.weak && <span className="an-flag"> · faible</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function SeasonScreen() {
  const [asset, setAsset] = useState<Asset>('BTC');
  const s = useAnalysis<Seasonality>(`season:${asset}` as AnalysisKey);
  const v = s.value;
  const src = v ? `${v.source} · ${v.from ? year(v.from) : '—'}–${v.to ? year(v.to) : '—'}` : 'bt_candles (OKX, Tiingo)';
  const fresh = <FreshChip s={s} source={src} />;
  const doy = (i: number) => { const d = new Date(Date.UTC(2025, 0, 1 + i)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
  const path = (pts: (number | null)[] | undefined) => (pts ?? []).map((y, i) => [i, y] as [number, number | null]).filter((p): p is [number, number] => p[1] !== null);
  return (
    <>
      <SubHeader icon="season" title="Saisonnalité · moyennes historiques"
        chips={<><Segmented label="Actif" options={[...ASSETS]} value={asset} onChange={setAsset} /><Chip variant="hot" round>Historique, pas une prévision</Chip></>} />
      <div className="content an" data-screen="season">
        {!v ? <Panel title="Saisonnalité" controls="none"><Empty reason={s.reason ?? '—'} /></Panel> : <>
          <Panel title={`Trajectoire de l’année · ${v.label}`} controls="none" chips={fresh}>
            <p className="an-note lbl lbl--s">{`Moyenne de ${v.years} années complètes, cumul depuis le 1er janvier ; année ${v.current?.year ?? '—'} en or.`}</p>
            <LineChart label={`Trajectoire moyenne de l’année et année en cours, ${v.label}`} zero xFmt={doy} yFmt={(y) => fmtPctChange(y, 0)}
              series={[{ points: path(v.avg_path), cls: 'c-up', label: `Moyenne (${v.years} ans)` }, { points: path(v.current?.points), cls: 'c-gold', label: String(v.current?.year ?? '') }]} />
          </Panel>
          <div className="an-grid">
            <Panel title="Par mois" controls="none" chips={<Chip small>clôture à clôture</Chip>}><BucketTable rows={v.months} testId="season-months" /></Panel>
            <Panel title="Par jour de semaine" controls="none" chips={<Chip small>date UTC</Chip>}><BucketTable rows={v.weekdays} testId="season-weekdays" /></Panel>
            <Panel title="Par heure de Paris" controls="none" chips={<Chip small>ouverture → clôture</Chip>}>
              {v.hours.length ? <BucketTable rows={v.hours} testId="season-hours" /> : <Empty reason="pas de bougies horaires gratuites pour les ETF (T-051)" />}
            </Panel>
            <Panel title="Par jour du mois" controls="none"><BucketTable rows={v.monthdays} testId="season-monthdays" /></Panel>
          </div>
          <p className="an-foot lbl lbl--s">{`${v.bars_daily} bougies quotidiennes, ${v.bars_hourly} horaires · « faible » : moins de 8 années (mois), 30 (jours) ou 100 (heures) observations · ETF du PEA : suivre QQQ et SPY.`}</p>
        </>}
      </div>
    </>
  );
}
