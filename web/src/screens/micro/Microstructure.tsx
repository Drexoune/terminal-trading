// Microstructure BTC (P5, S3 ; commande BTC BOOK ; maquette design/maquettes/png/Microstructure.png).
// Carte de profondeur 60 min, carnet agrégé des perpétuels, CVD spot contre perpétuel 4 h,
// liquidations de l'heure, funding et open interest, journal des flux. Tout vient du worker de
// la microstructure (micro/micro.worker.ts, T-065) : WebSockets publiques et REST des plateformes.
// Chaque panneau affiche sa source et sa fraîcheur ; « — » avec la raison pour ce qui manque.

import './micro.css';
import { useEffect, useMemo } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing } from '../../components/ui';
import { useKeys, useValue } from '../../data/store';
import { fmtNumber, fmtPctChange, fmtSigned, fmtUsdCompact, NBSP } from '../../lib/format';
import { fmtHm, fmtHms } from '../../lib/time';
import type { AggBook, AggLevel } from '../../micro/aggBook';
import { startMicro, useBrowserNow, type BrowserSource } from '../../micro/client';
import type { CvdState } from '../../micro/cvd';
import type { DepthState } from '../../micro/depth';
import type { RestState } from '../../micro/engine';
import type { FundingState } from '../../micro/funding';
import { FLOOR_NOTE, LIQ_BIG_USD, type LiqState } from '../../micro/liqs';
import type { MicroFeedState } from '../../micro/stream';
import { VENUE_LABEL, type Venue } from '../../micro/types';
import { countdown, FRESH_LABEL, microFreshness, PANEL_FEEDS, panelFresh, priceTicks } from '../../micro/view';
import { SubHeader } from '../../shell/SubHeader';
import { DepthCanvas } from './DepthCanvas';

type Feeds = Map<string, MicroFeedState>;
type Book = AggBook & { last: { px: number; ts: number; venue: Venue } | null };

function Fresh({ names, feeds, now, extra }: { names: readonly string[]; feeds: Feeds; now: number; extra?: string }) {
  const f = panelFresh(names, feeds, now);
  const cls = f.state === 'live' ? 'chip--live' : f.state === 'late' ? 'chip--hot' : 'chip--down';
  return <span className={`chip chip--s ${cls} mc-fresh`} data-fresh data-state={f.state} title={f.title}>{f.text}{extra ? ` · ${extra}` : ''}</span>;
}

function Empty({ reason }: { reason: string }) {
  return <div className="mc-empty"><Missing reason={reason} /><span>{reason}</span></div>;
}

// --- Carte de profondeur ---------------------------------------------------------------------

function DepthPanel({ d, feeds, now }: { d: DepthState | undefined; feeds: Feeds; now: number }) {
  const ready = d && d.columns.length > 0;
  const cov = d?.coverage.map((c) => `${VENUE_LABEL[c.venue]} −${fmtNumber(c.down, 0)}/+${fmtNumber(c.up, 0)}${NBSP}$`).join(' · ');
  return (
    <Panel title="Carte de profondeur · 60 min" label="Carte de profondeur" style={{ flex: '2 1 600px' }}
      chips={<Chip>{d?.step ? `Pas ${fmtNumber(d.step, 0)}${NBSP}$ · ${Math.round(d.column_ms / 1000)}${NBSP}s` : 'Pas —'}</Chip>}>
      <div className="mc-body">
        {ready ? <DepthCanvas d={d} now={now} height={430} />
          : <div className="mc-map-wait" style={{ height: 430 }}><Empty reason="la carte se remplit depuis l’ouverture du terminal (une colonne toutes les 40 s, aucun historique stocké)" /></div>}
        <div className="mc-legend">
          <span className="lbl lbl--s">Liquidité au repos</span>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="num mc-key"><span className={`mc-sw mc-sw--${i}`} />
              {d && d.levels[i - 1] ? (i < 4 ? `${fmtNumber(d.levels[i - 1], 0)}–${fmtNumber(d.levels[i], 0)}` : `>${NBSP}${fmtNumber(d.levels[3], 0)}`) : '—'}{i === 1 ? `${NBSP}BTC` : ''}</span>
          ))}
          <span className="spacer" />
          <span className="num mc-key"><span className="mc-dot mc-dot--up" />Achats agressifs</span>
          <span className="num mc-key"><span className="mc-dot mc-dot--dn" />Ventes agressives</span>
        </div>
        <div className="lbl lbl--s mc-src">
          <Fresh names={PANEL_FEEDS.depth} feeds={feeds} now={now} />
          <span>Carnets des 4 perpétuels, chacun sur sa portée{cov ? ` : ${cov}` : ''} · OKX au-delà de ±0,09 % par books-full (40 s) · niveaux = centiles 50/80/93/98 de la carte · mur retiré = baisse observée du carnet, jamais un stop supposé</span>
        </div>
      </div>
    </Panel>
  );
}

