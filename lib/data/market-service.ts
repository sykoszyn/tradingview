// Resuelve cada recurso de mercado probando fuentes en orden.
// Lo usan las rutas /api (servidor, con fetch de Next cacheado) y el cliente
// del navegador (fallback directo). Cada llamada indica qué fuente funcionó.
import type { DataSource, Interval, Market, TradingSymbol } from '../types';
import { SYMBOLS } from '../types';
import {
  BINANCE_FUTURES_BASE,
  BINANCE_FUTURES_MIRROR,
  binanceExchangeInfo,
  binanceFundingRates,
  binanceKlines,
  binancePremiumIndex,
  binancePublicBrackets,
  bybitBrackets,
  bybitExchangeInfo,
  bybitFundingRates,
  bybitKlines,
  bybitPremiumIndex,
  firstSuccessful,
  type FetchJson,
} from './providers';

export type Provider = 'binance' | 'bybit';
export type Where = 'server' | 'browser';

export interface ResourceParams {
  resource: 'klines' | 'premium' | 'funding' | 'exchange-info' | 'brackets';
  provider: Provider;
  market: Market;
  symbol: TradingSymbol;
  interval?: Interval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

const VALID_INTERVALS: Interval[] = ['1m', '15m', '1h', '4h'];

/** Valida query params (lista blanca: solo estos símbolos, mercados e intervalos). */
export function parseResourceParams(resource: string, sp: URLSearchParams): ResourceParams {
  const resources = ['klines', 'premium', 'funding', 'exchange-info', 'brackets'] as const;
  if (!resources.includes(resource as never)) throw new Error(`Recurso no permitido: ${resource}`);
  const provider = (sp.get('provider') ?? 'binance') as Provider;
  if (provider !== 'binance' && provider !== 'bybit') throw new Error('provider inválido');
  const market = (sp.get('market') ?? 'futures') as Market;
  if (market !== 'spot' && market !== 'futures') throw new Error('market inválido');
  const symbol = (sp.get('symbol') ?? 'ETHUSDT') as TradingSymbol;
  if (!SYMBOLS.includes(symbol)) throw new Error('símbolo no permitido');
  const interval = (sp.get('interval') ?? undefined) as Interval | undefined;
  if (interval && !VALID_INTERVALS.includes(interval)) throw new Error('intervalo no permitido');
  const n = (k: string) => {
    const v = sp.get(k);
    if (v === null || v === '') return undefined;
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new Error(`${k} inválido`);
    return Math.floor(x);
  };
  return { resource: resource as ResourceParams['resource'], provider, market, symbol, interval, limit: n('limit'), startTime: n('startTime'), endTime: n('endTime') };
}

/**
 * Ejecuta el recurso con la cadena de fuentes correspondiente:
 * - Binance futuros desde el servidor: fapi oficial → espejo www.binance.com.
 * - Binance desde el navegador: api oficial.
 * - Bybit: api pública v5.
 */
export async function resolveResource(p: ResourceParams, fetchJson: FetchJson, where: Where) {
  const futBases: Array<{ base: string; source: DataSource }> =
    where === 'server'
      ? [
          { base: BINANCE_FUTURES_BASE, source: 'binance-server' },
          { base: BINANCE_FUTURES_MIRROR, source: 'binance-mirror' },
        ]
      : [{ base: BINANCE_FUTURES_BASE, source: 'binance-browser' }];
  const bybitSource: DataSource = where === 'server' ? 'bybit-server' : 'bybit-browser';
  const spotSource: DataSource = where === 'server' ? 'binance-server' : 'binance-browser';

  const viaBinance = <T>(run: (base: string) => Promise<T>) =>
    p.market === 'spot'
      ? firstSuccessful([{ source: spotSource, run: () => run(BINANCE_FUTURES_BASE) }])
      : firstSuccessful(futBases.map((b) => ({ source: b.source, run: () => run(b.base) })));
  const viaBybit = <T>(run: () => Promise<T>) => firstSuccessful([{ source: bybitSource, run }]);

  switch (p.resource) {
    case 'klines': {
      if (!p.interval) throw new Error('falta interval');
      const q = { symbol: p.symbol, market: p.market, interval: p.interval, limit: p.limit, startTime: p.startTime, endTime: p.endTime };
      return p.provider === 'binance' ? viaBinance((base) => binanceKlines(fetchJson, q, base)) : viaBybit(() => bybitKlines(fetchJson, q));
    }
    case 'premium':
      return p.provider === 'binance'
        ? viaBinance((base) => binancePremiumIndex(fetchJson, p.symbol, base))
        : viaBybit(() => bybitPremiumIndex(fetchJson, p.symbol));
    case 'funding': {
      const o = { startTime: p.startTime, endTime: p.endTime, limit: p.limit };
      return p.provider === 'binance'
        ? viaBinance((base) => binanceFundingRates(fetchJson, p.symbol, o, base))
        : viaBybit(() => bybitFundingRates(fetchJson, p.symbol, o));
    }
    case 'exchange-info':
      return p.provider === 'binance'
        ? viaBinance((base) => binanceExchangeInfo(fetchJson, p.market, SYMBOLS, base))
        : viaBybit(() => bybitExchangeInfo(fetchJson, p.market, SYMBOLS));
    case 'brackets':
      return p.provider === 'binance'
        ? firstSuccessful([{ source: (where === 'server' ? 'binance-server' : 'binance-browser') as DataSource, run: () => binancePublicBrackets(fetchJson, SYMBOLS) }])
        : viaBybit(async () => {
            const out: Record<string, unknown> = {};
            for (const s of SYMBOLS) out[s] = await bybitBrackets(fetchJson, s);
            return out;
          });
  }
}

/** fetchJson con timeout y error legible (incluye el mensaje de bloqueo geográfico de Binance). */
export function makeFetchJson(init?: (opts?: { revalidate?: number }) => RequestInit, timeoutMs = 9000): FetchJson {
  return async (url, opts) => {
    const res = await fetch(url, { ...(init?.(opts) ?? {}), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 160);
      try {
        msg = (JSON.parse(text) as { msg?: string }).msg ?? msg;
      } catch {}
      throw new Error(`HTTP ${res.status}${res.status === 451 || res.status === 403 ? ' (ubicación bloqueada)' : ''}: ${msg}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Respuesta no JSON: ${text.slice(0, 80)}`);
    }
  };
}
