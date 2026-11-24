// Positions des banques (plan P4, S4 ; commande BPR). Pas de maquette : design system (T-033).
// Deux sources, chacune avec sa fraîcheur (T-060) :
// - Bank Participation Report de la CFTC, mensuel : banques américaines et non américaines, lu par
//   Vercel (la CFTC refuse Supabase) ;
// - catégorie « dealers » du rapport TFF, hebdomadaire : surtout de grandes banques, mais pas le
//   même périmètre, et nommée comme telle.

import { Panel } from '../../components/Panel';
import { Chip, Missing, PercentileBar, Sparkline } from '../../components/ui';
import { useValue } from '../../data/store';
import { direction, fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { fmtContracts, fmtDay, sentimentKey, type BanksReply } from '../../sentiment/sentiment';
import { Empty, Fresh, FreshChip, useSentimentReason } from '../../sentiment/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

export function BanksScreen() {
  const now = useNow();
  const reply = useValue<BanksReply>(sentimentKey('banks'));
  const reason = useSentimentReason(reply);
  const dealers = reply?.data ?? null;
  const bpr = reply?.bpr ?? null;
  return (
    <>
      <SubHeader icon="bankpos" title="Positions des banques · futures (CFTC)"
        chips={<>
          <Chip variant="hot" round>{bpr?.report_date ? `BPR au ${fmtDay(bpr.report_date)}` : 'BPR —'}</Chip>
          <FreshChip source="CFTC BPR" feed={reply?.bpr_feed} now={now} />
          <FreshChip source="CFTC TFF" feed={reply?.feed} now={now} />
        </>} />
      <div className="content sn" data-screen="banks">
        <Panel title="Banques · Bank Participation Report" label="Bank Participation Report" controls="none">
          {bpr?.markets.length ? <div className="sn-scroll"><table className="sn-table">
            <thead><tr className="lbl lbl--s"><th>Marché</th><th className="r">Banques</th><th className="r">Long</th><th className="r">Short</th>
              <th className="r">Net</th><th className="r hide-xs">1 M</th><th className="hide-xs">Historique</th></tr></thead>
            <tbody>{bpr.markets.map((m) => (
              <tr key={m.market} data-testid={`bpr-${m.label}`}>
                <td><b>{m.label}</b><span className="sn-sub">{m.market}</span></td>
                <td className="r num">{m.banks ?? <Missing reason="nombre masqué par la CFTC sous 4 banques" />}</td>
                <td className="r num">{fmtNumber(m.long, 0)}<span className="sn-sub">{`${fmtNumber(m.long_pct, 1)}${NBSP}% IO`}</span></td>
                <td className="r num">{fmtNumber(m.short, 0)}<span className="sn-sub">{`${fmtNumber(m.short_pct, 1)}${NBSP}% IO`}</span></td>
                <td className={`r num ${direction(m.net)}`}>{fmtContracts(m.net)}<span className="sn-sub">{`${fmtSigned(m.net_pct_oi, 1)}${NBSP}% IO`}</span></td>
                <td className="r num hide-xs">{m.net_change_1m != null ? fmtSigned(m.net_change_1m, 0) : '—'}</td>
                <td className="hide-xs">{m.history.length > 1 ? <Sparkline values={m.history.map((h) => h.net)} width={120} /> : <Missing reason="un seul mois relevé" />}</td>
              </tr>
            ))}</tbody>
          </table></div> : <Empty reason={reply?.bpr_reason ?? reason} />}
          <Fresh>{`${bpr?.source ?? 'CFTC, Bank Participation Report (futures)'} · positions du ${fmtDay(bpr?.report_date, true)} (premier mardi du mois) · banques américaines et non américaines · page lue par Vercel (T-060)`}</Fresh>
        </Panel>

        <Panel title={dealers?.label ?? 'Dealers (rapport TFF de la CFTC)'} label="Dealers" controls="none">
          {dealers?.markets.length ? <div className="sn-scroll"><table className="sn-table">
            <thead><tr className="lbl lbl--s"><th>Marché</th><th className="r">Net</th><th className="r">1 S</th><th className="r hide-xs">% IO</th>
              <th>Percentile 3 ans</th><th className="hide-xs">3 ans</th></tr></thead>
            <tbody>{dealers.markets.map((m) => (
              <tr key={m.code} data-testid={`dealer-${m.code}`}>
                <td><b>{m.label}</b></td>
                <td className={`r num ${m.dealer ? direction(m.dealer.net) : ''}`}>{m.dealer ? fmtContracts(m.dealer.net) : <Missing reason="catégorie absente" />}</td>
                <td className="r num">{m.dealer?.net_change_1w != null ? fmtSigned(m.dealer.net_change_1w, 0) : '—'}</td>
                <td className="r num hide-xs">{m.dealer ? `${fmtSigned(m.dealer.net_pct_oi, 1)}${NBSP}%` : '—'}</td>
                <td>{m.dealer?.percentile_3y != null
                  ? <div className="sn-pct"><div><PercentileBar pct={m.dealer.percentile_3y} /></div><span className="num">{Math.round(m.dealer.percentile_3y)}</span></div>
                  : <Missing reason="moins d’un an de rapports" />}</td>
                <td className="hide-xs"><Sparkline values={m.history.net} width={120} /></td>
              </tr>
            ))}</tbody>
          </table></div> : <Empty reason={reason} />}
          <Fresh>{`CFTC, Traders in Financial Futures · positions du mardi ${fmtDay(dealers?.report_date)} · « dealers » : surtout de grandes banques, périmètre différent du BPR`}</Fresh>
        </Panel>
      </div>
    </>
  );
}