// --- Carnet agrégé ---------------------------------------------------------------------------

function Ladder({ levels, side, max }: { levels: AggLevel[]; side: 'bid' | 'ask'; max: number }) {
  const rows = side === 'ask' ? [...levels].reverse() : levels;
  return <>{rows.map((l) => (
    <div key={l.px} className={`mc-lad${l.sz >= max * 0.999 ? ' mc-lad--max' : ''}`} title={Object.entries(l.venues).map(([v, s]) => `${VENUE_LABEL[v as Venue]} ${fmtNumber(s, 2)}`).join(' · ')}>
      <span className={`mc-bar mc-bar--${side}`} style={{ width: `${(l.sz / max) * 100}%` }} />
      <span className={side === 'ask' ? 'dn' : 'up'}>{fmtNumber(l.px, 0)}</span>
      <span className="r t1">{fmtNumber(l.sz, 2)}</span>
      <span className="r t3">{fmtNumber(l.cum, 1)}</span>
    </div>
  ))}</>;
}

function BookPanel({ b, feeds, now }: { b: Book | undefined; feeds: Feeds; now: number }) {
  const ok = b && b.bids.length && b.asks.length;
  const max = ok ? Math.max(...b.bids.map((l) => l.sz), ...b.asks.map((l) => l.sz)) : 1;
  const imb = b?.imbalance ?? null;
  return (
    <Panel title="Carnet d’ordres · agrégé" label="Carnet d’ordres" controls="none" style={{ flex: '1 1 300px' }}
      chips={<Chip>{`Pas ${b?.step ?? 10}${NBSP}$`}</Chip>}>
      <div className="mc-lad lbl mc-lad--head"><span>Prix</span><span className="r">Taille BTC</span><span className="r">Cumul</span></div>
      {ok ? <>
        <Ladder levels={b.asks} side="ask" max={max} />
        <div className="mc-mid">
          <span className="mc-mid-px" data-testid="mc-last">{b.last ? fmtNumber(b.last.px, 1) : '—'}</span>
          <span className="num mc-mid-sp" title={b.crossed ? 'Meilleur achat d’une plateforme au-dessus de la meilleure vente d’une autre : écart de prix entre plateformes.' : undefined}>
            {b.spread === null ? 'Spread —' : b.crossed ? `Croisés ${fmtSigned(b.spread, 1)}${NBSP}$` : `Spread ${fmtNumber(b.spread, 1)}${NBSP}$`}</span>
        </div>
        <Ladder levels={b.bids} side="bid" max={max} />
      </> : <Empty reason={b?.missing.length ? `carnets : ${b.missing.map((m) => `${VENUE_LABEL[m.venue]} ${m.reason}`).join(', ')}` : 'connexion aux carnets…'} />}
      <div className="num mc-imb">
        <span>Déséquilibre · 10 niveaux</span>
        {imb === null ? <Missing reason="carnet vide" />
          : <span className={imb >= 0 ? 'up' : 'dn'}>{`${fmtNumber(Math.abs(imb) * 100, 1)}${NBSP}% côté ${imb >= 0 ? 'acheteur' : 'vendeur'}`}</span>}
      </div>
      <div className="lbl lbl--s mc-src">
        <Fresh names={PANEL_FEEDS.book} feeds={feeds} now={now} />
        <span>{b ? `Carnets : ${b.venues.map((v) => VENUE_LABEL[v]).join(', ') || '—'}${b.missing.length ? ` · absents : ${b.missing.map((m) => `${VENUE_LABEL[m.venue]} (${m.reason})`).join(', ')}` : ''}` : ''}</span>
      </div>
    </Panel>
  );
}

