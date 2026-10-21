import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel } from '../../components/Panel';
import { Chip, Missing } from '../../components/ui';
import { modeDef } from '../../config/modes';
import { useSettings } from '../../config/settings';
import { freshness } from '../../data/latency';
import type { FeedState, Funding, InstrumentMeta, OpenInterest, Ticker } from '../../data/protocol';
import { useConn, useValue } from '../../data/store';
import {
  arrow, decimalsOf, direction, fmtNumber, fmtPctChange, fmtRatePct, fmtUsdCompact, NBSP,
} from '../../lib/format';
import { fmtHms } from '../../lib/time';
import { useNow } from '../../shell/useNow';
import { PriceChart } from './PriceChart';

/** Puce de fraîcheur : source et heure de dernière mise à jour (heure de Paris). */
export function FreshnessChip({ ts, source, connected, now }: {
  ts: number | null | undefined; source: string; connected: boolean; now: number;
}) {
  const state = freshness(ts != null ? now - ts : null, connected);
  const when = ts != null ? fmtHms(ts, 'Europe/Paris') : '—';
  const title = `${source} · mise à jour ${when} (Paris)`;
  if (state === 'live') return <Chip variant="live" dot="up" title={title}>Temps réel</Chip>;
  if (state === 'late') return <Chip variant="hot" dot="gold" title={title}>Retard · {when}</Chip>;
  if (state === 'stale') return <Chip variant="down" dot="down" title={title}>Périmé · {when}</Chip>;
  return <Chip variant="down" dot="down" title={title}>Déconnecté</Chip>;
}

function usePriceFlash(value: number | undefined) {
  const prev = useRef<number | undefined>(undefined);
  const [cls, setCls] = useState('');
  useEffect(() => {
    if (value === undefined) return;
    if (prev.current !== undefined && value !== prev.current) {
      setCls(value > prev.current ? 'flash-up' : 'flash-down');
      const id = setTimeout(() => setCls(''), 300);
      prev.current = value;
      return () => clearTimeout(id);
    }
    prev.current = value;
  }, [value]);
  return cls;
}

function Stat({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="lbl lbl--s">{label}</div>
      <div className="num stat__value">{children}</div>
    </div>
  );
}

/** Raison d'une valeur absente selon le mode : passerelle (Local, Tour) ou flux OKX direct (Online). */
export function useNoDataReason(connected: boolean): string {
  const { mode } = useSettings();
  const conn = useConn();
  const feed = useValue<FeedState>('feed:okx-public');
  if (connected) return 'en attente du premier message OKX';
  if (conn?.reason) return conn.reason;
  if (mode === 'online') return 'flux OKX déconnecté (Mode Online)';
  // Passerelle jointe, mais c'est son propre flux OKX qui manque.
  if (conn?.status === 'open') {
    const state = feed?.status === 'connecting' ? 'en connexion' : 'déconnecté';
    return `flux OKX de la passerelle ${state}${feed?.last_error ? ` : ${feed.last_error}` : ''}`;
  }
  return `passerelle déconnectée (${modeDef(mode).label})`;
}

export function BtcPanel({ inst = 'BTC-USDT-SWAP' }: { inst?: string }) {
  const now = useNow();
  const { mode } = useSettings();
  const conn = useConn();
  const t = useValue<Ticker>(`ticker:${inst}`);
  const f = useValue<Funding>(`funding:${inst}`);
  const oi = useValue<OpenInterest>(`oi:${inst}`);
  const meta = useValue<InstrumentMeta>(`instrument:${inst}`);
  const feed = useValue<FeedState>('feed:okx-public');
  const connected = conn?.status === 'open' && feed?.status === 'connected';
  const flash = usePriceFlash(t?.last);
  const [, setChartStatus] = useState<{ source: string; ts: number } | null>(null);
  const onChartStatus = useCallback((s: { source: string; ts: number } | null) => setChartStatus(s), []);

  const dec = decimalsOf(meta?.tick_sz, 1);
  const ch24 = t?.open24h ? t.last / t.open24h - 1 : null;
  const fundingHours = f?.interval_ms ? Math.round(f.interval_ms / 3_600_000) : null;
  const noData = useNoDataReason(connected);

  return (
    <Panel title="BTC-USDT · Perpétuel · OKX" label="BTC-USDT perpétuel"
      chips={<FreshnessChip ts={t?.ts_recv} source={`OKX EEA · ticker · ${modeDef(mode).label}`}
        connected={connected} now={now} />}>
      <div className="price-head">
        <div>
          <div className="lbl">Dernier prix · USDT{t ? ` · OKX ${fmtHms(t.ts_source, 'Europe/Paris')}` : ''}</div>
          <div className="price-row">
            <span className={`kpi ${flash}`} data-testid="btc-last">
              {t ? fmtNumber(t.last, dec) : <Missing reason={noData} />}
            </span>
            {ch24 != null && (
              <span className={`num kpi-change ${direction(ch24)}`}>
                {arrow(ch24)} {fmtPctChange(ch24)} · 24{NBSP}h
              </span>
            )}
          </div>
        </div>
        <div className="stats">
          <Stat label="Haut 24 h">{t?.high24h != null ? fmtNumber(t.high24h, dec) : <Missing reason={noData} />}</Stat>
          <Stat label="Bas 24 h">{t?.low24h != null ? fmtNumber(t.low24h, dec) : <Missing reason={noData} />}</Stat>
          <Stat label={fundingHours ? `Funding ${fundingHours} h` : 'Funding'}
            title={f?.funding_time ? `Prochaine échéance ${fmtHms(f.funding_time, 'Europe/Paris')} (Paris)` : undefined}>
            {f ? fmtRatePct(f.rate) : <Missing reason="funding poussé toutes les 30 à 90 s" />}
          </Stat>
          <Stat label="Open interest OKX" title="OKX seul ; l’agrégat multi-plateformes arrive en P5">
            {oi?.oi_usd != null ? fmtUsdCompact(oi.oi_usd) : <Missing reason={noData} />}
          </Stat>
          <Stat label="Volume 24 h · BTC" title="Volume OKX en BTC (volCcy24h)">
            {t?.vol_base24h != null ? fmtNumber(t.vol_base24h, 0) : <Missing reason={noData} />}
          </Stat>
        </div>
      </div>
      <PriceChart inst={inst} onStatus={onChartStatus} />
    </Panel>
  );
}
