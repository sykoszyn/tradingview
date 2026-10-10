'use client';
import { useState } from 'react';
import { DEFAULT_CONFIG, HARD_LIMITS, type AppConfig } from '@/lib/config/defaults';
import { configWarnings } from '@/lib/config/schema';
import { edgeNote, STRATEGY_LIST } from '@/lib/strategies/registry';
import { applyPatch, type StrategyId } from '@/lib/strategies/patches';
import { SYMBOLS } from '@/lib/types';
import type { JournalApi } from '@/hooks/useJournal';
import type { MarketMeta } from '@/hooks/useMarketMeta';
import type { PhaseView } from '@/lib/risk/phases';
import { upcomingNews } from '@/lib/risk/news';
import { MinimumsTable } from './MinimumsTable';

type Path = string;
interface FieldDef {
  path: Path;
  label: string;
  step?: number;
  unit?: string;
  int?: boolean;
}
const GROUPS: Array<{ title: string; note?: string; fields: FieldDef[] }> = [
  {
    title: 'Riesgo y tamaño',
    fields: [
      { path: 'sizing.riskPerTradeUSDT', label: 'Riesgo máximo por trade', step: 0.1, unit: 'USDT' },
      { path: 'plan.maxRiskMultiplier', label: 'Descartar si el riesgo real supera', step: 0.5, unit: '× el riesgo' },
    ],
  },
  {
    title: 'Plan de entrada',
    fields: [
      { path: 'plan.minRR', label: 'R:R mínimo en TP1 (neto)', step: 0.1 },
      { path: 'plan.stopBufferPct', label: 'Margen del stop detrás de la zona', step: 0.05, unit: '%' },
      { path: 'plan.minStopPct', label: 'Distancia mínima del stop', step: 0.05, unit: '%' },
      { path: 'plan.entryMaxDriftPct', label: 'Invalidar si el precio se aleja más de', step: 0.1, unit: '%' },
      { path: 'plan.expiryCandles', label: 'Vencimiento (velas de la señal)', int: true },
      { path: 'plan.tp1ClosePct', label: 'Cerrar en TP1', step: 5, unit: '%' },
    ],
  },
  {
    title: 'Análisis',
    note: 'Cambiar estos valores modifica la estrategia: los resultados de backtest y validación dejan de aplicar.',
    fields: [
      { path: 'analysis.zoneMergePct', label: 'Agrupar pivots dentro de', step: 0.05, unit: '%' },
      { path: 'analysis.wickRatioMin', label: 'Mecha mínima (fracción del rango)', step: 0.05 },
      { path: 'analysis.breakoutVolumeMult', label: 'Volumen de ruptura', step: 0.1, unit: '× promedio' },
    ],
  },
  {
    title: 'Comisiones y slippage',
    fields: [
      { path: 'fees.futuresMakerPct', label: 'Futuros maker', step: 0.01, unit: '%' },
      { path: 'fees.futuresTakerPct', label: 'Futuros taker', step: 0.01, unit: '%' },
      { path: 'fees.spotPct', label: 'Spot', step: 0.01, unit: '%' },
      { path: 'fees.slippagePct', label: 'Slippage (salidas a mercado)', step: 0.01, unit: '%' },
    ],
  },
  {
    title: 'Límites de riesgo',
    fields: [
      { path: 'limits.maxTradesPerDay', label: 'Trades por día', int: true },
      { path: 'limits.maxDailyLossUSDT', label: 'Pérdida máxima diaria', step: 0.5, unit: 'USDT' },
      { path: 'limits.maxWeeklyLossUSDT', label: 'Pérdida máxima semanal', step: 0.5, unit: 'USDT' },
    ],
  },
  {
    title: 'Fases',
    fields: [
      { path: 'phases.testCapitalUSDT', label: 'Capital de prueba', step: 10, unit: 'USDT' },
      { path: 'phases.paperMinTrades', label: 'Trades de paper para la Fase 2', int: true },
      { path: 'phases.paperMaxDrawdownPct', label: 'Drawdown máximo de paper', step: 1, unit: '%' },
      { path: 'phases.phase2.maxMarginUSDT', label: 'Fase 2: margen máximo', step: 1, unit: 'USDT' },
      { path: 'phases.phase2.maxLeverage', label: 'Fase 2: apalancamiento máximo', int: true, unit: 'x' },
      { path: 'phases.phase3MinTrades', label: 'Trades reales para la Fase 3', int: true },
      { path: 'phases.phase3.maxMarginUSDT', label: 'Fase 3: margen máximo', step: 1, unit: 'USDT' },
      { path: 'phases.phase3.maxLeverage', label: 'Fase 3: apalancamiento máximo', int: true, unit: 'x' },
      { path: 'phases.phase4MinTrades', label: 'Trades reales para la Fase 4', int: true },
      { path: 'phases.phase4.maxMarginUSDT', label: 'Fase 4: margen máximo', step: 1, unit: 'USDT' },
      { path: 'phases.phase4.maxLeverage', label: 'Fase 4: apalancamiento máximo', int: true, unit: 'x' },
      { path: 'phases.rollbackDrawdownPct', label: 'Retroceso si el drawdown supera', step: 1, unit: '%' },
      { path: 'phases.rollbackWindow', label: 'Retroceso: ventana de trades', int: true },
    ],
  },
  { title: 'Noticias', fields: [{ path: 'news.windowHours', label: 'Ventana alrededor de un dato', step: 0.5, unit: 'h' }] },
];

