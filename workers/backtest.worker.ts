/// <reference lib="webworker" />
// Corre el backtest y la línea base al azar fuera del hilo principal.
import { runBacktest, type BacktestDataset, type BacktestOptions, type BtTrade } from '../lib/backtest/run';
import { compareWithRandom, type RandomComparison } from '../lib/backtest/random';

export type WorkerRequest =
  | { type: 'run'; datasets: BacktestDataset[]; opts: BacktestOptions }
  | { type: 'random'; datasets: BacktestDataset[]; opts: BacktestOptions; trades: BtTrade[]; expectancyR: number; runs: number };
export type WorkerResponse =
  | { type: 'progress'; value: number }
  | { type: 'done'; result: ReturnType<typeof runBacktest> }
  | { type: 'random-done'; comparison: RandomComparison }
  | { type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'run') {
      const result = runBacktest(msg.datasets, msg.opts, (value) => self.postMessage({ type: 'progress', value } satisfies WorkerResponse));
      self.postMessage({ type: 'done', result } satisfies WorkerResponse);
    } else if (msg.type === 'random') {
      const comparison = compareWithRandom(msg.datasets, msg.trades, msg.opts, msg.expectancyR, msg.runs);
      self.postMessage({ type: 'random-done', comparison } satisfies WorkerResponse);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse);
  }
};
