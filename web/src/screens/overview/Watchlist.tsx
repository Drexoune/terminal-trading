// Watchlist : crypto en direct (OKX) ; les autres actifs attendent leur source
// (décision T-005) et affichent « — » avec la raison, jamais un chiffre inventé.

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
import { decimalsOf, direction, fmtNumber, fmtPctChange } from '../../lib/format';
import { useNow } from '../../shell/useNow';
import { FreshnessChip, useNoDataReason } from './BtcPanel';
import { useRestKey } from './PriceChart';

interface Row {
  name: string;
  sub: string;
  inst?: string;           // instrument OKX quand la ligne est en direct
  market: string;
  reason?: string;         // raison de l'absence de données
}

const PENDING = 'source à choisir en P1 (décision T-005)';

export const ROWS: Row[] = [
  { name: 'BTC', sub: 'USDT · perp OKX', inst: 'BTC-USDT-SWAP', market: '24/7' },
  { name: 'ETH', sub: 'USDT · perp OKX', inst: 'ETH-USDT-SWAP', market: '24/7' },
  { name: 'NASDAQ 100', sub: 'Future déc.', market: '—', reason: PENDING },
  { name: 'S&P 500', sub: 'Future déc.', market: '—', reason: PENDING },
  { name: 'DXY', sub: 'Indice dollar', market: '—', reason: PENDING },
  { name: 'US 10 ans', sub: 'Rendement', market: '—', reason: PENDING },
  { name: 'Or', sub: 'XAU/USD', market: '—', reason: PENDING },
  { name: 'EUR/USD', sub: 'Spot', market: '—', reason: PENDING },
  { name: 'USD/JPY', sub: 'Spot', market: '—', reason: PENDING },
  { name: 'ETF Nasdaq 100', sub: 'PEA · Paris', market: '—', reason: PENDING },
  { name: 'ETF S&P 500', sub: 'PEA · Paris', market: '—', reason: PENDING },
];

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
  const t = useValue<Ticker>(`ticker:${row.inst}`);
  const meta = useValue<InstrumentMeta>(`instrument:${row.inst}`);
  const conn = useConn();
  const noData = useNoDataReason(conn?.status === 'open');
  if (!row.inst) return <Missing reason={row.reason ?? PENDING} />;
  return t ? <>{fmtNumber(t.last, decimalsOf(meta?.tick_sz, 2))}</> : <Missing reason={noData} />;
}

function ChangeCell({ row }: { row: Row }) {
  const t = useValue<Ticker>(`ticker:${row.inst}`);
  if (!row.inst) return <Missing reason={row.reason ?? PENDING} />;
  const ch = t?.sod_utc0 ? t.last / t.sod_utc0 - 1 : null;
  return <span className={direction(ch)} title="Depuis l’ouverture de la journée UTC">{fmtPctChange(ch)}</span>;
}

function SparkCell({ row }: { row: Row }) {
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
  col.display({ id: 'market', header: 'Marché', cell: ({ row }) => <span className="lbl lbl--s">{row.original.market}</span> }),
];

const COL_CLASS: Record<string, string> = { last: 'num r t1', change: 'num r', market: 'r' };
const COL_WIDTH: Record<string, string> = { asset: '34%', last: '19%', change: '15%', spark: '152px', market: '76px' };

export function Watchlist() {
  const now = useNow();
  const { mode } = useSettings();
  const conn = useConn();
  const btc = useValue<Ticker>('ticker:BTC-USDT-SWAP');
  const table = useReactTable({ data: ROWS, columns, getCoreRowModel: getCoreRowModel() });
  const live = ROWS.filter((r) => r.inst).length;
  return (
    <Panel title="Watchlist" chips={<>
      <Chip title={`${live} en direct (OKX), ${ROWS.length - live} en attente de source`}>{ROWS.length} actifs</Chip>
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
