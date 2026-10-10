// Límites de riesgo: trades por día, pérdida diaria y semanal (zona horaria del usuario).
import type { AppConfig } from '../config/defaults';

export interface LimitTrade {
  openedAt: number;
  closedAt?: number;
  netPnl?: number;
}

/** 'YYYY-MM-DD' en la zona horaria dada. */
export function dayKey(t: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** Lunes de la semana (lunes a domingo) en la zona horaria dada, como 'YYYY-MM-DD'. */
export function weekKey(t: number, tz: string): string {
  const [y, m, d] = dayKey(t, tz).split('-').map(Number);
  const local = new Date(Date.UTC(y, m - 1, d));
  const dow = (local.getUTCDay() + 6) % 7; // 0 = lunes
  local.setUTCDate(local.getUTCDate() - dow);
  return local.toISOString().slice(0, 10);
}

export interface LimitStatus {
  tradesToday: number;
  pnlToday: number;
  pnlWeek: number;
  blocked: boolean;
  reasons: string[];
}

export function riskLimitStatus(trades: LimitTrade[], now: number, cfg: AppConfig): LimitStatus {
  const tz = cfg.timezone;
  const today = dayKey(now, tz);
  const week = weekKey(now, tz);
  const tradesToday = trades.filter((t) => dayKey(t.openedAt, tz) === today).length;
  const closed = trades.filter((t) => t.closedAt !== undefined && t.netPnl !== undefined);
  const pnlToday = closed.filter((t) => dayKey(t.closedAt!, tz) === today).reduce((s, t) => s + t.netPnl!, 0);
  const pnlWeek = closed.filter((t) => weekKey(t.closedAt!, tz) === week).reduce((s, t) => s + t.netPnl!, 0);
  const reasons: string[] = [];
  const L = cfg.limits;
  if (tradesToday >= L.maxTradesPerDay) reasons.push(`Ya hiciste ${tradesToday} trades hoy (máximo ${L.maxTradesPerDay}). Volvé mañana.`);
  if (-pnlToday >= L.maxDailyLossUSDT) reasons.push(`Pérdida de hoy ${(-pnlToday).toFixed(2)} USDT (máximo ${L.maxDailyLossUSDT}). Volvé mañana.`);
  if (-pnlWeek >= L.maxWeeklyLossUSDT) reasons.push(`Pérdida de la semana ${(-pnlWeek).toFixed(2)} USDT (máximo ${L.maxWeeklyLossUSDT}). Volvé el lunes.`);
  return { tradesToday, pnlToday, pnlWeek, blocked: reasons.length > 0, reasons };
}
