'use client';
import { useEffect, useState } from 'react';
import type { FeesResponse } from '@/lib/p2p/fees';

/** Comisiones de retiro (Binance en vivo). Se pide al abrir y cada 1 hora. */
export function useFees() {
  const [fees, setFees] = useState<FeesResponse | null>(null);
  useEffect(() => {
    const load = () =>
      fetch('/api/fees', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: FeesResponse) => setFees(d))
        .catch(() => setFees(null));
    void load();
    const id = setInterval(load, 3_600_000);
    return () => clearInterval(id);
  }, []);
  return fees;
}
