import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/config/defaults';
import { runBacktest, type BacktestDataset } from '@/lib/backtest/run';
import { computeStats } from '@/lib/backtest/metrics';
import type { Candle, SymbolFilters } from '@/lib/types';
import { aggregate, HOUR, T0 } from './helpers/candles';

const ETH: SymbolFilters = { symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 20, exchange: 'binance', fetchedAt: 0 };

/** Serie sintética determinística con rangos y rebotes (random walk con semilla). */
function synthetic(n: number): Candle[] {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = [];
  let p = 2500;
  for (let i = 0; i < n; i++) {
    const o = p;
    const drift = Math.sin(i / 60) * 4;
    const c = Math.max(100, o + drift + (rnd() - 0.5) * 30);
    const h = Math.max(o, c) + rnd() * 12;
    const l = Math.min(o, c) - rnd() * 12;
    out.push({ openTime: T0 + i * HOUR, closeTime: T0 + (i + 1) * HOUR - 1, open: o, high: h, low: l, close: c, volume: 100 + rnd() * 200 });
    p = c;
  }
  return out;
}

const c1h = synthetic(2400);
const ds = (c: Candle[]): BacktestDataset => ({ symbol: 'ETHUSDT', market: 'futures', c1h: c, c4h: aggregate(c), c15m: [], funding: [], filters: ETH });
const opts = { from: T0 + 1300 * HOUR, to: T0 + 2400 * HOUR, cfg: DEFAULT_CONFIG, phase: DEFAULT_CONFIG.phases.phase3, maxHoldHours: 168 };

describe('runBacktest', () => {
  const res = runBacktest([ds(c1h)], opts);
  it('genera trades en ambos carriles y nunca liquida', () => {
    expect(res.trades.length).toBeGreaterThan(0);
    expect(res.trades.some((t) => t.track === 'r')).toBe(true);
    expect(res.trades.filter((t) => t.outcome === 'liquidation')).toHaveLength(0);
  });
  it('nunca hay dos posiciones a la vez en el mismo par y carril', () => {
    for (const track of ['usdt', 'r'] as const) {
      const t = res.trades.filter((x) => x.track === track).sort((a, b) => a.signalTime - b.signalTime);
      for (let i = 1; i < t.length; i++) expect(t[i].signalTime).toBeGreaterThan(t[i - 1].exitTime);
    }
  });
  it('sin look-ahead: cortar los datos futuros no cambia los trades ya cerrados', () => {
    const cut = T0 + 1900 * HOUR;
    const partial = runBacktest([ds(c1h.filter((c) => c.closeTime <= cut))], { ...opts, to: cut });
    const closedBefore = (arr: typeof res.trades) => arr.filter((t) => t.exitTime < cut - 200 * HOUR).map((t) => [t.track, t.signalTime, t.outcome, t.netPnl.toFixed(8)]);
    expect(closedBefore(partial.trades)).toEqual(closedBefore(res.trades));
  });
  it('el R de cada trade es el resultado neto sobre el riesgo planificado', () => {
    for (const t of res.trades) expect(t.r).toBeCloseTo(t.netPnl / t.riskUSDT, 8);
    for (const t of res.trades) if (t.outcome === 'stop') expect(t.r).toBeLessThan(-0.9);
  });
  it('cuenta las señales descartadas por mínimos con Fase 2 (10 USDT, 2x)', () => {
    const r2 = runBacktest([ds(c1h)], { ...opts, phase: DEFAULT_CONFIG.phases.phase2 });
    expect(r2.discards.filter((d) => d.track === 'usdt' && d.code === 'minimos').length).toBeGreaterThan(0);
  });
});

describe('computeStats', () => {
  it('expectativa, aciertos, drawdown y rachas', () => {
    const s = computeStats([
      { netPnl: 2, r: 2, exitTime: 1 }, { netPnl: -1, r: -1, exitTime: 2 }, { netPnl: -1, r: -1, exitTime: 3 }, { netPnl: 3, r: 3, exitTime: 4 },
    ]);
    expect(s.trades).toBe(4);
    expect(s.winRate).toBe(0.5);
    expect(s.expectancy).toBeCloseTo(0.75, 10);
    expect(s.maxDrawdown).toBeCloseTo(2, 10);
    expect(s.avgRR).toBeCloseTo(2.5, 10);
    expect(s.maxLossStreak).toBe(2);
    expect(s.currentStreak).toBe(1);
    expect(s.equity[3].value).toBeCloseTo(3, 10);
  });
});
