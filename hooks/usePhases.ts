'use client';
import { useCallback, useEffect, useMemo } from 'react';
import type { AppConfig } from '@/lib/config/defaults';
import type { BacktestSummary } from '@/lib/backtest/summary';
import type { LiveValidationStatus } from '@/lib/journal/live-validation';
import { applyAutoTransitions, confirmPhase2, phaseView, type PhaseInputs } from '@/lib/risk/phases';
import type { JournalApi } from './useJournal';

export function usePhases(journal: JournalApi, cfg: AppConfig, backtest: BacktestSummary | null, live: LiveValidationStatus | null) {
  const d = journal.data;
  const inputs: PhaseInputs | null = useMemo(
    () => (d ? { state: d.phase, cfg, backtest, paper: d.paper, real: d.real, live } : null),
    [d, cfg, backtest, live],
  );

  // Transiciones automáticas (retroceso y 2→3→4) cuando cambia el diario.
  useEffect(() => {
    if (!inputs) return;
    const next = applyAutoTransitions(inputs);
    if (next !== inputs.state) journal.update((j) => ({ ...j, phase: next }));
  }, [inputs, journal]);

  const view = useMemo(() => (inputs ? phaseView(inputs) : null), [inputs]);
  const confirm = useCallback(() => {
    if (!inputs) return;
    const next = confirmPhase2(inputs);
    journal.update((j) => ({ ...j, phase: next }));
  }, [inputs, journal]);
  return { view, confirm, history: d?.phase.history ?? [] };
}
