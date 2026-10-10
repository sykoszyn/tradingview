// Arma el contexto de análisis (zonas + tendencia) en un instante `now`,
// usando solo datos disponibles en ese momento. Lo usan el vivo y el backtest.
import type { AppConfig } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Candle } from '../types';
import { findPivots, type Pivot } from './pivots';
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
  const pivots = [
    ...s.pivots1h.filter((p) => p.confirmedAt <= now && p.time >= from1h),
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
