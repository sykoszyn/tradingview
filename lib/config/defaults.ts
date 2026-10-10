// Todos los parámetros de la app en un solo lugar.
import { applyPatch, DEFAULT_STRATEGY_ID } from '../strategies/patches';
// Convención: los campos que terminan en `Pct` están en PORCENTAJE (0.15 = 0,15 %).
// Las funciones de /lib reciben fracciones; la conversión se hace con `pct()`.

/** Topes que NINGUNA configuración puede superar. */
export const HARD_LIMITS = {
  maxLeverage: 3,
  marginMode: 'isolated' as const,
  minMarginUSDT: 10,
  spotLeverage: 1,
} as const;

/**
 * discard: descarta señales contra la tendencia de 4h (en lateral se permiten).
 * lowerConfidence: las muestra con confianza baja.
 * withTrendOnly: solo a favor de la tendencia (descarta en contra Y en lateral).
 */
export type CounterTrendMode = 'discard' | 'lowerConfidence' | 'withTrendOnly';
export type SignalTimeframe = '1h' | '4h';
export type StopMode = 'percent' | 'atr';

export interface PhaseLimits {
  maxMarginUSDT: number;
  maxLeverage: number;
}

export interface AppConfig {
  /** Estrategia activa (ver lib/strategies). Define los campos de su "patch". */
  strategyId: string;
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
    signalTimeframe: SignalTimeframe; // velas donde se evalúan los setups
    minZoneTouches: number; // toques mínimos de la zona de la señal
  };
  plan: {
    stopMode: StopMode; // 'percent': margen fijo · 'atr': k × ATR detrás de la zona/mecha
    stopBufferPct: number;
    atrPeriod: number;
    atrMultiplier: number;
    minStopPct: number; // distancia mínima entrada–stop (evita stops dentro del ruido)
    entryMaxDriftPct: number; // si el precio se aleja más que esto de la entrada, se invalida
    minRR: number; // R:R mínimo en TP1 después de comisiones
    expiryCandles: number; // velas (de la temporalidad de señal) para que se ejecute la entrada
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

/** Parámetros técnicos base (reglas originales en 1h). Los tests usan esta base. */
export const BASE_CONFIG: AppConfig = {
  strategyId: 'zonas-1h',
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
    signalTimeframe: '1h',
    minZoneTouches: 1,
  },
  plan: {
    stopMode: 'percent',
    stopBufferPct: 0.15,
    atrPeriod: 14,
    atrMultiplier: 1,
    minStopPct: 0.3,
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
    phase2: { maxMarginUSDT: 15, maxLeverage: 2 },
    phase3: { maxMarginUSDT: 25, maxLeverage: 2 },
    phase4: { maxMarginUSDT: 50, maxLeverage: 3 },
  },
  news: {
    windowHours: 2,
    blockFutures: true,
  },
};

/** Configuración por defecto de la app: estrategia "zonas-4h" (variante c). */
export const DEFAULT_CONFIG: AppConfig = applyPatch(BASE_CONFIG, DEFAULT_STRATEGY_ID);

export const pct = (v: number) => v / 100;
