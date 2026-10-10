import { describe, expect, it } from 'vitest';
import { analyzeLiquidation, liquidationPrice } from '@/lib/plan/liquidation';
import { liquidationExtension } from '@/lib/plan/extensions';
import { buildPlan } from '@/lib/plan/plan';
import { DEFAULT_CONFIG } from '@/lib/config/defaults';
import type { BracketSet, SymbolFilters } from '@/lib/types';
import type { Zone } from '@/lib/analysis/zones';

const BR: BracketSet = { symbol: 'ETHUSDT', source: 'binance-public', fetchedAt: 0, brackets: [
  { notionalFloor: 0, notionalCap: 300000, maintMarginRate: 0.004, maintAmount: 0, maxLeverage: 150 },
  { notionalFloor: 300000, notionalCap: 800000, maintMarginRate: 0.005, maintAmount: 300, maxLeverage: 100 },
] };

describe('liquidationPrice (aislado, one-way)', () => {
  it('long 2x: ~ entrada × (1 − 1/2) / (1 − MMR)', () => {
    // Q=0.01, EP=2500, nocional 25, margen 12.5
    const lp = liquidationPrice({ direction: 'long', entry: 2500, qty: 0.01, margin: 12.5, maintMarginRate: 0.004, maintAmount: 0 });
    expect(lp).toBeCloseTo((25 - 12.5) / (0.01 * 0.996), 6); // 1255.02
  });
  it('short 2x: ~ entrada × (1 + 1/2) / (1 + MMR)', () => {
    const lp = liquidationPrice({ direction: 'short', entry: 2500, qty: 0.01, margin: 12.5, maintMarginRate: 0.004, maintAmount: 0 });
    expect(lp).toBeCloseTo((25 + 12.5) / (0.01 * 1.004), 6); // 3735.06
  });
  it('a más apalancamiento, la liquidación queda más cerca', () => {
    const at = (lev: number) => liquidationPrice({ direction: 'long', entry: 2500, qty: 0.01, margin: 25 / lev, maintMarginRate: 0.004, maintAmount: 0 });
    expect(at(3)).toBeGreaterThan(at(2));
    expect(at(2)).toBeGreaterThan(at(1));
  });
  it('1x long nunca da precio negativo', () => {
    expect(liquidationPrice({ direction: 'long', entry: 2500, qty: 0.01, margin: 25, maintMarginRate: 0.004, maintAmount: 0 })).toBe(0);
  });
  it('usa el maintenance amount del bracket que corresponde al nocional', () => {
    const big = analyzeLiquidation('long', 2500, 2400, 200, 250000, BR); // nocional 500k → tramo 2
    expect(big.maintMarginRate).toBe(0.005);
    expect(big.maintAmount).toBe(300);
  });
});

describe('regla stop vs. liquidación', () => {
  it('ok cuando el stop está a menos del 50 % de la distancia a la liquidación', () => {
    const l = analyzeLiquidation('long', 2500, 2450, 0.01, 12.5, BR); // stop 50, liq ~1245
    expect(l.ok).toBe(true);
    expect(l.stopToLiqRatio).toBeLessThan(0.5);
  });
  it('falla si el stop está más allá del 50 %', () => {
    const l = analyzeLiquidation('long', 2500, 1700, 0.01, 8.333, BR); // 3x → liq ~1673
    expect(l.ok).toBe(false);
  });
  it('en el plan baja el apalancamiento hasta cumplir la regla', () => {
    // stop a 20 % con 3x (liq ~33 %) → 20/33 = 60 % ✗ ; 2x (liq ~50 %) → 40 % ✓
    const ETH: SymbolFilters = { symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 5, exchange: 'binance', fetchedAt: 0 };
    const z = (low: number, high: number): Zone => ({ id: `z${low}`, low, high, mid: (low + high) / 2, touches: 3, touches4h: 0, lastTouch: 0, firstTouch: 0, score: 1, pivots: [] });
    const cfg = { ...DEFAULT_CONFIG, sizing: { riskPerTradeUSDT: 10, defaultLeverage: 3 }, plan: { ...DEFAULT_CONFIG.plan, minRR: 0.5, stopBufferPct: 0 } };
    const r = buildPlan({
      signal: { id: 's', setup: 'rebote-soporte', direction: 'long', candleIndex: 0, signalTime: 0, zone: z(2400, 2500), stopAnchor: 2000, entry: 2500, volumeRatio: 1, counterTrend: false, confidence: 'media', confidenceScore: 4, reasons: [], explanation: '' },
      symbol: 'ETHUSDT', market: 'futures', zones: [z(2400, 2500), z(3000, 3010)], filters: ETH, cfg,
      phase: { maxMarginUSDT: 50, maxLeverage: 3 }, extensions: [liquidationExtension(BR)],
    });
    if (r.kind !== 'plan') throw new Error(r.reason);
    expect(r.plan.sizing.leverage).toBe(2);
    expect(r.plan.liquidation!.ok).toBe(true);
    expect(r.plan.warnings.join(' ')).toMatch(/bajado de 3x a 2x/);
  });
  it('si ni con 1x se cumple, descarta', () => {
    const l = analyzeLiquidation('short', 100, 260, 1, 100, BR); // 1x short liq ~199
    expect(l.ok).toBe(false);
  });
});
