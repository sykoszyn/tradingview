// Línea base de entradas AL AZAR para comparar una variante.
// Usa las mismas distancias de stop y objetivos que los trades de la variante
// (muestreadas de sus trades reales), la misma frecuencia aproximada, la misma
// temporalidad, vencimiento, comisiones, slippage y funding. La dirección es al
// azar (en spot solo long). Si una variante no le gana claramente, no tiene ventaja.
import type { AppConfig } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Candle } from '../types';
import { prepareSeries, signalSeries } from '../analysis/context';
import { lastClosedIndex } from '../analysis/trend';
import { feeRates } from '../plan/fees';
import { historicalFunding } from '../plan/funding';
import { accountTrade, qtyOpenAt, simulatePlan, type IntrabarProvider } from '../engine/simulate';
import type { BacktestDataset, BacktestOptions, BtTrade } from './run';
import { computeStats } from './metrics';

/** PRNG determinístico (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intrabar(ds: BacktestDataset): IntrabarProvider {
  const idx = new Map<number, number>();
  ds.c15m.forEach((c, i) => idx.set(c.openTime, i));
  return {
    get(level, from, to) {
      if (level === 2) return ds.m1?.[from]?.length ? ds.m1[from] : null;
      const start = idx.get(from);
      if (start === undefined) return null;
      const out: Candle[] = [];
      for (let i = start; i < ds.c15m.length && ds.c15m[i].openTime <= to; i++) out.push(ds.c15m[i]);
      return out.length ? out : null;
    },
  };
}

export function runRandomBaseline(datasets: BacktestDataset[], variantTrades: BtTrade[], o: BacktestOptions, seed: number): BtTrade[] {
  const rand = rng(seed);
  const cfg: AppConfig = o.cfg;
  const tfMs = cfg.analysis.signalTimeframe === '4h' ? 4 * 3_600_000 : 3_600_000;
  const out: BtTrade[] = [];
  for (const ds of datasets) {
    const mine = variantTrades.filter((t) => t.track === 'r' && t.symbol === ds.symbol && t.market === ds.market);
    if (!mine.length) continue;
    const candles = signalSeries(prepareSeries(ds.c1h, ds.c4h, cfg), cfg).candles;
    const first = candles.findIndex((c) => c.closeTime >= o.from);
    let last = candles.length - 1;
    while (last > 0 && candles[last].closeTime > o.to) last--;
    if (first < 0 || last <= first) continue;
    const avgHold = mine.reduce((s, t) => s + (t.exitTime - t.signalTime), 0) / mine.length / tfMs;
    const free = Math.max(mine.length, last - first + 1 - mine.length * avgHold);
    const gap = free / mine.length;
    const rates = feeRates(ds.market, cfg);
    const slip = pct(cfg.fees.slippagePct);
    const ib = intrabar(ds);
    const priceAt = (t: number) => {
      const k = lastClosedIndex(ds.c1h, t);
      return k >= 0 ? ds.c1h[k].close : ds.c1h[0].open;
    };
    let i = first + Math.floor(rand() * gap);
    while (i <= last) {
      const c = candles[i];
      const tmpl = mine[Math.floor(rand() * mine.length)];
      const direction = ds.market === 'spot' ? 'long' : rand() < 0.5 ? 'long' : 'short';
      const sgn = direction === 'long' ? 1 : -1;
      const entry = c.close;
      const stopPct = Math.abs(tmpl.entry - tmpl.stop) / tmpl.entry;
      const tp1Pct = Math.abs(tmpl.tp1 - tmpl.entry) / tmpl.entry;
      const tp2Pct = tmpl.tp2 !== null ? Math.abs(tmpl.tp2 - tmpl.entry) / tmpl.entry : null;
      const stop = entry * (1 - sgn * stopPct);
      const perUnit = Math.abs(entry - stop) + entry * rates.maker + stop * rates.taker;
      const qty = 1 / perUnit; // 1 R = 1 USDT
      const sim = simulatePlan(
        {
          direction,
          entry,
          entryLimit: entry * (1 + sgn * pct(cfg.plan.entryMaxDriftPct)),
          stop,
          tp1: entry * (1 + sgn * tp1Pct),
          tp2: tp2Pct !== null ? entry * (1 + sgn * tp2Pct) : null,
          tp1ClosePct: tp2Pct !== null ? cfg.plan.tp1ClosePct : 100,
          qty,
          expiresAt: c.closeTime + cfg.plan.expiryCandles * tfMs,
          slippage: slip,
          maxHoldMs: o.maxHoldHours * 3_600_000,
        },
        candles,
        i + 1,
        ib,
      );
      const st = sim.state;
      let next = i + 1;
      if (st.phase === 'closed') {
        const exitIdx = Math.max(i + 1, lastClosedIndex(candles, st.exitTime));
        next = exitIdx + 1;
        if (st.outcome !== 'expired' && st.outcome !== 'invalidated') {
          const fill = st.fillTime!;
          const fund =
            ds.market === 'futures' ? historicalFunding(direction, ds.funding, fill, st.exitTime, (t) => qtyOpenAt(qty, fill, st.legs, t) * priceAt(t)).total : 0;
          const acc = accountTrade(direction, entry, qty, st.legs, rates.maker, rates.taker, fund);
          const risk = qty * perUnit;
          out.push({
            ...tmpl,
            direction,
            signalTime: c.closeTime,
            fillTime: fill,
            exitTime: st.exitTime,
            outcome: st.outcome,
            entry,
            stop,
            qty,
            fees: acc.fees,
            funding: fund,
            netPnl: acc.netPnl,
            riskUSDT: risk,
            r: acc.netPnl / risk,
          });
        }
      } else break;
      i = next + Math.floor(rand() * 2 * gap);
    }
  }
  return out;
}

export interface RandomComparison {
  runs: number;
  meanExpectancyR: number;
  p5ExpectancyR: number;
  p95ExpectancyR: number;
  meanTrades: number;
  /** Proporción de corridas al azar con expectativa ≥ la de la variante. */
  pValue: number;
}

export function compareWithRandom(datasets: BacktestDataset[], variantTrades: BtTrade[], o: BacktestOptions, variantExpR: number, runs = 100): RandomComparison {
  const exps: number[] = [];
  const counts: number[] = [];
  for (let k = 0; k < runs; k++) {
    const t = runRandomBaseline(datasets, variantTrades, o, 1000 + k);
    const s = computeStats(t);
    exps.push(s.expectancyR);
    counts.push(s.trades);
  }
  const sorted = [...exps].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    runs,
    meanExpectancyR: exps.reduce((s, v) => s + v, 0) / runs,
    p5ExpectancyR: q(0.05),
    p95ExpectancyR: q(0.95),
    meanTrades: counts.reduce((s, v) => s + v, 0) / runs,
    pValue: exps.filter((e) => e >= variantExpR).length / runs,
  };
}
