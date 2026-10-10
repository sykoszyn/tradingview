// Convierte una señal en un plan de entrada completo (o la descarta con un motivo).
// Es la MISMA función para vivo, backtest y paper trading.
import type { AppConfig, PhaseLimits } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Direction, Market, SymbolFilters, TradingSymbol } from '../types';
import { checkOrderMinimums } from '../market/filters';
import { roundPrice, roundStopOutward } from '../market/rounding';
import type { Zone } from '../analysis/zones';
import type { Confidence, SetupSignal, SetupType } from '../analysis/setups';
import { fee, feeRates, grossPnl, netRiskReward, type FeeRates } from './fees';
import { sizePosition, type SizingResult } from './sizing';
import type { LiquidationInfo } from './liquidation';
import type { FundingEstimate } from './funding';

const HOUR = 3_600_000;

export type PlanStatus = 'operable' | 'no-operable-fase';
export type DiscardCode = 'sin-objetivo' | 'rr-insuficiente' | 'riesgo-excesivo' | 'liquidacion' | 'stop-invalido';

export interface PlanPnl {
  feeEntry: number;
  feeStopExit: number;
  /** Pérdida total si toca el stop (incluye comisiones). Positiva = pérdida. */
  lossAtStop: number;
  /** Ganancia neta de la parte cerrada en TP1 (tp1ClosePct). */
  gainTp1Leg: number;
  /** Ganancia neta si se cerrara el 100 % en TP1. */
  gainTp1Full: number;
  /** Ganancia neta total si cierra la 1.ª parte en TP1 y el resto en TP2. */
  gainTp2Total: number | null;
  /** Resultado si cierra la 1.ª parte en TP1 y el resto sale por el stop movido a la entrada. */
  gainTp1ThenBreakeven: number;
}

export interface TradePlan {
  id: string;
  symbol: TradingSymbol;
  market: Market;
  direction: Direction;
  setup: SetupType;
  confidence: Confidence;
  counterTrend: boolean;
  explanation: string;
  reasons: string[];
  signalTime: number;
  zone: { low: number; high: number };
  entry: number;
  /** Zona de entrada válida: entre `entry` y `entryLimit`. Si el precio pasa `entryLimit` antes de llenar → invalidada. */
  entryLimit: number;
  stop: number;
  stopDistancePct: number;
  tp1: number;
  tp2: number | null;
  tp1ClosePct: number;
  rrTp1: number; // neto de comisiones
  rrTp2: number | null;
  expiresAt: number;
  expiryCandles: number;
  invalidation: string;
  status: PlanStatus;
  sizing: SizingResult;
  pnl: PlanPnl | null;
  minimums: { qtyOk: boolean; notionalOk: boolean; onStep: boolean; ok: boolean };
  feeRates: FeeRates;
  warnings: string[];
  /** Solo futuros (lo agrega liquidationExtension). */
  liquidation?: LiquidationInfo;
  /** Solo futuros (lo agrega fundingExtension). */
  funding?: FundingEstimate;
}

export type PlanResult =
  | { kind: 'plan'; plan: TradePlan }
  | { kind: 'discarded'; code: DiscardCode; reason: string; signal: SetupSignal };

export interface PlanInput {
  signal: SetupSignal;
  symbol: TradingSymbol;
  market: Market;
  zones: Zone[];
  filters: SymbolFilters;
  cfg: AppConfig;
  phase: PhaseLimits;
  /** Ganchos opcionales (liquidación, funding) que agregan datos y reglas. */
  extensions?: PlanExtension[];
}

export interface PlanExtension {
  /** Regla por apalancamiento para el dimensionamiento (null = pasa). */
  leverageCheck?: (ctx: { direction: Direction; entry: number; stop: number }) => (a: { leverage: number; qty: number; notional: number; margin: number }) => string | null;
  /** Completa el plan ya armado (p. ej. precio de liquidación, funding). */
  enrich?: (plan: TradePlan) => void;
}

const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

/**
 * Objetivos conservadores: el borde cercano de las zonas MÁS CERCANAS en la
 * dirección del trade (TP1 = la primera, TP2 = la siguiente), sin importar si
 * son las más fuertes. Se ignora la zona de la señal y lo que esté a < 0,1 %.
 */
