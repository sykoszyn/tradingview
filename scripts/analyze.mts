// Diagnóstico por consola: zonas y tendencia actuales con datos reales.
// Uso: npm run analyze -- ETHUSDT futures
import { DEFAULT_CONFIG } from '../lib/config/defaults';
import { makeFetchJson, resolveResource } from '../lib/data/market-service';
import { contextAt, prepareSeries } from '../lib/analysis/context';
import type { Candle, Market, TradingSymbol } from '../lib/types';

const symbol = (process.argv[2] ?? 'ETHUSDT') as TradingSymbol;
const market = (process.argv[3] ?? 'futures') as Market;
const fetchJson = makeFetchJson();

async function klines(interval: '1h' | '4h', limit: number) {
  const r = await resolveResource({ resource: 'klines', provider: 'binance', market, symbol, interval, limit }, fetchJson, 'server');
  return { candles: r.data as Candle[], source: r.source };
}

const now = Date.now();
const [h1, h4] = await Promise.all([klines('1h', 1000), klines('4h', 1000)]);
const closed1h = h1.candles.filter((c) => c.closeTime <= now);
const closed4h = h4.candles.filter((c) => c.closeTime <= now);
const price = h1.candles[h1.candles.length - 1].close;
const s = prepareSeries(closed1h, closed4h, DEFAULT_CONFIG);
const ctx = contextAt(s, now, price, DEFAULT_CONFIG);
const f = (n: number) => n.toFixed(2);
console.log(`${symbol} ${market} · precio ${f(price)} · fuente ${h1.source}`);
console.log(`Tendencia 4h: ${ctx.trend?.trend} — ${ctx.trend?.explanation} EMA50 ${f(ctx.trend!.emaFast)} EMA200 ${f(ctx.trend!.emaSlow)} VWAP ${f(ctx.trend!.vwap)}`);
console.log(`Zonas detectadas: ${ctx.zones.length}`);
console.log('Resistencias (más cercana primero):');
for (const z of ctx.selection.above) console.log(`  ${f(z.low)}–${f(z.high)}  toques ${z.touches} (4h: ${z.touches4h})  puntaje ${z.score.toFixed(2)}  último ${new Date(z.lastTouch).toISOString().slice(0, 16)}`);
console.log('Soportes (más cercano primero):');
for (const z of ctx.selection.below) console.log(`  ${f(z.low)}–${f(z.high)}  toques ${z.touches} (4h: ${z.touches4h})  puntaje ${z.score.toFixed(2)}  último ${new Date(z.lastTouch).toISOString().slice(0, 16)}`);
