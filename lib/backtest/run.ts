// Backtest sin look-ahead: en cada vela de 1h cerrada se arma el contexto solo
// con datos disponibles en ese momento, se evalúan los setups con las MISMAS
// funciones que en vivo y se simula el plan con velas futuras (15m/1m para
// resolver velas ambiguas). Dos "carriles":
//  - usdt: tamaño real de la Fase 2 (mínimos del par, margen, apalancamiento).
//  - r: el mismo plan sin límites de tamaño, para medir el sistema en múltiplos de R.
import type { AppConfig, PhaseLimits } from '../config/defaults';
import { pct } from '../config/defaults';
import type { BracketSet, Candle, Direction, FundingRatePoint, Market, SymbolFilters, TradingSymbol } from '../types';
import { prepareSeries } from '../analysis/context';
import type { Confidence, SetupType } from '../analysis/setups';
import { lastClosedIndex } from '../analysis/trend';
import type { DiscardCode, TradePlan } from '../plan/plan';
import { historicalFunding } from '../plan/funding';
import { planSignal, signalsAt } from '../engine/evaluate';
import { accountTrade, qtyOpenAt, simulatePlan, type IntrabarProvider, type TradeOutcome } from '../engine/simulate';

export type Track = 'usdt' | 'r';

export interface BacktestDataset {
  symbol: TradingSymbol;
  market: Market;
  c1h: Candle[];
  c4h: Candle[];
  c15m: Candle[];
  /** Velas de 1m por ventana de 15m (clave = openTime de la vela de 15m). */
  m1?: Record<number, Candle[]>;
  funding: FundingRatePoint[];
  filters: SymbolFilters;
  brackets?: BracketSet;
}

export interface BacktestOptions {
  from: number;
  to: number;
  cfg: AppConfig;
  phase: PhaseLimits; // carril usdt (Fase 2 por defecto)
  maxHoldHours: number;
}

export interface BtTrade {
  track: Track;
  symbol: TradingSymbol;
  market: Market;
  direction: Direction;
  setup: SetupType;
  confidence: Confidence;
  signalTime: number;
  fillTime: number;
  exitTime: number;
  outcome: TradeOutcome;
  entry: number;
  stop: number;
  tp1: number;
  tp2: number | null;
  qty: number;
  leverage: number;
  margin: number;
  fees: number;
  funding: number;
  netPnl: number;
  riskUSDT: number;
  r: number;
  plannedRR: number;
}

export interface BtDiscard {
  track: Track;
  symbol: TradingSymbol;
  market: Market;
  setup: SetupType;
  direction: Direction;
  code: DiscardCode | 'minimos';
  time: number;
}

export interface BtNotFilled {
  track: Track;
  symbol: TradingSymbol;
  market: Market;
  setup: SetupType;
  direction: Direction;
  outcome: 'expired' | 'invalidated';
}

export interface BacktestResult {
  trades: BtTrade[];
  discards: BtDiscard[];
  notFilled: BtNotFilled[];
  unresolved: Array<{ symbol: TradingSymbol; market: Market; from: number; to: number }>;
  assumedWorst: number;
  signalsEvaluated: number;
}

function intrabarFor(ds: BacktestDataset): IntrabarProvider {
  const idx15 = new Map<number, number>();
  ds.c15m.forEach((c, i) => idx15.set(c.openTime, i));
  return {
    get(level, from, to) {
      if (level === 1) {
        const start = idx15.get(from);
        if (start === undefined) return null;
        const out: Candle[] = [];
        for (let i = start; i < ds.c15m.length && ds.c15m[i].openTime <= to; i++) out.push(ds.c15m[i]);
        return out.length ? out : null;
      }
      const m = ds.m1?.[from];
      return m && m.length ? m : null;
    },
  };
}

const unbounded = (f: SymbolFilters): SymbolFilters => ({ ...f, minQty: 0, marketMinQty: 0, minNotional: 0, stepSize: 1e-8, marketStepSize: 1e-8 });

