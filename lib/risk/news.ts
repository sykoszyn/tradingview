// Filtro de noticias: datos económicos de EE.UU. cargados a mano.
import type { AppConfig } from '../config/defaults';
import type { Market } from '../types';
import type { NewsEvent } from '../journal/types';

export function nearestNews(time: number, events: NewsEvent[], windowHours: number): NewsEvent | null {
  const w = windowHours * 3_600_000;
  let best: NewsEvent | null = null;
  for (const e of events) {
    const d = Math.abs(e.time - time);
    if (d <= w && (!best || d < Math.abs(best.time - time))) best = e;
  }
  return best;
}

export interface NewsVerdict {
  highRisk: boolean;
  blocked: boolean;
  event: NewsEvent | null;
  message?: string;
}

/**
 * Una señal dentro de ±N h de un dato es "riesgo alto". En futuros se bloquea
 * por defecto (configurable). Se mira el momento de la señal y el momento actual
 * (la entrada puede ejecutarse más tarde, hasta el vencimiento).
 */
export function newsVerdict(times: number[], market: Market, events: NewsEvent[], cfg: AppConfig): NewsVerdict {
  const hits = times.map((t) => nearestNews(t, events, cfg.news.windowHours)).filter((e): e is NewsEvent => !!e);
  if (!hits.length) return { highRisk: false, blocked: false, event: null };
  const event = hits[0];
  const blocked = market === 'futures' && cfg.news.blockFutures;
  const when = new Date(event.time).toLocaleString('es-AR', { timeZone: cfg.timezone, dateStyle: 'short', timeStyle: 'short' });
  return {
    highRisk: true,
    blocked,
    event,
    message: `Riesgo alto: dato "${event.label}" el ${when} (±${cfg.news.windowHours} h).${blocked ? ' Bloqueada en futuros.' : ''}`,
  };
}

export const upcomingNews = (events: NewsEvent[], now: number) => events.filter((e) => e.time >= now - 3_600_000).sort((a, b) => a.time - b.time);
