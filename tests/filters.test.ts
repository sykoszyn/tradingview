import { describe, expect, it } from 'vitest';
import futuresInfo from './fixtures/futures-exchangeinfo.json';
import spotInfo from './fixtures/spot-exchangeinfo.json';
import { checkOrderMinimums, computeMinimums, parseBinanceExchangeInfo, parseBybitInstruments } from '@/lib/market/filters';
import type { SymbolFilters } from '@/lib/types';

const SYMS = ['ETHUSDT', 'BTCUSDT'] as const;

describe('parseBinanceExchangeInfo', () => {
  it('lee los filtros reales de futuros (formato de /fapi/v1/exchangeInfo)', () => {
    const f = parseBinanceExchangeInfo(futuresInfo, 'futures', SYMS);
    expect(f.ETHUSDT?.minNotional).toBeGreaterThan(0);
    expect(f.ETHUSDT?.stepSize).toBeGreaterThan(0);
    expect(f.BTCUSDT?.minQty).toBeGreaterThan(0);
    expect(f.BTCUSDT?.tickSize).toBeGreaterThan(0);
  });
  it('lee los filtros de spot (NOTIONAL, MARKET_LOT_SIZE con step 0 → usa LOT_SIZE)', () => {
    const f = parseBinanceExchangeInfo(spotInfo, 'spot', SYMS);
    expect(f.ETHUSDT?.marketStepSize).toBe(f.ETHUSDT?.stepSize);
    expect(f.ETHUSDT?.minNotional).toBeGreaterThan(0);
  });
  it('falla si faltan filtros (nunca inventa un mínimo)', () => {
    const broken = { symbols: [{ symbol: 'ETHUSDT', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] };
    expect(() => parseBinanceExchangeInfo(broken, 'futures', SYMS)).toThrow();
  });
});

describe('parseBybitInstruments', () => {
  it('lee qtyStep, minOrderQty y minNotionalValue', () => {
    const json = {
      retCode: 0,
      result: { list: [{ symbol: 'ETHUSDT', priceFilter: { tickSize: '0.01' }, lotSizeFilter: { qtyStep: '0.01', minOrderQty: '0.01', minNotionalValue: '5' } }] },
    };
    const f = parseBybitInstruments(json, 'futures', SYMS);
    expect(f.ETHUSDT).toMatchObject({ stepSize: 0.01, minQty: 0.01, minNotional: 5, exchange: 'bybit' });
  });
});

const ETH: SymbolFilters = {
  symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001,
  marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 20, exchange: 'binance', fetchedAt: 0,
};
const BTC: SymbolFilters = { ...ETH, symbol: 'BTCUSDT', tickSize: 0.1, minNotional: 50 };

describe('computeMinimums (nocional y margen mínimos)', () => {
  it('ETH: MIN_NOTIONAL manda y la cantidad se redondea hacia arriba al step', () => {
    const m = computeMinimums(ETH, 2488);
    // 20 / 2488 = 0.00804 → 0.009 ETH → 22.392 USDT
    expect(m.minQty).toBe(0.009);
    expect(m.minNotional).toBeCloseTo(22.392, 6);
    expect(m.minNotional).toBeGreaterThanOrEqual(Math.max(20, 0.001 * 2488));
    expect(m.marginAt(1)).toBeCloseTo(22.392, 6);
    expect(m.marginAt(2)).toBeCloseTo(11.196, 6);
    expect(m.marginAt(3)).toBeCloseTo(7.464, 6);
  });
  it('BTC: la cantidad mínima (0.001) manda sobre MIN_NOTIONAL', () => {
    const m = computeMinimums(BTC, 82530);
    expect(m.minQty).toBe(0.001);
    expect(m.minNotional).toBeCloseTo(82.53, 6);
    expect(m.marginAt(2)).toBeCloseTo(41.265, 6);
  });
  it('si el precio sube, el nocional mínimo de BTC sube con él', () => {
    expect(computeMinimums(BTC, 100000).minNotional).toBeCloseTo(100, 6);
  });
  it('rechaza precio inválido', () => {
    expect(() => computeMinimums(ETH, 0)).toThrow();
  });
});

describe('checkOrderMinimums', () => {
  it('verifica cantidad, nocional y múltiplo del step', () => {
    expect(checkOrderMinimums(ETH, 0.009, 2488).ok).toBe(true);
    expect(checkOrderMinimums(ETH, 0.008, 2488).notionalOk).toBe(false);
    expect(checkOrderMinimums(ETH, 0.0085, 2488).onStep).toBe(false);
    expect(checkOrderMinimums(BTC, 0.0005, 82530).qtyOk).toBe(false);
  });
});
