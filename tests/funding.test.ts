import { describe, expect, it } from 'vitest';
import { estimateFunding, fundingIntervalHours, fundingPayment, historicalFunding } from '@/lib/plan/funding';

const H = 3_600_000;

describe('funding', () => {
  it('tasa positiva: el long paga y el short cobra', () => {
    expect(fundingPayment('long', 100, 0.0001)).toBeCloseTo(0.01, 12);
    expect(fundingPayment('short', 100, 0.0001)).toBeCloseTo(-0.01, 12);
    expect(fundingPayment('long', 100, -0.0001)).toBeCloseTo(-0.01, 12);
  });
  it('costo estimado a 8, 16 y 24 h con intervalo de 8 h', () => {
    const e = estimateFunding('long', 50, 0.0001, 8);
    expect(e.costs.map((c) => c.events)).toEqual([1, 2, 3]);
    expect(e.costs[2].cost).toBeCloseTo(0.015, 12);
    expect(e.pays).toBe(true);
    expect(e.lines[0]).toMatch(/PAGA/);
    expect(estimateFunding('short', 50, 0.0001).lines[0]).toMatch(/COBRA/);
  });
  it('intervalo de 4 h → el doble de eventos', () => {
    expect(estimateFunding('long', 50, 0.0001, 4).costs.map((c) => c.events)).toEqual([2, 4, 6]);
  });
  it('deduce el intervalo del historial', () => {
    expect(fundingIntervalHours([0, 8, 16, 24].map((h) => ({ fundingTime: h * H + 3, fundingRate: 0 })))).toBe(8);
    expect(fundingIntervalHours([0, 4, 8].map((h) => ({ fundingTime: h * H, fundingRate: 0 })))).toBe(4);
    expect(fundingIntervalHours([])).toBe(8);
  });
  it('histórico: solo cobros dentro de (apertura, cierre]', () => {
    const pts = [0, 8, 16, 24].map((h) => ({ fundingTime: h * H, fundingRate: 0.0001 }));
    const r = historicalFunding('long', pts, 0, 16 * H, () => 100);
    expect(r.events).toBe(2);
    expect(r.total).toBeCloseTo(0.02, 12);
    expect(historicalFunding('short', pts, 1, 7 * H, () => 100).events).toBe(0);
  });
});
