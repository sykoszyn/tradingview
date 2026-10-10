// Registro de estrategias. Toda estrategia nueva pasa por el mismo proceso:
//  1) Ajuste en un período de historial (npm run experiment -- tune …).
//  2) Reglas cerradas y commiteadas ANTES de mirar el período de validación.
//  3) Validación ÚNICA en datos no usados antes (npm run experiment -- validate <id>),
//     comparada contra entradas al azar. El resultado queda en validations/<id>.json.
//  4) En vivo, el paper trading cuenta como una nueva validación fuera de muestra.
// Ver docs/nuevas-estrategias.md.
import { STRATEGY_PATCHES, type StrategyId, type StrategyPatch } from './patches';
import zonas4h from './validations/zonas-4h.json';

export interface ValidationRecord {
  period: { from: number; to: number };
  trades: number;
  winRate: number;
  expectancyR: number;
  totalR: number;
  maxDrawdownR: number;
  random: { meanExpectancyR: number; p5ExpectancyR: number; p95ExpectancyR: number; pValue: number; runs: number };
  beatsRandom: boolean;
  criterion: string;
  passed: boolean;
}

export interface TuningRecord {
  period: { from: number; to: number };
  trades: number;
  expectancyR: number;
  randomP95: number;
  beatsRandom: boolean;
}

export interface StrategyDef {
  id: StrategyId;
  name: string;
  description: string;
  patch: StrategyPatch;
  /** Commit en el que se cerraron las reglas antes de validar. */
  frozenCommit?: string;
  tuning?: TuningRecord;
  validation?: ValidationRecord;
}

export type StrategyStatus = 'sin-validar' | 'validacion-fallida' | 'validada';

const asValidation = (j: { result: ValidationRecord }): ValidationRecord => j.result;

export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  'zonas-4h': {
    id: 'zonas-4h',
    name: 'Zonas S/R en 4h',
    description: 'Rebotes, recuperaciones y rupturas de zonas de soporte/resistencia evaluadas en velas de 4h cerradas (variante c).',
    patch: STRATEGY_PATCHES['zonas-4h'],
    frozenCommit: '384d947',
    tuning: { period: { from: Date.UTC(2025, 9, 10), to: Date.UTC(2026, 5, 10) }, trades: 26, expectancyR: -0.316, randomP95: 0.363, beatsRandom: false },
    validation: asValidation(zonas4h as never),
  },
  'zonas-1h': {
    id: 'zonas-1h',
    name: 'Zonas S/R en 1h (original)',
    description: 'Las reglas originales: mismos setups evaluados en velas de 1h. En el ajuste perdió más que entradas al azar.',
    patch: STRATEGY_PATCHES['zonas-1h'],
    tuning: { period: { from: Date.UTC(2025, 9, 10), to: Date.UTC(2026, 5, 10) }, trades: 86, expectancyR: -0.711, randomP95: -0.012, beatsRandom: false },
  },
};

export function strategyStatus(s: StrategyDef): StrategyStatus {
  if (!s.validation) return 'sin-validar';
  return s.validation.passed && s.validation.beatsRandom ? 'validada' : 'validacion-fallida';
}

const r = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2).replace('.', ',')} R`;

/** Aclaración visible sobre la ventaja (o falta de ventaja) de la estrategia. */
export function edgeNote(s: StrategyDef): string {
  const st = strategyStatus(s);
  if (st === 'validada') return `Validada fuera de muestra: ${r(s.validation!.expectancyR)} por trade en ${s.validation!.trades} trades.`;
  if (st === 'validacion-fallida')
    return `SIN VENTAJA DEMOSTRADA: en la validación fuera de muestra dio ${r(s.validation!.expectancyR)} por trade en ${s.validation!.trades} trades, igual que entrar al azar. Usala solo para analizar y practicar.`;
  return s.tuning
    ? `SIN VENTAJA DEMOSTRADA: no fue validada; en el ajuste dio ${r(s.tuning.expectancyR)} por trade y no le ganó al azar.`
    : 'SIN VALIDAR: todavía no pasó por ajuste ni validación.';
}

/** Fin del último período de validación: una estrategia nueva tiene que validarse con datos posteriores. */
export function latestValidationEnd(): number {
  return Math.max(0, ...Object.values(STRATEGIES).map((s) => s.validation?.period.to ?? 0));
}

export const STRATEGY_LIST = Object.values(STRATEGIES);
