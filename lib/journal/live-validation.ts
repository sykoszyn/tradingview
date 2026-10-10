// El paper trading automático en vivo como NUEVA validación fuera de muestra.
// Criterio (el mismo de la validación histórica): al menos 30 trades cerrados,
// expectativa > +0,15 R y ganarle al percentil 95 de entradas al azar del mismo período.
import { computeStats } from '../backtest/metrics';
import type { BtTrade } from '../backtest/run';
import type { LiveValidationCache, PaperTrade } from './types';

export const LIVE_MIN_TRADES = 30;
export const LIVE_MIN_EXPECTANCY_R = 0.15;

/** Solo cuentan los trades automáticos, ejecutados y cerrados, de la estrategia. */
export function liveSample(paper: PaperTrade[], strategyId: string): PaperTrade[] {
  return paper.filter((t) => t.auto && t.strategyId === strategyId && t.result).sort((a, b) => a.result!.exitTime - b.result!.exitTime);
}

export function toBtTrades(sample: PaperTrade[]): BtTrade[] {
  return sample.map((t) => ({
    track: 'r',
    symbol: t.plan.symbol,
    market: t.plan.market,
    direction: t.plan.direction,
    setup: t.plan.setup,
    confidence: t.plan.confidence,
    signalTime: t.plan.signalTime,
    fillTime: t.result!.fillTime,
    exitTime: t.result!.exitTime,
    outcome: t.result!.outcome,
    entry: t.plan.entry,
    stop: t.plan.stop,
    tp1: t.plan.tp1,
    tp2: t.plan.tp2,
    qty: t.plan.sizing.qty,
    leverage: t.plan.sizing.leverage,
    margin: t.plan.sizing.margin,
    fees: t.result!.fees,
    funding: t.result!.funding,
    netPnl: t.result!.netPnl,
    riskUSDT: t.plan.sizing.realRiskUSDT,
    r: t.result!.r,
    plannedRR: t.plan.rrTp1,
  }));
}

export interface LiveValidationStatus {
  trades: number;
  expectancyR: number;
  enoughTrades: boolean;
  meetsExpectancy: boolean;
  /** undefined = falta calcular la comparación con el azar para esta muestra. */
  beatsRandom?: boolean;
  randomP95?: number;
  passed: boolean;
  needsRandom: boolean;
}

export function liveValidationStatus(paper: PaperTrade[], strategyId: string, cache?: LiveValidationCache): LiveValidationStatus {
  const sample = liveSample(paper, strategyId);
  const s = computeStats(sample.map((t) => ({ netPnl: t.result!.netPnl, r: t.result!.r, exitTime: t.result!.exitTime })));
  const enoughTrades = s.trades >= LIVE_MIN_TRADES;
  const meetsExpectancy = s.expectancyR > LIVE_MIN_EXPECTANCY_R;
  const fresh = cache && cache.strategyId === strategyId && cache.trades === s.trades ? cache : undefined;
  const beatsRandom = fresh ? s.expectancyR > fresh.comparison.p95ExpectancyR : undefined;
  return {
    trades: s.trades,
    expectancyR: s.expectancyR,
    enoughTrades,
    meetsExpectancy,
    beatsRandom,
    randomP95: fresh?.comparison.p95ExpectancyR,
    passed: enoughTrades && meetsExpectancy && beatsRandom === true,
    needsRandom: enoughTrades && meetsExpectancy && !fresh,
  };
}
