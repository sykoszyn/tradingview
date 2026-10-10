// Paper trading: el plan se sigue con velas de 1m en vivo usando el MISMO
// simulador que el backtest (stop, TP1 + stop a la entrada, TP2, liquidación,
// vencimiento). En velas de 1m ambiguas se asume el stop.
import type { AppConfig } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Candle, FundingRatePoint } from '../types';
import type { TradePlan } from '../plan/plan';
import { historicalFunding } from '../plan/funding';
import { accountTrade, advance, qtyOpenAt, type SimContext, type SimPlan, type SimState } from '../engine/simulate';
import type { PaperTrade, TradeResult } from './types';

export const MAX_HOLD_HOURS = 168;

export function simPlanFrom(plan: TradePlan, cfg: AppConfig): SimPlan {
  return {
    direction: plan.direction,
    entry: plan.entry,
    entryLimit: plan.entryLimit,
    stop: plan.stop,
    tp1: plan.tp1,
    tp2: plan.tp2,
    tp1ClosePct: plan.tp1ClosePct,
    qty: plan.sizing.qty,
    expiresAt: plan.expiresAt,
    liquidationPrice: plan.liquidation?.price,
    slippage: pct(cfg.fees.slippagePct),
    maxHoldMs: MAX_HOLD_HOURS * 3_600_000,
  };
}

export function newPaperTrade(plan: TradePlan, strategyId: string, auto: boolean, now = Date.now()): PaperTrade {
  if (plan.status !== 'operable') throw new Error('Solo se pueden simular planes operables.');
  return {
    id: `p-${plan.id}`,
    kind: 'paper',
    strategyId,
    auto,
    createdAt: now,
    plan,
    sim: { phase: 'pending' },
    lastProcessed: plan.signalTime,
  };
}

/** Avanza el trade con velas de 1m CERRADAS posteriores a lo ya procesado. */
export function advancePaper(t: PaperTrade, candles1m: Candle[], cfg: AppConfig): PaperTrade {
  if (t.sim.phase === 'closed') return t;
  const ctx: SimContext = { plan: simPlanFrom(t.plan, cfg), unresolved: [], assumedWorst: 0 };
  let sim: SimState = t.sim;
  let last = t.lastProcessed;
  for (const c of candles1m) {
    if (c.closeTime <= last) continue;
    sim = advance(sim, ctx, c, 2);
    last = c.closeTime;
    if (sim.phase === 'closed') break;
  }
  return { ...t, sim, lastProcessed: last };
}

/** Resultado con comisiones y funding (solo trades ejecutados y cerrados). */
export function finalizePaper(t: PaperTrade, funding: FundingRatePoint[]): PaperTrade {
  const s = t.sim;
  if (s.phase !== 'closed' || s.fillTime === null || s.outcome === 'expired' || s.outcome === 'invalidated') return t;
  const p = t.plan;
  const fillTime = s.fillTime;
  const fund =
    p.market === 'futures' ? historicalFunding(p.direction, funding, fillTime, s.exitTime, (time) => qtyOpenAt(p.sizing.qty, fillTime, s.legs, time) * p.entry).total : 0;
  const acc = accountTrade(p.direction, p.entry, p.sizing.qty, s.legs, p.feeRates.maker, p.feeRates.taker, fund);
  const result: TradeResult = {
    outcome: s.outcome,
    fillTime,
    exitTime: s.exitTime,
    netPnl: acc.netPnl,
    fees: acc.fees,
    funding: fund,
    r: p.sizing.realRiskUSDT > 0 ? acc.netPnl / p.sizing.realRiskUSDT : 0,
  };
  return { ...t, result };
}

export const isActive = (t: PaperTrade) => t.sim.phase !== 'closed';
export const isFilledClosed = (t: PaperTrade) => !!t.result;

export function paperStatusLabel(t: PaperTrade): string {
  const s = t.sim;
  if (s.phase === 'pending') return 'Esperando entrada';
  if (s.phase === 'open') return s.stage === 1 ? 'Abierta' : 'Abierta (TP1 tomado, stop en entrada)';
  const map: Record<string, string> = {
    stop: 'Stop', tp1: 'TP1', 'tp1-be': 'TP1 + salida en entrada', tp2: 'TP2', liquidation: 'LIQUIDADA',
    expired: 'Vencida sin ejecutarse', invalidated: 'Invalidada (el precio se escapó)', timeout: 'Cerrada por tiempo (7 días)', open: 'Abierta',
  };
  return map[s.outcome] ?? s.outcome;
}
