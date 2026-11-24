// Écran Taux (plan P2, R3 ; commande FED WIRP ; maquette design/maquettes/png/Taux.png).
// Onglets des 8 banques ; taux actuel (BIS) et prochaine réunion ; trajectoire implicite ;
// probabilités de la prochaine réunion par source ; évolution sur 60 jours avec NFP et IPC ;
// comités et votes. Chaque panneau montre sa source et sa fraîcheur ; « — » avec la raison
// pour ce qu'aucune source ne donne (futures, marché non coté, vote non publié).

import './rates.css';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flagUrl } from '../../components/flags';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Segmented } from '../../components/ui';
import { useSettings } from '../../config/settings';
import { loadRatesHistory, RATES_STATUS_KEY } from '../../data/online/rates';
import { useValue } from '../../data/store';
import { fmtNumber, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm } from '../../lib/time';
import {
  age, BANKS, COMMITTEE, daysTo, FLAG, fmtCountdown, fmtDate, fmtDayMonth, fmtMonthYear, fmtMove, fmtProb, fmtRate, GAP_DISPLAY_THRESHOLD,
  historyKey, mainAlternative, OUTCOME_LABEL, primarySource, QUOTE_STALE_MS, RATES_KEY, rateAxis, seriesPath, shownOutcomes,
  SOURCE_LABEL, SOURCES, voteSummary, type Bank, type BankState, type HistoryReply, type Meeting, type Outcome, type RatesReply,
} from '../../rates/rates';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

const PARIS = 'Europe/Paris';

function BankFlag({ bank }: { bank: Bank }) {
  const url = flagUrl(FLAG[bank]);
  return url ? <img className="rt-flag" src={url} alt="" width={21} height={14} /> : <span className="rt-flag" aria-hidden="true" />;
}

/** Fraîcheur d'un panneau : source, heure de la dernière mise à jour (Paris), « périmé » au-delà du seuil. */
function Fresh({ label, ms, now, staleMs }: { label: string; ms: number | null | undefined; now: number; staleMs: number }) {
  if (!ms) return <Chip small variant="pending" title="aucune donnée reçue">{`${label} · —`}</Chip>;
  const stale = now - ms > staleMs;
  return <Chip small variant={stale ? 'down' : 'neutral'} title={`${age(now - ms)}${stale ? ' · périmé' : ''}`}>
    {`${label} · ${fmtHm(ms, PARIS)}${stale ? ' · périmé' : ''}`}</Chip>;
}

// --- Trajectoire implicite -----------------------------------------------------------------------

