// Écran Calendrier économique (commande USD ECO, étape E2, docs/ecrans.md § 2).
// Semaine en cours : clé calendar:week:<AAAA-Wnn> publiée par le service
// « calendar » de la passerelle, ou relue dans p1_state en Mode Online (plan « Tout en
// ligne », O2) ; semaines passées : /api/calendar?week= (archive du Mac) ou
// /api/p1/calendar?week= (archive en ligne). Heures à Paris, calculées depuis l'UTC ; titres en VO (T-019).
// Réel et surprise : chiffres captés sur bls.gov par le service « release » (E3),
// clés release:… ; révisions lues par l'API v1 ; réaction du BTC, clés reaction:… (Reaction.tsx).
// Historique sur 5 ans : à venir. Sinon « — » et la raison,
// jamais une valeur de maquette.

import './calendar.css';
import { useEffect, useMemo, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing } from '../../components/ui';
import {
  actualReason, applyFilters, countdown, CURRENCIES, dayLabel, fmtValue, groupByDay, IMPACTS, impactLevel, parisOffsetLabel,
  actualSourceText, rowState, shiftWeek, timeLabel, todayParis, weekRangeLabel, type CalendarActual, type CalendarEvent, type CalendarWeek,
} from '../../calendar/calendar';
import { Flag } from '../../calendar/Flag';
import {
  captureLabel, figureFor, isRecalculated, figureIndex, figures, fmtDelay, fmtFigure, reactions, revisionText, surpriseText,
  type ReleaseFigure,
} from '../../calendar/releases';
import { useSettings } from '../../config/settings';
import { fetchJson } from '../../data/gateway';
import { P1_STATUS_KEY, type P1Status } from '../../data/online/p1';
import { useKeys, useValue } from '../../data/store';
import { fmtHm } from '../../lib/time';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';
import { ReactionPanel } from './Reaction';

export function ImpactBars({ impact }: { impact: string }) {
  const n = impactLevel(impact);
  const label = n === 3 ? 'impact fort' : n === 2 ? 'impact moyen' : n === 1 ? 'impact faible' : 'jour férié';
  return (
    <span className="impact" role="img" aria-label={label} title={label}>
      {[1, 2, 3].map((k) => <i key={k} className={k <= n ? 'on' : ''} />)}
    </span>
  );
}

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'error'; reason: string } | { state: 'ok'; data: CalendarWeek };

