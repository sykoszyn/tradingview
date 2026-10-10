'use client';
// Último precio de cada par (para la tabla de mínimos), refrescado cada 60 s.
import { useEffect, useState } from 'react';
import { SYMBOLS, type Market, type TradingSymbol } from '@/lib/types';
import { fetchKlines } from '@/lib/data/client';

export function usePairPrices(market: Market) {
  const [prices, setPrices] = useState<Partial<Record<TradingSymbol, number>>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const entries = await Promise.all(
          SYMBOLS.map(async (s) => {
            const r = await fetchKlines(s, market, '1m', { limit: 1 });
            return [s, r.data[r.data.length - 1]?.close] as const;
          }),
        );
        if (alive) {
          setPrices(Object.fromEntries(entries));
          setError(null);
        }
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
  }, [market]);
  return { prices, error };
}
