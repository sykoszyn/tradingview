// Experimento con historial separado (ver docs/nuevas-estrategias.md):
//  - AJUSTE: hasta el corte (los datos se recortan: nada posterior entra).
//  - VALIDACIÓN: desde el corte, UNA sola vez por estrategia, con reglas ya cerradas
//    y commiteadas. El corte es el fin de la última validación registrada (los datos
//    ya validados no se reutilizan para validar), o cache.from + 8 meses la primera vez.
// Uso:
//   BT_CACHE=datos.json npm run experiment -- tune base a1 c zonas-4h a1+c …
//   BT_CACHE=datos.json npm run experiment -- validate <id del registro>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BASE_CONFIG, type AppConfig } from '../lib/config/defaults';
import { sanitizeConfig } from '../lib/config/schema';
import { makeFetchJson, resolveResource } from '../lib/data/market-service';
import { fetchMinuteWindows, type KlinePager } from '../lib/backtest/history';
import { runBacktest, type BacktestDataset, type BacktestOptions } from '../lib/backtest/run';
import { computeStats } from '../lib/backtest/metrics';
import { compareWithRandom } from '../lib/backtest/random';
import { latestValidationEnd, STRATEGIES } from '../lib/strategies/registry';
import { applyPatch, STRATEGY_PATCHES, type StrategyId } from '../lib/strategies/patches';
import type { Candle } from '../lib/types';

const DAY = 86_400_000;
const [mode, ...names] = process.argv.slice(2);
const cachePath = process.env.BT_CACHE!;
if (!cachePath) throw new Error('Definí BT_CACHE (archivo creado con BT_CACHE=… npm run backtest)');

/** Variantes de la familia "zonas" (sobre la base de 1h) usadas en el experimento original. */
export const VARIANTS: Record<string, object> = {
  base: {},
  a1: { plan: { stopMode: 'atr', atrMultiplier: 1 } },
  a15: { plan: { stopMode: 'atr', atrMultiplier: 1.5 } },
  b: { analysis: { counterTrendMode: 'withTrendOnly' } },
  c: { analysis: { signalTimeframe: '4h' } },
  d: { analysis: { minZoneTouches: 3 } },
};

function merge(a: any, b: any): any {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return out;
}
export function variantConfig(name: string): AppConfig {
  if (name in STRATEGY_PATCHES) return applyPatch(BASE_CONFIG, name as StrategyId);
  const patch = name.split('+').reduce((acc, n) => {
    if (!VARIANTS[n]) throw new Error(`Variante desconocida: ${n}`);
    return merge(acc, VARIANTS[n]);
  }, {});
  const { corrections } = sanitizeConfig(merge(BASE_CONFIG, patch));
  if (corrections.some((c) => !c.includes('Estrategia'))) throw new Error(corrections.join(' '));
  return merge(BASE_CONFIG, patch) as AppConfig;
}

const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { datasets: BacktestDataset[]; range: { from: number; to: number } };
const lastVal = latestValidationEnd();
const split = Number(process.env.VALIDATION_FROM ?? (lastVal > cached.range.from ? lastVal : cached.range.from + 8 * 30.4 * DAY));
const fetchJson = makeFetchJson();
const pager: KlinePager = async (q) =>
  (await resolveResource({ resource: 'klines', provider: 'binance', market: q.market, symbol: q.symbol, interval: q.interval, startTime: q.startTime, limit: q.limit }, fetchJson, 'server')).data as Candle[];

const cut = (d: BacktestDataset, t: number): BacktestDataset => ({
  ...d,
  c1h: d.c1h.filter((c) => c.closeTime <= t),
  c4h: d.c4h.filter((c) => c.closeTime <= t),
  c15m: d.c15m.filter((c) => c.closeTime <= t),
  funding: d.funding.filter((f) => f.fundingTime <= t),
  m1: {},
});

async function run(datasets: BacktestDataset[], o: BacktestOptions) {
  let res = runBacktest(datasets, o);
  if (res.unresolved.length) {
    for (const ds of datasets) {
      const w = res.unresolved.filter((u) => u.symbol === ds.symbol && u.market === ds.market && u.to <= o.to);
      if (w.length) ds.m1 = { ...(ds.m1 ?? {}), ...(await fetchMinuteWindows(pager, ds.symbol, ds.market, w)) };
    }
    res = runBacktest(datasets, o);
  }
  return res;
}

const f = (v: number, d = 3) => (v >= 0 ? '+' : '') + v.toFixed(d);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);

