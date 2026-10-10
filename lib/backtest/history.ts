// Descarga paginada de historial (velas y funding) para el backtest.
import type { Candle, FundingRatePoint, Interval, Market, TradingSymbol } from '../types';
import { INTERVAL_MS, KLINE_LIMIT } from '../data/providers';

export type KlinePager = (q: { symbol: TradingSymbol; market: Market; interval: Interval; startTime: number; limit: number }) => Promise<Candle[]>;
export type FundingPager = (q: { symbol: TradingSymbol; startTime: number; limit: number }) => Promise<FundingRatePoint[]>;

/** Velas entre `from` y `to` (solo cerradas: closeTime ≤ to), sin duplicados. */
export async function fetchKlineRange(
  pager: KlinePager,
  symbol: TradingSymbol,
  market: Market,
  interval: Interval,
  from: number,
  to: number,
  onPage?: () => void,
): Promise<Candle[]> {
  const limit = KLINE_LIMIT[market];
  const step = INTERVAL_MS[interval];
  const out: Candle[] = [];
  let start = from;
  for (let guard = 0; guard < 1000 && start < to; guard++) {
    const page = await pager({ symbol, market, interval, startTime: start, limit });
    onPage?.();
    if (!page.length) break;
    for (const c of page) if (c.closeTime <= to && (!out.length || c.openTime > out[out.length - 1].openTime)) out.push(c);
    const last = page[page.length - 1].openTime;
    if (last + step <= start) break;
    start = last + step;
    if (page.length < Math.min(limit, 500) && start >= to - step) break;
  }
  return out;
}

export async function fetchFundingRange(pager: FundingPager, symbol: TradingSymbol, from: number, to: number): Promise<FundingRatePoint[]> {
  const out: FundingRatePoint[] = [];
  let start = from;
  for (let guard = 0; guard < 200 && start < to; guard++) {
    const page = await pager({ symbol, startTime: start, limit: 1000 });
    if (!page.length) break;
    for (const p of page) if (p.fundingTime <= to && (!out.length || p.fundingTime > out[out.length - 1].fundingTime)) out.push(p);
    const last = page[page.length - 1].fundingTime;
    if (last + 1 <= start) break;
    start = last + 1;
    if (page.length < 1000) break;
  }
  return out;
}

/** Ventanas de 15m sin resolver → velas de 1m (una petición por ventana, máximo `cap`). */
export async function fetchMinuteWindows(
  pager: KlinePager,
  symbol: TradingSymbol,
  market: Market,
  windows: Array<{ from: number; to: number }>,
  cap = 400,
): Promise<Record<number, Candle[]>> {
  const out: Record<number, Candle[]> = {};
  const uniq = [...new Map(windows.map((w) => [w.from, w])).values()].slice(0, cap);
  for (const w of uniq) {
    const page = await pager({ symbol, market, interval: '1m', startTime: w.from, limit: 15 });
    out[w.from] = page.filter((c) => c.openTime >= w.from && c.closeTime <= w.to);
  }
  return out;
}
