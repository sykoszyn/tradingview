// Filtros automáticos sobre los anuncios leídos, y mejor precio REAL de cada lado.
import type { Ad, Side } from './types';
import { methodMatches } from './methods';

export interface FilterSettings {
  merchantOnly: boolean;
  minFinishRatePct: number; // ej. 95
  minOrders: number; // órdenes completadas (30 días)
  myMethods: string[]; // ids de PAY_METHODS; vacío = no filtra
  amountArs: number | null; // monto que quiero operar por orden; null = no filtra
  outlierPct: number; // descartar precios a más de este % de la mediana
}

export type DropReason = 'exclusivo' | 'comerciante' | 'finalizacion' | 'ordenes' | 'metodo' | 'monto' | 'atipico';

export interface FilteredSide {
  kept: Ad[]; // ordenados del mejor al peor
  dropped: Array<{ ad: Ad; reason: DropReason }>;
  best: number | null;
  median: number | null;
  total: number;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function filterSide(ads: Ad[], side: Side, f: FilterSettings): FilteredSide {
  const dropped: FilteredSide['dropped'] = [];
  const med = median(ads.filter((a) => !a.restricted).map((a) => a.price));
  const kept = ads.filter((a) => {
    let reason: DropReason | null = null;
    if (a.restricted) reason = 'exclusivo';
    else if (med !== null && Math.abs(a.price - med) / med > f.outlierPct / 100) reason = 'atipico';
    else if (f.merchantOnly && !a.merchant) reason = 'comerciante';
    else if (a.finishRate === null || a.finishRate * 100 < f.minFinishRatePct) reason = 'finalizacion';
    else if (a.orders === null || a.orders < f.minOrders) reason = 'ordenes';
    else if (f.myMethods.length && !a.methodKeys.some((k) => methodMatches(k, f.myMethods))) reason = 'metodo';
    else if (f.amountArs !== null && ((a.min !== null && a.min > f.amountArs) || (a.max !== null && a.max < f.amountArs))) reason = 'monto';
    if (reason) dropped.push({ ad: a, reason });
    return !reason;
  });
  // vendedores: el más barato primero; compradores: el que más paga primero
  kept.sort((a, b) => (side === 'sellers' ? a.price - b.price : b.price - a.price));
  return { kept, dropped, best: kept[0]?.price ?? null, median: med, total: ads.length };
}

export const DROP_LABEL: Record<DropReason, string> = {
  exclusivo: 'exclusivo para usuarios nuevos',
  comerciante: 'no es comerciante verificado',
  finalizacion: 'finalización baja',
  ordenes: 'pocas órdenes',
  metodo: 'sin tus métodos de pago',
  monto: 'el límite no cubre tu monto',
  atipico: 'precio atípico',
};