export function findTargets(direction: Direction, entry: number, zones: Zone[], exclude: Zone): Zone[] {
  const minGap = entry * 0.001;
  const rest = zones.filter((z) => z.id !== exclude.id);
  return direction === 'long'
    ? rest.filter((z) => z.low > entry + minGap).sort((a, b) => a.low - b.low)
    : rest.filter((z) => z.high < entry - minGap).sort((a, b) => b.high - a.high);
}

export function buildPlan(inp: PlanInput): PlanResult {
  const { signal: s, filters: f, cfg, market } = inp;
  const dir = s.direction;
  const tick = f.tickSize;
  const rates = feeRates(market, cfg);
  const sign = dir === 'long' ? 1 : -1;

  const entry = roundPrice(s.entry, tick, dir === 'long' ? 'floor' : 'ceil');
  // Stop técnico detrás de la zona/mecha: margen fijo (%) o k × ATR; y al menos a minStopPct
  // de la entrada. Con señales en 4h los porcentajes se escalan ×2 (la volatilidad crece con √tiempo).
  const tfScale = cfg.analysis.signalTimeframe === '4h' ? 2 : 1;
  const warnings: string[] = [];
  let stopRaw =
    cfg.plan.stopMode === 'atr' && s.atr && Number.isFinite(s.atr)
      ? s.stopAnchor - sign * cfg.plan.atrMultiplier * s.atr
      : s.stopAnchor * (1 - sign * pct(cfg.plan.stopBufferPct) * tfScale);
  if (cfg.plan.stopMode === 'atr' && !(s.atr && Number.isFinite(s.atr))) warnings.push('Sin ATR disponible: se usó el margen fijo para el stop.');
  const minStopPct = cfg.plan.minStopPct * tfScale;
  const minStop = entry * (1 - sign * pct(minStopPct));
  if (dir === 'long' ? stopRaw > minStop : stopRaw < minStop) {
    stopRaw = minStop;
    warnings.push(`Stop alejado a la distancia mínima de ${minStopPct}% para que no quede dentro del ruido.`);
  }
  const stop = roundStopOutward(stopRaw, tick, dir);
  if (dir === 'long' ? stop >= entry : stop <= entry)
    return { kind: 'discarded', code: 'stop-invalido', reason: 'El stop quedó del lado equivocado de la entrada.', signal: s };

  const targets = findTargets(dir, entry, inp.zones, s.zone);
  if (!targets.length) return { kind: 'discarded', code: 'sin-objetivo', reason: 'No hay una zona objetivo en la dirección del trade.', signal: s };
  const tp1 = roundPrice(dir === 'long' ? targets[0].low : targets[0].high, tick, dir === 'long' ? 'floor' : 'ceil');
  const tp2 = targets[1] ? roundPrice(dir === 'long' ? targets[1].low : targets[1].high, tick, dir === 'long' ? 'floor' : 'ceil') : null;

  const rrTp1 = netRiskReward(dir, entry, stop, tp1, rates);
  const rrTp2 = tp2 !== null ? netRiskReward(dir, entry, stop, tp2, rates) : null;
  if (rrTp1 < cfg.plan.minRR)
    return {
      kind: 'discarded',
      code: 'rr-insuficiente',
      reason: `R:R neto en TP1 de 1:${rrTp1.toFixed(2)}, menor al mínimo 1:${cfg.plan.minRR}.`,
      signal: s,
    };

  const checks = (inp.extensions ?? []).map((e) => e.leverageCheck?.({ direction: dir, entry, stop })).filter(Boolean) as Array<
    (a: { leverage: number; qty: number; notional: number; margin: number }) => string | null
  >;
  const sizing = sizePosition({
    direction: dir,
    market,
    entry,
    stop,
    filters: f,
    riskUSDT: cfg.sizing.riskPerTradeUSDT,
    maxRiskMultiplier: cfg.plan.maxRiskMultiplier,
    defaultLeverage: cfg.sizing.defaultLeverage,
    phase: inp.phase,
    fees: rates,
    leverageCheck: checks.length ? (a) => checks.map((c) => c(a)).find((r) => r) ?? null : undefined,
  });
  if (sizing.status === 'riesgo-excesivo') return { kind: 'discarded', code: 'riesgo-excesivo', reason: sizing.reason ?? 'Riesgo excesivo', signal: s };
  if (sizing.status === 'liquidacion') return { kind: 'discarded', code: 'liquidacion', reason: sizing.reason ?? 'Stop demasiado cerca de la liquidación', signal: s };

  const status: PlanStatus = sizing.status === 'ok' ? 'operable' : 'no-operable-fase';
  const pnl = status === 'operable' ? computePnl(dir, sizing.qty, entry, stop, tp1, tp2, cfg.plan.tp1ClosePct, rates) : null;
  const drift = pct(cfg.plan.entryMaxDriftPct);
  const entryLimit = roundPrice(entry * (1 + sign * drift), tick);
  const tfMs = cfg.analysis.signalTimeframe === '4h' ? 4 * HOUR : HOUR;
  const expiresAt = s.signalTime + cfg.plan.expiryCandles * tfMs;

  const plan: TradePlan = {
    id: `${inp.symbol}-${market}-${s.id}`,
    symbol: inp.symbol,
    market,
    direction: dir,
    setup: s.setup,
    confidence: s.confidence,
    counterTrend: s.counterTrend,
    explanation: s.explanation,
    reasons: s.reasons,
    signalTime: s.signalTime,
    zone: { low: s.zone.low, high: s.zone.high },
    entry,
    entryLimit,
    stop,
    stopDistancePct: (Math.abs(entry - stop) / entry) * 100,
    tp1,
    tp2,
    tp1ClosePct: tp2 !== null ? cfg.plan.tp1ClosePct : 100,
    rrTp1,
    rrTp2,
    expiresAt,
    expiryCandles: cfg.plan.expiryCandles,
    invalidation:
      dir === 'long'
        ? `Cancelar si antes de llenarse el precio toca el stop (${fmt(stop)}), sube por encima de ${fmt(entryLimit)} (+${cfg.plan.entryMaxDriftPct}%) o pasan ${cfg.plan.expiryCandles} velas de ${cfg.analysis.signalTimeframe}.`
        : `Cancelar si antes de llenarse el precio toca el stop (${fmt(stop)}), baja por debajo de ${fmt(entryLimit)} (−${cfg.plan.entryMaxDriftPct}%) o pasan ${cfg.plan.expiryCandles} velas de ${cfg.analysis.signalTimeframe}.`,
    status,
    sizing,
    pnl,
    minimums: status === 'operable' ? checkOrderMinimums(f, sizing.qty, entry) : { qtyOk: false, notionalOk: false, onStep: false, ok: false },
    feeRates: rates,
    warnings: [...warnings, ...sizing.adjustments],
  };
  if (tp2 === null) plan.warnings.push('No hay una segunda zona objetivo: el plan cierra el 100 % en TP1.');
  for (const e of inp.extensions ?? []) e.enrich?.(plan);
  return { kind: 'plan', plan };
}

