// Acceso a las APIs públicas. Las mismas funciones corren en el servidor (rutas /api)
// y en el navegador (fallback directo); solo cambia la función `fetchJson` y la base.
import type { BracketSet, Candle, FundingRatePoint, Interval, Market, PremiumIndex, SymbolFilters, TradingSymbol } from '../types';
import { parseBinanceExchangeInfo, parseBybitInstruments } from '../market/filters';
import { parseBinancePublicBrackets, parseBybitRiskLimit } from '../market/brackets';

export type FetchJson = (url: string, opts?: { revalidate?: number }) => Promise<unknown>;

export const BINANCE_SPOT_BASE = 'https://data-api.binance.vision';
export const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
/** Espejo público de fapi servido por www.binance.com (útil si fapi bloquea la IP). */
export const BINANCE_FUTURES_MIRROR = 'https://www.binance.com';
export const BINANCE_BRACKETS_URL = 'https://www.binance.com/bapi/futures/v1/friendly/future/common/brackets';
export const BYBIT_BASE = 'https://api.bybit.com';

export const KLINE_LIMIT = { spot: 1000, futures: 1500, bybit: 1000 } as const;

export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

export interface KlineQuery {
  symbol: TradingSymbol;
  market: Market;
  interval: Interval;
  limit?: number;
  startTime?: number;
  endTime?: number;
}

const f = (v: unknown) => parseFloat(String(v));

/** Velas de Binance (spot o futuros) → Candle[] ordenadas de más vieja a más nueva. */
export function parseBinanceKlines(json: unknown): Candle[] {
  if (!Array.isArray(json)) throw new Error('klines: respuesta inesperada');
  return json.map((k: unknown[]) => ({
    openTime: Number(k[0]),
    open: f(k[1]),
    high: f(k[2]),
    low: f(k[3]),
    close: f(k[4]),
    volume: f(k[5]),
    closeTime: Number(k[6]),
  }));
}

export function parseBybitKlines(json: unknown, interval: Interval): Candle[] {
  const list = (json as { result?: { list?: string[][] } })?.result?.list;
  if (!Array.isArray(list)) throw new Error('Bybit kline: respuesta inesperada');
  const ms = INTERVAL_MS[interval];
  return list
    .map((k) => ({
      openTime: Number(k[0]),
      open: f(k[1]),
      high: f(k[2]),
      low: f(k[3]),
      close: f(k[4]),
      volume: f(k[5]),
      closeTime: Number(k[0]) + ms - 1,
    }))
    .sort((a, b) => a.openTime - b.openTime);
}

export function parsePremiumIndex(json: unknown): PremiumIndex {
  const j = json as Record<string, string | number>;
  if (!j || j.markPrice === undefined) throw new Error('premiumIndex: respuesta inesperada');
  return {
    symbol: j.symbol as TradingSymbol,
    markPrice: f(j.markPrice),
    indexPrice: f(j.indexPrice),
    lastFundingRate: f(j.lastFundingRate),
    nextFundingTime: Number(j.nextFundingTime),
    time: Number(j.time),
  };
}

export function parseFundingRates(json: unknown): FundingRatePoint[] {
  if (!Array.isArray(json)) throw new Error('fundingRate: respuesta inesperada');
  return json
    .map((r: { fundingTime: number; fundingRate: string }) => ({ fundingTime: Number(r.fundingTime), fundingRate: f(r.fundingRate) }))
    .sort((a, b) => a.fundingTime - b.fundingTime);
}

const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

// ---------- Binance ----------

export function binanceKlinesUrl(q: KlineQuery, futuresBase = BINANCE_FUTURES_BASE): string {
  const limit = Math.min(q.limit ?? 500, KLINE_LIMIT[q.market]);
  const params = qs({ symbol: q.symbol, interval: q.interval, limit, startTime: q.startTime, endTime: q.endTime });
  return q.market === 'spot' ? `${BINANCE_SPOT_BASE}/api/v3/klines?${params}` : `${futuresBase}/fapi/v1/klines?${params}`;
}

export async function binanceKlines(fetchJson: FetchJson, q: KlineQuery, futuresBase?: string): Promise<Candle[]> {
  return parseBinanceKlines(await fetchJson(binanceKlinesUrl(q, futuresBase), { revalidate: 60 }));
}

export async function binancePremiumIndex(fetchJson: FetchJson, symbol: TradingSymbol, base = BINANCE_FUTURES_BASE) {
  return parsePremiumIndex(await fetchJson(`${base}/fapi/v1/premiumIndex?symbol=${symbol}`, { revalidate: 30 }));
}

export async function binanceFundingRates(
  fetchJson: FetchJson,
  symbol: TradingSymbol,
  opts: { startTime?: number; endTime?: number; limit?: number },
  base = BINANCE_FUTURES_BASE,
) {
  const params = qs({ symbol, startTime: opts.startTime, endTime: opts.endTime, limit: Math.min(opts.limit ?? 1000, 1000) });
  return parseFundingRates(await fetchJson(`${base}/fapi/v1/fundingRate?${params}`, { revalidate: 300 }));
}

