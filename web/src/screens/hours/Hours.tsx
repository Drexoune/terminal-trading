// Horaires des marchés (P1, commande HOURS) : séances du jour sur 24 h à l'heure de Paris,
// état de chaque place (ouvert, pause, fermé, férié, week-end) avec le compte à rebours du
// prochain changement, et prochaines fermetures. Données relevées sur les pages officielles
// (src/hours/exchanges.ts) ; une place sans jours fériés relevés le dit.

import './hours.css';
import { Panel } from '../../components/Panel';
import { Chip } from '../../components/ui';
import { countdown, EXCHANGES, marketStatus, sessionsOn, upcomingClosures, type Exchange, type MarketState } from '../../hours/exchanges';
import { fmtHm, tzOffsetMs, zonedParts, zonedToUtc } from '../../lib/time';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';

const PARIS = 'Europe/Paris';
const DAY = 86_400_000;

const STATE_LABEL: Record<MarketState, string> = {
  ouvert: 'Ouvert', pause: 'Pause', fermé: 'Fermé', férié: 'Férié', 'week-end': 'Week-end', continu: 'En continu',
};
const STATE_CHIP: Record<MarketState, 'live' | 'neutral' | 'pending' | 'down'> = {
  ouvert: 'live', continu: 'live', pause: 'pending', fermé: 'neutral', férié: 'down', 'week-end': 'neutral',
};

