import { describe, expect, it } from 'vitest';
import fixture from './fixtures/binance.json';
import { binanceBody, fetchBinance, parseBinance } from '@/lib/p2p/binance';
import mexc from './fixtures/mexc.json';
import { _resetMexcCache, fetchMexc, mexcMarketUrl, parseMexc, parseMexcMethods } from '@/lib/p2p/mexc';
import { filterSide, median, type FilterSettings } from '@/lib/p2p/filters';
import { methodMatches } from '@/lib/p2p/methods';
import { cycleMargin, parseNum, scenario, suggest, type CalcSettings } from '@/lib/p2p/calc';
import type { Ad } from '@/lib/p2p/types';

const NO_FILTER: FilterSettings = { merchantOnly: false, minFinishRatePct: 0, minOrders: 0, myMethods: [], amountArs: null, outlierPct: 100 };

describe('Binance (respuesta real guardada)', () => {
  const sellers = parseBinance(fixture['binance-sellers']);
  const buyers = parseBinance(fixture['binance-buyers']);
  it('lee precio, límites, métodos y datos del anunciante', () => {
    expect(sellers.length).toBe(8);
    const a = sellers[0];
    expect(a.price).toBeGreaterThan(0);
    expect(a.min).toBeGreaterThan(0);
    expect(a.max).toBeGreaterThan(a.min!);
    expect(a.methods.length).toBeGreaterThan(0);
    expect(a.finishRate).toBeGreaterThan(0);
    expect(typeof a.merchant).toBe('boolean');
  });
  it('tradeType BUY = vendedores (yo compro) y SELL = compradores (yo vendo)', () => {
    expect(binanceBody('sellers').tradeType).toBe('BUY');
    expect(binanceBody('buyers').tradeType).toBe('SELL');
    expect(binanceBody('sellers')).toMatchObject({ fiat: 'ARS', asset: 'USDT', rows: 20 });
    // los vendedores piden más que lo que pagan los compradores
    expect(Math.min(...sellers.map((x) => x.price))).toBeGreaterThan(Math.max(...buyers.map((x) => x.price)));
  });
  it('rechaza respuestas con error', () => {
    expect(() => parseBinance({ code: '100', message: 'x' })).toThrow();
  });
  it('si p2p.binance.com falla, prueba www.binance.com', async () => {
    const calls: string[] = [];
    const book = await fetchBinance(async (url, body) => {
      calls.push(url);
      if (url.startsWith('https://p2p.')) throw new Error('bloqueado');
      return (body as { tradeType: string }).tradeType === 'BUY' ? fixture['binance-sellers'] : fixture['binance-buyers'];
    });
    expect(book.ok).toBe(true);
    expect(book.source).toBe('www.binance.com');
    expect(calls.some((c) => c.startsWith('https://www.binance.com'))).toBe(true);
  });
  it('si todo falla, devuelve "sin datos" sin precios', async () => {
    const book = await fetchBinance(async () => {
      throw new Error('caído');
    });
    expect(book.ok).toBe(false);
    expect(book.sellers).toEqual([]);
    expect(book.error).toMatch(/caído/);
  });
});

