// Textos de los anuncios, listos para copiar.
import { PLAT_NAME, type Platform } from './types';

export type AdSide = 'buy' | 'sell'; // buy = mi anuncio de COMPRA de USDT

export function termsText(pl: Platform, side: AdSide, methods: string): string {
  const p = PLAT_NAME[pl];
  return side === 'buy'
    ? [
        `Compro USDT. Pago por ${methods}.`,
        `Pago únicamente a cuentas a nombre del titular verificado de la orden en ${p}. Si el nombre no coincide, cancelo la orden.`,
        `Pago dentro del tiempo de la orden y aviso por el chat de ${p} cuando transfiero.`,
        `Toda la operación se coordina por el chat de ${p}. No opero por fuera.`,
      ].join('\n')
    : [
        `Vendo USDT. Acepto ${methods}.`,
        `Solo acepto pagos desde cuentas a nombre del titular verificado de la orden en ${p}. Pagos de terceros se devuelven y la orden se cancela.`,
        `Libero los USDT cuando veo el dinero acreditado en mi cuenta, no con comprobantes.`,
        `Toda la operación se coordina por el chat de ${p}. No opero por fuera.`,
      ].join('\n');
}

export function autoReply(pl: Platform, side: AdSide, methods: string): string {
  const p = PLAT_NAME[pl];
  return side === 'buy'
    ? `¡Hola! Gracias por tu orden. Te pago por ${methods} a la cuenta a tu nombre que figura en ${p}. Cuando transfiero te aviso por acá. Por favor liberá los USDT al ver la acreditación.`
    : `¡Hola! Gracias por tu orden. Pagá desde una cuenta a tu nombre (${methods}) y marcá "Pagado" en ${p}. Libero los USDT apenas vea la plata acreditada. Pagos de terceros se devuelven.`;
}

export const COUNTERPARTY_REQS = 'KYC completo · cuenta con 30 días o más · 20 órdenes completadas o más · 90 % de finalización o más';
