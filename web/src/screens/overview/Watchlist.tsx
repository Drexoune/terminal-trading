// Watchlist : crypto en direct (OKX) ; les autres actifs viennent de Markets Watch (T-051, T-052 :
// Tiingo toutes les 3 min, FRED et clôtures de Bourse au quotidien, Mode Online). Sans donnée :
// « — » avec la raison, jamais un chiffre inventé.

import { useEffect, useState } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Panel } from '../../components/Panel';
import { Chip, Missing, Sparkline } from '../../components/ui';
import { modeDef } from '../../config/modes';
import { useSettings } from '../../config/settings';
import { fetchChart } from '../../data/gateway';
import type { InstrumentMeta, Ticker } from '../../data/protocol';
import { useConn, useValue } from '../../data/store';
import { downsample } from '../../lib/chart';
import { decimalsOf, direction, fmtNumber, fmtPctChange, fmtSigned, NBSP } from '../../lib/format';
import { fmtHm } from '../../lib/time';
import { WATCH_STATUS_KEY } from '../../data/online/watch';
import { ASSETS, change, isLate, marketLabel, refLabel, WATCH_KEY, type AssetDef, type WatchAsset, type WatchState } from '../../watch/watch';
import { useNow } from '../../shell/useNow';
import { FreshnessChip, useNoDataReason } from './BtcPanel';
import { useRestKey } from './PriceChart';

interface Row {
  name: string;
  sub: string;
  inst?: string;           // instrument OKX quand la ligne est en direct
  asset?: string;          // actif de Markets Watch (src/watch/watch.ts)
  market: string;
  reason?: string;         // raison de l'absence de données
}

const PENDING = 'données de Markets Watch en Mode Online seulement (tâche watch de Supabase)';

export const ROWS: Row[] = [
  { name: 'BTC', sub: 'USDT · perp OKX', inst: 'BTC-USDT-SWAP', market: '24/7' },
  { name: 'ETH', sub: 'USDT · perp OKX', inst: 'ETH-USDT-SWAP', market: '24/7' },
  ...ASSETS.map((a): Row => ({ name: a.name, sub: a.sub, asset: a.id, market: '' })),
];

function useWatchAsset(id: string | undefined): { def: AssetDef | undefined; a: WatchAsset | undefined; reason: string } {
  const st = useValue<WatchState>(WATCH_KEY);
  const online = useValue<{ ok: boolean; reason: string | null }>(WATCH_STATUS_KEY);
  const { mode } = useSettings();
  const def = ASSETS.find((x) => x.id === id);
  const a = st?.assets.find((x) => x.asset === id);
  const reason = st ? (st.configured ? 'aucun cours reçu pour cet actif' : `non configuré : ${st.reason ?? ''}`)
    : mode !== 'online' ? PENDING : online && !online.ok ? online.reason ?? 'watchlist injoignable' : 'chargement de la watchlist…';
  return { def, a, reason };
}

function WatchLast({ id }: { id: string }) {
  const { def, a, reason } = useWatchAsset(id);
  const now = useNow();
  if (!def || !a?.last) return <Missing reason={reason} />;
  const late = isLate(def, a, now);
  return (
    <span className={late ? 'wl__late' : undefined} title={`${def.source} · cours de ${fmtHm(a.last.ts_source, 'Europe/Paris')} (Paris)${late ? ' · en retard' : ''}`}>
      {fmtNumber(a.last.price, def.decimals)}{def.unit ? `${NBSP}${def.unit}` : ''}
    </span>
  );
}

function WatchChange({ id }: { id: string }) {
  const { def, a, reason } = useWatchAsset(id);
  if (!def || !a?.last) return <Missing reason={reason} />;
  const ch = change(def, a);
  if (ch === null) return <Missing reason={refLabel(a)} />;
  return <span className={direction(ch)} title={refLabel(a)}>{def.change === 'bp' ? `${fmtSigned(ch, 1)}${NBSP}pb` : fmtPctChange(ch)}</span>;
}

function WatchSpark({ id }: { id: string }) {
  const { a, reason } = useWatchAsset(id);
  if (!a?.series.length) return <Missing reason={a ? 'série vide' : reason} />;
  return <Sparkline values={a.series.map((p) => p.price)} />;
}

function WatchMarket({ id }: { id: string }) {
  const def = ASSETS.find((x) => x.id === id);
  const now = useNow();
  if (!def) return null;
  const m = marketLabel(def.market, now);
  return <span className="lbl lbl--s">{m.text}</span>;
}

