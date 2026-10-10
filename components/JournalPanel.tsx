'use client';
import { useMemo, useRef, useState } from 'react';
import type { AppConfig } from '@/lib/config/defaults';
import { SYMBOLS, type Direction, type Market, type TradingSymbol } from '@/lib/types';
import { SETUP_LABEL } from '@/lib/analysis/setups';
import type { TradePlan } from '@/lib/plan/plan';
import { computeStats, groupStats, type Stats } from '@/lib/backtest/metrics';
import { paperStatusLabel } from '@/lib/journal/paper';
import { compareWithPlan, realNetPnl, realR, validateRealTrade } from '@/lib/journal/real';
import type { JournalData, PaperTrade, RealTrade } from '@/lib/journal/types';
import { exportBundle, importBundle } from '@/lib/storage/repository';
import type { JournalApi } from '@/hooks/useJournal';

const n = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '∞');
const dt = (t: number) => new Date(t).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (t: number) => {
  const d = new Date(t - 3 * 3_600_000); // Buenos Aires = UTC−3
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (s: string) => Date.parse(`${s}:00-03:00`);

export function JournalPanel({
  journal,
  cfg,
  phase,
  draftPlan,
  clearDraft,
  onConfigImport,
  engineStatus,
}: {
  journal: JournalApi;
  cfg: AppConfig;
  phase: number;
  draftPlan: TradePlan | null;
  clearDraft: () => void;
  onConfigImport: (c: unknown) => void;
  engineStatus: string | null;
}) {
  const d = journal.data!;
  const [view, setView] = useState<'paper' | 'real'>(draftPlan ? 'real' : 'paper');
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const doExport = () => {
    const blob = new Blob([exportBundle(d, cfg)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `diario-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (f: File) => {
    try {
      const { journal: j, config } = importBundle(await f.text());
      if (!window.confirm(`Esto reemplaza tu diario actual por el del archivo (${j.paper.length} simulados, ${j.real.length} reales). ¿Seguir?`)) return;
      journal.replace(j);
      if (config) onConfigImport(config);
      setMsg('Datos importados.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {(['paper', 'real'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`btn flex-1 ${view === v ? 'bg-slate-700 text-white' : 'border border-slate-800 text-slate-400'}`}>
            {v === 'paper' ? `Simulados (${d.paper.length})` : `Reales (${d.real.length})`}
          </button>
        ))}
      </div>
      {journal.error && <div className="rounded-lg border border-rose-800 bg-rose-950/60 p-2 text-xs text-rose-200">{journal.error}</div>}
      {engineStatus && <div className="text-xs text-sky-300">{engineStatus}</div>}

      {view === 'paper' ? <PaperView d={d} journal={journal} /> : <RealView d={d} journal={journal} phase={phase} cfg={cfg} draftPlan={draftPlan} clearDraft={clearDraft} />}

      <div className="card flex flex-wrap items-center gap-2 text-sm">
        <button className="btn-ghost" onClick={doExport}>
          Exportar todo (JSON)
        </button>
        <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
          Importar JSON
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        {msg && <span className="text-xs text-slate-300">{msg}</span>}
        <p className="w-full text-[11px] text-slate-500">Los datos se guardan en este navegador. Exportalos seguido para no perderlos si borrás el historial.</p>
      </div>
    </div>
  );
}

function PaperView({ d, journal }: { d: JournalData; journal: JournalApi }) {
  const [filter, setFilter] = useState<'all' | 'auto' | 'manual'>('all');
  const list = d.paper.filter((t) => filter === 'all' || (filter === 'auto' ? t.auto : !t.auto)).sort((a, b) => b.createdAt - a.createdAt);
  const done = list.filter((t) => t.result);
  const rows = done.map((t) => ({ ...t.result!, setup: t.plan.setup, symbol: t.plan.symbol, market: t.plan.market }));
  return (
    <>
      <div className="card flex items-center justify-between gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={d.autoPaper.enabled}
            onChange={(e) => journal.update((j) => ({ ...j, autoPaper: { ...j.autoPaper, enabled: e.target.checked, since: e.target.checked && !j.autoPaper.enabled ? Date.now() : j.autoPaper.since } }))}
          />
          Paper trading automático
        </label>
        <span className="text-[11px] text-slate-400">Simula todas las señales desde {dt(d.autoPaper.since)}</span>
      </div>
      <div className="flex gap-1 text-xs">
        {(['all', 'auto', 'manual'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`btn flex-1 py-1 ${filter === f ? 'bg-slate-800 text-white' : 'text-slate-400'}`}>
            {f === 'all' ? 'Todos' : f === 'auto' ? 'Automáticos' : 'Manuales'}
          </button>
        ))}
      </div>
      <StatsBlock stats={computeStats(rows)} rows={rows} title="Estadísticas de trades simulados" />
      <div className="space-y-2">
        {list.map((t) => (
          <PaperRow key={t.id} t={t} onDelete={() => journal.update((j) => ({ ...j, paper: j.paper.filter((x) => x.id !== t.id) }))} />
        ))}
        {!list.length && <div className="card text-sm text-slate-400">Todavía no hay trades simulados. Usá «Simular este trade» en una señal o dejá activo el paper automático.</div>}
      </div>
    </>
  );
}

function PaperRow({ t, onDelete }: { t: PaperTrade; onDelete: () => void }) {
  const p = t.plan;
  const r = t.result;
  return (
    <div className={`card border-l-4 text-sm ${p.direction === 'long' ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">
            {p.symbol} {p.market === 'futures' ? 'Fut.' : 'Spot'} · {p.direction.toUpperCase()} · {SETUP_LABEL[p.setup]}
          </div>
          <div className="text-xs text-slate-400">
            {dt(p.signalTime + 1)} · {t.auto ? 'automático' : 'manual'} · entrada {n(p.entry)} · stop {n(p.stop)} · TP1 {n(p.tp1)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs">{paperStatusLabel(t)}</div>
          {r && (
            <div className={`font-mono ${r.netPnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {r.netPnl > 0 ? '+' : ''}
              {n(r.netPnl, 3)} USDT · {r.r > 0 ? '+' : ''}
              {n(r.r)} R
            </div>
          )}
        </div>
      </div>
      {r && (
        <div className="mt-1 text-[11px] text-slate-500">
          Comisiones {n(r.fees, 4)} · funding {n(r.funding, 4)} · cerró {dt(r.exitTime)}
        </div>
      )}
      {!t.auto && (
        <button className="mt-1 text-[11px] text-slate-500 underline" onClick={onDelete}>
          Borrar
        </button>
      )}
    </div>
  );
}

function RealView({ d, journal, phase, cfg, draftPlan, clearDraft }: { d: JournalData; journal: JournalApi; phase: number; cfg: AppConfig; draftPlan: TradePlan | null; clearDraft: () => void }) {
  const [showForm, setShowForm] = useState(!!draftPlan);
  const rows = d.real.map((t) => ({ netPnl: realNetPnl(t), r: realR(t), exitTime: t.closedAt, setup: t.setup ?? 'sin-plan', symbol: t.symbol, market: t.market }));
  return (
    <>
      {phase < 2 && (
        <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-200">
          Estás en fase de práctica: la app no recomienda operar con dinero real. Si igual lo hacés, registralo acá para comparar.
        </div>
      )}
      <StatsBlock stats={computeStats(rows)} rows={rows} title="Estadísticas de trades reales" />
      <button className="btn-primary w-full" onClick={() => setShowForm(!showForm)}>
        {showForm ? 'Cerrar formulario' : 'Registrar trade real'}
      </button>
      {showForm && (
        <RealForm
          plan={draftPlan}
          phase={phase}
          cfg={cfg}
          onSave={(t) => {
            journal.update((j) => ({ ...j, real: [...j.real, t] }));
            setShowForm(false);
            clearDraft();
          }}
        />
      )}
      <div className="space-y-2">
        {[...d.real]
          .sort((a, b) => b.closedAt - a.closedAt)
          .map((t) => (
            <RealRow key={t.id} t={t} onDelete={() => window.confirm('¿Borrar este trade real?') && journal.update((j) => ({ ...j, real: j.real.filter((x) => x.id !== t.id) }))} />
          ))}
      </div>
    </>
  );
}

function RealRow({ t, onDelete }: { t: RealTrade; onDelete: () => void }) {
  const pnl = realNetPnl(t);
  const cmp = compareWithPlan(t);
  return (
    <div className={`card border-l-4 text-sm ${t.direction === 'long' ? 'border-l-emerald-500' : 'border-l-rose-500'}`}>
      <div className="flex justify-between gap-2">
        <div>
          <div className="font-medium">
            {t.symbol} {t.market === 'futures' ? 'Fut.' : 'Spot'} · {t.direction.toUpperCase()} {t.setup ? `· ${SETUP_LABEL[t.setup]}` : ''}
          </div>
          <div className="text-xs text-slate-400">
            {dt(t.openedAt)} → {dt(t.closedAt)} · {n(t.entryPrice)} → {n(t.exitPrice)} · cant. {t.qty}
          </div>
        </div>
        <div className={`text-right font-mono ${pnl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {pnl > 0 ? '+' : ''}
          {n(pnl, 3)} USDT
          {t.planned && <div className="text-xs">{n(realR(t))} R</div>}
        </div>
      </div>
      {cmp && (
        <div className="mt-1 text-[11px] text-slate-400">
          Vs. plan: entrada {cmp.entrySlippagePct >= 0 ? 'peor' : 'mejor'} por {n(Math.abs(cmp.entrySlippagePct), 3)}% · cantidad {cmp.qtyDiffPct >= 0 ? '+' : ''}
          {n(cmp.qtyDiffPct, 1)}%
        </div>
      )}
      {t.notes && <div className="mt-1 text-xs text-slate-300">{t.notes}</div>}
      <button className="mt-1 text-[11px] text-slate-500 underline" onClick={onDelete}>
        Borrar
      </button>
    </div>
  );
}

function RealForm({ plan, phase, cfg, onSave }: { plan: TradePlan | null; phase: number; cfg: AppConfig; onSave: (t: RealTrade) => void }) {
  const now = Date.now();
  const [f, setF] = useState({
    symbol: (plan?.symbol ?? 'ETHUSDT') as TradingSymbol,
    market: (plan?.market ?? 'futures') as Market,
    direction: (plan?.direction ?? 'long') as Direction,
    entryPrice: plan ? String(plan.entry) : '',
    exitPrice: '',
    qty: plan ? String(plan.sizing.qty) : '',
    fees: '',
    funding: '0',
    leverage: plan ? String(plan.sizing.leverage) : '1',
    openedAt: toLocalInput(now - 3_600_000),
    closedAt: toLocalInput(now),
    notes: '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    const t: RealTrade = {
      id: `r-${Date.now()}`,
      kind: 'real',
      createdAt: Date.now(),
      planId: plan?.id,
      strategyId: plan ? cfg.strategyId : undefined,
      symbol: f.symbol,
      market: f.market,
      direction: f.direction,
      setup: plan?.setup,
      entryPrice: Number(f.entryPrice.replace(',', '.')),
      exitPrice: Number(f.exitPrice.replace(',', '.')),
      qty: Number(f.qty.replace(',', '.')),
      fees: Number((f.fees || '0').replace(',', '.')),
      funding: Number((f.funding || '0').replace(',', '.')),
      leverage: Number(f.leverage),
      openedAt: fromLocalInput(f.openedAt),
      closedAt: fromLocalInput(f.closedAt),
      notes: f.notes || undefined,
      planned: plan && plan.status === 'operable' ? { entry: plan.entry, stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, qty: plan.sizing.qty, riskUSDT: plan.sizing.realRiskUSDT } : undefined,
      phaseAtEntry: phase,
    };
    const errs = validateRealTrade(t);
    setErrors(errs);
    if (!errs.length) onSave(t);
  };
  return (
    <div className="card space-y-2 text-sm">
      {plan && (
        <div className="text-xs text-slate-400">
          Plan sugerido: entrada {n(plan.entry)} · stop {n(plan.stop)} · TP1 {n(plan.tp1)} · cantidad {plan.sizing.qty}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <select className="input" value={f.symbol} onChange={set('symbol')}>
          {SYMBOLS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="input" value={f.market} onChange={set('market')}>
          <option value="futures">Futuros</option>
          <option value="spot">Spot</option>
        </select>
        <select className="input" value={f.direction} onChange={set('direction')}>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Precio de entrada">
          <input className="input" inputMode="decimal" value={f.entryPrice} onChange={set('entryPrice')} />
        </Field>
        <Field label="Precio de salida (promedio)">
          <input className="input" inputMode="decimal" value={f.exitPrice} onChange={set('exitPrice')} />
        </Field>
        <Field label="Cantidad">
          <input className="input" inputMode="decimal" value={f.qty} onChange={set('qty')} />
        </Field>
        <Field label="Apalancamiento">
          <input className="input" inputMode="numeric" value={f.leverage} onChange={set('leverage')} />
        </Field>
        <Field label="Comisiones reales (USDT)">
          <input className="input" inputMode="decimal" value={f.fees} onChange={set('fees')} />
        </Field>
        <Field label="Funding (USDT, + pagado)">
          <input className="input" inputMode="decimal" value={f.funding} onChange={set('funding')} />
        </Field>
        <Field label="Apertura (hora Arg.)">
          <input className="input" type="datetime-local" value={f.openedAt} onChange={set('openedAt')} />
        </Field>
        <Field label="Cierre (hora Arg.)">
          <input className="input" type="datetime-local" value={f.closedAt} onChange={set('closedAt')} />
        </Field>
      </div>
      <Field label="Notas">
        <textarea className="input" rows={2} value={f.notes} onChange={set('notes')} />
      </Field>
      {errors.length > 0 && <div className="text-xs text-rose-300">{errors.join(' ')}</div>}
      <button className="btn-primary w-full" onClick={submit}>
        Guardar trade real
      </button>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="label">{label}</span>
    {children}
  </label>
);

function StatsBlock({ stats: s, rows, title }: { stats: Stats; rows: Array<{ netPnl: number; r: number; exitTime: number; setup: string; symbol: string; market: string }>; title: string }) {
  const bySetup = useMemo(() => groupStats(rows, (r) => r.setup), [rows]);
  const byPair = useMemo(() => groupStats(rows, (r) => `${r.symbol} ${r.market === 'futures' ? 'Fut.' : 'Spot'}`), [rows]);
  const tiles: Array<[string, string, boolean?]> = [
    ['Trades', String(s.trades)],
    ['Resultado', `${n(s.total, 3)} USDT`, s.trades ? s.total > 0 : undefined],
    ['Aciertos', `${n(s.winRate * 100, 0)}%`],
    ['Expectativa', `${n(s.expectancyR, 3)} R`, s.trades ? s.expectancyR > 0 : undefined],
    ['Racha actual', s.currentStreak > 0 ? `${s.currentStreak} ganadoras` : s.currentStreak < 0 ? `${-s.currentStreak} perdedoras` : '—'],
    ['DD máximo', `${n(s.maxDrawdown, 3)} USDT`],
  ];
  return (
    <div className="card space-y-2">
      <div className="text-sm font-semibold">{title}</div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(([k, v, good]) => (
          <div key={k}>
            <div className="text-[11px] text-slate-400">{k}</div>
            <div className={`font-mono text-sm ${good === undefined ? '' : good ? 'text-emerald-400' : 'text-rose-400'}`}>{v}</div>
          </div>
        ))}
      </div>
      {s.trades > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-slate-400">Por setup y por par</summary>
          <div className="mt-1 grid gap-2 text-xs sm:grid-cols-2">
            <GroupTable title="Setup" groups={bySetup} label={(k) => SETUP_LABEL[k as keyof typeof SETUP_LABEL] ?? 'Sin plan'} />
            <GroupTable title="Par" groups={byPair} label={(k) => k} />
          </div>
        </details>
      )}
    </div>
  );
}

function GroupTable({ title, groups, label }: { title: string; groups: Map<string, Stats>; label: (k: string) => string }) {
  return (
    <table className="table-compact w-full">
      <thead>
        <tr>
          <th>{title}</th>
          <th>Tr.</th>
          <th>Acierto</th>
          <th>Exp. R</th>
        </tr>
      </thead>
      <tbody>
        {[...groups.entries()].map(([k, s]) => (
          <tr key={k} className="border-t border-slate-800">
            <td className="!text-xs">{label(k)}</td>
            <td className="!text-xs">{s.trades}</td>
            <td className="!text-xs">{n(s.winRate * 100, 0)}%</td>
            <td className={`!text-xs ${s.expectancyR > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{n(s.expectancyR, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
