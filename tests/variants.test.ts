import { describe, expect, it } from 'vitest';
import { BASE_CONFIG, type AppConfig } from '@/lib/config/defaults';
import { atr } from '@/lib/analysis/indicators';
import { detectSetups, type SetupSignal } from '@/lib/analysis/setups';
import { buildPlan } from '@/lib/plan/plan';
import type { Zone } from '@/lib/analysis/zones';
import type { TrendContext } from '@/lib/analysis/trend';
import type { SymbolFilters } from '@/lib/types';
import { candles } from './helpers/candles';

const zone = (low: number, high: number, touches = 4): Zone => ({ id: `z${low}`, low, high, mid: (low + high) / 2, touches, touches4h: 1, lastTouch: 0, firstTouch: 0, score: 5, pivots: [] });
const trend = (t: TrendContext['trend']): TrendContext => ({ trend: t, emaFast: 0, emaSlow: 0, close4h: 0, vwap: 0, aboveVwap: true, explanation: '' });
const withCfg = (a: Partial<AppConfig['analysis']> = {}, p: Partial<AppConfig['plan']> = {}): AppConfig => ({
  ...BASE_CONFIG, analysis: { ...BASE_CONFIG.analysis, ...a }, plan: { ...BASE_CONFIG.plan, ...p },
});
const pad: Array<[number, number, number, number, number]> = Array.from({ length: 20 }, () => [105, 105.2, 104.8, 105, 100]);
const rebound = candles([...pad, [101, 101.5, 100.6, 101], [101, 101.2, 99.9, 100.9]]);
const SUP = zone(99.8, 100.1);
const detect = (cfg: AppConfig, t: TrendContext['trend'], zones = [SUP]) =>
  detectSetups({ candles: rebound, i: rebound.length - 1, zones, trend: trend(t), market: 'futures', cfg });

describe('ATR', () => {
  it('ATR de Wilder con rango verdadero (incluye gaps)', () => {
    const c = candles([[10, 11, 9, 10], [10, 12, 10, 11], [14, 15, 13, 14]]);
    const a = atr(c, 2);
    expect(a[1]).toBeCloseTo((2 + 2) / 2, 10);
    expect(a[2]).toBeCloseTo((2 * 1 + 4) / 2, 10); // TR = max(2, |15−11|, |13−11|) = 4
    expect(Number.isNaN(a[0])).toBe(true);
  });
});

describe('variante b: solo a favor de la tendencia', () => {
  it('descarta en lateral y en contra; acepta a favor', () => {
    const cfg = withCfg({ counterTrendMode: 'withTrendOnly' });
    expect(detect(cfg, 'lateral')).toHaveLength(0);
    expect(detect(cfg, 'bajista')).toHaveLength(0);
    expect(detect(cfg, 'alcista')).toHaveLength(1);
  });
  it('el modo por defecto sí acepta lateral', () => {
    expect(detect(withCfg(), 'lateral')).toHaveLength(1);
  });
});

describe('variante d: zona con al menos 3 toques', () => {
  it('ignora zonas con menos toques', () => {
    const cfg = withCfg({ minZoneTouches: 3 });
    expect(detect(cfg, 'lateral', [zone(99.8, 100.1, 2)])).toHaveLength(0);
    expect(detect(cfg, 'lateral', [zone(99.8, 100.1, 3)])).toHaveLength(1);
  });
});

const ETH: SymbolFilters = { symbol: 'ETHUSDT', market: 'futures', tickSize: 0.01, stepSize: 0.001, minQty: 0.001, marketStepSize: 0.001, marketMinQty: 0.001, minNotional: 20, exchange: 'binance', fetchedAt: 0 };
const sig = (o: Partial<SetupSignal> = {}): SetupSignal => ({
  id: 's', setup: 'rebote-soporte', direction: 'long', candleIndex: 0, signalTime: 0, zone: zone(2490, 2496), stopAnchor: 2488, entry: 2496,
  volumeRatio: 1, counterTrend: false, confidence: 'media', confidenceScore: 4, reasons: [], explanation: '', ...o,
});
const zones = [zone(2490, 2496), zone(2600, 2605), zone(2700, 2705)];
const plan = (cfg: AppConfig, s = sig()) => {
  const r = buildPlan({ signal: s, symbol: 'ETHUSDT', market: 'futures', zones, filters: ETH, cfg, phase: { maxMarginUSDT: 50, maxLeverage: 2 } });
  if (r.kind !== 'plan') throw new Error(r.reason);
  return r.plan;
};

describe('variante a: stop por ATR', () => {
  it('1× ATR detrás del ancla', () => {
    expect(plan(withCfg({}, { stopMode: 'atr', atrMultiplier: 1 }), sig({ atr: 20 })).stop).toBeCloseTo(2468, 2);
  });
  it('1,5× ATR detrás del ancla', () => {
    expect(plan(withCfg({}, { stopMode: 'atr', atrMultiplier: 1.5 }), sig({ atr: 20 })).stop).toBeCloseTo(2458, 2);
  });
  it('short: ATR por encima del ancla', () => {
    const s = sig({ direction: 'short', setup: 'rechazo-resistencia', zone: zone(2600, 2605), stopAnchor: 2606, entry: 2600, atr: 10 });
    const r = buildPlan({ signal: s, symbol: 'ETHUSDT', market: 'futures', zones: [zone(2600, 2605), zone(2500, 2505), zone(2400, 2405)], filters: ETH, cfg: withCfg({}, { stopMode: 'atr' }), phase: { maxMarginUSDT: 50, maxLeverage: 2 } });
    if (r.kind !== 'plan') throw new Error(r.reason);
    expect(r.plan.stop).toBeCloseTo(2616, 2);
  });
  it('sin ATR usa el margen fijo y avisa', () => {
    const p = plan(withCfg({}, { stopMode: 'atr' }));
    expect(p.warnings.join(' ')).toMatch(/Sin ATR/);
  });
});

describe('variante c: señales en 4h', () => {
  it('el vencimiento se cuenta en velas de 4h y los porcentajes de stop se escalan', () => {
    const p = plan(withCfg({ signalTimeframe: '4h' }), sig({ stopAnchor: 2495 }));
    expect(p.expiresAt - p.signalTime).toBe(4 * 4 * 3_600_000);
    expect(p.stopDistancePct).toBeGreaterThanOrEqual(0.6 - 1e-6);
    expect(p.invalidation).toMatch(/velas de 4h/);
  });
});