describe('MEXC (respuestas reales guardadas)', () => {
  const methods = parseMexcMethods(mexc['mexc-methods']);
  const sellers = parseMexc(mexc['mexc-sellers'], methods);
  const buyers = parseMexc(mexc['mexc-buyers'], methods);
  it('traduce los ids de métodos de pago', () => {
    expect(methods.get('207')).toBe('Mercadopago');
    expect(methods.get('235')).toBe('Bank Transfer (Argentina)');
  });
  it('lee precio, límites, disponible, métodos y estadísticas', () => {
    const a = sellers.find((x) => !x.restricted)!;
    expect(a.price).toBeGreaterThan(0);
    expect(a.max!).toBeGreaterThan(a.min!);
    expect(a.available).toBeGreaterThan(0);
    expect(a.methods.length).toBeGreaterThan(0);
    expect(a.finishRate).not.toBeNull();
    expect(a.orders).not.toBeNull();
  });
  it('marca los anuncios exclusivos para usuarios nuevos y el filtro los descarta', () => {
    const promo = sellers.filter((x) => x.restricted);
    expect(promo.length).toBeGreaterThan(0);
    const r = filterSide(sellers, 'sellers', NO_FILTER);
    expect(r.kept.some((x) => x.restricted)).toBe(false);
    expect(r.dropped.filter((d) => d.reason === 'exclusivo').length).toBe(promo.length);
  });
  it('SELL = vendedores y BUY = compradores (al revés que Binance)', () => {
    expect(mexcMarketUrl('sellers')).toContain('tradeType=SELL');
    expect(mexcMarketUrl('sellers')).toContain('adOrderSort=0');
    expect(mexcMarketUrl('buyers')).toContain('tradeType=BUY');
    expect(mexcMarketUrl('buyers')).toContain('adOrderSort=1');
    // Con el filtro de atípicos (en los datos reales hay un vendedor a 1.399, lejos de la mediana)
    const f = { ...NO_FILTER, outlierPct: 3 };
    const sel = filterSide(sellers, 'sellers', f);
    const bestAsk = sel.best!;
    const bestBid = filterSide(buyers, 'buyers', f).best!;
    expect(sel.dropped.some((d) => d.reason === 'atipico' && d.ad.price === 1399)).toBe(true);
    // Mismo rango de precios (en P2P el mejor vendedor puede quedar apenas por debajo del mejor comprador)
    expect(Math.abs(bestAsk - bestBid) / bestBid).toBeLessThan(0.02);
    // vendedores del más barato al más caro, compradores del que más paga al que menos
    expect(sel.kept.map((a) => a.price)).toEqual([...sel.kept.map((a) => a.price)].sort((a, b) => a - b));
  });
  it('consulta métodos, vendedores y compradores con los encabezados de la página', async () => {
    _resetMexcCache();
    const urls: string[] = [];
    const book = await fetchMexc(async (url, headers) => {
      urls.push(url);
      expect(headers['X-Client']).toBe('H5');
      if (url.includes('/payment/method')) return mexc['mexc-methods'];
      return url.includes('tradeType=SELL') ? mexc['mexc-sellers'] : mexc['mexc-buyers'];
    });
    expect(book.ok).toBe(true);
    expect(book.sellers.length).toBe(10);
    expect(urls[0]).toBe('https://www.mexc.com/api/platform/p2p/api/payment/method?currency=ARS');
  });
  it('si MEXC falla: sin datos, nunca precios inventados', async () => {
    _resetMexcCache();
    const b = await fetchMexc(async () => {
      throw new Error('HTTP 403');
    });
    expect(b.ok).toBe(false);
    expect(b.sellers).toEqual([]);
    expect(b.error).toMatch(/403/);
  });
});

const ad = (o: Partial<Ad>): Ad => ({
  id: Math.random().toString(36), price: 1600, min: 10000, max: 500000, available: 300, methods: ['Mercadopago'],
  methodKeys: ['mercadopagonew mercadopago'], merchant: true, finishRate: 0.99, orders: 300, nick: 'x', ...o,
});

