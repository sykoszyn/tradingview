// Cliente de datos para el navegador.
// Orden: ruta /api (Vercel gru1, incluye espejo) → navegador directo a Binance →
// /api con Bybit → navegador directo a Bybit. Cachea en memoria (velas ~60 s).
import type { BracketSet, Candle, DataSource, FundingRatePoint, Interval, Market, PremiumIndex, Sourced, SymbolFilters, TradingSymbol } from '../types';
import { SYMBOLS } from '../types';
import { conservativeBrackets } from '../market/brackets';
import { makeFetchJson, resolveResource, type ResourceParams } from './market-service';
import { safeStorage } from '../storage/safe-storage';

const browserFetchJson = makeFetchJson(() => ({ cache: 'no-store' }));

const memCache = new Map<string, { at: number; value: Sourced<unknown> }>();
const TTL: Record<ResourceParams['resource'], number> = {
  klines: 60_000,
  premium: 20_000,
  funding: 5 * 60_000,
  'exchange-info': 60 * 60_000,
  brackets: 60 * 60_000,
};

function toQuery(p: Omit<ResourceParams, 'resource'>): string {
  const o: Record<string, string> = { provider: p.provider, market: p.market, symbol: p.symbol };
  if (p.interval) o.interval = p.interval;
  if (p.limit !== undefined) o.limit = String(p.limit);
  if (p.startTime !== undefined) o.startTime = String(p.startTime);
  if (p.endTime !== undefined) o.endTime = String(p.endTime);
  return new URLSearchParams(o).toString();
}

async function viaApi<T>(p: ResourceParams): Promise<Sourced<T>> {
  const { resource, ...rest } = p;
  const res = await fetch(`/api/market/${resource}?${toQuery(rest)}`, { signal: AbortSignal.timeout(15000) });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as Sourced<T>;
}

/** Obtiene un recurso con toda la cadena de fallbacks. Lanza error solo si fallan todas. */
export async function getResource<T>(p: ResourceParams, opts: { bypassCache?: boolean; ttlMs?: number } = {}): Promise<Sourced<T>> {
  const key = JSON.stringify(p);
  const ttl = opts.ttlMs ?? TTL[p.resource];
  const hit = memCache.get(key);
  if (!opts.bypassCache && hit && Date.now() - hit.at < ttl) return hit.value as Sourced<T>;

  const errors: string[] = [];
  const attempts: Array<() => Promise<Sourced<T>>> = [
    () => viaApi<T>({ ...p, provider: 'binance' }),
    () => resolveResource({ ...p, provider: 'binance' }, browserFetchJson, 'browser') as Promise<Sourced<T>>,
  ];
  // Bybit solo como alternativa de futuros (y de brackets).
  if (p.market === 'futures' || p.resource === 'brackets') {
    attempts.push(
      () => viaApi<T>({ ...p, provider: 'bybit' }),
      () => resolveResource({ ...p, provider: 'bybit' }, browserFetchJson, 'browser') as Promise<Sourced<T>>,
    );
  }
  for (const run of attempts) {
    try {
      const r = await run();
      const value = { ...r, errors: [...errors, ...r.errors] };
      memCache.set(key, { at: Date.now(), value });
      return value;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`No se pudo obtener ${p.resource} (${p.market} ${p.symbol}). ${errors.join(' | ')}`);
}

export const fetchKlines = (symbol: TradingSymbol, market: Market, interval: Interval, extra: { limit?: number; startTime?: number; endTime?: number } = {}) =>
  getResource<Candle[]>({ resource: 'klines', provider: 'binance', market, symbol, interval, ...extra });

export const fetchPremium = (symbol: TradingSymbol) =>
  getResource<PremiumIndex>({ resource: 'premium', provider: 'binance', market: 'futures', symbol });

export const fetchFunding = (symbol: TradingSymbol, extra: { limit?: number; startTime?: number; endTime?: number } = {}) =>
  getResource<FundingRatePoint[]>({ resource: 'funding', provider: 'binance', market: 'futures', symbol, ...extra });

export const fetchExchangeInfo = (market: Market, opts: { bypassCache?: boolean } = {}) =>
  getResource<Partial<Record<TradingSymbol, SymbolFilters>>>({ resource: 'exchange-info', provider: 'binance', market, symbol: 'ETHUSDT' }, opts);

const BRACKET_CACHE_KEY = 'cpa.brackets.lastValid.v1';

/**
 * Brackets: endpoint público de Binance → Bybit → último valor válido guardado →
 * MMR conservador (con advertencia).
 */
export async function fetchBrackets(opts: { bypassCache?: boolean } = {}): Promise<Record<TradingSymbol, BracketSet>> {
  try {
    const r = await getResource<Partial<Record<TradingSymbol, BracketSet>>>(
      { resource: 'brackets', provider: 'binance', market: 'futures', symbol: 'ETHUSDT' },
      opts,
    );
    if (SYMBOLS.every((s) => r.data[s])) {
      safeStorage.setJSON(BRACKET_CACHE_KEY, r.data);
      return r.data as Record<TradingSymbol, BracketSet>;
    }
    throw new Error('brackets incompletos');
  } catch {
    const cached = safeStorage.getJSON<Partial<Record<TradingSymbol, BracketSet>>>(BRACKET_CACHE_KEY);
    const out = {} as Record<TradingSymbol, BracketSet>;
    for (const s of SYMBOLS) {
      const c = cached?.[s];
      out[s] = c
        ? {
            ...c,
            source: 'cache',
            warning: `Brackets del ${new Date(c.fetchedAt).toLocaleString('es-AR')} (último valor válido guardado). No se pudieron actualizar.`,
          }
        : conservativeBrackets(s);
    }
    return out;
  }
}

export const SOURCE_LABEL: Record<DataSource, string> = {
  'binance-server': 'Binance (servidor gru1)',
  'binance-mirror': 'Binance (espejo www.binance.com)',
  'binance-browser': 'Binance (directo desde el navegador)',
  'bybit-server': 'Bybit (servidor) — alternativa',
  'bybit-browser': 'Bybit (navegador) — alternativa',
  cache: 'Cache local',
  conservative: 'Valor conservador',
  synthetic: 'Datos sintéticos',
};
