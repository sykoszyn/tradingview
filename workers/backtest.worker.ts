/// <reference lib="webworker" />
// Corre el backtest fuera del hilo principal para no congelar la interfaz.
import { runBacktest, type BacktestDataset, type BacktestOptions } from '../lib/backtest/run';

export type WorkerRequest = { type: 'run'; datasets: BacktestDataset[]; opts: BacktestOptions };
export type WorkerResponse =
  | { type: 'progress'; value: number }
  | { type: 'done'; result: ReturnType<typeof runBacktest> }
  | { type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'run') return;
  try {
    const result = runBacktest(msg.datasets, msg.opts, (value) => self.postMessage({ type: 'progress', value } satisfies WorkerResponse));
    self.postMessage({ type: 'done', result } satisfies WorkerResponse);
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse);
  }
};