const get = (o: unknown, p: Path) => p.split('.').reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], o) as number;
function set<T>(o: T, p: Path, v: unknown): T {
  const [h, ...rest] = p.split('.');
  const src = o as Record<string, unknown>;
  return { ...src, [h]: rest.length ? set(src[h], rest.join('.'), v) : v } as T;
}

export function SettingsPanel({
  cfg,
  setConfig,
  reset,
  corrections,
  meta,
  phase,
  journal,
}: {
  cfg: AppConfig;
  setConfig: (c: AppConfig) => void;
  reset: () => void;
  corrections: string[];
  meta: MarketMeta;
  phase: PhaseView;
  journal: JournalApi;
}) {
  const warnings = configWarnings(cfg);
  const [newsTime, setNewsTime] = useState('');
  const [newsLabel, setNewsLabel] = useState('');
  const news = journal.data ? upcomingNews(journal.data.news, Date.now()) : [];
  const strat = STRATEGY_LIST.find((s) => s.id === cfg.strategyId) ?? STRATEGY_LIST[0];

  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold">Estrategia</h3>
        <select className="input" value={cfg.strategyId} onChange={(e) => setConfig(applyPatch(cfg, e.target.value as StrategyId))}>
          {STRATEGY_LIST.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.id === DEFAULT_CONFIG.strategyId ? ' (por defecto)' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-300">{strat.description}</p>
        <p className="rounded-lg border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-100">{edgeNote(strat)}</p>
        <div className="text-[11px] text-slate-400">
          Señales en velas de {cfg.analysis.signalTimeframe} · stop {cfg.plan.stopMode === 'atr' ? `${cfg.plan.atrMultiplier}× ATR` : 'por porcentaje'} · tendencia:{' '}
          {cfg.analysis.counterTrendMode === 'discard' ? 'descarta contra la tendencia de 4h' : cfg.analysis.counterTrendMode} · toques mínimos {cfg.analysis.minZoneTouches}.
          Para cambiar estas reglas hay que agregar una estrategia nueva y validarla (docs/nuevas-estrategias.md).
        </div>
      </div>

      <div className="card space-y-1 text-xs">
        <h3 className="text-sm font-semibold">Topes duros (no se pueden cambiar)</h3>
        <div>Apalancamiento máximo: {HARD_LIMITS.maxLeverage}x (spot siempre 1x) · Margen: AISLADO obligatorio · Margen mínimo por entrada: {HARD_LIMITS.minMarginUSDT} USDT</div>
        <label className="mt-1 flex items-center gap-2">
          <span className="label">Apalancamiento por defecto</span>
          <select className="input w-24" value={cfg.sizing.defaultLeverage} onChange={(e) => setConfig(set(cfg, 'sizing.defaultLeverage', Number(e.target.value)))}>
            {[1, 2, 3].map((l) => (
              <option key={l} value={l}>
                {l}x
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="label">Señales contra la tendencia</span>
          <span className="text-slate-300">las define la estrategia</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.news.blockFutures} onChange={(e) => setConfig(set(cfg, 'news.blockFutures', e.target.checked))} />
          Bloquear señales de futuros cerca de noticias
        </label>
      </div>

      {(warnings.length > 0 || corrections.length > 0) && (
        <div className="rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-100">
          <b>Advertencias</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {[...corrections, ...warnings].map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {GROUPS.map((g) => (
        <details key={g.title} className="card" open={g.title === 'Riesgo y tamaño'}>
          <summary className="cursor-pointer text-sm font-semibold">{g.title}</summary>
          {g.note && <p className="mt-1 text-[11px] text-amber-300">{g.note}</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {g.fields.map((f) => (
              <NumField key={f.path} f={f} value={get(cfg, f.path)} def={get(DEFAULT_CONFIG, f.path)} onChange={(v) => setConfig(set(cfg, f.path, v))} />
            ))}
          </div>
        </details>
      ))}

      <div className="card space-y-2">
        <h3 className="text-sm font-semibold">Datos económicos de EE.UU. (filtro de noticias)</h3>
        <p className="text-[11px] text-slate-400">
          Cargá fecha y hora (Argentina) de CPI, FOMC, NFP, etc. Las señales dentro de ±{cfg.news.windowHours} h se marcan como riesgo alto
          {cfg.news.blockFutures ? ' y en futuros se bloquean' : ''}.
        </p>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input className="input col-span-2" type="datetime-local" value={newsTime} onChange={(e) => setNewsTime(e.target.value)} />
          <input className="input" placeholder="Dato (ej.: CPI, FOMC, NFP)" value={newsLabel} onChange={(e) => setNewsLabel(e.target.value)} />
          <button
            className="btn-primary"
            disabled={!newsTime || !newsLabel}
            onClick={() => {
              const time = Date.parse(`${newsTime}:00-03:00`);
              journal.update((j) => ({ ...j, news: [...j.news, { id: `n-${Date.now()}`, time, label: newsLabel }] }));
              setNewsLabel('');
              setNewsTime('');
            }}
          >
            Agregar
          </button>
        </div>
        {news.map((e) => (
          <div key={e.id} className="flex justify-between border-t border-slate-800 pt-1 text-xs">
            <span>
              {new Date(e.time).toLocaleString('es-AR', { timeZone: cfg.timezone })} · {e.label}
            </span>
            <button className="text-slate-500 underline" onClick={() => journal.update((j) => ({ ...j, news: j.news.filter((x) => x.id !== e.id) }))}>
              borrar
            </button>
          </div>
        ))}
      </div>

      <MinimumsTable meta={meta} market="futures" phaseMaxMargin={phase.limits.maxMarginUSDT} phaseMaxLev={phase.limits.maxLeverage} />
      <MinimumsTable meta={meta} market="spot" phaseMaxMargin={phase.limits.maxMarginUSDT} phaseMaxLev={1} />
      <div className="card space-y-1 text-xs text-slate-300">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Brackets de apalancamiento</h3>
          <button className="text-sky-400 underline" onClick={meta.refresh}>
            actualizar mínimos y brackets
          </button>
        </div>
        {meta.brackets
          ? SYMBOLS.map((s) => {
              const b = meta.brackets![s];
              const t = b.brackets[0];
              return (
                <div key={s}>
                  {s}: tramo 1 hasta {t.notionalCap.toLocaleString('es-AR')} USDT · MMR {(t.maintMarginRate * 100).toFixed(2)}% · fuente {b.source}
                  {b.warning && <div className="text-amber-300">{b.warning}</div>}
                </div>
              );
            })
          : 'Cargando…'}
        {meta.updatedAt && <div className="text-slate-500">Última actualización: {new Date(meta.updatedAt).toLocaleTimeString('es-AR')} (se refresca cada 1 hora)</div>}
      </div>

      <button className="btn-ghost w-full" onClick={() => window.confirm('¿Restaurar toda la configuración a los valores por defecto?') && reset()}>
        Restaurar valores por defecto
      </button>
    </div>
  );
}

function NumField({ f, value, def, onChange }: { f: FieldDef; value: number; def: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(value);
  return (
    <label className="block">
      <span className="label">
        {f.label}
        {f.unit ? ` (${f.unit})` : ''}
      </span>
      <input
        className={`input ${value !== def ? 'border-amber-600' : ''}`}
        inputMode="decimal"
        value={shown}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const v = Number(text.replace(',', '.'));
          if (Number.isFinite(v)) onChange(f.int ? Math.round(v) : v);
        }}
      />
      {value !== def && <span className="text-[10px] text-amber-400">por defecto: {def}</span>}
    </label>
  );
}
