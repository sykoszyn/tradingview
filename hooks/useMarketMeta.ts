'use client';
// exchangeInfo (spot y futuros) + brackets: se cargan al iniciar y cada 1 hora.
// Binance cambia los mínimos sin aviso: nunca se hardcodean.
import { useCallback, useEffect, useState } from 'react';
import type { BracketSet, DataSource, Market, SymbolFilters, TradingSymbol } from '@/lib/types';
import { fetchBrackets, fetchExchangeInfo } from '@/lib/data/client';

export type FiltersByMarket = Record<Market, Partial<Record<TradingSymbol, SymbolFilters>>>;

export interface MarketMeta {
  filters: FiltersByMarket;
  filterSources: Partial<Record<Market, DataSource>>;
  brackets: Record<TradingSymbol, BracketSet> | null;
  errors: string[];
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
}

const HOUR = 60 * 60 * 1000;

export function useMarketMeta(): MarketMeta {
  const [filters, setFilters] = useState<FiltersByMarket>({ spot: {}, futures: {} });
  const [filterSources, setFilterSources] = useState<Partial<Record<Market, DataSource>>>({});
  const [brackets, setBrackets] = useState<Record<TradingSymbol, BracketSet> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async (bypassCache: boolean) => {
    setLoading(true);
    const errs: string[] = [];
    await Promise.all(
      (['spot', 'futures'] as const).map(async (m) => {
        try {
          const r = await fetchExchangeInfo(m, { bypassCache });
          setFilters((prev) => ({ ...prev, [m]: r.data }));
          setFilterSources((prev) => ({ ...prev, [m]: r.source }));
        } catch (e) {
          errs.push(`Mínimos de ${m}: ${(e as Error).message}`);
        }
      }),
    );
    try {
      setBrackets(await fetchBrackets({ bypassCache }));
    } catch (e) {
      errs.push(`Brackets: ${(e as Error).message}`);
    }
    setErrors(errs);
    setUpdatedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(false);
    const id = setInterval(() => void load(true), HOUR);
    return () => clearInterval(id);
  }, [load]);

  return { filters, filterSources, brackets, errors, loading, updatedAt, refresh: () => void load(true) };
}
