'use client';
// Gráfico de velas (lightweight-charts) con zonas sombreadas, señales marcadas y
// líneas de entrada, stop, TP y liquidación del plan seleccionado.
import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@/lib/types';
import type { Zone } from '@/lib/analysis/zones';
import type { TradePlan } from '@/lib/plan/plan';

interface Props {
  candles: Candle[];
  zonesAbove: Zone[];
  zonesBelow: Zone[];
  plans: TradePlan[];
  selected: TradePlan | null;
  livePrice?: number;
  intervalMs: number;
}

const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function PriceChart({ candles, zonesAbove, zonesBelow, plans, selected, livePrice, intervalMs }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const [boxes, setBoxes] = useState<Array<{ top: number; height: number; kind: 'sup' | 'res'; key: string }>>([]);
  const zonesRef = useRef<{ above: Zone[]; below: Zone[] }>({ above: [], below: [] });
  zonesRef.current = { above: zonesAbove, below: zonesBelow };

  const recomputeBoxes = () => {
    const s = seriesRef.current;
    if (!s) return;
    const out: typeof boxes = [];
    const add = (z: Zone, kind: 'sup' | 'res') => {
      const pad = Math.max(z.high - z.low, z.mid * 0.0008) / 2;
      const y1 = s.priceToCoordinate(z.mid + pad);
      const y2 = s.priceToCoordinate(z.mid - pad);
      if (y1 === null || y2 === null) return;
      out.push({ top: Math.min(y1, y2), height: Math.max(6, Math.abs(y2 - y1)), kind, key: z.id + kind });
    };
    zonesRef.current.above.forEach((z) => add(z, 'res'));
    zonesRef.current.below.forEach((z) => add(z, 'sup'));
    setBoxes(out);
  };

  useEffect(() => {
    if (!wrap.current) return;
    const chart = createChart(wrap.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', attributionLogo: false },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true },
      localization: { locale: 'es-AR' },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    const onChange = () => requestAnimationFrame(recomputeBoxes);
    chart.timeScale().subscribeVisibleLogicalRangeChange(onChange);
    const ro = new ResizeObserver(onChange);
    ro.observe(wrap.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Datos
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !candles.length) return;
    s.setData(candles.map((c) => ({ time: ts(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close })));
    chartRef.current?.timeScale().fitContent();
    requestAnimationFrame(recomputeBoxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  // Precio en vivo sobre la última vela
  useEffect(() => {
    const s = seriesRef.current;
    const last = candles[candles.length - 1];
    if (!s || !last || !livePrice) return;
    const now = Date.now();
    const open = now - (now % intervalMs);
    if (open === last.openTime) s.update({ time: ts(open), open: last.open, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice), close: livePrice });
    else if (open > last.openTime) s.update({ time: ts(open), open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice });
  }, [livePrice, candles, intervalMs]);

  useEffect(() => {
    requestAnimationFrame(recomputeBoxes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonesAbove, zonesBelow]);

  // Señales y líneas del plan seleccionado
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const first = candles[0]?.openTime ?? 0;
    const markers: SeriesMarker<Time>[] = plans
      .filter((p) => p.signalTime >= first)
      .map((p) => ({
        time: ts(p.signalTime - (p.signalTime % intervalMs)),
        position: p.direction === 'long' ? 'belowBar' : 'aboveBar',
        color: p.direction === 'long' ? '#34d399' : '#fb7185',
        shape: p.direction === 'long' ? 'arrowUp' : 'arrowDown',
        text: p.direction === 'long' ? 'LONG' : 'SHORT',
      }));
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);
    linesRef.current.forEach((l) => s.removePriceLine(l));
    linesRef.current = [];
    if (selected) {
      const add = (price: number, color: string, title: string, style = LineStyle.Solid) =>
        linesRef.current.push(s.createPriceLine({ price, color, title, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
      add(selected.entry, '#38bdf8', 'Entrada');
      add(selected.stop, '#f43f5e', 'Stop');
      add(selected.tp1, '#10b981', 'TP1', LineStyle.Dashed);
      if (selected.tp2 !== null) add(selected.tp2, '#10b981', 'TP2', LineStyle.Dashed);
      if (selected.liquidation && selected.liquidation.price > 0) add(selected.liquidation.price, '#f59e0b', 'Liquidación', LineStyle.Dotted);
    }
  }, [plans, selected, candles, intervalMs]);

  return (
    <div className="relative h-72 w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 sm:h-96">
      <div ref={wrap} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 right-14">
        {boxes.map((b) => (
          <div
            key={b.key}
            className={`absolute left-0 right-0 ${b.kind === 'sup' ? 'bg-emerald-500/15 border-emerald-500/40' : 'bg-rose-500/15 border-rose-500/40'} border-y`}
            style={{ top: b.top, height: b.height }}
          />
        ))}
      </div>
    </div>
  );
}
