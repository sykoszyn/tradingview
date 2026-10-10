// Precio en vivo por WebSocket público (sin keys).
// Spot: data-stream.binance.vision · Futuros: fstream.binance.com (último + mark price)
// Si Binance no conecta, se pasa al WebSocket público de Bybit.
import type { Market, TradingSymbol } from '../types';

export interface LiveTick {
  price: number; // último precio operado
  markPrice?: number; // solo futuros
  fundingRate?: number;
  nextFundingTime?: number;
  time: number;
  source: 'binance-ws' | 'bybit-ws';
}

export interface LiveHandle {
  close: () => void;
}

export function subscribeLivePrice(
  symbol: TradingSymbol,
  market: Market,
  onTick: (t: LiveTick) => void,
  onStatus?: (s: string) => void,
): LiveHandle {
  let closed = false;
  let ws: WebSocket | null = null;
  let failures = 0;
  let useBybit = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const last: Partial<LiveTick> = {};

  const emit = (patch: Partial<LiveTick>, source: LiveTick['source']) => {
    Object.assign(last, patch);
    if (last.price) onTick({ ...(last as LiveTick), time: Date.now(), source });
  };

  const connectBinance = () => {
    const s = symbol.toLowerCase();
    const url =
      market === 'spot'
        ? `wss://data-stream.binance.vision/stream?streams=${s}@miniTicker`
        : `wss://fstream.binance.com/stream?streams=${s}@miniTicker/${s}@markPrice@1s`;
    ws = new WebSocket(url);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { stream: string; data: Record<string, string | number> };
        const d = msg.data;
        if (msg.stream.endsWith('@miniTicker')) emit({ price: parseFloat(String(d.c)) }, 'binance-ws');
        else
          emit(
            { markPrice: parseFloat(String(d.p)), fundingRate: parseFloat(String(d.r)), nextFundingTime: Number(d.T) },
            'binance-ws',
          );
        failures = 0;
      } catch {}
    };
  };

  const connectBybit = () => {
    const url = market === 'spot' ? 'wss://stream.bybit.com/v5/public/spot' : 'wss://stream.bybit.com/v5/public/linear';
    ws = new WebSocket(url);
    ws.onopen = () => ws?.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${symbol}`] }));
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { topic?: string; data?: Record<string, string> };
        if (!msg.topic?.startsWith('tickers') || !msg.data) return;
        const d = msg.data;
        const patch: Partial<LiveTick> = {};
        if (d.lastPrice) patch.price = parseFloat(d.lastPrice);
        if (d.markPrice) patch.markPrice = parseFloat(d.markPrice);
        if (d.fundingRate) patch.fundingRate = parseFloat(d.fundingRate);
        if (d.nextFundingTime) patch.nextFundingTime = Number(d.nextFundingTime);
        emit(patch, 'bybit-ws');
        failures = 0;
      } catch {}
    };
  };

  const connect = () => {
    if (closed) return;
    try {
      if (useBybit) connectBybit();
      else connectBinance();
    } catch {
      scheduleRetry();
      return;
    }
    onStatus?.(useBybit ? 'Conectando a Bybit…' : 'Conectando a Binance…');
    if (!ws) return;
    const prevOpen = ws.onopen;
    ws.onopen = (e) => {
      if (prevOpen && ws) prevOpen.call(ws, e);
      onStatus?.(useBybit ? 'En vivo (Bybit)' : 'En vivo (Binance)');
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (closed) return;
      failures++;
      if (failures >= 3 && !useBybit) {
        useBybit = true;
        failures = 0;
      }
      onStatus?.('Reconectando…');
      scheduleRetry();
    };
  };

  const scheduleRetry = () => {
    if (closed) return;
    retryTimer = setTimeout(connect, Math.min(1000 * 2 ** failures, 30000));
  };

  connect();
  return {
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
  };
}
