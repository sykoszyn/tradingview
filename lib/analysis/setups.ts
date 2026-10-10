// Detección de setups sobre la ÚLTIMA vela de 1h CERRADA (índice i).
// Solo se miran velas ≤ i y zonas construidas con pivots confirmados antes del cierre de i.
import type { AppConfig } from '../config/defaults';
import { pct } from '../config/defaults';
import type { Candle, Direction, Market } from '../types';
import { priorVolumeAverage } from './indicators';
import type { TrendContext } from './trend';
import { selectZones, zoneStrength, type Zone } from './zones';

export const SETUP_TYPES = [
  'rebote-soporte',
  'recuperacion-zona',
  'ruptura-resistencia',
  'rechazo-resistencia',
  'perdida-soporte',
  'ruptura-soporte',
] as const;
export type SetupType = (typeof SETUP_TYPES)[number];

export const SETUP_LABEL: Record<SetupType, string> = {
  'rebote-soporte': 'Rebote en soporte',
  'recuperacion-zona': 'Recuperación de zona perdida',
  'ruptura-resistencia': 'Ruptura de resistencia con volumen',
  'rechazo-resistencia': 'Rechazo en resistencia',
  'perdida-soporte': 'Pérdida de soporte',
  'ruptura-soporte': 'Ruptura de soporte con volumen',
};

export const SETUP_DIRECTION: Record<SetupType, Direction> = {
  'rebote-soporte': 'long',
  'recuperacion-zona': 'long',
  'ruptura-resistencia': 'long',
  'rechazo-resistencia': 'short',
  'perdida-soporte': 'short',
  'ruptura-soporte': 'short',
};

export type Confidence = 'alta' | 'media' | 'baja';

export interface SetupSignal {
  id: string;
  setup: SetupType;
  direction: Direction;
  candleIndex: number;
  signalTime: number; // closeTime de la vela que dispara
  zone: Zone;
  /** Precio de referencia para el stop técnico (antes del margen): mecha o borde de la zona. */
  stopAnchor: number;
  /** Entrada limitada sugerida (retesteo del borde de la zona). */
  entry: number;
  volumeRatio: number;
  counterTrend: boolean;
  confidence: Confidence;
  confidenceScore: number;
  reasons: string[];
  explanation: string;
  /** ATR de la temporalidad de señal al cierre de la vela (para stops por ATR). */
  atr?: number;
}

export interface SetupInput {
  candles: Candle[]; // velas de 1h (solo cerradas hasta i)
  i: number;
  zones: Zone[];
  trend: TrendContext | null;
  market: Market;
  cfg: AppConfig;
  atr?: number;
}

const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const touchesText = (n: number, verb: string) => `${verb} ${n} ${n === 1 ? 'vez' : 'veces'} antes`;

/** Zonas fuertes cerca del precio: unión de las seleccionadas respecto de los últimos cierres. */
function candidateZones(zones: Zone[], c: Candle[], i: number, n: number): Zone[] {
  const set = new Set<Zone>();
  for (const k of [i - 2, i - 1, i]) {
    if (k < 0) continue;
    const s = selectZones(zones, c[k].close, n);
    s.above.forEach((z) => set.add(z));
    s.below.forEach((z) => set.add(z));
  }
  return [...set];
}

