// Écran Macro (plan P3, M5 ; commande USD MACRO). Pas de maquette : construit avec le design
// system (comme Markets Watch, T-033). Fiche d'une économie : chaque indicateur avec sa dernière
// valeur, la précédente, la source et sa fraîcheur ; historique sur 5, 10 ou 20 ans ; prochaines
// publications de l'agenda. « — » avec la raison pour ce qu'aucune source libre ne donne (T-058).

import './macro.css';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CalendarEvent, CalendarWeek } from '../../calendar/calendar';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Segmented } from '../../components/ui';
import { useSettings } from '../../config/settings';
import { loadMacroSeries, MACRO_STATUS_KEY } from '../../data/online/macro';
import { useKeys, useValue } from '../../data/store';
import { direction, fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm, zonedParts } from '../../lib/time';
import {
  BANK_NAME, CURRENCY, ECONOMIES, ECONOMY_NAME, economyOf, fmtPeriod, INDICATOR_LABEL, INDICATORS, MACRO_KEY, seriesKey, SOURCE_LABEL, valueOf,
  type Economy, type Indicator, type MacroReply, type SeriesReply,
} from '../../macro/macro';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

const PARIS = 'Europe/Paris';
const YEARS = [5, 10, 20] as const;
const UNIT: Record<Indicator, string> = { policy: '%', cpi: '%', cpi_core: '%', gdp: '%', unemployment: '%', confidence: 'pts', retail: '%' };
const fmtV = (ind: Indicator, v: number) => `${fmtNumber(v, ind === 'policy' ? 2 : 1)}${UNIT[ind] === '%' ? `${NBSP}%` : ''}`;

