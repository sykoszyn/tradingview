// Tamaño de posición y apalancamiento.
//
// nocional = riesgo_USDT / pérdida_por_unidad_%  (distancia al stop + comisiones)
// - Si da menos que el nocional mínimo del par, se sube al mínimo.
// - margen = nocional / apalancamiento, entre 10 USDT y el máximo de la fase.
//   Si el margen queda < 10: primero se BAJA el apalancamiento; si con 1x sigue
//   faltando, se SUBE el nocional a 10 USDT.
// - Si con el margen máximo y el apalancamiento máximo de la fase no se llega al
//   mínimo del par → "no operable en tu fase".
// - Si el riesgo real supera riesgo × multiplicador (2× por defecto) → descartada.
import { HARD_LIMITS, type PhaseLimits } from '../config/defaults';
import type { Direction, Market, SymbolFilters } from '../types';
import { checkOrderMinimums, computeMinimums } from '../market/filters';
import { roundToStep } from '../market/rounding';
import type { FeeRates } from './fees';

export type SizingStatus = 'ok' | 'no-operable-fase' | 'riesgo-excesivo' | 'liquidacion';

export interface SizingInput {
  direction: Direction;
  market: Market;
  entry: number;
  stop: number;
  filters: SymbolFilters;
  riskUSDT: number;
  maxRiskMultiplier: number;
  defaultLeverage: number;
  phase: PhaseLimits;
  fees: FeeRates;
  /** Regla extra por apalancamiento (p. ej. stop vs. liquidación). Devuelve null si pasa o el motivo si no. */
  leverageCheck?: (a: { leverage: number; qty: number; notional: number; margin: number }) => string | null;
}

export interface SizingResult {
  status: SizingStatus;
  leverage: number;
  qty: number;
  notional: number;
  margin: number;
  /** Pérdida real si toca el stop, con comisiones (entrada maker + stop taker). */
  realRiskUSDT: number;
  targetNotional: number;
  minNotional: number;
  minQty: number;
  /** Margen que haría falta para el mínimo del par con el apalancamiento máximo de la fase. */
  requiredMargin: number;
  requiredLeverage: number;
  adjustments: string[];
  reason?: string;
}

const EPS = 1e-9;
const f2 = (n: number) => n.toFixed(2);

type Attempt =
  | { ok: true; leverage: number; qty: number; notional: number; margin: number; realRisk: number; adjustments: string[] }
  | { ok: false; why: 'lower-lev' | 'min-notional' | 'liquidacion' | 'riesgo'; detail?: string };

