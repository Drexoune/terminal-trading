// Liquidité (plan P4, S4 ; commande LIQ). Pas de maquette : design system (T-033). Liquidité nette
// de la Fed = actif total − compte du Trésor − reverse repo, les trois au mercredi (T-060) ; la
// profondeur du carnet BTC à ±1 % arrive avec le carnet d'ordres (P5).

import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';
import { useValue } from '../../data/store';
import { direction } from '../../lib/format';
import { fmtBn, fmtDay, sentimentKey, type Liquidity, type Reply } from '../../sentiment/sentiment';
import { Empty, Fresh, FreshChip, Lines, useSentimentReason } from '../../sentiment/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

const CHANGES = [['w1', '1 semaine'], ['w4', '4 semaines'], ['w13', '13 semaines'], ['w52', '52 semaines']] as const;

export function LiquidityScreen() {
  const now = useNow();
  const reply = useValue<Reply<Liquidity>>(sentimentKey('liquidity'));
  const reason = useSentimentReason(reply);
  const l = reply?.data ?? null;
  const last = l?.last ?? null;
  const s = reply?.series ?? {};
  const rows = [
    ['Actif total de la Fed', 'WALCL', last?.walcl, s.WALCL?.last_date],
    ['Compte du Trésor', 'WDTGAL', last?.tga, s.WDTGAL?.last_date],
    ['Reverse repo', 'RRPONTSYD', last?.rrp, s.RRP?.last_date],
  ] as const;
  return (
    <>
      <SubHeader icon="liquidity" title="Liquidité · liquidité nette de la Fed"
        chips={<><Chip variant="hot" round>{last ? `Mercredi ${fmtDay(last.date)}` : 'Mercredi —'}</Chip>
          <FreshChip source="FRED" feed={reply?.feed} now={now} /></>} />
      <div className="content sn" data-screen="liquidity">
        <div className="sn-row">
          <Panel title="Liquidité nette" label="Liquidité nette" controls="none" style={{ flex: '1 1 380px' }}>
            {last ? <div className="sn-kpi">
              <div className="sn-kpi-v num" data-testid="liq-net">{fmtBn(last.net)}</div>
              <div className="sn-kpi-grid">{CHANGES.map(([k, label]) => (
                <div key={k}><span className="lbl lbl--s">{label}</span>
                  <span className={`num ${direction(l!.changes[k])}`}>{l!.changes[k] == null ? '—' : fmtBn(l!.changes[k], true)}</span></div>
              ))}</div>
            </div> : <Empty reason={reason} />}
            <Fresh>{`FRED · ${l?.formula ?? 'WALCL − WDTGAL − RRPONTSYD × 1 000'} · mercredi ${fmtDay(last?.date, true)}`}</Fresh>
          </Panel>
          <Panel title="Composantes" label="Composantes" controls="none" style={{ flex: '1 1 380px' }}>
            <table className="sn-table">
              <thead><tr className="lbl lbl--s"><th>Série</th><th className="r">Mercredi</th><th className="r">Dernière donnée</th></tr></thead>
              <tbody>{rows.map(([label, code, v, d]) => (
                <tr key={code}><td><b>{label}</b><span className="sn-sub">{`FRED ${code}`}</span></td>
                  <td className="r num">{fmtBn(v ?? null)}</td><td className="r num">{fmtDay(d ?? null)}</td></tr>
              ))}</tbody>
            </table>
            <Fresh>FRED · actif et compte du Trésor publiés le jeudi pour le mercredi ; reverse repo quotidien, en milliards</Fresh>
          </Panel>
        </div>
        <Panel title="Historique · 3 ans" label="Historique de la liquidité" controls="none">
          {l?.history.length ? <Lines dates={l.history.map((p) => p.date)} height={220}
            series={[{ values: l.history.map((p) => p.net / 1000), tone: 'gold' }, { values: l.history.map((p) => p.walcl / 1000), tone: 'text' }]}
            legend={[{ label: 'Liquidité nette (Md$)', tone: 'gold' }, { label: 'Actif total (Md$)', tone: 'text' }]} /> : <Empty reason={reason} />}
          <Fresh>{`FRED · ${l?.history.length ?? 0} mercredis · dernier ${fmtDay(last?.date, true)}`}</Fresh>
        </Panel>
        <Panel title="Profondeur du carnet BTC · ±1 %" label="Profondeur du carnet" controls="none">
          <Empty reason="arrive en P5 avec le carnet d’ordres agrégé" />
          <Fresh>Source : — (P5)</Fresh>
        </Panel>
      </div>
    </>
  );
}