function PathPanel({ b, reason }: { b: BankState | undefined; reason: string }) {
  const path = b?.path;
  const pts = path?.points ?? [];
  const title = `Trajectoire implicite · ${pts.length || '—'} réunion${pts.length > 1 ? 's' : ''}`;
  if (!b || !pts.length || path?.base === undefined) {
    return <Panel title={title} label="Trajectoire implicite" style={{ flex: '2 1 600px' }}>
      <div className="rt-empty"><Missing reason={path?.missing ?? reason} /><span>{path?.missing ?? reason}</span></div>
    </Panel>;
  }
  const base = path.base;
  const axis = rateAxis([base, ...pts.map((p) => p.rate)]);
  const y = (r: number) => 100 - ((r - axis.min) / (axis.max - axis.min)) * 100;   // % de la hauteur
  const x = (i: number) => ((i + 0.5) / pts.length) * 100;
  const step = `M0 ${(y(base) * 2).toFixed(1)}` + pts.map((p, i) => `H${(x(i) * 10).toFixed(1)}V${(y(p.rate) * 2).toFixed(1)}`).join('') + 'H1000';
  const maxBp = Math.max(1, ...pts.map((p) => Math.abs(p.delta_bp)));
  const srcLabel = path.source === 'kalshi' ? 'Kalshi · KXFED' : 'Polymarket';
  return (
    <Panel title={title} label="Trajectoire implicite" style={{ flex: '2 1 600px' }}
      chips={<Chip title={`Source : ${srcLabel}. ${path.note ?? ''}. Base : taux actuel ${fmtRate(base)} (BIS)${path.truncated ? ' ; queue basse non couverte par les marchés' : ''}.`}>
        {`Fin de période ${fmtRate(path.end)}`}</Chip>}>
      <div className="rt-path">
        <div className="rt-plot">
          <div className="rt-area rt-area--path">
            <svg viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true">
              <path className="rt-grid" d={axis.ticks.map((t) => `M0 ${(y(t) * 2).toFixed(1)}H1000`).join('')} />
              <path className="rt-base" d={`M0 ${(y(base) * 2).toFixed(1)}H1000`} />
              <path className="rt-step" d={step} />
            </svg>
            {pts.map((p, i) => (
              <span key={p.meeting}>
                <span className="rt-dot" style={{ left: `${x(i)}%`, top: `${y(p.rate)}%` }} />
                <span className={`num rt-dot-label${i % 2 ? ' rt-odd' : ''}`} style={{ left: `${x(i)}%`, top: `${y(p.rate)}%` }}>{fmtNumber(p.rate, 2)}</span>
              </span>
            ))}
          </div>
          <div className="num rt-yaxis">{axis.ticks.map((t) => <span key={t} style={{ top: `${y(t)}%` }}>{fmtRate(t)}</span>)}</div>
        </div>
        <div className="lbl rt-sub">Variation attendue par réunion · pb</div>
        <div className="rt-bars">
          <div className="rt-zero" />
          {pts.map((p, i) => {
            const h = (Math.abs(p.delta_bp) / maxBp) * 48;
            const up = p.delta_bp >= 0;
            return <span key={p.meeting}>
              <span className={`rt-bar ${up ? 'rt-bar--up' : 'rt-bar--dn'}`} style={{ left: `${x(i)}%`, top: up ? 60 - h : 60, height: h }} />
              <span className={`num rt-bar-label ${up ? 'up' : 'dn'}`} style={{ left: `${x(i)}%`, top: up ? 44 - h : 67 + h }}>{fmtSigned(p.delta_bp, 1)}</span>
            </span>;
          })}
        </div>
        <div className="num rt-xaxis">{pts.map((p, i) => <span key={p.meeting} className={i % 2 ? 'rt-odd' : undefined} style={{ left: `${x(i)}%` }}>{fmtMonthYear(p.meeting)}</span>)}</div>
      </div>
    </Panel>
  );
}

// --- Prochaine réunion ---------------------------------------------------------------------------

/** Détail d'une source (infobulle de la légende) : somme, variation attendue, heure, marché. */
function sourceDetail(m: Meeting, s: (typeof SOURCES)[number]): string {
  const blk = m.sources[s];
  if (!blk) return `${SOURCE_LABEL[s]} : source absente`;
  if (blk.missing) return `${SOURCE_LABEL[s]} : — · ${blk.missing}`;
  return `${SOURCE_LABEL[s]} : somme ${fmtProb(blk.total)} %${blk.sum_ok === false ? ' (hors 95–105 %)' : ''} · variation attendue ${fmtMove(blk.expected_bp)}`
    + ` · ${blk.ts_source ? `cotation ${fmtHm(blk.ts_source, PARIS)}` : 'heure de réception'} · ${blk.ref ?? ''}`;
}

