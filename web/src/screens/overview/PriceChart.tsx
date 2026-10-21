// Graphique intraday BTC : Lightweight Charts pour la série, bandes de session
// en surimpression (fuseaux IANA), PDH / PDL en pointillés, VWAP du jour.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaSeries, ColorType, CrosshairMode, LineSeries, LineStyle, TickMarkType, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import { Segmented } from '../../components/ui';
import { restBase } from '../../config/modes';
import { useSettings } from '../../config/settings';
import { fetchChart } from '../../data/gateway';
import type { ChartData, LiveCandle } from '../../data/protocol';
import { onItem } from '../../data/store';
import { dailyVwap, logicalIndex, timeGrid, upsertCandle } from '../../lib/chart';
import { DASH, fmtNumber } from '../../lib/format';
import { fmtHm, sessionBands, zonedParts, type Band } from '../../lib/time';

type Range = ChartData['range'];
const RANGES: { value: Range; label: string }[] = [
  { value: '1D', label: '1 J' }, { value: '5D', label: '5 J' }, { value: '1M', label: '1 M' },
];
const REFRESH_MS = 60_000;
const CHART_H = 322;

const BAND_CLASS: Record<Band['id'], string> = { asia: 'band--asia', london: 'band--london', ny: 'band--ny' };

/** Prix sans « ,0 » inutile : 108 000 sur l'axe, 108 420,5 pour le dernier prix. */
function fmtPrice(p: number): string {
  const r = Math.round(p * 10) / 10;
  return fmtNumber(r, Number.isInteger(r) ? 0 : 1);
}