export function detectSetups(input: SetupInput): SetupSignal[] {
  const { candles: c, i, zones, trend, market, cfg } = input;
  const a = cfg.analysis;
  if (i < 2 || i >= c.length) return [];
  const cur = c[i];
  const prev = c[i - 1];
  const prev2 = c[i - 2];
  const range = cur.high - cur.low;
  const avgVol = priorVolumeAverage(c, i, a.volumeAvgPeriod);
  const volRatio = Number.isFinite(avgVol) && avgVol > 0 ? cur.volume / avgVol : 1;
  const lowerWick = Math.min(cur.open, cur.close) - cur.low;
  const upperWick = cur.high - Math.max(cur.open, cur.close);
  const sweepTol = pct(a.zoneMergePct); // cuánto puede perforar la mecha sin "romper" la zona
  const out: Omit<SetupSignal, 'confidence' | 'confidenceScore' | 'counterTrend' | 'id'>[] = [];

  for (const z of candidateZones(zones, c, i, a.zonesPerSide)) {
    if (z.touches < a.minZoneTouches) continue;
    // ---- LONG ----
    // Rebote en soporte: la mecha entra en la zona, cierra arriba de su mitad, mecha inferior ≥ 50 % del rango.
    if (
      range > 0 &&
      prev.close > z.high &&
      cur.low <= z.high &&
      cur.low >= z.low * (1 - sweepTol) &&
      cur.close > z.mid &&
      lowerWick / range >= a.wickRatioMin
    ) {
      out.push({
        setup: 'rebote-soporte', direction: 'long', candleIndex: i, signalTime: cur.closeTime, zone: z,
        stopAnchor: Math.min(cur.low, z.low), entry: Math.min(z.high, cur.close), volumeRatio: volRatio,
        reasons: [`Mecha inferior del ${Math.round((lowerWick / range) * 100)}% del rango`, `Soporte ${fmt(z.low)}–${fmt(z.high)} con ${z.touches} toques`],
        explanation: `El precio bajó hasta el soporte ${fmt(z.low)}–${fmt(z.high)} (${touchesText(z.touches, 'tocado')}) y los compradores lo rechazaron: la vela dejó una mecha inferior larga y cerró arriba, en ${fmt(cur.close)}.`,
      });
    }
    // Recuperación: hace 2 velas cerraba debajo, la vela anterior cerró arriba y la actual no volvió a cerrar debajo.
    if (prev2.close < z.low && prev.close > z.high && cur.close >= z.low) {
      out.push({
        setup: 'recuperacion-zona', direction: 'long', candleIndex: i, signalTime: cur.closeTime, zone: z,
        stopAnchor: Math.min(z.low, cur.low), entry: Math.min(z.high, cur.close), volumeRatio: volRatio,
        reasons: ['Cierre de nuevo arriba de la zona', 'La vela siguiente sostuvo el nivel'],
        explanation: `El precio había perdido la zona ${fmt(z.low)}–${fmt(z.high)}, volvió a cerrar arriba y la vela siguiente no cerró de nuevo por debajo: el nivel se recuperó y ahora puede funcionar como soporte.`,
      });
    }
    // Ruptura de resistencia con volumen > 1,5× el promedio de 20 velas.
    if (prev.close <= z.high && cur.close > z.high && volRatio > a.breakoutVolumeMult) {
      out.push({
        setup: 'ruptura-resistencia', direction: 'long', candleIndex: i, signalTime: cur.closeTime, zone: z,
        stopAnchor: z.low, entry: Math.min(z.high, cur.close), volumeRatio: volRatio,
        reasons: [`Volumen ${volRatio.toFixed(1)}× el promedio`, `Cierre sobre la resistencia ${fmt(z.high)}`],
        explanation: `La vela cerró arriba de la resistencia ${fmt(z.low)}–${fmt(z.high)} con un volumen ${volRatio.toFixed(1)} veces mayor al promedio. La idea es comprar en el retesteo del nivel roto.`,
      });
    }

    if (market === 'spot') continue; // en spot solo LONG

    // ---- SHORT ----
    if (
      range > 0 &&
      prev.close < z.low &&
      cur.high >= z.low &&
      cur.high <= z.high * (1 + sweepTol) &&
      cur.close < z.mid &&
      upperWick / range >= a.wickRatioMin
    ) {
      out.push({
        setup: 'rechazo-resistencia', direction: 'short', candleIndex: i, signalTime: cur.closeTime, zone: z,
        stopAnchor: Math.max(cur.high, z.high), entry: Math.max(z.low, cur.close), volumeRatio: volRatio,
        reasons: [`Mecha superior del ${Math.round((upperWick / range) * 100)}% del rango`, `Resistencia ${fmt(z.low)}–${fmt(z.high)} con ${z.touches} toques`],
        explanation: `El precio subió hasta la resistencia ${fmt(z.low)}–${fmt(z.high)} (${touchesText(z.touches, 'tocada')}) y los vendedores lo rechazaron: la vela dejó una mecha superior larga y cerró abajo, en ${fmt(cur.close)}.`,
      });
    }
    if (prev2.close > z.high && prev.close < z.low && cur.close <= z.high) {
      out.push({
        setup: 'perdida-soporte', direction: 'short', candleIndex: i, signalTime: cur.closeTime, zone: z,
        stopAnchor: Math.max(z.high, cur.high), entry: Math.max(z.low, cur.close), volumeRatio: volRatio,
        reasons: ['Cierre debajo del soporte', 'La vela siguiente no lo recuperó'],
        explanation: `El precio cerró por debajo del soporte ${fmt(z.low)}–${fmt(z.high)} y la vela siguiente no lo recuperó: el soporte se perdió y ahora puede actuar como resistencia.`,
      });
    }
    if (prev.close >= z.low && cur.close < z.low && volRatio > a.breakoutVolumeMult) {
      out.push({
        setup: 'ruptura-soporte', direction: 'short', candleIndex: i, signalTime: cur.closeTime, zone: z,
        stopAnchor: z.high, entry: Math.max(z.low, cur.close), volumeRatio: volRatio,
        reasons: [`Volumen ${volRatio.toFixed(1)}× el promedio`, `Cierre bajo el soporte ${fmt(z.low)}`],
        explanation: `La vela cerró debajo del soporte ${fmt(z.low)}–${fmt(z.high)} con un volumen ${volRatio.toFixed(1)} veces mayor al promedio. La idea es vender en el retesteo del nivel roto.`,
      });
    }
  }

  const scored: SetupSignal[] = [];
  for (const s of out) {
    const counterTrend =
      (s.direction === 'long' && trend?.trend === 'bajista') || (s.direction === 'short' && trend?.trend === 'alcista');
    if (counterTrend && (a.counterTrendMode === 'discard' || a.counterTrendMode === 'withTrendOnly')) continue;
    if (a.counterTrendMode === 'withTrendOnly') {
      const aligned = (s.direction === 'long' && trend?.trend === 'alcista') || (s.direction === 'short' && trend?.trend === 'bajista');
      if (!aligned) continue;
    }
    const { score, confidence } = scoreConfidence(s, zones, trend, counterTrend);
    scored.push({
      ...s,
      id: `${s.setup}-${s.signalTime}-${s.zone.id}`,
      atr: input.atr,
      counterTrend,
      confidence,
      confidenceScore: score,
      reasons: counterTrend ? [...s.reasons, 'Va CONTRA la tendencia de 4h'] : s.reasons,
    });
  }
  // Una sola señal por dirección y vela: la de mayor puntaje.
  const best = new Map<Direction, SetupSignal>();
  for (const s of scored) {
    const b = best.get(s.direction);
    if (!b || s.confidenceScore > b.confidenceScore) best.set(s.direction, s);
  }
  return [...best.values()];
}

