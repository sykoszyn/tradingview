// Extensiones de futuros para buildPlan: liquidación (regla de seguridad) y funding.
import type { BracketSet } from '../types';
import type { PlanExtension } from './plan';
import { analyzeLiquidation, MAX_STOP_TO_LIQ } from './liquidation';
import { estimateFunding } from './funding';

/**
 * Regla stop vs. liquidación: si el stop no está a menos del 50 % de la
 * distancia a la liquidación, el dimensionamiento baja el apalancamiento;
 * si ni con 1x se cumple, la señal se descarta.
 */
export function liquidationExtension(brackets: BracketSet): PlanExtension {
  return {
    leverageCheck: ({ direction, entry, stop }) => ({ qty, margin, leverage }) => {
      const l = analyzeLiquidation(direction, entry, stop, qty, margin, brackets);
      return l.ok
        ? null
        : `A ${leverage}x el stop está al ${(l.stopToLiqRatio * 100).toFixed(0)}% de la distancia a la liquidación (máximo ${MAX_STOP_TO_LIQ * 100}%).`;
    },
    enrich: (plan) => {
      if (plan.status !== 'operable') return;
      plan.liquidation = analyzeLiquidation(plan.direction, plan.entry, plan.stop, plan.sizing.qty, plan.sizing.margin, brackets);
      if (brackets.warning) plan.warnings.push(brackets.warning);
    },
  };
}

export function fundingExtension(rate: number, intervalHours = 8, nextFundingTime?: number): PlanExtension {
  return {
    enrich: (plan) => {
      const notional = plan.status === 'operable' ? plan.sizing.notional : plan.sizing.minNotional;
      plan.funding = estimateFunding(plan.direction, notional, rate, intervalHours, nextFundingTime);
    },
  };
}
