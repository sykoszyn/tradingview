'use client';
// Motor de paper trading en el navegador:
//  1) Avanza los trades simulados con velas de 1m cerradas (alcanza también el
//     tiempo en que la app estuvo cerrada) y calcula comisiones y funding.
//  2) Paper automático: simula todas las señales operables de la estrategia activa.
//  3) Cuando la muestra automática llega a 30 trades con expectativa > 0,15 R,
//     calcula la línea base al azar del mismo período (en el Web Worker).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig } from '@/lib/config/defaults';
import { SYMBOLS, type Candle, type FundingRatePoint, type Market, type TradingSymbol } from '@/lib/types';
import { fetchFunding, fetchKlines } from '@/lib/data/client';
import { prepareSeries } from '@/lib/analysis/context';
import { advancePaper, finalizePaper, isActive, newPaperTrade } from '@/lib/journal/paper';
import { autoKey, nextAutoPlan } from '@/lib/journal/auto-paper';
import { liveSample, liveValidationStatus, toBtTrades } from '@/lib/journal/live-validation';
import type { JournalData, PaperTrade } from '@/lib/journal/types';
import { fetchFundingRange, fetchKlineRange } from '@/lib/backtest/history';
import type { BacktestDataset } from '@/lib/backtest/run';
import type { MarketMeta } from './useMarketMeta';
import type { JournalApi } from './useJournal';
import { callWorker, fpager, pager } from './useBacktest';

const MARKETS: Market[] = ['futures', 'spot'];
const DAY = 86_400_000;

async function minuteCandlesSince(symbol: TradingSymbol, market: Market, since: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let start = since + 1;
  const now = Date.now();
  for (let page = 0; page < 30 && start < now; page++) {
    const r = await fetchKlines(symbol, market, '1m', { startTime: start, limit: 1000 });
    const closed = r.data.filter((c) => c.closeTime <= now && c.openTime >= start - 60_000);
    if (!closed.length) break;
    out.push(...closed);
    start = closed[closed.length - 1].closeTime + 1;
    if (r.data.length < 1000) break;
  }
  return out;
}

async function trackTrade(t: PaperTrade, cfg: AppConfig): Promise<PaperTrade> {
  let next = t;
  for (let guard = 0; guard < 5 && isActive(next); guard++) {
    const candles = await minuteCandlesSince(t.plan.symbol, t.plan.market, next.lastProcessed);
    if (!candles.length) break;
    next = advancePaper(next, candles, cfg);
    if (candles[candles.length - 1].closeTime >= Date.now() - 120_000) break;
  }
  if (!isActive(next) && !next.result) {
    let funding: FundingRatePoint[] = [];
    if (next.plan.market === 'futures' && next.sim.phase === 'closed' && next.sim.fillTime) {
      try {
        funding = (await fetchFunding(next.plan.symbol, { startTime: next.sim.fillTime, limit: 100 })).data;
      } catch {
        funding = [];
      }
    }
    next = finalizePaper(next, funding);
  }
  return next;
}

