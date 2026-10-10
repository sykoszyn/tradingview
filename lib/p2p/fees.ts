// Comisiones: P2P (de fuentes oficiales) y retiro de USDT (Binance en vivo).

export interface P2PFeeInfo {
  makerPct: number; // % sobre cada operación de tu anuncio
  takerPct: number; // % al tomar un anuncio
  takerFlatUsdt: number; // monto fijo por orden al tomar un anuncio
  source: string;
  url: string;
}

/**
 * Comisiones P2P USDT/ARS según la última información oficial encontrada (10/10/2026).
 * Pueden cambiar o variar por cuenta: la web deja corregirlas en Mi configuración.
 */
export const OFFICIAL_P2P_FEES: Record<'binance' | 'mexc', P2PFeeInfo> = {
  binance: {
    makerPct: 0.2,
    takerPct: 0,
    takerFlatUsdt: 0.05,
    source: 'Binance: maker 0,20 % para ARS (anuncio oficial, 25/09/2023) y taker fijo de 0,05 USDT por orden (anuncio oficial, 12/03/2024).',
    url: 'https://www.binance.com/es/fee/p2pFeeRate',
  },
  mexc: {
    makerPct: 0,
    takerPct: 0,
    takerFlatUsdt: 0,
    source: 'MEXC: sin comisión para anunciantes ni para quien toma el anuncio (acuerdo de servicio P2P oficial).',
    url: 'https://www.mexc.com/announcements/article/mexc-peer-to-peer-p2p-service-agreement-4411633765785',
  },
};

// Retiro de USDT desde Binance, endpoint público que usa su web:
//   GET https://www.binance.com/bapi/capital/v2/public/capital/config/getOne?coin=USDT&lang=en
export const BINANCE_WITHDRAW_URL = 'https://www.binance.com/bapi/capital/v2/public/capital/config/getOne?coin=USDT&lang=en';

export interface WithdrawNetwork {
  network: string; // código de Binance (TRX, BSC, MATIC, ...)
  name: string; // "Tron (TRC20)"
  fee: number; // USDT
  min: number | null;
  enabled: boolean;
}

export function parseBinanceWithdraw(json: unknown): WithdrawNetwork[] {
  const j = json as { code?: string; data?: Array<Record<string, unknown>> };
  if (!j || j.code !== '000000' || !Array.isArray(j.data)) throw new Error('Respuesta inesperada de Binance (retiros)');
  return j.data
    .map((n) => ({
      network: String(n.network ?? ''),
      name: String(n.name ?? n.network ?? ''),
      fee: parseFloat(String(n.withdrawFee)),
      min: Number.isFinite(parseFloat(String(n.withdrawMin))) ? parseFloat(String(n.withdrawMin)) : null,
      enabled: n.withdrawEnable === true,
    }))
    .filter((n) => n.network && Number.isFinite(n.fee));
}

export interface FeesResponse {
  fetchedAt: number;
  binanceWithdraw: { ok: boolean; networks: WithdrawNetwork[]; error?: string };
}

/** Nombres viejos de la configuración → código de red de Binance. */
export const LEGACY_NET: Record<string, string> = { TRC20: 'TRX', BEP20: 'BSC', Polygon: 'MATIC', Solana: 'SOL', Arbitrum: 'ARBITRUM' };
