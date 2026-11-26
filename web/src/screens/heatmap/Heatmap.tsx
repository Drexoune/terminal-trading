// Heatmap fondamentale (plan P3, M5 ; commande JPY FA ; maquette design/maquettes/png/Heatmap.png).
// Classement relatif des 8 devises, fiche de la devise choisie, matrice devises × thèmes, lecture
// automatique (T-055) et comparateur de paire. Le backtest (porte de P3) est affiché : tant que le
// score n'est pas démontré, l'écran dit « outil de contexte ». « — » avec la raison partout.

import './heatmap.css';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flagUrl } from '../../components/flags';
import { Panel } from '../../components/Panel';
import { Cell, Chip, Missing, Pill } from '../../components/ui';
import { useSettings } from '../../config/settings';
import { loadMacroSeries, MACRO_STATUS_KEY } from '../../data/online/macro';
import { useValue } from '../../data/store';
import { direction, fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm, zonedParts } from '../../lib/time';
import {
  BANK_NAME, CURRENCY, cellLevel, counterpart, economyOf, FLAG, fmtCellValue, fmtPeriod, fmtScore, MACRO_KEY, pair, reading,
  seriesKey, SOURCE_LABEL, THEME_LABEL, THEMES, valueOf, type Economy, type MacroReply, type SeriesReply,
} from '../../macro/macro';
import { SubHeader } from '../../shell/SubHeader';
import { ask, AssistantError, type AskReply } from '../../assistant/client';
import { HEATMAP_QUESTION, heatmapFacts } from '../../macro/aiReading';
import { useNow } from '../../shell/useNow';

const PARIS = 'Europe/Paris';
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function Flag({ e, w, h, alt = '' }: { e: Economy; w: number; h: number; alt?: string }) {
  const url = flagUrl(FLAG[e]);
  return url ? <img className="hm-flag" src={url} alt={alt} width={w} height={h} /> : <span className="hm-flag" style={{ width: w, height: h }} aria-hidden="true" />;
}

function daysTo(date: string, tz: string, now: number): number {
  const p = zonedParts(now, tz);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(p.y, p.m - 1, p.d)) / 86_400_000);
}

// --- Fiche devise : graphique 10 ans (taux directeur en marches, inflation, cible) ---------------------

