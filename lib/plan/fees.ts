// Comisiones: SIEMPRE sobre el nocional (cantidad × precio), nunca sobre el margen.
import type { AppConfig } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Direction, Market } from '../types';

export interface FeeRates {
  maker: number; // fracción
  taker: number;
}

export function feeRates(market: Market, cfg: AppConfig): FeeRates {
  return market === 'futures'
    ? { maker: pct(cfg.fees.futuresMakerPct), taker: pct(cfg.fees.futuresTakerPct) }
    : { maker: pct(cfg.fees.spotPct), taker: pct(cfg.fees.spotPct) };
}

/** Comisión de una orden: nocional × tasa. */
export const fee = (qty: number, price: number, rate: number) => qty * price * rate;

/** Ganancia/pérdida bruta de un movimiento (positiva = a favor). */
export const grossPnl = (dir: Direction, qty: number, entry: number, exit: number) =>
  (dir === 'long' ? exit - entry : entry - exit) * qty;

/**
 * R:R neto (después de comisiones) de una salida completa en `target`.
 * Supuestos: entrada maker (limitada); salidas por stop y por TP a mercado (taker),
 * porque la casilla TP/SL de Binance genera órdenes STOP_MARKET / TAKE_PROFIT_MARKET.
 */
export function netRiskReward(dir: Direction, entry: number, stop: number, target: number, r: FeeRates): number {
  const risk = Math.abs(entry - stop) + entry * r.maker + stop * r.taker;
  const reward = (dir === 'long' ? target - entry : entry - target) - entry * r.maker - target * r.taker;
  return risk > 0 ? reward / risk : 0;
}
