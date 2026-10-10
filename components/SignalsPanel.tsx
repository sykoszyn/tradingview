'use client';
import { useMemo, useState } from 'react';
import type { AppConfig } from '@/lib/config/defaults';
import type { Interval, Market, TradingSymbol } from '@/lib/types';
import { SYMBOLS } from '@/lib/types';
import type { TradePlan } from '@/lib/plan/plan';
import { INTERVAL_MS } from '@/lib/data/providers';
import { SOURCE_LABEL } from '@/lib/data/client';
import { isSetupAllowed, type BacktestSummary } from '@/lib/backtest/summary';
import { newsVerdict } from '@/lib/risk/news';
import { riskLimitStatus, type LimitTrade } from '@/lib/risk/limits';
import { realNetPnl } from '@/lib/journal/real';
import { isActive } from '@/lib/journal/paper';
import type { JournalData } from '@/lib/journal/types';
import type { PhaseView } from '@/lib/risk/phases';
import type { MarketMeta } from '@/hooks/useMarketMeta';
import type { useLiveSignals } from '@/hooks/useLiveSignals';
import { useChartCandles } from '@/hooks/useChartCandles';
import { PriceChart } from './PriceChart';
import { SignalCard, type SignalFlags } from './SignalCard';

const n = (v: number, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function SignalsPanel(props: {
  symbol: TradingSymbol;
  market: Market;
  interval: Interval;
  cfg: AppConfig;
  meta: MarketMeta;
  live: ReturnType<typeof useLiveSignals>;
  journal: JournalData;
  phase: PhaseView;
  backtest: BacktestSummary | null;
  livePrice?: number;
  onSimulate: (p: TradePlan) => void;
  onRegisterReal: (p: TradePlan) => void;
}) {
  const { symbol, market, interval, cfg, live, journal, phase } = props;
  const chart = useChartCandles(symbol, market, interval);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scan = live.scans[symbol];
  const now = Date.now();

  const limitTrades: LimitTrade[] = phase.isReal
    ? journal.real.map((t) => ({ openedAt: t.openedAt, closedAt: t.closedAt, netPnl: realNetPnl(t) }))
    : journal.paper.filter((t) => !t.auto).map((t) => ({ openedAt: t.createdAt, closedAt: t.result?.exitTime, netPnl: t.result?.netPnl }));
  const limits = riskLimitStatus(limitTrades, now, cfg);

  const plans = scan?.active ?? [];
  const flagsFor = (p: TradePlan): SignalFlags => {
    let suggestion: string | undefined;
    if (p.status !== 'operable') {
      const other = SYMBOLS.filter((s) => s !== p.symbol)
        .flatMap((s) => live.scans[s]?.active ?? [])
        .find((o) => o.setup === p.setup && o.status === 'operable');
      suggestion = other
        ? `Sugerencia: hay una señal válida del mismo setup en ${other.symbol} (entrada ${n(other.entry)}), operable en tu fase.`
        : undefined;
    }
    return {
      hiddenByBacktest: !isSetupAllowed(props.backtest, p.setup, p.symbol, p.market),
      news: newsVerdict([p.signalTime, now], p.market, journal.news, cfg),
      positionOpen: journal.paper.some((t) => !t.auto && isActive(t) && t.plan.symbol === p.symbol && t.plan.id !== p.id),
      simulated: journal.paper.some((t) => t.plan.id === p.id && !t.auto),
      isRealPhase: phase.isReal,
      suggestion,
    };
  };
  const visible = plans.filter((p) => !flagsFor(p).hiddenByBacktest);
  const hidden = plans.filter((p) => flagsFor(p).hiddenByBacktest);
  const selected = plans.find((p) => p.id === selectedId) ?? visible[0] ?? hidden[0] ?? null;
  const sel = scan?.context?.selection;
  const trend = scan?.context?.trend;

  const intervalMs = INTERVAL_MS[interval];
  const markers = useMemo(() => plans, [plans]);

  return (
    <div className="space-y-3">
      <PriceChart
        candles={chart.candles}
        zonesAbove={sel?.above ?? []}
        zonesBelow={sel?.below ?? []}
        plans={markers}
        selected={selected}
        livePrice={props.livePrice}
        intervalMs={intervalMs}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>Fuente: {scan ? SOURCE_LABEL[scan.source] : chart.source ? SOURCE_LABEL[chart.source] : '…'}</span>
        <span>
          {live.updatedAt ? `Actualizado ${new Date(live.updatedAt).toLocaleTimeString('es-AR')}` : 'Cargando…'} ·{' '}
          <button className="text-sky-400 underline" onClick={() => void live.refresh()}>
            actualizar
          </button>
        </span>
      </div>
      {chart.error && <ErrorBox>Gráfico: {chart.error}</ErrorBox>}

      <div className="card grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-[11px] text-slate-400">Tendencia 4h</div>
          <div className={trend?.trend === 'alcista' ? 'text-emerald-400' : trend?.trend === 'bajista' ? 'text-rose-400' : 'text-slate-200'}>
            {trend ? trend.trend.toUpperCase() : '—'}
          </div>
          {trend && <div className="text-[11px] text-slate-500">{trend.explanation}</div>}
        </div>
        <div className="space-y-0.5 text-xs">
          {trend && (
            <>
              <div>EMA {cfg.analysis.emaFast}: {n(trend.emaFast)}</div>
              <div>EMA {cfg.analysis.emaSlow}: {n(trend.emaSlow)}</div>
              <div>VWAP diario: {Number.isFinite(trend.vwap) ? n(trend.vwap) : '—'}</div>
            </>
          )}
          {scan?.fundingRate !== undefined && <div>Funding: {(scan.fundingRate * 100).toFixed(4)}%</div>}
        </div>
        <div className="col-span-2 grid grid-cols-2 gap-2 text-xs">
          <ZoneList title="Resistencias" zones={sel?.above ?? []} tone="red" />
          <ZoneList title="Soportes" zones={sel?.below ?? []} tone="green" />
        </div>
      </div>

      {live.errors.map((e) => (
        <ErrorBox key={e}>{e}</ErrorBox>
      ))}

      {limits.blocked ? (
        <div className="rounded-xl border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-100">
          <b>Límite de riesgo alcanzado: no se muestran señales nuevas.</b>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {limits.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <h2 className="text-sm font-semibold">
            Señales activas en {symbol} {market === 'futures' ? 'futuros' : 'spot'} ({visible.length})
          </h2>
          {live.loading && !scan && <div className="card text-sm text-slate-400">Analizando…</div>}
          {scan && !visible.length && (
            <div className="card text-sm text-slate-400">
              No hay señales esperando entrada. Se evalúan solo velas de {cfg.analysis.signalTimeframe} cerradas
              {scan.lastSignalCandle ? ` (última: ${new Date(scan.lastSignalCandle.closeTime + 1).toLocaleString('es-AR', { timeZone: cfg.timezone })})` : ''}.
              {scan.discarded.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-xs">
                  {scan.discarded.map((d) => (
                    <li key={d.signal.id}>Descartada: {d.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {visible.map((p) => (
            <SignalCard
              key={p.id}
              plan={p}
              filters={props.meta.filters[market][symbol]}
              flags={flagsFor(p)}
              selected={selected?.id === p.id}
              onSelect={() => setSelectedId(p.id)}
              onSimulate={() => props.onSimulate(p)}
              onRegisterReal={() => props.onRegisterReal(p)}
            />
          ))}
          {hidden.length > 0 && (
            <details className="card">
              <summary className="cursor-pointer text-sm text-slate-300">Ocultas por el backtest («no usar»): {hidden.length} · podés simularlas igual</summary>
              <div className="mt-2 space-y-2">
                {hidden.map((p) => (
                  <SignalCard
                    key={p.id}
                    plan={p}
                    filters={props.meta.filters[market][symbol]}
                    flags={flagsFor(p)}
                    selected={selected?.id === p.id}
                    onSelect={() => setSelectedId(p.id)}
                    onSimulate={() => props.onSimulate(p)}
                    onRegisterReal={() => props.onRegisterReal(p)}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function ZoneList({ title, zones, tone }: { title: string; zones: Array<{ id: string; low: number; high: number; touches: number }>; tone: 'red' | 'green' }) {
  return (
    <div>
      <div className={`mb-0.5 text-[11px] ${tone === 'red' ? 'text-rose-300' : 'text-emerald-300'}`}>{title}</div>
      {zones.length ? (
        zones.map((z) => (
          <div key={z.id} className="font-mono">
            {n(z.low)}–{n(z.high)} <span className="text-slate-500">({z.touches} toques)</span>
          </div>
        ))
      ) : (
        <div className="text-slate-500">—</div>
      )}
    </div>
  );
}

export const ErrorBox = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-rose-800 bg-rose-950/60 p-2 text-xs text-rose-200">{children}</div>
);
