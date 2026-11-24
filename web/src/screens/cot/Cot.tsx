// COT (plan P4, S4 ; commande COT). Pas de maquette : design system (T-033). Rapport Traders in
// Financial Futures de la CFTC (futures seuls) : position nette par catégorie, variation sur une
// semaine, part de l'intérêt ouvert, percentile sur 3 ans ; historique d'un marché.

import { useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing, PercentileBar, Segmented } from '../../components/ui';
import { useValue } from '../../data/store';
import { direction, fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { COT_CATEGORIES, COT_CATEGORY_LABEL, fmtContracts, fmtDay, sentimentKey, type Cot, type Reply } from '../../sentiment/sentiment';
import { Empty, Fresh, FreshChip, Lines, useSentimentReason } from '../../sentiment/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

type Cat = (typeof COT_CATEGORIES)[number];
const SHORT: Record<Cat, string> = { lev_money: 'Spéculatifs', asset_mgr: 'Gérants', dealer: 'Dealers', other_rept: 'Autres', nonrept: 'Non décl.' };
const SOURCE = 'CFTC, Traders in Financial Futures (futures seuls)';

export function CotScreen() {
  const now = useNow();
  const reply = useValue<Reply<Cot>>(sentimentKey('cot'));
  const reason = useSentimentReason(reply);
  const cot = reply?.data ?? null;
  const [cat, setCat] = useState<Cat>('lev_money');
  const [code, setCode] = useState<string>('099741');
  const markets = cot?.markets ?? [];
  const sel = markets.find((m) => m.code === code) ?? markets[0];
  const when = cot?.report_date ? `positions du mardi ${fmtDay(cot.report_date)}, publiées le vendredi à 15:30 New York` : 'positions —';
  return (
    <>
      <SubHeader icon="cot" title="COT · positions sur les futures (CFTC)"
        chips={<><Chip variant="hot" round>{cot?.report_date ? `Positions au ${fmtDay(cot.report_date)}` : 'Positions —'}</Chip>
          <FreshChip source="CFTC" feed={reply?.feed} now={now} /></>} />
      <div className="content sn" data-screen="cot">
        <div className="sn-tools"><Segmented label="Catégorie" value={cat} onChange={setCat} options={COT_CATEGORIES.map((c) => ({ value: c, label: SHORT[c] }))} /></div>
        <Panel title={`Positions nettes · ${COT_CATEGORY_LABEL[cat]}`} label="Positions nettes" controls="none">
          {markets.length ? <div className="sn-scroll"><table className="sn-table">
            <thead><tr className="lbl lbl--s"><th>Marché</th><th className="r">Net</th><th className="r">1 S</th><th className="r hide-xs">% IO</th><th>Percentile 3 ans</th></tr></thead>
            <tbody>
              {markets.map((m) => {
                const c = m.categories[cat];
                return (
                  <tr key={m.code} className="sn-click" aria-selected={m.code === sel?.code} onClick={() => setCode(m.code)} data-testid={`cot-${m.code}`}>
                    <td><b>{m.label}</b><span className="sn-sub">{`IO ${fmtNumber(m.open_interest, 0)}`}</span></td>
                    <td className={`r num ${c ? direction(c.net) : ''}`}>{c ? fmtContracts(c.net) : <Missing reason="catégorie absente du rapport" />}</td>
                    <td className="r num">{c?.net_change_1w != null ? fmtSigned(c.net_change_1w, 0) : '—'}</td>
                    <td className="r num hide-xs">{c ? `${fmtSigned(c.net_pct_oi, 1)}${NBSP}%` : '—'}</td>
                    <td>{c?.percentile_3y != null
                      ? <div className="sn-pct"><div><PercentileBar pct={c.percentile_3y} /></div><span className="num">{Math.round(c.percentile_3y)}</span></div>
                      : <Missing reason={c ? `${c.weeks} semaines seulement (52 au moins)` : 'absent'} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div> : <Empty reason={reason} />}
          <Fresh>{`${SOURCE} · ${when} · percentile de la position nette sur 156 semaines`}</Fresh>
        </Panel>

        <div className="sn-row">
          <Panel title={`Historique · ${sel?.label ?? '—'}`} label="Historique" controls="none" style={{ flex: '2 1 560px' }}>
            {sel ? <Lines dates={sel.history.dates}
              series={[{ values: sel.history.net.lev_money ?? [], tone: 'gold' }, { values: sel.history.net.asset_mgr ?? [], tone: 'up' }, { values: sel.history.net.dealer ?? [], tone: 'down' }]}
              legend={[{ label: 'Fonds spéculatifs', tone: 'gold' }, { label: 'Gérants d’actifs', tone: 'up' }, { label: 'Dealers', tone: 'down' }]} />
              : <Empty reason={reason} />}
            <Fresh>{`${SOURCE} · positions nettes hebdomadaires, en contrats · dernier rapport ${fmtDay(sel?.date)}`}</Fresh>
          </Panel>
          <Panel title={`Toutes catégories · ${sel?.label ?? '—'}`} label="Toutes catégories" controls="none" style={{ flex: '1 1 380px' }}>
            {sel ? <div className="sn-scroll"><table className="sn-table">
              <thead><tr className="lbl lbl--s"><th>Catégorie</th><th className="r">Long</th><th className="r">Short</th><th className="r">Net</th></tr></thead>
              <tbody>{COT_CATEGORIES.map((c) => {
                const v = sel.categories[c];
                return <tr key={c}><td>{COT_CATEGORY_LABEL[c]}</td><td className="r num">{v ? fmtNumber(v.long, 0) : '—'}</td>
                  <td className="r num">{v ? fmtNumber(v.short, 0) : '—'}</td><td className={`r num ${v ? direction(v.net) : ''}`}>{v ? fmtContracts(v.net) : '—'}</td></tr>;
              })}</tbody>
            </table></div> : <Empty reason={reason} />}
            <Fresh>{`${SOURCE} · ${fmtDay(sel?.date, true)}`}</Fresh>
          </Panel>
        </div>
      </div>
    </>
  );
}
