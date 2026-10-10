// Simulación de un plan vela a vela. La usan el backtest y el paper trading.
//
// Ciclo: pendiente (orden limitada) → abierta (stop original, objetivo TP1) →
// tras TP1 se cierra una parte y el stop pasa a la entrada (objetivo TP2) → cerrada.
//
// Cuando una vela toca dos niveles y el orden importa (p. ej. stop y TP1), se
// mira la temporalidad menor (1h → 15m → 1m). Si aun así no se puede saber,
// se asume lo peor: el stop.
import type { Candle, Direction } from '../types';

export type TradeOutcome =
  | 'stop'
  | 'tp1' // cerró 100 % en TP1 (plan sin TP2)
  | 'tp1-be' // TP1 y el resto salió en la entrada
  | 'tp2'
  | 'liquidation'
  | 'expired'
  | 'invalidated'
  | 'timeout'
  | 'open';

export type LegKind = 'tp1' | 'tp2' | 'stop' | 'be' | 'liquidation' | 'timeout';

export interface Leg {
  kind: LegKind;
  qty: number;
  price: number; // precio de ejecución (con slippage)
  time: number;
}

export interface SimPlan {
  direction: Direction;
  entry: number;
  entryLimit: number;
  stop: number;
  tp1: number;
  tp2: number | null;
  tp1ClosePct: number;
  qty: number;
  expiresAt: number;
  liquidationPrice?: number;
  slippage: number; // fracción aplicada a salidas a mercado
  maxHoldMs: number;
}

export type SimState =
  | { phase: 'pending' }
  | { phase: 'open'; stage: 1 | 2; fillTime: number; qtyOpen: number; legs: Leg[] }
  | { phase: 'closed'; outcome: TradeOutcome; fillTime: number | null; exitTime: number; legs: Leg[]; note?: string };

/** Fuente de velas de temporalidad menor: nivel 1 = 15m, nivel 2 = 1m. */
export interface IntrabarProvider {
  get(level: 1 | 2, from: number, to: number): Candle[] | null;
}

export interface SimContext {
  plan: SimPlan;
  intrabar?: IntrabarProvider;
  /** Ventanas que no se pudieron resolver por falta de velas de 1m (para pedirlas y re-simular). */
  unresolved: Array<{ from: number; to: number }>;
  /** Cantidad de velas ambiguas resueltas de forma conservadora. */
  assumedWorst: number;
}

const adverse = (d: Direction, c: Candle, lvl: number) => (d === 'long' ? c.low <= lvl : c.high >= lvl);
const favorable = (d: Direction, c: Candle, lvl: number) => (d === 'long' ? c.high >= lvl : c.low <= lvl);
const exitPx = (d: Direction, price: number, slip: number) => (d === 'long' ? price * (1 - slip) : price * (1 + slip));

function close(state: Extract<SimState, { phase: 'open' }>, outcome: TradeOutcome, time: number, extra?: Leg): SimState {
  const legs = extra ? [...state.legs, extra] : state.legs;
  return { phase: 'closed', outcome, fillTime: state.fillTime, exitTime: time, legs };
}

/** ¿La vela es ambigua para el estado actual? (dos eventos posibles cuyo orden cambia el resultado) */
function isAmbiguous(s: SimState, p: SimPlan, c: Candle): boolean {
  const d = p.direction;
  if (s.phase === 'pending') {
    if (!adverse(d, c, p.entry)) return false;
    return favorable(d, c, p.entryLimit) || favorable(d, c, p.tp1);
  }
  if (s.phase === 'open' && s.stage === 1) {
    const st = adverse(d, c, p.stop);
    const tp = favorable(d, c, p.tp1);
    if (st && tp) return true;
    // TP1 y además volvió a la entrada: ¿antes (no pasa nada) o después del TP1 (sale el resto)?
    return tp && p.tp2 !== null && adverse(d, c, p.entry);
  }
  if (s.phase === 'open' && s.stage === 2) return adverse(d, c, p.entry) && p.tp2 !== null && favorable(d, c, p.tp2);
  return false;
}

