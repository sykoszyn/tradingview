// Indicadores básicos. Todos devuelven un array alineado con la entrada (NaN cuando no hay datos suficientes).
import type { Candle } from '../types';

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA sembrada con la SMA de los primeros `period` valores. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * VWAP diario anclado a las 00:00 UTC (convención de cripto/TradingView).
 * Precio típico = (H + L + C) / 3.
 */
export function dailyVwap(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  let day = -1;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const d = Math.floor(c.openTime / 86_400_000);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * c.volume;
    vol += c.volume;
    out[i] = vol > 0 ? pv / vol : tp;
  }
  return out;
}

/** Volumen promedio de las `period` velas ANTERIORES a i (sin incluir i). */
export function priorVolumeAverage(candles: Candle[], i: number, period: number): number {
  if (i < period) return NaN;
  let s = 0;
  for (let j = i - period; j < i; j++) s += candles[j].volume;
  return s / period;
}
