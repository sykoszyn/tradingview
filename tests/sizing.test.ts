import { describe, expect, it } from 'vitest';
import { sizePosition, type SizingInput } from '@/lib/plan/sizing';
import type { SymbolFilters } from '@/lib/types';

const ETH: SymbolFilters = { symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 20, exchange: 'binance', fetchedAt: 0 };
const BTC: SymbolFilters = { ...ETH, symbol: 'BTCUSDT', tickSize: 0.1, minNotional: 50 };
const NOFEES = { maker: 0, taker: 0 };
const base = (o: Partial<SizingInput> = {}): SizingInput => ({
  direction: 'long', market: 'futures', entry: 2500, stop: 2450, filters: ETH, riskUSDT: 1, maxRiskMultiplier: 2,
  defaultLeverage: 2, phase: { maxMarginUSDT: 25, maxLeverage: 2 }, fees: NOFEES, ...o,
});

describe('sizePosition', () => {
  it('nocional = riesgo / distancia al stop', () => {
    // stop 2 % → nocional 50, margen 25 a 2x
    const r = sizePosition(base());
    expect(r.status).toBe('ok');
    expect(r.targetNotional).toBeCloseTo(50, 8);
    expect(r.qty).toBe(0.02);
    expect(r.leverage).toBe(2);
    expect(r.margin).toBeCloseTo(25, 8);
    expect(r.realRiskUSDT).toBeCloseTo(1, 8);
  });
  it('incluye las comisiones en la pérdida por unidad', () => {
    const r = sizePosition(base({ fees: { maker: 0.0002, taker: 0.0005 } }));
    expect(r.targetNotional).toBeLessThan(50);
    expect(r.realRiskUSDT).toBeLessThanOrEqual(1.0001);
  });
  it('margen limitado al máximo de la fase → riesgo real menor con advertencia', () => {
    // stop 1 % → nocional 100, margen 50 > 25
    const r = sizePosition(base({ stop: 2475 }));
    expect(r.margin).toBeLessThanOrEqual(25 + 1e-9);
    expect(r.notional).toBeCloseTo(50, 6);
    expect(r.realRiskUSDT).toBeCloseTo(0.5, 6);
    expect(r.adjustments.join(' ')).toMatch(/máximo de tu fase/);
  });
  it('si el margen queda < 10 USDT, primero baja el apalancamiento', () => {
    // stop 4 % → nocional 25 → a 2x margen 12.5 ok; stop 5 % → nocional 20 → a 2x margen 10 (justo)
    // stop 6 % → nocional 16.7 < min 20 → sube a 22.5 (0.009 ETH), a 2x margen 11.25 ok
    // Con ETH de nocional mínimo 5 (spot-like) y stop 8 %: nocional 12.5 → a 2x margen 6.25 → baja a 1x → 12.5
    const r = sizePosition(base({ filters: { ...ETH, minNotional: 5 }, stop: 2300 }));
    expect(r.leverage).toBe(1);
    expect(r.margin).toBeGreaterThanOrEqual(10);
    expect(r.adjustments[0]).toMatch(/bajado de 2x a 1x/);
  });
  it('si con 1x el margen sigue < 10 USDT, sube el nocional a 10', () => {
    const r = sizePosition(base({ filters: { ...ETH, minNotional: 5 }, stop: 2000 })); // stop 20 % → nocional 5
    expect(r.leverage).toBe(1);
    expect(r.notional).toBeGreaterThanOrEqual(10);
    expect(r.realRiskUSDT).toBeCloseTo(r.qty * 500, 8);
  });
  it('si el nocional por riesgo es menor al mínimo del par, lo sube y muestra el riesgo real', () => {
    const r = sizePosition(base({ entry: 2488, stop: 2338 })); // 6 % → 16.6 < 22.39 (0.009 ETH)
    expect(r.qty).toBe(0.009);
    expect(r.realRiskUSDT).toBeCloseTo(0.009 * 150, 8);
    expect(r.adjustments.join(' ')).toMatch(/mínimo del par/);
  });
  it('descarta si el riesgo real supera 2× el configurado', () => {
    const r = sizePosition(base({ filters: BTC, entry: 82500, stop: 80000, phase: { maxMarginUSDT: 50, maxLeverage: 3 } }));
    // mínimo 0.001 BTC = 82.5 USDT; riesgo = 0.001 × 2500 = 2.5 > 2
    expect(r.status).toBe('riesgo-excesivo');
  });
  it('NO OPERABLE EN TU FASE: ETH a 2488 en Fase 2 (10 USDT, 2x) con mínimo de 22,39 USDT', () => {
    const r = sizePosition(base({ entry: 2488, stop: 2478, phase: { maxMarginUSDT: 10, maxLeverage: 2 } }));
    expect(r.status).toBe('no-operable-fase');
    expect(r.requiredMargin).toBeCloseTo(11.196, 6);
    expect(r.reason).toMatch(/necesita 11.20 USDT de margen a 2x/);
  });
  it('ETH a 2500 en Fase 2 sí entra justo (0,008 ETH = 20 USDT = 10 USDT a 2x)', () => {
    const r = sizePosition(base({ stop: 2490, phase: { maxMarginUSDT: 10, maxLeverage: 2 } }));
    expect(r.status).toBe('ok');
    expect(r.qty).toBe(0.008);
    expect(r.margin).toBeCloseTo(10, 8);
  });
  it('BTC en Fase 2 no es operable; en Fase 4 (50 USDT, 3x) sí', () => {
    const p = { entry: 82500, stop: 81675, filters: BTC };
    expect(sizePosition(base({ ...p, phase: { maxMarginUSDT: 10, maxLeverage: 2 } })).status).toBe('no-operable-fase');
    const r4 = sizePosition(base({ ...p, phase: { maxMarginUSDT: 50, maxLeverage: 3 } }));
    expect(r4.status).toBe('ok');
    expect(r4.qty).toBe(0.001);
  });
  it('sube el apalancamiento hasta el máximo de la fase solo si hace falta para el mínimo', () => {
    // Fase con 3x y margen 30: BTC mínimo 82.5 → a 2x 41.25 > 30, a 3x 27.5 ok
    const r = sizePosition(base({ entry: 82500, stop: 81675, filters: BTC, phase: { maxMarginUSDT: 30, maxLeverage: 3 } }));
    expect(r.status).toBe('ok');
    expect(r.leverage).toBe(3);
  });
  it('nunca supera 3x aunque la fase diga más', () => {
    const r = sizePosition(base({ entry: 82500, stop: 81675, filters: BTC, defaultLeverage: 10, phase: { maxMarginUSDT: 20, maxLeverage: 10 } }));
    expect(r.status).toBe('no-operable-fase');
    expect(r.requiredMargin).toBeCloseTo(27.5, 6);
  });
  it('spot siempre 1x', () => {
    const r = sizePosition(base({ market: 'spot', filters: { ...ETH, market: 'spot', minNotional: 5, stepSize: 0.0001, marketStepSize: 0.0001, minQty: 0.0001, marketMinQty: 0.0001 } }));
    expect(r.leverage).toBe(1);
  });
  it('la cantidad queda en múltiplos del stepSize', () => {
    const r = sizePosition(base({ stop: 2463.7 }));
    expect(Math.abs(r.qty / 0.001 - Math.round(r.qty / 0.001))).toBeLessThan(1e-9);
  });
  it('usa la regla extra por apalancamiento (p. ej. liquidación) bajando el apalancamiento', () => {
    const r = sizePosition(base({ leverageCheck: ({ leverage }) => (leverage > 1 ? 'muy cerca' : null) }));
    expect(r.leverage).toBe(1);
    const none = sizePosition(base({ leverageCheck: () => 'siempre falla' }));
    expect(none.status).toBe('liquidacion');
  });
});

describe('redondeo con margen mínimo = margen máximo (Fase 2)', () => {
  it('spot ETH con 10 USDT: queda justo por debajo de 10 por el step en vez de fallar', () => {
    const spot = { ...ETH, market: 'spot' as const, minNotional: 5, stepSize: 0.0001, marketStepSize: 0.0001, minQty: 0.0001, marketMinQty: 0.0001 };
    const r = sizePosition(base({ market: 'spot', filters: spot, entry: 2490, stop: 2482.5, phase: { maxMarginUSDT: 10, maxLeverage: 2 } }));
    expect(r.status).toBe('ok');
    expect(r.margin).toBeLessThanOrEqual(10);
    expect(r.margin).toBeGreaterThan(10 - 0.0001 * 2490);
  });
});