/** Aplica una vela sin ambigüedad (o resolviendo lo ambiguo de forma conservadora). */
function applyCandle(s: SimState, ctx: SimContext, c: Candle, conservative: boolean): SimState {
  const p = ctx.plan;
  const d = p.direction;
  const slip = p.slippage;
  if (conservative) ctx.assumedWorst++;

  if (s.phase === 'pending') {
    if (c.openTime >= p.expiresAt) return { phase: 'closed', outcome: 'expired', fillTime: null, exitTime: p.expiresAt, legs: [] };
    const fill = adverse(d, c, p.entry);
    const run = favorable(d, c, p.entryLimit);
    if (!fill) return run ? { phase: 'closed', outcome: 'invalidated', fillTime: null, exitTime: c.closeTime, legs: [] } : s;
    const hitStop = adverse(d, c, p.stop);
    if (conservative && run && !hitStop) return { phase: 'closed', outcome: 'invalidated', fillTime: null, exitTime: c.closeTime, legs: [] };
    const open: Extract<SimState, { phase: 'open' }> = { phase: 'open', stage: 1, fillTime: c.openTime, qtyOpen: p.qty, legs: [] };
    if (hitStop) return close(open, 'stop', c.closeTime, { kind: 'stop', qty: p.qty, price: exitPx(d, p.stop, slip), time: c.closeTime });
    return open; // en la vela de la entrada no se cuenta el TP (pudo ocurrir antes de llenar)
  }

  if (s.phase !== 'open') return s;
  if (c.openTime - s.fillTime >= p.maxHoldMs)
    return close(s, 'timeout', c.openTime, { kind: 'timeout', qty: s.qtyOpen, price: exitPx(d, c.open, slip), time: c.openTime });

  if (s.stage === 1) {
    if (p.liquidationPrice !== undefined && adverse(d, c, p.liquidationPrice) && !adverse(d, c, p.stop))
      return close(s, 'liquidation', c.closeTime, { kind: 'liquidation', qty: s.qtyOpen, price: p.liquidationPrice, time: c.closeTime });
    const hitStop = adverse(d, c, p.stop);
    const hitTp = favorable(d, c, p.tp1);
    if (hitStop) return close(s, 'stop', c.closeTime, { kind: 'stop', qty: s.qtyOpen, price: exitPx(d, p.stop, slip), time: c.closeTime });
    if (!hitTp) return s;
    if (p.tp2 === null)
      return close(s, 'tp1', c.closeTime, { kind: 'tp1', qty: s.qtyOpen, price: exitPx(d, p.tp1, slip), time: c.closeTime });
    const q1 = p.qty * (p.tp1ClosePct / 100);
    const leg: Leg = { kind: 'tp1', qty: q1, price: exitPx(d, p.tp1, slip), time: c.closeTime };
    const s2: Extract<SimState, { phase: 'open' }> = { ...s, stage: 2, qtyOpen: s.qtyOpen - q1, legs: [...s.legs, leg] };
    // Misma vela: ¿también tocó la entrada (stop movido) o el TP2? TP2 solo es seguro si no volvió a la entrada.
    if (adverse(d, c, p.entry)) return close(s2, 'tp1-be', c.closeTime, { kind: 'be', qty: s2.qtyOpen, price: exitPx(d, p.entry, slip), time: c.closeTime });
    if (favorable(d, c, p.tp2)) return close(s2, 'tp2', c.closeTime, { kind: 'tp2', qty: s2.qtyOpen, price: exitPx(d, p.tp2, slip), time: c.closeTime });
    return s2;
  }

  // stage 2: stop en la entrada, objetivo TP2
  if (adverse(d, c, p.entry)) return close(s, 'tp1-be', c.closeTime, { kind: 'be', qty: s.qtyOpen, price: exitPx(d, p.entry, slip), time: c.closeTime });
  if (p.tp2 !== null && favorable(d, c, p.tp2))
    return close(s, 'tp2', c.closeTime, { kind: 'tp2', qty: s.qtyOpen, price: exitPx(d, p.tp2, slip), time: c.closeTime });
  return s;
}

/** Avanza una vela, bajando a temporalidades menores si es ambigua. */
export function advance(s: SimState, ctx: SimContext, c: Candle, level: 0 | 1 | 2 = 0): SimState {
  if (s.phase === 'closed') return s;
  if (!isAmbiguous(s, ctx.plan, c)) return applyCandle(s, ctx, c, false);
  if (level < 2 && ctx.intrabar) {
    const next = (level + 1) as 1 | 2;
    const sub = ctx.intrabar.get(next, c.openTime, c.closeTime);
    if (sub && sub.length) {
      let st: SimState = s;
      for (const sc of sub) {
        st = advance(st, ctx, sc, next);
        if (st.phase === 'closed') break;
      }
      return st;
    }
    if (next === 2) ctx.unresolved.push({ from: c.openTime, to: c.closeTime });
  }
  return applyCandle(s, ctx, c, true);
}

/**
 * Simula desde la vela `startIndex` (la primera DESPUÉS de la señal) hasta que
 * el trade termine o se acaben los datos.
 */
export function simulatePlan(
  plan: SimPlan,
  candles: Candle[],
  startIndex: number,
  intrabar?: IntrabarProvider,
): { state: SimState; ctx: SimContext; endIndex: number } {
  const ctx: SimContext = { plan, intrabar, unresolved: [], assumedWorst: 0 };
  let s: SimState = { phase: 'pending' };
  let i = startIndex;
  for (; i < candles.length; i++) {
    s = advance(s, ctx, candles[i], 0);
    if (s.phase === 'closed') break;
  }
  return { state: s, ctx, endIndex: Math.min(i, candles.length - 1) };
}

export interface TradeAccounting {
  grossPnl: number;
  fees: number;
  funding: number; // positivo = pagado
  netPnl: number;
  avgExit: number;
}

/**
 * Resultado en USDT de un trade cerrado. Comisiones sobre el nocional:
 * entrada maker, salidas taker. El funding se calcula afuera (depende del historial).
 */
export function accountTrade(direction: Direction, entry: number, qty: number, legs: Leg[], maker: number, taker: number, funding = 0): TradeAccounting {
  const sign = direction === 'long' ? 1 : -1;
  let gross = 0;
  let fees = qty * entry * maker;
  let qOut = 0;
  let pxq = 0;
  for (const l of legs) {
    gross += sign * (l.price - entry) * l.qty;
    fees += l.qty * l.price * taker;
    qOut += l.qty;
    pxq += l.price * l.qty;
  }
  return { grossPnl: gross, fees, funding, netPnl: gross - fees - funding, avgExit: qOut > 0 ? pxq / qOut : NaN };
}

/** Cantidad abierta en el instante t (para el funding). */
export function qtyOpenAt(qty: number, fillTime: number, legs: Leg[], t: number): number {
  if (t <= fillTime) return 0;
  let q = qty;
  for (const l of legs) if (l.time < t) q -= l.qty;
  return Math.max(0, q);
}
