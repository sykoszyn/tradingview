// Funding de perpetuos. Tasa positiva: los LONG pagan y los SHORT cobran (y al revés).
import type { Direction, FundingRatePoint } from '../types';

/** Pago de funding de UN evento. Positivo = pagás, negativo = cobrás. */
export const fundingPayment = (direction: Direction, notional: number, rate: number) =>
  (direction === 'long' ? 1 : -1) * notional * rate;

/** Intervalo de funding (h) deducido del historial; 8 h por defecto. */
export function fundingIntervalHours(points: FundingRatePoint[]): number {
  if (points.length < 2) return 8;
  const diffs: number[] = [];
  for (let i = 1; i < points.length; i++) diffs.push((points[i].fundingTime - points[i - 1].fundingTime) / 3_600_000);
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  const h = Math.round(median);
  return h >= 1 && h <= 24 ? h : 8;
}

export interface FundingEstimate {
  rate: number; // fracción por intervalo
  intervalHours: number;
  nextFundingTime?: number;
  /** Costo estimado manteniendo la posición 8, 16 y 24 h. Positivo = pagás. */
  costs: Array<{ hours: number; events: number; cost: number }>;
  pays: boolean; // con la tasa actual, ¿esta dirección paga?
  lines: string[];
}

export function estimateFunding(
  direction: Direction,
  notional: number,
  rate: number,
  intervalHours = 8,
  nextFundingTime?: number,
): FundingEstimate {
  const costs = [8, 16, 24].map((hours) => {
    const events = Math.floor(hours / intervalHours);
    return { hours, events, cost: fundingPayment(direction, notional, rate) * events };
  });
  const pays = fundingPayment(direction, 1, rate) > 0;
  const pctTxt = (rate * 100).toFixed(4);
  const word = rate === 0 ? 'ni paga ni cobra' : pays ? 'PAGA' : 'COBRA';
  const lines = [
    `Funding actual: ${pctTxt}% cada ${intervalHours} h → ${direction === 'long' ? 'el long' : 'el short'} ${word}.`,
    `Funding estimado: ${costs.map((c) => `${c.hours} h: ${c.cost > 0 ? 'pagás' : c.cost < 0 ? 'cobrás' : '—'} ${Math.abs(c.cost).toFixed(4)} USDT`).join(' · ')}`,
  ];
  return { rate, intervalHours, nextFundingTime, costs, pays, lines };
}

/**
 * Funding histórico entre la apertura (exclusiva) y el cierre (inclusiva) de una
 * posición. `notionalAt` devuelve el nocional en el momento de cada cobro.
 * Positivo = pagado.
 */
export function historicalFunding(
  direction: Direction,
  points: FundingRatePoint[],
  openTime: number,
  closeTime: number,
  notionalAt: (t: number) => number,
): { total: number; events: number } {
  let total = 0;
  let events = 0;
  for (const p of points) {
    if (p.fundingTime > openTime && p.fundingTime <= closeTime) {
      total += fundingPayment(direction, notionalAt(p.fundingTime), p.fundingRate);
      events++;
    }
  }
  return { total, events };
}
