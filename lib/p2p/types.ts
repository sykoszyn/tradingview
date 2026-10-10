export type Platform = 'binance' | 'mexc';
/** sellers = anunciantes que VENDEN USDT (yo compro, pestaña "Comprar" de la app). buyers = anunciantes que COMPRAN USDT (yo vendo). */
export type Side = 'sellers' | 'buyers';

export const PLATFORMS: Platform[] = ['binance', 'mexc'];
export const PLAT_NAME: Record<Platform, string> = { binance: 'Binance', mexc: 'MEXC' };

export interface Ad {
  id: string;
  price: number; // ARS por USDT
  min: number | null; // ARS
  max: number | null; // ARS (lo que de verdad se puede operar ahora)
  available: number | null; // USDT
  methods: string[]; // nombres para mostrar
  methodKeys: string[]; // identificador + nombre, para filtrar
  merchant: boolean; // comerciante verificado por la plataforma
  finishRate: number | null; // 0–1 (últimos 30 días)
  orders: number | null; // órdenes completadas (últimos 30 días)
  nick: string;
}

export interface PlatformBook {
  platform: Platform;
  ok: boolean;
  fetchedAt: number;
  sellers: Ad[];
  buyers: Ad[];
  error?: string;
  source: string; // de dónde salió el dato
}

export interface MarketResponse {
  fetchedAt: number;
  books: Record<Platform, PlatformBook>;
}
