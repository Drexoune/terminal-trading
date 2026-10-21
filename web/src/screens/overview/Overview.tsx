import './overview.css';
import { Chip } from '../../components/ui';
import { modeDef } from '../../config/modes';
import { useSettings } from '../../config/settings';
import type { GatewayMeta } from '../../data/protocol';
import { useConn, useValue } from '../../data/store';
import { currentSession } from '../../lib/time';
import { SubHeader } from '../../shell/SubHeader';
import { useNow } from '../../shell/useNow';
import { BtcPanel } from './BtcPanel';
import { AlertsPanel, HeadlinesPanel, RiskPanel, UpcomingEventsPanel } from './FuturePanels';
import { Watchlist } from './Watchlist';

export function sessionTitle(now: number): string {
  const s = currentSession(now);
  return s ? `Session ${s.label} ouverte` : 'Hors séance';
}

/** Puce de source : origine des données et mode actif (« Données réelles · OKX EEA · Mode Tour »). */
export function SourceChip() {
  const { mode } = useSettings();
  const conn = useConn();
  const meta = useValue<GatewayMeta>('gateway:meta');
  const label = modeDef(mode).label;
  if (conn?.status === 'open') {
    return <Chip title="Source des données de cet écran">{`${meta?.source ?? 'Données réelles'} · ${label}`}</Chip>;
  }
  // Raison connue (Mode Tour sans adresse) : elle porte déjà le nom du mode.
  if (conn?.reason) return <Chip variant="down" title="Changer d’adresse : Paramètres">{conn.reason}</Chip>;
  return <Chip variant="down">{`${mode === 'online' ? 'OKX déconnecté' : 'Passerelle déconnectée'} · ${label}`}</Chip>;
}

export function Overview() {
  const now = useNow();
  return (
    <>
      <SubHeader icon="overview" title={`Vue d’ensemble · ${sessionTitle(now)}`} chips={<>
        <Chip variant="hot" round>BTC-USDT · Perp · OKX</Chip>
        <SourceChip />
      </>} />
      <div className="content">
        <div className="col col--main">
          <BtcPanel />
          <Watchlist />
        </div>
        <div className="col col--side">
          <UpcomingEventsPanel />
          <RiskPanel />
          <AlertsPanel />
          <HeadlinesPanel />
        </div>
      </div>
    </>
  );
}
