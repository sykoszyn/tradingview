'use client';
import { useState } from 'react';
import type { SymbolFilters } from '@/lib/types';
import type { TradePlan } from '@/lib/plan/plan';
import { SETUP_LABEL } from '@/lib/analysis/setups';
import { executionChecklist, planToText } from '@/lib/plan/plan-text';
import { formatStep } from '@/lib/market/rounding';
import type { NewsVerdict } from '@/lib/risk/news';

const n = (v: number, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const time = (t: number) => new Date(t).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export interface SignalFlags {
  hiddenByBacktest: boolean;
  news: NewsVerdict;
  positionOpen: boolean;
  simulated: boolean;
  isRealPhase: boolean;
  suggestion?: string;
}

export function SignalCard({
  plan: p,
  filters,
  flags,
  selected,
  onSelect,
  onSimulate,
  onRegisterReal,
}: {
  plan: TradePlan;
  filters?: SymbolFilters;
  flags: SignalFlags;
  selected: boolean;
  onSelect: () => void;
  onSimulate: () => void;
  onRegisterReal: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const long = p.direction === 'long';
  const operable = p.status === 'operable';
  const blocked = flags.news.blocked;
  const step = filters ? Math.max(filters.stepSize, filters.marketStepSize) : 0.001;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planToText(p, filters));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copiá el plan:', planToText(p, filters));
    }
  };

  return (
    <div
      className={`card space-y-2 border-l-4 ${long ? 'border-l-emerald-500' : 'border-l-rose-500'} ${selected ? 'ring-1 ring-sky-500' : ''} ${blocked || flags.hiddenByBacktest ? 'opacity-80' : ''}`}
      onClick={onSelect}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${long ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>{long ? 'LONG' : 'SHORT'}</span>
        <span className="text-sm font-semibold">{p.symbol}</span>
        <span className="text-xs text-slate-400">{p.market === 'futures' ? 'Futuros' : 'Spot'}</span>
        <Tag tone={p.confidence === 'alta' ? 'green' : p.confidence === 'media' ? 'amber' : 'slate'}>Confianza {p.confidence}</Tag>
        {!operable && <Tag tone="red">No operable en tu fase</Tag>}
        {flags.hiddenByBacktest && <Tag tone="red">NO USAR (backtest)</Tag>}
        {flags.news.highRisk && <Tag tone="red">Riesgo alto</Tag>}
        {p.counterTrend && <Tag tone="amber">Contra tendencia</Tag>}
      </div>
      <div className="text-sm font-medium">{SETUP_LABEL[p.setup]}</div>
      <p className="text-sm text-slate-300">{p.explanation}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
        <Kv k="Entrada (limit)" v={n(p.entry)} />
        <Kv k="Válida hasta" v={n(p.entryLimit)} />
        <Kv k="Stop" v={`${n(p.stop)} (${n(p.stopDistancePct)}%)`} tone="red" />
        <Kv k="Vence" v={time(p.expiresAt)} />
        <Kv k={`TP1 (cerrar ${p.tp1ClosePct}%)`} v={n(p.tp1)} tone="green" />
        <Kv k="TP2" v={p.tp2 !== null ? n(p.tp2) : '—'} tone="green" />
        <Kv k="R:R neto TP1" v={`1:${p.rrTp1.toFixed(2)}`} />
        <Kv k="R:R neto TP2" v={p.rrTp2 !== null ? `1:${p.rrTp2.toFixed(2)}` : '—'} />
      </div>

      {operable ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-950/60 p-2 text-sm sm:grid-cols-4">
          <Kv k="Margen" v={`${n(p.sizing.margin)} USDT`} />
          <Kv k="Apalancamiento" v={`${p.sizing.leverage}x`} />
          <Kv k="Nocional" v={`${n(p.sizing.notional)} USDT`} />
          <Kv k="Cantidad" v={formatStep(p.sizing.qty, step)} />
          <Kv k="Si toca el stop" v={`−${n(p.pnl!.lossAtStop)} USDT`} tone="red" />
          <Kv k={`Ganancia TP1 (${p.tp1ClosePct}%)`} v={`+${n(p.pnl!.gainTp1Leg)} USDT`} tone="green" />
          <Kv k="Ganancia TP1+TP2" v={p.pnl!.gainTp2Total !== null ? `+${n(p.pnl!.gainTp2Total)} USDT` : '—'} tone="green" />
          <Kv k="Comisiones" v={`${n(p.pnl!.feeEntry + p.pnl!.feeStopExit, 3)} USDT`} />
          {p.liquidation && (
            <Kv k="Liquidación aprox." v={`${n(p.liquidation.price)} (${n(p.liquidation.distancePct)}%)`} tone="amber" />
          )}
          <Kv
            k="Mínimos del par"
            v={p.minimums.ok ? '✓ cantidad y nocional' : '✗ no cumple'}
            tone={p.minimums.ok ? 'green' : 'red'}
          />
        </div>
      ) : (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-2 text-sm text-rose-200">
          {p.sizing.reason} Margen mínimo necesario: <b>{n(p.sizing.requiredMargin)} USDT</b>.
          {flags.suggestion && <div className="mt-1 text-emerald-300">{flags.suggestion}</div>}
        </div>
      )}

      {p.funding && (
        <div className="text-xs text-slate-300">
          {p.funding.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
      {flags.news.message && <div className="text-xs text-rose-300">{flags.news.message}</div>}
      {!flags.isRealPhase && operable && (
        <div className="text-xs text-amber-300">Estás en fase de práctica: este tamaño es el de la Fase 2 y solo sirve para simular.</div>
      )}

      <button className="text-xs text-sky-400 underline" onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
        {open ? 'Ocultar detalle' : 'Ver invalidación, avisos y checklist'}
      </button>
      {open && (
        <div className="space-y-2 text-xs text-slate-300">
          <div>
            <b>Invalidación:</b> {p.invalidation}
          </div>
          {p.reasons.length > 0 && <div>Motivos: {p.reasons.join(' · ')}</div>}
          {p.warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-amber-200">
              {p.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {p.market === 'futures' && (
            <div>
              <b>Checklist de ejecución en Binance:</b>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                {executionChecklist(p).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
        <button className="btn-ghost" onClick={copy}>
          {copied ? '¡Copiado!' : 'Copiar plan'}
        </button>
        <button
          className="btn-primary"
          disabled={!operable || blocked || flags.positionOpen || flags.simulated}
          onClick={onSimulate}
          title={flags.positionOpen ? 'Ya tenés una posición simulada en este par' : undefined}
        >
          {flags.simulated ? 'Simulando…' : 'Simular este trade'}
        </button>
        <button className="btn-ghost" onClick={onRegisterReal}>
          Registrar trade real
        </button>
      </div>
      {flags.positionOpen && <div className="text-xs text-slate-400">Ya hay una posición simulada abierta en {p.symbol}: nunca dos a la vez en el mismo par.</div>}
    </div>
  );
}

function Tag({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'slate'; children: React.ReactNode }) {
  const c = { green: 'bg-emerald-900/60 text-emerald-200', amber: 'bg-amber-900/60 text-amber-200', red: 'bg-rose-900/70 text-rose-100', slate: 'bg-slate-800 text-slate-300' }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c}`}>{children}</span>;
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: 'green' | 'red' | 'amber' }) {
  const c = tone === 'green' ? 'text-emerald-300' : tone === 'red' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : '';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className={`font-mono text-[13px] ${c}`}>{v}</div>
    </div>
  );
}
