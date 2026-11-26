// Comparer deux actifs sur un an (commande COMP) : performance en base 100, rendement, volatilité,
// baisse maximale, meilleur et pire jour, corrélation (et glissante sur 30 dates), bêta, ratio A/B.
// Clôtures quotidiennes du terminal (OKX, Tiingo, Cboe) ; dates communes seulement.

import '../analysis/analysis.css';
import { useSearchParams } from 'react-router-dom';
import { compare } from '../../analysis/compare';
import { DAILY_IDS, DAILY_LABEL, dailyReason, useDaily, type DailyId } from '../../analysis/daily';
import { Panel } from '../../components/Panel';
import { Button, Chip } from '../../components/ui';
import { Tip } from '../../help/Tip';
import { fmtNumber, fmtPctChange, fmtSigned, NBSP } from '../../lib/format';
import { SubHeader } from '../../shell/SubHeader';
import { Empty, LineChart } from '../analysis/parts';

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const dayFmt = (t: number) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' }).format(t);
const valid = (x: string | null, d: DailyId): DailyId => ((DAILY_IDS as readonly string[]).includes((x ?? '').toUpperCase()) ? (x!.toUpperCase() as DailyId) : d);

export function CompareScreen() {
  const [params, setParams] = useSearchParams();
  const A = valid(params.get('a'), 'BTC'), B0 = valid(params.get('b'), 'QQQ');
  const B = B0 === A ? (A === 'QQQ' ? 'BTC' : 'QQQ') : B0;
  const set = (a: DailyId, b: DailyId) => setParams({ a, b }, { replace: true });
  const ra = useDaily(A), rb = useDaily(B);
  const why = dailyReason(ra.reply, ra.error) ?? dailyReason(rb.reply, rb.error);
  const c = !why && ra.reply && rb.reply ? compare(ra.reply.points, rb.reply.points) : null;
  const pick = (label: string, v: DailyId, on: (x: DailyId) => void, other: DailyId, testId: string) => (
    <label className="an-select"><span className="lbl lbl--s">{label}</span>
      <select className="input" value={v} data-testid={testId} onChange={(e) => on(e.target.value as DailyId)}>
        {DAILY_IDS.filter((x) => x !== other).map((x) => <option key={x} value={x}>{DAILY_LABEL[x]}</option>)}</select></label>);
  const src = ra.reply && rb.reply ? `${ra.reply.source ?? '—'} · ${rb.reply.source ?? '—'}` : '—';
  const row = (name: string, s: NonNullable<typeof c>['a'], cls: string) => (
    <tr>
      <th scope="row"><i className={`an-key ${cls}`} />{name}</th>
      <td className={`num ${s.ret >= 0 ? 'up' : 'dn'}`}>{fmtPctChange(s.ret, 1)}</td>
      <td className="num">{s.vol === null ? '—' : `${fmtNumber(s.vol * 100, 1)}${NBSP}%`}</td>
      <td className="num dn">{fmtPctChange(s.maxDD, 1)}</td>
      <td className="num up">{s.best ? `${fmtPctChange(s.best.r, 1)} (${dayFmt(ms(s.best.d))})` : '—'}</td>
      <td className="num dn">{s.worst ? `${fmtPctChange(s.worst.r, 1)} (${dayFmt(ms(s.worst.d))})` : '—'}</td>
      <td className="num">{fmtNumber(s.last, s.last > 1000 ? 0 : 2)}</td>
    </tr>);
  return (
    <>
      <SubHeader icon="compare" title="Comparer deux actifs · 1 an"
        chips={<>{pick('Actif A', A, (x) => set(x, B), B, 'cmp-a')}<Button onClick={() => set(B, A)} aria-label="Inverser A et B">⇄</Button>{pick('Actif B', B, (x) => set(A, x), A, 'cmp-b')}</>} />
      <div className="content an" data-screen="compare">
        {!c ? <Panel title="Comparaison" controls="none"><Empty reason={why ?? 'moins de 20 dates communes sur un an'} /></Panel> : <>
          <Panel title="Performance · base 100" controls="none" chips={<Chip small title={`Sources : ${src}`}>{`${dayFmt(ms(c.from))} → ${dayFmt(ms(c.to))} · ${c.days} dates communes`}</Chip>}>
            <LineChart label={`Performance de ${DAILY_LABEL[A]} et ${DAILY_LABEL[B]} sur un an, base 100`} height={260} xFmt={dayFmt} yFmt={(y) => fmtNumber(y, 0)}
              series={[{ points: c.dates.map((d, i) => [ms(d), c.normA[i]]), cls: 'c-gold', label: DAILY_LABEL[A] }, { points: c.dates.map((d, i) => [ms(d), c.normB[i]]), cls: 'c-up', label: DAILY_LABEL[B] }]} />
          </Panel>
          <Panel title="Mesures sur la période" controls="none" chips={<Chip small>{`Écart de performance ${fmtSigned(c.diff, 1)}${NBSP}pts`}</Chip>}>
            <div className="an-scroll">
              <table className="an-table" data-testid="cmp-stats">
                <thead><tr>
                  <th className="lbl">Actif</th>
                  <th className="lbl">Rendement</th>
                  <th className="lbl"><span className="lbl-tip">Volatilité annualisée<Tip term="volatility" label="Volatilité annualisée" /></span></th>
                  <th className="lbl"><span className="lbl-tip">Baisse maximale<Tip term="maxDrawdown" label="Baisse maximale" /></span></th>
                  <th className="lbl">Meilleur jour</th><th className="lbl">Pire jour</th><th className="lbl">Dernier cours</th>
                </tr></thead>
                <tbody>{row(DAILY_LABEL[A], c.a, 'c-gold')}{row(DAILY_LABEL[B], c.b, 'c-up')}</tbody>
              </table>
            </div>
          </Panel>
          <div className="an-grid">
            <Panel title="Corrélation des rendements quotidiens" controls="none"
              chips={<Chip small>{`${fmtNumber(c.corr, 2)} sur 1 an · bêta ${fmtNumber(c.beta, 2)}`}</Chip>}>
              <div className="an-kpis an-kpis--2" data-testid="cmp-corr">
                <div className="an-kpi"><span className="lbl lbl--s lbl-tip">Corrélation<Tip term="correlation" label="Corrélation" /></span><span className="num an-kpi__v">{fmtNumber(c.corr, 2)}</span></div>
                <div className="an-kpi"><span className="lbl lbl--s lbl-tip">{`Bêta de A par rapport à B`}<Tip term="beta" label="Bêta" /></span><span className="num an-kpi__v">{fmtNumber(c.beta, 2)}</span></div>
              </div>
              <LineChart label="Corrélation glissante sur 30 dates" height={160} zero xFmt={dayFmt} yFmt={(y) => fmtNumber(y, 1)}
                series={[{ points: c.rolling.map((r) => [ms(r.d), r.corr]), cls: 'c-gold', label: 'Corrélation sur 30 dates' }]} />
            </Panel>
            <Panel title="Ratio A / B · base 100" controls="none">
              <LineChart label={`Ratio ${DAILY_LABEL[A]} / ${DAILY_LABEL[B]}, base 100`} height={200} xFmt={dayFmt} yFmt={(y) => fmtNumber(y, 0)}
                series={[{ points: c.dates.map((d, i) => [ms(d), c.ratio[i]]), cls: 'c-gold', label: `${A} / ${B}` }]} />
              <p className="an-note lbl lbl--s">Au-dessus de 100 : A a fait mieux que B depuis le début de la période. Ratio en hausse : A surperforme.</p>
            </Panel>
          </div>
          <p className="an-foot lbl lbl--s">{`Sources : ${DAILY_LABEL[A]} ${ra.reply?.source ?? '—'}, ${DAILY_LABEL[B]} ${rb.reply?.source ?? '—'} · clôtures quotidiennes, dates communes seulement (les cryptos cotent le week-end, les fonds non) · dernière clôture commune le ${dayFmt(ms(c.to))}.`}</p>
        </>}
      </div>
    </>
  );
}
