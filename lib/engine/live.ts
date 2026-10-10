// Señales en vivo: planes de las últimas velas de señal que siguen esperando
// entrada (no vencieron, no se invalidaron, no se llenaron). Función pura.
import type { AppConfig, PhaseLimits } from '../config/defaults';
import type { BracketSet, Candle, Market, SymbolFilters, TradingSymbol } from '../types';
import { signalSeries, type AnalysisContext, type PreparedSeries } from '../analysis/context';
import { lastClosedIndex } from '../analysis/trend';
import type { PlanResult, TradePlan } from '../plan/plan';
import { simulatePlan } from './simulate';
import { planSignal, signalsAt } from './evaluate';
import { simPlanFrom } from '../journal/paper';

export interface LiveScan {
  context: AnalysisContext | null;
  /** Planes aún válidos (esperando entrada), más nuevos primero. */
  active: TradePlan[];
  /** Señales descartadas en la última vela (para mostrar por qué). */
  discarded: Extract<PlanResult, { kind: 'discarded' }>[];
  lastSignalCandle: Candle | null;
}

export function scanLive(inp: {
  prepared: PreparedSeries;
  cfg: AppConfig;
  symbol: TradingSymbol;
  market: Market;
  filters: SymbolFilters;
  brackets?: BracketSet;
  funding?: { rate: number; intervalHours: number; nextFundingTime?: number };
  phase: PhaseLimits;
  now: number;
}): LiveScan {
  const { prepared, cfg } = inp;
  const candles = signalSeries(prepared, cfg).candles;
  const last = lastClosedIndex(candles, inp.now);
  if (last < 2) return { context: null, active: [], discarded: [], lastSignalCandle: null };
  const active: TradePlan[] = [];
  let discarded: LiveScan['discarded'] = [];
  let context: AnalysisContext | null = null;
  for (let i = last; i >= Math.max(2, last - cfg.plan.expiryCandles); i--) {
    const { context: ctx, signals } = signalsAt(prepared, i, inp.market, cfg);
    if (i === last) context = ctx;
    const results = signals.map((s) =>
      planSignal(s, ctx, { symbol: inp.symbol, market: inp.market, filters: inp.filters, cfg, phase: inp.phase, brackets: inp.brackets, funding: inp.funding }),
    );
    if (i === last) discarded = results.filter((r): r is Extract<PlanResult, { kind: 'discarded' }> => r.kind === 'discarded');
    for (const r of results) {
      if (r.kind !== 'plan' || r.plan.expiresAt <= inp.now) continue;
      // ¿Sigue esperando entrada? Se simula con las velas de 1h posteriores a la señal.
      const start = prepared.c1h.findIndex((c) => c.openTime > r.plan.signalTime);
      if (start >= 0) {
        const sim = simulatePlan({ ...simPlanFrom(r.plan, cfg), qty: r.plan.sizing.qty || 1 }, prepared.c1h, start);
        if (sim.state.phase !== 'pending') continue;
      }
      active.push(r.plan);
    }
  }
  return { context, active, discarded, lastSignalCandle: candles[last] };
}
