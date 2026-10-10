import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AppConfig } from '@/lib/config/defaults';
import { detectSetups, scoreConfidence } from '@/lib/analysis/setups';
import type { Zone } from '@/lib/analysis/zones';
import type { TrendContext } from '@/lib/analysis/trend';
import { candles } from './helpers/candles';

const zone = (low: number, high: number, touches = 4, score = 5): Zone => ({
  id: `z${low}`, low, high, mid: (low + high) / 2, touches, touches4h: 1, lastTouch: 0, firstTouch: 0, score, pivots: [],
});
const trend = (t: TrendContext['trend'], aboveVwap = true): TrendContext => ({
  trend: t, emaFast: 0, emaSlow: 0, close4h: 0, vwap: 0, aboveVwap, explanation: '',
});
const cfg = (patch: Partial<AppConfig['analysis']> = {}): AppConfig => ({ ...DEFAULT_CONFIG, analysis: { ...DEFAULT_CONFIG.analysis, ...patch } });

/** 20 velas planas de relleno (para el promedio de volumen) + las velas del caso. */
function series(rows: Array<[number, number, number, number, number?]>, base = 105) {
  const pad: Array<[number, number, number, number, number]> = Array.from({ length: 20 }, () => [base, base + 0.2, base - 0.2, base, 100]);
  return candles([...pad, ...rows]);
}
const run = (c: ReturnType<typeof series>, zones: Zone[], market: 'spot' | 'futures' = 'futures', t = trend('lateral'), config = cfg()) =>
  detectSetups({ candles: c, i: c.length - 1, zones, trend: t, market, cfg: config });

const SUP = zone(99.8, 100.1);
const RES = zone(109.9, 110.2);

describe('setups LONG', () => {
  it('rebote en soporte: mecha inferior ≥ 50 % y cierre arriba', () => {
    const c = series([[101, 101.5, 100.6, 101], [101, 101.2, 99.9, 100.9]]); // rango 1.3, mecha 1.0
    const [s] = run(c, [SUP]);
    expect(s.setup).toBe('rebote-soporte');
    expect(s.direction).toBe('long');
    expect(s.stopAnchor).toBe(99.8);
    expect(s.entry).toBe(100.1);
    expect(s.explanation).toMatch(/soporte/);
  });
  it('sin mecha suficiente no hay rebote', () => {
    const c = series([[101, 101.5, 100.6, 101], [100.5, 101, 99.9, 100.2]]); // mecha 0.3 / 1.1
    expect(run(c, [SUP]).find((s) => s.setup === 'rebote-soporte')).toBeUndefined();
  });
  it('recuperación de zona: cierre arriba y la siguiente no vuelve a cerrar debajo', () => {
    const c = series([[100, 100, 99, 99.5], [99.5, 100.6, 99.4, 100.5], [100.5, 100.8, 100.3, 100.6]]);
    expect(run(c, [SUP])[0]?.setup).toBe('recuperacion-zona');
  });
  it('si la vela siguiente vuelve a cerrar debajo, no hay recuperación', () => {
    const c = series([[100, 100, 99, 99.5], [99.5, 100.6, 99.4, 100.5], [100.5, 100.6, 99.3, 99.6]]);
    expect(run(c, [SUP]).find((s) => s.setup === 'recuperacion-zona')).toBeUndefined();
  });
  it('ruptura de resistencia con volumen > 1,5× promedio', () => {
    const c = series([[109, 109.8, 108.8, 109.5, 100], [109.5, 111, 109.4, 110.8, 200]], 109);
    const [s] = run(c, [RES]);
    expect(s.setup).toBe('ruptura-resistencia');
    expect(s.volumeRatio).toBeCloseTo(2, 5);
  });
  it('ruptura sin volumen no cuenta', () => {
    const c = series([[109, 109.8, 108.8, 109.5, 100], [109.5, 111, 109.4, 110.8, 120]], 109);
    expect(run(c, [RES])).toHaveLength(0);
  });
});

describe('setups SHORT', () => {
  it('rechazo en resistencia: mecha superior ≥ 50 % y cierre abajo', () => {
    const c = series([[109, 109.4, 108.5, 109], [109, 110.1, 108.8, 109.1]], 109);
    const [s] = run(c, [RES]);
    expect(s.setup).toBe('rechazo-resistencia');
    expect(s.direction).toBe('short');
    expect(s.stopAnchor).toBe(110.2);
    expect(s.entry).toBe(109.9);
  });
  it('pérdida de soporte: cierre debajo y la siguiente no lo recupera', () => {
    const c = series([[100.5, 100.8, 100.2, 100.5], [100.5, 100.6, 99.2, 99.4], [99.4, 99.9, 99.2, 99.6]], 101);
    expect(run(c, [SUP])[0]?.setup).toBe('perdida-soporte');
  });
  it('ruptura de soporte con volumen alto', () => {
    const c = series([[100.5, 100.8, 100, 100.3, 100], [100.3, 100.4, 99, 99.2, 300]], 101);
    expect(run(c, [SUP])[0]?.setup).toBe('ruptura-soporte');
  });
  it('en spot NO se generan shorts', () => {
    const c = series([[109, 109.4, 108.5, 109], [109, 110.1, 108.8, 109.1]], 109);
    expect(run(c, [RES], 'spot')).toHaveLength(0);
  });
});

describe('filtro de tendencia y confianza', () => {
  const c = series([[101, 101.5, 100.6, 101], [101, 101.2, 99.9, 100.9]]);
  it('descarta señales contra la tendencia de 4h (modo por defecto)', () => {
    expect(run(c, [SUP], 'futures', trend('bajista'))).toHaveLength(0);
  });
  it('en modo "bajar confianza" la muestra con confianza baja', () => {
    const [s] = run(c, [SUP], 'futures', trend('bajista'), cfg({ counterTrendMode: 'lowerConfidence' }));
    expect(s.counterTrend).toBe(true);
    expect(s.confidence).toBe('baja');
  });
  it('zona fuerte + tendencia a favor + volumen → alta', () => {
    const z = zone(99.8, 100.1, 5, 10);
    expect(scoreConfidence({ zone: z, direction: 'long', volumeRatio: 2 }, [z], trend('alcista'), false).confidence).toBe('alta');
    expect(scoreConfidence({ zone: z, direction: 'long', volumeRatio: 0.5 }, [z, zone(1, 2, 1, 100)], trend('lateral', false), false).confidence).toBe('baja');
  });
  it('solo mira la última vela cerrada (i), nunca velas futuras', () => {
    const extra = [...c, ...candles([[100.9, 120, 100, 119]], 3_600_000, c[c.length - 1].closeTime + 1)];
    const a = detectSetups({ candles: c, i: c.length - 1, zones: [SUP], trend: trend('lateral'), market: 'futures', cfg: cfg() });
    const b = detectSetups({ candles: extra, i: c.length - 1, zones: [SUP], trend: trend('lateral'), market: 'futures', cfg: cfg() });
    expect(b).toEqual(a);
  });
});
