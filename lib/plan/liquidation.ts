// Precio de liquidación aproximado en margen AISLADO, modo One-way (fórmula de Binance USDT-M):
//   LP = (WB + cum − lado × Q × EP) / (Q × MMR − lado × Q)
// WB = margen aislado, cum = maintenance amount del bracket, lado = +1 long / −1 short.
import type { BracketSet, Direction } from '../types';
import { pickBracket } from '../market/brackets';

export interface LiquidationInput {
  direction: Direction;
  entry: number;
  qty: number;
  margin: number;
  maintMarginRate: number;
  maintAmount: number;
}

export function liquidationPrice(i: LiquidationInput): number {
  const side = i.direction === 'long' ? 1 : -1;
  const lp = (i.margin + i.maintAmount - side * i.qty * i.entry) / (i.qty * i.maintMarginRate - side * i.qty);
  return Math.max(0, lp);
}

export interface LiquidationInfo {
  price: number;
  distancePct: number; // distancia entrada → liquidación, en %
  stopToLiqRatio: number; // distancia al stop / distancia a la liquidación
  ok: boolean;
  maintMarginRate: number;
  maintAmount: number;
  bracketSource: BracketSet['source'];
}

/** REGLA DE SEGURIDAD: el stop debe estar a menos del 50 % de la distancia entrada → liquidación. */
export const MAX_STOP_TO_LIQ = 0.5;

export function analyzeLiquidation(
  direction: Direction,
  entry: number,
  stop: number,
  qty: number,
  margin: number,
  brackets: BracketSet,
): LiquidationInfo {
  const b = pickBracket(brackets, qty * entry);
  const price = liquidationPrice({ direction, entry, qty, margin, maintMarginRate: b.maintMarginRate, maintAmount: b.maintAmount });
  const liqDist = Math.abs(entry - price);
  const stopDist = Math.abs(entry - stop);
  const ratio = liqDist > 0 ? stopDist / liqDist : Infinity;
  const stopBeforeLiq = direction === 'long' ? stop > price : stop < price;
  return {
    price,
    distancePct: (liqDist / entry) * 100,
    stopToLiqRatio: ratio,
    ok: stopBeforeLiq && ratio < MAX_STOP_TO_LIQ,
    maintMarginRate: b.maintMarginRate,
    maintAmount: b.maintAmount,
    bracketSource: brackets.source,
  };
}
