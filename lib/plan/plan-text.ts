// Texto copiable del plan, con la checklist de ejecución en Binance (futuros).
import { SETUP_LABEL } from '../analysis/setups';
import { formatStep } from '../market/rounding';
import type { SymbolFilters } from '../types';
import type { TradePlan } from './plan';

const n = (v: number, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usdt = (v: number) => `${n(v)} USDT`;

export function executionChecklist(p: TradePlan): string[] {
  if (p.market !== 'futures') return [];
  return [
    'Modo de margen: AISLADO (Isolated), nunca Cruzado.',
    `Apalancamiento: ${p.sizing.leverage}x, configurado en ${p.symbol} antes de abrir.`,
    'Modo de posición: One-way (una sola dirección).',
    `Tipo de orden: Limit, al precio de entrada ${n(p.entry)}.`,
    `Marcar la casilla TP/SL al abrir la orden y cargar el stop (${n(p.stop)}) y el TP1 (${n(p.tp1)}).`,
    'Precio de activación del stop: Mark Price.',
    p.tp2 !== null
      ? `Después de TP1: cerrar el ${p.tp1ClosePct}% y mover el stop al precio de entrada (${n(p.entry)}).`
      : 'Después de TP1: la posición queda cerrada completa (no hay TP2).',
  ];
}

export function planToText(p: TradePlan, f?: SymbolFilters): string {
  const dir = p.direction === 'long' ? 'LONG (compra)' : 'SHORT (venta)';
  const qty = f ? formatStep(p.sizing.qty, Math.max(f.stepSize, f.marketStepSize)) : String(p.sizing.qty);
  const lines: string[] = [
    `PLAN ${p.symbol} · ${p.market === 'futures' ? 'Futuros USDT-M' : 'Spot'} · ${dir}`,
    `Setup: ${SETUP_LABEL[p.setup]} · Confianza: ${p.confidence}${p.counterTrend ? ' (contra tendencia)' : ''}`,
    `Por qué: ${p.explanation}`,
    '',
    `Entrada (LIMIT): ${n(p.entry)} · válida hasta ${n(p.entryLimit)}`,
    `Stop loss: ${n(p.stop)} (${n(p.stopDistancePct)}%)`,
    `TP1: ${n(p.tp1)} → cerrar ${p.tp1ClosePct}% · R:R neto 1:${p.rrTp1.toFixed(2)}`,
    p.tp2 !== null ? `TP2: ${n(p.tp2)} · R:R neto 1:${p.rrTp2!.toFixed(2)}` : 'TP2: — (sin segunda zona)',
    `Vence: ${new Date(p.expiresAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} (${p.expiryCandles} velas de 1h)`,
    `Invalidación: ${p.invalidation}`,
  ];
  if (p.status === 'operable') {
    lines.push(
      '',
      `Margen: ${usdt(p.sizing.margin)} · Apalancamiento: ${p.sizing.leverage}x · Nocional: ${usdt(p.sizing.notional)} · Cantidad: ${qty}`,
    );
    if (p.pnl)
      lines.push(
        `Si toca el stop: −${usdt(p.pnl.lossAtStop)} · TP1 (${p.tp1ClosePct}%): +${usdt(p.pnl.gainTp1Leg)}${p.pnl.gainTp2Total !== null ? ` · TP1+TP2: +${usdt(p.pnl.gainTp2Total)}` : ''}`,
      );
    lines.push(`Comisiones: entrada ${usdt(p.pnl?.feeEntry ?? 0)} (maker) · salida por stop ${usdt(p.pnl?.feeStopExit ?? 0)} (taker)`);
  } else {
    lines.push('', `NO OPERABLE EN TU FASE: ${p.sizing.reason ?? ''}`);
  }
  const extra = planExtraLines(p);
  if (extra.length) lines.push(...extra);
  if (p.warnings.length) lines.push('', 'Avisos:', ...p.warnings.map((w) => `- ${w}`));
  const cl = executionChecklist(p);
  if (cl.length) lines.push('', 'CHECKLIST BINANCE:', ...cl.map((c, i) => `${i + 1}. ${c}`));
  lines.push('', 'Herramienta educativa. No es asesoramiento financiero.');
  return lines.join('\n');
}

/** Líneas agregadas por extensiones (liquidación, funding). */
export function planExtraLines(p: TradePlan): string[] {
  const out: string[] = [];
  if (p.liquidation)
    out.push(
      `Liquidación aprox.: ${n(p.liquidation.price)} (a ${n(p.liquidation.distancePct)}% de la entrada; el stop está al ${n(p.liquidation.stopToLiqRatio * 100, 0)}% de esa distancia)`,
    );
  if (p.funding) out.push(...p.funding.lines);
  return out;
}
