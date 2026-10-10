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
import { buildPlan } from '../lib/plan/plan';
import { planToText } from '../lib/plan/plan-text';
import type { SymbolFilters } from '../lib/types';
const info = await resolveResource({ resource: 'exchange-info', provider: 'binance', market, symbol }, fetchJson, 'server');
const filters = (info.data as Record<string, SymbolFilters>)[symbol];
const phaseName = process.argv[4] ?? 'phase3';
const phase = DEFAULT_CONFIG.phases[phaseName as 'phase2' | 'phase3' | 'phase4'];
const tally: Record<string, number> = {};
let lastPlan: string | null = null;
console.log('\nSeñales en las últimas 200 velas de 1h:');
let count = 0;
for (let i = Math.max(2, closed1h.length - 200); i < closed1h.length; i++) {
  const t = closed1h[i].closeTime;
  const cx = contextAt(s, t, closed1h[i].close, DEFAULT_CONFIG);
  for (const sig of detectSetups({ candles: closed1h, i, zones: cx.zones, trend: cx.trend, market, cfg: DEFAULT_CONFIG })) {
    count++;
    const r = buildPlan({ signal: sig, symbol, market, zones: cx.zones, filters, cfg: DEFAULT_CONFIG, phase });
    const res = r.kind === 'discarded' ? `descartada: ${r.code}` : r.plan.status === 'operable' ? `OPERABLE ${r.plan.sizing.leverage}x margen ${f(r.plan.sizing.margin)} riesgo ${f(r.plan.sizing.realRiskUSDT)} R:R ${r.plan.rrTp1.toFixed(2)}` : 'no operable en tu fase';
    tally[r.kind === 'discarded' ? r.code : r.plan.status] = (tally[r.kind === 'discarded' ? r.code : r.plan.status] ?? 0) + 1;
    if (r.kind === 'plan' && r.plan.status === 'operable') lastPlan = planToText(r.plan, filters);
    console.log(`  ${new Date(t + 1).toISOString().slice(0, 16)} ${sig.direction.toUpperCase().padEnd(5)} ${SETUP_LABEL[sig.setup].padEnd(36)} conf ${sig.confidence.padEnd(5)} → ${res}`);
  }
}
console.log(`Total: ${count}`, tally);
if (lastPlan) console.log('\nÚltimo plan operable:\n' + lastPlan);
