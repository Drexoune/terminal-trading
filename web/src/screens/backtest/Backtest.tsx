// Backtest (section Backtest, T-061, T-062 ; commande BT). Pas de maquette : design system (T-033).
// Quatre façons d'obtenir une stratégie (stratégies connues, éditeur Pine, assistant IA, recherche
// autonome ; les deux dernières arrivent aux étapes S3 et S4), un moteur commun (PineTS dans un Web
// Worker) et une vue de résultats commune : tuiles notées E → S en grille « bento », courbe de
// capital et drawdown, journal des transactions. Les bougies viennent de /api/backtest/candles.

import './backtest.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing, Segmented } from '../../components/ui';
import { useSettings } from '../../config/settings';
import { loadCandles, type LoadedCandles } from '../../data/online/backtest';
import { direction, fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { DEFAULT_SETTINGS, scriptInputs, type RunResult, type ScriptInput, type Settings } from '../../backtest/engine';
import { barsPerYear, computeMetrics, type Candle, type Metrics, type OpenTrade, type Trade, type Trials } from '../../backtest/metrics';
import { PineEditor, type PineEditorHandle } from '../../backtest/PineEditor';
import { runBacktest } from '../../backtest/runner';
import { KNOWN, knownById } from '../../backtest/strategies';
import { recordTrial, resetTrials, variantHash } from '../../backtest/trials';
import { exitReason, tiles } from '../../backtest/view';
import { FirmsPanel, MonteCarloPanel, SamplePanel, type DiagInput } from './Diagnostics';
import { AssistantPanel } from './Assistant';
import { BourseGate } from '../bourse/BourseGate';
import { monteCarlo, splitSample } from '../../backtest/diagnostics';
import { fmtDay, monthLabel, dateTicks } from '../../sentiment/sentiment';
import { Empty, FreshChip } from '../../sentiment/ui';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

type Tab = 'known' | 'editor' | 'ai' | 'loop';
type Period = 'all' | '5y' | '3y' | '1y';
const ASSETS = [
  { id: 'BTC', label: 'BTC', tfs: ['1D', '4H', '1H'], cur: 'USDT' },
  { id: 'ETH', label: 'ETH', tfs: ['1D', '4H', '1H'], cur: 'USDT' },
  { id: 'QQQ', label: 'Nasdaq 100 (QQQ)', tfs: ['1D'], cur: 'USD' },
  { id: 'SPY', label: 'S&P 500 (SPY)', tfs: ['1D'], cur: 'USD' },
] as const;
const PERIOD_YEARS: Record<Period, number | null> = { all: null, '5y': 5, '3y': 3, '1y': 1 };
const TF_LABEL: Record<string, string> = { '1D': '1 j', '4H': '4 h', '1H': '1 h' };

interface Outcome { metrics: Metrics & { equity: number[] }; trades: Trade[]; open: OpenTrade[]; candles: Candle[]; ms: number; title: string | null; stored: boolean; openCount: number;
  trials: Trials; bpy: number; capital: number }

function slicePeriod(c: Candle[], p: Period): Candle[] {
  const y = PERIOD_YEARS[p];
  if (!y || !c.length) return c;
  const from = c[c.length - 1].t - y * 365.25 * 86_400_000;
  return c.filter((b) => b.t >= from);
}

const fmtTs = (ms: number, tf: string) => {
  const d = new Date(ms).toISOString();
  return tf === '1D' ? fmtDay(d.slice(0, 10), true) : `${fmtDay(d.slice(0, 10))} ${d.slice(11, 16)}`;
};

// --- Paramètres d'un script ------------------------------------------------------------------------

function Params({ inputs, values, onChange }: { inputs: ScriptInput[]; values: Record<string, unknown>; onChange: (id: string, v: unknown) => void }) {
  if (!inputs.length) return <p className="bt-note">Ce script n’a aucun paramètre input.*().</p>;
  return (
    <div className="bt-params">
      {inputs.map((p) => {
        const v = values[p.id] ?? p.value;
        return (
          <label key={p.id} className="bt-field">
            <span className="lbl lbl--s">{p.title}</span>
            {p.options ? (
              <select value={String(v)} onChange={(e) => onChange(p.id, e.target.value)}>
                {p.options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
              </select>
            ) : typeof p.value === 'boolean' ? (
              <input type="checkbox" checked={Boolean(v)} onChange={(e) => onChange(p.id, e.target.checked)} />
            ) : (
              <input type="number" className="num" value={String(v)} step={p.step ?? (p.type.includes('int') ? 1 : 0.1)} min={p.min} max={p.max}
                onChange={(e) => onChange(p.id, e.target.value === '' ? p.value : Number(e.target.value))} />
            )}
          </label>
        );
      })}
    </div>
  );
}

// --- Résultats ---------------------------------------------------------------------------------------

function Bento({ m, cur }: { m: Metrics; cur: string }) {
  return (
    <div className="bt-bento" role="list" aria-label="Mesures notées">
      {tiles(m, cur).map((t, i) => (
        <div key={t.key} role="listitem" className={`bt-tile bt-tile--${t.grade.toLowerCase()} bt-tile--${i}`} data-grade={t.grade} data-testid={`tile-${t.key}`}
          title={`${t.label} · note ${t.grade} (importance de la mesure) · ${t.formula}`}>
          <div className="bt-tile-head"><span className="lbl lbl--s">{t.label}</span><span className={`bt-grade bt-grade--${t.grade.toLowerCase()}`} aria-label={`Note ${t.grade}`}>{t.grade}</span></div>
          <div className={`bt-tile-v num ${t.tone}`}>{t.missing && t.value === '—' ? <Missing reason={t.missing} /> : t.value}</div>
          <div className="bt-tile-sub">{t.sub}</div>
          {t.key === 'dsr' && m.dsr !== null && <div className="bt-dsr-bar" aria-hidden="true"><div style={{ width: `${m.dsr * 100}%` }} /><span style={{ left: '95%' }} /></div>}
        </div>
      ))}
    </div>
  );
}

function EquityChart({ o, initial }: { o: Outcome; initial: number }) {
  const eq = o.metrics.equity;
  if (eq.length < 2) return <Empty reason="pas assez de barres" />;
  const step = Math.max(1, Math.floor(eq.length / 1200));   // au plus ~1 200 points tracés
  const idx = eq.map((_, i) => i).filter((i) => i % step === 0 || i === eq.length - 1);
  const lo = Math.min(initial, ...idx.map((i) => eq[i])), hi = Math.max(initial, ...idx.map((i) => eq[i]));
  const pad = (hi - lo) * 0.06 || 1;
  const y = (v: number) => (((hi + pad - v) / (hi - lo + 2 * pad)) * 200).toFixed(1);
  const x = (i: number) => ((i / (eq.length - 1)) * 1000).toFixed(1);
  let peak = -Infinity;
  const dd = idx.map((i) => { peak = Math.max(peak, ...eq.slice(Math.max(0, i - step + 1), i + 1)); return peak > 0 ? (eq[i] - peak) / peak : 0; });
  const ddMin = Math.min(-0.0001, ...dd);
  return (
    <div className="bt-chart">
      <div className="bt-plot" style={{ height: 200 }}>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
          <path className="bt-base" d={`M0 ${y(initial)}H1000`} />
          <path className="bt-eq" d={idx.map((i, k) => `${k ? 'L' : 'M'}${x(i)} ${y(eq[i])}`).join('')} />
        </svg>
      </div>
      <div className="bt-plot bt-plot--dd" style={{ height: 70 }}>
        <svg viewBox="0 0 1000 70" preserveAspectRatio="none" aria-hidden="true">
          <path className="bt-dd" d={`M0 0${idx.map((i, k) => `L${x(i)} ${((dd[k] / ddMin) * 70).toFixed(1)}`).join('')}L1000 0Z`} />
        </svg>
      </div>
      <div className="num bt-axis">{dateTicks(o.candles.map((c) => new Date(c.t).toISOString().slice(0, 10))).map((t, i) => <span key={i}>{t}</span>)}</div>
      <div className="lbl lbl--s bt-legend"><span className="bt-ln bt-ln--eq" />Capital (marqué à chaque clôture) <span className="bt-ln bt-ln--dd" />Drawdown depuis le plus haut</div>
    </div>
  );
}

function TradeLog({ o, tf, cur }: { o: Outcome; tf: string; cur: string }) {
  const [all, setAll] = useState(false);
  const rows = [...o.trades].reverse();
  const shown = all ? rows : rows.slice(0, 50);
  if (!rows.length) return <Empty reason="aucune transaction close sur la période" />;
  return (
    <>
      <div className="bt-scroll"><table className="bt-table">
        <thead><tr className="lbl lbl--s"><th>#</th><th>Sens</th><th>Entrée</th><th className="r">Prix</th><th>Sortie</th><th className="r">Prix</th>
          <th className="r hide-xs">Taille</th><th className="r">PnL</th><th className="r hide-xs">Rendement</th></tr></thead>
        <tbody>{shown.map((t, k) => {
          const ret = (t.pnl / (Math.abs(t.size) * t.entry_price)) * 100;
          return (
            <tr key={k}>
              <td className="num">{rows.length - k}</td>
              <td><span className={`bt-side bt-side--${t.side}`}>{t.side === 'long' ? 'Long' : 'Short'}</span></td>
              <td className="num">{fmtTs(t.entry_time, tf)}</td><td className="r num">{fmtNumber(t.entry_price, 2)}</td>
              <td className="num">{fmtTs(t.exit_time, tf)}<span className="bt-sub">{exitReason(t.exit_id, t.side)}</span></td><td className="r num">{fmtNumber(t.exit_price, 2)}</td>
              <td className="r num hide-xs">{fmtNumber(Math.abs(t.size), 6)}</td>
              <td className={`r num ${direction(t.pnl)}`}>{`${fmtSigned(t.pnl, 2)}${NBSP}${cur}`}</td>
              <td className={`r num hide-xs ${direction(ret)}`}>{`${fmtSigned(ret, 2)}${NBSP}%`}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {rows.length > 50 && <div className="bt-more"><Button variant="ghost" onClick={() => setAll((a) => !a)}>{all ? 'Afficher les 50 derniers' : `Afficher les ${rows.length} trades`}</Button></div>}
    </>
  );
}

// --- Écran ---------------------------------------------------------------------------------------

export function BacktestScreen() {
  const now = useNow();
  const { mode } = useSettings();
  const [tab, setTab] = useState<Tab>('known');
  const [asset, setAsset] = useState<(typeof ASSETS)[number]['id']>('BTC');
  const [tf, setTf] = useState('1D');
  const [period, setPeriod] = useState<Period>('all');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [knownId, setKnownId] = useState('sma_cross');
  const [source, setSource] = useState(knownById('sma_cross')!.source);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [data, setData] = useState<LoadedCandles | null>(null);
  const [dataErr, setDataErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [runErr, setRunErr] = useState<Extract<RunResult, { ok: false }> | null>(null);
  const editor = useRef<PineEditorHandle>(null);
  const a = ASSETS.find((x) => x.id === asset)!;

  useEffect(() => { if (!(a.tfs as readonly string[]).includes(tf)) setTf('1D'); }, [a, tf]);
  useEffect(() => {
    let alive = true;
    setData(null); setDataErr(null);
    loadCandles(asset, tf).then((d) => alive && setData(d), (e: Error) => alive && setDataErr(`bougies injoignables : ${e.message}`));
    return () => { alive = false; };
  }, [asset, tf]);

  const inputs = useMemo(() => scriptInputs(source), [source]);
  const candles = useMemo(() => slicePeriod(data?.candles ?? [], period), [data, period]);
  const dataReason = dataErr ?? (data && !data.reply.configured ? `non configuré : ${data.reply.reason ?? ''}`
    : data && !candles.length ? 'aucune bougie relevée pour cet actif (tâche bt-jobs)' : !data ? (mode === 'online' ? 'chargement des bougies…' : 'chargement des bougies (fonctions de Vercel)…') : null);

  const chooseKnown = (id: string) => { setKnownId(id); setSource(knownById(id)!.source); setValues({}); setOutcome(null); setRunErr(null); };

  async function run(src = source, vals = values) {
    if (!candles.length) return;
    setRunning(true); setRunErr(null);
    const r = await runBacktest(src, candles, tf, settings, vals);
    setRunning(false);
    if (!r.ok) { if (r.error !== 'remplacé par un nouveau backtest') { setRunErr(r); setOutcome(null); } return; }
    const bpy = barsPerYear(asset, tf);
    const first = computeMetrics(candles, r.trades, r.open, settings.capital, bpy);
    const trials = recordTrial(asset, tf, period, variantHash([src, vals, settings]), first.sharpe_bar);
    const metrics = computeMetrics(candles, r.trades, r.open, settings.capital, bpy, trials);
    setOutcome({ metrics, trades: r.trades, open: r.open, candles, ms: r.ms, title: r.title, stored: trials.stored, openCount: r.open.length,
      trials, bpy, capital: settings.capital });
  }

  const diag: DiagInput | null = useMemo(() => (outcome ? { candles: outcome.candles, trades: outcome.trades, open: outcome.open, equity: outcome.metrics.equity,
    capital: outcome.capital, bpy: outcome.bpy, trials: outcome.trials, tf, cur: a.cur } : null), [outcome, tf, a.cur]);
  // Assistant IA : compilation dans notre moteur, et chiffres transmis pour la lecture.
  const compile = async (code: string): Promise<Extract<RunResult, { ok: false }> | null> => {
    if (!candles.length) return { ok: false, error: 'aucune bougie chargée pour compiler', line: null, column: null };
    const r = await runBacktest(code, candles, tf, settings, {});
    return r.ok ? null : r;
  };
  const aiExtra = useMemo(() => {
    if (!diag) return {};
    const sp = splitSample(diag.trades, diag.equity, Math.round(diag.candles.length * 0.7), diag.capital, diag.bpy, diag.trials);
    const mc = monteCarlo(diag.trades, diag.capital, { iterations: 1000, seed: 42, ruinDdPct: 50 });
    return { is_sharpe: sp?.is.sharpe ?? null, oos_sharpe: sp?.oos.sharpe ?? null, mc_ruin_pct: mc?.bootstrap.p_ruin ?? null };
  }, [diag]);
  const setNum = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setSettings((s) => ({ ...s, [k]: Number(e.target.value) }));
  const range = candles.length ? `${fmtTs(candles[0].t, tf)} → ${fmtTs(candles[candles.length - 1].t, tf)}` : '—';

  return (
    <>
      <SubHeader icon="backtest" title={`Backtest · ${a.label} · ${TF_LABEL[tf]}`}
        chips={<>
          <Chip variant="hot" round>PineTS · Pine Script v6</Chip>
          <FreshChip source={data?.reply.source ?? 'OKX, Tiingo'} feed={data?.reply.feed ?? null} now={now} />
        </>} />
      <div className="content bt" data-screen="backtest">
        <div className="bt-tools">
          <Segmented label="Mode" value={tab} onChange={setTab} options={[
            { value: 'known', label: 'Stratégies connues' }, { value: 'editor', label: 'Éditeur' },
            { value: 'ai', label: 'Assistant IA' }, { value: 'loop', label: 'Recherche autonome' }]} />
        </div>

        <div className="bt-grid">
          <div className="bt-side">
            <Panel title="Données et simulation" label="Données et simulation" controls="none">
              <div className="bt-form">
                <label className="bt-field"><span className="lbl lbl--s">Actif</span>
                  <select value={asset} onChange={(e) => setAsset(e.target.value as typeof asset)}>{ASSETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                <label className="bt-field"><span className="lbl lbl--s">Unité de temps</span>
                  <select value={tf} onChange={(e) => setTf(e.target.value)}>{a.tfs.map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}</select></label>
                <label className="bt-field"><span className="lbl lbl--s">Période</span>
                  <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                    <option value="all">Tout l’historique</option><option value="5y">5 ans</option><option value="3y">3 ans</option><option value="1y">1 an</option></select></label>
                <label className="bt-field"><span className="lbl lbl--s">{`Capital (${a.cur})`}</span><input type="number" className="num" min={100} step={1000} value={settings.capital} onChange={setNum('capital')} /></label>
                <label className="bt-field"><span className="lbl lbl--s">Commission (%)</span><input type="number" className="num" min={0} step={0.01} value={settings.commissionPct} onChange={setNum('commissionPct')} /></label>
                <label className="bt-field"><span className="lbl lbl--s">Glissement (ticks)</span><input type="number" className="num" min={0} step={1} value={settings.slippageTicks} onChange={setNum('slippageTicks')} /></label>
                <label className="bt-field"><span className="lbl lbl--s">Taille (% du capital)</span><input type="number" className="num" min={1} max={100} step={5} value={settings.qtyPct} onChange={setNum('qtyPct')} /></label>
                <label className="bt-field bt-check"><input type="checkbox" checked={settings.margin} onChange={(e) => setSettings((s) => ({ ...s, margin: e.target.checked }))} />
                  <span>Appels de marge (TradingView)</span></label>
              </div>
              <div className="lbl lbl--s bt-src" data-fresh>{data?.reply.configured
                ? `${data.reply.source ?? ''}${data.reply.aggregated ? ` · ${data.reply.aggregated}` : ''} · ${candles.length} bougies · ${range}`
                : 'Source : —'}</div>
            </Panel>

            {tab === 'known' && (
              <Panel title="Stratégies connues" label="Stratégies connues" controls="none">
                <ul className="bt-known">{KNOWN.map((k) => (
                  <li key={k.id}><button type="button" aria-pressed={k.id === knownId} onClick={() => chooseKnown(k.id)}>
                    <b>{k.name}</b><span className="lbl lbl--s">{k.family}</span><span className="bt-sub">{k.description}</span></button></li>
                ))}</ul>
              </Panel>
            )}
            {(tab === 'known' || tab === 'editor') && (
              <Panel title="Paramètres" label="Paramètres" controls="none">
                {Array.isArray(inputs) ? <Params inputs={inputs} values={values} onChange={(id, v) => setValues((o) => ({ ...o, [id]: v }))} />
                  : <Empty reason={`script illisible : ${inputs.error}`} />}
              </Panel>
            )}
          </div>

          <div className="bt-main">
            {tab === 'editor' && (
              <Panel title="Éditeur Pine Script" label="Éditeur" controls="none"
                chips={<Button variant="ghost" onClick={() => setSource(knownById(knownId)!.source)}>Revenir au modèle</Button>}>
                <PineEditor ref={editor} value={source} onChange={(v) => { setSource(v); setValues({}); }} />
                <p className="bt-note">Pine Script v5 ou v6 avec une déclaration strategy(). Les réglages de gauche (capital, commission, glissement, taille, marge) remplacent ceux du script.</p>
              </Panel>
            )}
            {tab === 'ai' && (
              <BourseGate>{() => (
                <AssistantPanel asset={asset} tf={tf} cur={a.cur} editorCode={source} compile={compile}
                  onAccepted={(code) => { setSource(code); setValues({}); void run(code, {}); }}
                  metrics={outcome?.metrics ?? null} extra={aiExtra} />
              )}</BourseGate>
            )}
            {tab === 'loop' && (
              <Panel title="Recherche autonome" label="Recherche autonome" controls="none">
                <Empty reason="étape S4 : boucle de recherche en arrière-plan, validation hors échantillon à l’aveugle" />
              </Panel>
            )}

            <div className="bt-run">
              <Button variant="primary" onClick={() => void run()} disabled={running || !candles.length || tab === 'loop'}>
                {running ? 'Calcul…' : 'Lancer le backtest'}</Button>
              {dataReason && <span className="bt-why"><Missing reason={dataReason} />{dataReason}</span>}
              {outcome && <span className="lbl lbl--s bt-meta">{`${outcome.title ?? 'stratégie'} · ${outcome.metrics.trades} trades clos${outcome.openCount ? `, ${outcome.openCount} ouverte` : ''} · ${outcome.ms} ms`}</span>}
            </div>
            {runErr && (
              <div className="bt-error" role="alert">
                <b>Le script ne s’exécute pas.</b> {runErr.error}
                {runErr.line && <Button variant="ghost" onClick={() => { setTab('editor'); setTimeout(() => editor.current?.goto(runErr.line!, runErr.column), 0); }}>
                  {`Aller à la ligne ${runErr.line}`}</Button>}
              </div>
            )}

            <Panel title="Mesures notées" label="Mesures notées" controls="none"
              chips={outcome ? <Chip title="La note qualifie l’importance de la mesure (T-061), pas le résultat">{`E → S · N = ${outcome.metrics.trials}`}</Chip> : undefined}>
              {outcome ? <Bento m={outcome.metrics} cur={a.cur} /> : <Empty reason={dataReason ?? 'lancer un backtest pour voir les mesures'} />}
              <div className="lbl lbl--s bt-src" data-fresh>
                {outcome ? `Moteur PineTS (émulateur de type TradingView) · ${outcome.candles.length} bougies ${a.label} ${TF_LABEL[tf]} · ${range}${outcome.stored ? '' : ' · essais non mémorisés (stockage du navigateur indisponible)'}`
                  : 'Source : —'}
                {outcome && <button type="button" className="bt-link" onClick={() => { resetTrials(asset, tf, period); }}>remettre N à zéro</button>}
              </div>
            </Panel>

            <Panel title="Capital et drawdown" label="Capital et drawdown" controls="none"
              chips={outcome ? <span className="num bt-final">{`${fmtNumber(outcome.metrics.final_equity, 0)}${NBSP}${a.cur}`}</span> : undefined}>
              {outcome ? <EquityChart o={outcome} initial={settings.capital} /> : <Empty reason="aucun backtest lancé" />}
              <div className="lbl lbl--s bt-src" data-fresh>{outcome ? `${monthLabel(new Date(outcome.candles[0].t).toISOString().slice(0, 10))} → ${monthLabel(new Date(outcome.candles[outcome.candles.length - 1].t).toISOString().slice(0, 10))} · capital initial ${fmtNumber(settings.capital, 0)}${NBSP}${a.cur}` : 'Source : —'}</div>
            </Panel>

            {diag && <MonteCarloPanel x={diag} />}
            {diag && <FirmsPanel x={diag} />}
            {diag && <SamplePanel x={diag} />}

            <Panel title="Journal des transactions" label="Journal des transactions" controls="none"
              chips={outcome ? <Chip>{`${outcome.trades.length} trades`}</Chip> : undefined}>
              {outcome ? <TradeLog o={outcome} tf={tf} cur={a.cur} /> : <Empty reason="aucun backtest lancé" />}
              <div className="lbl lbl--s bt-src" data-fresh>Exécution à l’ouverture de la barre suivante · PnL net des commissions · heures UTC</div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
