import { describe, expect, it } from 'vitest';
import { BASE_CONFIG } from '@/lib/config/defaults';
import { buildPlan, type TradePlan } from '@/lib/plan/plan';
import type { SetupSignal } from '@/lib/analysis/setups';
import type { Zone } from '@/lib/analysis/zones';
import type { SymbolFilters } from '@/lib/types';
import { advancePaper, finalizePaper, newPaperTrade, paperStatusLabel } from '@/lib/journal/paper';
import { compareWithPlan, realNetPnl, realR, validateRealTrade } from '@/lib/journal/real';
import { liveSample, liveValidationStatus, toBtTrades } from '@/lib/journal/live-validation';
import { emptyJournal, type PaperTrade, type RealTrade } from '@/lib/journal/types';
import { exportBundle, importBundle, parseJournal } from '@/lib/storage/repository';
import { candles } from './helpers/candles';

const z = (low: number, high: number): Zone => ({ id: `z${low}`, low, high, mid: (low + high) / 2, touches: 3, touches4h: 1, lastTouch: 0, firstTouch: 0, score: 5, pivots: [] });
const ETH: SymbolFilters = { symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 20, exchange: 'binance', fetchedAt: 0 };
const T = Date.UTC(2026, 9, 1, 10, 59, 59, 999);
const sig: SetupSignal = { id: 's', setup: 'rebote-soporte', direction: 'long', candleIndex: 0, signalTime: T, zone: z(2490, 2496), stopAnchor: 2488, entry: 2496, volumeRatio: 1, counterTrend: false, confidence: 'media', confidenceScore: 4, reasons: [], explanation: '' };
const mkPlan = (): TradePlan => {
  const r = buildPlan({ signal: sig, symbol: 'ETHUSDT', market: 'futures', zones: [z(2490, 2496), z(2540, 2545), z(2580, 2585)], filters: ETH, cfg: BASE_CONFIG, phase: { maxMarginUSDT: 25, maxLeverage: 2 } });
  if (r.kind !== 'plan') throw new Error(r.reason);
  return r.plan;
};
const M = 60_000;

describe('paper trading', () => {
  it('sigue el plan con velas de 1m hasta TP2 y calcula el resultado con comisiones', () => {
    const plan = mkPlan();
    let t = newPaperTrade(plan, 'zonas-1h', false, T);
    const c = candles([[2500, 2501, 2495, 2497], [2497, 2541, 2497, 2540], [2540, 2581, 2539, 2580]], M, T + 1);
    t = advancePaper(t, c, BASE_CONFIG);
    expect(t.sim).toMatchObject({ phase: 'closed', outcome: 'tp2' });
    t = finalizePaper(t, []);
    expect(t.result!.netPnl).toBeGreaterThan(0);
    expect(t.result!.r).toBeGreaterThan(1);
    expect(paperStatusLabel(t)).toBe('TP2');
  });
  it('es incremental: no reprocesa velas ya vistas', () => {
    const plan = mkPlan();
    let t = newPaperTrade(plan, 'zonas-1h', false, T);
    const c1 = candles([[2500, 2501, 2495, 2497]], M, T + 1);
    t = advancePaper(t, c1, BASE_CONFIG);
    expect(t.sim.phase).toBe('open');
    const again = advancePaper(t, c1, BASE_CONFIG);
    expect(again).toEqual(t);
  });
  it('en una vela de 1m que toca stop y TP asume el stop', () => {
    let t = newPaperTrade(mkPlan(), 'zonas-1h', false, T);
    t = advancePaper(t, candles([[2500, 2501, 2495, 2497], [2497, 2550, 2470, 2500]], M, T + 1), BASE_CONFIG);
    expect(t.sim).toMatchObject({ outcome: 'stop' });
  });
  it('rechaza planes no operables', () => {
    expect(() => newPaperTrade({ ...mkPlan(), status: 'no-operable-fase' }, 'x', false)).toThrow();
  });
});

