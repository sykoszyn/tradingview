'use client';
// Lee /api/p2p al abrir y cada 60 s. Si una lectura falla, NO se reutilizan los datos anteriores.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketResponse } from '@/lib/p2p/types';

export const REFRESH_MS = 60_000;
/** Datos más viejos que esto no se usan en los cálculos (por ejemplo, si el celular estuvo bloqueado). */
export const STALE_MS = 150_000;

export function useMarket() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/p2p', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as MarketResponse);
      setError(null);
    } catch (e) {
      setData(null); // nunca calcular con valores viejos
      setError(`No se pudo leer el mercado (${(e as Error).message}).`);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const stale = data ? now - data.fetchedAt > STALE_MS : false;
  return { data, error, loading, stale, refresh: load, now };
}
