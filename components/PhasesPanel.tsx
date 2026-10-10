'use client';
import type { AppConfig } from '@/lib/config/defaults';
import type { PhaseView } from '@/lib/risk/phases';
import type { LiveValidationStatus } from '@/lib/journal/live-validation';
import { LIVE_MIN_EXPECTANCY_R, LIVE_MIN_TRADES } from '@/lib/journal/live-validation';
import type { PhaseEvent } from '@/lib/journal/types';
import { edgeNote, STRATEGIES, strategyStatus } from '@/lib/strategies/registry';
import type { StrategyId } from '@/lib/strategies/patches';

const dt = (t: number) => new Date(t).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export function PhasesPanel({
  view,
  history,
  live,
  cfg,
  onConfirm,
  onComputeRandom,
  busy,
}: {
  view: PhaseView;
  history: PhaseEvent[];
  live: LiveValidationStatus | null;
  cfg: AppConfig;
  onConfirm: () => void;
  onComputeRandom: () => void;
  busy: boolean;
}) {
  const strat = STRATEGIES[cfg.strategyId as StrategyId];
  return (
    <div className="space-y-3">
      <div className="card space-y-1">
        <div className="text-xs text-slate-400">Fase actual</div>
        <div className="text-lg font-semibold">
          Fase {view.phase} · {view.name}
        </div>
        <div className="text-xs text-slate-300">
          {view.isReal
            ? `Operación real habilitada: margen máximo ${view.limits.maxMarginUSDT} USDT, hasta ${view.limits.maxLeverage}x, siempre en margen aislado.`
            : 'Fase de práctica: los planes se dimensionan con los límites de la Fase 2 solo para simular. No operes con dinero real.'}
        </div>
      </div>

      {strat && (
        <div className={`card text-xs ${strategyStatus(strat) === 'validada' ? '' : 'border-amber-700 bg-amber-950/30 text-amber-100'}`}>
          <b>Estrategia: {strat.name}.</b> {edgeNote(strat)}
        </div>
      )}

      <LiveValidationCard live={live} onCompute={onComputeRandom} busy={busy} />

      {view.canConfirmPhase2 && (
        <div className="card space-y-2 border-emerald-700 bg-emerald-950/30">
          <div className="text-sm font-semibold text-emerald-200">La validación en vivo cumple el criterio</div>
          <p className="text-xs text-emerald-100">
            Podés habilitar la Fase 2 (real mínimo: {cfg.phases.phase2.maxMarginUSDT} USDT, {cfg.phases.phase2.maxLeverage}x). Es una decisión tuya: un
            resultado positivo en 30 trades todavía puede deberse a la suerte. Empezá con el mínimo y registrá cada trade real.
          </p>
          <button
            className="btn-primary w-full bg-emerald-600 hover:bg-emerald-500"
            onClick={() => {
              if (window.confirm('¿Confirmás que querés habilitar la Fase 2 y empezar a operar con dinero real (montos mínimos)?')) onConfirm();
            }}
          >
            Confirmar y habilitar la Fase 2
          </button>
        </div>
      )}

      <div className="space-y-2">
        {view.steps.map((s) => (
          <div
            key={s.phase}
            className={`card ${s.status === 'actual' ? 'border-sky-600' : s.status === 'bloqueada' ? 'opacity-90' : ''} ${s.status === 'disponible' ? 'border-emerald-700' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">
                Fase {s.phase} · {s.name}
              </div>
              <StatusPill status={s.status} />
            </div>
            {s.lockReason && <div className="mt-1 text-xs text-amber-200">🔒 {s.lockReason}</div>}
            <ul className="mt-2 space-y-1 text-xs">
              {s.requirements.map((r) => (
                <li key={r.label} className="flex gap-2">
                  <span className={r.ok ? 'text-emerald-400' : 'text-slate-500'}>{r.ok ? '✓' : '○'}</span>
                  <span>
                    <span className={r.ok ? '' : 'text-slate-300'}>{r.label}</span>
                    {r.detail && <span className="block text-slate-500">{r.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="card text-xs text-slate-400">
        <div className="mb-1 font-medium text-slate-300">Reglas de retroceso</div>
        En cualquier fase real, si el drawdown supera el {cfg.phases.rollbackDrawdownPct}% del capital de prueba ({cfg.phases.testCapitalUSDT} USDT) o la
        expectativa de los últimos {cfg.phases.rollbackWindow} trades es negativa, la app baja una fase y te explica por qué.
      </div>

      {history.length > 0 && (
        <div className="card text-xs">
          <div className="mb-1 font-medium">Historial de fases</div>
          {[...history].reverse().map((h) => (
            <div key={h.at} className="border-t border-slate-800 py-1">
              {dt(h.at)}: Fase {h.from} → {h.to}. {h.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveValidationCard({ live, onCompute, busy }: { live: LiveValidationStatus | null; onCompute: () => void; busy: boolean }) {
  if (!live) return null;
  const pct = Math.min(100, (live.trades / LIVE_MIN_TRADES) * 100);
  return (
    <div className="card space-y-2">
      <div className="text-sm font-semibold">Validación en vivo (paper trading automático)</div>
      <p className="text-xs text-slate-400">
        Cuenta solo las señales simuladas automáticamente desde que activaste el paper automático (sin elegir cuáles), como una nueva validación fuera
        de muestra. Criterio: al menos {LIVE_MIN_TRADES} trades cerrados, expectativa mayor a +{String(LIVE_MIN_EXPECTANCY_R).replace('.', ',')} R y ganarle al
        percentil 95 de entradas al azar del mismo período.
      </p>
      <div className="h-1.5 overflow-hidden rounded bg-slate-800">
        <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-slate-500">Trades</div>
          <div className="font-mono">
            {live.trades}/{LIVE_MIN_TRADES}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Expectativa</div>
          <div className={`font-mono ${live.meetsExpectancy ? 'text-emerald-400' : 'text-rose-400'}`}>{live.expectancyR.toFixed(3)} R</div>
        </div>
        <div>
          <div className="text-slate-500">¿Le gana al azar?</div>
          <div className="font-mono">{live.beatsRandom === undefined ? 'pendiente' : live.beatsRandom ? 'sí' : 'no'}</div>
        </div>
      </div>
      {live.passed ? (
        <div className="text-xs text-emerald-300">✓ Cumple el criterio. La Fase 2 requiere tu confirmación manual.</div>
      ) : (
        <div className="text-xs text-slate-400">Con señales en 4h llegar a {LIVE_MIN_TRADES} trades puede llevar varios meses.</div>
      )}
      {live.enoughTrades && live.meetsExpectancy && (
        <button className="btn-ghost text-xs" disabled={busy} onClick={onCompute}>
          Recalcular la línea base al azar
        </button>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const c =
    status === 'actual' ? 'bg-sky-700 text-white' : status === 'completada' ? 'bg-emerald-800 text-emerald-100' : status === 'disponible' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400';
  const label = { actual: 'actual', completada: 'completada', disponible: 'disponible', bloqueada: 'bloqueada' }[status] ?? status;
  return <span className={`rounded px-2 py-0.5 text-[11px] ${c}`}>{label}</span>;
}
