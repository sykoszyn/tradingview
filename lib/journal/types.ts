// Modelo de datos del diario (paper trading y trades reales).
import type { Direction, Market, TradingSymbol } from '../types';
import type { SetupType } from '../analysis/setups';
import type { SimState, TradeOutcome } from '../engine/simulate';
import type { TradePlan } from '../plan/plan';
import type { RandomComparison } from '../backtest/random';

export interface TradeResult {
  outcome: TradeOutcome;
  fillTime: number;
  exitTime: number;
  netPnl: number;
  fees: number;
  funding: number;
  r: number;
}

export interface PaperTrade {
  id: string;
  kind: 'paper';
  strategyId: string;
  /** true = la creó el paper trading automático (cuenta para la validación en vivo). */
  auto: boolean;
  createdAt: number;
  plan: TradePlan;
  sim: SimState;
  /** closeTime de la última vela de 1m procesada. */
  lastProcessed: number;
  /** Resultado (solo si se ejecutó y cerró). */
  result?: TradeResult;
}

export interface RealTrade {
  id: string;
  kind: 'real';
  createdAt: number;
  planId?: string;
  strategyId?: string;
  symbol: TradingSymbol;
  market: Market;
  direction: Direction;
  setup?: SetupType;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  fees: number; // comisiones reales pagadas (USDT)
  funding: number; // positivo = pagado
  leverage?: number;
  openedAt: number;
  closedAt: number;
  notes?: string;
  /** Lo que sugería la app, para comparar con lo que hiciste. */
  planned?: { entry: number; stop: number; tp1: number; tp2: number | null; qty: number; riskUSDT: number };
  phaseAtEntry: number;
}

export interface NewsEvent {
  id: string;
  time: number; // ms UTC
  label: string;
}

export interface PhaseEvent {
  at: number;
  from: number;
  to: number;
  reason: string;
}

export interface PhaseState {
  /** Fase real confirmada (0–4). */
  phase: number;
  history: PhaseEvent[];
}

export interface LiveValidationCache {
  computedAt: number;
  strategyId: string;
  trades: number;
  expectancyR: number;
  comparison: RandomComparison;
}

export interface JournalData {
  version: 1;
  paper: PaperTrade[];
  real: RealTrade[];
  news: NewsEvent[];
  phase: PhaseState;
  autoPaper: { enabled: boolean; since: number; cursor: Record<string, number> };
  liveValidation?: LiveValidationCache;
  notifiedLiveValidation?: number;
}

export const emptyJournal = (now = Date.now()): JournalData => ({
  version: 1,
  paper: [],
  real: [],
  news: [],
  phase: { phase: 0, history: [] },
  autoPaper: { enabled: true, since: now, cursor: {} },
});
