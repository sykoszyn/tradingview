'use client';
import { useMemo, useState } from 'react';
import type { AppConfig } from '@/lib/config/defaults';
import type { Market, TradingSymbol } from '@/lib/types';
import { SETUP_LABEL } from '@/lib/analysis/setups';
import { buildReport, type ReportRow } from '@/lib/backtest/report';
import type { Stats } from '@/lib/backtest/metrics';
import type { MarketMeta } from '@/hooks/useMarketMeta';
import type { useBacktest } from '@/hooks/useBacktest';
import { EquityChart } from './EquityChart';

const COMBOS: Array<[TradingSymbol, Market]> = [
  ['ETHUSDT', 'futures'],
  ['BTCUSDT', 'futures'],
  ['ETHUSDT', 'spot'],
  ['BTCUSDT', 'spot'],
];
const mk = (m: Market) => (m === 'futures' ? 'Futuros' : 'Spot');
const n = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '∞');
const dt = (t: number) => new Date(t).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

export function BacktestPanel({ cfg, meta, bt }: { cfg: AppConfig; meta: MarketMeta; bt: ReturnType<typeof useBacktest> }) {
  const [selected, setSelected] = useState<string[]>(COMBOS.map((c) => c.join('|')));
  const [months, setMonths] = useState(12);
  const [track, setTrack] = useState<'r' | 'usdt'>('r');
  const report = useMemo(() => (bt.run ? buildReport(bt.run.result, track) : null), [bt.run, track]);
  const unit = track === 'r' ? 'R' : 'USDT';

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <h2 className="text-sm font-semibold">Backtest</h2>
        <p className="text-xs text-slate-400">
          Mismas reglas que en vivo: entrada, stop, TP, vencimiento, tamaño, mínimos del par, apalancamiento y liquidación. Incluye comisiones,
          slippage de {cfg.fees.slippagePct}% y funding histórico. Las velas que tocan stop y TP se resuelven con velas de 15m y 1m; si no se puede
          saber, se asume el stop.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {COMBOS.map(([s, m]) => {
            const k = `${s}|${m}`;
            return (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(k)}
                  onChange={(e) => setSelected((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))}
                />
                {s} {mk(m)}
              </label>
            );
          })}
        </div>
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="label">Meses de historial (mín. 12)</span>
            <input className="input" type="number" min={12} max={36} value={months} onChange={(e) => setMonths(Math.max(12, Number(e.target.value) || 12))} />
          </label>
          <button
            className="btn-primary flex-1"
            disabled={bt.running || !selected.length || meta.loading}
            onClick={() =>
              bt.start({
                combos: COMBOS.filter((c) => selected.includes(c.join('|'))),
                months,
                cfg,
                filters: meta.filters,
                brackets: meta.brackets,
              })
            }
          >
            {bt.running ? 'Corriendo…' : 'Correr backtest'}
          </button>
        </div>
        {bt.status && (
          <div className="space-y-1">
            <div className="text-xs text-slate-300">{bt.status}</div>
            <div className="h-1.5 overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-sky-500 transition-all" style={{ width: `${Math.round(bt.progress * 100)}%` }} />
            </div>
          </div>
        )}
        {bt.error && <div className="rounded-lg border border-rose-800 bg-rose-950/60 p-2 text-xs text-rose-200">{bt.error}</div>}
        {!bt.run && bt.summary && (
          <p className="text-xs text-slate-400">
            Último backtest: {dt(bt.summary.runAt)} · {bt.summary.overallR.trades} trades · expectativa {n(bt.summary.overallR.expectancyR, 3)} R. Volvé a
            correrlo para ver el detalle.
          </p>
        )}
      </div>

      {bt.run && report && (
        <>
          <div className="flex gap-1">
            {(['r', 'usdt'] as const).map((t) => (
              <button key={t} onClick={() => setTrack(t)} className={`btn flex-1 ${track === t ? 'bg-slate-700 text-white' : 'border border-slate-800 text-slate-400'}`}>
                {t === 'r' ? 'En múltiplos de R' : 'En USDT (Fase 2)'}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            {track === 'r'
              ? 'Mide el sistema sin límites de tamaño: cada trade arriesga 1 R (incluye comisiones, slippage y funding).'
              : `Tamaño real de la Fase 2 (${cfg.phases.phase2.maxMarginUSDT} USDT, ${cfg.phases.phase2.maxLeverage}x): las señales que no alcanzan el mínimo del par se cuentan como "descartadas por mínimos".`}{' '}
            Período {dt(bt.run.from)} → {dt(bt.run.to)}.
          </p>
          <OverallCard stats={report.overall} unit={unit} track={track} />
          {report.overall.equity.length > 1 && (
            <div className="card">
              <div className="mb-1 text-xs text-slate-400">Curva de capital ({unit})</div>
              <EquityChart points={report.overall.equity.map((e) => ({ time: e.time, value: track === 'r' ? e.valueR : e.value }))} unit={unit} />
            </div>
          )}
          <div className="space-y-2">
            {report.rows.map((r) => (
              <RowCard key={r.key} r={r} track={track} />
            ))}
          </div>
          <DiscardSummary run={bt.run} track={track} />
        </>
      )}
    </div>
  );
}

function OverallCard({ stats: s, unit, track }: { stats: Stats; unit: string; track: 'r' | 'usdt' }) {
  const exp = track === 'r' ? s.expectancyR : s.expectancy;
  const tiles: Array<[string, string, boolean?]> = [
    ['Trades', String(s.trades)],
    ['Aciertos', `${n(s.winRate * 100, 1)}%`],
    ['R:R promedio', n(s.avgRR)],
    ['Expectativa', `${n(exp, 3)} ${unit}`, exp > 0],
    ['Resultado', `${n(track === 'r' ? s.totalR : s.total)} ${unit}`, (track === 'r' ? s.totalR : s.total) > 0],
    ['DD máximo', `${n(track === 'r' ? s.maxDrawdownR : s.maxDrawdown)} ${unit}`],
    ['Liquidaciones', String(s.liquidations), s.liquidations === 0],
  ];
  return (
    <div className="card grid grid-cols-3 gap-2">
      {tiles.map(([k, v, good]) => (
        <div key={k}>
          <div className="text-[11px] text-slate-400">{k}</div>
          <div className={`font-mono text-sm ${good === undefined ? '' : good ? 'text-emerald-400' : 'text-rose-400'}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function RowCard({ r, track }: { r: ReportRow; track: 'r' | 'usdt' }) {
  const s = r.stats;
  const unit = track === 'r' ? 'R' : 'USDT';
  return (
    <div className={`card ${r.doNotUse ? 'border-rose-800 bg-rose-950/30' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">
            {SETUP_LABEL[r.setup]} <span className={r.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'}>{r.direction.toUpperCase()}</span>
          </div>
          <div className="text-xs text-slate-400">
            {r.symbol} · {mk(r.market)}
          </div>
        </div>
        {r.doNotUse && <span className="rounded bg-rose-700 px-2 py-0.5 text-[11px] font-bold text-white">NO USAR</span>}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1 text-xs">
        <Kv k="Trades" v={String(s.trades)} />
        <Kv k="Aciertos" v={`${n(s.winRate * 100, 0)}%`} />
        <Kv k="R:R" v={n(s.avgRR)} />
        <Kv k="Exp." v={`${n(track === 'r' ? s.expectancyR : s.expectancy, 3)} ${unit}`} bad={(track === 'r' ? s.expectancyR : s.expectancy) <= 0 && s.trades > 0} />
        <Kv k="Total" v={`${n(track === 'r' ? s.totalR : s.total)} ${unit}`} />
        <Kv k="DD máx." v={`${n(track === 'r' ? s.maxDrawdownR : s.maxDrawdown)} ${unit}`} />
        <Kv k="Liquid." v={String(s.liquidations)} />
        <Kv k="Desc. mín." v={String(r.discardedByMinimums)} />
      </div>
    </div>
  );
}

const Kv = ({ k, v, bad }: { k: string; v: string; bad?: boolean }) => (
  <div>
    <div className="text-[10px] uppercase text-slate-500">{k}</div>
    <div className={`font-mono ${bad ? 'text-rose-400' : ''}`}>{v}</div>
  </div>
);

function DiscardSummary({ run, track }: { run: NonNullable<ReturnType<typeof useBacktest>['run']>; track: 'r' | 'usdt' }) {
  const d: Record<string, number> = {};
  for (const x of run.result.discards) if (x.track === track) d[x.code] = (d[x.code] ?? 0) + 1;
  const nf = run.result.notFilled.filter((x) => x.track === track).length;
  const label: Record<string, string> = {
    'rr-insuficiente': 'R:R insuficiente',
    'sin-objetivo': 'Sin zona objetivo',
    minimos: 'No alcanzan el mínimo del par en tu fase',
    'riesgo-excesivo': 'Riesgo real > 2× el configurado',
    liquidacion: 'Stop demasiado cerca de la liquidación',
    'stop-invalido': 'Stop inválido',
  };
  return (
    <div className="card text-xs text-slate-300">
      <div className="mb-1 font-medium">Señales descartadas</div>
      {Object.entries(d).map(([k, v]) => (
        <div key={k} className="flex justify-between">
          <span>{label[k] ?? k}</span>
          <span className="font-mono">{v}</span>
        </div>
      ))}
      <div className="flex justify-between">
        <span>Entradas que no se ejecutaron (vencidas o el precio se escapó)</span>
        <span className="font-mono">{nf}</span>
      </div>
      <div className="mt-1 text-slate-500">
        Velas ambiguas resueltas asumiendo stop: {run.result.assumedWorst} · sin velas de 1m: {run.result.unresolved.length}
      </div>
    </div>
  );
}