const day = (ms: number, tz: string) => { const p = zonedParts(ms, tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Séances d'une place qui tombent dans la journée de Paris [from, to[, découpées à ses bornes. */
function barsFor(ex: Exchange, from: number, to: number): [number, number][] {
  if (!ex.sessions.length) return [[from, to]];
  const out: [number, number][] = [];
  const local = day(from, ex.tz);
  for (const d of [shift(local, -1), local, shift(local, 1)]) {
    for (const [a, b] of sessionsOn(ex, d)) if (b > from && a < to) out.push([Math.max(a, from), Math.min(b, to)]);
  }
  return out;
}

function sessionText(ex: Exchange): string {
  if (!ex.sessions.length) return '24 h/24';
  return ex.sessions.map(([a, b]) => `${a}–${b}`).join(', ');
}

function parisText(ex: Exchange, now: number): string {
  if (!ex.sessions.length) return '24 h/24';
  const s = sessionsOn(ex, day(now, ex.tz));
  const ref = s.length ? s : (() => {
    for (let i = 1; i < 10; i++) { const n = sessionsOn(ex, shift(day(now, ex.tz), i)); if (n.length) return n; }
    return [];
  })();
  return ref.length ? ref.map(([a, b]) => `${fmtHm(a, PARIS)}–${fmtHm(b, PARIS)}`).join(', ') : '—';
}

export function HoursScreen() {
  const now = useNow();
  const p = zonedParts(now, PARIS);
  const from = zonedToUtc(p.y, p.m, p.d, '00:00', PARIS);
  const to = from + DAY + (tzOffsetMs(from, PARIS) - tzOffsetMs(from + DAY, PARIS));
  const pct = (t: number) => `${((t - from) / (to - from)) * 100}%`;
  const rows = EXCHANGES.map((ex) => ({ ex, st: marketStatus(ex, now) }));
  const open = rows.filter((r) => r.st.state === 'ouvert').length;
  const closures = upcomingClosures(now, 10);
  const offset = tzOffsetMs(now, PARIS) / 3_600_000;

  return (
    <>
      <SubHeader icon="hours" title="Horaires des marchés"
        chips={<>
          <Chip variant={open ? 'live' : 'neutral'}>{`${open} place${open > 1 ? 's' : ''} ouverte${open > 1 ? 's' : ''} sur ${EXCHANGES.length - 1}`}</Chip>
          <Chip>{`Heure de Paris · UTC+${offset}`}</Chip>
        </>} />
      <div className="content" data-screen="hours">
        <div className="hours-grid">
          <div className="hours-main">
            <Panel title="Séances du jour · heure de Paris" controls="none" chips={<Chip>{fmtDay(day(now, PARIS))}</Chip>}>
              <div className="hours-tl" role="img" aria-label="Séances du jour sur 24 heures, heure de Paris">
                {rows.map(({ ex, st }) => {
                  const bars = barsFor(ex, from, to);
                  return (
                    <div className="hours-tl__row" key={ex.code}>
                      <span className="hours-tl__name">{ex.name}</span>
                      <span className="hours-tl__track">
                        {bars.map(([a, b]) => (
                          <span key={a} className={`hours-tl__bar${!ex.sessions.length ? ' hours-tl__bar--continu' : ''}${now >= a && now < b ? ' is-open' : ''}`}
                            style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} title={`${fmtHm(a, PARIS)}–${fmtHm(b, PARIS)} (Paris)`} />
                        ))}
                        {!bars.length && (() => {
                          // Jour local de la place qui recouvre la journée de Paris (Tokyo : le jour d'avant à minuit).
                          const h = ex.holidays?.[day(from + DAY / 2, ex.tz)] ?? st.holiday;
                          return <span className="hours-tl__off">{h ? `fermé · ${h}` : 'fermé'}</span>;
                        })()}
                        <span className="hours-tl__now" style={{ left: pct(now) }} aria-hidden="true" />
                      </span>
                    </div>
                  );
                })}
                <div className="hours-tl__axis num" aria-hidden="true">
                  {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{`${String(h).padStart(2, '0')}:00`}</span>)}
                </div>
              </div>
            </Panel>

            <Panel title="Places" controls="none">
              <table className="hours-table">
                <thead><tr className="lbl lbl--s">
                  <th>Place</th><th className="hide-s">Heure locale</th><th className="hide-xs">Séance · locale / Paris</th><th>État</th><th className="r">Prochain changement</th>
                </tr></thead>
                <tbody>
                  {rows.map(({ ex, st }) => (
                    <tr key={ex.code} data-testid={`hours-${ex.code}`}>
                      <td><span className="hours-place"><b>{ex.name}</b><span className="lbl lbl--s">{ex.venue}</span></span></td>
                      <td className="num hide-s">{fmtHm(now, ex.tz)}</td>
                      <td className="num hide-xs hours-sess" title={ex.note}>
                        {sessionText(ex)}{ex.sessions.length > 0 && <span className="lbl lbl--s">{`${parisText(ex, now)} Paris`}</span>}
                      </td>
                      <td>
                        <Chip small variant={STATE_CHIP[st.state]} title={st.holiday ?? undefined}>{STATE_LABEL[st.state]}</Chip>
                        {st.early && <span className="lbl lbl--s" style={{ display: 'block', marginTop: 4 }}>
                          {st.earlyTimeKnown ? `séance écourtée à ${ex.early[day(now, ex.tz)]}` : 'séance écourtée · heure non relevée'}</span>}
                      </td>
                      <td className="r num hours-next">
                        {st.next ? `${st.next.kind === 'ouverture' ? 'Ouvre' : 'Ferme'} dans ${countdown(st.next.at - now)}` : '—'}
                        {st.next && <span className="lbl lbl--s" style={{ display: 'block' }}>{`${fmtDay(day(st.next.at, PARIS))} · ${fmtHm(st.next.at, PARIS)} Paris`}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>

          <Panel title="Prochaines fermetures" controls="none" chips={<Chip>{`${closures.length}`}</Chip>}>
            <ul className="hours-closures">
              {closures.map((c) => (
                <li key={`${c.code}-${c.day}-${c.kind}`}>
                  <span className="num">{fmtDay(c.day)}</span>
                  <span><b>{c.name}</b> · {c.kind === 'férié' ? 'fermé' : 'séance écourtée'}<span className="lbl lbl--s" style={{ display: 'block' }}>{c.label}</span></span>
                </li>
              ))}
            </ul>
            <p className="lbl lbl--s hours-src">
              Jours fériés relevés le 23/11/2026 sur les pages officielles (JPX, ASX, LSE, Euronext, NYSE). Hong Kong : non relevés,
              l’état ne tient compte que des week-ends.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
