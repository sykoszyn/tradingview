// Lee los anuncios P2P USDT/ARS en el servidor (Binance no permite leerlos desde el navegador por CORS).
// Corre en la región gru1 (São Paulo, ver vercel.json). Solo lectura, sin claves.
import { NextResponse } from 'next/server';
import { fetchBinance } from '@/lib/p2p/binance';
import { fetchMexc } from '@/lib/p2p/mexc';
import type { MarketResponse } from '@/lib/p2p/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 20_000;
let cache: { at: number; data: MarketResponse } | null = null;

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return NextResponse.json(cache.data, { headers: { 'Cache-Control': 'no-store' } });
  const [binance, mexc] = await Promise.all([fetchBinance(postJson, now), fetchMexc(getJson, now)]);
  const data: MarketResponse = { fetchedAt: now, books: { binance, mexc } };
  if (binance.ok || mexc.ok) cache = { at: now, data };
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
