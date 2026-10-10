// Parseo de exchangeInfo (Binance spot/futuros y Bybit) y cálculo de mínimos reales.
import type { Market, SymbolFilters, TradingSymbol } from '../types';
import { roundToStep } from './rounding';

type RawFilter = Record<string, string | number | undefined> & { filterType: string };
interface RawSymbol {
  symbol: string;
  status?: string;
  filters: RawFilter[];
}

const num = (v: unknown, name: string): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) throw new Error(`Filtro ${name} inválido: ${String(v)}`);
  return n;
};

/**
 * Convierte el JSON de /fapi/v1/exchangeInfo o /api/v3/exchangeInfo en filtros
 * por símbolo. Lanza error si falta un filtro necesario: nunca se inventa un mínimo.
 */
export function parseBinanceExchangeInfo(
  json: unknown,
  market: Market,
  symbols: readonly TradingSymbol[],
  now = Date.now(),
): Partial<Record<TradingSymbol, SymbolFilters>> {
  const list = (json as { symbols?: RawSymbol[] })?.symbols;
  if (!Array.isArray(list)) throw new Error('exchangeInfo sin lista de símbolos');
  const out: Partial<Record<TradingSymbol, SymbolFilters>> = {};
  for (const sym of symbols) {
    const s = list.find((x) => x.symbol === sym);
    if (!s) continue;
    const f = (t: string) => s.filters.find((x) => x.filterType === t);
    const price = f('PRICE_FILTER');
    const lot = f('LOT_SIZE');
    const mlot = f('MARKET_LOT_SIZE');
    // futuros: MIN_NOTIONAL.notional — spot: NOTIONAL.minNotional (o MIN_NOTIONAL.minNotional en formato viejo)
    const notionalFilter = f('MIN_NOTIONAL') ?? f('NOTIONAL');
    if (!price || !lot || !notionalFilter) throw new Error(`Faltan filtros para ${sym} (${market})`);
    const minNotional = num(notionalFilter.notional ?? notionalFilter.minNotional, `${sym}.MIN_NOTIONAL`);
    const stepSize = num(lot.stepSize, `${sym}.stepSize`);
    const minQty = num(lot.minQty, `${sym}.minQty`);
    // En spot el MARKET_LOT_SIZE suele venir con stepSize 0 → usar LOT_SIZE.
    const mStep = mlot ? num(mlot.stepSize, 'market.stepSize') : 0;
    const mMin = mlot ? num(mlot.minQty, 'market.minQty') : 0;
    out[sym] = {
      symbol: sym,
      market,
      tickSize: num(price.tickSize, `${sym}.tickSize`),
      stepSize,
      minQty,
      marketStepSize: mStep > 0 ? mStep : stepSize,
      marketMinQty: mMin > 0 ? mMin : minQty,
      minNotional,
      exchange: 'binance',
      fetchedAt: now,
    };
  }
  return out;
}

interface BybitInstrument {
  symbol: string;
  priceFilter: { tickSize: string };
  lotSizeFilter: { qtyStep?: string; basePrecision?: string; minOrderQty: string; minNotionalValue?: string; minOrderAmt?: string };
}

/** /v5/market/instruments-info (category=linear o spot). */
export function parseBybitInstruments(
  json: unknown,
  market: Market,
  symbols: readonly TradingSymbol[],
  now = Date.now(),
): Partial<Record<TradingSymbol, SymbolFilters>> {
  const list = (json as { result?: { list?: BybitInstrument[] } })?.result?.list;
  if (!Array.isArray(list)) throw new Error('Bybit instruments-info sin lista');
  const out: Partial<Record<TradingSymbol, SymbolFilters>> = {};
  for (const sym of symbols) {
    const s = list.find((x) => x.symbol === sym);
    if (!s) continue;
    const step = num(s.lotSizeFilter.qtyStep ?? s.lotSizeFilter.basePrecision, `${sym}.qtyStep`);
    const minQty = num(s.lotSizeFilter.minOrderQty, `${sym}.minOrderQty`);
    const minNotional = num(s.lotSizeFilter.minNotionalValue ?? s.lotSizeFilter.minOrderAmt ?? 0, `${sym}.minNotional`);
    out[sym] = {
      symbol: sym,
      market,
      tickSize: num(s.priceFilter.tickSize, `${sym}.tickSize`),
      stepSize: step,
      minQty,
      marketStepSize: step,
      marketMinQty: minQty,
      minNotional,
      exchange: 'bybit',
      fetchedAt: now,
    };
  }
  return out;
}

export interface PairMinimums {
  symbol: TradingSymbol;
  market: Market;
  price: number;
  /** Cantidad mínima que cumple LOT_SIZE, MARKET_LOT_SIZE y MIN_NOTIONAL, ya redondeada al step. */
  minQty: number;
  /** max(MIN_NOTIONAL, cantidad_mínima × precio) con la cantidad redondeada al step. */
  minNotional: number;
  /** Nocional del filtro MIN_NOTIONAL tal cual lo publica el exchange. */
  exchangeMinNotional: number;
  /** Margen mínimo según apalancamiento: nocional_mínimo / apalancamiento. */
  marginAt: (leverage: number) => number;
}

/**
 * Nocional mínimo real de un par al precio actual.
 * Usamos la cantidad mínima más exigente entre la orden limitada (entrada) y la
 * de mercado (el stop se ejecuta a mercado), y la subimos lo necesario para
 * cumplir MIN_NOTIONAL, siempre redondeando al stepSize hacia arriba.
 */
export function computeMinimums(f: SymbolFilters, price: number): PairMinimums {
  if (!(price > 0)) throw new Error('Precio inválido para calcular mínimos');
  const step = Math.max(f.stepSize, f.marketStepSize);
  const baseMinQty = Math.max(f.minQty, f.marketMinQty);
  const qtyForNotional = f.minNotional / price;
  const minQty = roundToStep(Math.max(baseMinQty, qtyForNotional), step, 'ceil');
  const minNotional = Math.max(f.minNotional, minQty * price);
  return {
    symbol: f.symbol,
    market: f.market,
    price,
    minQty,
    minNotional,
    exchangeMinNotional: f.minNotional,
    marginAt: (lev: number) => minNotional / lev,
  };
}

/** Verificación explícita de que una cantidad cumple los mínimos del par. */
export function checkOrderMinimums(f: SymbolFilters, qty: number, price: number) {
  const notional = qty * price;
  const step = Math.max(f.stepSize, f.marketStepSize);
  const onStep = Math.abs(roundToStep(qty, step, 'nearest') - qty) < step * 1e-6;
  const qtyOk = qty + 1e-12 >= Math.max(f.minQty, f.marketMinQty);
  const notionalOk = notional + 1e-9 >= f.minNotional;
  return { qtyOk, notionalOk, onStep, ok: qtyOk && notionalOk && onStep, notional };
}