function History({ s, indicator }: { s: SeriesReply | undefined; indicator: Indicator }) {
  const pts = s?.points ?? [];
  if (pts.length < 2) return <div className="mc-empty"><Missing reason="historique pas encore chargé" /><span>historique pas encore chargé</span></div>;
  const vals = pts.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0.2, (hi - lo) * 0.1);
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i: number) => ((i / (pts.length - 1)) * 1000).toFixed(1);
  const y = (v: number) => (((y1 - v) / (y1 - y0)) * 200).toFixed(1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p.value)}`).join('');
  const zero = y0 < 0 && y1 > 0 ? `M0 ${y(0)}H1000` : '';
  const ticks = [y0 + (y1 - y0) * 0.1, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1];
  const labels = [0, Math.floor(pts.length / 2), pts.length - 1];
  return (
    <>
      <div className="mc-plot">
        <div className="mc-area">
          <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
            <path className="mc-zero" d={zero} />
            <path className={indicator === 'policy' ? 'mc-line mc-line--policy' : 'mc-line'} d={d} />
          </svg>
        </div>
        <div className="num mc-yaxis">{ticks.map((t) => <span key={t} style={{ top: `${((y1 - t) / (y1 - y0)) * 100}%` }}>{fmtNumber(t, 1)}</span>)}</div>
      </div>
      <div className="num mc-xaxis">{labels.map((i) => <span key={i}>{fmtPeriod(pts[i].period)}</span>)}</div>
    </>
  );
}

export function MacroScreen() {
  const now = useNow();
  const { mode } = useSettings();
  const [params, setParams] = useSearchParams();
  const eco: Economy = economyOf((params.get('eco') ?? 'US').toUpperCase()) ?? 'US';
  const [ind, setInd] = useState<Indicator>('cpi');
  const [years, setYears] = useState<(typeof YEARS)[number]>(10);
  const st = useValue<MacroReply>(MACRO_KEY);
  const online = useValue<{ ok: boolean; reason: string | null }>(MACRO_STATUS_KEY);
  const series = useValue<SeriesReply>(seriesKey(eco, ind, years));
  const weeks = useKeys<CalendarWeek>('calendar:week:');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'online') return;
    let alive = true;
    loadMacroSeries(eco, ind, years).then(() => alive && setErr(null), (e: Error) => alive && setErr(`historique injoignable : ${e.message}`));
    return () => { alive = false; };
  }, [mode, eco, ind, years]);

  const reason = st ? (st.configured ? 'tâche scores pas encore passée' : `non configuré : ${st.reason ?? ''}`)
    : mode !== 'online' ? 'écrans macro en Mode Online seulement (tâches p3-jobs de Supabase)'
      : online && !online.ok ? online.reason ?? 'injoignable' : 'chargement…';
  const sheet = st?.sheets?.economies[eco];
  const feed = st?.feed;
  const upcoming = (weeks.length ? weeks[weeks.length - 1][1].events : [])
    .filter((e: CalendarEvent) => e.currency === CURRENCY[eco] && e.time_ms !== null && e.time_ms > now && e.impact !== 'Holiday')
    .sort((a, b) => (a.time_ms as number) - (b.time_ms as number)).slice(0, 8);
  const failed = (st?.series ?? []).filter((x) => x.id.startsWith(`${eco}:`) && x.last_error);

  return (
    <>
      <SubHeader icon="macro" title={`Macro · ${ECONOMY_NAME[eco]}`}
        chips={<>
          <Chip variant={feed?.status === 'connected' ? 'live' : feed ? 'down' : 'neutral'} title={feed?.last_error ?? undefined}>
            {feed?.last_message_ms ? `Relevé · ${fmtHm(feed.last_message_ms, PARIS)}` : 'Relevé · —'}</Chip>
          {st?.sheets && <Chip>{`Fiche au ${st.sheets.date.slice(8, 10)}/${st.sheets.date.slice(5, 7)}`}</Chip>}
        </>} />
      <div className="content mc" data-screen="macro">
        <div role="group" aria-label="Économie" className="mc-tabs">
          {ECONOMIES.map((e) => <button key={e} type="button" className="mc-tab" aria-pressed={e === eco}
            onClick={() => setParams(e === 'US' ? {} : { eco: CURRENCY[e] }, { replace: true })}>{CURRENCY[e]}</button>)}
        </div>
        <div className="mc-grid">
          <Panel title={`Indicateurs · ${BANK_NAME[eco]}`} label="Indicateurs" controls="none">
            <table className="mc-table">
              <thead><tr className="lbl lbl--s"><th>Indicateur</th><th className="r">Dernier</th><th className="r hide-s">Précédent</th>
                <th className="r">Variation</th><th className="hide-xs">Source</th></tr></thead>
              <tbody>
                {INDICATORS.map((i) => {
                  const v = valueOf(sheet, i);
                  const policy = i === 'policy' ? st?.rates?.[eco]?.policy : null;
                  const value = policy?.display ?? v?.value ?? null;
                  const ch = v?.value != null && v.previous ? v.value - v.previous.value : null;
                  return (
                    <tr key={i} data-testid={`mc-${i}`} aria-selected={i === ind} onClick={() => setInd(i)}>
                      <td><b>{v?.label ?? INDICATOR_LABEL[i]}</b>{v?.transform === 'yoy_qoq' && <span className="lbl lbl--s mc-sub">calculé sur 4 trimestres</span>}
                        {!v && <span className="lbl lbl--s mc-sub">absent de la fiche</span>}</td>
                      <td className="r num">{value !== null ? <><span className="mc-last">{fmtV(i, value)}</span>
                        <span className={`lbl lbl--s mc-sub${v?.stale ? ' mc-stale' : ''}`}>{policy?.date ? `BIS · ${policy.date.slice(8, 10)}/${policy.date.slice(5, 7)}` : `${fmtPeriod(v?.period)}${v?.stale ? ' · périmé' : ''}`}</span></>
                        : <Missing reason={v?.reason ?? reason} />}</td>
                      <td className="r num hide-s">{v?.previous ? <><span>{fmtV(i, v.previous.value)}</span><span className="lbl lbl--s mc-sub">{fmtPeriod(v.previous.period)}</span></> : '—'}</td>
                      <td className="r num">{ch === null ? '—' : <span className={direction(i === 'unemployment' ? -ch : ch)}>{fmtSigned(ch, i === 'policy' ? 2 : 1)}</span>}</td>
                      <td className="hide-xs">{v?.url ? <a href={v.url} target="_blank" rel="noreferrer">{SOURCE_LABEL[v.source ?? ''] ?? v.source}</a>
                        : <span className="mc-muted" title={v?.reason ?? undefined}>{v?.reason ? '—' : ''}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {failed.length > 0 && <p className="mc-note mc-warn">{`Dernier incident : ${failed.map((f) => `${f.id} (${f.last_error})`).join(' ; ')}`}</p>}
            <p className="mc-note">Cliquer un indicateur affiche son historique. Valeurs publiées à la date de la fiche, délais de publication compris (T-056, T-058).</p>
          </Panel>

          <div className="mc-side">
            <Panel title={`Historique · ${INDICATOR_LABEL[ind]}`} label="Historique" controls="none"
              chips={<Segmented label="Durée" value={String(years) as '5' | '10' | '20'} onChange={(x) => setYears(Number(x) as 5 | 10 | 20)}
                options={YEARS.map((n) => ({ value: String(n) as '5' | '10' | '20', label: `${n} ans` }))} />}>
              <div className="mc-hist">{err ? <div className="mc-empty"><Missing reason={err} /><span>{err}</span></div> : <History s={series} indicator={ind} />}</div>
            </Panel>
            <Panel title={`Prochaines publications · ${CURRENCY[eco]}`} label="Prochaines publications" controls="none">
              <ul className="mc-events">
                {upcoming.length ? upcoming.map((e) => {
                  const p = zonedParts(e.time_ms as number, PARIS);
                  return <li key={e.id}><span className="num mc-ev-t">{`${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')} ${fmtHm(e.time_ms as number, PARIS)}`}</span>
                    <span>{e.title_fr ?? e.title}</span><span className={`lbl lbl--s mc-ev-i mc-ev-i--${e.impact.toLowerCase()}`}>{e.impact === 'High' ? 'Fort' : e.impact === 'Medium' ? 'Moyen' : 'Faible'}</span></li>;
                }) : <li className="mc-muted">{weeks.length ? 'aucune publication à venir cette semaine dans l’agenda' : 'agenda pas encore chargé'}</li>}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
