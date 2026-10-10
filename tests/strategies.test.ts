import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/config/defaults';
import { sanitizeConfig } from '@/lib/config/schema';
import { edgeNote, latestValidationEnd, STRATEGIES, strategyStatus } from '@/lib/strategies/registry';

describe('estrategias', () => {
  it('la estrategia por defecto es zonas-4h (señales en 4h)', () => {
    expect(DEFAULT_CONFIG.strategyId).toBe('zonas-4h');
    expect(DEFAULT_CONFIG.analysis.signalTimeframe).toBe('4h');
  });
  it('zonas-4h tiene la validación fallida registrada y el aviso de sin ventaja', () => {
    const s = STRATEGIES['zonas-4h'];
    expect(strategyStatus(s)).toBe('validacion-fallida');
    expect(edgeNote(s)).toMatch(/SIN VENTAJA DEMOSTRADA/);
    expect(s.validation!.trades).toBe(14);
  });
  it('los campos de la estrategia no se pueden editar sueltos', () => {
    const { config } = sanitizeConfig({ strategyId: 'zonas-4h', analysis: { signalTimeframe: '1h', minZoneTouches: 5 } });
    expect(config.analysis.signalTimeframe).toBe('4h');
    expect(config.analysis.minZoneTouches).toBe(1);
  });
  it('estrategia desconocida → default con corrección', () => {
    const r = sanitizeConfig({ strategyId: 'magia' });
    expect(r.config.strategyId).toBe('zonas-4h');
    expect(r.corrections.join(' ')).toMatch(/desconocida/);
  });
  it('una validación nueva tiene que empezar después de la última', () => {
    expect(latestValidationEnd()).toBe(STRATEGIES['zonas-4h'].validation!.period.to);
  });
});
