'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Platform } from '@/lib/p2p/types';
import { LEGACY_NET } from '@/lib/p2p/fees';

export interface Settings {
  fees: Record<Platform, { maker: string; taker: string }>;
  net: string;
  wd: Record<Platform, string>;
  capArs: string;
  capUsdt: string;
  minMargin: string;
  step: string;
  minOrder: string;
  payTime: string;
  ref: Record<Platform, string>;
  methods: string[];
  filters: { merchantOnly: boolean; minFinish: string; minOrders: string; amount: string; outlier: string };
  mode: 'maker' | 'taker';
}

export const DEFAULT_SETTINGS: Settings = {
  fees: { binance: { maker: '', taker: '' }, mexc: { maker: '', taker: '' } },
  net: 'BSC', // código de red de Binance
  wd: { binance: '', mexc: '' },
  capArs: '',
  capUsdt: '',
  minMargin: '0.5',
  step: '0.10',
  minOrder: '',
  payTime: '15',
  ref: { binance: '', mexc: '' },
  methods: ['mercadopago', 'banco'],
  filters: { merchantOnly: true, minFinish: '95', minOrders: '50', amount: '', outlier: '3' },
  mode: 'maker',
};

const KEY = 'mesa-p2p.settings.v2';

function merge<T>(base: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const b = out[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, v);
    else if (Array.isArray(b)) out[k] = Array.isArray(v) ? v : b;
    else if (typeof v === typeof b) out[k] = v;
  }
  return out as T;
}

export function useSettings() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const loaded = merge(DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(KEY) ?? 'null'));
      setS({ ...loaded, net: LEGACY_NET[loaded.net] ?? loaded.net });
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [s, loaded]);
  const update = useCallback((fn: (s: Settings) => Settings) => setS((prev) => fn(prev)), []);
  return { s, update, loaded };
}
