import { describe, expect, it } from 'vitest';
import { parseResourceParams, resolveResource } from '@/lib/data/market-service';
import { parseBinanceKlines, parseBybitKlines } from '@/lib/data/providers';

describe('parseResourceParams (lista blanca)', () => {
  it('acepta parámetros válidos', () => {
    const p = parseResourceParams('klines', new URLSearchParams('market=spot&symbol=BTCUSDT&interval=4h&limit=200'));
    expect(p).toMatchObject({ market: 'spot', symbol: 'BTCUSDT', interval: '4h', limit: 200 });
  });
  it('rechaza símbolos, intervalos y recursos no permitidos', () => {
    expect(() => parseResourceParams('klines', new URLSearchParams('symbol=DOGEUSDT'))).toThrow();
    expect(() => parseResourceParams('klines', new URLSearchParams('interval=1d'))).toThrow();
    expect(() => parseResourceParams('account', new URLSearchParams())).toThrow();
  });
});

describe('resolveResource (cadena de fuentes)', () => {
  const kline = [[1, '1', '2', '0.5', '1.5', '10', 3599999]];
  it('futuros desde el servidor: si fapi falla usa el espejo e informa la fuente', async () => {
    const calls: string[] = [];
    const fetchJson = async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://fapi.binance.com')) throw new Error('HTTP 451');
      return kline;
    };
    const r = await resolveResource({ resource: 'klines', provider: 'binance', market: 'futures', symbol: 'ETHUSDT', interval: '1h' }, fetchJson, 'server');
    expect(r.source).toBe('binance-mirror');
    expect(r.errors[0]).toContain('451');
    expect(calls[1]).toContain('www.binance.com/fapi/v1/klines');
  });
  it('lanza error si todas las fuentes fallan', async () => {
    const fetchJson = async () => { throw new Error('down'); };
    await expect(resolveResource({ resource: 'premium', provider: 'binance', market: 'futures', symbol: 'ETHUSDT' }, fetchJson, 'server')).rejects.toThrow(/Ninguna fuente/);
  });
});

describe('parsers de velas', () => {
  it('Binance', () => {
    expect(parseBinanceKlines([[1000, '1', '2', '0.5', '1.5', '10', 1999]])[0]).toEqual({ openTime: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, closeTime: 1999 });
  });
  it('Bybit viene de nueva a vieja y se reordena', () => {
    const c = parseBybitKlines({ result: { list: [['7200000', '2', '3', '1', '2', '5'], ['3600000', '1', '2', '0.5', '1.5', '10']] } }, '1h');
    expect(c.map((x) => x.openTime)).toEqual([3600000, 7200000]);
    expect(c[0].closeTime).toBe(7199999);
  });
});