export async function binanceExchangeInfo(
  fetchJson: FetchJson,
  market: Market,
  symbols: readonly TradingSymbol[],
  futuresBase = BINANCE_FUTURES_BASE,
): Promise<Partial<Record<TradingSymbol, SymbolFilters>>> {
  const url =
    market === 'spot'
      ? `${BINANCE_SPOT_BASE}/api/v3/exchangeInfo?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
      : `${futuresBase}/fapi/v1/exchangeInfo`;
  return parseBinanceExchangeInfo(await fetchJson(url, { revalidate: 3600 }), market, symbols);
}

export async function binancePublicBrackets(fetchJson: FetchJson, symbols: readonly TradingSymbol[]) {
  return parseBinancePublicBrackets(await fetchJson(BINANCE_BRACKETS_URL, { revalidate: 3600 }), symbols);
}

// ---------- Bybit (alternativa) ----------

const BYBIT_INTERVAL: Record<Interval, string> = { '1m': '1', '15m': '15', '1h': '60', '4h': '240' };
const bybitCategory = (m: Market) => (m === 'spot' ? 'spot' : 'linear');

async function bybitGet(fetchJson: FetchJson, path: string, revalidate: number) {
  const json = (await fetchJson(`${BYBIT_BASE}${path}`, { revalidate })) as { retCode?: number; retMsg?: string };
  if (json?.retCode !== 0) throw new Error(`Bybit: ${json?.retMsg ?? 'error'}`);
  return json;
}

export async function bybitKlines(fetchJson: FetchJson, q: KlineQuery): Promise<Candle[]> {
  const limit = Math.min(q.limit ?? 500, KLINE_LIMIT.bybit);
  const params = qs({
    category: bybitCategory(q.market),
    symbol: q.symbol,
    interval: BYBIT_INTERVAL[q.interval],
    limit,
    start: q.startTime,
    end: q.endTime,
  });
  return parseBybitKlines(await bybitGet(fetchJson, `/v5/market/kline?${params}`, 60), q.interval);
}

export async function bybitPremiumIndex(fetchJson: FetchJson, symbol: TradingSymbol): Promise<PremiumIndex> {
  const json = (await bybitGet(fetchJson, `/v5/market/tickers?category=linear&symbol=${symbol}`, 30)) as {
    result: { list: Array<Record<string, string>> };
    time: number;
  };
  const t = json.result.list[0];
  if (!t) throw new Error('Bybit tickers sin datos');
  return {
    symbol,
    markPrice: f(t.markPrice),
    indexPrice: f(t.indexPrice),
    lastFundingRate: f(t.fundingRate),
    nextFundingTime: Number(t.nextFundingTime),
    time: Number(json.time),
  };
}

export async function bybitFundingRates(
  fetchJson: FetchJson,
  symbol: TradingSymbol,
  opts: { startTime?: number; endTime?: number; limit?: number },
): Promise<FundingRatePoint[]> {
  const params = qs({ category: 'linear', symbol, startTime: opts.startTime, endTime: opts.endTime, limit: Math.min(opts.limit ?? 200, 200) });
  const json = (await bybitGet(fetchJson, `/v5/market/funding/history?${params}`, 300)) as {
    result: { list: Array<{ fundingRate: string; fundingRateTimestamp: string }> };
  };
  return json.result.list
    .map((r) => ({ fundingTime: Number(r.fundingRateTimestamp), fundingRate: f(r.fundingRate) }))
    .sort((a, b) => a.fundingTime - b.fundingTime);
}

export async function bybitExchangeInfo(fetchJson: FetchJson, market: Market, symbols: readonly TradingSymbol[]) {
  const out: Partial<Record<TradingSymbol, SymbolFilters>> = {};
  for (const s of symbols) {
    const json = await bybitGet(fetchJson, `/v5/market/instruments-info?category=${bybitCategory(market)}&symbol=${s}`, 3600);
    Object.assign(out, parseBybitInstruments(json, market, [s]));
  }
  return out;
}

export async function bybitBrackets(fetchJson: FetchJson, symbol: TradingSymbol): Promise<BracketSet> {
  return parseBybitRiskLimit(await bybitGet(fetchJson, `/v5/market/risk-limit?category=linear&symbol=${symbol}`, 3600), symbol);
}

/** Recorre una lista de intentos y devuelve el primero que funcione, con los errores previos. */
export async function firstSuccessful<T, S extends string>(
  attempts: Array<{ source: S; run: () => Promise<T> }>,
): Promise<{ data: T; source: S; errors: string[] }> {
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      return { data: await a.run(), source: a.source, errors };
    } catch (e) {
      errors.push(`${a.source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`Ninguna fuente respondió. ${errors.join(' | ')}`);
}
