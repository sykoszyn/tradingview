'use client';
import { useEffect, useState } from 'react';
import type { Candle, DataSource, Interval, Market, TradingSymbol } from '@/lib/types';
import { fetchKlines } from '@/lib/data/client';

export function useChartCandles(symbol: TradingSymbol, market: Market, interval: Interval) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [source, setSource] = useState<DataSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetchKlines(symbol, market, interval, { limit: 300 });
        if (!alive) return;
        setCandles(r.data);
        setSource(r.source);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, market, interval]);
  return { candles, source, error };
}
