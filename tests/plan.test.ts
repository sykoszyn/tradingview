import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@/lib/config/defaults';
import { buildPlan, computePnl, type PlanInput } from '@/lib/plan/plan';
import { planToText } from '@/lib/plan/plan-text';
import type { SetupSignal } from '@/lib/analysis/setups';
import type { Zone } from '@/lib/analysis/zones';
import type { SymbolFilters } from '@/lib/types';

const z = (low: number, high: number, score = 5): Zone => ({ id: `z${low}`, low, high, mid: (low + high) / 2, touches: 3, touches4h: 1, lastTouch: 0, firstTouch: 0, score, pivots: [] });
const ETH: SymbolFilters = { symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 20, exchange: 'binance', fetchedAt: 0 };
const SUP = z(2490, 2496);
const sig = (o: Partial<SetupSignal> = {}): SetupSignal => ({
  id: 's1', setup: 'rebote-soporte', direction: 'long', candleIndex: 0, signalTime: Date.UTC(2026, 9, 1, 10, 59, 59, 999),
  zone: SUP, stopAnchor: 2488, entry: 2496, volumeRatio: 1.2, counterTrend: false, confidence: 'media', confidenceScore: 5,
  reasons: ['x'], explanation: 'Rebote', ...o,
});
const input = (o: Partial<PlanInput> = {}, cfg: AppConfig = DEFAULT_CONFIG): PlanInput => ({
  signal: sig(), symbol: 'ETHUSDT', market: 'futures', zones: [SUP, z(2540, 2545), z(2580, 2585), z(2400, 2405)], filters: ETH, cfg,
  phase: { maxMarginUSDT: 25, maxLeverage: 2 }, ...o,
});

describe('buildPlan', () => {
  it('arma un plan completo para un long', () => {
    const r = buildPlan(input());
    expect(r.kind).toBe('plan');
    if (r.kind !== 'plan') return;
    const p = r.plan;
    expect(p.entry).toBe(2496);
    // stop = 2488 × (1 − 0,15 %) = 2484.27 → pero la distancia mínima 0,3 % de 2496 = 2488.51 ya está cubierta
    expect(p.stop).toBeCloseTo(2484.26, 2);
    expect(p.tp1).toBe(2540);
    expect(p.tp2).toBe(2580);
    expect(p.tp1ClosePct).toBe(50);
    expect(p.rrTp1).toBeGreaterThan(1.5);
    expect(p.status).toBe('operable');
    expect(p.minimums.ok).toBe(true);
    expect(p.expiresAt - p.signalTime).toBe(4 * 3_600_000);
    expect(p.entryLimit).toBeCloseTo(2496 * 1.006, 1);
    expect(p.pnl!.lossAtStop).toBeGreaterThan(0);
    expect(p.pnl!.gainTp2Total!).toBeGreaterThan(p.pnl!.gainTp1Leg);
  });
  it('short: TP en las zonas de abajo y stop arriba', () => {
    const RES = z(2600, 2606);
    const r = buildPlan(input({ signal: sig({ setup: 'rechazo-resistencia', direction: 'short', zone: RES, stopAnchor: 2608, entry: 2600 }), zones: [RES, z(2550, 2555), z(2500, 2505)] }));
    expect(r.kind).toBe('plan');
    if (r.kind !== 'plan') return;
    expect(r.plan.stop).toBeGreaterThan(2608);
    expect(r.plan.tp1).toBe(2555);
    expect(r.plan.tp2).toBe(2505);
  });
  it('aleja el stop hasta la distancia mínima configurable', () => {
    const r = buildPlan(input({ signal: sig({ stopAnchor: 2495.5 }) }));
    if (r.kind !== 'plan') throw new Error(r.reason);
    expect(r.plan.stopDistancePct).toBeGreaterThanOrEqual(0.3 - 1e-6);
    expect(r.plan.warnings.join(' ')).toMatch(/distancia mínima/);
  });
  it('descarta si el R:R neto en TP1 no llega al mínimo', () => {
    const r = buildPlan(input({ zones: [SUP, z(2502, 2505)] }));
    expect(r.kind).toBe('discarded');
    if (r.kind === 'discarded') expect(r.code).toBe('rr-insuficiente');
  });
  it('descarta si no hay zona objetivo', () => {
    const r = buildPlan(input({ zones: [SUP] }));
    expect(r.kind === 'discarded' && r.code).toBe('sin-objetivo');
  });
  it('marca "no operable en tu fase" pero conserva el plan', () => {
    const r = buildPlan(input({ phase: { maxMarginUSDT: 10, maxLeverage: 2 }, signal: sig({ entry: 2488, zone: z(2484, 2488), stopAnchor: 2480 }), zones: [z(2484, 2488), z(2540, 2545), z(2580, 2585)] }));
    expect(r.kind).toBe('plan');
    if (r.kind !== 'plan') return;
    expect(r.plan.status).toBe('no-operable-fase');
    expect(r.plan.sizing.requiredMargin).toBeGreaterThan(10);
  });
  it('el texto copiable incluye la checklist de Binance (solo futuros)', () => {
    const r = buildPlan(input());
    if (r.kind !== 'plan') throw new Error();
    const t = planToText(r.plan, ETH);
    expect(t).toMatch(/AISLADO/);
    expect(t).toMatch(/One-way/);
    expect(t).toMatch(/Mark Price/);
    expect(t).toMatch(/mover el stop al precio de entrada/);
    const spot = buildPlan(input({ market: 'spot', filters: { ...ETH, market: 'spot', minNotional: 5 } }));
    if (spot.kind !== 'plan') throw new Error();
    expect(planToText(spot.plan)).not.toMatch(/CHECKLIST/);
  });
});

describe('computePnl', () => {
  it('pérdida en stop y ganancias en TP1/TP2 con comisiones sobre el nocional', () => {
    const r = { maker: 0.0002, taker: 0.0005 };
    const p = computePnl('long', 0.01, 2500, 2475, 2550, 2600, 50, r);
    expect(p.feeEntry).toBeCloseTo(0.005, 10);
    expect(p.feeStopExit).toBeCloseTo(0.012375, 10);
    expect(p.lossAtStop).toBeCloseTo(0.25 + 0.005 + 0.012375, 10);
    expect(p.gainTp1Leg).toBeCloseTo(0.005 * 50 - 0.005 * 2550 * 0.0005 - 0.0025, 10);
    expect(p.gainTp2Total!).toBeCloseTo(p.gainTp1Leg + (0.005 * 100 - 0.005 * 2600 * 0.0005 - 0.0025), 10);
  });
});
