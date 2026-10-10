'use client';
import { useState } from 'react';
import type { Interval, Market, TradingSymbol } from '@/lib/types';
import { SYMBOLS } from '@/lib/types';
import { useConfig } from '@/hooks/useConfig';
import { useMarketMeta } from '@/hooks/useMarketMeta';
import { useLivePrice } from '@/hooks/useLivePrice';
import { Disclaimer } from './Disclaimer';
import { MinimumsTable } from './MinimumsTable';
import { BacktestPanel } from './BacktestPanel';
import { useBacktest } from '@/hooks/useBacktest';

const TABS = ['Señales', 'Backtest', 'Diario', 'Fases', 'Configuración'] as const;
type Tab = (typeof TABS)[number];

export function AppShell() {
  const [tab, setTab] = useState<Tab>('Señales');
  const [symbol, setSymbol] = useState<TradingSymbol>('ETHUSDT');
  const [market, setMarket] = useState<Market>('futures');
  const [interval, setInterval] = useState<Interval>('1h');
  const { config } = useConfig();
  const meta = useMarketMeta();
  const live = useLivePrice(symbol, market);
  const bt = useBacktest();
  const phaseLimits = config.phases.phase2;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-30 space-y-2 border-b border-slate-800 bg-slate-950/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Fase 0 · Backtest</div>
          <div className="text-right text-xs">
            <div className="font-mono text-base">{live.tick ? live.tick.price.toLocaleString('es-AR') : '—'}</div>
            <div className="text-slate-400">{live.status}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select className="input" value={symbol} onChange={(e) => setSymbol(e.target.value as TradingSymbol)}>
            {SYMBOLS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="input" value={market} onChange={(e) => setMarket(e.target.value as Market)}>
            <option value="futures">Futuros</option>
            <option value="spot">Spot</option>
          </select>
          <select className="input" value={interval} onChange={(e) => setInterval(e.target.value as Interval)}>
            <option>15m</option>
            <option>1h</option>
            <option>4h</option>
          </select>
        </div>
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn shrink-0 ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 space-y-3 p-3">
        {meta.errors.map((e) => (
          <div key={e} className="rounded-lg border border-rose-800 bg-rose-950/60 p-2 text-xs text-rose-200">
            {e}
          </div>
        ))}
        {tab === 'Configuración' && (
          <>
            <MinimumsTable meta={meta} market="futures" phaseMaxMargin={phaseLimits.maxMarginUSDT} phaseMaxLev={phaseLimits.maxLeverage} />
            <MinimumsTable meta={meta} market="spot" phaseMaxMargin={phaseLimits.maxMarginUSDT} phaseMaxLev={1} />
            <div className="card text-xs text-slate-300">
              <h3 className="mb-1 text-sm font-semibold">Brackets de apalancamiento</h3>
              {meta.brackets
                ? SYMBOLS.map((s) => {
                    const b = meta.brackets![s];
                    const t = b.brackets[0];
                    return (
                      <div key={s} className="mb-1">
                        {s}: tramo 1 hasta {t.notionalCap.toLocaleString('es-AR')} USDT, MMR {(t.maintMarginRate * 100).toFixed(2)}% — fuente: {b.source}
                        {b.warning && <div className="text-amber-300">{b.warning}</div>}
                      </div>
                    );
                  })
                : 'Cargando…'}
            </div>
          </>
        )}
        {tab === 'Backtest' && <BacktestPanel cfg={config} meta={meta} bt={bt} />}
        {tab !== 'Configuración' && tab !== 'Backtest' && <div className="card text-sm text-slate-400">Sección «{tab}» en construcción.</div>}
      </main>
      <Disclaimer />
    </div>
  );
}
