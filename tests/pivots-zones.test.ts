import { describe, expect, it } from 'vitest';
import { findPivots, confirmedBy } from '@/lib/analysis/pivots';
import { buildZones, selectZones } from '@/lib/analysis/zones';
import { candles, fromCloses, HOUR, T0, zigzag } from './helpers/candles';

describe('findPivots', () => {
  it('detecta máximos y mínimos de swing', () => {
    const c = candles([
      [10, 11, 9, 10], [10, 12, 9.5, 11], [11, 15, 10, 14], [14, 13, 11, 12], [12, 12.5, 8, 9],
      [9, 10, 5, 6], [6, 9, 6.5, 8], [8, 10, 7, 9],
    ]);
    const p = findPivots(c, 2, '1h');
    expect(p.find((x) => x.type === 'high')?.price).toBe(15);
    expect(p.find((x) => x.type === 'low')?.price).toBe(5);
  });
  it('un pivot se confirma recién strength velas después (sin look-ahead)', () => {
    const c = candles([[10, 11, 9, 10], [10, 12, 9, 11], [11, 15, 10, 14], [14, 13, 11, 12], [12, 12.5, 10, 11]]);
    const [p] = findPivots(c, 2, '1h').filter((x) => x.type === 'high');
    expect(p.index).toBe(2);
    expect(p.confirmedAt).toBe(c[4].closeTime);
    expect(confirmedBy([p], c[3].closeTime)).toHaveLength(0);
    expect(confirmedBy([p], c[4].closeTime)).toHaveLength(1);
  });
  it('no marca dos veces un techo plano', () => {
    const c = candles([[1, 2, 1, 1], [1, 3, 1, 1], [1, 5, 1, 1], [1, 5, 1, 1], [1, 3, 1, 1], [1, 2, 1, 1]]);
    expect(findPivots(c, 2, '1h').filter((x) => x.type === 'high')).toHaveLength(1);
  });
  it('las últimas velas no generan pivots sin confirmar', () => {
    const c = candles([[1, 2, 1, 1], [1, 3, 1, 1], [1, 4, 1, 1], [1, 5, 1, 1]]);
    expect(findPivots(c, 2, '1h').filter((x) => x.type === 'high')).toHaveLength(0);
  });
});

describe('buildZones / selectZones', () => {
  const series = fromCloses(zigzag(100, 110, 12, 10)); // 6 techos ~110 y 6 pisos ~100
  const pivots = findPivots(series, 3, '1h');
  const now = series[series.length - 1].closeTime;

  it('agrupa pivots cercanos (≤0,3 %) en una zona con varios toques', () => {
    const zones = buildZones(pivots, { mergePct: 0.003, now, halfLifeMs: 200 * HOUR });
    const top = zones.find((z) => z.mid > 109);
    const bottom = zones.find((z) => z.mid < 101);
    expect(top!.touches).toBeGreaterThanOrEqual(5);
    expect(bottom!.touches).toBeGreaterThanOrEqual(5);
    for (const z of zones) expect((z.high - z.low) / z.low).toBeLessThanOrEqual(0.003 + 1e-12);
  });
  it('separa niveles a más de 0,3 % en zonas distintas', () => {
    const c = candles([
      [100, 101, 99, 100], [100, 101, 99, 100], [100, 110, 99, 105], [105, 104, 100, 101], [101, 102, 99, 100],
      [100, 101, 99, 100], [100, 111, 99, 105], [105, 104, 100, 101], [101, 102, 99, 100], [100, 101, 99, 100],
    ]);
    const z = buildZones(findPivots(c, 2, '1h').filter((p) => p.type === 'high'), { mergePct: 0.003, now: c[9].closeTime, halfLifeMs: 1e9 });
    expect(z).toHaveLength(2);
  });
  it('más toques, más recientes y con más volumen → más puntaje', () => {
    const base = { type: 'low' as const, index: 0, confirmedAt: T0, volume: 1, timeframe: '1h' as const };
    const now = T0 + 1000 * HOUR;
    const mk = (price: number, time: number, volumeRatio = 1) => ({ ...base, price, time, volumeRatio });
    const [a, b, c, d] = [
      buildZones([mk(100, now - HOUR), mk(100.1, now - 2 * HOUR)], { mergePct: 0.003, now, halfLifeMs: 200 * HOUR })[0],
      buildZones([mk(100, now - HOUR)], { mergePct: 0.003, now, halfLifeMs: 200 * HOUR })[0],
      buildZones([mk(100, now - 800 * HOUR)], { mergePct: 0.003, now, halfLifeMs: 200 * HOUR })[0],
      buildZones([mk(100, now - HOUR, 3)], { mergePct: 0.003, now, halfLifeMs: 200 * HOUR })[0],
    ];
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.score).toBeGreaterThan(c.score);
    expect(d.score).toBeGreaterThan(b.score);
  });
  it('un toque en 4h pesa más que en 1h', () => {
    const now = T0 + 10 * HOUR;
    const p = { type: 'low' as const, index: 0, confirmedAt: T0, volume: 1, volumeRatio: 1, price: 100, time: now - HOUR };
    const z1 = buildZones([{ ...p, timeframe: '1h' }], { mergePct: 0.003, now, halfLifeMs: 1e9 })[0];
    const z4 = buildZones([{ ...p, timeframe: '4h' }], { mergePct: 0.003, now, halfLifeMs: 1e9 })[0];
    expect(z4.score).toBeGreaterThan(z1.score);
  });
  it('ignora pivots no confirmados en `now`', () => {
    const p = { type: 'low' as const, index: 0, confirmedAt: T0 + 5 * HOUR, volume: 1, volumeRatio: 1, price: 100, time: T0, timeframe: '1h' as const };
    expect(buildZones([p], { mergePct: 0.003, now: T0 + 4 * HOUR, halfLifeMs: 1e9 })).toHaveLength(0);
  });
  it('elige las 3 más fuertes arriba y abajo, ordenadas por cercanía', () => {
    const mkZ = (mid: number, score: number) => ({ id: String(mid), low: mid - 0.1, high: mid + 0.1, mid, touches: 1, touches4h: 0, lastTouch: 0, firstTouch: 0, score, pivots: [] });
    const zones = [mkZ(90, 1), mkZ(95, 5), mkZ(97, 3), mkZ(98, 0.5), mkZ(99, 4), mkZ(101, 2), mkZ(103, 9), mkZ(105, 1), mkZ(107, 6), mkZ(109, 0.1)];
    const s = selectZones(zones, 100, 3);
    expect(s.below.map((z) => z.mid)).toEqual([99, 97, 95]);
    expect(s.above.map((z) => z.mid)).toEqual([101, 103, 107]);
  });
});
