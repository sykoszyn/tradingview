// Trades reales cargados a mano.
import type { RealTrade } from './types';

export function realNetPnl(t: RealTrade): number {
  const sign = t.direction === 'long' ? 1 : -1;
  return sign * (t.exitPrice - t.entryPrice) * t.qty - t.fees - t.funding;
}

/** R del trade real respecto del riesgo que planificó la app (si hubo plan). */
export function realR(t: RealTrade): number {
  const risk = t.planned?.riskUSDT ?? 0;
  return risk > 0 ? realNetPnl(t) / risk : 0;
}

export function validateRealTrade(t: Partial<RealTrade>): string[] {
  const e: string[] = [];
  const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!t.symbol) e.push('Falta el par.');
  if (!t.direction) e.push('Falta la dirección.');
  if (!pos(t.entryPrice)) e.push('Precio de entrada inválido.');
  if (!pos(t.exitPrice)) e.push('Precio de salida inválido.');
  if (!pos(t.qty)) e.push('Cantidad inválida.');
  if (typeof t.fees !== 'number' || t.fees < 0) e.push('Comisiones inválidas.');
  if (t.openedAt && t.closedAt && t.closedAt < t.openedAt) e.push('La salida no puede ser anterior a la entrada.');
  return e;
}

/** Comparación plan vs. ejecución real (desvíos de precio y cantidad). */
export function compareWithPlan(t: RealTrade) {
  if (!t.planned) return null;
  const sign = t.direction === 'long' ? 1 : -1;
  return {
    entrySlippagePct: ((t.entryPrice - t.planned.entry) / t.planned.entry) * 100 * sign,
    qtyDiffPct: ((t.qty - t.planned.qty) / t.planned.qty) * 100,
    exitVsStop: t.exitPrice === t.planned.stop,
  };
}
