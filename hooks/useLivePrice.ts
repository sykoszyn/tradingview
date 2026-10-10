'use client';
import { useEffect, useState } from 'react';
import type { Market, TradingSymbol } from '@/lib/types';
import { subscribeLivePrice, type LiveTick } from '@/lib/data/live-price';

export function useLivePrice(symbol: TradingSymbol, market: Market) {
  const [tick, setTick] = useState<LiveTick | null>(null);
  const [status, setStatus] = useState('Conectando…');
  useEffect(() => {
    setTick(null);
    const h = subscribeLivePrice(symbol, market, setTick, setStatus);
    return () => h.close();
  }, [symbol, market]);
  return { tick, status };
}
