// Contexto de tendencia: EMA 50/200 en 4h + VWAP diario.
import type { Candle } from '../types';
import { dailyVwap, ema } from './indicators';

export type Trend = 'alcista' | 'bajista' | 'lateral';

export interface TrendContext {
  trend: Trend;
  emaFast: number;
  emaSlow: number;
  close4h: number;
  vwap: number;
  aboveVwap: boolean;
  explanation: string;
}

export interface TrendSeries {
  emaFast: number[];
  emaSlow: number[];
}

export function trendSeries(candles4h: Candle[], fast: number, slow: number): TrendSeries {
  const closes = candles4h.map((c) => c.close);
  return { emaFast: ema(closes, fast), emaSlow: ema(closes, slow) };
}

/** Índice de la última vela CERRADA en `now` (closeTime ≤ now), o -1. */
export function lastClosedIndex(candles: Candle[], now: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].closeTime <= now) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Clasifica el contexto usando solo velas de 4h cerradas en `now`:
 * - Lateral si las EMAs están a menos de `lateralBand` (fracción) entre sí.
 * - Alcista si EMA rápida > lenta y el cierre está sobre la EMA lenta.
 * - Bajista si EMA rápida < lenta y el cierre está bajo la EMA lenta.
 * - Si no, lateral.
 */
export function classifyTrend(
  candles4h: Candle[],
  series: TrendSeries,
  vwapCandles: Candle[],
  vwapSeries: number[],
  now: number,
  lateralBand: number,
): TrendContext | null {
  const i = lastClosedIndex(candles4h, now);
  if (i < 0) return null;
  const f = series.emaFast[i];
  const s = series.emaSlow[i];
  if (!Number.isFinite(f) || !Number.isFinite(s)) return null;
  const close = candles4h[i].close;
  const vi = lastClosedIndex(vwapCandles, now);
  const vwap = vi >= 0 ? vwapSeries[vi] : NaN;
  const lastPrice = vi >= 0 ? vwapCandles[vi].close : close;
  const gap = (f - s) / s;
  let trend: Trend = 'lateral';
  if (Math.abs(gap) >= lateralBand) {
    if (gap > 0 && close > s) trend = 'alcista';
    else if (gap < 0 && close < s) trend = 'bajista';
  }
  const pct = (gap * 100).toFixed(2);
  const explanation =
    trend === 'alcista'
      ? `EMA rápida sobre la lenta (+${pct}%) y el precio de 4h por encima de la EMA lenta.`
      : trend === 'bajista'
        ? `EMA rápida bajo la lenta (${pct}%) y el precio de 4h por debajo de la EMA lenta.`
        : `EMAs muy juntas o el precio cruzado con ellas (separación ${pct}%): sin tendencia clara.`;
  return {
    trend,
    emaFast: f,
    emaSlow: s,
    close4h: close,
    vwap,
    aboveVwap: Number.isFinite(vwap) ? lastPrice >= vwap : false,
    explanation,
  };
}

export { dailyVwap };
