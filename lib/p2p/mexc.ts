// MEXC P2P.
//
// Estado: SIN ENDPOINT PÚBLICO IDENTIFICADO.
// - La página P2P de MEXC (https://www.mexc.com/buy-crypto/p2p) bloquea las IPs de EE.UU.
//   (Akamai "Access Denied"), así que no se pudo inspeccionar qué endpoint usa.
// - MEXC tiene una API oficial P2P (GET /api/v3/fiat/market/ads/pagination, "Get Market Ads List",
//   parámetros fiatUnit y coinId obligatorios), pero exige API key con permiso "P2P Account Read"
//   y su formato de respuesta no está publicado. No se usa para no inventar el formato.
//
// Para habilitarlo: abrí la página P2P de MEXC en la compu, DevTools → Red, filtrá por la
// llamada que trae los anuncios y copiala "como cURL". Con esa URL y una respuesta real se
// completan MEXC_ENDPOINT y parseMexc(). Hasta entonces la web muestra "sin datos de MEXC".
import type { PlatformBook } from './types';

export const MEXC_ENDPOINT: string | null = null;

export async function fetchMexc(now = Date.now()): Promise<PlatformBook> {
  return {
    platform: 'mexc',
    ok: false,
    fetchedAt: now,
    sellers: [],
    buyers: [],
    source: '',
    error: 'Falta identificar el endpoint público del P2P de MEXC (ver instrucciones).',
  };
}
