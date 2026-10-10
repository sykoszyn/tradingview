'use client';
// Señales en vivo para ambos pares del mercado elegido (para poder sugerir ETHUSDT
// cuando BTCUSDT no es operable en tu fase). Se refresca cada 60 s.
import { useCallback, useEffect, useState } from 'react';
import type { AppConfig, PhaseLimits } from '@/lib/config/defaults';
import { SYMBOLS, type Candle, type DataSource, type Market, type TradingSymbol } from '@/lib/types';
import { fetchFunding, fetchKlines, fetchPremium } from '@/lib/data/client';
import { prepareSeries } from '@/lib/analysis/context';
import { fundingIntervalHours } from '@/lib/plan/funding';
import { scanLive, type LiveScan } from '@/lib/engine/live';
import type { MarketMeta } from './useMarketMeta';

export interface SymbolScan extends LiveScan {
  symbol: TradingSymbol;
  c1h: Candle[];
  c4h: Candle[];
  source: DataSource;
  fundingRate?: number;
}

export function useLiveSignals(market: Market, cfg: AppConfig, meta: MarketMeta, phase: PhaseLimits | null) {
  const [scans, setScans] = useState<Partial<Record<TradingSymbol, SymbolScan>>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!phase) return;
    const errs: string[] = [];
    const out: Partial<Record<TradingSymbol, SymbolScan>> = {};
    await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          const now = Date.now();
          const [h1, h4] = await Promise.all([fetchKlines(symbol, market, '1h', { limit: 1000 }), fetchKlines(symbol, market, '4h', { limit: 1000 })]);
          const c1h = h1.data.filter((c) => c.closeTime <= now);
          const c4h = h4.data.filter((c) => c.closeTime <= now);
          const filters = meta.filters[market][symbol];
          let funding: { rate: number; intervalHours: number; nextFundingTime?: number } | undefined;
          if (market === 'futures') {
            try {
              const [prem, hist] = await Promise.all([fetchPremium(symbol), fetchFunding(symbol, { limit: 30 })]);
              funding = { rate: prem.data.lastFundingRate, intervalHours: fundingIntervalHours(hist.data), nextFundingTime: prem.data.nextFundingTime };
            } catch (e) {
              errs.push(`Funding ${symbol}: ${(e as Error).message}`);
            }
          }
          const prepared = prepareSeries(c1h, c4h, cfg);
          const scan: LiveScan = filters
            ? scanLive({ prepared, cfg, symbol, market, filters, brackets: meta.brackets?.[symbol], funding, phase, now })
            : { context: null, active: [], discarded: [], lastSignalCandle: null };
          if (!filters) errs.push(`Sin mínimos de ${symbol}: no se pueden armar planes.`);
          out[symbol] = { ...scan, symbol, c1h, c4h, source: h1.source, fundingRate: funding?.rate };
        } catch (e) {
          errs.push(`${symbol}: ${(e as Error).message}`);
        }
      }),
    );
    setScans(out);
    setErrors(errs);
    setLoading(false);
    setUpdatedAt(Date.now());
  }, [market, cfg, meta.filters, meta.brackets, phase]);

  useEffect(() => {
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  return { scans, errors, loading, updatedAt, refresh: load };
}