async function evaluate(name: string, datasets: BacktestDataset[], from: number, to: number) {
  const cfg = variantConfig(name);
  const o: BacktestOptions = { from, to, cfg, phase: cfg.phases.phase2, maxHoldHours: 168 };
  const res = await run(datasets, o);
  const tr = res.trades.filter((t) => t.track === 'r');
  const s = computeStats(tr);
  const rnd = compareWithRandom(datasets, res.trades, o, s.expectancyR, 100);
  const beats = s.trades > 0 && s.expectancyR > rnd.p95ExpectancyR;
  const bySymbol = ['ETHUSDT futures', 'BTCUSDT futures', 'ETHUSDT spot', 'BTCUSDT spot'].map((k) => {
    const st = computeStats(tr.filter((t) => `${t.symbol} ${t.market}` === k));
    return `${k}: ${st.trades} tr ${f(st.expectancyR, 2)}R`;
  });
  return { name, s, rnd, beats, bySymbol, res };
}

if (mode === 'tune') {
  console.log(`AJUSTE: ${day(cached.range.from)} → ${day(split)} (los datos se recortan en el corte)`);
  const tuning = cached.datasets.map((d) => cut(d, split));
  console.log('Variante        Trades Acierto   R:R   Exp R  Tot R   DD R | Azar: media   p5    p95   p-val | ¿Le gana al azar?');
  for (const name of names) {
    const r = await evaluate(name, tuning.map((d) => ({ ...d })), cached.range.from, split);
    console.log(
      `${name.padEnd(15)} ${String(r.s.trades).padStart(6)} ${((r.s.winRate * 100).toFixed(0) + '%').padStart(7)} ${r.s.avgRR.toFixed(2).padStart(5)} ${f(r.s.expectancyR).padStart(7)} ${r.s.totalR.toFixed(1).padStart(6)} ${r.s.maxDrawdownR.toFixed(1).padStart(6)} | ${f(r.rnd.meanExpectancyR).padStart(11)} ${f(r.rnd.p5ExpectancyR).padStart(6)} ${f(r.rnd.p95ExpectancyR).padStart(6)} ${r.rnd.pValue.toFixed(2).padStart(6)} | ${r.beats ? 'SÍ' : 'no'}`,
    );
    console.log(`                ${r.bySymbol.join(' · ')}`);
  }
} else if (mode === 'validate') {
  const name = names[0];
  if (!(name in STRATEGIES)) throw new Error(`"${name}" no está en lib/strategies/registry.ts: registrá la estrategia (con sus reglas cerradas) antes de validar.`);
  const lockPath = new URL(`../lib/strategies/validations/${name}.json`, import.meta.url);
  if (existsSync(lockPath)) throw new Error(`La validación de ${name} ya se corrió. Por protocolo no se vuelve a correr.`);
  if (split < lastVal) throw new Error('El período de validación se superpone con datos ya usados para validar.');
  if (cached.range.to - split < 60 * DAY) throw new Error('Hacen falta al menos 60 días de datos nuevos después del corte para validar. Descargá datos más recientes.');
  const frozen = variantConfig(name);
  writeFileSync(lockPath, JSON.stringify({ startedAt: new Date().toISOString(), variant: name, config: frozen }, null, 2));
  console.log(`VALIDACIÓN (única): ${day(split)} → ${day(cached.range.to)} · variante ${name}`);
  const r = await evaluate(name, cached.datasets.map((d) => ({ ...d, m1: {} })), split, cached.range.to);
  const s = r.s;
  const ok = s.trades >= 30 && s.expectancyR > 0.15;
  const out = {
    variant: name,
    period: { from: split, to: cached.range.to },
    trades: s.trades,
    winRate: s.winRate,
    avgRR: s.avgRR,
    expectancyR: s.expectancyR,
    totalR: s.totalR,
    maxDrawdownR: s.maxDrawdownR,
    liquidations: s.liquidations,
    random: r.rnd,
    beatsRandom: r.beats,
    bySymbol: r.bySymbol,
    criterion: 'expectativa > +0,15 R con al menos 30 trades',
    passed: ok,
  };
  writeFileSync(lockPath, JSON.stringify({ ...JSON.parse(readFileSync(lockPath, 'utf8')), result: out }, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(ok ? 'CUMPLE el criterio de éxito.' : 'NO cumple el criterio de éxito.');
} else throw new Error('Modo: tune | validate');