// --- CVD -------------------------------------------------------------------------------------

const btc = (x: number | null) => (x === null ? '—' : `${fmtSigned(x, 0)}${NBSP}BTC`);

function CvdPanel({ c, feeds, now, rest }: { c: CvdState | undefined; feeds: Feeds; now: number; rest: RestState[] }) {
  const H = 200;
  const chart = useMemo(() => {
    if (!c?.ready) return null;
    const all = [...c.series.perp, ...c.series.spot, 0];
    let lo = Math.min(...all), hi = Math.max(...all);
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const n = c.series.t.length;
    const path = (v: number[]) => v.map((y, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * 1000).toFixed(1)} ${(((hi - y) / (hi - lo)) * H).toFixed(1)}`).join('');
    return { lo, hi, perp: path(c.series.perp), spot: path(c.series.spot), zero: ((hi - 0) / (hi - lo)) * H, ticks: priceTicks(lo, hi, 2) };
  }, [c]);
  const errs = rest.filter((r) => r.name.startsWith('cvd-') && r.ok === false);
  const oldHoles = (c?.holes ?? []).filter((h) => h.to < now - 15 * 60_000);
  return (
    <Panel title="CVD · spot vs perpétuel · 4 h" label="CVD spot et perpétuel" style={{ flex: '2 1 600px' }}
      chips={c?.divergence ? <Chip variant="hot">Divergence</Chip> : <Chip>{c?.ready ? 'Pas de divergence' : 'Rattrapage…'}</Chip>}>
      <div className="mc-body">
        <div className="mc-cvd-legend">
          <span className="lbl lbl--s"><span className="mc-ln mc-ln--perp" />Perpétuel · <span className={c?.perp != null && c.perp >= 0 ? 'up' : 'dn'}>{btc(c?.perp ?? null)}</span></span>
          <span className="lbl lbl--s"><span className="mc-ln mc-ln--spot" />Spot · <span className={c?.spot != null && c.spot >= 0 ? 'up' : 'dn'}>{btc(c?.spot ?? null)}</span></span>
        </div>
        {chart && c ? <>
          <div className="mc-cvd-row">
            <div className="mc-cvd" style={{ height: H }}>
              <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" aria-hidden="true">
                <path className="mc-zero" d={`M0 ${chart.zero.toFixed(1)}H1000`} />
                <path className="mc-cvd-perp" d={chart.perp} />
                <path className="mc-cvd-spot" d={chart.spot} />
              </svg>
            </div>
            <div className="num mc-yaxis">
              {chart.ticks.map((v) => <span key={v} style={{ top: `${((chart.hi - v) / (chart.hi - chart.lo)) * 100}%` }}>{fmtSigned(v, 0)}</span>)}
            </div>
          </div>
          <div className="num mc-xaxis mc-xaxis--cvd">{[0, 60, 120, 180, 239].map((i) => <span key={i}>{fmtHm(c.series.t[i], 'Europe/Paris')}</span>)}</div>
          <p className="mc-read" data-testid="mc-cvd-sentence">{c.sentence}</p>
        </> : <Empty reason={errs.length ? `rattrapage impossible : ${errs.map((e) => `${e.label} (${e.error})`).join(', ')}` : 'rattrapage des 4 dernières heures en cours (bougies 1 min de Binance, statistique 5 min d’OKX)'} />}
        <div className="lbl lbl--s mc-src">
          <Fresh names={PANEL_FEEDS.cvd} feeds={feeds} now={now} />
          <span>{`Courbes : perp ${c?.perp_venues.map((v) => VENUE_LABEL[v]).join(' + ') || '—'}, spot ${c?.spot_venues.map((v) => VENUE_LABEL[v]).join(' + ') || '—'} (OKX spot : statistique 5 min, différée) · hors courbes, depuis l’ouverture : ${c?.others.length ? c.others.map((o) => `${VENUE_LABEL[o.venue]} ${o.market} ${btc(o.delta)}`).join(', ') : '—'}`}
            {oldHoles.length ? ` · trous non rattrapés : ${oldHoles.map((h) => `${h.id} ${fmtHm(h.from, 'Europe/Paris')}–${fmtHm(h.to, 'Europe/Paris')}`).join(', ')}` : ''}
            {' · divergence : signes opposés, ≥ 2 % du volume preneur de chaque marché'}</span>
        </div>
      </div>
    </Panel>
  );
}

// --- Liquidations ----------------------------------------------------------------------------

function LiqPanel({ l, feeds, now }: { l: LiqState | undefined; feeds: Feeds; now: number }) {
  const since = (l?.by_venue ?? []).filter((v) => !v.reason).map((v) => `${VENUE_LABEL[v.venue]} ${v.since ? `depuis ${fmtHm(v.since, 'Europe/Paris')}` : 'pas encore suivi'}`).join(' · ');
  return (
    <Panel title="Liquidations" label="Liquidations" controls="none" style={{ flex: '1 1 340px' }}
      chips={<>
        <span className="chip chip--down" title="Positions longues liquidées sur l’heure (minimum : Binance et OKX plafonnés)">{`Longs ${l ? fmtUsdCompact(l.long_usd) : '—'}`}</span>
        <span className="chip chip--live mc-chip-end" title="Positions courtes liquidées sur l’heure">{`Shorts ${l ? fmtUsdCompact(l.short_usd) : '—'}`}</span>
      </>}>
      <div className="mc-liqs">
        {l?.rows.length ? l.rows.map((r, i) => (
          <div key={`${r.venue}${r.ts}${r.px}${r.sz}${i}`} className={`mc-lq${r.big ? ' mc-lq--big' : ''}`}>
            <span className="num t3">{fmtHm(r.ts, 'Europe/Paris')}</span>
            <span className="t1">{VENUE_LABEL[r.venue]}</span>
            <span className={`chip chip--s ${r.side === 'long' ? 'chip--down' : 'chip--live'}`}>{r.side === 'long' ? 'Long' : 'Short'}</span>
            <span className={`num r mc-lq-usd ${r.side === 'long' ? 'dn' : 'up'}`}>{fmtUsdCompact(r.usd)}</span>
            <span className="num r t2">{fmtNumber(r.px, 0)}</span>
          </div>
        )) : <Empty reason={l ? 'aucune liquidation observée sur l’heure' : 'connexion aux flux de liquidations…'} />}
      </div>
      <p className="mc-note">{`${FLOOR_NOTE} Lignes ≥ ${fmtUsdCompact(LIQ_BIG_USD)} surlignées.`}</p>
      <div className="lbl lbl--s mc-src"><Fresh names={PANEL_FEEDS.liqs} feeds={feeds} now={now} /><span>{`Observé : ${since || '—'} · OKX rattrapé par www.okx.com (100 dernières)`}</span></div>
    </Panel>
  );
}

// --- Funding et OI ---------------------------------------------------------------------------

function FundingPanel({ f, feeds, now }: { f: (FundingState & { ts: number }) | undefined; feeds: Feeds; now: number }) {
  const dir = (x: number | null) => (x === null ? '' : x >= 0 ? 'up' : 'dn');
  return (
    <Panel title="Funding et open interest · BTC perpétuel" label="Funding et open interest">
      <div className="mc-scroll"><div className="mc-fd-inner">
        <div className="mc-fd lbl mc-fd--head"><span>Plateforme</span><span className="r">Funding · équiv. 8 h</span><span className="r">Prochain</span><span className="r">Open interest</span><span className="r">OI 24 h (BTC)</span><span className="r">Prime perp / spot</span></div>
        {(f?.rows ?? []).map((r) => (
          <div key={r.venue} className="mc-fd mc-fd--row" data-testid={`mc-fd-${r.venue}`}>
            <span className="mc-fd-name">{VENUE_LABEL[r.venue]} {r.interval_h !== null && r.interval_h !== 8 && <span className="lbl">{r.interval_h === 1 ? 'horaire' : `${r.interval_h} h`}</span>}</span>
            <span className={`num r ${dir(r.rate_8h)}`}>{r.rate_8h === null ? <Missing reason="funding pas encore reçu" /> : fmtPctChange(r.rate_8h, 4)}</span>
            <span className="num r t2">{countdown(r.next_ms, now)}</span>
            <span className="num r t1" title={r.oi_btc !== null ? `${fmtNumber(r.oi_btc, 0)} BTC` : undefined}>{r.oi_usd === null ? <Missing reason="OI pas encore reçu" /> : fmtUsdCompact(r.oi_usd)}</span>
            <span className={`num r ${dir(r.oi_24h)}`}>{r.oi_24h === null ? <span title={r.oi_24h_reason ?? ''}><Missing reason={r.oi_24h_reason ?? 'absent'} /></span> : fmtPctChange(r.oi_24h, 1)}</span>
            <span className="num r t1">{r.premium === null ? <Missing reason="marque ou indice absent" /> : fmtPctChange(r.premium, 3)}</span>
          </div>
        ))}
        {f && <div className="mc-fd mc-fd--row mc-fd--total">
          <span className="mc-fd-name mc-gold">Total <span className="lbl">{`${f.total.venues.length} plateforme${f.total.venues.length > 1 ? 's' : ''}`}</span></span>
          <span className={`num r ${dir(f.total.rate_8h)}`} title="Moyenne pondérée par l’OI en dollars">{fmtPctChange(f.total.rate_8h, 4)}</span>
          <span className="num r t2">—</span>
          <span className="num r t1">{fmtUsdCompact(f.total.oi_usd)}</span>
          <span className={`num r ${dir(f.total.oi_24h)}`} title={`Sur ${f.total.oi_24h_venues.map((v) => VENUE_LABEL[v]).join(', ') || '—'} (Hyperliquid : aucun historique public)`}>{fmtPctChange(f.total.oi_24h, 1)}</span>
          <span className="num r t1" title="Moyenne pondérée par l’OI en dollars">{fmtPctChange(f.total.premium, 3)}</span>
        </div>}
      </div></div>
      <div className="lbl lbl--s mc-src">
        <Fresh names={PANEL_FEEDS.funding} feeds={feeds} now={now} />
        <span>Funding ramené à 8 h (Hyperliquid paie toutes les heures : × 8) · OI 24 h en BTC, sans effet de prix (historique horaire de Binance, Bybit, OKX www ; Hyperliquid : aucun) · prime = marque / indice − 1 (Hyperliquid : oracle) · total pondéré par l’OI</span>
      </div>
    </Panel>
  );
}

// --- Source (T-069) ---------------------------------------------------------------------------

/** État publié par la machine Oracle (server/micro/main.ts, SourceState). */
interface ServerSource { kind: 'server'; host: string; started_ms: number; restored_from: number | null; down: { from: number; to: number } | null; saved_at: number | null; sys_mem_pct: number; rss_mb: number; clients: number }
type Source = ServerSource | BrowserSource;

function SourceChip({ src }: { src: Source | undefined }) {
  if (!src) return <Chip>Source —</Chip>;
  if (src.kind === 'server') {
    const t = `Moteur sur la machine ${src.host}, 24 h/24 (T-069) · démarré ${fmtHms(src.started_ms, 'Europe/Paris')}${src.restored_from ? ` (état relu de ${fmtHms(src.restored_from, 'Europe/Paris')})` : ''} · mémoire système ${fmtNumber(src.sys_mem_pct, 0)}${NBSP}% · ${src.clients} écran(s)`;
    return <span className="chip chip--live" data-source="server" title={t}>{`Serveur ${src.host} · 24${NBSP}h/24`}</span>;
  }
  return src.server
    ? <span className="chip chip--hot" data-source="browser" title={`Moteur du navigateur depuis ${fmtHms(src.since, 'Europe/Paris')} : ${src.reason ?? ''}. Nouvel essai du serveur toutes les 30 s.`}>Navigateur · serveur injoignable</span>
    : <span className="chip" data-source="browser" title="Moteur du navigateur : l’historique repart de l’ouverture de l’écran">Navigateur</span>;
}

// --- Journal des flux ------------------------------------------------------------------------

function Journal({ feeds, rest, now, src }: { feeds: Feeds; rest: RestState[]; now: number; src: Source | undefined }) {
  const rows = [...feeds.values()].sort((a, b) => a.label!.localeCompare(b.label!));
  const events = rows.flatMap((f) => [
    ...f.outages.map((o) => ({ t: o.from_ms, feed: f.label!, text: `coupure de ${Math.max(1, Math.round(o.duration_ms / 1000))} s, reprise à ${fmtHms(o.to_ms, 'Europe/Paris')}` })),
    ...f.gaps.map((g) => ({ t: g.at_ms, feed: f.label!, text: g.text })),
    ...(f.status !== 'connected' && f.last_error ? [{ t: now, feed: f.label!, text: `coupé : ${f.last_error}` }] : []),
  ]).concat(src?.kind === 'server' && src.down ? [{ t: src.down.from, feed: `Serveur ${src.host}`, text: `service arrêté, repris à ${fmtHms(src.down.to, 'Europe/Paris')} (état sauvegardé relu)` }]
    : src?.kind === 'browser' && src.reason ? [{ t: src.since, feed: 'Source', text: `${src.reason} : moteur du navigateur` }] : [])
    .sort((a, b) => b.t - a.t).slice(0, 30);
  const restErr = rest.filter((r) => r.ok === false);
  return (
    <Panel title="Journal des flux · coupures et trous" label="Journal des flux" controls="none">
      <div className="mc-journal">
        <div className="mc-jr-feeds">
          {rows.map((f) => {
            const st = microFreshness(f, now);
            return <span key={f.name} className="num mc-jr-feed" data-feed={f.name} data-state={st}>
              <span className={`dot dot--${st === 'live' ? 'up' : st === 'late' ? 'gold' : 'down'}`} />{`${f.label} · ${FRESH_LABEL[st]} · ${f.reconnects} reconnexion(s)`}</span>;
          })}
          {restErr.map((r) => <span key={r.name} className="num mc-jr-feed" data-state="down"><span className="dot dot--down" />{`${r.label} · REST en échec : ${r.error}`}</span>)}
        </div>
        {events.length ? <ul className="mc-jr-list">{events.map((e, i) => (
          <li key={i} className="num"><span className="t3">{fmtHms(e.t, 'Europe/Paris')}</span><span className="t1">{e.feed}</span><span>{e.text}</span></li>
        ))}</ul> : <div className="mc-empty"><span>Aucune coupure ni trou depuis l’ouverture du terminal.</span></div>}
      </div>
    </Panel>
  );
}

// --- Écran -----------------------------------------------------------------------------------

export function MicrostructureScreen() {
  useEffect(() => { startMicro(); }, []);
  const now = useBrowserNow();
  const feedList = useKeys<MicroFeedState>('micro:feed:');
  const feeds = useMemo(() => new Map(feedList.map(([, f]) => [f.name, f])), [feedList]);
  const book = useValue<Book>('micro:book');
  const depth = useValue<DepthState>('micro:depth');
  const cvd = useValue<CvdState>('micro:cvd');
  const liqs = useValue<LiqState>('micro:liqs');
  const funding = useValue<FundingState & { ts: number }>('micro:funding');
  const rest = useValue<RestState[]>('micro:rest') ?? [];
  const src = useValue<Source>('micro:source');
  return (
    <>
      <SubHeader icon="micro" title="Microstructure BTC · BTC-USDT perpétuel"
        chips={<>
          <Chip variant="hot" round>OKX · Binance · Bybit · Hyperliquid</Chip>
          <SourceChip src={src} />
          <Fresh names={[...new Set(Object.values(PANEL_FEEDS).flat())]} feeds={feeds} now={now} />
        </>} />
      <div className="content mc" data-screen="micro">
        <div className="mc-row">
          <DepthPanel d={depth} feeds={feeds} now={now} />
          <BookPanel b={book} feeds={feeds} now={now} />
        </div>
        <div className="mc-row">
          <CvdPanel c={cvd} feeds={feeds} now={now} rest={rest} />
          <LiqPanel l={liqs} feeds={feeds} now={now} />
        </div>
        <FundingPanel f={funding} feeds={feeds} now={now} />
        <Journal feeds={feeds} rest={rest} now={now} src={src} />
      </div>
    </>
  );
}