function NextPanel({ b, reason, now }: { b: BankState | undefined; reason: string; now: number }) {
  const m = b?.next ?? null;
  const outcomes = shownOutcomes(m);
  const title = b && m ? `${COMMITTEE[b.bank]} · ${fmtDate(m.date)}` : 'Prochaine réunion';
  const max = Math.max(0.0001, ...outcomes.flatMap((o) => SOURCES.map((s) => m?.sources[s]?.probs?.[o]?.p ?? 0)));
  const ts = m ? Math.max(0, ...SOURCES.map((s) => m.sources[s]?.ts_recv ?? 0)) : 0;
  return (
    <Panel title={title} label="Prochaine réunion" controls="none" style={{ flex: '1 1 340px' }}
      chips={<Fresh label="Cotes" ms={ts || null} now={now} staleMs={QUOTE_STALE_MS} />}>
      <div className="rt-next">
        {!m ? <div className="rt-empty"><Missing reason={reason} /><span>{reason}</span></div> : <>
          <div className="rt-next-head">
            {m.gap ? <span className="chip rt-cy" title={`${OUTCOME_LABEL[m.gap.outcome]} : ${SOURCE_LABEL[m.gap.sources[0] as 'polymarket']} contre ${SOURCE_LABEL[m.gap.sources[1] as 'kalshi']}`}>
              {`Écart max ${fmtNumber(m.gap.pts, 1)} pts · seuil ${GAP_DISPLAY_THRESHOLD}`}</span>
              : <Chip title="une seule source cotée : pas d’écart à mesurer">Écart max — · une source</Chip>}
          </div>
          <div className="rt-legend">
            {SOURCES.map((s) => <span key={s} className="lbl" title={sourceDetail(m, s)}><span className={`rt-sw rt-sw--${s}`} />{SOURCE_LABEL[s]}</span>)}
          </div>
          <div className="rt-groups">
            {outcomes.map((o) => (
              <div key={o} className="rt-group" data-outcome={o}>
                <div className="rt-group-bars">
                  {SOURCES.map((s) => {
                    const blk = m.sources[s];
                    const q = blk?.probs?.[o];
                    if (!q || q.p === null) {
                      const why = blk?.missing ?? (blk ? 'issue non cotée' : 'source absente');
                      return <div key={s} className="rt-col"><span className="num rt-val" aria-label={`Indisponible : ${why}`} title={why}>—</span><span className={`rt-colbar rt-sw--${s}`} style={{ height: 0 }} /></div>;
                    }
                    const tip = `${SOURCE_LABEL[s]} · ${OUTCOME_LABEL[o]} : ${fmtProb(q.p)} %${q.wide ? ' · fourchette large, dernier échange' : ` · achat ${fmtProb(q.bid)} / vente ${fmtProb(q.ask)}`}${q.vol24 !== null ? ` · volume 24 h ${fmtNumber(q.vol24, 0)}` : ''}`;
                    return <div key={s} className="rt-col" title={tip}>
                      <span className={`num rt-val${q.wide ? ' rt-wide' : ''}`}>{fmtProb(q.p)}</span>
                      <span className={`rt-colbar rt-sw--${s}`} style={{ height: `${Math.max(0.6, (q.p / max) * 150)}px` }} />
                    </div>;
                  })}
                </div>
                <div className={`rt-group-label ${o === 'hold' ? '' : o.startsWith('m') ? 'dn' : 'up'}`}>{OUTCOME_LABEL[o]}</div>
              </div>
            ))}
          </div>
          <p className="rt-note" title="Polymarket et Kalshi : milieu achat/vente ; au-delà de 10 points d’écart, dernier échange (valeur soulignée). Futures : aucun flux gratuit.">Futures : probabilité implicite = (taux implicite − taux actuel) / 25 pb. Polymarket et Kalshi : prix du contrat « oui », en %. « — » : marché non coté.</p>
        </>}
      </div>
    </Panel>
  );
}

// --- Évolution sur 60 jours ----------------------------------------------------------------------

