// Recherche autonome de la section Backtest (S4, T-064) : plan (marchés, critères ou société de
// financement, budget), suivi des essais qui tournent dans bt-jobs (navigateur fermé), rapport et
// rejeu. Hybride : Gemini réécrit la logique tous les 5 essais, la boucle fait varier les paramètres
// entre deux. Le hors échantillon reste à l'aveugle (réussi / échoué) jusqu'à la fin.

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Button, Chip, Missing, Segmented, Sparkline } from '../../components/ui';
import { fmtNumber, NBSP } from '../../lib/format';
import { AiError } from '../../backtest/ai';
import type { Settings } from '../../backtest/engine';
import { loadCandles } from '../../data/online/backtest';
import { createLoop, getLoop, KIND_LABEL, listLoops, STATUS_LABEL, stopLoop, type LoopDetail, type LoopListItem } from '../../backtest/loop-client';
import { DEFAULT_THRESHOLDS, isFinished, type Criterion, type Thresholds } from '../../backtest/research';
import { replay, sliceMarket } from '../../backtest/research-core';
import { KNOWN, knownById } from '../../backtest/strategies';
import { Empty } from '../../sentiment/ui';

const MARKETS = [['BTC', '1D'], ['BTC', '4H'], ['BTC', '1H'], ['ETH', '1D'], ['ETH', '4H'], ['ETH', '1H'], ['QQQ', '1D'], ['SPY', '1D']] as const;
const TF_LABEL: Record<string, string> = { '1D': '1 j', '4H': '4 h', '1H': '1 h' };
const FIRMS = [['ftmo2_p1', 'FTMO 2-Step · Challenge'], ['ftmo2_p2', 'FTMO 2-Step · Vérification'], ['ftmo1', 'FTMO 1-Step'], ['lucid25', 'LucidFlex 25K']] as const;
const THRESHOLD_FIELDS: { key: keyof Thresholds; label: string; step: number; pct?: boolean }[] = [
  { key: 'min_trades', label: 'Trades (minimum)', step: 5 }, { key: 'sharpe', label: 'Sharpe (minimum)', step: 0.1 },
  { key: 't_stat', label: 't-stat (minimum)', step: 0.1 }, { key: 'dsr', label: 'Sharpe déflaté (%, minimum)', step: 1, pct: true },
  { key: 'max_dd_pct', label: 'Drawdown (%, maximum)', step: 1 }, { key: 'profit_factor', label: 'Facteur de profit (minimum)', step: 0.1 },
];

export interface Candidate { code: string; inputs: Record<string, unknown>; asset: string; tf: string; title: string | null; period?: string }
export interface ResearchProps { settings: Settings; editorCode: string; onLoad: (c: Candidate) => void }

