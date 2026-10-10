import { describe, expect, it } from 'vitest';
import { dailyVwap, ema, priorVolumeAverage, sma } from '@/lib/analysis/indicators';
import { candles, HOUR, T0 } from './helpers/candles';

describe('indicadores', () => {
  it('sma', () => {
    expect(sma([1, 2, 3, 4], 2).slice(1)).toEqual([1.5, 2.5, 3.5]);
    expect(Number.isNaN(sma([1, 2], 3)[1])).toBe(true);
  });
  it('ema sembrada con sma', () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
    expect(e[4]).toBeCloseTo(4, 10);
  });
  it('vwap diario se reinicia a las 00:00 UTC', () => {
    const rows: Array<[number, number, number, number, number]> = Array.from({ length: 26 }, (_, i) => [10, 12, 8, 10, i < 24 ? 1 : 5]);
    rows[24] = [20, 22, 18, 20, 5];
    const v = dailyVwap(candles(rows, HOUR, T0));
    expect(v[23]).toBeCloseTo(10, 10);
    expect(v[24]).toBeCloseTo(20, 10); // nuevo día
  });
  it('volumen promedio previo excluye la vela actual', () => {
    const c = candles([[1, 1, 1, 1, 10], [1, 1, 1, 1, 20], [1, 1, 1, 1, 1000]]);
    expect(priorVolumeAverage(c, 2, 2)).toBe(15);
    expect(Number.isNaN(priorVolumeAverage(c, 1, 2))).toBe(true);
  });
});
