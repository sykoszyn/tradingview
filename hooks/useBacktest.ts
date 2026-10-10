'use client';
// Orquesta el backtest: descarga el historial (con la cadena de fuentes), corre
// el Web Worker, pide velas de 1m para las velas ambiguas y vuelve a correr.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfig } from '@/lib/config/defaults';
import type { BracketSet, Candle, FundingRatePoint, Market, SymbolFilters, TradingSymbol } from '@/lib/types';
import { fetchFunding, fetchKlines } from '@/lib/data/client';
import { fetchFundingRange, fetchKlineRange, fetchMinuteWindows, type FundingPager, type KlinePager } from '@/lib/backtest/history';
import type { BacktestDataset, BacktestResult } from '@/lib/backtest/run';
import { buildReport } from '@/lib/backtest/report';
import { makeSummary, type BacktestSummary } from '@/lib/backtest/summary';
import { safeStorage } from '@/lib/storage/safe-storage';
import type { WorkerRequest, WorkerResponse } from '@/workers/backtest.worker';

const DAY = 86_400_000;
export const SUMMARY_KEY = 'cpa.backtest.summary.v1';

export const pager: KlinePager = async (q) =>
  (await fetchKlines(q.symbol, q.market, q.interval, { startTime: q.startTime, limit: q.limit })).data as Candle[];
export const fpager: FundingPager = async (q) => (await fetchFunding(q.symbol, { startTime: q.startTime, limit: q.limit })).data as FundingRatePoint[];

export interface BacktestRun {
  result: BacktestResult;
  from: number;
  to: number;
  sources: string[];
}

export function runWorker(req: WorkerRequest, onProgress: (v: number) => void): Promise<BacktestResult> {
  return callWorker(req, onProgress).then((m) => {
    if (m.type !== 'done') throw new Error('Respuesta inesperada del Worker');
    return m.result;
  });
}

export function callWorker(req: WorkerRequest, onProgress: (v: number) => void = () => {}): Promise<Exclude<WorkerResponse, { type: 'progress' | 'error' }>> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../workers/backtest.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.value);
      else {
        w.terminate();
        if (m.type === 'error') reject(new Error(m.message));
        else resolve(m);
      }
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'Error en el Web Worker'));
    };
    w.postMessage(req);
  });
}

export function useBacktest() {
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => setSummary(safeStorage.getJSON<BacktestSummary>(SUMMARY_KEY)), []);

  const start = useCallback(
    async (opts: {
      combos: Array<[TradingSymbol, Market]>;
      months: number;
      cfg: AppConfig;
      filters: Record<Market, Partial<Record<TradingSymbol, SymbolFilters>>>;
      brackets: Record<TradingSymbol, BracketSet> | null;
    }) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      setProgress(0);
      try {
        const to = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 1;
        const from = to - opts.months * 30.4 * DAY;
        const warm = from - 70 * DAY;
        const datasets: BacktestDataset[] = [];
        let pages = 0;
        for (const [symbol, market] of opts.combos) {
          const f = opts.filters[market][symbol];
          if (!f) throw new Error(`Faltan los mínimos de ${symbol} ${market}: no se puede correr el backtest sin exchangeInfo.`);
          const tick = () => setStatus(`Descargando ${symbol} ${market === 'futures' ? 'futuros' : 'spot'}… (${++pages} páginas)`);
          const c1h = await fetchKlineRange(pager, symbol, market, '1h', warm, to, tick);
          const c4h = await fetchKlineRange(pager, symbol, market, '4h', warm - 40 * DAY, to, tick);
          const c15m = await fetchKlineRange(pager, symbol, market, '15m', from, to, tick);
          const funding = market === 'futures' ? await fetchFundingRange(fpager, symbol, warm, to) : [];
          datasets.push({ symbol, market, c1h, c4h, c15m, funding, filters: f, brackets: market === 'futures' ? opts.brackets?.[symbol] : undefined });
        }
        const bt = { from, to, cfg: opts.cfg, phase: opts.cfg.phases.phase2, maxHoldHours: 168 };
        setStatus('Calculando (pasada 1)…');
        let result = await runWorker({ type: 'run', datasets, opts: bt }, setProgress);
        if (result.unresolved.length) {
          setStatus(`Resolviendo ${result.unresolved.length} velas ambiguas con velas de 1m…`);
          for (const ds of datasets) {
            const w = result.unresolved.filter((u) => u.symbol === ds.symbol && u.market === ds.market);
            if (w.length) ds.m1 = await fetchMinuteWindows(pager, ds.symbol, ds.market, w);
          }
          setStatus('Calculando (pasada 2)…');
          result = await runWorker({ type: 'run', datasets, opts: bt }, setProgress);
        }
        const { rows, overall } = buildReport(result, 'r');
        const s = makeSummary(rows, overall, from, to);
        safeStorage.setJSON(SUMMARY_KEY, s);
        setSummary(s);
        setRun({ result, from, to, sources: [] });
        setStatus(null);
      } catch (e) {
        setError((e as Error).message);
        setStatus(null);
      } finally {
        busy.current = false;
      }
    },
    [],
  );

  return { run, summary, status, progress, error, start, running: status !== null };
}