const errText = (e: unknown) => (e instanceof AiError ? e.message : `injoignable : ${(e as Error).message}`);
const fmtWhen = (iso: string | null) => (iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');
const fmtCrit = (c: Criterion) => (c.value === null ? '—' : c.key === 'dsr' || c.key === 'firm_rate' ? `${fmtNumber(c.value * 100, 1)}${NBSP}%` : c.key === 'min_trades' ? fmtNumber(c.value, 0) : fmtNumber(c.value, 2));
const fmtTarget = (c: Criterion) => `${c.dir === 'min' ? '≥' : '≤'}${NBSP}${c.key === 'dsr' || c.key === 'firm_rate' ? `${fmtNumber(c.target * 100, 0)}${NBSP}%` : fmtNumber(c.target, c.key === 'min_trades' ? 0 : 2)}`;

function Verdict({ v }: { v: boolean | null | undefined }) {
  if (v === null || v === undefined) return <span className="bt-verdict bt-verdict--nt">—</span>;
  return <span className={`bt-verdict bt-verdict--${v ? 'up' : 'dn'}`}>{v ? 'réussi' : 'échoué'}</span>;
}

// --- Plan --------------------------------------------------------------------------------------------

function PlanForm({ settings, editorCode, onCreated, busy }: { settings: Settings; editorCode: string; onCreated: (id: string) => void; busy: boolean }) {
  const [markets, setMarkets] = useState<string[]>(['BTC:1D']);
  const [period, setPeriod] = useState('all');
  const [isShare, setIsShare] = useState(70);
  const [start, setStart] = useState('sma_cross');
  const [prompt, setPrompt] = useState('');
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<'thresholds' | 'firm'>('thresholds');
  const [th, setTh] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [firm, setFirm] = useState('ftmo2_p1');
  const [rate, setRate] = useState(50);
  const [ratio, setRatio] = useState(0.5);
  const [maxAttempts, setMaxAttempts] = useState(50);
  const [maxGemini, setMaxGemini] = useState(12);
  const [every, setEvery] = useState(5);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const toggle = (k: string) => setMarkets((m) => (m.includes(k) ? m.filter((x) => x !== k) : m.length < 4 ? [...m, k] : m));
  async function send() {
    setSending(true); setErr(null);
    const known = knownById(start);
    const st = start === 'prompt' ? { kind: 'prompt', prompt } : start === 'editor' ? { kind: 'code', title: 'Code de l’éditeur', code: editorCode, inputs: {} }
      : { kind: 'code', title: known?.name ?? 'Stratégie', code: known?.source ?? '', inputs: {} };
    try {
      const r = await createLoop({
        markets: markets.map((k) => { const [asset, tf] = k.split(':'); return { asset, tf }; }), period, is_share: isShare / 100,
        mode, thresholds: th, firm: mode === 'firm' ? { id: firm, min_pass_rate: rate / 100 } : null, oos_min_ratio: ratio,
        settings, max_attempts: maxAttempts, max_gemini: maxGemini, rewrite_every: every, start: st, goal,
      });
      onCreated(r.id);
    } catch (e) { setErr(errText(e)); }
    setSending(false);
  }
  const n = (set: (v: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(Number(e.target.value));
  return (
    <Panel title="Plan de recherche" label="Plan de recherche" controls="none"
      chips={<Chip title="Hybride (T-064) : Gemini réécrit la logique tous les N essais ; la boucle fait varier les paramètres entre deux, sans IA">Hybride · Gemini gratuit</Chip>}>
      <div className="bt-ai">
        <fieldset className="bt-markets"><legend className="lbl lbl--s">Marchés (4 au plus, tous doivent passer)</legend>
          {MARKETS.map(([a, tf]) => {
            const k = `${a}:${tf}`;
            return <label key={k} className="bt-check-inline"><input type="checkbox" checked={markets.includes(k)} onChange={() => toggle(k)} />{`${a} ${TF_LABEL[tf]}`}</label>;
          })}
        </fieldset>
        <div className="bt-ai-row">
          <label className="bt-field"><span className="lbl lbl--s">Période</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">Tout l’historique</option><option value="5y">5 ans</option><option value="3y">3 ans</option><option value="1y">1 an</option></select></label>
          <label className="bt-field"><span className="lbl lbl--s">Dans l’échantillon (%)</span>
            <input type="number" className="num" min={50} max={90} step={5} value={isShare} onChange={n(setIsShare)} /></label>
        </div>
        <label className="bt-field"><span className="lbl lbl--s">Stratégie de départ</span>
          <select value={start} onChange={(e) => setStart(e.target.value)}>
            {KNOWN.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            <option value="editor">Code de l’éditeur</option>
            <option value="prompt">Description pour Gemini</option>
          </select></label>
        {start === 'prompt' && <label className="bt-field"><span className="lbl lbl--s">Description</span>
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex. : suivi de tendance sur cassure de range, filtre de volatilité." /></label>}
        <label className="bt-field"><span className="lbl lbl--s">Objectif pour Gemini (facultatif)</span>
          <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ex. : peu de trades, drawdown faible, pas de short." /></label>
        <Segmented label="Critères" value={mode} onChange={setMode} options={[{ value: 'thresholds', label: 'Seuils des mesures' }, { value: 'firm', label: 'Société de financement' }]} />
        {mode === 'thresholds' ? (
          <div className="bt-ai-row bt-ai-row--3">
            {THRESHOLD_FIELDS.map((f) => (
              <label key={f.key} className="bt-field"><span className="lbl lbl--s">{f.label}</span>
                <input type="number" className="num" step={f.step} value={f.pct ? Math.round(th[f.key] * 100) : th[f.key]}
                  onChange={(e) => setTh((t) => ({ ...t, [f.key]: f.pct ? Number(e.target.value) / 100 : Number(e.target.value) }))} /></label>
            ))}
          </div>
        ) : (
          <div className="bt-ai-row">
            <label className="bt-field"><span className="lbl lbl--s">Société</span>
              <select value={firm} onChange={(e) => setFirm(e.target.value)}>{FIRMS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
            <label className="bt-field"><span className="lbl lbl--s">Évaluations réussies (%, minimum)</span>
              <input type="number" className="num" min={1} max={100} step={5} value={rate} onChange={n(setRate)} /></label>
            <label className="bt-field"><span className="lbl lbl--s">Trades (minimum)</span>
              <input type="number" className="num" min={1} step={5} value={th.min_trades} onChange={(e) => setTh((t) => ({ ...t, min_trades: Number(e.target.value) }))} /></label>
            <label className="bt-field"><span className="lbl lbl--s">Drawdown (%, maximum)</span>
              <input type="number" className="num" min={1} max={100} step={1} value={th.max_dd_pct} onChange={(e) => setTh((t) => ({ ...t, max_dd_pct: Number(e.target.value) }))} /></label>
          </div>
        )}
        <div className="bt-ai-row bt-ai-row--3">
          <label className="bt-field"><span className="lbl lbl--s">Hors échantillon : part du Sharpe</span>
            <input type="number" className="num" min={0} max={1} step={0.1} value={ratio} onChange={n(setRatio)} /></label>
          <label className="bt-field"><span className="lbl lbl--s">Essais (maximum)</span>
            <input type="number" className="num" min={1} max={200} step={10} value={maxAttempts} onChange={n(setMaxAttempts)} /></label>
          <label className="bt-field"><span className="lbl lbl--s">Appels à Gemini (maximum)</span>
            <input type="number" className="num" min={0} max={40} step={1} value={maxGemini} onChange={n(setMaxGemini)} /></label>
          <label className="bt-field"><span className="lbl lbl--s">Réécriture tous les (essais)</span>
            <input type="number" className="num" min={2} max={20} step={1} value={every} onChange={n(setEvery)} /></label>
        </div>
        <div className="bt-run">
          <Button variant="primary" disabled={sending || busy || !markets.length || (start === 'prompt' && !prompt.trim())} onClick={() => void send()}>
            {sending ? 'Création…' : 'Lancer la recherche'}</Button>
          {busy && <span className="lbl lbl--s bt-meta">une recherche tourne déjà</span>}
        </div>
        {err && <div className="bt-error" role="alert"><b>Recherche refusée.</b> {err}</div>}
      </div>
      <div className="lbl lbl--s bt-src" data-fresh>Simulation : réglages du panneau de gauche. Les essais tournent dans Supabase (bt-jobs, chaque minute), navigateur fermé. Appels à Gemini comptés sous le plafond de 50 par jour (offre gratuite, T-063) ; plafond atteint : reprise le lendemain.</div>
    </Panel>
  );
}

// --- Suivi et rapport ----------------------------------------------------------------------------------

function LoopView({ d, onStop, onLoad }: { d: LoopDetail; onStop: () => void; onLoad: (c: Candidate) => void }) {
  const { loop, attempts } = d;
  const [rep, setRep] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; k?: number; text?: string; same?: boolean }>({ state: 'idle' });
  const active = !isFinished(loop.status);
  const best = attempts.find((a) => a.n === loop.best_n) ?? null;
  const progression = (loop.report?.progression ?? attempts.map((a) => ({ best: a.score }))).map((p) => p.best).filter((x): x is number => x !== null);
  const bestSeries = progression.reduce<number[]>((acc, v) => [...acc, Math.max(v, acc.at(-1) ?? -Infinity)], []);
  const first = loop.spec.markets[0];
  const load = (a: (typeof attempts)[number]) => a.code && onLoad({ code: a.code, inputs: a.inputs, asset: first.asset, tf: first.tf, title: a.title, period: loop.spec.period });

  async function doReplay() {
    setRep({ state: 'busy', k: 0 });
    try {
      const data = [];
      for (const m of loop.spec.markets) data.push(sliceMarket(m, (await loadCandles(m.asset, m.tf)).reply as never));
      const r = await replay(loop.spec, attempts, data, async (k) => { setRep({ state: 'busy', k }); await new Promise((res) => setTimeout(res, 0)); });
      const same = r.fingerprint === loop.report?.fingerprint;
      setRep({ state: 'done', same, text: same ? `Empreinte identique (${r.fingerprint}) : ${attempts.length} essais rejoués dans le navigateur.`
        : `Empreinte différente (${r.fingerprint} au lieu de ${loop.report?.fingerprint}) ; essais qui diffèrent : ${r.differs.join(', ') || 'aucun'}. Cours ajustés de Tiingo : un dividende change l’historique.` });
    } catch (e) { setRep({ state: 'error', text: (e as Error).message }); }
  }

  return (
    <Panel title={`Recherche · ${loop.title}`} label="Suivi de la recherche" controls="none"
      chips={<>{active && <Button variant="ghost" onClick={onStop} disabled={loop.status === 'stopping'}>Arrêter</Button>}
        <Chip variant={loop.verdict === 'passed' ? 'hot' : 'neutral'}>{STATUS_LABEL[loop.status] ?? loop.status}</Chip></>}>
      <div className="bt-kpis bt-kpis--4">
        <div><span className="lbl lbl--s">Essais</span><b className="num">{`${loop.attempts} / ${loop.max_attempts ?? loop.spec.max_attempts}`}</b></div>
        <div><span className="lbl lbl--s">Appels à Gemini</span><b className="num">{`${loop.gemini_calls} / ${loop.spec.max_gemini}`}</b></div>
        <div><span className="lbl lbl--s">Meilleure note</span><b className="num">{loop.best_score === null ? '—' : `${fmtNumber(loop.best_score, 1)} / 100`}</b></div>
        <div><span className="lbl lbl--s">Progression</span>{bestSeries.length > 1 ? <Sparkline values={bestSeries} width="100%" /> : <b className="num">—</b>}</div>
      </div>
      {loop.note && <p className="bt-note">{loop.note}{loop.status === 'waiting' ? ` · reprise ${fmtWhen(loop.next_run_at)}` : ''}</p>}
      {loop.report && (
        <div className="bt-report" data-testid="loop-report">
          <p><b>{loop.report.verdict === 'passed' ? `Candidat trouvé : essai ${loop.report.winner}, réussi dans et hors échantillon.` : 'Aucun candidat ne passe dans et hors échantillon.'}</b> {loop.report.reason}.</p>
          <p className="lbl lbl--s">{`${loop.report.attempts} essais · ${loop.report.rewrites} écrits par Gemini · ${loop.report.params} variantes de paramètres · ${loop.report.errors} en erreur · ${loop.report.gemini_calls} appels · graine ${loop.report.seed} · ${loop.report.engine} · empreinte ${loop.report.fingerprint}`}</p>
          <div className="bt-run">
            <Button variant="secondary" disabled={rep.state === 'busy'} onClick={() => void doReplay()}>{rep.state === 'busy' ? `Rejeu… ${rep.k ?? 0} / ${attempts.length}` : 'Rejouer le rapport'}</Button>
            {rep.text && <span className={`bt-note ${rep.same === false || rep.state === 'error' ? 'bt-warn' : ''}`} data-testid="replay-result">{rep.text}</span>}
          </div>
        </div>
      )}
      {best?.detail && (
        <div className="bt-scroll"><table className="bt-table">
          <caption className="lbl lbl--s bt-caption">{`Meilleur essai (${best.n}) dans l’échantillon : crédit de chaque critère`}</caption>
          <thead><tr className="lbl lbl--s"><th>Marché</th><th>Critère</th><th className="r">Valeur</th><th className="r">Seuil</th><th className="r">Crédit</th></tr></thead>
          <tbody>{best.detail.flatMap((m) => m.criteria.map((c, i) => (
            <tr key={`${m.asset}${m.tf}${c.key}`}>
              <td>{i === 0 ? `${m.asset} ${TF_LABEL[m.tf]}` : ''}</td><td>{c.label}</td>
              <td className={`r num ${c.pass ? 'up' : 'dn'}`}>{fmtCrit(c)}</td><td className="r num">{fmtTarget(c)}</td>
              <td className="r num"><span className="bt-credit" aria-label={`${Math.round(c.credit * 100)} %`}><span style={{ width: `${c.credit * 100}%` }} /></span></td>
            </tr>)))}</tbody>
        </table></div>
      )}
      {attempts.length ? (
        <div className="bt-scroll"><table className="bt-table" data-testid="loop-attempts">
          <thead><tr className="lbl lbl--s"><th>#</th><th>Sorte</th><th>Changement</th><th className="r">Note</th><th>Dans l’éch.</th><th>Hors éch.</th><th /></tr></thead>
          <tbody>{[...attempts].reverse().map((a) => (
            <tr key={a.n}>
              <td className="num">{a.n}</td><td>{KIND_LABEL[a.kind] ?? a.kind}</td>
              <td className="bt-wrap">{a.ok ? (a.change ?? a.title ?? '—') : <span className="bt-warn">{a.error}</span>}</td>
              <td className="r num">{a.score === null ? '—' : fmtNumber(a.score, 1)}</td>
              <td><Verdict v={a.ok ? a.is_pass : null} /></td>
              <td>{d.oos_hidden ? (a.is_pass ? <span className="lbl lbl--s" title="Hors échantillon à l’aveugle jusqu’à la fin de la recherche">masqué</span> : '—')
                : <span title={a.oos_reasons?.join(' · ') ?? ''}><Verdict v={a.oos_pass} /></span>}</td>
              <td>{a.ok && a.code ? <button type="button" className="bt-link" onClick={() => load(a)}>Charger</button> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty reason={active ? 'premier essai au prochain passage de bt-jobs (chaque minute)' : 'aucun essai'} />}
      <div className="lbl lbl--s bt-src" data-fresh>{`bt-jobs · mise à jour ${fmtWhen(loop.updated_at)} · ${loop.spec.markets.map((m) => `${m.asset} ${TF_LABEL[m.tf]}`).join(', ')} · coupure à ${Math.round((loop.spec.is_share ?? 0.7) * 100)}${NBSP}% · « Charger » ouvre l’essai dans l’éditeur sur ${first.asset} ${TF_LABEL[first.tf]}`}</div>
    </Panel>
  );
}

export function ResearchPanel(p: ResearchProps) {
  const [loops, setLoops] = useState<LoopListItem[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<LoopDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await listLoops();
      setLoops(r.loops); setListErr(null);
      setSel((s) => s ?? r.loops[0]?.id ?? null);
    } catch (e) { setListErr(errText(e)); }
  }, []);
  const refreshDetail = useCallback(async (id: string) => {
    try { setDetail(await getLoop(id)); setDetailErr(null); } catch (e) { setDetailErr(errText(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (sel) void refreshDetail(sel); }, [sel, refreshDetail]);
  const active = detail ? !isFinished(detail.loop.status) : false;
  useEffect(() => {
    if (!sel || !active) return;
    const h = setInterval(() => { void refreshDetail(sel); void refresh(); }, 15_000);
    return () => clearInterval(h);
  }, [sel, active, refresh, refreshDetail]);

  const busy = (loops ?? []).some((l) => !isFinished(l.status));
  return (
    <>
      <PlanForm settings={p.settings} editorCode={p.editorCode} busy={busy} onCreated={(id) => { setSel(id); void refresh(); }} />
      <Panel title="Recherches" label="Recherches" controls="none">
        {listErr ? <div className="bt-ai-empty"><Missing reason={listErr} />{listErr}</div>
          : !loops ? <Empty reason="chargement…" /> : !loops.length ? <Empty reason="aucune recherche lancée" /> : (
            <ul className="bt-known">{loops.map((l) => (
              <li key={l.id}><button type="button" aria-pressed={l.id === sel} onClick={() => setSel(l.id)}>
                <b>{l.title}</b><span className="lbl lbl--s">{`${STATUS_LABEL[l.status] ?? l.status} · ${l.attempts} / ${l.max_attempts ?? '—'} essais${l.best_score !== null ? ` · note ${fmtNumber(l.best_score, 1)}` : ''}${l.verdict === 'passed' ? ' · candidat trouvé' : ''}`}</span>
                <span className="bt-sub">{`${l.markets.map((m) => `${m.asset} ${TF_LABEL[m.tf]}`).join(', ')} · ${fmtWhen(l.created_at)}`}</span></button></li>
            ))}</ul>
          )}
      </Panel>
      {detailErr && <div className="bt-error" role="alert"><b>Recherche illisible.</b> {detailErr}</div>}
      {detail && <LoopView d={detail} onLoad={p.onLoad} onStop={() => { void stopLoop(detail.loop.id).then(() => refreshDetail(detail.loop.id), (e) => setDetailErr(errText(e))); }} />}
    </>
  );
}
