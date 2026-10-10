import { describe, expect, it } from 'vitest';
import { accountTrade, qtyOpenAt, simulatePlan, type IntrabarProvider, type SimPlan } from '@/lib/engine/simulate';
import { candles, HOUR, T0 } from './helpers/candles';

const M15 = 15 * 60_000;
const plan = (o: Partial<SimPlan> = {}): SimPlan => ({
  direction: 'long', entry: 100, entryLimit: 101, stop: 99, tp1: 102, tp2: 104, tp1ClosePct: 50, qty: 1,
  expiresAt: T0 + 4 * HOUR, slippage: 0, maxHoldMs: 1000 * HOUR, ...o,
});

describe('simulatePlan', () => {
  it('llena la limitada y sale en TP1 → stop a la entrada → TP2', () => {
    const c = candles([[100.5, 100.6, 99.9, 100.2], [100.2, 102.1, 100.1, 101.9], [101.9, 104.2, 101.5, 104]]);
    const { state } = simulatePlan(plan(), c, 0);
    expect(state.phase).toBe('closed');
    if (state.phase !== 'closed') return;
    expect(state.outcome).toBe('tp2');
    expect(state.legs.map((l) => [l.kind, l.qty, l.price])).toEqual([['tp1', 0.5, 102], ['tp2', 0.5, 104]]);
  });
  it('TP1 y luego vuelve a la entrada → tp1-be', () => {
    const c = candles([[100.5, 100.6, 99.9, 100.2], [100.2, 102.1, 100.1, 101.9], [101.9, 102, 99.95, 100]]);
    const { state } = simulatePlan(plan(), c, 0);
    expect(state.phase === 'closed' && state.outcome).toBe('tp1-be');
  });
  it('vence si no se llena en N velas', () => {
    const c = candles([[100.5, 100.8, 100.2, 100.5], [100.5, 100.8, 100.2, 100.5], [100.5, 100.8, 100.2, 100.5], [100.5, 100.8, 100.2, 100.5], [100.5, 100.8, 99, 100]]);
    const { state } = simulatePlan(plan(), c, 0);
    expect(state.phase === 'closed' && state.outcome).toBe('expired');
  });
  it('se invalida si el precio se escapa antes de llenarse', () => {
    const c = candles([[100.5, 101.2, 100.3, 101]]);
    expect(simulatePlan(plan(), c, 0).state).toMatchObject({ phase: 'closed', outcome: 'invalidated' });
  });
  it('vela 1h con stop y TP: sin datos menores asume STOP', () => {
    const c = candles([[100.5, 100.6, 99.9, 100.2], [100.2, 102.5, 98.5, 101]]);
    const r = simulatePlan(plan(), c, 0);
    expect(r.state).toMatchObject({ phase: 'closed', outcome: 'stop' });
    expect(r.ctx.assumedWorst).toBe(1);
  });
  it('vela 1h con stop y TP: las velas de 15m muestran que llegó primero al TP1', () => {
    const c = candles([[100.5, 100.6, 99.9, 100.2], [100.2, 102.5, 98.5, 101]]);
    const sub = candles([[100.2, 102.5, 100.1, 102.2], [102.2, 102.3, 101, 101.2], [101.2, 101.3, 98.5, 99], [99, 101, 98.9, 101]], M15, c[1].openTime);
    const provider: IntrabarProvider = { get: (lvl, from) => (lvl === 1 && from === c[1].openTime ? sub : null) };
    const r = simulatePlan(plan(), c, 0, provider);
    // TP1 en el 1.er cuarto (stop pasa a 100), después baja a 98.5 → sale el resto en la entrada
    expect(r.state).toMatchObject({ phase: 'closed', outcome: 'tp1-be' });
  });
  it('si la vela de 15m también es ambigua usa 1m; si falta 1m, la pide y asume stop', () => {
    const c = candles([[100.5, 100.6, 99.9, 100.2], [100.2, 102.5, 98.5, 101]]);
    const sub = candles([[100.2, 102.5, 98.5, 101]], M15, c[1].openTime);
    const m1 = candles([[100.2, 100.3, 98.5, 98.6]], 60_000, c[1].openTime);
    const without: IntrabarProvider = { get: (lvl) => (lvl === 1 ? sub : null) };
    const a = simulatePlan(plan(), c, 0, without);
    expect(a.state).toMatchObject({ outcome: 'stop' });
    expect(a.ctx.unresolved).toEqual([{ from: c[1].openTime, to: c[1].openTime + M15 - 1 }]);
    const withM1: IntrabarProvider = { get: (lvl) => (lvl === 1 ? sub : m1) };
    const b = simulatePlan(plan(), c, 0, withM1);
    expect(b.state).toMatchObject({ outcome: 'stop' });
    expect(b.ctx.unresolved).toHaveLength(0);
  });
  it('short: mismo ciclo con niveles invertidos', () => {
    const p = plan({ direction: 'short', entry: 100, entryLimit: 99, stop: 101, tp1: 98, tp2: 96 });
    const c = candles([[99.5, 100.1, 99.4, 99.8], [99.8, 99.9, 97.9, 98.1], [98.1, 98.5, 95.9, 96]]);
    expect(simulatePlan(p, c, 0).state).toMatchObject({ phase: 'closed', outcome: 'tp2' });
  });
  it('aplica slippage a las salidas a mercado', () => {
    const c = candles([[100.5, 100.6, 99.9, 100.2], [100.2, 100.3, 98.9, 99]]);
    const { state } = simulatePlan(plan({ slippage: 0.0005 }), c, 0);
    if (state.phase !== 'closed') throw new Error();
    expect(state.legs[0].price).toBeCloseTo(99 * 0.9995, 10);
  });
});

describe('accountTrade / qtyOpenAt', () => {
  it('comisiones sobre el nocional (maker entrada, taker salidas) y funding', () => {
    const legs = [{ kind: 'tp1' as const, qty: 0.5, price: 102, time: 2 }, { kind: 'tp2' as const, qty: 0.5, price: 104, time: 3 }];
    const a = accountTrade('long', 100, 1, legs, 0.0002, 0.0005, 0.01);
    expect(a.grossPnl).toBeCloseTo(3, 10);
    expect(a.fees).toBeCloseTo(100 * 0.0002 + 0.5 * 102 * 0.0005 + 0.5 * 104 * 0.0005, 10);
    expect(a.netPnl).toBeCloseTo(3 - a.fees - 0.01, 10);
  });
  it('cantidad abierta en el tiempo (para el funding después de TP1)', () => {
    const legs = [{ kind: 'tp1' as const, qty: 0.5, price: 102, time: 10 }];
    expect(qtyOpenAt(1, 5, legs, 4)).toBe(0);
    expect(qtyOpenAt(1, 5, legs, 8)).toBe(1);
    expect(qtyOpenAt(1, 5, legs, 12)).toBe(0.5);
  });
});