/** Clôtures de la séance (journée UTC) pour la sparkline, rafraîchies chaque minute. */
function useSessionCloses(inst: string | undefined): number[] {
  const [closes, setCloses] = useState<number[]>([]);
  const restKey = useRestKey();
  useEffect(() => {
    if (!inst) return;
    const ctl = new AbortController();
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      fetchChart(inst, '1D', ctl.signal)
        .then((d) => setCloses(downsample(d.candles.map((c) => c.c))))
        .catch(() => { /* la ligne garde sa dernière sparkline ; le prix reste en direct */ })
        .finally(() => { inFlight = false; });
    };
    setCloses([]); // changement de mode : pas de sparkline de l'ancienne source
    load();
    const id = setInterval(load, 60_000);
    return () => { ctl.abort(); clearInterval(id); };
  }, [inst, restKey]);
  return closes;
}

function LastCell({ row }: { row: Row }) {
  if (row.asset) return <WatchLast id={row.asset} />;
  return <OkxLast row={row} />;
}

function OkxLast({ row }: { row: Row }) {
  const t = useValue<Ticker>(`ticker:${row.inst}`);
  const meta = useValue<InstrumentMeta>(`instrument:${row.inst}`);
  const conn = useConn();
  const noData = useNoDataReason(conn?.status === 'open');
  if (!row.inst) return <Missing reason={row.reason ?? PENDING} />;
  return t ? <>{fmtNumber(t.last, decimalsOf(meta?.tick_sz, 2))}</> : <Missing reason={noData} />;
}

function ChangeCell({ row }: { row: Row }) {
  if (row.asset) return <WatchChange id={row.asset} />;
  return <OkxChange row={row} />;
}

function OkxChange({ row }: { row: Row }) {
  const t = useValue<Ticker>(`ticker:${row.inst}`);
  if (!row.inst) return <Missing reason={row.reason ?? PENDING} />;
  const ch = t?.sod_utc0 ? t.last / t.sod_utc0 - 1 : null;
  return <span className={direction(ch)} title="Depuis l’ouverture de la journée UTC">{fmtPctChange(ch)}</span>;
}

function SparkCell({ row }: { row: Row }) {
  if (row.asset) return <WatchSpark id={row.asset} />;
  return <OkxSpark row={row} />;
}

function OkxSpark({ row }: { row: Row }) {
  const closes = useSessionCloses(row.inst);
  const t = useValue<Ticker>(`ticker:${row.inst}`);
  if (!row.inst) return <Missing reason={row.reason ?? PENDING} />;
  return <Sparkline values={t && closes.length ? [...closes, t.last] : closes} />;
}

const col = createColumnHelper<Row>();
const columns = [
  col.display({
    id: 'asset', header: 'Actif',
    cell: ({ row }) => (
      <div className="wl__asset">
        <span className="wl__name">{row.original.name}</span>
        <span className="lbl lbl--s wl__sub">{row.original.sub}</span>
      </div>
    ),
  }),
  col.display({ id: 'last', header: 'Dernier', cell: ({ row }) => <LastCell row={row.original} /> }),
  col.display({ id: 'change', header: 'Var. jour', cell: ({ row }) => <ChangeCell row={row.original} /> }),
  col.display({ id: 'spark', header: 'Séance', cell: ({ row }) => <SparkCell row={row.original} /> }),
  col.display({ id: 'market', header: 'Marché', cell: ({ row }) => (row.original.asset
    ? <WatchMarket id={row.original.asset} /> : <span className="lbl lbl--s">{row.original.market}</span>) }),
];

const COL_CLASS: Record<string, string> = { last: 'num r t1', change: 'num r', market: 'r' };
const COL_WIDTH: Record<string, string> = { asset: '34%', last: '19%', change: '15%', spark: '152px', market: '76px' };

export function Watchlist() {
  const now = useNow();
  const { mode } = useSettings();
  const conn = useConn();
  const btc = useValue<Ticker>('ticker:BTC-USDT-SWAP');
  const table = useReactTable({ data: ROWS, columns, getCoreRowModel: getCoreRowModel() });
  const watch = useValue<WatchState>(WATCH_KEY);
  const live = ROWS.filter((r) => r.inst).length + (watch?.assets.filter((a) => a.last).length ?? 0);
  return (
    <Panel title="Watchlist" chips={<>
      <Chip title={`${live} avec données (OKX en direct ; Tiingo toutes les 3 min ; FRED et clôtures au quotidien), ${ROWS.length - live} sans`}>{ROWS.length} actifs</Chip>
      <FreshnessChip ts={btc?.ts_recv} source={`OKX EEA · tickers · ${modeDef(mode).label}`}
        connected={conn?.status === 'open'} now={now} />
    </>}>
      <div className="wl">
        <table>
          <colgroup>{columns.map((c) => <col key={c.id} style={{ width: COL_WIDTH[c.id!] }} />)}</colgroup>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className={`lbl lbl--s ${h.id === 'last' || h.id === 'change' || h.id === 'market' ? 'r' : ''}`}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={COL_CLASS[c.column.id] ?? ''}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
