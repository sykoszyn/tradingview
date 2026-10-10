'use client';
import { useState } from 'react';
import type { Interval, Market, TradingSymbol } from '@/lib/types';
import { SYMBOLS } from '@/lib/types';
import type { TradePlan } from '@/lib/plan/plan';
import { sanitizeConfig } from '@/lib/config/schema';
import { STRATEGIES, strategyStatus } from '@/lib/strategies/registry';
import type { StrategyId } from '@/lib/strategies/patches';
import { useConfig } from '@/hooks/useConfig';
import { useMarketMeta } from '@/hooks/useMarketMeta';
import { useLivePrice } from '@/hooks/useLivePrice';
import { useBacktest } from '@/hooks/useBacktest';
import { useJournal } from '@/hooks/useJournal';
import { usePaperEngine } from '@/hooks/usePaperEngine';
import { usePhases } from '@/hooks/usePhases';
import { useLiveSignals } from '@/hooks/useLiveSignals';
import { Disclaimer } from './Disclaimer';
import { BacktestPanel } from './BacktestPanel';
import { SignalsPanel, ErrorBox } from './SignalsPanel';
import { JournalPanel } from './JournalPanel';
import { PhasesPanel } from './PhasesPanel';
import { SettingsPanel } from './SettingsPanel';

const TABS = ['Señales', 'Backtest', 'Diario', 'Fases', 'Configuración'] as const;
type Tab = (typeof TABS)[number];

export function AppShell() {
  const [tab, setTab] = useState<Tab>('Señales');
  const [symbol, setSymbol] = useState<TradingSymbol>('ETHUSDT');
  const [market, setMarket] = useState<Market>('futures');
  const [interval, setIntervalSel] = useState<Interval>('4h');
  const [draftPlan, setDraftPlan] = useState<TradePlan | null>(null);
  const { config, setConfig, reset, corrections } = useConfig();
  const meta = useMarketMeta();
  const live = useLivePrice(symbol, market);
  const bt = useBacktest();
  const journal = useJournal();
  const engine = usePaperEngine(journal, config, meta);
  const phases = usePhases(journal, config, bt.summary, engine.live);
  const signals = useLiveSignals(market, config, meta, phases.view?.limits ?? null);
  const strat = STRATEGIES[config.strategyId as StrategyId];
  const noEdge = strat && strategyStatus(strat) !== 'validada';
  // Si el WebSocket no conecta, se muestra el último cierre de 1h como referencia.
  const lastClose = signals.scans[symbol]?.c1h.at(-1)?.close;
  const shownPrice = live.tick?.price ?? lastClose;
  const showLiveNotice = !!engine.live?.passed && !journal.data?.notifiedLiveValidation;

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="sticky top-0 z-30 space-y-2 border-b border-slate-800 bg-slate-950/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="flex items-start justify-between gap-2">
          <button className="text-left" onClick={() => setTab('Fases')}>
            <div className="flex items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${phases.view?.isReal ? 'bg-emerald-700' : 'bg-slate-700'}`}>
                FASE {phases.view?.phase ?? 0}
              </span>
              <span className="text-sm font-semibold">{phases.view?.name ?? 'Backtest'}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              {phases.view?.isReal ? `Real: hasta ${phases.view.limits.maxMarginUSDT} USDT · ${phases.view.limits.maxLeverage}x · aislado` : 'Práctica: solo análisis y simulación'}
            </div>
          </button>
          <div className="text-right text-xs">
            <div className="font-mono text-base">{shownPrice ? shownPrice.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : '—'}</div>
            <div className="text-slate-400">
              {live.tick ? live.status : lastClose ? 'último cierre 1h (sin WebSocket)' : live.status}
              {live.tick?.markPrice ? ` · mark ${live.tick.markPrice.toLocaleString('es-AR', { maximumFractionDigits: 2 })}` : ''}
            </div>
          </div>
        </div>
        {noEdge && (
          <button onClick={() => setTab('Fases')} className="block w-full rounded-md bg-amber-950/70 px-2 py-1 text-left text-[11px] text-amber-200">
            ⚠ Estrategia «{strat.name}»: sin ventaja demostrada (validación fuera de muestra fallida). Usala para analizar y practicar.
          </button>
        )}
        <div className="grid grid-cols-3 gap-2">
          <select className="input" aria-label="Par" value={symbol} onChange={(e) => setSymbol(e.target.value as TradingSymbol)}>
            {SYMBOLS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="input" aria-label="Mercado" value={market} onChange={(e) => setMarket(e.target.value as Market)}>
            <option value="futures">Futuros</option>
            <option value="spot">Spot</option>
          </select>
          <select className="input" aria-label="Temporalidad" value={interval} onChange={(e) => setIntervalSel(e.target.value as Interval)}>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
          </select>
        </div>
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`btn shrink-0 px-2.5 ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 space-y-3 p-3 pb-6">
        {showLiveNotice && (
          <div className="rounded-xl border border-emerald-700 bg-emerald-950/50 p-3 text-sm text-emerald-100">
            <b>La validación en vivo cumple el criterio</b> (30+ trades, expectativa &gt; +0,15 R y le gana al azar). Revisá la pestaña Fases: habilitar la
            Fase 2 requiere tu confirmación.
            <div className="mt-2 flex gap-2">
              <button className="btn-primary" onClick={() => setTab('Fases')}>
                Ver Fases
              </button>
              <button className="btn-ghost" onClick={() => journal.update((j) => ({ ...j, notifiedLiveValidation: Date.now() }))}>
                Entendido
              </button>
            </div>
          </div>
        )}
        {meta.errors.map((e) => (
          <ErrorBox key={e}>{e}</ErrorBox>
        ))}
        {engine.error && <ErrorBox>{engine.error}</ErrorBox>}

        {!journal.data || !phases.view ? (
          <div className="card text-sm text-slate-400">Cargando…</div>
        ) : (
          <>
            {tab === 'Señales' && (
              <SignalsPanel
                symbol={symbol}
                market={market}
                interval={interval}
                cfg={config}
                meta={meta}
                live={signals}
                journal={journal.data}
                phase={phases.view}
                backtest={bt.summary}
                livePrice={live.tick?.price}
                onSimulate={(p) => engine.simulate(p)}
                onRegisterReal={(p) => {
                  setDraftPlan(p);
                  setTab('Diario');
                }}
              />
            )}
            {tab === 'Backtest' && <BacktestPanel cfg={config} meta={meta} bt={bt} />}
            {tab === 'Diario' && (
              <JournalPanel
                journal={journal}
                cfg={config}
                phase={phases.view.phase}
                draftPlan={draftPlan}
                clearDraft={() => setDraftPlan(null)}
                onConfigImport={(c) => setConfig(sanitizeConfig(c).config)}
                engineStatus={engine.status}
              />
            )}
            {tab === 'Fases' && (
              <PhasesPanel
                view={phases.view}
                history={phases.history}
                live={engine.live}
                cfg={config}
                onConfirm={phases.confirm}
                onComputeRandom={() => void engine.computeLiveRandom()}
                busy={!!engine.status}
              />
            )}
            {tab === 'Configuración' && (
              <SettingsPanel cfg={config} setConfig={setConfig} reset={reset} corrections={corrections} meta={meta} phase={phases.view} journal={journal} />
            )}
          </>
        )}
      </main>
      <Disclaimer />
    </div>
  );
}