describe('trades reales', () => {
  const rt: RealTrade = { id: 'r', kind: 'real', createdAt: 0, symbol: 'ETHUSDT', market: 'futures', direction: 'short', entryPrice: 2500, exitPrice: 2450, qty: 0.01, fees: 0.02, funding: 0.005, openedAt: 0, closedAt: 1, phaseAtEntry: 2, planned: { entry: 2502, stop: 2520, tp1: 2450, tp2: null, qty: 0.012, riskUSDT: 0.25 } };
  it('resultado neto y R respecto del plan', () => {
    expect(realNetPnl(rt)).toBeCloseTo(0.5 - 0.025, 10);
    expect(realR(rt)).toBeCloseTo(0.475 / 0.25, 10);
  });
  it('compara la ejecución con el plan', () => {
    const c = compareWithPlan(rt)!;
    expect(c.entrySlippagePct).toBeCloseTo(((2500 - 2502) / 2502) * -100, 8);
    expect(c.qtyDiffPct).toBeCloseTo(-16.666, 2);
  });
  it('valida los campos', () => {
    expect(validateRealTrade({ ...rt, qty: 0 })).toContain('Cantidad inválida.');
    expect(validateRealTrade(rt)).toEqual([]);
  });
});

describe('validación en vivo', () => {
  const closed = (r: number, i: number, auto = true): PaperTrade => ({
    ...newPaperTrade(mkPlan(), 'zonas-4h', auto, T),
    id: `t${i}`,
    result: { outcome: r > 0 ? 'tp2' : 'stop', fillTime: T + i, exitTime: T + i + 1, netPnl: r * 0.25, fees: 0, funding: 0, r },
  });
  it('solo cuentan los trades automáticos de la estrategia', () => {
    const p = [closed(1, 1), closed(1, 2, false), { ...closed(1, 3), strategyId: 'zonas-1h' }];
    expect(liveSample(p, 'zonas-4h')).toHaveLength(1);
  });
  it('con menos de 30 trades no pasa', () => {
    const st = liveValidationStatus(Array.from({ length: 20 }, (_, i) => closed(1, i)), 'zonas-4h');
    expect(st.enoughTrades).toBe(false);
    expect(st.passed).toBe(false);
  });
  it('con 30+ trades y expectativa > 0,15 R pide la comparación con el azar y pasa solo si le gana', () => {
    const p = Array.from({ length: 30 }, (_, i) => closed(i % 2 ? 1.5 : -1, i));
    const st = liveValidationStatus(p, 'zonas-4h');
    expect(st.meetsExpectancy).toBe(true);
    expect(st.needsRandom).toBe(true);
    expect(st.passed).toBe(false);
    const cache = { computedAt: 0, strategyId: 'zonas-4h', trades: 30, expectancyR: 0.25, comparison: { runs: 100, meanExpectancyR: -0.2, p5ExpectancyR: -0.8, p95ExpectancyR: 0.1, meanTrades: 30, pValue: 0.01 } };
    expect(liveValidationStatus(p, 'zonas-4h', cache).passed).toBe(true);
    expect(liveValidationStatus(p, 'zonas-4h', { ...cache, comparison: { ...cache.comparison, p95ExpectancyR: 0.4 } }).passed).toBe(false);
  });
  it('convierte la muestra al formato del backtest para la línea base al azar', () => {
    const [b] = toBtTrades([closed(1, 1)]);
    expect(b.track).toBe('r');
    expect(b.riskUSDT).toBeGreaterThan(0);
  });
});

describe('exportar / importar', () => {
  it('ida y vuelta sin pérdida', () => {
    const j = emptyJournal(5);
    j.news.push({ id: 'n', time: 10, label: 'CPI' });
    const back = importBundle(exportBundle(j, { a: 1 }));
    expect(back.journal).toEqual(j);
    expect(back.config).toEqual({ a: 1 });
  });
  it('rechaza archivos ajenos o rotos', () => {
    expect(() => importBundle('{nope')).toThrow(/JSON/);
    expect(() => importBundle('{"app":"otra"}')).toThrow(/esta app/);
    expect(() => parseJournal({ version: 2 })).toThrow();
  });
});
