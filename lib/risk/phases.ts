// Fases de desbloqueo progresivo. Función pura: a partir del historial calcula la
// fase, los requisitos de cada una y las transiciones automáticas.
//
// 0 Backtest · 1 Paper trading · 2 Real mínimo · 3 Real chico · 4 Real
// - 0 ↔ 1: automático según el backtest (algún setup con expectativa positiva).
// - → 2: validación en vivo aprobada + drawdown de paper < límite + CONFIRMACIÓN MANUAL.
// - 2 → 3 y 3 → 4: automático tras N trades reales con expectativa positiva.
// - Retroceso automático (fases reales): drawdown > límite o expectativa de los
//   últimos N trades negativa → baja una fase.
import type { AppConfig, PhaseLimits } from '../config/defaults';
import { computeStats } from '../backtest/metrics';
import type { BacktestSummary } from '../backtest/summary';
import { positiveCombos } from '../backtest/summary';
import type { LiveValidationStatus } from '../journal/live-validation';
import type { PaperTrade, PhaseEvent, PhaseState, RealTrade } from '../journal/types';
import { realNetPnl, realR } from '../journal/real';

export const PHASE_NAMES = ['Backtest', 'Paper trading', 'Real mínimo', 'Real chico', 'Real'] as const;

export interface Requirement {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PhaseStep {
  phase: number;
  name: string;
  status: 'completada' | 'actual' | 'bloqueada' | 'disponible';
  requirements: Requirement[];
  lockReason?: string;
}

export interface PhaseView {
  phase: number;
  name: string;
  isReal: boolean;
  /** Límites para dimensionar planes (en 0/1 se simula con los de la Fase 2). */
  limits: PhaseLimits;
  steps: PhaseStep[];
  canConfirmPhase2: boolean;
}

export interface PhaseInputs {
  state: PhaseState;
  cfg: AppConfig;
  backtest: BacktestSummary | null;
  paper: PaperTrade[];
  real: RealTrade[];
  live: LiveValidationStatus | null;
}

const limitsFor = (p: number, cfg: AppConfig): PhaseLimits => (p >= 4 ? cfg.phases.phase4 : p === 3 ? cfg.phases.phase3 : cfg.phases.phase2);

/** Momento en que se entró a la fase actual. */
const enteredAt = (s: PhaseState) => s.history.filter((e) => e.to === s.phase).at(-1)?.at ?? 0;

function realStats(real: RealTrade[]) {
  return computeStats(real.map((t) => ({ netPnl: realNetPnl(t), r: realR(t), exitTime: t.closedAt })));
}

function paperDrawdown(paper: PaperTrade[]) {
  const done = paper.filter((t) => t.result);
  return computeStats(done.map((t) => ({ netPnl: t.result!.netPnl, r: t.result!.r, exitTime: t.result!.exitTime }))).maxDrawdown;
}

export function phase2Requirements(i: PhaseInputs): Requirement[] {
  const { cfg, live } = i;
  const cap = cfg.phases.testCapitalUSDT;
  const dd = paperDrawdown(i.paper);
  const ddLimit = (cfg.phases.paperMaxDrawdownPct / 100) * cap;
  const pos = positiveCombos(i.backtest);
  return [
    {
      label: 'Backtest con expectativa positiva',
      ok: pos.length > 0,
      detail: !i.backtest
        ? 'Todavía no corriste el backtest.'
        : pos.length
          ? `${pos.length} setup(s) con expectativa positiva.`
          : 'Ningún setup tiene expectativa positiva después de comisiones y funding (informativo: la validación en vivo puede reemplazarlo).',
    },
    {
      label: `Validación en vivo: ≥ ${cfg.phases.paperMinTrades} trades automáticos`,
      ok: (live?.trades ?? 0) >= cfg.phases.paperMinTrades,
      detail: `${live?.trades ?? 0} de ${cfg.phases.paperMinTrades} trades simulados cerrados.`,
    },
    {
      label: 'Validación en vivo: expectativa > +0,15 R',
      ok: !!live?.meetsExpectancy,
      detail: `Expectativa actual: ${(live?.expectancyR ?? 0).toFixed(3)} R por trade.`,
    },
    {
      label: 'Validación en vivo: le gana al azar',
      ok: live?.beatsRandom === true,
      detail:
        live?.beatsRandom === undefined
          ? 'Se calcula al cumplir los dos requisitos anteriores.'
          : `Percentil 95 del azar: ${(live.randomP95 ?? 0).toFixed(3)} R.`,
    },
    {
      label: `Drawdown del paper trading < ${cfg.phases.paperMaxDrawdownPct}% del capital de prueba`,
      ok: dd < ddLimit,
      detail: `Drawdown máximo ${dd.toFixed(2)} USDT (límite ${ddLimit.toFixed(2)} USDT de ${cap} USDT).`,
    },
  ];
}

/** Requisitos obligatorios para habilitar la confirmación manual de la Fase 2 (el backtest es informativo). */
export function phase2Eligible(i: PhaseInputs): boolean {
  return phase2Requirements(i).slice(1).every((r) => r.ok);
}

/** Transiciones automáticas (retroceso y avances 2→3→4). Devuelve el nuevo estado. */
export function applyAutoTransitions(i: PhaseInputs, now = Date.now()): PhaseState {
  let s = i.state;
  const cfg = i.cfg;
  const push = (to: number, reason: string) => {
    const ev: PhaseEvent = { at: now, from: s.phase, to, reason };
    s = { phase: to, history: [...s.history, ev] };
  };
  if (s.phase >= 2) {
    const since = enteredAt(s);
    const inPhase = i.real.filter((t) => t.openedAt >= since).sort((a, b) => a.closedAt - b.closedAt);
    const st = realStats(inPhase);
    const ddLimit = (cfg.phases.rollbackDrawdownPct / 100) * cfg.phases.testCapitalUSDT;
    const lastN = inPhase.slice(-cfg.phases.rollbackWindow);
    const lastExp = lastN.length >= cfg.phases.rollbackWindow ? realStats(lastN).expectancy : 0;
    if (st.maxDrawdown > ddLimit) {
      push(s.phase - 1, `Retroceso: drawdown de ${st.maxDrawdown.toFixed(2)} USDT supera el ${cfg.phases.rollbackDrawdownPct}% del capital de prueba.`);
      return s;
    }
    if (lastN.length >= cfg.phases.rollbackWindow && lastExp < 0) {
      push(s.phase - 1, `Retroceso: la expectativa de los últimos ${cfg.phases.rollbackWindow} trades es negativa (${lastExp.toFixed(3)} USDT).`);
      return s;
    }
    const need = s.phase === 2 ? cfg.phases.phase3MinTrades : s.phase === 3 ? cfg.phases.phase4MinTrades : Infinity;
    if (inPhase.length >= need && st.expectancy > 0)
      push(s.phase + 1, `Avance: ${inPhase.length} trades reales en la Fase ${s.phase} con expectativa positiva (${st.expectancy.toFixed(3)} USDT).`);
  }
  return s;
}

export function confirmPhase2(i: PhaseInputs, now = Date.now()): PhaseState {
  if (i.state.phase >= 2) return i.state;
  if (!phase2Eligible(i)) throw new Error('Todavía no se cumplen los requisitos de la Fase 2.');
  return {
    phase: 2,
    history: [...i.state.history, { at: now, from: i.state.phase, to: 2, reason: 'Confirmación manual del usuario tras aprobar la validación en vivo.' }],
  };
}

export function phaseView(i: PhaseInputs): PhaseView {
  const cfg = i.cfg;
  const stored = i.state.phase;
  const practice = positiveCombos(i.backtest).length > 0 ? 1 : 0;
  const phase = stored >= 2 ? stored : practice;
  const req2 = phase2Requirements(i);
  const eligible = phase2Eligible(i);
  const since = enteredAt(i.state);
  const inPhase = i.real.filter((t) => t.openedAt >= since);
  const st = realStats(inPhase);
  const steps: PhaseStep[] = [
    {
      phase: 0,
      name: PHASE_NAMES[0],
      status: phase === 0 ? 'actual' : 'completada',
      requirements: [req2[0]],
    },
    {
      phase: 1,
      name: PHASE_NAMES[1],
      status: phase === 1 ? 'actual' : phase > 1 ? 'completada' : 'bloqueada',
      requirements: req2.slice(1),
      lockReason: phase < 1 ? 'El backtest no tiene setups con expectativa positiva. Igual podés hacer paper trading: la validación en vivo es la vía para avanzar.' : undefined,
    },
    {
      phase: 2,
      name: `${PHASE_NAMES[2]} · ${cfg.phases.phase2.maxMarginUSDT} USDT · ${cfg.phases.phase2.maxLeverage}x`,
      status: phase === 2 ? 'actual' : phase > 2 ? 'completada' : eligible ? 'disponible' : 'bloqueada',
      requirements: [...req2.slice(1), { label: 'Confirmación manual', ok: stored >= 2, detail: stored >= 2 ? 'Confirmada.' : 'Requiere que la confirmes vos.' }],
      lockReason: eligible
        ? undefined
        : 'Bloqueada: la estrategia no demostró ventaja. Necesitás aprobar la validación en vivo (30+ trades automáticos, expectativa > +0,15 R y ganarle al azar) y después confirmarlo a mano.',
    },
    {
      phase: 3,
      name: `${PHASE_NAMES[3]} · ${cfg.phases.phase3.maxMarginUSDT} USDT · ${cfg.phases.phase3.maxLeverage}x`,
      status: phase === 3 ? 'actual' : phase > 3 ? 'completada' : 'bloqueada',
      requirements: [
        { label: `${cfg.phases.phase3MinTrades} trades reales en Fase 2`, ok: phase > 2, detail: phase === 2 ? `${inPhase.length} de ${cfg.phases.phase3MinTrades}.` : '' },
        { label: 'Expectativa positiva', ok: phase > 2 || (phase === 2 && st.expectancy > 0), detail: phase === 2 ? `${st.expectancy.toFixed(3)} USDT por trade.` : '' },
      ],
      lockReason: phase < 2 ? 'Bloqueada hasta operar en la Fase 2.' : undefined,
    },
    {
      phase: 4,
      name: `${PHASE_NAMES[4]} · ${cfg.phases.phase4.maxMarginUSDT} USDT · ${cfg.phases.phase4.maxLeverage}x (habilita BTCUSDT)`,
      status: phase === 4 ? 'actual' : 'bloqueada',
      requirements: [
        { label: `${cfg.phases.phase4MinTrades} trades reales en Fase 3`, ok: phase > 3, detail: phase === 3 ? `${inPhase.length} de ${cfg.phases.phase4MinTrades}.` : '' },
        { label: 'Expectativa positiva', ok: phase > 3 || (phase === 3 && st.expectancy > 0), detail: phase === 3 ? `${st.expectancy.toFixed(3)} USDT por trade.` : '' },
      ],
      lockReason: phase < 3 ? 'Bloqueada hasta completar la Fase 3.' : undefined,
    },
  ];
  return {
    phase,
    name: PHASE_NAMES[phase],
    isReal: phase >= 2,
    limits: limitsFor(phase, cfg),
    steps,
    canConfirmPhase2: stored < 2 && eligible,
  };
}