export function computePnl(
  dir: Direction,
  qty: number,
  entry: number,
  stop: number,
  tp1: number,
  tp2: number | null,
  tp1ClosePct: number,
  r: FeeRates,
): PlanPnl {
  const part = tp2 !== null ? tp1ClosePct / 100 : 1;
  const q1 = qty * part;
  const q2 = qty - q1;
  const feeEntry = fee(qty, entry, r.maker);
  const feeStopExit = fee(qty, stop, r.taker);
  const leg1 = grossPnl(dir, q1, entry, tp1) - fee(q1, tp1, r.taker) - feeEntry * part;
  const full = grossPnl(dir, qty, entry, tp1) - fee(qty, tp1, r.taker) - feeEntry;
  const leg2 = tp2 !== null ? grossPnl(dir, q2, entry, tp2) - fee(q2, tp2, r.taker) - feeEntry * (1 - part) : null;
  const be = -fee(q2, entry, r.taker) - feeEntry * (1 - part);
  return {
    feeEntry,
    feeStopExit,
    lossAtStop: -(grossPnl(dir, qty, entry, stop) - feeEntry - feeStopExit),
    gainTp1Leg: leg1,
    gainTp1Full: full,
    gainTp2Total: leg2 !== null ? leg1 + leg2 : null,
    gainTp1ThenBreakeven: leg1 + (tp2 !== null ? be : 0),
  };
}
