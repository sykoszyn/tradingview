// Resumen persistente del último backtest: qué combinaciones setup/par/mercado
// tienen expectativa negativa ("no usar") y estado de la Fase 0.
import type { SetupType } from '../analysis/setups';
import type { Market, TradingSymbol } from '../types';
import { comboKey, type ReportRow } from './report';
import type { Stats } from './metrics';

export interface BacktestSummary {
  runAt: number;
  from: number;
  to: number;
  combos: Array<{ key: string; setup: SetupType; symbol: TradingSymbol; market: Market; trades: number; expectancyR: number; expectancyUSDT: number; doNotUse: boolean }>;
  overallR: Pick<Stats, 'trades' | 'expectancyR' | 'winRate' | 'totalR' | 'maxDrawdownR' | 'liquidations'>;
}

export function makeSummary(rows: ReportRow[], overall: Stats, from: number, to: number, now = Date.now()): BacktestSummary {
  return {
    runAt: now,
    from,
    to,
    combos: rows.map((r) => ({
      key: r.key,
      setup: r.setup,
      symbol: r.symbol,
      market: r.market,
      trades: r.stats.trades,
      expectancyR: r.stats.expectancyR,
      expectancyUSDT: r.stats.expectancy,
      doNotUse: r.doNotUse,
    })),
    overallR: {
      trades: overall.trades,
      expectancyR: overall.expectancyR,
      winRate: overall.winRate,
      totalR: overall.totalR,
      maxDrawdownR: overall.maxDrawdownR,
      liquidations: overall.liquidations,
    },
  };
}

/** ¿Se puede mostrar este setup en vivo? Oculto si el backtest dio expectativa negativa. */
export function isSetupAllowed(summary: BacktestSummary | null, setup: SetupType, symbol: TradingSymbol, market: Market): boolean {
  if (!summary) return true;
  const c = summary.combos.find((x) => x.key === comboKey(setup, symbol, market));
  return !c?.doNotUse;
}

/** Fase 0 aprobada: hay al menos un setup con expectativa positiva (después de comisiones y funding). */
export function positiveCombos(summary: BacktestSummary | null, minTrades = 1) {
  return summary?.combos.filter((c) => !c.doNotUse && c.trades >= minTrades && c.expectancyR > 0) ?? [];
}
