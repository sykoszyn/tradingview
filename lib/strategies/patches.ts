// Parámetros que DEFINEN cada estrategia. Solo estos campos cambian entre
// estrategias; el resto de la configuración (riesgo, comisiones, límites) es del usuario.
import type { AppConfig } from '../config/defaults';

export interface StrategyPatch {
  analysis: Pick<AppConfig['analysis'], 'signalTimeframe' | 'counterTrendMode' | 'minZoneTouches'>;
  plan: Pick<AppConfig['plan'], 'stopMode' | 'atrMultiplier'>;
}

export const STRATEGY_PATCHES = {
  /** Variante c del experimento: setups en velas de 4h. */
  'zonas-4h': {
    analysis: { signalTimeframe: '4h', counterTrendMode: 'discard', minZoneTouches: 1 },
    plan: { stopMode: 'percent', atrMultiplier: 1 },
  },
  /** Reglas originales: setups en velas de 1h. */
  'zonas-1h': {
    analysis: { signalTimeframe: '1h', counterTrendMode: 'discard', minZoneTouches: 1 },
    plan: { stopMode: 'percent', atrMultiplier: 1 },
  },
} satisfies Record<string, StrategyPatch>;

export type StrategyId = keyof typeof STRATEGY_PATCHES;
export const DEFAULT_STRATEGY_ID: StrategyId = 'zonas-4h';

export function applyPatch(cfg: AppConfig, id: StrategyId): AppConfig {
  const p = STRATEGY_PATCHES[id];
  return { ...cfg, strategyId: id, analysis: { ...cfg.analysis, ...p.analysis }, plan: { ...cfg.plan, ...p.plan } };
}