export function CalendarScreen() {
  const { mode } = useSettings();
  const now = useNow();
  const online = useValue<P1Status>(P1_STATUS_KEY);
  const weeks = useKeys<CalendarWeek>('calendar:week:');
  const live = weeks.length ? weeks[weeks.length - 1][1] : null;
  const [week, setWeek] = useState<string | null>(null);     // null : semaine en cours
  const [other, setOther] = useState<Load>({ state: 'idle' });
  const [currencies, setCurrencies] = useState<Set<string>>(() => new Set(CURRENCIES));
  const [impacts, setImpacts] = useState<Set<string>>(() => new Set(['High', 'Medium', 'Low']));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const target = week ?? live?.week ?? null;
  useEffect(() => {
    if (!week || week === live?.week) { setOther({ state: 'idle' }); return; }
    const ctl = new AbortController();
    setOther({ state: 'loading' });
    const path = mode === 'online' ? `/api/p1/calendar?week=${week}` : `/api/calendar?week=${week}`;
    fetchJson<CalendarWeek>(path, { signal: ctl.signal, timeoutMs: 8000 })
      .then((data) => setOther({ state: 'ok', data }))
      .catch((e: unknown) => { if (!ctl.signal.aborted) setOther({ state: 'error', reason: (e as Error).message }); });
    return () => ctl.abort();
  }, [week, live?.week, mode]);

  const data = week && week !== live?.week ? (other.state === 'ok' ? other.data : null) : live;
  const releaseEntries = useKeys<unknown>('release:');
  const index = useMemo(() => figureIndex(figures(releaseEntries)), [releaseEntries]);
  const reactionEntries = useKeys<unknown>('reaction:');
  const btc = useMemo(() => reactions(reactionEntries), [reactionEntries]);
  const actualEntries = useKeys<CalendarActual>('calendar:actual:');
  const fj = useMemo(() => new Map(actualEntries.map(([, a]) => [a.event_id, a])), [actualEntries]);
  const events = useMemo(() => applyFilters(data?.events ?? [], { currencies, impacts, query })
    .map((e) => {
      const f = figureFor(e, index);
      if (f) return { ...e, actual: f.value };
      const a = fj.get(e.id);
      return a ? { ...e, actual: a.actual ?? a.actual_raw } : e;
    }),
  [data, currencies, impacts, query, index, fj]);
  const groups = useMemo(() => groupByDay(events), [events]);
  const sel = events.find((e) => e.id === selected)
    ?? events.find((e) => e.capture && (e.time_ms ?? 0) > now)
    ?? events.find((e) => e.impact === 'High' && (e.time_ms ?? 0) > now) ?? events[0] ?? null;

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };
  const weekNo = target ? Number(target.slice(-2)) : null;
  const unavailable = live ? null : mode === 'online'
    ? (online?.reason ?? (online ? 'agenda en ligne pas encore relevé (Edge Function p1-jobs, tâche ff-calendar)' : 'agenda en ligne : lecture en cours'))
    : 'agenda pas encore reçu : activer le service calendar de la passerelle (GATEWAY_SERVICES=okx,calendar)';

  return (
    <>
      <SubHeader icon="calendar" title={`Calendrier économique${weekNo ? ` · Semaine ${weekNo}` : ''}`}
        chips={<>
          <Chip variant="hot">{`Heure de Paris · ${parisOffsetLabel(now)}`}</Chip>
          <Chip title="agenda et prévisions ForexFactory ; heures officielles du BLS pour les indicateurs captés">
            {data?.forexfactory.received_ms ? `ForexFactory · reçu ${fmtHm(data.forexfactory.received_ms, 'Europe/Paris')}` : 'ForexFactory · —'}
          </Chip>
        </>} />
      <div className="content cal" data-screen="calendar">
        <div className="cal-tools">
          <div className="cal-week">
            <button type="button" className="btn btn--icon" aria-label="Semaine précédente" disabled={!target}
              onClick={() => target && setWeek(shiftWeek(target, -1))}>‹</button>
            <span className="num cal-week__label">{data ? weekRangeLabel(data.from, data.to) : '—'}</span>
            <button type="button" className="btn btn--icon" aria-label="Semaine suivante"
              disabled={!target || !live || target >= live.week} onClick={() => target && setWeek(shiftWeek(target, 1) === live?.week ? null : shiftWeek(target, 1))}>›</button>
          </div>
          <div className="cal-toggles" role="group" aria-label="Devises">
            {CURRENCIES.map((c) => (
              <button key={c} type="button" className="cal-toggle" aria-pressed={currencies.has(c)} onClick={() => toggle(currencies, c, setCurrencies)}>
                <Flag currency={c} />{c}
              </button>
            ))}
          </div>
          <div className="cal-toggles" role="group" aria-label="Impact">
            {IMPACTS.map((i) => (
              <button key={i.key} type="button" className="cal-toggle" aria-pressed={impacts.has(i.key)} onClick={() => toggle(impacts, i.key, setImpacts)}>
                {i.label}
              </button>
            ))}
          </div>
        </div>
        <label className="cal-search">
          <span className="sr">Rechercher un indicateur</span>
          <input type="search" placeholder="Rechercher un indicateur…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="cal-grid">
          <Panel title="Publications de la semaine" testId="cal-week"
            chips={<Chip>{`${events.length} événement${events.length > 1 ? 's' : ''}`}</Chip>}>
            {unavailable && !data ? (
              <div className="placeholder"><span className="placeholder__dash" aria-hidden="true">—</span><span>{unavailable}</span></div>
            ) : other.state === 'loading' ? <div className="placeholder"><span>Chargement de l’archive…</span></div>
              : other.state === 'error' ? <div className="placeholder"><Missing reason={other.reason} /><span>{other.reason}</span></div>
                : <WeekTable groups={groups} now={now} selected={sel?.id ?? null} onSelect={setSelected} archive={!!data?.archive} index={index} fj={fj} />}
          </Panel>
          <div className="cal-side">
            <IndicatorCard ev={sel} now={now} fig={sel ? figureFor(sel, index) : null} fj={sel ? fj.get(sel.id) ?? null : null} />
            <ReactionPanel ev={sel} all={btc} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Réel tiré du fil d'actus, marqué « FJ » : jamais confondu avec un chiffre capté au BLS. */
function FjActual({ a, ev, big }: { a: CalendarActual; ev: CalendarEvent; big?: boolean }) {
  return (
    <span className={big ? undefined : 'cal-actual'} title={actualSourceText(a)} data-testid="cal-actual-fj">
      {fmtValue(a.actual, a.unit ?? ev.unit, a.actual_raw)}<span className="lbl lbl--s cal-fj"> FJ</span>
    </span>
  );
}

function WeekTable({ groups, now, selected, onSelect, archive, index, fj }: {
  groups: { day: string; events: CalendarEvent[] }[]; now: number; selected: string | null; onSelect: (id: string) => void; archive: boolean;
  index: Map<string, ReleaseFigure>; fj: Map<string, CalendarActual>;
}) {
  const today = todayParis(now);
  if (!groups.length) return <div className="placeholder"><span className="placeholder__dash">—</span><span>Aucun événement pour ces filtres.</span></div>;
  return (
    <table className="cal-table">
      <thead><tr className="lbl lbl--s">
        <th>Heure</th><th>Devise</th><th>Imp.</th><th>Événement</th><th className="r">Réel</th><th className="r">Consensus</th>
        <th className="r">Précédent</th><th className="r">Surprise</th>
      </tr></thead>
      {groups.map((g) => (
        <tbody key={g.day}>
          <tr className="cal-day"><th colSpan={8} scope="rowgroup">
            <span className="lbl">{dayLabel(g.day)}</span>{g.day === today && <span className="lbl lbl--s cal-today">Aujourd’hui</span>}
          </th></tr>
          {g.events.map((e) => {
            const st = rowState(e, now);
            const fig = figureFor(e, index);
            return (
              <tr key={e.id} className={`cal-row${st.kind === 'new' ? ' cal-row--new' : ''}${selected === e.id ? ' is-selected' : ''}${st.kind === 'past' ? ' is-past' : ''}`}
                onClick={() => onSelect(e.id)} aria-selected={selected === e.id}>
                <td className="num" title={e.time_source === 'BLS' ? `heure officielle du BLS (${e.official?.local_time} à New York)` : `heure ${e.time_kind} (ForexFactory)`}>
                  {timeLabel(e)}{e.time_source === 'BLS' && <span className="cal-off" aria-label="heure officielle">●</span>}
                </td>
                <td><span className="cal-cur"><Flag currency={e.currency} />{e.currency}</span></td>
                <td><ImpactBars impact={e.impact} /></td>
                <td className="cal-title">
                  <button type="button" className="cal-title__btn" onClick={() => onSelect(e.id)}>{e.title_fr ?? e.title}</button>
                  {e.title_fr && <span className="lbl lbl--s cal-vo">VO · {e.title}</span>}
                  {st.kind === 'pending' && <span className="chip chip--s chip--pending cal-pending">En attente · {countdown(st.remainingMs)}</span>}
                  {st.kind === 'new' && <span className="chip chip--s chip--new">Nouveau</span>}
                  {e.time_mismatch && <span className="lbl lbl--s cal-warn" title="l’heure ForexFactory diffère du calendrier officiel">heure ForexFactory différente</span>}
                </td>
                <td className="r num" data-testid="cal-actual">
                  {fig ? (fig.value !== null ? <span className="cal-actual" title={`BLS · ${fig.part ?? ''} · ${fig.nature === 'officielle' ? `capté ${fmtDelay(fig.capture_delay_ms)} après l’heure prévue` : captureLabel(fig)}${fig.revisions?.length ? ` · ${revisionText(fig)}` : ''}`}>{fmtFigure(fig)}</span>
                    : <Missing reason={fig.reason ?? 'chiffre non lu'} />) : fj.get(e.id) ? <FjActual a={fj.get(e.id)!} ev={e} /> : <Missing reason={actualReason(e, now)} />}
                </td>
                <td className="r num">{e.forecast_raw ? fmtValue(e.forecast, e.unit, e.forecast_raw) : <Missing reason="aucun consensus publié par ForexFactory" />}</td>
                <td className="r num">{e.previous_raw ? fmtValue(e.previous, e.unit, e.previous_raw) : <Missing reason="aucune valeur précédente publiée" />}</td>
                <td className="r num">{fig ? <Surprise fig={fig} /> : <Missing reason={e.capture ? 'surprise : après la publication captée' : 'surprise : indicateur non capté'} />}</td>
              </tr>
            );
          })}
        </tbody>
      ))}
      {archive && <tfoot><tr><td colSpan={8} className="lbl lbl--s">Archive du Mac : dernière version relevée de chaque événement.</td></tr></tfoot>}
    </table>
  );
}

function Surprise({ fig }: { fig: ReleaseFigure }) {
  const s = surpriseText(fig);
  if (s.text === '—') return <Missing reason={s.reason ?? 'indisponible'} />;
  return <span className={s.tone ? `tone-${s.tone}` : undefined} title={s.reason ?? undefined}>{s.text}</span>;
}

function IndicatorCard({ ev, now, fig, fj }: { ev: CalendarEvent | null; now: number; fig: ReleaseFigure | null; fj: CalendarActual | null }) {
  return (
    <Panel title={ev ? `Fiche · ${ev.title_fr ?? ev.title}` : 'Fiche'} label={`Fiche indicateur ${ev?.title_fr ?? ev?.title ?? ''}`.trim()} controls="none" testId="cal-card"
      chips={ev ? <Flag currency={ev.currency} /> : undefined}>
      {!ev ? <div className="placeholder"><span className="placeholder__dash">—</span><span>Sélectionner un événement.</span></div> : (
        <div className="cal-card">
          <div className="cal-card__kpis">
            <div><span className="lbl lbl--s">Réel</span><span className="num cal-card__big">{fig && fig.value !== null ? fmtFigure(fig) : fj ? <FjActual a={fj} ev={ev} big /> : <Missing reason={fig?.reason ?? actualReason(ev, now)} />}</span></div>
            <div><span className="lbl lbl--s">Consensus</span><span className="num">{fmtValue(ev.forecast, ev.unit, ev.forecast_raw)}</span></div>
            <div><span className="lbl lbl--s">Précédent</span><span className="num">{fmtValue(ev.previous, ev.unit, ev.previous_raw)}</span></div>
            <div><span className="lbl lbl--s">Surprise</span><span className="num">{fig ? <Surprise fig={fig} /> : <Missing reason="surprise : après la publication captée" />}</span></div>
          </div>
          <p className="lbl lbl--s cal-card__meta">
            {ev.time_ms !== null ? `${dayLabel(todayLike(ev))} · ${timeLabel(ev)} Paris` : timeLabel(ev)}
            {ev.official ? ` · heure officielle ${ev.official.local_time} New York (BLS)` : ` · heure ${ev.time_kind} (ForexFactory)`}
            {ev.capture ? ' · capté à la source' : ''}
          </p>
          {fig && (
            <p className="lbl lbl--s cal-card__meta" data-testid="cal-card-capture">
              {`BLS · ${fig.period}${fig.edition === 'Revised' ? ' révisé' : ''} · ${fig.part ?? ''} · ${captureLabel(fig)}`}
              {typeof fig.display_delay_ms === 'number' ? ` · affiché ${fmtDelay(fig.display_delay_ms)}` : ''}
              {fig.timing !== 'attendue' ? ` · publié ${fig.timing}` : ''}
              {fig.forecast_age_ms !== null ? ` · prévision vue ${Math.round(fig.forecast_age_ms / 60_000)} min avant` : ''}
              {revisionText(fig) && <span className="cal-card__rev" data-testid="cal-card-revision">{revisionText(fig)}</span>}
              {fig.excerpt && <span className="cal-card__quote">{isRecalculated(fig) ? fig.excerpt : `« ${fig.excerpt} »`}</span>}
            </p>
          )}
          <div className="placeholder cal-card__hist">
            <span className="placeholder__dash" aria-hidden="true">—</span>
            <span>{ev.capture
              ? 'Publications sur 5 ans et table des publications enregistrées : communiqués archivés du BLS, à l’étape E3.'
              : 'Historique : seulement pour les indicateurs captés à la source.'}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function todayLike(ev: CalendarEvent): string {
  if (ev.time_ms === null) return ev.ny_date;
  return todayParis(ev.time_ms);
}
