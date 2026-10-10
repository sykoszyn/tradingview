// Binance P2P: endpoint público que usa su propia web.
//   POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search
//   body: { fiat: "ARS", asset: "USDT", tradeType: "BUY" | "SELL", page: 1, rows: 20, payTypes: [], publisherType: null }
// tradeType "BUY" devuelve anuncios de quienes VENDEN USDT (lo que ves en la pestaña "Comprar").
// tradeType "SELL" devuelve anuncios de quienes COMPRAN USDT (pestaña "Vender").
// No envía cabeceras CORS: el navegador no puede llamarlo directo, por eso pasa por /api/p2p.
import type { Ad, PlatformBook, Side } from './types';

export const BINANCE_HOSTS = ['https://p2p.binance.com', 'https://www.binance.com'];
export const BINANCE_PATH = '/bapi/c2c/v2/friendly/c2c/adv/search';

interface RawAd {
  adv: {
    advNo: string;
    price: string;
    minSingleTransAmount?: string;
    maxSingleTransAmount?: string;
    dynamicMaxSingleTransAmount?: string;
    surplusAmount?: string;
    tradableQuantity?: string;
    tradeMethods?: Array<{ identifier?: string; tradeMethodName?: string | null }>;
  };
  advertiser: { nickName?: string; monthOrderCount?: number; monthFinishRate?: number; userType?: string };
}

const n = (v: unknown): number | null => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : null;
};

export function parseBinance(json: unknown): Ad[] {
  const j = json as { code?: string; success?: boolean; data?: RawAd[]; message?: string };
  if (!j || j.code !== '000000' || !Array.isArray(j.data)) throw new Error(`Respuesta inesperada de Binance${j?.message ? `: ${j.message}` : ''}`);
  return j.data
    .map((r): Ad | null => {
      const price = n(r.adv?.price);
      if (price === null || price <= 0) return null;
      const methods = (r.adv.tradeMethods ?? []).map((m) => m.tradeMethodName || m.identifier || '').filter(Boolean);
      return {
        id: String(r.adv.advNo),
        price,
        min: n(r.adv.minSingleTransAmount),
        max: n(r.adv.dynamicMaxSingleTransAmount) ?? n(r.adv.maxSingleTransAmount),
        available: n(r.adv.tradableQuantity) ?? n(r.adv.surplusAmount),
        methods: [...new Set(methods)],
        methodKeys: (r.adv.tradeMethods ?? []).map((m) => `${m.identifier ?? ''} ${m.tradeMethodName ?? ''}`.toLowerCase()),
        merchant: r.advertiser?.userType === 'merchant',
        finishRate: n(r.advertiser?.monthFinishRate),
        orders: n(r.advertiser?.monthOrderCount),
        nick: r.advertiser?.nickName ?? '',
      };
    })
    .filter((a): a is Ad => a !== null);
}

export function binanceBody(side: Side, rows = 20) {
  return { fiat: 'ARS', asset: 'USDT', tradeType: side === 'sellers' ? 'BUY' : 'SELL', page: 1, rows, payTypes: [], publisherType: null };
}

type Post = (url: string, body: unknown) => Promise<unknown>;

export async function fetchBinance(post: Post, now = Date.now()): Promise<PlatformBook> {
  const errors: string[] = [];
  for (const host of BINANCE_HOSTS) {
    try {
      const [sellersRaw, buyersRaw] = await Promise.all([post(host + BINANCE_PATH, binanceBody('sellers')), post(host + BINANCE_PATH, binanceBody('buyers'))]);
      return { platform: 'binance', ok: true, fetchedAt: now, sellers: parseBinance(sellersRaw), buyers: parseBinance(buyersRaw), source: host.replace('https://', '') };
    } catch (e) {
      errors.push(`${host.replace('https://', '')}: ${(e as Error).message}`);
    }
  }
  return { platform: 'binance', ok: false, fetchedAt: now, sellers: [], buyers: [], error: errors.join(' · '), source: '' };
}
