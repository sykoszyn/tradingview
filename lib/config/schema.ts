import { z } from 'zod';
import { DEFAULT_CONFIG, HARD_LIMITS, type AppConfig } from './defaults';

const pos = z.number().finite().positive();
const nonNeg = z.number().finite().min(0);
const int = (min: number) => z.number().int().min(min);
const phaseLimits = z.object({ maxMarginUSDT: pos, maxLeverage: pos });

export const configSchema = z.object({
  timezone: z.string().min(1),
  analysis: z.object({
    pivotStrength: int(1),
    zoneMergePct: pos,
    zonesPerSide: int(1),
    zoneLookback1h: int(50),
    zoneLookback4h: int(50),
    recencyHalfLifeCandles: pos,
    wickRatioMin: z.number().min(0).max(1),
    breakoutVolumeMult: pos,
    volumeAvgPeriod: int(2),
    emaFast: int(2),
    emaSlow: int(3),
    lateralBandPct: nonNeg,
    counterTrendMode: z.enum(['discard', 'lowerConfidence']),
  }),
  plan: z.object({
    stopBufferPct: nonNeg,
    entryMaxDriftPct: pos,
    minRR: pos,
    expiryCandles: int(1),
    tp1ClosePct: z.number().min(1).max(100),
    maxRiskMultiplier: z.number().min(1),
  }),
  sizing: z.object({ riskPerTradeUSDT: pos, defaultLeverage: pos }),
  fees: z.object({
    futuresMakerPct: nonNeg,
    futuresTakerPct: nonNeg,
    spotPct: nonNeg,
    slippagePct: nonNeg,
  }),
  limits: z.object({
    maxTradesPerDay: int(1),
    maxDailyLossUSDT: pos,
    maxWeeklyLossUSDT: pos,
  }),
  phases: z.object({
    testCapitalUSDT: pos,
    paperMinTrades: int(1),
    paperMaxDrawdownPct: pos,
    phase3MinTrades: int(1),
    phase4MinTrades: int(1),
    rollbackDrawdownPct: pos,
    rollbackWindow: int(5),
    phase2: phaseLimits,
    phase3: phaseLimits,
    phase4: phaseLimits,
  }),
  news: z.object({ windowHours: nonNeg, blockFutures: z.boolean() }),
});

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const cur = out[k];
    out[k] = cur !== null && typeof cur === 'object' && !Array.isArray(cur) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

const clampLev = (v: number) => Math.min(Math.max(v, 1), HARD_LIMITS.maxLeverage);

/**
 * Valida y normaliza una configuración (p. ej. la guardada en localStorage).
 * Los campos inválidos vuelven al default. Los topes duros se aplican SIEMPRE.
 */
export function sanitizeConfig(input: unknown): { config: AppConfig; corrections: string[] } {
  const corrections: string[] = [];
  let merged = deepMerge(DEFAULT_CONFIG, input);
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      corrections.push(`"${path}" inválido, se restauró el valor por defecto.`);
      merged = setPath(merged, issue.path as (string | number)[], getPath(DEFAULT_CONFIG, issue.path as (string | number)[]));
    }
  }
  const c: AppConfig = structuredClone(merged);

  const levFields: Array<[string, () => number, (v: number) => void]> = [
    ['sizing.defaultLeverage', () => c.sizing.defaultLeverage, (v) => (c.sizing.defaultLeverage = v)],
    ['phases.phase2.maxLeverage', () => c.phases.phase2.maxLeverage, (v) => (c.phases.phase2.maxLeverage = v)],
    ['phases.phase3.maxLeverage', () => c.phases.phase3.maxLeverage, (v) => (c.phases.phase3.maxLeverage = v)],
    ['phases.phase4.maxLeverage', () => c.phases.phase4.maxLeverage, (v) => (c.phases.phase4.maxLeverage = v)],
  ];
  for (const [name, get, set] of levFields) {
    const v = get();
    const clamped = Math.floor(clampLev(v));
    if (clamped !== v) {
      set(clamped);
      corrections.push(`${name}: ${v}x no permitido, se fijó en ${clamped}x (tope duro ${HARD_LIMITS.maxLeverage}x, entero).`);
    }
  }
  for (const p of ['phase2', 'phase3', 'phase4'] as const) {
    if (c.phases[p].maxMarginUSDT < HARD_LIMITS.minMarginUSDT) {
      corrections.push(`${p}.maxMarginUSDT menor al margen mínimo de ${HARD_LIMITS.minMarginUSDT} USDT, se ajustó.`);
      c.phases[p].maxMarginUSDT = HARD_LIMITS.minMarginUSDT;
    }
  }
  if (c.analysis.emaFast >= c.analysis.emaSlow) {
    corrections.push('La EMA rápida debe ser menor que la lenta, se restauraron 50/200.');
    c.analysis.emaFast = DEFAULT_CONFIG.analysis.emaFast;
    c.analysis.emaSlow = DEFAULT_CONFIG.analysis.emaSlow;
  }
  return { config: c, corrections };
}