describe('filtros', () => {
  it('mediana', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('vendedores: el mejor es el más barato; compradores: el que más paga', () => {
    const ads = [ad({ price: 1610 }), ad({ price: 1600 }), ad({ price: 1605 })];
    expect(filterSide(ads, 'sellers', NO_FILTER).best).toBe(1600);
    expect(filterSide(ads, 'buyers', NO_FILTER).best).toBe(1610);
  });
  it('solo comerciantes, finalización y órdenes mínimas', () => {
    const ads = [ad({ price: 1600, merchant: false }), ad({ price: 1601, finishRate: 0.9 }), ad({ price: 1602, orders: 5 }), ad({ price: 1603 })];
    const r = filterSide(ads, 'sellers', { ...NO_FILTER, merchantOnly: true, minFinishRatePct: 95, minOrders: 50 });
    expect(r.best).toBe(1603);
    expect(r.dropped.map((d) => d.reason)).toEqual(['comerciante', 'finalizacion', 'ordenes']);
  });
  it('métodos de pago que uso', () => {
    const ads = [ad({ price: 1600, methodKeys: ['lemoncash lemon cash'] }), ad({ price: 1601 })];
    expect(filterSide(ads, 'sellers', { ...NO_FILTER, myMethods: ['mercadopago'] }).best).toBe(1601);
  });
  it('el límite del anuncio tiene que cubrir mi monto', () => {
    const ads = [ad({ price: 1600, min: 300000 }), ad({ price: 1601, max: 50000 }), ad({ price: 1602, min: 10000, max: 400000 })];
    expect(filterSide(ads, 'sellers', { ...NO_FILTER, amountArs: 100000 }).best).toBe(1602);
  });
  it('descarta precios atípicos lejos de la mediana', () => {
    const ads = [ad({ price: 1400 }), ad({ price: 1600 }), ad({ price: 1601 }), ad({ price: 1602 }), ad({ price: 1900 })];
    const r = filterSide(ads, 'sellers', { ...NO_FILTER, outlierPct: 3 });
    expect(r.best).toBe(1600);
    expect(r.dropped.filter((d) => d.reason === 'atipico')).toHaveLength(2);
  });
  it('si nada pasa los filtros, no hay mejor precio', () => {
    expect(filterSide([ad({ merchant: false })], 'sellers', { ...NO_FILTER, merchantOnly: true }).best).toBeNull();
  });
});

describe('métodos de pago', () => {
  it('Brubank no cuenta como transferencia bancaria genérica', () => {
    expect(methodMatches('bancobrubanknew banco brubank', ['banco'])).toBe(false);
    expect(methodMatches('bancobrubanknew banco brubank', ['brubank'])).toBe(true);
    expect(methodMatches('bankargentina bank transfer (argentina)', ['banco'])).toBe(true);
    expect(methodMatches('ualanew uala', ['uala'])).toBe(true);
    expect(methodMatches('mercadopagonew mercadopago', ['mercadopago'])).toBe(true);
  });
});

const calc = (o: Partial<CalcSettings> = {}): CalcSettings => ({
  fees: { binance: { maker: 0.002, taker: 0.002 }, mexc: { maker: 0, taker: 0 } },
  withdrawUsdt: { binance: 1, mexc: 1 },
  capitalArs: 500000,
  capitalUsdt: 300,
  minMargin: 0.005,
  step: 0.1,
  ...o,
});

describe('cálculos', () => {
  it('números escritos a la argentina', () => {
    expect(parseNum('1.450,50')).toBe(1450.5);
    expect(parseNum('1450.50')).toBe(1450.5);
    expect(parseNum('1.450')).toBe(1450);
    expect(parseNum('500.000')).toBe(500000);
    expect(parseNum('')).toBeNull();
  });
  it('margen de un ciclo con comisiones', () => {
    expect(cycleMargin(1000, 1010, 0, 0)).toBeCloseTo(0.01, 10);
    expect(cycleMargin(1000, 1010, 0.001, 0.001)).toBeLessThan(0.01);
  });
  it('precio sugerido: un paso mejor que el primero de la lista', () => {
    const s = suggest({ bid: 1430, ask: 1452 }, { maker: 0.002, taker: null }, calc());
    expect(s.buy).toBe(1430.1);
    expect(s.sell).toBe(1451.9);
    expect(s.buyTop).toBe(true);
  });
  it('si no llega a mi margen mínimo, baja mi precio de compra y avisa', () => {
    const s = suggest({ bid: 1448, ask: 1452 }, { maker: 0.002, taker: null }, calc());
    expect(s.buyTop).toBe(false);
    expect(cycleMargin(s.buy!, s.sell!, 0.002, 0.002)).toBeGreaterThanOrEqual(0.005 - 1e-6);
    expect(s.note).toBeTruthy();
  });
  it('escenario en la misma plataforma (verificado a mano)', () => {
    const best = { binance: { bid: 1430, ask: 1452 }, mexc: { bid: null, ask: null } };
    const r = scenario('binance', 'binance', best, calc(), 'maker');
    // q = min(500000/1430,1 ; 300) = 300; 300·0,998 = 299,4 USDT; ·1451,9·0,998 − 300·1430,1
    expect(r.q).toBe(300);
    expect(r.profit).toBeCloseTo(299.4 * 1451.9 * 0.998 - 300 * 1430.1, 6);
    expect(r.light).toBe('ok');
  });
  it('entre plataformas descuenta el retiro en USDT', () => {
    const best = { binance: { bid: 1430, ask: 1452 }, mexc: { bid: 1445, ask: 1462 } };
    const r = scenario('binance', 'mexc', best, calc(), 'maker');
    expect(r.W).toBe(1);
    expect(r.profit).toBeCloseTo((300 * 0.998 - 1) * 1461.9 - 300 * 1430.1, 6);
  });
  it('modo tomando anuncios usa el mejor vendedor para comprar y el mejor comprador para vender', () => {
    const best = { binance: { bid: 1430, ask: 1452 }, mexc: { bid: 1470, ask: 1480 } };
    const r = scenario('binance', 'mexc', best, calc(), 'taker');
    expect(r.B).toBe(1452);
    expect(r.S).toBe(1470);
  });
  it('sin datos de una plataforma, el escenario no se calcula', () => {
    const best = { binance: { bid: 1430, ask: 1452 }, mexc: { bid: null, ask: null } };
    expect(scenario('binance', 'mexc', best, calc(), 'maker').ok).toBe(false);
  });
  it('avisa las comisiones y retiros sin cargar', () => {
    const best = { binance: { bid: 1430, ask: 1452 }, mexc: { bid: 1445, ask: 1462 } };
    const r = scenario('mexc', 'binance', best, calc({ fees: { binance: { maker: null, taker: null }, mexc: { maker: null, taker: null } }, withdrawUsdt: { binance: null, mexc: null } }), 'maker');
    expect(r.missing.length).toBe(3);
  });
  it('semáforo: rojo si pierde, amarillo si gana menos que el mínimo', () => {
    const best = { binance: { bid: 1450, ask: 1452 }, mexc: { bid: null, ask: null } };
    expect(scenario('binance', 'binance', best, calc(), 'maker').light).toBe('bad');
    const best2 = { binance: { bid: 1440, ask: 1452 }, mexc: { bid: null, ask: null } };
    expect(scenario('binance', 'binance', best2, calc({ fees: { binance: { maker: 0, taker: 0 }, mexc: { maker: 0, taker: 0 } } }), 'maker').light).toBe('ok');
    const best3 = { binance: { bid: 1447, ask: 1452 }, mexc: { bid: null, ask: null } };
    expect(scenario('binance', 'binance', best3, calc({ fees: { binance: { maker: 0, taker: 0 }, mexc: { maker: 0, taker: 0 } } }), 'maker').light).toBe('warn');
  });
});

import withdraw from './fixtures/binance-withdraw.json';
import { OFFICIAL_P2P_FEES, parseBinanceWithdraw } from '@/lib/p2p/fees';

describe('comisiones', () => {
  it('retiro de USDT desde Binance por red (respuesta real guardada)', () => {
    const nets = parseBinanceWithdraw(withdraw);
    const trx = nets.find((n) => n.network === 'TRX')!;
    const bsc = nets.find((n) => n.network === 'BSC')!;
    expect(trx.name).toMatch(/TRC20/);
    expect(trx.fee).toBeGreaterThan(0);
    expect(bsc.fee).toBeGreaterThanOrEqual(0);
    expect(typeof trx.enabled).toBe('boolean');
  });
  it('valores oficiales del P2P: Binance maker 0,20 % y taker 0,05 USDT por orden; MEXC 0 %', () => {
    expect(OFFICIAL_P2P_FEES.binance).toMatchObject({ makerPct: 0.2, takerPct: 0, takerFlatUsdt: 0.05 });
    expect(OFFICIAL_P2P_FEES.mexc).toMatchObject({ makerPct: 0, takerPct: 0, takerFlatUsdt: 0 });
  });
  it('tomando anuncios descuenta el monto fijo por orden de cada lado', () => {
    const best = { binance: { bid: 1430, ask: 1452 }, mexc: { bid: 1470, ask: 1480 } };
    const base = calc({ fees: { binance: { maker: 0.002, taker: 0, takerFlat: 0.05 }, mexc: { maker: 0, taker: 0, takerFlat: 0 } } });
    const r = scenario('binance', 'mexc', best, base, 'taker');
    // 300 USDT − 1 de retiro − 0,05 de la orden en Binance
    expect(r.profit).toBeCloseTo((300 - 1 - 0.05) * 1470 - 300 * 1452, 6);
    const same = scenario('binance', 'binance', { ...best, binance: { bid: 1450, ask: 1440 } }, base, 'taker');
    expect(same.profit).toBeCloseTo((300 - 0.1) * 1450 - 300 * 1440, 6);
  });
});

describe('datos incompletos', () => {
  it('si falta el retiro, el escenario queda incompleto (no puede ser la mejor jugada)', () => {
    const best = { binance: { bid: 1600, ask: 1603 }, mexc: { bid: 1595, ask: 1596.7 } };
    const r = scenario('mexc', 'binance', best, calc({ withdrawUsdt: { binance: 0.01, mexc: null } }), 'maker');
    expect(r.ok).toBe(true);
    expect(r.incomplete).toBe(true);
    expect(r.missing.join(' ')).toMatch(/retiro desde MEXC/);
    const ok = scenario('mexc', 'binance', best, calc({ withdrawUsdt: { binance: 0.01, mexc: 1 } }), 'maker');
    expect(ok.incomplete).toBe(false);
  });
});
