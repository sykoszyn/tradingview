import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/config/defaults';
import { configWarnings, sanitizeConfig } from '@/lib/config/schema';

describe('sanitizeConfig', () => {
  it('devuelve los defaults si no hay nada guardado', () => {
    expect(sanitizeConfig(undefined).config).toEqual(DEFAULT_CONFIG);
  });
  it('nunca permite más de 3x aunque se pida', () => {
    const { config, corrections } = sanitizeConfig({ sizing: { defaultLeverage: 10 }, phases: { phase4: { maxLeverage: 20 } } });
    expect(config.sizing.defaultLeverage).toBe(3);
    expect(config.phases.phase4.maxLeverage).toBe(3);
    expect(corrections.length).toBeGreaterThan(0);
  });
  it('restaura valores inválidos al default', () => {
    const { config } = sanitizeConfig({ plan: { minRR: -1 }, limits: { maxTradesPerDay: 'x' } });
    expect(config.plan.minRR).toBe(DEFAULT_CONFIG.plan.minRR);
    expect(config.limits.maxTradesPerDay).toBe(DEFAULT_CONFIG.limits.maxTradesPerDay);
  });
  it('el margen máximo de fase no puede ser menor a 10 USDT', () => {
    expect(sanitizeConfig({ phases: { phase2: { maxMarginUSDT: 5 } } }).config.phases.phase2.maxMarginUSDT).toBe(10);
  });
});

describe('configWarnings', () => {
  it('sin cambios no hay advertencias', () => {
    expect(configWarnings(DEFAULT_CONFIG)).toEqual([]);
  });
  it('avisa si bajo los umbrales de fases', () => {
    const c = structuredClone(DEFAULT_CONFIG);
    c.phases.paperMinTrades = 10;
    c.phases.rollbackDrawdownPct = 30;
    const w = configWarnings(c);
    expect(w.some((x) => x.includes('paper trading'))).toBe(true);
    expect(w.some((x) => x.includes('retroceso'))).toBe(true);
  });
});
