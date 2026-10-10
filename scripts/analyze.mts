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

// Señales de las últimas 200 velas de 1h cerradas (cada una evaluada con los datos de ese momento).
import { detectSetups, SETUP_LABEL } from '../lib/analysis/setups';
console.log('\nSeñales en las últimas 200 velas de 1h:');
let count = 0;
for (let i = Math.max(2, closed1h.length - 200); i < closed1h.length; i++) {
  const t = closed1h[i].closeTime;
  const cx = contextAt(s, t, closed1h[i].close, DEFAULT_CONFIG);
  for (const sig of detectSetups({ candles: closed1h, i, zones: cx.zones, trend: cx.trend, market, cfg: DEFAULT_CONFIG })) {
    count++;
    console.log(`  ${new Date(t + 1).toISOString().slice(0, 16)} ${sig.direction.toUpperCase().padEnd(5)} ${SETUP_LABEL[sig.setup].padEnd(36)} entrada ${f(sig.entry)} ancla stop ${f(sig.stopAnchor)} conf ${sig.confidence} (tendencia ${cx.trend?.trend})`);
  }
}
console.log(`Total: ${count}`);
