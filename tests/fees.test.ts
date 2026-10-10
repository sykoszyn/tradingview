import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/config/defaults';
import { fee, feeRates, grossPnl, netRiskReward } from '@/lib/plan/fees';

describe('comisiones', () => {
  it('tasas por defecto: futuros 0,02 % / 0,05 %, spot 0,1 %', () => {
    expect(feeRates('futures', DEFAULT_CONFIG)).toEqual({ maker: 0.0002, taker: 0.0005 });
    expect(feeRates('spot', DEFAULT_CONFIG)).toEqual({ maker: 0.001, taker: 0.001 });
  });
  it('se calculan sobre el NOCIONAL, no sobre el margen', () => {
    // 0,01 ETH a 2500 = 25 USDT de nocional (con 2x el margen sería 12,5)
    expect(fee(0.01, 2500, 0.0005)).toBeCloseTo(0.0125, 10);
  });
  it('pnl bruto long y short', () => {
    expect(grossPnl('long', 2, 100, 110)).toBe(20);
    expect(grossPnl('short', 2, 100, 110)).toBe(-20);
  });
  it('R:R neto descuenta comisiones (queda menor que el bruto)', () => {
    const r = { maker: 0.0002, taker: 0.0005 };
    const net = netRiskReward('long', 100, 99, 101.5, r);
    expect(net).toBeLessThan(1.5);
    expect(net).toBeCloseTo((1.5 - 0.02 - 0.05075) / (1 + 0.02 + 0.0495), 10);
    expect(netRiskReward('short', 100, 101, 98.5, r)).toBeCloseTo((1.5 - 0.02 - 0.04925) / (1 + 0.02 + 0.0505), 10);
  });
});
