// Tipos compartidos por toda la app. Sin dependencias de React ni del navegador.

export const SYMBOLS = ['ETHUSDT', 'BTCUSDT'] as const;
export type TradingSymbol = (typeof SYMBOLS)[number];

export type Market = 'spot' | 'futures';
export const INTERVALS = ['15m', '1h', '4h'] as const;
export type Interval = (typeof INTERVALS)[number] | '1m';
export type Direction = 'long' | 'short';

export interface Candle {
  openTime: number; // ms UTC
  closeTime: number; // ms UTC (último ms de la vela)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** De dónde salió un dato. Se muestra en la UI. */
export type DataSource =
  | 'binance-server' // ruta /api en Vercel (gru1) → api oficial
  | 'binance-mirror' // ruta /api → espejo www.binance.com/fapi
  | 'binance-browser' // el navegador directo a Binance
  | 'bybit-server'
  | 'bybit-browser'
  | 'cache'
  | 'conservative'
  | 'synthetic';

export interface SymbolFilters {
  symbol: TradingSymbol;
  market: Market;
  tickSize: number;
  stepSize: number; // LOT_SIZE.stepSize (órdenes limitadas)
  minQty: number; // LOT_SIZE.minQty
  marketStepSize: number; // MARKET_LOT_SIZE (stops a mercado)
  marketMinQty: number;
  minNotional: number; // MIN_NOTIONAL / NOTIONAL
  exchange: 'binance' | 'bybit';
  fetchedAt: number;
}

export interface LeverageBracket {
  notionalFloor: number;
  notionalCap: number;
  maintMarginRate: number; // fracción (0.004 = 0,4%)
  maintAmount: number; // "cum" en USDT
  maxLeverage: number;
}

export type BracketSource = 'binance-public' | 'bybit' | 'cache' | 'conservative';

export interface BracketSet {
  symbol: TradingSymbol;
  brackets: LeverageBracket[];
  source: BracketSource;
  fetchedAt: number;
  warning?: string;
}

export interface PremiumIndex {
  symbol: TradingSymbol;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number; // fracción por intervalo (0.0001 = 0,01%)
  nextFundingTime: number;
  time: number;
}

export interface FundingRatePoint {
  fundingTime: number;
  fundingRate: number; // fracción
}

export interface Sourced<T> {
  data: T;
  source: DataSource;
  /** Errores de las fuentes que fallaron antes de la que funcionó. */
  errors: string[];
}
