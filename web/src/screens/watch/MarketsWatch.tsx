// Markets Watch (P1, commande WATCH ; T-051, T-052) : watchlist hors crypto détaillée.
// Tiingo toutes les 3 min (change, or, QQQ et SPY), FRED et clôtures de Bourse au quotidien ;
// chaque ligne montre sa source, l'heure de la source et sa fraîcheur ; « — » avec la raison
// pour ce qu'aucune source gratuite ne donne (futures, DXY).

import './watch.css';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Sparkline } from '../../components/ui';
import { useSettings } from '../../config/settings';
import { WATCH_STATUS_KEY } from '../../data/online/watch';
import { useValue } from '../../data/store';
import { direction, fmtNumber, fmtPctChange, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm, zonedParts } from '../../lib/time';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';
import { ASSETS, change, isLate, marketLabel, refLabel, UNAVAILABLE, WATCH_KEY, type WatchState } from '../../watch/watch';

const PARIS = 'Europe/Paris';

function when(ms: number, daily: boolean, now: number): string {
  const p = zonedParts(ms, PARIS);
  const q = zonedParts(now, PARIS);
  const date = `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
  if (daily) return date;
  return p.d === q.d && p.m === q.m ? fmtHm(ms, PARIS) : `${date} ${fmtHm(ms, PARIS)}`;
}

function age(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m}${NBSP}min`;
  const h = Math.round(m / 60);
  return h < 48 ? `il y a ${h}${NBSP}h` : `il y a ${Math.round(h / 24)}${NBSP}j`;
}

export function MarketsWatchScreen() {
  const now = useNow();
  const { mode } = useSettings();
  const st = useValue<WatchState>(WATCH_KEY);
  const online = useValue<{ ok: boolean; reason: string | null }>(WATCH_STATUS_KEY);
  const reason = st ? (st.configured ? null : `non configuré : ${st.reason ?? ''}`)
    : mode !== 'online' ? 'Markets Watch en Mode Online seulement (tâche watch de Supabase)'
      : online && !online.ok ? online.reason ?? 'injoignable' : 'chargement…';
  const withData = st?.assets.filter((a) => a.last).length ?? 0;
  const feedErr = st?.feed?.last_error ?? null;

  return (
    <>
      <SubHeader icon="watch" title="Markets Watch"
        chips={<>
          <Chip variant={withData ? 'live' : 'neutral'}>{`${withData}/${ASSETS.length} actifs avec cours`}</Chip>
          <Chip variant={feedErr ? 'down' : st?.feed ? 'live' : 'neutral'} title={feedErr ?? undefined}>
            {!st?.feed ? 'Collecte · —' : feedErr ? 'Collecte · incident' : 'Collecte · toutes les 3 min'}
          </Chip>
        </>} />
      <div className="content" data-screen="watch">
        <div className="mw-grid">
          <Panel title="Watchlist hors crypto" controls="none">
            <table className="mw-table">
              <thead><tr className="lbl lbl--s">
                <th>Actif</th><th className="r">Dernier</th><th className="r">Variation</th><th className="r hide-s">Plage 24 h</th>
                <th className="hide-s">Séance</th><th className="r hide-xs">Marché</th>
              </tr></thead>
              <tbody>
                {ASSETS.map((def) => {
                  const a = st?.assets.find((x) => x.asset === def.id);
                  const ch = change(def, a);
                  const late = isLate(def, a, now);
                  const m = marketLabel(def.market, now);
                  const prices = a?.series.map((p) => p.price) ?? [];
                  const daily = def.market === 'daily' || def.market === 'paris';
                  return (
                    <tr key={def.id} data-testid={`mw-${def.id}`}>
                      <td><span className="mw-asset" title={def.note}><b>{def.name}</b><span className="lbl lbl--s">{`${def.sub} · ${def.source}`}</span></span></td>
                      <td className="r num">
                        {a?.last ? <>
                          <span className={`mw-last${late ? ' mw-late' : ''}`}>{fmtNumber(a.last.price, def.decimals)}{def.unit ? `${NBSP}${def.unit}` : ''}</span>
                          <span className="lbl lbl--s mw-sub" title={`${age(now - a.last.ts_source)} · reçu à ${fmtHm(a.last.ts_recv, PARIS)} (Paris)`}>
                            {`${when(a.last.ts_source, daily, now)}${late ? ' · en retard' : ''}`}
                          </span>
                        </> : <Missing reason={reason ?? 'aucun cours reçu pour cet actif'} />}
                      </td>
                      <td className="r num">
                        {ch === null ? <Missing reason={a?.last ? refLabel(a) : reason ?? 'aucun cours'} />
                          : <span className={direction(ch)} title={refLabel(a)}>{def.change === 'bp' ? `${fmtSigned(ch, 1)}${NBSP}pb` : fmtPctChange(ch)}</span>}
                        {a?.ref && <span className="lbl lbl--s mw-sub">{a.ref.kind === '24h' ? 'sur 24 h' : 'veille'}</span>}
                      </td>
                      <td className="r num mw-range hide-s">
                        {prices.length > 1 ? `${fmtNumber(Math.min(...prices), def.decimals)} – ${fmtNumber(Math.max(...prices), def.decimals)}` : '—'}
                      </td>
                      <td className="hide-s">{prices.length > 1 ? <Sparkline values={prices} width={150} /> : <Missing reason="série trop courte" />}</td>
                      <td className="r hide-xs"><Chip small variant={m.open ? 'live' : 'neutral'}>{m.text}</Chip></td>
                    </tr>
                  );
                })}
                {UNAVAILABLE.map((u) => (
                  <tr key={u.name} className="mw-off">
                    <td><span className="mw-asset"><b>{u.name}</b><span className="lbl lbl--s">{`${u.sub} · ${u.reason}`}</span></span></td>
                    <td className="r"><Missing reason={u.reason} /></td>
                    <td className="r"><Missing reason={u.reason} /></td>
                    <td className="r hide-s">—</td><td className="hide-s" /><td className="r hide-xs" />
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Sources et limites" controls="none">
            <ul className="mw-notes">
              <li><b>Tiingo</b> (offre gratuite, usage personnel) : change et or du dimanche 23:00 au vendredi 23:00 (Paris), QQQ et SPY de 10:00 à 02:00 en semaine ; relevés toutes les 3 min (40 requêtes par heure sur 50).</li>
              <li><b>QQQ et SPY</b> : prix de référence IEX des deux ETF, substituts du Nasdaq 100 et du S&amp;P 500, pas les futures.</li>
              <li><b>FRED</b> : rendement US 10 ans et indice large du dollar de la Fed, quotidiens, publiés avec un à plusieurs jours de retard ; ce n’est pas le DXY (T-052).</li>
              <li><b>ETF du PEA</b> : clôtures relevées chaque soir par le module Bourse (Alpha Vantage).</li>
              {feedErr && <li className="cal-warn">Dernier incident de collecte : {feedErr}</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
