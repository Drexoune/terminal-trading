// Sentiment de risque (plan P4, S4 ; commande RISK ; maquette design/maquettes/png/Risque.png).
// Indice composite 0–100 (moyenne des percentiles sur 252 séances de 7 composantes), composantes
// avec leur source et leur dernière date, historique de l'indice, SPY et VIX sur un an (T-060).
// Tout vient de l'état publié par p4-jobs ; « — » avec la raison pour ce qui manque.

import './risk.css';
import { useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Gauge, Missing, Pill, Segmented } from '../../components/ui';
import { useValue } from '../../data/store';
import { fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import {
  biasOf, dateTicks, fmtDay, fmtRaw, indexMove, PERIODS, pctTone, sentimentKey, ZONES,
  type Component, type Period, type Reply, type Risk,
} from '../../sentiment/sentiment';
import { FreshChip, useSentimentReason } from '../../sentiment/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

function Empty({ reason }: { reason: string }) {
  return <div className="rk-empty"><Missing reason={reason} /><span>{reason}</span></div>;
}

const lastDate = (c: Component) => Object.values(c.last_dates).filter((d): d is string => !!d).sort()[0] ?? null;

// --- Composite -------------------------------------------------------------------------------------

function Composite({ r, reason }: { r: Risk | null; reason: string }) {
  const v = r?.index ?? null;
  const w = indexMove(v, r?.week_ago?.value), m = indexMove(v, r?.month_ago?.value);
  return (
    <Panel title="Indice composite" label="Indice de sentiment" controls="none" style={{ flex: '1 1 360px' }}
      chips={<Chip>{r ? `${r.components_used} composante${r.components_used > 1 ? 's' : ''}` : '— composantes'}</Chip>}>
      <div className="rk-comp">
        <Gauge value={v} previous={r?.week_ago?.value ?? null} width={300} />
        <div className="rk-kpi">
          {v !== null ? <><span className="rk-big">{Math.round(v)}</span><Pill bias={biasOf(v)} /></>
            : <><span className="rk-big"><Missing reason={r ? `moins de ${r.min_components} composantes disponibles` : reason} /></span></>}
        </div>
        <div className="num rk-moves">
          <span>1 S {w ? <span className={w.dir}>{w.text}</span> : '—'} · était {r?.week_ago?.value != null ? Math.round(r.week_ago.value) : '—'}</span>
          <span>1 M {m ? <span className={m.dir}>{m.text}</span> : '—'} · était {r?.month_ago?.value != null ? Math.round(r.month_ago.value) : '—'}</span>
        </div>
        <div className="rk-zones">
          {ZONES.map((z, i) => (
            <div key={z.id}><div className={`rk-zone rk-zone--${i + 1}`} /><div className="lbl rk-zone-l">{z.label}</div>
              <div className="num rk-zone-r">{`${z.from}–${z.to}`}</div></div>
          ))}
        </div>
        <div className="lbl lbl--s rk-foot" data-fresh>{r ? `Clôture américaine du ${fmtDay(r.date, true)} · percentiles sur ${r.window} séances` : 'Clôture —'}</div>
      </div>
    </Panel>
  );
}

// --- Composantes -----------------------------------------------------------------------------------

function Components({ r, reason }: { r: Risk | null; reason: string }) {
  const v = r?.index ?? null;
  return (
    <Panel title="Composantes · percentile sur 1 an" label="Composantes" controls="none" style={{ flex: '2 1 560px' }}
      chips={<Chip>{`Poids égaux · 1/${r?.components_used || 7}`}</Chip>}>
      <div className="rk-cp-scroll"><div className="rk-cp-inner">
        <div className="rk-cp lbl rk-cp-head"><span>Composante</span><span className="r">Valeur</span><span>Percentile</span><span className="r">P</span></div>
        {r ? r.components.map((c) => {
          const d = lastDate(c);
          return (
            <div key={c.id} className="rk-cp rk-cp-row" data-testid={`rk-${c.id}`}>
              <div className="rk-cp-name"><div className="rk-cp-l">{c.label}</div>
                <div className="rk-cp-d" data-fresh>{`${c.description} · ${c.source} · ${d ? fmtDay(d) : '—'}`}</div></div>
              <span className="num r rk-cp-v">{c.raw === null ? <Missing reason={c.reason ?? 'absent'} /> : fmtRaw(c)}</span>
              {c.percentile !== null
                ? <div className="rk-bar"><div className={`rk-bar-fill rk-bar-fill--${zoneIdx(c.percentile)}`} style={{ width: `${c.percentile}%` }} /><div className="rk-bar-mid" /></div>
                : <span className="rk-cp-why" title={c.reason ?? undefined}>{c.reason ?? '—'}</span>}
              <span className={`num r rk-cp-p ${c.percentile !== null ? pctTone(c.percentile) : ''}`}>
                {c.percentile !== null ? Math.round(c.percentile) : <Missing reason={c.reason ?? 'absent'} />}</span>
            </div>
          );
        }) : <Empty reason={reason} />}
        <div className="rk-cp rk-cp-avg">
          <span className="rk-avg-l">MOYENNE</span><span />
          <div className="rk-bar rk-bar--avg">{v !== null && <div className={`rk-bar-fill rk-bar-fill--${zoneIdx(v)}`} style={{ width: `${v}%` }} />}</div>
          <span className="num r rk-avg-v">{v !== null ? Math.round(v) : '—'}</span>
        </div>
      </div></div>
    </Panel>
  );
}

const zoneIdx = (p: number) => ZONES.findIndex((z) => p < z.to) + 1 || 5;

// --- Graphiques ------------------------------------------------------------------------------------

function line(values: number[], lo: number, hi: number, h: number): string {
  return values.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(values.length - 1, 1)) * 1000).toFixed(1)} ${(((hi - v) / (hi - lo)) * h).toFixed(1)}`).join('');
}

function History({ r, reason }: { r: Risk | null; reason: string }) {
  const [period, setPeriod] = useState<Period>('1A');
  const pts = (r?.history ?? []).slice(-PERIODS[period]);
  const last = pts[pts.length - 1];
  return (
    <Panel title="Historique de l’indice" label="Historique de l’indice" controls="none"
      chips={<>
        <span className="chip chip--s rk-hist-chip" data-fresh title="Indice recalculé à chaque clôture par p4-jobs">{r ? `Clôture ${fmtDay(r.date)}` : 'Clôture —'}</span>
        <Segmented label="Période" value={period} onChange={setPeriod}
          options={[{ value: '1M', label: '1 M' }, { value: '3M', label: '3 M' }, { value: '1A', label: '1 A' }]} />
      </>}>
      <div className="rk-chart">
        {pts.length < 2 ? <Empty reason={r ? 'historique insuffisant' : reason} /> : <>
          <div className="rk-hist">
            <div className="rk-hist-plot">
              <div className="rk-band rk-band--5" /><div className="rk-band rk-band--4" /><div className="rk-band rk-band--3" />
              <div className="rk-band rk-band--2" /><div className="rk-band rk-band--1" />
              <svg viewBox="0 0 1000 230" preserveAspectRatio="none" aria-hidden="true">
                <path className="rk-hist-line" d={line(pts.map((p) => p.value), 0, 100, 230)} />
              </svg>
              <span className="num rk-hist-last" style={{ top: `calc(${100 - last.value}% - 10px)` }}>{Math.round(last.value)}</span>
            </div>
            <div className="num rk-hist-zones">
              <span className="up" style={{ top: '12.5%' }}>Risk-on fort</span><span style={{ top: '50%' }}>Neutre</span>
              <span className="dn" style={{ top: '87.5%' }}>Risk-off fort</span>
            </div>
          </div>
          <div className="num rk-axis rk-axis--hist">{dateTicks(pts.map((p) => p.date)).map((t, i) => <span key={i}>{t}</span>)}</div>
        </>}
      </div>
    </Panel>
  );
}

function YearChart({ kind, r, reply, reason }: { kind: 'spy' | 'vix'; r: Risk | null; reply: Reply<Risk> | undefined; reason: string }) {
  const pts = r?.[kind] ?? [];
  const vals = pts.map((p) => p.value);
  const last = pts[pts.length - 1];
  const series = reply?.series?.[kind === 'spy' ? 'SPY' : 'VIX'];
  const fallback = kind === 'vix' ? reply?.series?.VIX_FRED : null;
  const label = kind === 'spy' ? 'SPY · 1 an' : 'VIX · 1 an';
  const change = kind === 'spy' && pts.length > 1 ? (last.value / pts[0].value - 1) * 100 : null;
  const lo = kind === 'vix' ? Math.min(10, ...vals) : Math.min(...vals) * 0.98, hi = kind === 'vix' ? Math.max(35, ...vals) * 1.05 : Math.max(...vals) * 1.01;
  const y = (v: number) => ((hi - v) / (hi - lo)) * 150;
  const src = kind === 'spy' ? 'Tiingo, clôture de SPY (substitut du S&P 500, T-060)' : `Cboe${fallback?.last_date ? ', FRED en repli' : ''}`;
  return (
    <Panel title={label} label={kind === 'spy' ? 'SPY' : 'VIX'} controls="none" style={{ flex: '1 1 420px' }}
      chips={<>
        <span className="num rk-val">{last ? fmtNumber(last.value, 2) : '—'}</span>
        {kind === 'spy' ? <span className={`num rk-chg ${change !== null && change >= 0 ? 'up' : 'dn'}`}>{change !== null ? `${fmtSigned(change, 1)}${NBSP}%` : ''}</span>
          : <Chip variant="hot">Seuils 20 · 30</Chip>}
      </>}>
      <div className="rk-chart">
        {pts.length < 2 ? <Empty reason={r ? 'série absente' : reason} /> : <>
          <div className="rk-year">
            <svg viewBox="0 0 1000 150" preserveAspectRatio="none" aria-hidden="true">
              {kind === 'spy' && <path className="rk-spy-area" d={`${line(vals, lo, hi, 150)}L1000 150L0 150Z`} />}
              {kind === 'vix' && <><path className="rk-thr rk-thr--30" d={`M0 ${y(30).toFixed(1)}H1000`} /><path className="rk-thr rk-thr--20" d={`M0 ${y(20).toFixed(1)}H1000`} /></>}
              <path className={kind === 'spy' ? 'rk-spy-line' : 'rk-vix-line'} d={line(vals, lo, hi, 150)} />
            </svg>
            {kind === 'vix' && <><span className="num rk-thr-l rk-thr-l--30" style={{ top: y(30) - 14 }}>30</span>
              <span className="num rk-thr-l rk-thr-l--20" style={{ top: y(20) - 14 }}>20</span></>}
          </div>
          <div className="num rk-axis">{dateTicks(pts.map((p) => p.date)).map((t, i) => <span key={i}>{t}</span>)}</div>
        </>}
        <div className="lbl lbl--s rk-src" data-fresh>{`${src} · dernière séance ${fmtDay(series?.last_date ?? last?.date)}`}</div>
      </div>
    </Panel>
  );
}

// --- Écran ---------------------------------------------------------------------------------------

export function RiskScreen() {
  const now = useNow();
  const reply = useValue<Reply<Risk>>(sentimentKey('risk'));
  const reason = useSentimentReason(reply);
  const r = reply?.data ?? null;
  return (
    <>
      <SubHeader icon="risk" title="Sentiment de risque · indice composite 0–100"
        chips={<>
          <Chip variant="hot" round>{r ? `Clôture ${fmtDay(r.date)}` : 'Clôture —'}</Chip>
          <FreshChip source="Cboe, Tiingo, OKX, FRED" feed={reply?.feed} now={now} />
        </>} />
      <div className="content rk" data-screen="risk">
        <div className="rk-row">
          <Composite r={r} reason={reason} />
          <Components r={r} reason={reason} />
        </div>
        <History r={r} reason={reason} />
        <div className="rk-row">
          <YearChart kind="spy" r={r} reply={reply} reason={reason} />
          <YearChart kind="vix" r={r} reply={reply} reason={reason} />
        </div>
      </div>
    </>
  );
}
