// Backtest por consola con datos reales (misma lógica que el Web Worker de la app).
// Uso: npm run backtest -- [meses=12]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { sanitizeConfig } from '../lib/config/schema';
import { makeFetchJson, resolveResource } from '../lib/data/market-service';
import { fetchFundingRange, fetchKlineRange, fetchMinuteWindows, type FundingPager, type KlinePager } from '../lib/backtest/history';
import { runBacktest, type BacktestDataset } from '../lib/backtest/run';
import { reportToText, buildReport } from '../lib/backtest/report';
import type { BracketSet, Candle, FundingRatePoint, Market, SymbolFilters, TradingSymbol } from '../lib/types';

const months = Number(process.argv[2] ?? 12);
const out = process.argv[3];
const fetchJson = makeFetchJson();
const DAY = 86_400_000;
const to = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 1;
const from = to - months * 30.4 * DAY;
const warm = from - 70 * DAY;

const pager: KlinePager = async (q) =>
  (await resolveResource({ resource: 'klines', provider: 'binance', market: q.market, symbol: q.symbol, interval: q.interval, startTime: q.startTime, limit: q.limit }, fetchJson, 'server')).data as Candle[];
const fpager: FundingPager = async (q) =>
  (await resolveResource({ resource: 'funding', provider: 'binance', market: 'futures', symbol: q.symbol, startTime: q.startTime, limit: q.limit }, fetchJson, 'server')).data as FundingRatePoint[];

const combos: Array<[TradingSymbol, Market]> = [['ETHUSDT', 'futures'], ['BTCUSDT', 'futures'], ['ETHUSDT', 'spot'], ['BTCUSDT', 'spot']];
const info: Record<Market, Record<string, SymbolFilters>> = { spot: {}, futures: {} };
for (const m of ['spot', 'futures'] as const)
  info[m] = (await resolveResource({ resource: 'exchange-info', provider: 'binance', market: m, symbol: 'ETHUSDT' }, fetchJson, 'server')).data as Record<string, SymbolFilters>;
const brackets = (await resolveResource({ resource: 'brackets', provider: 'binance', market: 'futures', symbol: 'ETHUSDT' }, fetchJson, 'server')).data as Record<string, BracketSet>;

// BT_CACHE=archivo.json reutiliza los datos descargados; BT_CFG='{"plan":{"minStopPct":0.6}}' cambia parámetros.
const cachePath = process.env.BT_CACHE;
const cfg = sanitizeConfig(JSON.parse(process.env.BT_CFG ?? '{}')).config;
let datasets: BacktestDataset[] = [];
let range = { from, to };
if (cachePath && existsSync(cachePath)) {
  const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
  datasets = cached.datasets;
  range = cached.range;
  console.error(`Datos desde cache: ${cachePath}`);
} else for (const [symbol, market] of combos) {
  const t0 = Date.now();
  const [c1h, c4h, c15m, funding] = await Promise.all([
    fetchKlineRange(pager, symbol, market, '1h', warm, to),
    fetchKlineRange(pager, symbol, market, '4h', warm - 40 * DAY, to),
    fetchKlineRange(pager, symbol, market, '15m', from, to),
    market === 'futures' ? fetchFundingRange(fpager, symbol, warm, to) : Promise.resolve([]),
  ]);
  console.error(`${symbol} ${market}: 1h ${c1h.length} · 4h ${c4h.length} · 15m ${c15m.length} · funding ${funding.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  datasets.push({ symbol, market, c1h, c4h, c15m, funding, filters: info[market][symbol], brackets: market === 'futures' ? brackets[symbol] : undefined });
}

const opts = { from: range.from, to: range.to, cfg, phase: cfg.phases.phase2, maxHoldHours: 168 };
let t = Date.now();
let res = runBacktest(datasets, opts);
console.error(`Pasada 1: ${((Date.now() - t) / 1000).toFixed(1)} s · ventanas sin resolver: ${res.unresolved.length}`);
if (res.unresolved.length) {
  for (const ds of datasets) {
    const w = res.unresolved.filter((u) => u.symbol === ds.symbol && u.market === ds.market);
    if (w.length) ds.m1 = await fetchMinuteWindows(pager, ds.symbol, ds.market, w);
  }
  t = Date.now();
  res = runBacktest(datasets, opts);
  console.error(`Pasada 2 (con 1m): ${((Date.now() - t) / 1000).toFixed(1)} s · sin resolver: ${res.unresolved.length} · supuestos de stop: ${res.assumedWorst}`);
}
if (cachePath && !existsSync(cachePath)) writeFileSync(cachePath, JSON.stringify({ datasets, range }));
console.log(`Período: ${new Date(range.from).toISOString().slice(0, 10)} → ${new Date(range.to).toISOString().slice(0, 10)} · señales evaluadas: ${res.signalsEvaluated}`);
console.log(reportToText(res));
const disc: Record<string, number> = {};
for (const d of res.discards.filter((x) => x.track === 'usdt')) disc[d.code] = (disc[d.code] ?? 0) + 1;
console.log('\nDescartes (carril USDT):', disc);
const discR: Record<string, number> = {};
for (const d of res.discards.filter((x) => x.track === 'r')) discR[d.code] = (discR[d.code] ?? 0) + 1;
console.log('Descartes (carril R):', discR);
const nf: Record<string, number> = {};
for (const n of res.notFilled.filter((x) => x.track === 'r')) nf[n.outcome] = (nf[n.outcome] ?? 0) + 1;
console.log('No ejecutadas (carril R):', nf);
const oc: Record<string, number> = {};
for (const x of res.trades.filter((x) => x.track === 'r')) oc[x.outcome] = (oc[x.outcome] ?? 0) + 1;
console.log('Resultados (carril R):', oc);
if (out) writeFileSync(out, JSON.stringify({ ...range, res, reportR: buildReport(res, 'r').rows.map((r) => ({ ...r, stats: { ...r.stats, equity: undefined } })) }));
