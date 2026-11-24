// Sentiment retail (plan P4, S4 ; commande BTC LSR). Pas de maquette : design system (T-033).
// Ratios long/short des comptes et des gros comptes (Binance, OKX, Bybit), écart à leur moyenne
// sur 30 jours, taux de financement. Le sentiment retail des changes n'a pas de source libre fiable
// (plan) : « — » avec la raison.

import { useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Segmented, Sparkline } from '../../components/ui';
import { useValue } from '../../data/store';
import { direction, fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm } from '../../lib/time';
import {
  CROWD_METRIC_LABEL, CROWD_METRICS, EXCHANGE_LABEL, EXCHANGES, fmtFunding, PARIS, sentimentKey, type Crowding, type Reply,
} from '../../sentiment/sentiment';
import { Empty, Fresh, FreshChip, useSentimentReason } from '../../sentiment/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

type Asset = 'BTC' | 'ETH';

export function RetailScreen() {
  const now = useNow();
  const reply = useValue<Reply<Crowding>>(sentimentKey('crowding'));
  const reason = useSentimentReason(reply);
  const [asset, setAsset] = useState<Asset>('BTC');
  const a = reply?.data?.assets[asset] ?? null;
  const rows = a ? EXCHANGES.flatMap((ex) => CROWD_METRICS.flatMap((m) => (a[ex]?.[m] ? [{ ex, m, v: a[ex][m] }] : []))) : [];
  const lastTs = rows.map((r) => r.v.ts).sort().at(-1);
  return (
    <>
      <SubHeader icon="retail" title={`Sentiment retail · ${asset} perpétuel`}
        chips={<><Chip variant="hot" round>{lastTs ? `Point horaire ${fmtHm(Date.parse(lastTs), PARIS)}` : 'Point —'}</Chip>
          <FreshChip source="Binance, OKX, Bybit" feed={reply?.feed} now={now} /></>} />
      <div className="content sn" data-screen="retail">
        <div className="sn-tools"><Segmented label="Actif" value={asset} onChange={setAsset} options={[{ value: 'BTC', label: 'BTC' }, { value: 'ETH', label: 'ETH' }]} /></div>
        <Panel title={`Ratios long/short · ${asset}`} label="Ratios long/short" controls="none">
          {rows.length ? <div className="sn-scroll"><table className="sn-table">
            <thead><tr className="lbl lbl--s"><th>Plateforme</th><th className="r">Ratio</th><th className="r hide-xs">Longs</th><th className="r">Moy. 30 j</th>
              <th className="r">Écart</th><th className="hide-xs">72 h</th></tr></thead>
            <tbody>{rows.map(({ ex, m, v }) => (
              <tr key={`${ex}-${m}`} data-testid={`crowd-${ex}-${m}`}>
                <td><b>{EXCHANGE_LABEL[ex]}</b><span className="sn-sub">{CROWD_METRIC_LABEL[m]}</span></td>
                <td className="r num">{fmtNumber(v.last, 2)}</td>
                <td className="r num hide-xs">{v.long_share != null ? `${fmtNumber(v.long_share * 100, 1)}${NBSP}%` : '—'}</td>
                <td className="r num">{v.avg_30d != null ? fmtNumber(v.avg_30d, 2) : '—'}
                  {v.partial && <span className="sn-sub" title="moyenne calculée sur l’historique disponible">{`sur ${fmtNumber(v.days_covered, 0)} j`}</span>}</td>
                <td className={`r num ${direction(v.deviation_pct)}`}>{v.deviation_pct != null ? `${fmtSigned(v.deviation_pct, 1)}${NBSP}%` : <Missing reason="moyenne absente" />}</td>
                <td className="hide-xs"><Sparkline values={v.spark} width={120} /></td>
              </tr>
            ))}</tbody>
          </table></div> : <Empty reason={reason} />}
          <Fresh>{'Binance, OKX, Bybit · ratios horaires des contrats perpétuels USDT, relevés toutes les 15 min · « sur n j » : moins de 30 jours d’historique disponible'}</Fresh>
        </Panel>
        <div className="sn-row">
          <Panel title={`Financement · ${asset}`} label="Financement" controls="none" style={{ flex: '1 1 380px' }}>
            {a ? <table className="sn-table">
              <thead><tr className="lbl lbl--s"><th>Plateforme</th><th className="r">Taux par période</th><th className="r">Relevé</th></tr></thead>
              <tbody>{EXCHANGES.map((ex) => {
                const f = a[ex]?.funding;
                return <tr key={ex} data-testid={`funding-${ex}`}><td><b>{EXCHANGE_LABEL[ex]}</b></td>
                  <td className={`r num ${f ? direction(f.last) : ''}`}>{f ? fmtFunding(f.last) : <Missing reason="pas de relevé" />}</td>
                  <td className="r num">{f ? fmtHm(Date.parse(f.ts), PARIS) : '—'}</td></tr>;
              })}</tbody>
            </table> : <Empty reason={reason} />}
            <Fresh>Binance (premiumIndex), OKX (funding-rate), Bybit (tickers) · taux en cours, heure de la plateforme</Fresh>
          </Panel>
          <Panel title="Changes · positionnement retail" label="Changes" controls="none" style={{ flex: '1 1 380px' }}>
            <Empty reason="aucune source libre et fiable pour le positionnement retail des changes (plan P4)" />
            <Fresh>Source : — · voir COT pour le positionnement institutionnel des devises</Fresh>
          </Panel>
        </div>
      </div>
    </>
  );
}
