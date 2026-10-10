// Pipeline único señal → plan. Lo usan las señales en vivo y el backtest,
// así las reglas son exactamente las mismas en los dos.
import type { AppConfig, PhaseLimits } from '../config/defaults';
import type { BracketSet, Market, SymbolFilters, TradingSymbol } from '../types';
import { contextAt, signalSeries, type AnalysisContext, type PreparedSeries } from '../analysis/context';
import { detectSetups, type SetupSignal } from '../analysis/setups';
import { buildPlan, type PlanExtension, type PlanResult } from '../plan/plan';
import { fundingExtension, liquidationExtension } from '../plan/extensions';

export interface EvaluateInput {
  prepared: PreparedSeries;
  /** Índice de la última vela CERRADA de la temporalidad de señal (1h o 4h). */
  i: number;
  symbol: TradingSymbol;
  market: Market;
  filters: SymbolFilters;
  cfg: AppConfig;
  phase: PhaseLimits;
  brackets?: BracketSet;
  funding?: { rate: number; intervalHours: number; nextFundingTime?: number };
}

export function futuresExtensions(market: Market, brackets?: BracketSet, funding?: EvaluateInput['funding']): PlanExtension[] {
  if (market !== 'futures') return [];
  const ext: PlanExtension[] = [];
  if (brackets) ext.push(liquidationExtension(brackets));
  if (funding) ext.push(fundingExtension(funding.rate, funding.intervalHours, funding.nextFundingTime));
  return ext;
}

export function signalsAt(prepared: PreparedSeries, i: number, market: Market, cfg: AppConfig): { context: AnalysisContext; signals: SetupSignal[] } {
  const sig = signalSeries(prepared, cfg);
  const c = sig.candles[i];
  const context = contextAt(prepared, c.closeTime, c.close, cfg);
  const signals = detectSetups({ candles: sig.candles, i, zones: context.zones, trend: context.trend, market, cfg, atr: sig.atr[i] });
  return { context, signals };
}

export function planSignal(signal: SetupSignal, context: AnalysisContext, inp: Omit<EvaluateInput, 'prepared' | 'i'>): PlanResult {
  return buildPlan({
    signal,
    symbol: inp.symbol,
    market: inp.market,
    zones: context.zones,
    filters: inp.filters,
    cfg: inp.cfg,
    phase: inp.phase,
    extensions: futuresExtensions(inp.market, inp.brackets, inp.funding),
  });
}

export function evaluateAt(inp: EvaluateInput): { context: AnalysisContext; signals: SetupSignal[]; results: PlanResult[] } {
  const { context, signals } = signalsAt(inp.prepared, inp.i, inp.market, inp.cfg);
  return { context, signals, results: signals.map((s) => planSignal(s, context, inp)) };
}
