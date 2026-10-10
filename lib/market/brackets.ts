// Brackets de apalancamiento / maintenance margin.
import type { BracketSet, LeverageBracket, TradingSymbol } from '../types';

interface BinancePublicBracket {
  bracketNotionalFloor: number;
  bracketNotionalCap: number;
  bracketMaintenanceMarginRate: number;
  cumFastMaintenanceAmount: number;
  maxOpenPosLeverage: number;
}

/** Endpoint público de la web de Binance: /bapi/futures/v1/friendly/future/common/brackets */
export function parseBinancePublicBrackets(
  json: unknown,
  symbols: readonly TradingSymbol[],
  now = Date.now(),
): Partial<Record<TradingSymbol, BracketSet>> {
  const list = (json as { data?: { brackets?: Array<{ symbol: string; riskBrackets: BinancePublicBracket[] }> } })?.data
    ?.brackets;
  if (!Array.isArray(list)) throw new Error('Respuesta de brackets sin datos');
  const out: Partial<Record<TradingSymbol, BracketSet>> = {};
  for (const sym of symbols) {
    const s = list.find((x) => x.symbol === sym);
    if (!s || !s.riskBrackets?.length) continue;
    out[sym] = {
      symbol: sym,
      source: 'binance-public',
      fetchedAt: now,
      brackets: s.riskBrackets
        .map((b) => ({
          notionalFloor: Number(b.bracketNotionalFloor),
          notionalCap: Number(b.bracketNotionalCap),
          maintMarginRate: Number(b.bracketMaintenanceMarginRate),
          maintAmount: Number(b.cumFastMaintenanceAmount),
          maxLeverage: Number(b.maxOpenPosLeverage),
        }))
        .sort((a, b) => a.notionalFloor - b.notionalFloor),
    };
  }
  return out;
}

/** Bybit /v5/market/risk-limit?category=linear&symbol=X */
export function parseBybitRiskLimit(json: unknown, symbol: TradingSymbol, now = Date.now()): BracketSet {
  const list = (json as {
    result?: { list?: Array<{ symbol: string; riskLimitValue: string; maintenanceMargin: string; maxLeverage: string; mmDeduction?: string }> };
  })?.result?.list?.filter((x) => x.symbol === symbol);
  if (!list?.length) throw new Error('Bybit risk-limit sin datos');
  const sorted = [...list].sort((a, b) => Number(a.riskLimitValue) - Number(b.riskLimitValue));
  let floor = 0;
  const brackets: LeverageBracket[] = sorted.map((x) => {
    const cap = Number(x.riskLimitValue);
    const b = {
      notionalFloor: floor,
      notionalCap: cap,
      maintMarginRate: Number(x.maintenanceMargin),
      maintAmount: Number(x.mmDeduction ?? 0) || 0,
      maxLeverage: Number(x.maxLeverage),
    };
    floor = cap;
    return b;
  });
  return { symbol, brackets, source: 'bybit', fetchedAt: now };
}

/**
 * Último recurso: MMR conservador (más alto que el real del primer tramo de
 * Binance, ~0,4 %), así el precio de liquidación estimado queda MÁS CERCA que el
 * real y la regla stop-vs-liquidación es más estricta, nunca más laxa.
 */
export const CONSERVATIVE_MMR = 0.01;
export function conservativeBrackets(symbol: TradingSymbol, now = Date.now()): BracketSet {
  return {
    symbol,
    source: 'conservative',
    fetchedAt: now,
    warning: `No se pudieron obtener los brackets: se usa un MMR conservador de ${CONSERVATIVE_MMR * 100}%. La liquidación real queda más lejos que la estimada.`,
    brackets: [{ notionalFloor: 0, notionalCap: Number.MAX_SAFE_INTEGER, maintMarginRate: CONSERVATIVE_MMR, maintAmount: 0, maxLeverage: 20 }],
  };
}

/** Bracket que corresponde a un nocional dado. */
export function pickBracket(set: BracketSet, notional: number): LeverageBracket {
  const b = set.brackets.find((x) => notional >= x.notionalFloor && notional < x.notionalCap);
  return b ?? set.brackets[set.brackets.length - 1];
}
