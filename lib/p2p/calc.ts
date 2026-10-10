// Cálculos de márgenes, precios sugeridos y escenarios. Funciones puras.
import type { Platform } from './types';

export interface Fees {
  maker: number | null; // fracción (0.002 = 0,2 %); null = sin cargar
  taker: number | null;
  /** Monto fijo en USDT por cada orden tomada (Binance P2P: 0,05 USDT). */
  takerFlat?: number;
}

export interface CalcSettings {
  fees: Record<Platform, Fees>;
  withdrawUsdt: Record<Platform, number | null>; // retirar USDT DESDE esa plataforma
  capitalArs: number;
  capitalUsdt: number;
  minMargin: number; // fracción
  step: number; // ARS para quedar primero
}

export interface Best {
  bid: number | null; // mejor comprador (lo máximo que pagan)
  ask: number | null; // mejor vendedor (lo mínimo que piden)
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;

/** Ganancia neta (fracción) de comprar a B y vender a S con comisiones fb y fs. */
export const cycleMargin = (B: number, S: number, fb: number, fs: number) => (S * (1 - fs) * (1 - fb) - B) / B;

export interface Suggestion {
  buy: number | null;
  sell: number | null;
  buyTop: boolean;
  sellTop: boolean;
  note?: string;
}

/** Precios para MIS anuncios en una plataforma: un paso mejor que el primero de la lista, sin bajar de mi margen. */
export function suggest(best: Best, fees: Fees, s: Pick<CalcSettings, 'minMargin' | 'step'>): Suggestion {
  const f = fees.maker ?? 0;
  let buy = best.bid !== null ? round2(best.bid + s.step) : null;
  const sell = best.ask !== null ? round2(best.ask - s.step) : null;
  let buyTop = buy !== null;
  let note: string | undefined;
  if (buy !== null && sell !== null && cycleMargin(buy, sell, f, f) < s.minMargin) {
    const cap = floor2((sell * (1 - f) * (1 - f)) / (1 + s.minMargin));
    note = `Para respetar tu ganancia mínima, tu compra queda en ${cap.toLocaleString('es-AR', { minimumFractionDigits: 2 })}: no vas a aparecer primero.`;
    buyTop = best.bid !== null && cap >= best.bid + s.step - 1e-9;
    buy = cap;
  }
  return { buy, sell, buyTop, sellTop: sell !== null, note };
}

export function cycleQty(buyPrice: number, s: Pick<CalcSettings, 'capitalArs' | 'capitalUsdt'>) {
  const fromArs = buyPrice > 0 ? s.capitalArs / buyPrice : 0;
  if (fromArs > 0 && s.capitalUsdt > 0) return { q: Math.min(fromArs, s.capitalUsdt), example: false };
  if (fromArs > 0) return { q: fromArs, example: false };
  if (s.capitalUsdt > 0) return { q: s.capitalUsdt, example: false };
  return { q: 100, example: true };
}

export type Mode = 'maker' | 'taker';
export type Light = 'ok' | 'warn' | 'bad';

export interface Scenario {
  buyPl: Platform;
  sellPl: Platform;
  ok: boolean;
  B: number | null;
  S: number | null;
  cross: boolean;
  W: number;
  missing: string[]; // datos que faltan (comisiones, retiro) y se tomaron como 0
  /** Falta algún dato: el resultado no es confiable y no puede ser "la mejor jugada". */
  incomplete: boolean;
  q?: number;
  example?: boolean;
  perUsdt?: number;
  pct?: number;
  profit?: number;
  light?: Light;
}

export function scenario(buyPl: Platform, sellPl: Platform, best: Record<Platform, Best>, s: CalcSettings, mode: Mode): Scenario {
  const kind = mode === 'maker' ? 'maker' : 'taker';
  const B = mode === 'maker' ? (best[buyPl].bid !== null ? round2(best[buyPl].bid! + s.step) : null) : best[buyPl].ask;
  const S = mode === 'maker' ? (best[sellPl].ask !== null ? round2(best[sellPl].ask! - s.step) : null) : best[sellPl].bid;
  const missing: string[] = [];
  const fbRaw = s.fees[buyPl][kind];
  const fsRaw = s.fees[sellPl][kind];
  if (fbRaw === null) missing.push(`comisión ${kind} de ${buyPl === 'binance' ? 'Binance' : 'MEXC'}`);
  if (fsRaw === null && sellPl !== buyPl) missing.push(`comisión ${kind} de ${sellPl === 'binance' ? 'Binance' : 'MEXC'}`);
  const cross = buyPl !== sellPl;
  const wRaw = cross ? s.withdrawUsdt[buyPl] : 0;
  if (cross && wRaw === null) missing.push(`costo de retiro desde ${buyPl === 'binance' ? 'Binance' : 'MEXC'}`);
  const base: Scenario = { buyPl, sellPl, ok: false, B, S, cross, W: wRaw ?? 0, missing, incomplete: missing.length > 0 };
  if (B === null || S === null) return base;
  const fb = fbRaw ?? 0;
  const fs = fsRaw ?? 0;
  // Al tomar anuncios, algunas plataformas cobran además un monto fijo por orden (1 orden de compra + 1 de venta).
  const flat = mode === 'taker' ? (s.fees[buyPl].takerFlat ?? 0) + (s.fees[sellPl].takerFlat ?? 0) : 0;
  const { q, example } = cycleQty(B, s);
  const got = q * (1 - fb) - base.W - flat;
  const arsIn = q * B;
  const arsOut = Math.max(0, got) * S * (1 - fs);
  const profit = arsOut - arsIn;
  const pct = profit / arsIn;
  const light: Light = pct > 0 && pct >= s.minMargin ? 'ok' : pct > 0 ? 'warn' : 'bad';
  return { ...base, ok: true, q, example, perUsdt: profit / q, pct, profit, light };
}

export const SCENARIOS: Array<[Platform, Platform, string]> = [
  ['binance', 'binance', 'a) Comprar y vender en Binance'],
  ['mexc', 'mexc', 'b) Comprar y vender en MEXC'],
  ['mexc', 'binance', 'c) Comprar en MEXC y vender en Binance'],
  ['binance', 'mexc', 'd) Comprar en Binance y vender en MEXC'],
];

/** Parseo de números escritos a la argentina: "1.450,50", "1450.50", "1.450" (miles). */
export function parseNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[$\s]/g, '');
  if (!s) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasComma) s = s.replace(/\./g, '').replace(',', '.');
  else if (hasDot) {
    const parts = s.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) s = parts.join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
