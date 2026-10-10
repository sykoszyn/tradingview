import { describe, expect, it } from 'vitest';
import { roundPrice, roundQty, roundStopOutward, roundToStep, stepDecimals } from '@/lib/market/rounding';

describe('stepDecimals', () => {
  it('cuenta decimales de pasos típicos', () => {
    expect(stepDecimals(0.001)).toBe(3);
    expect(stepDecimals(0.1)).toBe(1);
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.00001)).toBe(5);
    expect(stepDecimals(1e-8)).toBe(8);
  });
  it('rechaza pasos inválidos', () => {
    expect(() => stepDecimals(0)).toThrow();
  });
});

describe('roundToStep', () => {
  it('redondea a múltiplos exactos sin ruido de float', () => {
    expect(roundToStep(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToStep(2488.8449, 0.01)).toBe(2488.84);
    expect(roundToStep(82530.76, 0.1)).toBe(82530.8);
  });
  it('floor y ceil respetan múltiplos exactos (no saltan un paso por float)', () => {
    expect(roundToStep(0.009, 0.001, 'floor')).toBe(0.009);
    expect(roundToStep(0.009, 0.001, 'ceil')).toBe(0.009);
    expect(roundToStep(0.0091, 0.001, 'ceil')).toBe(0.01);
    expect(roundToStep(0.0099, 0.001, 'floor')).toBe(0.009);
  });
});

describe('roundQty / roundPrice', () => {
  it('la cantidad se redondea hacia abajo al stepSize', () => {
    expect(roundQty(0.04567, 0.001)).toBe(0.045);
    expect(roundQty(0.0123456, 0.0001)).toBe(0.0123);
  });
  it('el precio se redondea al tickSize', () => {
    expect(roundPrice(2488.837, 0.01)).toBe(2488.84);
    expect(roundPrice(82530.74, 0.1)).toBe(82530.7);
  });
  it('el stop se redondea hacia afuera de la entrada', () => {
    expect(roundStopOutward(2450.127, 0.01, 'long')).toBe(2450.12);
    expect(roundStopOutward(2450.121, 0.01, 'short')).toBe(2450.13);
  });
});
