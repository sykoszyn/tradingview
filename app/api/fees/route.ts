// Comisión de retiro de USDT desde Binance (pública, sin claves). Se cachea 1 hora.
import { NextResponse } from 'next/server';
import { BINANCE_WITHDRAW_URL, parseBinanceWithdraw, type FeesResponse } from '@/lib/p2p/fees';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let cache: { at: number; data: FeesResponse } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < 3_600_000) return NextResponse.json(cache.data);
  let data: FeesResponse;
  try {
    const res = await fetch(BINANCE_WITHDRAW_URL, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = { fetchedAt: now, binanceWithdraw: { ok: true, networks: parseBinanceWithdraw(await res.json()) } };
    cache = { at: now, data };
  } catch (e) {
    data = { fetchedAt: now, binanceWithdraw: { ok: false, networks: [], error: (e as Error).message } };
  }
  return NextResponse.json(data);
}