function TenYears({ policy, cpi, target }: { policy: SeriesReply | undefined; cpi: SeriesReply | undefined; target: number }) {
  const pts = [...(policy?.points ?? []), ...(cpi?.points ?? [])];
  if (!pts.length) return <div className="hm-empty"><Missing reason="historique pas encore chargé" /><span>historique pas encore chargé</span></div>;
  const toT = (p: string) => { const q = /^(\d{4})-Q([1-4])$/.exec(p); return q ? Number(q[1]) + (Number(q[2]) * 3 - 1) / 12 : Number(p.slice(0, 4)) + (Number(p.slice(5, 7)) - 0.5) / 12; };
  const t0 = Math.min(...pts.map((p) => toT(p.period))), t1 = Math.max(...pts.map((p) => toT(p.period)));
  const vals = [...pts.map((p) => p.value), target];
  const lo = Math.floor(Math.min(...vals, 0) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
  const x = (p: string) => (((toT(p) - t0) / Math.max(t1 - t0, 1 / 12)) * 1000).toFixed(1);
  const y = (v: number) => (((hi - v) / (hi - lo)) * 220).toFixed(1);
  const line = (s: SeriesReply | undefined, step: boolean) => (s?.points ?? []).map((p, i) =>
    i === 0 ? `M${x(p.period)} ${y(p.value)}` : step ? `H${x(p.period)}V${y(p.value)}` : `L${x(p.period)} ${y(p.value)}`).join('') + (step && s?.points.length ? `H1000` : '');
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const years = Array.from({ length: Math.floor(t1) - Math.ceil(t0) + 1 }, (_, i) => Math.ceil(t0) + i).filter((yy) => yy % 2 === 1);
  return (
    <>
      <div className="hm-plot">
        <div className="hm-area">
          <svg viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">
            <path className="hm-grid" d={ticks.map((t) => `M0 ${y(t)}H1000`).join('')} />
            <path className="hm-target" d={`M0 ${y(target)}H1000`} />
            <path className="hm-cpi" d={line(cpi, false)} />
            <path className="hm-policy" d={line(policy, true)} />
          </svg>
        </div>
        <div className="num hm-yaxis">{ticks.map((t) => <span key={t} style={{ top: `${((hi - t) / (hi - lo)) * 100}%` }}>{`${fmtSigned(t, 0).replace('+', '')}${NBSP}%`}</span>)}</div>
      </div>
      <div className="num hm-xaxis">{years.map((yy) => <span key={yy} style={{ left: `${((yy - t0) / (t1 - t0)) * 100}%` }}>{yy}</span>)}</div>
    </>
  );
}

// --- Écran ---------------------------------------------------------------------------------------

export function HeatmapScreen() {
  const now = useNow();
  const { mode } = useSettings();
  const [params, setParams] = useSearchParams();
  const sel: Economy = economyOf((params.get('devise') ?? 'USD').toUpperCase()) ?? 'US';
  const st = useValue<MacroReply>(MACRO_KEY);
  const online = useValue<{ ok: boolean; reason: string | null }>(MACRO_STATUS_KEY);
  const policyS = useValue<SeriesReply>(seriesKey(sel, 'policy', 10));
  const cpiS = useValue<SeriesReply>(seriesKey(sel, 'cpi', 10));
  const [seriesErr, setSeriesErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'online') return;
    let alive = true;
    Promise.all([loadMacroSeries(sel, 'policy', 10), loadMacroSeries(sel, 'cpi', 10)])
      .then(() => alive && setSeriesErr(null), (e: Error) => alive && setSeriesErr(`historique injoignable : ${e.message}`));
    return () => { alive = false; };
  }, [mode, sel]);

  const reason = st ? (st.configured ? (st.scores ? 'aucune donnée' : 'tâche scores pas encore passée') : `non configuré : ${st.reason ?? ''}`)
    : mode !== 'online' ? 'écrans macro en Mode Online seulement (tâches p3-jobs de Supabase)'
      : online && !online.ok ? online.reason ?? 'injoignable' : 'chargement…';
  const rows = st?.scores?.rows ?? [];
  const row = rows.find((r) => r.economy === sel);
  const sheet = st?.sheets?.economies[sel];
  const rates = st?.rates?.[sel] ?? null;
  const pol = rates?.policy ?? null;
  const days = rates?.next?.date && rates.tz ? daysTo(rates.next.date, rates.tz, now) : null;
  const lc = pol?.last_change ?? null;
  const move = lc ? (lc.to > lc.from ? 'HIKE' : lc.to < lc.from ? 'CUT' : 'STATU QUO') : null;
  const cpi = valueOf(sheet, 'cpi'), core = valueOf(sheet, 'cpi_core');
  const target = sheet?.target.mid ?? 2;
  const gauge = (v: number) => `${Math.max(0, Math.min(100, (v / 5) * 100))}%`;
  const other = counterpart(sel);
  const p = pair(sheet, st?.sheets?.economies[other]);
  const sentences = reading(sel, row, sheet, rates, st?.backtest ?? null, days);
  const excluded = new Map((st?.scores?.excluded ?? []).map((x) => [x.theme, x.reason]));
  const bt = st?.backtest;
  const select = (e: Economy) => setParams(e === 'US' ? {} : { devise: CURRENCY[e] }, { replace: true });
  const policyValue = pol?.display ?? valueOf(sheet, 'policy')?.value ?? null;
  // Lecture IA à la demande (assistant de P6 : Gemini gratuit, chaque chiffre vérifié contre les faits).
  const [ai, setAi] = useState<{ busy: boolean; reply: AskReply | null; error: string | null }>({ busy: false, reply: null, error: null });
  const facts = heatmapFacts(st);
  const runAi = () => {
    setAi({ busy: true, reply: null, error: null });
    ask(HEATMAP_QUESTION, facts).then((reply) => setAi({ busy: false, reply, error: null }), (e: unknown) => setAi({ busy: false, reply: null,
      error: e instanceof AssistantError && e.status === 401 ? 'session expirée : se reconnecter (mot de passe d’application, écran Bourse)' : (e as Error).message }));
  };
  const byId = new Map(facts.map((f) => [f.id, f]));

  return (
    <>
      <SubHeader icon="heatmap" title="Heatmap fondamentale · 8 devises majeures"
        chips={<>
          <Chip variant="hot" round>Scores relatifs · somme nulle</Chip>
          {bt ? <Chip variant={bt.proven ? 'live' : 'pending'} title={`${bt.verdict} · backtest ${bt.from} → ${bt.to}, ${bt.months} mois · ${bt.caveats.join(' ; ')}`}>
            {bt.proven ? 'Signal démontré' : 'Outil de contexte · non démontré'}</Chip>
            : <Chip variant="pending" title="backtest pas encore passé">Backtest · —</Chip>}
        </>} />
      <div className="content hm" data-screen="heatmap">
        <div className="hm-row">
          <Panel title="Classement relatif" label="Classement relatif" controls="none" style={{ flex: '1 1 340px' }} chips={<Chip>−100 · +100</Chip>}>
            <div className="hm-rank">
              {rows.length ? rows.map((r) => (
                <button key={r.economy} type="button" className="hm-rk" aria-pressed={r.economy === sel} onClick={() => select(r.economy)}>
                  <span className="num hm-rk-n">{r.rank}</span>
                  <Flag e={r.economy} w={24} h={16} />
                  <span className="num hm-rk-c">{CURRENCY[r.economy]}</span>
                  <span className="hm-bar"><span className="hm-bar-zero" />
                    <span className={`hm-bar-fill ${r.score >= 0 ? 'up' : 'dn'}`} style={r.score >= 0 ? { left: '50%', width: `${r.score / 2}%` } : { right: '50%', width: `${-r.score / 2}%` }} /></span>
                  <span className={`num hm-rk-s ${direction(r.score)}`}>{fmtScore(r.score)}</span>
                  <span className="hm-rk-p"><Pill bias={r.bias} /></span>
                </button>
              )) : <div className="hm-empty"><Missing reason={reason} /><span>{reason}</span></div>}
            </div>
          </Panel>

          <Panel title={`${CURRENCY[sel]} · ${BANK_NAME[sel]}`} label="Fiche devise" style={{ flex: '2 1 600px' }} chips={row ? <Pill bias={row.bias} /> : undefined}>
            <div className="hm-sheet-top">
              <div className="hm-key-wrap">
                <Flag e={sel} w={48} h={32} alt={CURRENCY[sel]} />
                <div>
                  <div className="lbl hm-small">Taux directeur</div>
                  <div className="hm-key" title={pol?.date ? `BIS, observation du ${fmtDate(pol.date)}` : undefined}>
                    {policyValue !== null ? `${fmtNumber(policyValue, 2)}${NBSP}%` : <Missing reason={reason} />}</div>
                </div>
              </div>
              <div className="hm-key-side">
                <span className="num hm-prev">{lc ? `Précédent ${fmtNumber(lc.from, 2)}${NBSP}% · ${fmtDate(lc.date)}` : 'Précédent —'}</span>
                <span className={`chip ${move === 'HIKE' ? 'hm-cy' : move === 'CUT' ? 'hm-co' : ''}`}>{`Dernier mouvement · ${move ?? '—'}`}</span>
                <span className="chip chip--hot">{rates?.next?.date ? `Prochaine réunion · ${fmtDate(rates.next.date)}${days !== null && days >= 0 ? ` · J-${days}` : ''}` : 'Prochaine réunion · —'}</span>
              </div>
            </div>
            <div className="hm-gauge-wrap">
              <div className="hm-gauge-head"><span className="lbl hm-small">Inflation vs cible</span>
                <span className="num hm-gauge-vals">IPC <b className="hm-gold">{cpi?.value != null ? `${fmtNumber(cpi.value, 1)}${NBSP}%` : '—'}</b> · sous-jacente <b>{core?.value != null ? `${fmtNumber(core.value, 1)}${NBSP}%` : '—'}</b></span></div>
              <div className="hm-gauge">
                <div className="hm-gauge-track" />
                <div className="hm-gauge-target" style={{ left: gauge(target) }} />
                {cpi?.value != null && <div className="hm-gauge-cpi" style={{ left: gauge(cpi.value) }} title={`IPC ${fmtPeriod(cpi.period)}`} />}
                {core?.value != null && <div className="hm-gauge-core" style={{ left: gauge(core.value) }} title={`sous-jacente ${fmtPeriod(core.period)}`} />}
              </div>
              <div className="num hm-gauge-axis"><span>0 %</span><span className="hm-cyan">{`cible ${sheet?.target.text ?? '2 %'}`}</span><span>5 %</span></div>
            </div>
            <div className="hm-chart">
              <div className="hm-legend">
                <span className="lbl hm-small">10 ans</span><span className="hm-spacer" />
                <span className="lbl hm-small"><span className="hm-ln hm-ln--policy" />Taux directeur</span>
                <span className="lbl hm-small"><span className="hm-ln hm-ln--cpi" />Inflation</span>
                <span className="lbl hm-small"><span className="hm-ln hm-ln--target" />{`Cible ${sheet?.target.text ?? '2 %'}`}</span>
              </div>
              {seriesErr ? <div className="hm-empty"><Missing reason={seriesErr} /><span>{seriesErr}</span></div>
                : <TenYears policy={policyS} cpi={cpiS} target={target} />}
            </div>
          </Panel>
        </div>

        <div className="hm-row">
          <Panel title="Matrice fondamentale" label="Matrice fondamentale" style={{ flex: '2 1 640px' }}
            chips={<Chip>{st?.scores ? `Mise à jour ${zonedParts(st.scores.computed_ms, PARIS).d.toString().padStart(2, '0')}/${String(zonedParts(st.scores.computed_ms, PARIS).m).padStart(2, '0')} · ${fmtHm(st.scores.computed_ms, PARIS)}` : 'Mise à jour —'}</Chip>}>
            <div className="hm-mx-scroll">
              <div className="hm-mx-inner">
                <div className="hm-mx lbl hm-mx-head">
                  <span>Devise</span>
                  {THEMES.map((t) => <span key={t} className="c" title={excluded.has(t) ? `non compté au score : ${excluded.get(t)}` : undefined}>
                    {THEME_LABEL[t]}{excluded.has(t) ? ' *' : ''}</span>)}
                  <span className="c">Biais</span>
                </div>
                {rows.map((r) => (
                  <div key={r.economy} className="hm-mx" data-testid={`mx-${CURRENCY[r.economy]}`}>
                    <button type="button" className="hm-cb" aria-pressed={r.economy === sel} onClick={() => select(r.economy)}>
                      <Flag e={r.economy} w={21} h={14} />{CURRENCY[r.economy]}<span className={`hm-cb-s ${direction(r.score)}`}>{fmtScore(r.score)}</span>
                    </button>
                    {THEMES.map((t) => {
                      const c = r.cells.find((x) => x.theme === t);
                      if (!c || c.value === null) return <span key={t} className="cell cell--neutral hm-cell-off" title={c?.reason ?? 'absent'} aria-label={`Indisponible : ${c?.reason ?? 'absent'}`}>—</span>;
                      const title = `${THEME_LABEL[t]} · ${fmtPeriod(c.period)}${c.z !== null ? ` · z ${fmtSigned(c.z, 2)}` : ''}${c.reason ? ` · ${c.reason}` : ''}${excluded.has(t) ? ' · non compté au score' : ''}`;
                      return <span key={t} title={title}><Cell level={excluded.has(t) || c.level === null ? 'neutral' : cellLevel(c.level)}>{fmtCellValue(c)}</Cell></span>;
                    })}
                    <span className="hm-mx-bias"><Pill bias={r.bias} /></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="hm-mx-legend">
              <span className="lbl hm-small">Lecture</span>
              <span className="hm-sw">{(['down-2', 'down-1', 'neutral', 'up-1', 'up-2'] as const).map((l) => <span key={l} className={`cell--${l}`} />)}</span>
              <span className="hm-muted">du plus défavorable au plus favorable pour la devise, relativement aux 7 autres{excluded.size ? ' · * non compté au score' : ''}</span>
            </div>
          </Panel>

          <div className="hm-side">
            <Panel title="Lecture fondamentale · automatique" label="Lecture fondamentale" controls="none"
              chips={<button type="button" className="chip chip--hot hm-ai-btn" disabled={ai.busy || !facts.length} onClick={runAi} data-testid="hm-ai-btn"
                title={facts.length ? 'Lecture rédigée par l’assistant (Gemini, offre gratuite) à partir des seuls scores affichés ; chaque chiffre est vérifié' : 'scores pas encore calculés'}>
                {ai.busy ? 'IA…' : 'Lecture IA'}</button>}>
              <div className="hm-reading">
                {sentences.length ? <p>{sentences.map((s, i) => <span key={i} title={`Sources : ${s.sources.join(' ; ')}`}>{s.text} </span>)}</p>
                  : <div className="hm-empty"><Missing reason={reason} /><span>{reason}</span></div>}
                <div className="lbl hm-small hm-reading-note" title="Sources de chaque phrase en infobulle (T-055)">Lecture automatique · à partir des seuls chiffres affichés</div>
                {(ai.reply || ai.error) && <div className="hm-ai" data-testid="hm-ai" aria-live="polite">
                  {ai.error ? <p className="field__error">{`Lecture IA indisponible : ${ai.error}`}</p>
                    : ai.reply?.ok ? <>
                      <p className="hm-ai-text">{ai.reply.answer}</p>
                      <div className="hm-ai-srcs">{(ai.reply.sources ?? []).map((id) => byId.get(id)).filter(Boolean).map((f) => (
                        <span key={f!.id} className="chip chip--s" title={`${f!.label} : ${f!.value} · ${f!.source}`}>{f!.label.split(' · ')[0]} · {f!.label.split(' · ')[1]?.split(' (')[0] ?? ''}</span>))}</div>
                      <div className="lbl hm-small">Lecture IA · Gemini · à vérifier{ai.reply.cached ? ' · en cache' : ''}{ai.reply.cap ? ` · ${ai.reply.calls_today ?? '—'}/${ai.reply.cap} aujourd’hui` : ''}</div>
                    </> : <p className="hm-ai-text hm-ai-text--off">{`Réponse écartée : ${ai.reply?.reason ?? 'raison inconnue'}`}</p>}
                </div>}
              </div>
            </Panel>
            <Panel title={`Paire ${CURRENCY[sel]} / ${CURRENCY[other]}`} label="Comparateur de paire" controls="none">
              <div className="lbl hm-pair hm-pair-head"><span>Indicateur</span><span className="r">{CURRENCY[sel]}</span><span className="r">{CURRENCY[other]}</span><span className="r">Écart</span></div>
              {p.rows.map((r) => (
                <div key={r.indicator} className="hm-pair hm-pair-row">
                  <span className="hm-pair-l">{r.label}</span>
                  {[r.a, r.b].map((v, i) => <span key={i} className="num r" title={v?.value != null ? `${SOURCE_LABEL[v.source ?? ''] ?? v.source} · ${fmtPeriod(v.period)}` : v?.reason ?? 'absent'}>
                    {v?.value != null ? fmtNumber(v.value, r.indicator === 'policy' ? 2 : 1) : <Missing reason={v?.reason ?? 'absent'} />}</span>)}
                  <span className={`num r hm-pair-d ${r.favors === 'a' ? 'up' : r.favors === 'b' ? 'dn' : ''}`}>{r.diff === null ? '—' : fmtSigned(r.diff, r.indicator === 'policy' ? 2 : 1)}</span>
                </div>
              ))}
              <div className="hm-verdict"><span className="dia" />{p.verdict ?? 'Verdict — : indicateurs manquants'}</div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

