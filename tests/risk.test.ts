import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/config/defaults';
import { dayKey, riskLimitStatus, weekKey } from '@/lib/risk/limits';
import { nearestNews, newsVerdict } from '@/lib/risk/news';
import { applyAutoTransitions, confirmPhase2, phase2Eligible, phaseView, type PhaseInputs } from '@/lib/risk/phases';
import type { LiveValidationStatus } from '@/lib/journal/live-validation';
import type { PhaseState, RealTrade } from '@/lib/journal/types';

const H = 3_600_000;
const TZ = 'America/Argentina/Buenos_Aires';

describe('límites de riesgo (hora de Buenos Aires)', () => {
  it('el día cambia a las 00:00 de Argentina (03:00 UTC)', () => {
    expect(dayKey(Date.UTC(2026, 9, 10, 2, 59), TZ)).toBe('2026-10-09');
    expect(dayKey(Date.UTC(2026, 9, 10, 3, 0), TZ)).toBe('2026-10-10');
  });
  it('la semana va de lunes a domingo', () => {
    expect(weekKey(Date.UTC(2026, 9, 11, 12), TZ)).toBe('2026-10-05'); // domingo 11 → lunes 5
    expect(weekKey(Date.UTC(2026, 9, 12, 12), TZ)).toBe('2026-10-12'); // lunes 12
  });
  const now = Date.UTC(2026, 9, 14, 15); // miércoles
  it('bloquea al llegar a 3 trades en el día', () => {
    const t = [1, 2, 3].map((k) => ({ openedAt: now - k * H }));
    const s = riskLimitStatus(t, now, DEFAULT_CONFIG);
    expect(s.tradesToday).toBe(3);
    expect(s.blocked).toBe(true);
  });
  it('bloquea por pérdida diaria y semanal', () => {
    const daily = riskLimitStatus([{ openedAt: now - 2 * H, closedAt: now - H, netPnl: -3.1 }], now, DEFAULT_CONFIG);
    expect(daily.reasons.join(' ')).toMatch(/Pérdida de hoy/);
    const weekly = riskLimitStatus(
      [
        { openedAt: now - 50 * H, closedAt: now - 49 * H, netPnl: -2.9 },
        { openedAt: now - 30 * H, closedAt: now - 29 * H, netPnl: -2.9 },
        { openedAt: now - 26 * H, closedAt: now - 25 * H, netPnl: -2.5 },
      ],
      now,
      DEFAULT_CONFIG,
    );
    expect(weekly.reasons.join(' ')).toMatch(/semana/);
  });
  it('sin trades no bloquea', () => {
    expect(riskLimitStatus([], now, DEFAULT_CONFIG).blocked).toBe(false);
  });
});

describe('filtro de noticias', () => {
  const events = [{ id: '1', time: Date.UTC(2026, 9, 14, 12, 30), label: 'CPI' }];
  it('±2 h de un dato → riesgo alto; en futuros se bloquea por defecto', () => {
    const v = newsVerdict([Date.UTC(2026, 9, 14, 11)], 'futures', events, DEFAULT_CONFIG);
    expect(v.highRisk).toBe(true);
    expect(v.blocked).toBe(true);
    expect(newsVerdict([Date.UTC(2026, 9, 14, 11)], 'spot', events, DEFAULT_CONFIG).blocked).toBe(false);
  });
  it('fuera de la ventana no marca nada', () => {
    expect(nearestNews(Date.UTC(2026, 9, 14, 9), events, 2)).toBeNull();
  });
  it('el bloqueo en futuros es configurable', () => {
    const cfg = { ...DEFAULT_CONFIG, news: { ...DEFAULT_CONFIG.news, blockFutures: false } };
    expect(newsVerdict([Date.UTC(2026, 9, 14, 12)], 'futures', events, cfg).blocked).toBe(false);
  });
});

const liveOk: LiveValidationStatus = { trades: 30, expectancyR: 0.3, enoughTrades: true, meetsExpectancy: true, beatsRandom: true, randomP95: 0.1, passed: true, needsRandom: false };
const base = (o: Partial<PhaseInputs> = {}): PhaseInputs => ({ state: { phase: 0, history: [] }, cfg: DEFAULT_CONFIG, backtest: null, paper: [], real: [], live: null, ...o });
const real = (n: number, pnl: (i: number) => number, from = 1000): RealTrade[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`, kind: 'real', createdAt: from + i, symbol: 'ETHUSDT', market: 'futures', direction: 'long', entryPrice: 100, exitPrice: 100 + pnl(i) * 10,
    qty: 0.1, fees: 0, funding: 0, openedAt: from + i * 10, closedAt: from + i * 10 + 5, phaseAtEntry: 2,
  }));

describe('fases', () => {
  it('sin backtest positivo ni validación en vivo: Fase 0 y las fases 2–4 bloqueadas con explicación', () => {
    const v = phaseView(base());
    expect(v.phase).toBe(0);
    expect(v.isReal).toBe(false);
    expect(v.steps[2].status).toBe('bloqueada');
    expect(v.steps[2].lockReason).toMatch(/no demostró ventaja/);
    expect(v.canConfirmPhase2).toBe(false);
    expect(() => confirmPhase2(base())).toThrow();
  });
  it('con la validación en vivo aprobada, la Fase 2 queda disponible pero requiere confirmación manual', () => {
    const i = base({ live: liveOk });
    expect(phase2Eligible(i)).toBe(true);
    const v = phaseView(i);
    expect(v.phase).toBe(0);
    expect(v.steps[2].status).toBe('disponible');
    expect(v.canConfirmPhase2).toBe(true);
    const s = confirmPhase2(i, 5000);
    expect(s.phase).toBe(2);
    expect(s.history.at(-1)!.reason).toMatch(/manual/);
    expect(phaseView({ ...i, state: s }).limits.maxMarginUSDT).toBe(15);
  });
  it('si el drawdown del paper supera el límite, no se habilita', () => {
    const paper = [{ result: { netPnl: -11, r: -1, exitTime: 1, outcome: 'stop', fillTime: 0, fees: 0, funding: 0 } }] as never;
    expect(phase2Eligible(base({ live: liveOk, paper }))).toBe(false);
  });
  const p2: PhaseState = { phase: 2, history: [{ at: 500, from: 0, to: 2, reason: 'manual' }] };
  it('2 → 3 automático tras 30 trades reales con expectativa positiva', () => {
    const s = applyAutoTransitions(base({ state: p2, real: real(30, (i) => (i % 3 === 0 ? -0.5 : 1)) }), 9e9);
    expect(s.phase).toBe(3);
  });
  it('retroceso automático si los últimos 20 trades tienen expectativa negativa', () => {
    const s = applyAutoTransitions(base({ state: p2, real: real(20, (i) => (i % 2 === 0 ? -0.6 : 0.5)) }), 9e9);
    expect(s.phase).toBe(1);
    expect(s.history.at(-1)!.reason).toMatch(/últimos 20/);
  });
  it('retroceso automático si el drawdown supera el 15 % del capital de prueba', () => {
    const s = applyAutoTransitions(base({ state: p2, real: real(5, () => -4) }), 9e9);
    expect(s.phase).toBe(1);
    expect(s.history.at(-1)!.reason).toMatch(/drawdown/);
  });
  it('los trades anteriores a la fase actual no cuentan', () => {
    const s = applyAutoTransitions(base({ state: { phase: 2, history: [{ at: 1e9, from: 1, to: 2, reason: 'x' }] }, real: real(5, () => -4) }), 9e9);
    expect(s.phase).toBe(2);
  });
});