function tickLabel(t: Time, type: TickMarkType): string {
  const ms = Number(t) * 1000;
  if (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds) return fmtHm(ms, 'UTC');
  const p = zonedParts(ms, 'UTC');
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const sec = (ms: number) => (ms / 1000) as UTCTimestamp;

/** Clé de la source REST : changer de mode ou d'adresse recharge les bougies. */
export function useRestKey(): string {
  const s = useSettings();
  return `${s.mode}|${restBase(s) ?? ''}`;
}

export function PriceChart({ inst, onStatus }: {
  inst: string; onStatus?: (s: { source: string; ts: number } | null) => void;
}) {
  const [range, setRange] = useState<Range>('1D');
  const [data, setData] = useState<ChartData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bandBoxes, setBandBoxes] = useState<{ band: Band; left: number; width: number }[]>([]);
  const [levelTags, setLevelTags] = useState<{ label: string; y: number; above: boolean }[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<'Area'> | null>(null);
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const dataRef = useRef<ChartData | null>(null);

  const restKey = useRestKey();

  // Données : chargement, puis rafraîchissement périodique (5 J, 1 M, et filet de sécurité).
  // Un changement de mode recharge tout : les bougies d'une source ne restent pas sous une autre.
  useEffect(() => {
    const ctl = new AbortController();
    let inFlight = false; // une source lente ne doit pas voir les requêtes s'empiler
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      fetchChart(inst, range, ctl.signal)
        .then((d) => { setData(d); setError(null); onStatus?.({ source: d.source, ts: d.ts_recv }); })
        .catch((e: unknown) => { if (!ctl.signal.aborted) setError(String((e as Error).message ?? e)); })
        .finally(() => { inFlight = false; });
    };
    dataRef.current = null; // plus de bougie en direct greffée sur l'ancienne série
    setData(null);
    setError(null);
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { ctl.abort(); clearInterval(id); };
  }, [inst, range, onStatus, restKey]);

  // Création du graphique, une fois.
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      height: CHART_H,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' }, // bandes visibles dessous
        textColor: token('--text-3'), fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: token('--line') } },
      rightPriceScale: { borderVisible: false, minimumWidth: 72 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false,
        lockVisibleTimeRangeOnResize: true, tickMarkFormatter: tickLabel,
        // 1 440 bougies de 1 min doivent tenir dans ~600 px : la journée entière reste visible.
        minBarSpacing: 0.05, rightOffset: 0 },
      crosshair: { mode: CrosshairMode.Magnet,
        vertLine: { color: token('--text-3'), labelBackgroundColor: token('--bg-panel-2') },
        horzLine: { color: token('--text-3'), labelBackgroundColor: token('--bg-panel-2') } },
      handleScroll: false, handleScale: false,
      localization: {
        locale: 'fr-FR',
        priceFormatter: fmtPrice,
        timeFormatter: (t: Time) => `${fmtHm(Number(t) * 1000, 'UTC')} UTC`,
      },
    });
    const price = chart.addSeries(AreaSeries, {
      lineColor: token('--series-price'), lineWidth: 2,
      topColor: token('--series-price-fill'), bottomColor: token('--series-price-fill'),
      priceLineColor: token('--gold-mid'), priceLineStyle: LineStyle.Dashed,
      priceFormat: { type: 'custom', formatter: fmtPrice, minMove: 0.1 },
      // L'échelle englobe aussi PDH / PDL, pour que les niveaux de la veille restent visibles.
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = original();
        const pd = dataRef.current?.prev_day;
        if (!r || !pd) return r;
        return { ...r, priceRange: {
          minValue: Math.min(r.priceRange.minValue, pd.l), maxValue: Math.max(r.priceRange.maxValue, pd.h) } };
      },
    });
    const vwap = chart.addSeries(LineSeries, {
      color: token('--series-vwap'), lineWidth: 1, lineStyle: LineStyle.Dotted,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    priceRef.current = price;
    vwapRef.current = vwap;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  const bands = useMemo(() => (data && data.range !== '1M' ? sessionBands(data.from_ms, data.to_ms) : []),
    [data]);

  // Application des données à la série.
  useEffect(() => {
    dataRef.current = data;
    const chart = chartRef.current;
    const price = priceRef.current;
    const vwap = vwapRef.current;
    if (!chart || !price || !vwap) return;
    linesRef.current.forEach((l) => price.removePriceLine(l));
    linesRef.current = [];
    if (!data) { price.setData([]); vwap.setData([]); return; }
    const byT = new Map(data.candles.map((c) => [c.t, c]));
    price.setData(timeGrid(data.from_ms, data.to_ms, data.bar_ms).map((t) => {
      const c = byT.get(t);
      return c ? { time: sec(t), value: c.c } : { time: sec(t) };
    }));
    vwap.setData(dailyVwap(data.candles).map((p) => ({ time: sec(p.t), value: p.v })));
    if (data.prev_day) {
      for (const p of [data.prev_day.h, data.prev_day.l]) {
        linesRef.current.push(price.createPriceLine({
          price: p, color: token('--gold-mid'), lineWidth: 1, lineStyle: LineStyle.LargeDashed,
          axisLabelVisible: false, title: '', // libellé dessiné en surimpression (level-tag)
        }));
      }
    }
    // Axe fixe sur toute la période (00:00 → 24:00 UTC en 1 J), données à venir comprises.
    const bars = (data.to_ms - data.from_ms) / data.bar_ms;
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: bars - 1 });
  }, [data]);

  // Bougies en direct (1 J : bougie de la minute ; 5 J / 1 M : dernier point).
  useEffect(() => onItem(`candle:1m:${inst}`, (v) => {
    const live = v as LiveCandle;
    const d = dataRef.current;
    const price = priceRef.current;
    if (!d || !price || live.t < d.from_ms || live.t >= d.to_ms) return;
    const bucket = d.from_ms + Math.floor((live.t - d.from_ms) / d.bar_ms) * d.bar_ms;
    if (d.bar === '1m') {
      d.candles = upsertCandle(d.candles, live);
      const vw = dailyVwap(d.candles);
      const last = vw[vw.length - 1];
      if (last) vwapRef.current?.update({ time: sec(last.t), value: last.v });
    }
    // La série s'étend en blanc jusqu'à 24:00 : la bougie en cours n'est pas le
    // dernier point, d'où la mise à jour « historique ».
    price.update({ time: sec(bucket), value: live.c }, true);
  }), [inst]);

  // Bandes de session : positionnées sur l'échelle de temps du graphique.
  useEffect(() => {
    const chart = chartRef.current;
    // Sans données (chargement, erreur, autre mode) : ni bandes ni niveaux d'une autre série.
    if (!chart || !data) { setBandBoxes([]); setLevelTags([]); return; }
    const place = () => {
      const ts = chart.timeScale();
      setBandBoxes(bands.map((band) => {
        const a = ts.logicalToCoordinate(logicalIndex(band.from, data.from_ms, data.bar_ms) as never) ?? 0;
        const b = ts.logicalToCoordinate(logicalIndex(band.to, data.from_ms, data.bar_ms) as never) ?? 0;
        return { band, left: a, width: Math.max(0, b - a) };
      }));
      const price = priceRef.current;
      const pd = data.prev_day;
      setLevelTags(price && pd ? [
        { label: `PDH ${fmtNumber(pd.h, 0)}`, y: price.priceToCoordinate(pd.h) ?? -100, above: true },
        { label: `PDL ${fmtNumber(pd.l, 0)}`, y: price.priceToCoordinate(pd.l) ?? -100, above: false },
      ] : []);
    };
    place();
    const ts = chart.timeScale();
    ts.subscribeSizeChange(place);
    ts.subscribeVisibleLogicalRangeChange(place);
    // L'échelle de prix se recalcule après le rendu : on replace les libellés au cadre suivant.
    const raf = requestAnimationFrame(place);
    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeSizeChange(place);
      ts.unsubscribeVisibleLogicalRangeChange(place);
    };
  }, [bands, data]);

  return (
    <div style={{ padding: '10px 16px 14px' }}>
      <div className="chart-toolbar">
        <Segmented label="Période" options={RANGES} value={range} onChange={setRange} />
        <span className="spacer" />
        {range !== '1M' && <>
          <span className="lbl lbl--s legend"><span className="key key--asia" />Asie</span>
          <span className="lbl lbl--s legend"><span className="key key--london" />Londres</span>
          <span className="lbl lbl--s legend"><span className="key key--ny" />New York</span>
        </>}
        <span className="lbl lbl--s legend"><span className="key key--pd" />PDH / PDL</span>
        <span className="lbl lbl--s legend"><span className="key key--vwap" />VWAP</span>
      </div>
      <div className="chart-box" style={{ height: CHART_H }}>
        <div className="chart-bands" aria-hidden="true">
          {bandBoxes.map(({ band, left, width }) => (
            <div key={`${band.id}-${band.from}`} className={`band ${BAND_CLASS[band.id]}`}
              style={{ left, width }}>
              {range === '1D' && <span className="lbl lbl--s band__label">{band.label}</span>}
            </div>
          ))}
        </div>
        <div className="chart-tags" aria-hidden="true">
          {data && levelTags.map((t) => (
            <span key={t.label} className="num level-tag"
              style={{ top: t.above ? t.y - 17 : t.y + 4 }}>{t.label}</span>
          ))}
        </div>
        <div ref={host} className="chart-host" role="img"
          aria-label={`Prix ${inst} sur ${RANGES.find((r) => r.value === range)?.label}, heures UTC`} />
        {!data && (
          <div className="chart-empty lbl">
            {error ? `${DASH} graphique indisponible : ${error}` : 'Chargement des bougies OKX…'}
          </div>
        )}
      </div>
    </div>
  );
}
