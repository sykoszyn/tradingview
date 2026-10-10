// Pivots de swing. Un pivot en la vela i recién se CONFIRMA al cierre de la vela
// i + strength: ese momento queda en `confirmedAt` para evitar look-ahead.
import type { Candle } from '../types';

export type PivotType = 'high' | 'low';
export type Timeframe = '1h' | '4h';

export interface Pivot {
  type: PivotType;
  index: number;
  time: number; // openTime de la vela del pivot
  confirmedAt: number; // closeTime de la vela que lo confirma
  price: number;
  volume: number;
  /** Volumen del pivot / promedio de volumen de la ventana (para puntuar zonas). */
  volumeRatio: number;
  timeframe: Timeframe;
}

/**
 * Detecta pivots: high[i] mayor que los `strength` highs anteriores y mayor o
 * igual que los `strength` siguientes (simétrico para lows). La asimetría
 * (> a la izquierda, >= a la derecha) evita marcar dos veces un techo plano.
 */
export function findPivots(candles: Candle[], strength: number, timeframe: Timeframe, volumeWindow = 20): Pivot[] {
  const out: Pivot[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= strength; j++) {
      const l = candles[i - j];
      const r = candles[i + j];
      if (!(c.high > l.high) || !(c.high >= r.high)) isHigh = false;
      if (!(c.low < l.low) || !(c.low <= r.low)) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (!isHigh && !isLow) continue;
    const from = Math.max(0, i - volumeWindow);
    let vs = 0;
    for (let j = from; j < i; j++) vs += candles[j].volume;
    const avg = i - from > 0 ? vs / (i - from) : c.volume;
    const base = {
      index: i,
      time: c.openTime,
      confirmedAt: candles[i + strength].closeTime,
      volume: c.volume,
      volumeRatio: avg > 0 ? c.volume / avg : 1,
      timeframe,
    };
    if (isHigh) out.push({ ...base, type: 'high', price: c.high });
    if (isLow) out.push({ ...base, type: 'low', price: c.low });
  }
  return out;
}

/** Solo los pivots ya confirmados en el instante `now`. */
export const confirmedBy = (pivots: Pivot[], now: number) => pivots.filter((p) => p.confirmedAt <= now);
