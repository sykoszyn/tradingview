// Redondeos a stepSize / tickSize sin errores de punto flotante.

/** Cantidad de decimales de un paso (0.001 → 3, 0.10 → 1, 1 → 0, 1e-8 → 8). */
export function stepDecimals(step: number): number {
  if (!(step > 0)) throw new Error(`Paso inválido: ${step}`);
  const s = step.toString();
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

export type RoundMode = 'floor' | 'ceil' | 'nearest';

/** Redondea `value` a un múltiplo de `step`. Tolera el ruido de float (1e-9 pasos). */
export function roundToStep(value: number, step: number, mode: RoundMode = 'nearest'): number {
  const dec = stepDecimals(step);
  const ratio = value / step;
  const eps = 1e-9;
  let n: number;
  if (mode === 'floor') n = Math.floor(ratio + eps);
  else if (mode === 'ceil') n = Math.ceil(ratio - eps);
  else n = Math.round(ratio);
  return Number((n * step).toFixed(dec));
}

/** Cantidad redondeada HACIA ABAJO al stepSize (nunca te pasás del riesgo). */
export const roundQty = (qty: number, stepSize: number) => roundToStep(qty, stepSize, 'floor');

/** Precio redondeado al tickSize. */
export const roundPrice = (price: number, tickSize: number, mode: RoundMode = 'nearest') =>
  roundToStep(price, tickSize, mode);

/**
 * Redondeo de un stop "hacia afuera" (más lejos de la entrada), para que el
 * redondeo nunca acerque el stop y aumente la probabilidad de que te saquen por ruido.
 */
export function roundStopOutward(stop: number, tickSize: number, direction: 'long' | 'short'): number {
  return roundPrice(stop, tickSize, direction === 'long' ? 'floor' : 'ceil');
}

export const formatStep = (value: number, step: number) => value.toFixed(stepDecimals(step));
