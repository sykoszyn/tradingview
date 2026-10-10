'use client';
import { SYMBOLS, type Market } from '@/lib/types';
import { computeMinimums } from '@/lib/market/filters';
import { formatStep } from '@/lib/market/rounding';
import { SOURCE_LABEL } from '@/lib/data/client';
import type { MarketMeta } from '@/hooks/useMarketMeta';
import { usePairPrices } from '@/hooks/usePairPrices';

const fmt = (n: number, d = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function MinimumsTable({ meta, market, phaseMaxMargin, phaseMaxLev }: { meta: MarketMeta; market: Market; phaseMaxMargin: number; phaseMaxLev: number }) {
  const { prices, error } = usePairPrices(market);
  const levs = market === 'spot' ? [1] : [1, 2, 3];
  const src = meta.filterSources[market];
  return (
    <div className="card space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Mínimos de orden — {market === 'spot' ? 'Spot' : 'Futuros USDT-M'}</h3>
        <span className="text-[11px] text-slate-400">{src ? SOURCE_LABEL[src] : '…'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table-compact w-full [&_td]:!px-1 [&_td]:!text-xs [&_th]:!px-1">
          <thead>
            <tr>
              <th>Par</th>
              <th>Cant.</th>
              <th>Nocional</th>
              {levs.map((l) => (
                <th key={l}>{l}x</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SYMBOLS.map((s) => {
              const f = meta.filters[market][s];
              const p = prices[s];
              if (!f || !p)
                return (
                  <tr key={s}>
                    <td>{s}</td>
                    <td colSpan={2 + levs.length} className="text-slate-500">
                      {meta.loading ? 'Cargando…' : 'Sin datos'}
                    </td>
                  </tr>
                );
              const m = computeMinimums(f, p);
              return (
                <tr key={s} className="border-t border-slate-800">
                  <td className="font-medium">{s}</td>
                  <td>{formatStep(m.minQty, Math.max(f.stepSize, f.marketStepSize))}</td>
                  <td>{fmt(m.minNotional)}</td>
                  {levs.map((l) => {
                    const mg = m.marginAt(l);
                    const ok = market === 'spot' ? mg <= phaseMaxMargin : l <= phaseMaxLev && mg <= phaseMaxMargin;
                    return (
                      <td key={l} className={ok ? 'text-emerald-400' : 'text-rose-400'}>
                        {fmt(mg)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400">
        Valores en USDT. Columnas 1x/2x/3x = margen mínimo con ese apalancamiento. Nocional mínimo = max(MIN_NOTIONAL, cantidad mínima × precio), con la cantidad redondeada al stepSize. Verde: operable con tu fase actual
        (margen máx. {phaseMaxMargin} USDT{market === 'futures' ? `, hasta ${phaseMaxLev}x` : ''}). Se actualiza al iniciar y cada 1 hora.
      </p>
      {error && <p className="text-xs text-rose-400">Precios: {error}</p>}
    </div>
  );
}