export function sizePosition(inp: SizingInput): SizingResult {
  const { entry, stop, filters, phase, fees } = inp;
  const minM = HARD_LIMITS.minMarginUSDT;
  const mins = computeMinimums(filters, entry);
  const step = Math.max(filters.stepSize, filters.marketStepSize);
  const perUnitLoss = Math.abs(entry - stop) + entry * fees.maker + stop * fees.taker;
  const lossFrac = perUnitLoss / entry;
  const targetNotional = inp.riskUSDT / lossFrac;
  const phaseMaxLev = inp.market === 'spot' ? 1 : Math.min(phase.maxLeverage, HARD_LIMITS.maxLeverage);
  const defLev = inp.market === 'spot' ? 1 : Math.max(1, Math.min(Math.floor(inp.defaultLeverage), phaseMaxLev));
  const requiredLeverage = Math.ceil(mins.minNotional / phase.maxMarginUSDT - EPS);

  const base = {
    targetNotional,
    minNotional: mins.minNotional,
    minQty: mins.minQty,
    requiredMargin: mins.minNotional / phaseMaxLev,
    requiredLeverage,
  };

  const attempt = (lev: number): Attempt => {
    const adj: string[] = [];
    let notional = targetNotional;
    if (notional < mins.minNotional) {
      adj.push(`Nocional por riesgo (${f2(targetNotional)} USDT) menor al mínimo del par: se subió a ${f2(mins.minNotional)} USDT.`);
      notional = mins.minNotional;
    }
    if (notional / lev < minM - EPS) {
      if (lev > 1) return { ok: false, why: 'lower-lev' };
      adj.push(`Margen menor a ${minM} USDT incluso a 1x: se subió el nocional a ${minM} USDT.`);
      notional = minM;
    }
    if (notional / lev > phase.maxMarginUSDT + EPS) {
      const capped = phase.maxMarginUSDT * lev;
      if (capped < mins.minNotional - EPS) return { ok: false, why: 'min-notional' };
      adj.push(`Margen limitado al máximo de tu fase (${phase.maxMarginUSDT} USDT): nocional ${f2(capped)} USDT.`);
      notional = capped;
    }
    // Cantidad al stepSize: hacia abajo salvo que eso rompa un mínimo.
    const maxNotional = phase.maxMarginUSDT * lev;
    let qty = roundToStep(notional / entry, step, 'floor');
    // Mínimos del exchange: obligatorios. Margen mínimo de 10 USDT: se tolera quedar
    // hasta un stepSize por debajo por el redondeo (si no, con margen mínimo = máximo
    // de la fase nunca habría una cantidad válida).
    const breaksExchange = (q: number) => q * entry < mins.minNotional - EPS || q < mins.minQty - EPS;
    const breaksMargin = (q: number) => ((q + step) * entry) / lev < minM - EPS;
    if (breaksExchange(qty) || breaksMargin(qty)) qty = roundToStep(notional / entry, step, 'ceil');
    if (breaksExchange(qty)) qty = Math.max(qty, mins.minQty);
    if (qty * entry > maxNotional + EPS) return { ok: false, why: 'min-notional' };
    const check = checkOrderMinimums(filters, qty, entry);
    if (!check.ok) return { ok: false, why: 'min-notional' };
    const realNotional = qty * entry;
    const margin = realNotional / lev;
    const realRisk = qty * perUnitLoss;
    const liq = inp.leverageCheck?.({ leverage: lev, qty, notional: realNotional, margin });
    if (liq) return { ok: false, why: 'liquidacion', detail: liq };
    if (realRisk > inp.riskUSDT * inp.maxRiskMultiplier + EPS)
      return { ok: false, why: 'riesgo', detail: `Riesgo real ${f2(realRisk)} USDT supera ${inp.maxRiskMultiplier}× tu riesgo (${f2(inp.riskUSDT)} USDT).` };
    if (realRisk > inp.riskUSDT * 1.0001)
      adj.push(`Riesgo real ${f2(realRisk)} USDT, mayor a tu riesgo configurado (${f2(inp.riskUSDT)} USDT).`);
    else if (realRisk < inp.riskUSDT * 0.98) adj.push(`Riesgo real ${f2(realRisk)} USDT (menor al configurado por los límites de margen).`);
    return { ok: true, leverage: lev, qty, notional: realNotional, margin, realRisk, adjustments: adj };
  };

  // Orden: apalancamiento por defecto → menor (para margen mínimo o regla de liquidación) →
  // mayor hasta el máximo de la fase (solo si hace falta para el mínimo del par).
  const order: number[] = [];
  for (let l = defLev; l >= 1; l--) order.push(l);
  for (let l = defLev + 1; l <= phaseMaxLev; l++) order.push(l);
  const fails: Attempt[] = [];
  for (const lev of order) {
    const a = attempt(lev);
    if (a.ok) {
      const adjustments = [...a.adjustments];
      if (lev < defLev) adjustments.unshift(`Apalancamiento bajado de ${defLev}x a ${lev}x.`);
      if (lev > defLev) adjustments.unshift(`Apalancamiento subido a ${lev}x (máximo de tu fase) para alcanzar el mínimo del par.`);
      return { ...base, status: 'ok', leverage: lev, qty: a.qty, notional: a.notional, margin: a.margin, realRiskUSDT: a.realRisk, adjustments };
    }
    fails.push(a);
  }
  const reasons = fails.filter((f): f is Extract<Attempt, { ok: false }> => !f.ok);
  const empty = { ...base, leverage: defLev, qty: 0, notional: 0, margin: 0, realRiskUSDT: 0, adjustments: [] as string[] };
  if (reasons.some((r) => r.why === 'riesgo'))
    return { ...empty, status: 'riesgo-excesivo', reason: reasons.find((r) => r.why === 'riesgo')!.detail };
  if (reasons.some((r) => r.why === 'liquidacion'))
    return { ...empty, status: 'liquidacion', reason: reasons.find((r) => r.why === 'liquidacion')!.detail };
  return {
    ...empty,
    status: 'no-operable-fase',
    reason: `El mínimo de ${filters.symbol} (${f2(mins.minNotional)} USDT de nocional) necesita ${f2(base.requiredMargin)} USDT de margen a ${phaseMaxLev}x; tu fase permite ${phase.maxMarginUSDT} USDT${inp.market === 'futures' ? ` y hasta ${phaseMaxLev}x` : ''}.`,
  };
}