function HistoryPanel({ b, hist, histErr, now }: { b: BankState | undefined; hist: HistoryReply | undefined; histErr: string | null; now: number }) {
  const m = b?.next ?? null;
  const [pick, setPick] = useState<'polymarket' | 'kalshi' | null>(null);
  const avail = (['polymarket', 'kalshi'] as const).filter((s) => Object.keys(hist?.series[s] ?? {}).length);
  const src = pick && avail.includes(pick) ? pick : avail.includes(primarySource(m) ?? 'polymarket') ? primarySource(m)! : avail[0];
  const alt = mainAlternative(m);
  const lines: [Outcome, string][] = [['hold', 'rt-line--hold'], [alt, 'rt-line--alt']];
  const to = hist?.computed_ms ?? now, from = to - 60 * 86_400_000;
  const series = src ? hist?.series[src] : undefined;
  const lastP = (o: Outcome) => { const s = series?.[o]; return s?.length ? s[s.length - 1].p : null; };
  const title = b && m ? `Évolution des probabilités · ${COMMITTEE[b.bank]} · 60 jours` : 'Évolution des probabilités · 60 jours';
  const ticks = Array.from({ length: 5 }, (_, i) => from + (i * (to - from)) / 4);
  return (
    <Panel title={title} label="Évolution des probabilités" style={{ flex: '2 1 600px' }}
      chips={avail.length > 1 ? <Segmented label="Source de la courbe" value={src!} onChange={(v) => setPick(v)}
        options={avail.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} /> : undefined}>
      <div className="rt-hist">
        {!series ? <div className="rt-empty rt-empty--tall"><Missing reason={histErr ?? (m ? 'historique pas encore relevé (tâche rates-history)' : 'aucune réunion à venir')} />
          <span>{histErr ?? (m ? 'historique pas encore relevé (tâche rates-history)' : 'aucune réunion à venir')}</span></div> : <>
          <div className="rt-legend">
            {lines.map(([o, cls]) => <span key={o} className="lbl"><span className={`rt-ln ${cls}`} />{`${OUTCOME_LABEL[o]} · ${fmtProb(lastP(o))}${NBSP}%`}</span>)}
            <span className="rt-spacer" />
            <span className="lbl rt-gold">{`Données clés · ${SOURCE_LABEL[src!]}`}</span>
          </div>
          <div className="rt-plot">
            <div className="rt-area rt-area--hist">
              <svg viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">
                <path className="rt-grid" d="M0 0H1000M0 55H1000M0 110H1000M0 165H1000" />
                <path className="rt-mark" d={(hist?.markers ?? []).filter((k) => k.t >= from).map((k) => `M${(((k.t - from) / (to - from)) * 1000).toFixed(1)} 0V220`).join('')} />
                {lines.map(([o, cls]) => <path key={o} className={`rt-line ${cls}`} d={seriesPath(series[o] ?? [], from, to, 220)} />)}
              </svg>
              {(hist?.markers ?? []).filter((k) => k.t >= from).map((k, i) => (
                <span key={k.t} className="chip chip--hot rt-marker" style={{ left: `${((k.t - from) / (to - from)) * 100}%`, top: `${42 + (i % 2) * 12}%` }}
                  title={`${k.title} (BLS) · ${fmtDate(k.date)}`}>{`${k.label} ${fmtDayMonth(k.t)}`}</span>
              ))}
            </div>
            <div className="num rt-yaxis rt-yaxis--pct"><span style={{ top: 0 }}>100 %</span><span style={{ top: '50%' }}>50 %</span><span style={{ top: '100%' }}>0 %</span></div>
          </div>
          <div className="num rt-dates">{ticks.map((t) => <span key={t}>{fmtDayMonth(t)}</span>)}</div>
        </>}
      </div>
    </Panel>
  );
}

// --- Comités et votes ----------------------------------------------------------------------------

function CommitteesPanel({ st, bank, now }: { st: RatesReply | undefined; bank: Bank; now: number }) {
  return (
    <Panel title="Comités et votes" label="Comités et votes" controls="none" style={{ flex: '1 1 380px' }}>
      <div className="rt-committees">
        {BANKS.map((k) => {
          const b = st?.state?.banks[k];
          const d = st?.decisions[k];
          const lc = b?.policy.last_change;
          const move = d ? d.change_bp : null;
          const next = b?.next;
          return (
            <div key={k} className={`rt-cm${k === bank ? ' rt-cm--on' : ''}`} data-testid={`cm-${k}`}>
              <div className="rt-cm-top">
                <span className="num rt-cm-bank">{k}</span>
                <BankFlag bank={k} />
                {d ? <span className={`chip rt-move ${move ? (move > 0 ? 'rt-cy' : 'rt-co') : ''}`}>{fmtMove(move)}</span>
                  : <Missing reason="décision pas encore relevée sur la page officielle" />}
                <span className="rt-spacer" />
                <span className="num rt-cm-next">Prochaine <b>{next ? fmtDate(next.date) : '—'}</b></span>
              </div>
              <div className="rt-cm-bottom">
                {d ? <a href={d.source_url} target="_blank" rel="noreferrer" title={d.quote ?? undefined}>{voteSummary(d.vote)}</a>
                  : <span className="rt-muted">{lc ? `Dernier mouvement (BIS) : ${fmtRate(lc.from)} → ${fmtRate(lc.to)}` : '—'}</span>}
                <span className="num rt-cm-date">{d ? `Décision du ${fmtDate(d.decision_date)}` : lc ? `le ${fmtDate(lc.date)}` : ''}</span>
              </div>
            </div>
          );
        })}
        {st?.state && <p className="rt-note rt-cm-note">{`Taux actuels : BIS, relevé ${st.state.banks.FED?.policy.ts_recv ? age(now - st.state.banks.FED.policy.ts_recv) : '—'}. Votes : pages officielles (Fed, BoE) ; BCE, BNS, BoC et RBNZ ne publient pas de vote nominatif.`}</p>}
      </div>
    </Panel>
  );
}

// --- Écran ---------------------------------------------------------------------------------------

