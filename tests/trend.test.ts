import { describe, expect, it } from 'vitest';
import { classifyTrend, dailyVwap, lastClosedIndex, trendSeries } from '@/lib/analysis/trend';
import { fromCloses, HOUR } from './helpers/candles';

const H4 = 4 * HOUR;
const run = (closes: number[]) => {
  const c4 = fromCloses(closes, H4);
  const s = trendSeries(c4, 50, 200);
  return classifyTrend(c4, s, c4, dailyVwap(c4), c4[c4.length - 1].closeTime, 0.005);
};

describe('classifyTrend', () => {
  it('alcista con subida sostenida', () => {
    expect(run(Array.from({ length: 300 }, (_, i) => 100 + i * 0.5))?.trend).toBe('alcista');
  });
  it('bajista con caída sostenida', () => {
    expect(run(Array.from({ length: 300 }, (_, i) => 300 - i * 0.5))?.trend).toBe('bajista');
  });
  it('lateral si el precio oscila sin dirección', () => {
    expect(run(Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 3) * 2))?.trend).toBe('lateral');
  });
  it('null si no hay velas suficientes para la EMA 200', () => {
    expect(run(Array.from({ length: 100 }, (_, i) => 100 + i))).toBeNull();
  });
  it('solo usa velas cerradas en `now`', () => {
    const c = fromCloses([1, 2, 3], HOUR);
    expect(lastClosedIndex(c, c[1].closeTime)).toBe(1);
    expect(lastClosedIndex(c, c[1].closeTime - 1)).toBe(0);
    expect(lastClosedIndex(c, 0)).toBe(-1);
  });
});
