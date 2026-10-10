// Proxy de solo lectura a las APIs públicas (lista blanca de recursos).
// Corre en la región gru1 (definida en vercel.json) para evitar el bloqueo de IPs de EE.UU.
import { NextResponse, type NextRequest } from 'next/server';
import { makeFetchJson, parseResourceParams, resolveResource } from '@/lib/data/market-service';

export const runtime = 'nodejs';

const fetchJson = makeFetchJson((opts) => ({ next: { revalidate: opts?.revalidate ?? 60 } }) as RequestInit);

const CACHE_SECONDS: Record<string, number> = {
  klines: 60,
  premium: 30,
  funding: 300,
  'exchange-info': 3600,
  brackets: 3600,
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ resource: string }> }) {
  const { resource } = await ctx.params;
  let params;
  try {
    params = parseResourceParams(resource, req.nextUrl.searchParams);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const result = await resolveResource(params, fetchJson, 'server');
    const ttl = CACHE_SECONDS[resource] ?? 60;
    return NextResponse.json(result, {
      headers: { 'Cache-Control': `public, s-maxage=${ttl}, stale-while-revalidate=${ttl}` },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
