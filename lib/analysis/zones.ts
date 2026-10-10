// Zonas de soporte/resistencia a partir de pivots de 1h y 4h.
import type { Pivot } from './pivots';

export interface Zone {
  id: string;
  low: number;
  high: number;
  mid: number;
  touches: number;
  touches4h: number;
  lastTouch: number; // ms
  firstTouch: number;
  score: number;
  pivots: Pivot[];
}

export interface ZoneOptions {
  mergePct: number; // fracción (0.003 = 0,3 %)
  now: number;
  halfLifeMs: number; // vida media del peso por recencia
  weight4h?: number; // un toque en 4h pesa más que uno en 1h
}

/**
 * Agrupa pivots cuyo precio está dentro de `mergePct` del precio mínimo del
 * grupo (así el ancho de una zona nunca supera ~0,3 %), y puntúa cada zona:
 *   puntaje = Σ recencia × factor_volumen × peso_timeframe
 *   recencia = 0,5 ^ (antigüedad / vida_media)
 *   factor_volumen = 0,5 + 0,5 × min(volumen_toque / promedio, 3)
 */
export function buildZones(pivots: Pivot[], o: ZoneOptions): Zone[] {
  const sorted = [...pivots].filter((p) => p.confirmedAt <= o.now).sort((a, b) => a.price - b.price);
  const w4 = o.weight4h ?? 2;
  const groups: Pivot[][] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && (p.price - g[0].price) / g[0].price <= o.mergePct) g.push(p);
    else groups.push([p]);
  }
  return groups.map((g) => {
    const prices = g.map((p) => p.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    let score = 0;
    for (const p of g) {
      const age = Math.max(0, o.now - p.time);
      const recency = Math.pow(0.5, age / o.halfLifeMs);
      const vol = 0.5 + 0.5 * Math.min(p.volumeRatio, 3);
      score += recency * vol * (p.timeframe === '4h' ? w4 : 1);
    }
    const times = g.map((p) => p.time);
    return {
      id: `z${low.toFixed(2)}-${high.toFixed(2)}`,
      low,
      high,
      mid: (low + high) / 2,
      touches: g.length,
      touches4h: g.filter((p) => p.timeframe === '4h').length,
      lastTouch: Math.max(...times),
      firstTouch: Math.min(...times),
      score,
      pivots: g,
    };
  });
}

export interface ZoneSelection {
  above: Zone[]; // ordenadas de la más cercana a la más lejana
  below: Zone[];
}

/**
 * Las `n` zonas más fuertes por encima y por debajo del precio. Una zona que
 * contiene al precio se asigna según su punto medio.
 */
export function selectZones(zones: Zone[], price: number, n: number): ZoneSelection {
  const above = zones.filter((z) => z.low > price || (z.high >= price && z.mid > price));
  const below = zones.filter((z) => !above.includes(z));
  const top = (arr: Zone[]) => [...arr].sort((a, b) => b.score - a.score).slice(0, n);
  return {
    above: top(above).sort((a, b) => a.mid - b.mid),
    below: top(below).sort((a, b) => b.mid - a.mid),
  };
}

/** Fuerza relativa de una zona (0–1) frente al resto, para la confianza. */
export function zoneStrength(zone: Zone, all: Zone[]): number {
  const max = Math.max(...all.map((z) => z.score), 1e-9);
  return Math.min(1, zone.score / max);
}