/**
 * Confianza según fuerza de la zona, tendencia y volumen:
 * zona (0–3) + tendencia (0–2) + volumen (0–2) + VWAP (0–1). Alta ≥ 6, media ≥ 4.
 * Una señal contra la tendencia nunca supera "baja".
 */
export function scoreConfidence(
  s: Pick<SetupSignal, 'zone' | 'direction' | 'volumeRatio'>,
  zones: Zone[],
  trend: TrendContext | null,
  counterTrend: boolean,
): { score: number; confidence: Confidence } {
  let score = 0;
  const strength = zoneStrength(s.zone, zones);
  score += strength >= 0.6 ? 2 : strength >= 0.3 ? 1 : 0;
  if (s.zone.touches >= 3) score += 1;
  if (!counterTrend) score += trend?.trend === 'lateral' || !trend ? 1 : 2;
  score += s.volumeRatio >= 1.5 ? 2 : s.volumeRatio >= 1 ? 1 : 0;
  if (trend && ((s.direction === 'long' && trend.aboveVwap) || (s.direction === 'short' && !trend.aboveVwap))) score += 1;
  const confidence: Confidence = counterTrend ? 'baja' : score >= 6 ? 'alta' : score >= 4 ? 'media' : 'baja';
  return { score, confidence };
}
