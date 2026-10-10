// Arma el contexto de análisis (zonas + tendencia) en un instante `now`,
// usando solo datos disponibles en ese momento. Lo usan el vivo y el backtest.
import type { AppConfig } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Candle } from '../types';
import { findPivots, type Pivot } from './pivots';
import { atr } from './indicators';
import { buildZones, selectZones, type Zone, type ZoneSelection } from './zones';
import { classifyTrend, dailyVwap, lastClosedIndex, trendSeries, type TrendContext, type TrendSeries } from './trend';

const HOUR = 3_600_000;

/** Precomputado una sola vez por serie (en vivo o para todo el backtest). */
export interface PreparedSeries {
  c1h: Candle[];
  c4h: Candle[];
  pivots1h: Pivot[];
  pivots4h: Pivot[];
  trend: TrendSeries;
  vwap1h: number[];
  atr1h: number[];
  atr4h: number[];
}

/** Velas y ATR de la temporalidad donde se evalúan los setups. */
export function signalSeries(s: PreparedSeries, cfg: AppConfig): { candles: Candle[]; atr: number[] } {
  return cfg.analysis.signalTimeframe === '4h' ? { candles: s.c4h, atr: s.atr4h } : { candles: s.c1h, atr: s.atr1h };
}

export function prepareSeries(c1h: Candle[], c4h: Candle[], cfg: AppConfig): PreparedSeries {
  const a = cfg.analysis;
  return {
    c1h,
    c4h,
    pivots1h: findPivots(c1h, a.pivotStrength, '1h', a.volumeAvgPeriod),
    pivots4h: findPivots(c4h, a.pivotStrength, '4h', a.volumeAvgPeriod),
    trend: trendSeries(c4h, a.emaFast, a.emaSlow),
    vwap1h: dailyVwap(c1h),
    atr1h: atr(c1h, cfg.plan.atrPeriod),
    atr4h: atr(c4h, cfg.plan.atrPeriod),
  };
}

export interface AnalysisContext {
  now: number;
  price: number;
  zones: Zone[];
  selection: ZoneSelection;
  trend: TrendContext | null;
}

/**
 * Zonas y tendencia en `now`. Solo entran pivots confirmados (confirmedAt ≤ now)
 * y dentro de la ventana de lookback de cada temporalidad.
 */
export function contextAt(s: PreparedSeries, now: number, price: number, cfg: AppConfig): AnalysisContext {
  const a = cfg.analysis;
  const from1h = now - a.zoneLookback1h * HOUR;
  const from4h = now - a.zoneLookback4h * 4 * HOUR;
  // Con señales en 4h las zonas salen solo de pivots de 4h (objetivos y stops acordes a esa escala).
  const pivots = [
    ...(a.signalTimeframe === '4h' ? [] : s.pivots1h.filter((p) => p.confirmedAt <= now && p.time >= from1h)),
    ...s.pivots4h.filter((p) => p.confirmedAt <= now && p.time >= from4h),
  ];
  const zones = buildZones(pivots, { mergePct: pct(a.zoneMergePct), now, halfLifeMs: a.recencyHalfLifeCandles * HOUR });
  return {
    now,
    price,
    zones,
    selection: selectZones(zones, price, a.zonesPerSide),
    trend: classifyTrend(s.c4h, s.trend, s.c1h, s.vwap1h, now, pct(a.lateralBandPct)),
  };
}

export { lastClosedIndex };
