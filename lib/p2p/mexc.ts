// MEXC P2P: endpoints públicos que usa su propia página (https://www.mexc.com/buy-crypto/p2p).
// Identificados el 10/10/2026 desde el navegador (DevTools → Red) y verificados con respuestas reales.
//
// Anuncios:
//   GET https://www.mexc.com/api/platform/p2p/api/market
//     ?blockTrade=false&countryCode=&tradeType=SELL|BUY&currency=ARS&payMethod=&amount=
//     &coinId=128f589271cb4951b03e71e6323eb7be   (USDT)
//     &page=1&pageSize=20&certifiedMerchant=false&allowTrade=false&haveTrade=false&follow=false
//     &adsType=1&adOrderSortField=price&adOrderSort=0|1
//   tradeType=SELL → anunciantes que VENDEN USDT (lo que ves en "Buy"), ordenar adOrderSort=0 (más barato primero).
//   tradeType=BUY  → anunciantes que COMPRAN USDT (lo que ves en "Sell"), ordenar adOrderSort=1 (el que más paga primero).
//   Respuesta: { code: 0, msg: "success", data: [ { id, price, availableQuantity, payMethod: "207,227",
//     minTradeLimit, maxTradeLimit, orderTag?: { i18nKey }, merchant: { nickName, merchantType },
//     merchantStatistics: { doneLastMonthCount, thirtyDayCompletionRate } } ], page: {...} }
//
// Métodos de pago (los anuncios traen ids):
//   GET https://www.mexc.com/api/platform/p2p/api/payment/method?currency=ARS
//   Respuesta: { code: 0, data: [ { id: 207, name: "Mercadopago" }, ... ] }
//
// Encabezados que manda la página: language, X-Client: H5, x-platform-type: h5, Referer.
// Notas: los anuncios con orderTag "mc_merchant_new_user_exclusive" (Flash Sale) son solo para
// usuarios nuevos y se marcan como restringidos. merchantType "merchant" y "prime" son comerciantes.
import type { Ad, PlatformBook, Side } from './types';

export const MEXC_API = 'https://www.mexc.com/api/platform/p2p/api';
export const MEXC_USDT_COIN_ID = '128f589271cb4951b03e71e6323eb7be';
export const MEXC_HEADERS: Record<string, string> = {
  language: 'en-US',
  'X-Client': 'H5',
  'x-platform-type': 'h5',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.8037.55 Mobile/15E148 Safari/604.1',
  Referer: 'https://www.mexc.com/buy-crypto/p2p/buy/USDT/ARS',
};
const MERCHANT_TYPES = new Set(['merchant', 'prime']);

export function mexcMarketUrl(side: Side, pageSize = 20): string {
  const p = new URLSearchParams({
    blockTrade: 'false',
    countryCode: '',
    tradeType: side === 'sellers' ? 'SELL' : 'BUY',
    currency: 'ARS',
    payMethod: '',
    amount: '',
    coinId: MEXC_USDT_COIN_ID,
    page: '1',
    pageSize: String(pageSize),
    certifiedMerchant: 'false',
    allowTrade: 'false',
    haveTrade: 'false',
    follow: 'false',
    adsType: '1',
    adOrderSortField: 'price',
    adOrderSort: side === 'sellers' ? '0' : '1',
  });
  return `${MEXC_API}/market?${p.toString()}`;
}
export const mexcMethodsUrl = () => `${MEXC_API}/payment/method?currency=ARS`;

const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : null;
};

export function parseMexcMethods(json: unknown): Map<string, string> {
  const j = json as { code?: number; data?: Array<{ id: number | string; name?: string }> };
  if (!j || j.code !== 0 || !Array.isArray(j.data)) throw new Error('Respuesta inesperada de MEXC (métodos de pago)');
  return new Map(j.data.map((m) => [String(m.id), m.name ?? String(m.id)]));
}

interface RawMexcAd {
  id: string;
  price: number;
  availableQuantity?: number;
  payMethod?: string;
  minTradeLimit?: number;
  maxTradeLimit?: number;
  orderTag?: { i18nKey?: string } | null;
  merchant?: { nickName?: string; merchantType?: string };
  merchantStatistics?: { doneLastMonthCount?: number; thirtyDayCompletionRate?: number; lastMonthCompleteRate?: string };
}

export function parseMexc(json: unknown, methods: Map<string, string>): Ad[] {
  const j = json as { code?: number; msg?: string; data?: RawMexcAd[] };
  if (!j || j.code !== 0 || !Array.isArray(j.data)) throw new Error(`Respuesta inesperada de MEXC${j?.msg ? `: ${j.msg}` : ''}`);
  return j.data
    .map((r): Ad | null => {
      const price = n(r.price);
      if (price === null || price <= 0) return null;
      const ids = String(r.payMethod ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const names = ids.map((id) => methods.get(id) ?? `Método ${id}`);
      const stats = r.merchantStatistics ?? {};
      const tag = r.orderTag?.i18nKey ?? '';
      return {
        id: String(r.id),
        price,
        min: n(r.minTradeLimit),
        max: n(r.maxTradeLimit),
        available: n(r.availableQuantity),
        methods: [...new Set(names)],
        methodKeys: names.map((x) => x.toLowerCase()),
        merchant: MERCHANT_TYPES.has(r.merchant?.merchantType ?? ''),
        finishRate: n(stats.thirtyDayCompletionRate) ?? n(stats.lastMonthCompleteRate),
        orders: n(stats.doneLastMonthCount),
        nick: r.merchant?.nickName ?? '',
        restricted: /new_user/i.test(tag) ? 'Solo para usuarios nuevos' : undefined,
      };
    })
    .filter((a): a is Ad => a !== null);
}

type Get = (url: string, headers: Record<string, string>) => Promise<unknown>;

let methodsCache: { at: number; map: Map<string, string> } | null = null;

export async function fetchMexc(get: Get, now = Date.now()): Promise<PlatformBook> {
  try {
    if (!methodsCache || now - methodsCache.at > 3_600_000) {
      methodsCache = { at: now, map: parseMexcMethods(await get(mexcMethodsUrl(), MEXC_HEADERS)) };
    }
    const map = methodsCache.map;
    const [sellersRaw, buyersRaw] = await Promise.all([get(mexcMarketUrl('sellers'), MEXC_HEADERS), get(mexcMarketUrl('buyers'), MEXC_HEADERS)]);
    return { platform: 'mexc', ok: true, fetchedAt: now, sellers: parseMexc(sellersRaw, map), buyers: parseMexc(buyersRaw, map), source: 'www.mexc.com' };
  } catch (e) {
    return { platform: 'mexc', ok: false, fetchedAt: now, sellers: [], buyers: [], source: '', error: (e as Error).message };
  }
}

/** Solo para tests. */
export const _resetMexcCache = () => (methodsCache = null);
