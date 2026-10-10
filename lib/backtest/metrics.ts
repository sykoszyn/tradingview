// Métricas de resultados (backtest, paper trading y trades reales).
export interface TradeLike {
  netPnl: number;
  r: number;
  exitTime: number;
  outcome?: string;
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0–1
  avgWin: number;
  avgLoss: number; // positivo
  /** R:R promedio realizado: ganancia promedio / pérdida promedio. */
  avgRR: number;
  expectancy: number; // USDT por trade
  total: number;
  maxDrawdown: number; // USDT, desde el pico
  expectancyR: number;
  totalR: number;
  maxDrawdownR: number;
  liquidations: number;
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number; // + ganadoras seguidas, − perdedoras
  equity: Array<{ time: number; value: number; valueR: number }>;
}

function drawdown(values: number[]): number {
  let peak = 0;
  let dd = 0;
  let cum = 0;
  for (const v of values) {
    cum += v;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
}

export function computeStats(trades: TradeLike[]): Stats {
  const t = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  const wins = t.filter((x) => x.netPnl > 0);
  const losses = t.filter((x) => x.netPnl <= 0);
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const avgWin = wins.length ? sum(wins.map((x) => x.netPnl)) / wins.length : 0;
  const avgLoss = losses.length ? -sum(losses.map((x) => x.netPnl)) / losses.length : 0;
  let cum = 0;
  let cumR = 0;
  const equity = t.map((x) => ({ time: x.exitTime, value: (cum += x.netPnl), valueR: (cumR += x.r) }));
  let maxW = 0;
  let maxL = 0;
  let cur = 0;
  for (const x of t) {
    if (x.netPnl > 0) cur = cur > 0 ? cur + 1 : 1;
    else cur = cur < 0 ? cur - 1 : -1;
    maxW = Math.max(maxW, cur);
    maxL = Math.max(maxL, -cur);
  }
  const n = t.length;
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : 0,
    avgWin,
    avgLoss,
    avgRR: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
    expectancy: n ? sum(t.map((x) => x.netPnl)) / n : 0,
    total: sum(t.map((x) => x.netPnl)),
    maxDrawdown: drawdown(t.map((x) => x.netPnl)),
    expectancyR: n ? sum(t.map((x) => x.r)) / n : 0,
    totalR: sum(t.map((x) => x.r)),
    maxDrawdownR: drawdown(t.map((x) => x.r)),
    liquidations: t.filter((x) => x.outcome === 'liquidation').length,
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    currentStreak: cur,
    equity,
  };
}

/** Agrupa y calcula métricas por clave. */
export function groupStats<T extends TradeLike>(trades: T[], key: (t: T) => string): Map<string, Stats> {
  const groups = new Map<string, T[]>();
  for (const t of trades) {
    const k = key(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return new Map([...groups.entries()].map(([k, v]) => [k, computeStats(v)]));
}
