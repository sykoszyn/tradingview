'use client';
// Curva de capital (en R o USDT) con lightweight-charts.
import { useEffect, useRef } from 'react';
import { AreaSeries, createChart, type UTCTimestamp } from 'lightweight-charts';

export function EquityChart({ points, height = 180, unit }: { points: Array<{ time: number; value: number }>; height?: number; unit: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', attributionLogo: false },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155' },
    });
    const last = points[points.length - 1]?.value ?? 0;
    const up = last >= 0;
    const series = chart.addSeries(AreaSeries, {
      lineColor: up ? '#34d399' : '#f87171',
      topColor: up ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)} ${unit}` },
    });
    // lightweight-charts exige tiempos estrictamente crecientes (en segundos).
    const data: Array<{ time: UTCTimestamp; value: number }> = [];
    for (const p of points) {
      let t = Math.floor(p.time / 1000);
      if (data.length && t <= data[data.length - 1].time) t = data[data.length - 1].time + 1;
      data.push({ time: t as UTCTimestamp, value: p.value });
    }
    series.setData(data);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, height, unit]);
  return <div ref={ref} style={{ height }} className="w-full" />;
}
