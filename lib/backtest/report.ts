// Tablas de resultados del backtest (agrupadas por setup, par, mercado y dirección).
import { SETUP_LABEL, type SetupType } from '../analysis/setups';
import type { Direction, Market, TradingSymbol } from '../types';
import { computeStats, type Stats } from './metrics';
import type { BacktestResult, Track } from './run';

export interface ReportRow {
  key: string;
  setup: SetupType;
  symbol: TradingSymbol;
  market: Market;
  direction: Direction;
  stats: Stats;
  discardedByMinimums: number;
  notFilled: number;
  /** Expectativa negativa (en R, después de comisiones y funding) → "no usar". */
  doNotUse: boolean;
}

export const comboKey = (setup: string, symbol: string, market: string) => `${setup}|${symbol}|${market}`;

export function buildReport(res: BacktestResult, track: Track): { rows: ReportRow[]; overall: Stats } {
  const trades = res.trades.filter((t) => t.track === track);
  const keys = new Set<string>();
  for (const t of trades) keys.add(comboKey(t.setup, t.symbol, t.market));
  for (const d of res.discards) if (d.track === track && d.code === 'minimos') keys.add(comboKey(d.setup, d.symbol, d.market));
  const rows: ReportRow[] = [...keys].map((key) => {
    const [setup, symbol, market] = key.split('|') as [SetupType, TradingSymbol, Market];
    const tt = trades.filter((t) => comboKey(t.setup, t.symbol, t.market) === key);
    const stats = computeStats(tt);
    return {
      key,
      setup,
      symbol,
      market,
      direction: setup.startsWith('rebote') || setup.startsWith('recuperacion') || setup === 'ruptura-resistencia' ? 'long' : 'short',
      stats,
      discardedByMinimums: res.discards.filter((d) => d.track === track && d.code === 'minimos' && comboKey(d.setup, d.symbol, d.market) === key).length,
      notFilled: res.notFilled.filter((n) => n.track === track && comboKey(n.setup, n.symbol, n.market) === key).length,
      doNotUse: stats.trades > 0 && stats.expectancyR <= 0,
    };
  });
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.market.localeCompare(b.market) || a.setup.localeCompare(b.setup));
  return { rows, overall: computeStats(trades) };
}

export function reportToText(res: BacktestResult): string {
  const lines: string[] = [];
  const pad = (s: string | number, n: number) => String(s).padEnd(n);
  const padL = (s: string | number, n: number) => String(s).padStart(n);
  for (const track of ['r', 'usdt'] as const) {
    const { rows, overall } = buildReport(res, track);
    lines.push('', track === 'r' ? '=== Carril R (sin límites de tamaño, mide el sistema) ===' : '=== Carril USDT (tamaño de Fase 2: 10 USDT, 2x) ===');
    lines.push(
      `${pad('Par', 8)} ${pad('Merc.', 7)} ${pad('Setup', 34)} ${padL('Trades', 6)} ${padL('Acierto', 7)} ${padL('R:R', 5)} ${padL('Exp R', 6)} ${padL('Tot R', 6)} ${padL('DD R', 5)} ${padL('Exp USDT', 9)} ${padL('Tot USDT', 9)} ${padL('DD', 6)} ${padL('Liq', 3)} ${padL('Mín', 4)}  `,
    );
    for (const r of rows) {
      const s = r.stats;
      lines.push(
        `${pad(r.symbol, 8)} ${pad(r.market, 7)} ${pad(SETUP_LABEL[r.setup], 34)} ${padL(s.trades, 6)} ${padL((s.winRate * 100).toFixed(0) + '%', 7)} ${padL(s.avgRR === Infinity ? '∞' : s.avgRR.toFixed(2), 5)} ${padL(s.expectancyR.toFixed(2), 6)} ${padL(s.totalR.toFixed(1), 6)} ${padL(s.maxDrawdownR.toFixed(1), 5)} ${padL(s.expectancy.toFixed(3), 9)} ${padL(s.total.toFixed(2), 9)} ${padL(s.maxDrawdown.toFixed(2), 6)} ${padL(s.liquidations, 3)} ${padL(r.discardedByMinimums, 4)}  ${r.doNotUse ? 'NO USAR' : ''}`,
      );
    }
    const o = overall;
    lines.push(
      `TOTAL: ${o.trades} trades · acierto ${(o.winRate * 100).toFixed(1)}% · R:R ${o.avgRR.toFixed(2)} · expectativa ${o.expectancyR.toFixed(3)} R (${o.expectancy.toFixed(3)} USDT) · total ${o.totalR.toFixed(1)} R (${o.total.toFixed(2)} USDT) · DD máx ${o.maxDrawdownR.toFixed(1)} R (${o.maxDrawdown.toFixed(2)} USDT) · liquidaciones ${o.liquidations}`,
    );
  }
  return lines.join('\n');
}