/**
 * Advertencias cuando un umbral de seguridad se afloja respecto del default
 * (menos trades exigidos, más drawdown tolerado, más riesgo, etc.).
 */
export function configWarnings(c: AppConfig, d: AppConfig = DEFAULT_CONFIG): string[] {
  const w: string[] = [];
  const lower = (label: string, v: number, def: number) => {
    if (v < def) w.push(`${label} está por DEBAJO del valor recomendado (${v} < ${def}).`);
  };
  const higher = (label: string, v: number, def: number) => {
    if (v > def) w.push(`${label} está por ENCIMA del valor recomendado (${v} > ${def}).`);
  };
  lower('Trades mínimos de paper trading', c.phases.paperMinTrades, d.phases.paperMinTrades);
  lower('Trades reales para Fase 3', c.phases.phase3MinTrades, d.phases.phase3MinTrades);
  lower('Trades reales para Fase 4', c.phases.phase4MinTrades, d.phases.phase4MinTrades);
  lower('Ventana de retroceso (trades)', c.phases.rollbackWindow, d.phases.rollbackWindow);
  lower('R:R mínimo', c.plan.minRR, d.plan.minRR);
  lower('Margen del stop', c.plan.stopBufferPct, d.plan.stopBufferPct);
  lower('Ventana de noticias (horas)', c.news.windowHours, d.news.windowHours);
  lower('Comisión maker futuros', c.fees.futuresMakerPct, d.fees.futuresMakerPct);
  lower('Comisión taker futuros', c.fees.futuresTakerPct, d.fees.futuresTakerPct);
  lower('Comisión spot', c.fees.spotPct, d.fees.spotPct);
  lower('Slippage', c.fees.slippagePct, d.fees.slippagePct);
  higher('Drawdown máximo de paper trading (%)', c.phases.paperMaxDrawdownPct, d.phases.paperMaxDrawdownPct);
  higher('Drawdown de retroceso (%)', c.phases.rollbackDrawdownPct, d.phases.rollbackDrawdownPct);
  higher('Riesgo por trade (USDT)', c.sizing.riskPerTradeUSDT, d.sizing.riskPerTradeUSDT);
  higher('Multiplicador de riesgo máximo', c.plan.maxRiskMultiplier, d.plan.maxRiskMultiplier);
  higher('Trades por día', c.limits.maxTradesPerDay, d.limits.maxTradesPerDay);
  higher('Pérdida máxima diaria', c.limits.maxDailyLossUSDT, d.limits.maxDailyLossUSDT);
  higher('Pérdida máxima semanal', c.limits.maxWeeklyLossUSDT, d.limits.maxWeeklyLossUSDT);
  for (const p of ['phase2', 'phase3', 'phase4'] as const) {
    higher(`Margen máximo ${p}`, c.phases[p].maxMarginUSDT, d.phases[p].maxMarginUSDT);
    higher(`Apalancamiento máximo ${p}`, c.phases[p].maxLeverage, d.phases[p].maxLeverage);
  }
  if (!c.news.blockFutures) w.push('Las señales de futuros cerca de noticias NO se bloquean.');
  if (c.analysis.counterTrendMode === 'lowerConfidence')
    w.push('Las señales contra la tendencia de 4h se muestran (con confianza baja) en lugar de descartarse.');
  return w;
}

function getPath(obj: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function setPath<T>(obj: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return value as T;
  const clone: Record<string | number, unknown> = Array.isArray(obj) ? ([...obj] as never) : { ...(obj as object) };
  const [head, ...rest] = path;
  clone[head] = setPath(clone[head], rest, value);
  return clone as T;
}

export type { DeepPartial };