export function RatesScreen() {
  const now = useNow();
  const { mode } = useSettings();
  const [params, setParams] = useSearchParams();
  const asked = (params.get('banque') ?? 'FED').toUpperCase();
  const bank: Bank = (BANKS as readonly string[]).includes(asked) ? asked as Bank : 'FED';
  const st = useValue<RatesReply>(RATES_KEY);
  const online = useValue<{ ok: boolean; reason: string | null }>(RATES_STATUS_KEY);
  const b = st?.state?.banks[bank];
  const meeting = b?.next?.date ?? null;
  const hist = useValue<HistoryReply>(meeting ? historyKey(bank, meeting) : '$none');
  const [histErr, setHistErr] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'online' || !meeting) return;
    let alive = true;
    const load = () => loadRatesHistory(bank, meeting).then(() => alive && setHistErr(null),
      (e: Error) => alive && setHistErr(`historique injoignable : ${e.message}`));
    void load();
    const id = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [mode, bank, meeting]);

  const reason = st ? (st.configured ? (st.state ? 'aucune donnée pour cette banque' : 'tâche rates pas encore passée') : `non configuré : ${st.reason ?? ''}`)
    : mode !== 'online' ? 'écran Taux en Mode Online seulement (tâches p2-jobs de Supabase)'
      : online && !online.ok ? online.reason ?? 'injoignable' : 'chargement…';
  const pol = b?.policy;
  const days = b?.next ? daysTo(b.next.date, b.tz, now) : null;
  const stateMs = st?.state?.computed_ms ?? null;
  const gate = st?.gate;

  return (
    <>
      <SubHeader icon="rates" title={`Probabilités de taux · ${bank}`}
        chips={<>
          <Chip variant="hot" round title="Futures : aucun flux gratuit (« — »)">Futures · Polymarket · Kalshi</Chip>
          <Fresh label="Collecte" ms={stateMs} now={now} staleMs={QUOTE_STALE_MS} />
          {gate && <Chip small variant={gate.polymarket >= gate.window_min - 2 ? 'live' : 'neutral'}
            title={`Porte de P2 : une cote par minute pour la prochaine réunion de la Fed (${fmtDate(gate.meeting)})`}>
            {`Fed · ${gate.polymarket} cotes / ${gate.window_min} min`}</Chip>}
        </>} />
      <div className="content rt" data-screen="rates">
        <div className="rt-top">
          <div role="group" aria-label="Banque centrale" className="rt-tabs">
            {BANKS.map((k) => <button key={k} type="button" className="rt-tab" aria-pressed={k === bank}
              onClick={() => setParams(k === 'FED' ? {} : { banque: k }, { replace: true })}>{k}</button>)}
          </div>
          <span className="rt-spacer" />
          <div className="rt-head">
            <div>
              <div className="lbl rt-head-lbl">{`${b?.name ?? bank} · taux actuel`}</div>
              <div className="rt-head-val">
                {pol?.display !== undefined ? <span className="rt-key" title={`${pol.label} · BIS, observation du ${fmtDate(pol.date!)}${pol.basis ? ` · ${pol.basis}` : ''}`}>{fmtRate(pol.display)}</span>
                  : <span className="rt-key"><Missing reason={pol?.missing ?? reason} /></span>}
                <span className="num rt-head-sub">{pol?.range ? `Fourchette ${fmtNumber(pol.range[0], 2)} – ${fmtRate(pol.range[1])}` : pol?.label ?? ''}</span>
              </div>
            </div>
            <span className="chip chip--hot" title={b ? `${b.calendar.source === 'marchés' ? 'date tirée des marchés (page officielle inaccessible)' : 'calendrier officiel'} · ${b.calendar.url}` : undefined}>
              {b?.next ? `Prochaine réunion · ${fmtDate(b.next.date)} · ${fmtCountdown(days!)}${b.calendar.source === 'marchés' ? ' · date marchés' : ''}` : 'Prochaine réunion · —'}
            </span>
          </div>
        </div>
        <div className="rt-row">
          <PathPanel b={b} reason={reason} />
          <NextPanel b={b} reason={reason} now={now} />
        </div>
        <div className="rt-row">
          <HistoryPanel b={b} hist={hist} histErr={mode === 'online' ? histErr : histErr ?? (hist ? null : reason)} now={now} />
          <CommitteesPanel st={st} bank={bank} now={now} />
        </div>
      </div>
    </>
  );
}