export function runBacktest(datasets: BacktestDataset[], o: BacktestOptions, onProgress?: (p: number) => void): BacktestResult {
  const res: BacktestResult = { trades: [], discards: [], notFilled: [], unresolved: [], assumedWorst: 0, signalsEvaluated: 0 };
  const rCfg: AppConfig = { ...o.cfg, plan: { ...o.cfg.plan, maxRiskMultiplier: 1e9 } };
  const rPhase: PhaseLimits = { maxMarginUSDT: 1e12, maxLeverage: o.cfg.sizing.defaultLeverage };
  const total = datasets.reduce((s, d) => s + d.c1h.length, 0);
  let done = 0;

  for (const ds of datasets) {
    const prepared = prepareSeries(ds.c1h, ds.c4h, o.cfg);
    const intrabar = intrabarFor(ds);
    const priceAt = (t: number) => {
      const k = lastClosedIndex(ds.c1h, t);
      return k >= 0 ? ds.c1h[k].close : ds.c1h[0].open;
    };
    const busyUntil: Record<Track, number> = { usdt: -1, r: -1 };
    const first = Math.max(2, ds.c1h.findIndex((c) => c.closeTime >= o.from));
    for (let i = first; i < ds.c1h.length; i++) {
      const c = ds.c1h[i];
      done++;
      if (onProgress && done % 500 === 0) onProgress(done / total);
      if (c.closeTime > o.to) break;
      if (c.closeTime <= busyUntil.usdt && c.closeTime <= busyUntil.r) continue;
      const { context, signals } = signalsAt(prepared, i, ds.market, o.cfg);
      if (!signals.length) continue;
      res.signalsEvaluated += signals.length;

      for (const track of ['usdt', 'r'] as const) {
        if (c.closeTime <= busyUntil[track]) continue;
        const candidates: TradePlan[] = [];
        for (const s of signals) {
          const r =
            track === 'usdt'
              ? planSignal(s, context, { symbol: ds.symbol, market: ds.market, filters: ds.filters, cfg: o.cfg, phase: o.phase, brackets: ds.brackets })
              : planSignal(s, context, { symbol: ds.symbol, market: ds.market, filters: unbounded(ds.filters), cfg: rCfg, phase: rPhase, brackets: ds.brackets });
          if (r.kind === 'discarded') {
            res.discards.push({ track, symbol: ds.symbol, market: ds.market, setup: s.setup, direction: s.direction, code: r.code, time: c.closeTime });
          } else if (r.plan.status === 'no-operable-fase') {
            res.discards.push({ track, symbol: ds.symbol, market: ds.market, setup: s.setup, direction: s.direction, code: 'minimos', time: c.closeTime });
          } else candidates.push(r.plan);
        }
        if (!candidates.length) continue;
        const plan = candidates.sort((a, b) => confScore(b) - confScore(a))[0];
        const sim = simulatePlan(
          {
            direction: plan.direction,
            entry: plan.entry,
            entryLimit: plan.entryLimit,
            stop: plan.stop,
            tp1: plan.tp1,
            tp2: plan.tp2,
            tp1ClosePct: plan.tp1ClosePct,
            qty: plan.sizing.qty,
            expiresAt: plan.expiresAt,
            liquidationPrice: plan.liquidation?.price,
            slippage: pct(o.cfg.fees.slippagePct),
            maxHoldMs: o.maxHoldHours * 3_600_000,
          },
          ds.c1h,
          i + 1,
          intrabar,
        );
        res.assumedWorst += sim.ctx.assumedWorst;
        for (const u of sim.ctx.unresolved) res.unresolved.push({ symbol: ds.symbol, market: ds.market, ...u });
        const st = sim.state;
        if (st.phase !== 'closed') {
          busyUntil[track] = Infinity; // trade abierto al final de los datos
          continue;
        }
        busyUntil[track] = st.exitTime;
        if (st.outcome === 'expired' || st.outcome === 'invalidated') {
          res.notFilled.push({ track, symbol: ds.symbol, market: ds.market, setup: plan.setup, direction: plan.direction, outcome: st.outcome });
          continue;
        }
        const fillTime = st.fillTime!;
        const fund =
          ds.market === 'futures'
            ? historicalFunding(plan.direction, ds.funding, fillTime, st.exitTime, (t) => qtyOpenAt(plan.sizing.qty, fillTime, st.legs, t) * priceAt(t)).total
            : 0;
        const acc = accountTrade(plan.direction, plan.entry, plan.sizing.qty, st.legs, plan.feeRates.maker, plan.feeRates.taker, fund);
        const risk = plan.sizing.realRiskUSDT;
        res.trades.push({
          track,
          symbol: ds.symbol,
          market: ds.market,
          direction: plan.direction,
          setup: plan.setup,
          confidence: plan.confidence,
          signalTime: plan.signalTime,
          fillTime,
          exitTime: st.exitTime,
          outcome: st.outcome,
          entry: plan.entry,
          stop: plan.stop,
          tp1: plan.tp1,
          tp2: plan.tp2,
          qty: plan.sizing.qty,
          leverage: plan.sizing.leverage,
          margin: plan.sizing.margin,
          fees: acc.fees,
          funding: fund,
          netPnl: acc.netPnl,
          riskUSDT: risk,
          r: risk > 0 ? acc.netPnl / risk : 0,
          plannedRR: plan.rrTp1,
        });
      }
    }
  }
  res.trades.sort((a, b) => a.exitTime - b.exitTime);
  onProgress?.(1);
  return res;
}

const confScore = (p: TradePlan) => ({ alta: 3, media: 2, baja: 1 })[p.confidence] * 10 + p.rrTp1;
