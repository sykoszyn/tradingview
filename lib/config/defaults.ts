// Todos los parámetros de la app en un solo lugar.
// Convención: los campos que terminan en `Pct` están en PORCENTAJE (0.15 = 0,15 %).
// Las funciones de /lib reciben fracciones; la conversión se hace con `pct()`.

/** Topes que NINGUNA configuración puede superar. */
export const HARD_LIMITS = {
  maxLeverage: 3,
  marginMode: 'isolated' as const,
  minMarginUSDT: 10,
  spotLeverage: 1,
} as const;

export type CounterTrendMode = 'discard' | 'lowerConfidence';

export interface PhaseLimits {
  maxMarginUSDT: number;
  maxLeverage: number;
}

export interface AppConfig {
  timezone: string;
  analysis: {
    pivotStrength: number; // velas a cada lado para confirmar un pivot
    zoneMergePct: number; // agrupar pivots dentro de este % del precio
    zonesPerSide: number;
    zoneLookback1h: number; // velas de 1h usadas para zonas
    zoneLookback4h: number;
    recencyHalfLifeCandles: number; // vida media (en velas de 1h) del peso por recencia
    wickRatioMin: number; // mecha mínima respecto del rango (0.5 = 50 %)
    breakoutVolumeMult: number;
    volumeAvgPeriod: number;
    emaFast: number;
    emaSlow: number;
    lateralBandPct: number; // si EMA50 y EMA200 están a menos de este % → lateral
    counterTrendMode: CounterTrendMode;
  };
  plan: {
    stopBufferPct: number;
    entryMaxDriftPct: number; // si el precio se aleja más que esto de la entrada, se invalida
    minRR: number; // R:R mínimo en TP1 después de comisiones
    expiryCandles: number; // velas de 1h para que se ejecute la entrada
    tp1ClosePct: number;
    maxRiskMultiplier: number; // descartar si riesgo real > riesgo configurado × esto
  };
  sizing: {
    riskPerTradeUSDT: number;
    defaultLeverage: number;
  };
  fees: {
    futuresMakerPct: number;
    futuresTakerPct: number;
    spotPct: number;
    slippagePct: number; // usado en backtest y simulación
  };
  limits: {
    maxTradesPerDay: number;
    maxDailyLossUSDT: number;
    maxWeeklyLossUSDT: number;
  };
  phases: {
    testCapitalUSDT: number;
    paperMinTrades: number;
    paperMaxDrawdownPct: number;
    phase3MinTrades: number;
    phase4MinTrades: number;
    rollbackDrawdownPct: number;
    rollbackWindow: number;
    phase2: PhaseLimits;
    phase3: PhaseLimits;
    phase4: PhaseLimits;
  };
  news: {
    windowHours: number;
    blockFutures: boolean;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  timezone: 'America/Argentina/Buenos_Aires',
  analysis: {
    pivotStrength: 3,
    zoneMergePct: 0.3,
    zonesPerSide: 3,
    zoneLookback1h: 500,
    zoneLookback4h: 300,
    recencyHalfLifeCandles: 200,
    wickRatioMin: 0.5,
    breakoutVolumeMult: 1.5,
    volumeAvgPeriod: 20,
    emaFast: 50,
    emaSlow: 200,
    lateralBandPct: 0.5,
    counterTrendMode: 'discard',
  },
  plan: {
    stopBufferPct: 0.15,
    entryMaxDriftPct: 0.6,
    minRR: 1.5,
    expiryCandles: 4,
    tp1ClosePct: 50,
    maxRiskMultiplier: 2,
  },
  sizing: {
    riskPerTradeUSDT: 1,
    defaultLeverage: 2,
  },
  fees: {
    futuresMakerPct: 0.02,
    futuresTakerPct: 0.05,
    spotPct: 0.1,
    slippagePct: 0.05,
  },
  limits: {
    maxTradesPerDay: 3,
    maxDailyLossUSDT: 3,
    maxWeeklyLossUSDT: 8,
  },
  phases: {
    testCapitalUSDT: 100,
    paperMinTrades: 30,
    paperMaxDrawdownPct: 10,
    phase3MinTrades: 30,
    phase4MinTrades: 30,
    rollbackDrawdownPct: 15,
    rollbackWindow: 20,
    phase2: { maxMarginUSDT: 10, maxLeverage: 2 },
    phase3: { maxMarginUSDT: 25, maxLeverage: 2 },
    phase4: { maxMarginUSDT: 50, maxLeverage: 3 },
  },
  news: {
    windowHours: 2,
    blockFutures: true,
  },
};

export const pct = (v: number) => v / 100;
