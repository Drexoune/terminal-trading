import { Link, NavLink } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Button, Missing } from '../components/ui';
import { modeDef, type Mode } from '../config/modes';
import { useSettings } from '../config/settings';
import { fmtDuration, fmtNumber, fmtSigned, NBSP } from '../lib/format';
import { exchange, marketStatus } from '../hours/exchanges';
import { MARKETS, fmtHm, fmtHms } from '../lib/time';
import { freshness } from '../data/latency';
import type { ClockState, FeedState, Ticker } from '../data/protocol';
import { MAIN_INST, useConn, useLatency, useValue } from '../data/store';
import { SETTINGS_PATH } from '../modules';
import { APP_NAME, ASSISTANT_NAME } from '../names';
import { Bell, VoiceButton } from './Notifications';
import { useNow } from './useNow';
import { AssistantMic } from './AssistantMic';

export function Clocks({ now }: { now: number }) {
  return (
    <div className="num clocks" aria-label="Horloges des places">
      {MARKETS.map((m) => {
        // Jours fériés et séances écourtées compris (module Horaires des marchés).
        const st = marketStatus(exchange(m.code), now);
        const open = st.state === 'ouvert';
        const why = st.holiday ? `fermé (${st.holiday})` : open ? 'marché ouvert' : 'marché fermé';
        return (
          <span key={m.code} className={`clock${m.code === 'NY' && open ? ' clock--ny-open' : ''}`}
            title={`${m.name} (${m.tz}) : ${why}`}>
            <span className={`dot${open ? ' dot--gold' : ''}`} />
            {m.code} <span className="clock__time">{fmtHm(now, m.tz)}</span>
            <span className="sr">{open ? ', ouvert' : ', fermé'}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Horloge comparée à OKX : celle de la passerelle (Local, Tour) ou du navigateur (Online). */
const CLOCK_LABEL: Record<Mode, string> = {
  online: 'Horloge navigateur − OKX', local: 'Horloge Mac − OKX', tour: 'Horloge tour − OKX',
};

/** Latence du flux principal, avec le détail du trajet en infobulle. */
export function LatencyChip({ now }: { now: number }) {
  const { mode } = useSettings();
  const conn = useConn();
  const lat = useLatency();
  const feed = useValue<FeedState>('feed:okx-public');
  const ticker = useValue<Ticker>(`ticker:${MAIN_INST}`);
  const clock = useValue<ClockState>('clock:okx');

  const connected = conn?.status === 'open' && feed?.status === 'connected';
  const state = freshness(ticker ? now - ticker.ts_recv : null, connected);
  const variant = state === 'live' ? 'chip--live' : state === 'late' ? 'chip--hot' : 'chip--down';
  const dot = state === 'live' ? 'dot--up' : state === 'late' ? 'dot--gold' : 'dot--down';
  const text = !connected ? 'OKX —' : state === 'stale' ? 'OKX périmé'
    : lat?.totalMs != null ? `OKX ${fmtNumber(lat.totalMs, 0)}${NBSP}ms` : 'OKX …';
  // En Mode Online, le navigateur lit OKX sans passerelle : ces étapes n'existent pas.
  const direct = lat?.path === 'direct' || mode === 'online';
  const noGateway = <Missing reason="pas de passerelle en Mode Online" />;

  return (
    <span className="tip">
      <button type="button" className={`chip ${variant}`} aria-describedby="latency-tip">
        <span className={`dot ${dot}`} />{text}
      </button>
      <span className="tip__body" role="tooltip" id="latency-tip">
        <span className="lbl gold">Latence · BTC-USDT perp · OKX · {modeDef(mode).label}</span>
        <span className="num tip__grid">
          <span>{direct ? 'Trade OKX → navigateur' : 'Trade OKX → écran'}</span><span>{fmtDuration(lat?.totalMs)}</span>
          <span>OKX → passerelle</span><span>{direct ? noGateway : fmtDuration(lat?.okxToGatewayMs)}</span>
          <span>Passerelle → navigateur</span><span>{direct ? noGateway : fmtDuration(lat?.gatewayToScreenMs)}</span>
          <span>Échantillons (médiane)</span><span>{lat?.samples ?? 0}</span>
          <span>{CLOCK_LABEL[mode]}</span>
          {/* offset_ms = heure OKX − heure locale ; le libellé dit « horloge − OKX », d'où le signe inversé. */}
          <span>{clock ? `${fmtSigned(-clock.offset_ms, 0)}${NBSP}ms ±${Math.round(clock.uncertainty_ms)}` : '—'}
            {clock && !clock.ok ? ' (décalée)' : ''}</span>
          <span>{direct ? 'Aller-retour horloge OKX' : 'Aller-retour navigateur'}</span><span>{fmtDuration(conn?.rttMs)}</span>
          <span>{direct ? 'Flux OKX' : 'Passerelle'}</span>
          <span>{conn?.status === 'open' ? (direct ? 'connecté' : 'connectée') : conn?.reason ?? (direct ? 'déconnecté' : 'déconnectée')}</span>
        </span>
      </span>
    </span>
  );
}

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const now = useNow();
  return (
    <header className="topbar">
      <Link className="logo" to="/" aria-label={`${APP_NAME}, vue d’ensemble`}>
        <Icon name="logo" size={24} />
        <span>{APP_NAME}</span>
      </Link>
      <div className="tools">
        <Button aria-disabled="true" title={`${ASSISTANT_NAME} : disponible en P6`}>
          <span className="orb" />{ASSISTANT_NAME}
        </Button>
        <AssistantMic />
        <Button aria-label="Personnaliser l’espace de travail" aria-disabled="true"
          title="Disposition libre : disponible en P1">
          <Icon name="sliders" />Personnaliser
        </Button>
        <label className="cmd">
          <Icon name="search" />
          <span className="sr">Commande ou ticker</span>
          <input type="text" placeholder="Commande ou ticker…" readOnly
            onFocus={(e) => { e.currentTarget.blur(); onOpenPalette(); }}
            onClick={onOpenPalette} />
          <kbd className="chip" style={{ height: 20 }}>Ctrl K</kbd>
        </label>
        <Clocks now={now} />
        <span className="num utc">{fmtHms(now, 'UTC')} UTC</span>
        <LatencyChip now={now} />
        <VoiceButton />
        <Bell />
        <NavLink className="avatar" to={SETTINGS_PATH} aria-label="Paramètres du terminal"
          title="Paramètres du terminal : mode de fonctionnement">C</NavLink>
      </div>
    </header>
  );
}