export function usePaperEngine(journal: JournalApi, cfg: AppConfig, meta: MarketMeta) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const dataRef = useRef<JournalData | null>(null);
  dataRef.current = journal.data;

  const tick = useCallback(async () => {
    const data = dataRef.current;
    if (!data || running.current) return;
    running.current = true;
    try {
      // 1) Seguimiento de trades activos.
      const active = data.paper.filter(isActive);
      if (active.length) setStatus(`Siguiendo ${active.length} trade(s) simulado(s)…`);
      const updated = new Map<string, PaperTrade>();
      for (const t of active) updated.set(t.id, await trackTrade(t, cfg));
      let paper = data.paper.map((t) => updated.get(t.id) ?? t);
      const cursor = { ...data.autoPaper.cursor };

      // 2) Paper automático (una posición por par y mercado).
      if (data.autoPaper.enabled) {
        for (const market of MARKETS)
          for (const symbol of SYMBOLS) {
            const filters = meta.filters[market][symbol];
            if (!filters || (market === 'futures' && !meta.brackets)) continue;
            const key = autoKey(symbol, market);
            if (paper.some((t) => isActive(t) && t.plan.symbol === symbol && t.plan.market === market)) continue;
            const now = Date.now();
            const [h1, h4] = await Promise.all([fetchKlines(symbol, market, '1h', { limit: 1000 }), fetchKlines(symbol, market, '4h', { limit: 1000 })]);
            const prepared = prepareSeries(h1.data.filter((c) => c.closeTime <= now), h4.data.filter((c) => c.closeTime <= now), cfg);
            for (let guard = 0; guard < 10; guard++) {
              const after = Math.max(cursor[key] ?? 0, data.autoPaper.since);
              const { plan, scannedUntil } = nextAutoPlan({
                prepared, cfg, symbol, market, filters, brackets: meta.brackets?.[symbol], phase: cfg.phases.phase2, after, now,
              });
              cursor[key] = Math.max(after, scannedUntil);
              if (!plan || paper.some((t) => t.plan.id === plan.id)) break;
              setStatus(`Paper automático: nueva señal en ${symbol} ${market}…`);
              const t = await trackTrade(newPaperTrade(plan, cfg.strategyId, true, now), cfg);
              paper = [...paper, t];
              if (isActive(t)) break;
              cursor[key] = Math.max(cursor[key], t.sim.phase === 'closed' ? t.sim.exitTime : 0);
            }
          }
      }
      journal.update((d) => ({
        ...d,
        paper: mergePaper(d.paper, paper),
        autoPaper: { ...d.autoPaper, cursor: { ...d.autoPaper.cursor, ...cursor } },
      }));
      setError(null);
    } catch (e) {
      setError(`Paper trading: ${(e as Error).message}`);
    } finally {
      running.current = false;
      setStatus(null);
    }
  }, [cfg, meta.filters, meta.brackets, journal]);

  useEffect(() => {
    if (!journal.data || meta.loading) return;
    void tick();
    const id = setInterval(() => void tick(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!journal.data, meta.loading, tick]);

  /** Línea base al azar para la muestra de validación en vivo. */
  const computeLiveRandom = useCallback(async () => {
    const data = dataRef.current;
    if (!data) return;
    const sample = liveSample(data.paper, cfg.strategyId);
    if (!sample.length) return;
    setStatus('Calculando la línea base al azar del período en vivo…');
    try {
      const from = Math.min(...sample.map((t) => t.plan.signalTime)) - 1;
      const to = Math.max(...sample.map((t) => t.result!.exitTime));
      const combos = [...new Set(sample.map((t) => `${t.plan.symbol}|${t.plan.market}`))].map((k) => k.split('|') as [TradingSymbol, Market]);
      const datasets: BacktestDataset[] = [];
      for (const [symbol, market] of combos) {
        const filters = meta.filters[market][symbol];
        if (!filters) continue;
        datasets.push({
          symbol, market, filters,
          c1h: await fetchKlineRange(pager, symbol, market, '1h', from - 70 * DAY, to),
          c4h: await fetchKlineRange(pager, symbol, market, '4h', from - 110 * DAY, to),
          c15m: await fetchKlineRange(pager, symbol, market, '15m', from, to),
          funding: market === 'futures' ? await fetchFundingRange(fpager, symbol, from, to) : [],
        });
      }
      const st = liveValidationStatus(data.paper, cfg.strategyId);
      const res = await callWorker({
        type: 'random', datasets, trades: toBtTrades(sample), expectancyR: st.expectancyR, runs: 100,
        opts: { from, to, cfg, phase: cfg.phases.phase2, maxHoldHours: 168 },
      });
      if (res.type === 'random-done')
        journal.update((d) => ({ ...d, liveValidation: { computedAt: Date.now(), strategyId: cfg.strategyId, trades: st.trades, expectancyR: st.expectancyR, comparison: res.comparison } }));
    } catch (e) {
      setError(`Línea base en vivo: ${(e as Error).message}`);
    } finally {
      setStatus(null);
    }
  }, [cfg, meta.filters, journal]);

  const live = journal.data ? liveValidationStatus(journal.data.paper, cfg.strategyId, journal.data.liveValidation) : null;
  useEffect(() => {
    if (live?.needsRandom && !running.current) void computeLiveRandom();
  }, [live?.needsRandom, computeLiveRandom]);

  const simulate = useCallback(
    (plan: PaperTrade['plan']) => {
      journal.update((d) => {
        if (d.paper.some((t) => t.plan.id === plan.id)) return d;
        return { ...d, paper: [...d.paper, newPaperTrade(plan, cfg.strategyId, false)] };
      });
      setTimeout(() => void tick(), 500);
    },
    [journal, cfg.strategyId, tick],
  );

  return { status, error, live, simulate, refresh: tick, computeLiveRandom };
}

/** Une el estado guardado con el calculado sin perder trades agregados mientras tanto. */
function mergePaper(saved: PaperTrade[], computed: PaperTrade[]): PaperTrade[] {
  const byId = new Map(computed.map((t) => [t.id, t]));
  const out = saved.map((t) => byId.get(t.id) ?? t);
  for (const t of computed) if (!saved.some((s) => s.id === t.id)) out.push(t);
  return out;
}
