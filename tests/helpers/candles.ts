import type { Candle } from '@/lib/types';

export const HOUR = 3_600_000;
export const T0 = Date.UTC(2026, 0, 5, 0, 0, 0); // lunes 00:00 UTC

/** Velas a partir de [open, high, low, close, volume?]. */
export function candles(rows: Array<[number, number, number, number, number?]>, intervalMs = HOUR, start = T0): Candle[] {
  return rows.map(([o, h, l, c, v], i) => ({
    openTime: start + i * intervalMs,
    closeTime: start + (i + 1) * intervalMs - 1,
    open: o, high: h, low: l, close: c, volume: v ?? 100,
  }));
}

/** Velas simples a partir de cierres (cuerpo = cierre previo → cierre, mechas chicas). */
export function fromCloses(closes: number[], intervalMs = HOUR, start = T0, volume = 100): Candle[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return {
      openTime: start + i * intervalMs,
      closeTime: start + (i + 1) * intervalMs - 1,
      open: o, high: Math.max(o, c) * 1.0005, low: Math.min(o, c) * 0.9995, close: c, volume,
    };
  });
}

/** Serie en zigzag entre `lo` y `hi` con `period` velas por tramo. */
export function zigzag(lo: number, hi: number, legs: number, period: number): number[] {
  const out: number[] = [];
  for (let l = 0; l < legs; l++) {
    const up = l % 2 === 0;
    for (let i = 0; i < period; i++) {
      const t = i / period;
      out.push(up ? lo + (hi - lo) * t : hi - (hi - lo) * t);
    }
  }
  return out;
}

/** Agrupa velas de 1h en velas de 4h alineadas a UTC. */
export function aggregate(c1h: Candle[], factor = 4): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= c1h.length; i += factor) {
    const g = c1h.slice(i, i + factor);
    out.push({
      openTime: g[0].openTime, closeTime: g[g.length - 1].closeTime,
      open: g[0].open, close: g[g.length - 1].close,
      high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)),
      volume: g.reduce((s, x) => s + x.volume, 0),
    });
  }
  return out;
}
