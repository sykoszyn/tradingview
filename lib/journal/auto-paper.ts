// Paper trading automático: simula TODAS las señales operables de la estrategia
// activa desde que se activó. Así la muestra no tiene sesgo de selección y cuenta
// como validación fuera de muestra (ver live-validation.ts).
import type { AppConfig, PhaseLimits } from '../config/defaults';
import type { BracketSet, Market, SymbolFilters, TradingSymbol } from '../types';
import { signalSeries, type PreparedSeries } from '../analysis/context';
import { planSignal, signalsAt } from '../engine/evaluate';
import type { TradePlan } from '../plan/plan';

export const autoKey = (symbol: TradingSymbol, market: Market) => `${symbol}|${market}`;

/**
 * Primera vela de señal CERRADA después de `after` (y hasta `now`) con un plan
 * operable. Devuelve el mejor plan de esa vela (mayor confianza y R:R).
 */
export function nextAutoPlan(inp: {
  prepared: PreparedSeries;
  cfg: AppConfig;
  symbol: TradingSymbol;
  market: Market;
  filters: SymbolFilters;
  brackets?: BracketSet;
  phase: PhaseLimits;
  after: number;
  now: number;
}): { plan: TradePlan | null; scannedUntil: number } {
  const candles = signalSeries(inp.prepared, inp.cfg).candles;
  let scanned = inp.after;
  for (let i = 2; i < candles.length; i++) {
    const c = candles[i];
    if (c.closeTime <= inp.after) continue;
    if (c.closeTime > inp.now) break;
    scanned = c.closeTime;
    const { context, signals } = signalsAt(inp.prepared, i, inp.market, inp.cfg);
    const plans = signals
      .map((s) => planSignal(s, context, { symbol: inp.symbol, market: inp.market, filters: inp.filters, cfg: inp.cfg, phase: inp.phase, brackets: inp.brackets }))
      .flatMap((r) => (r.kind === 'plan' && r.plan.status === 'operable' ? [r.plan] : []));
    if (plans.length) {
      const score = (p: TradePlan) => ({ alta: 3, media: 2, baja: 1 })[p.confidence] * 10 + p.rrTp1;
      return { plan: plans.sort((a, b) => score(b) - score(a))[0], scannedUntil: c.closeTime };
    }
  }
  return { plan: null, scannedUntil: scanned };
}
