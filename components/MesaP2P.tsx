'use client';
import { useMemo, useState } from 'react';
import { PLATFORMS, PLAT_NAME, type Ad, type Platform, type PlatformBook, type Side } from '@/lib/p2p/types';
import { DROP_LABEL, filterSide, type FilteredSide, type FilterSettings } from '@/lib/p2p/filters';
import { PAY_METHODS, methodLabels } from '@/lib/p2p/methods';
import { parseNum, scenario, SCENARIOS, suggest, type Best, type CalcSettings, type Scenario } from '@/lib/p2p/calc';
import { autoReply, COUNTERPARTY_REQS, termsText, type AdSide } from '@/lib/p2p/ad-text';
import { useMarket, REFRESH_MS } from '@/hooks/useMarket';
import { useSettings, type Settings } from '@/hooks/useSettings';

const ars = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? 'sin dato' : '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? 'sin dato' : n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? 'sin dato' : num(n * 100) + ' %');
const time = (t: number) => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface Market {
  usable: Record<Platform, boolean>;
  sides: Record<Platform, Record<Side, FilteredSide> | null>;
  best: Record<Platform, Best>;
}

export function MesaP2P() {
  const { s, update } = useSettings();
  const market = useMarket();

  const filters: FilterSettings = useMemo(
    () => ({
      merchantOnly: s.filters.merchantOnly,
      minFinishRatePct: parseNum(s.filters.minFinish) ?? 0,
      minOrders: parseNum(s.filters.minOrders) ?? 0,
      myMethods: s.methods,
      amountArs: parseNum(s.filters.amount),
      outlierPct: parseNum(s.filters.outlier) ?? 100,
    }),
    [s.filters, s.methods],
  );

  const calc: CalcSettings = useMemo(() => {
    const fee = (v: string) => {
      const n = parseNum(v);
      return n === null ? null : n / 100;
    };
    return {
      fees: {
        binance: { maker: fee(s.fees.binance.maker), taker: fee(s.fees.binance.taker) },
        mexc: { maker: fee(s.fees.mexc.maker), taker: fee(s.fees.mexc.taker) },
      },
      withdrawUsdt: { binance: parseNum(s.wd.binance), mexc: parseNum(s.wd.mexc) },
      capitalArs: parseNum(s.capArs) ?? 0,
      capitalUsdt: parseNum(s.capUsdt) ?? 0,
      minMargin: (parseNum(s.minMargin) ?? 0) / 100,
      step: Math.max(0, parseNum(s.step) ?? 0),
    };
  }, [s]);

  const m: Market = useMemo(() => {
    const usable = { binance: false, mexc: false } as Record<Platform, boolean>;
    const sides = { binance: null, mexc: null } as Market['sides'];
    const best = { binance: { bid: null, ask: null }, mexc: { bid: null, ask: null } } as Record<Platform, Best>;
    for (const pl of PLATFORMS) {
      const book = market.data?.books[pl];
      if (!book?.ok || market.stale) continue;
      usable[pl] = true;
      const sellers = filterSide(book.sellers, 'sellers', filters);
      const buyers = filterSide(book.buyers, 'buyers', filters);
      sides[pl] = { sellers, buyers };
      best[pl] = { ask: sellers.best, bid: buyers.best };
    }
    return { usable, sides, best };
  }, [market.data, market.stale, filters]);

  const results = SCENARIOS.map(([b, sl]) => scenario(b, sl, m.best, calc, s.mode));

  return (
    <div className="wrap">
      <header className="status-row">
        <div>
          <h1>Mesa P2P USDT</h1>
          <p className="sub">Binance y MEXC · USDT/ARS · se actualiza cada {REFRESH_MS / 1000} s</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button type="button" className="small" onClick={() => void market.refresh()} disabled={market.loading}>
            {market.loading ? 'Leyendo…' : 'Actualizar ahora'}
          </button>
          <p className="status">{market.data ? `Última lectura ${time(market.data.fetchedAt)}` : 'Sin lectura'}</p>
        </div>
      </header>

      <Summary results={results} mode={s.mode} minMargin={calc.minMargin} />
      <PlatformAlerts market={market} />
      <Safety />

      <details className="fold" open>
        <summary>
          <h2>Mercado en vivo</h2>
          <span className="sub">filtrado</span>
        </summary>
        <div className="body">
          <Filters s={s} update={update} />
          {PLATFORMS.map((pl) => (
            <PlatformBox key={pl} pl={pl} book={market.data?.books[pl] ?? null} stale={market.stale} sides={m.sides[pl]} />
          ))}
        </div>
      </details>

      <details className="fold" open>
        <summary>
          <h2>Escenarios</h2>
          <span className="sub">{s.mode === 'maker' ? 'con mis anuncios' : 'tomando anuncios'}</span>
        </summary>
        <div className="body">
          <div className="row">
            <label className="chip">
              <input type="radio" name="mode" id="mode-maker" checked={s.mode === 'maker'} onChange={() => update((x) => ({ ...x, mode: 'maker' }))} /> Con mis anuncios
            </label>
            <label className="chip">
              <input type="radio" name="mode" id="mode-taker" checked={s.mode === 'taker'} onChange={() => update((x) => ({ ...x, mode: 'taker' }))} /> Tomando anuncios
            </label>
          </div>
          <p className="note">
            {s.mode === 'maker'
              ? 'Publicás tus anuncios un poco mejor que el primero de la lista y esperás que te tomen. Ganás más, pero puede tardar.'
              : 'Tomás anuncios que ya existen al mejor precio. Es inmediato, pero el margen suele ser menor.'}
          </p>
          <div className="scen">
            {results.map((r, i) => (
              <ScenarioCard key={i} r={r} title={SCENARIOS[i][2]} usable={m.usable} mode={s.mode} net={s.net} />
            ))}
          </div>
        </div>
      </details>

      <details className="fold">
        <summary>
          <h2>Armado de anuncios</h2>
          <span className="sub">listos para copiar</span>
        </summary>
        <div className="body">
          <div className="ads">
            {PLATFORMS.flatMap((pl) =>
              (['buy', 'sell'] as const).map((side) => <AdCard key={pl + side} pl={pl} side={side} s={s} calc={calc} best={m.best[pl]} usable={m.usable[pl]} />),
            )}
          </div>
        </div>
      </details>

      <SettingsPanel s={s} update={update} />

      <footer>Herramienta de cálculo. No es asesoramiento financiero. Revisá cada precio y comisión en la app antes de operar.</footer>
    </div>
  );
}

// ---------------- Resumen ----------------
function Summary({ results, mode, minMargin }: { results: Scenario[]; mode: 'maker' | 'taker'; minMargin: number }) {
  const valid = results.filter((r) => r.ok);
  const best = valid.length ? valid.reduce((a, b) => ((b.pct ?? -Infinity) > (a.pct ?? -Infinity) ? b : a)) : null;
  const how = mode === 'maker' ? ' (con tu anuncio)' : '';
  return (
    <section className="card hero" aria-live="polite">
      <span className="label">Resumen</span>
      {best ? (
        <div className="lines">
          <p>
            Comprá en <strong>{PLAT_NAME[best.buyPl]}</strong> a <b>{ars(best.B)}</b>
            {how}
          </p>
          <p>
            Vendé en <strong>{PLAT_NAME[best.sellPl]}</strong> a <b>{ars(best.S)}</b>
            {how}
          </p>
          <p>
            Ganás <b>{ars(best.perUsdt)}</b> por USDT ({pct(best.pct)})
            {!best.example && (
              <>
                {' '}
                · <b>{ars(best.profit, 0)}</b> por ciclo
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="empty">Todavía no hay precios utilizables. Esperá la próxima lectura o tocá "Actualizar ahora".</p>
      )}
      <div className="play">
        <strong>La mejor jugada ahora: </strong>
        {!best
          ? 'sin datos.'
          : best.light === 'ok'
            ? `${best.cross ? `comprar en ${PLAT_NAME[best.buyPl]}, pasar los USDT y vender en ${PLAT_NAME[best.sellPl]}` : `comprar y vender dentro de ${PLAT_NAME[best.buyPl]}`}. Supera tu ganancia mínima.`
            : best.light === 'warn'
              ? `${best.cross ? `${PLAT_NAME[best.buyPl]} → ${PLAT_NAME[best.sellPl]}` : `dentro de ${PLAT_NAME[best.buyPl]}`}, pero queda justo: gana menos que tu mínimo de ${num(minMargin * 100)} %.`
              : 'no operar. Con estos precios ningún camino deja ganancia después de comisiones.'}
      </div>
    </section>
  );
}

function PlatformAlerts({ market }: { market: ReturnType<typeof useMarket> }) {
  const msgs: string[] = [];
  if (market.error) msgs.push(market.error + ' No se calcula nada con datos anteriores.');
  else if (market.stale) msgs.push('La última lectura tiene más de 2 minutos: no se usa para calcular. Tocá "Actualizar ahora".');
  else if (market.data)
    for (const pl of PLATFORMS) if (!market.data.books[pl].ok) msgs.push(`Sin datos de ${PLAT_NAME[pl]}. Los escenarios que la usan no se calculan.`);
  if (!msgs.length) return null;
  return (
    <div className="card" style={{ borderColor: 'var(--bad)', background: 'var(--bad-bg)' }} role="alert">
      {msgs.map((t) => (
        <p key={t}>{t}</p>
      ))}
    </div>
  );
}

function Safety() {
  return (
    <section className="card safety">
      <h2>Seguridad</h2>
      <ul>
        <li>Aceptá pagos solo desde cuentas a nombre del mismo titular verificado de la orden. Nada de terceros.</li>
        <li>No liberes USDT hasta ver la plata acreditada en tu cuenta. Un comprobante no alcanza.</li>
        <li>Operá siempre dentro del chat de la plataforma, nunca por WhatsApp ni por fuera.</li>
        <li>Si hacés esto seguido, puede tener impacto impositivo (ARCA). Guardá registro de cada operación.</li>
      </ul>
    </section>
  );
}

// ---------------- Mercado ----------------
type Upd = (fn: (s: Settings) => Settings) => void;

function Filters({ s, update }: { s: Settings; update: Upd }) {
  const setF = (k: keyof Settings['filters'], v: string | boolean) => update((x) => ({ ...x, filters: { ...x.filters, [k]: v } }));
  return (
    <details className="ad">
      <summary>
        <h3>Filtros</h3>
        <span className="sub">
          {s.filters.merchantOnly ? 'comerciantes' : 'todos'} · ≥{s.filters.minFinish} % · ≥{s.filters.minOrders} órdenes
        </span>
      </summary>
      <div className="fields" style={{ padding: 12, gap: 10, display: 'grid' }}>
        <label className="toggle">
          <input type="checkbox" id="f-merchant" checked={s.filters.merchantOnly} onChange={(e) => setF('merchantOnly', e.target.checked)} />
          Solo comerciantes verificados
        </label>
        <div className="grid2">
          <label className="f">
            Finalización mínima (%)
            <input type="text" inputMode="decimal" id="f-finish" value={s.filters.minFinish} onChange={(e) => setF('minFinish', e.target.value)} />
          </label>
          <label className="f">
            Órdenes completadas (30 días)
            <input type="text" inputMode="numeric" id="f-orders" value={s.filters.minOrders} onChange={(e) => setF('minOrders', e.target.value)} />
          </label>
          <label className="f">
            Monto que quiero operar (ARS)
            <input type="text" inputMode="decimal" id="f-amount" placeholder="no filtrar" value={s.filters.amount} onChange={(e) => setF('amount', e.target.value)} />
          </label>
          <label className="f">
            Descartar si se aleja de la mediana más de (%)
            <input type="text" inputMode="decimal" id="f-outlier" value={s.filters.outlier} onChange={(e) => setF('outlier', e.target.value)} />
          </label>
        </div>
        <p className="note">También se filtra por tus métodos de pago (en Mi configuración).</p>
      </div>
    </details>
  );
}

function PlatformBox({ pl, book, stale, sides }: { pl: Platform; book: PlatformBook | null; stale: boolean; sides: Record<Side, FilteredSide> | null }) {
  if (!book || !book.ok || stale || !sides) {
    return (
      <div className="platbox down">
        <h3>{PLAT_NAME[pl]}</h3>
        <p>
          <strong>Sin datos de {PLAT_NAME[pl]}.</strong> {stale ? 'La lectura quedó vieja.' : book?.error ?? 'Esperando la primera lectura.'}
        </p>
        {pl === 'mexc' && book && !book.ok && (
          <p className="note">
            MEXC bloquea las conexiones desde EE.UU. y no publica el endpoint que usa su página P2P. Cuando tengamos esa dirección (copiada desde tu
            navegador), MEXC se lee igual que Binance.
          </p>
        )}
      </div>
    );
  }
  const bid = sides.buyers.best;
  const ask = sides.sellers.best;
  return (
    <div className="platbox">
      <div className="status-row">
        <h3>{PLAT_NAME[pl]}</h3>
        <span className="status">
          {time(book.fetchedAt)} · {book.source}
        </span>
      </div>
      <div className="grid2 best">
        <p>
          Mejor comprador: <b>{ars(bid)}</b>
        </p>
        <p>
          Mejor vendedor: <b>{ars(ask)}</b>
        </p>
        <p style={{ gridColumn: '1/-1' }}>
          Diferencia (spread): <b>{ask !== null && bid !== null ? `${ars(ask - bid)} · ${pct((ask - bid) / bid)}` : 'sin dato'}</b>
        </p>
      </div>
      <AdTable title="Compradores (te pagan por USDT)" side={sides.buyers} />
      <AdTable title="Vendedores (te venden USDT)" side={sides.sellers} />
    </div>
  );
}

function AdTable({ title, side }: { title: string; side: FilteredSide }) {
  const reasons = side.dropped.reduce<Record<string, number>>((acc, d) => ((acc[DROP_LABEL[d.reason]] = (acc[DROP_LABEL[d.reason]] ?? 0) + 1), acc), {});
  return (
    <div>
      <div className="status-row">
        <strong style={{ fontSize: '.95rem' }}>{title}</strong>
        <span className="status">
          {side.kept.length} de {side.total} pasan los filtros
        </span>
      </div>
      {side.kept.length ? (
        <div className="tablewrap">
          <table className="adtable">
            <thead>
              <tr>
                <th>Precio</th>
                <th>Límites (ARS)</th>
                <th>Anunciante</th>
              </tr>
            </thead>
            <tbody>
              {side.kept.slice(0, 5).map((a) => (
                <AdRow key={a.id} a={a} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="warnline">Ningún anuncio pasa los filtros: no hay precio para calcular de este lado.</p>
      )}
      {side.dropped.length > 0 && (
        <p className="note">
          Descartados: {Object.entries(reasons).map(([k, v]) => `${v} por ${k}`).join(', ')}.
        </p>
      )}
    </div>
  );
}

function AdRow({ a }: { a: Ad }) {
  return (
    <tr>
      <td className="p">{ars(a.price)}</td>
      <td>
        <span className="num">
          {a.min !== null ? num(a.min, 0) : '?'} – {a.max !== null ? num(a.max, 0) : '?'}
        </span>
        <div className="note">{a.methods.join(', ')}</div>
      </td>
      <td>
        {a.nick} {a.merchant && <span className="badge">comerciante</span>}
        <div className="note">
          {a.finishRate !== null ? `${num(a.finishRate * 100, 1)} %` : '?'} · {a.orders ?? '?'} órdenes
        </div>
      </td>
    </tr>
  );
}

// ---------------- Escenarios ----------------
function ScenarioCard({ r, title, usable, mode, net }: { r: Scenario; title: string; usable: Record<Platform, boolean>; mode: 'maker' | 'taker'; net: string }) {
  const lightText = { ok: 'Conviene', warn: 'Justo', bad: 'No conviene' } as const;
  if (!r.ok) {
    const missing = [!usable[r.buyPl] ? `sin datos de ${PLAT_NAME[r.buyPl]}` : null, !usable[r.sellPl] && r.sellPl !== r.buyPl ? `sin datos de ${PLAT_NAME[r.sellPl]}` : null]
      .filter(Boolean)
      .join(' y ');
    return (
      <div className="sc">
        <div className="status-row">
          <h3>{title}</h3>
          <span className="light na">Sin dato</span>
        </div>
        <p className="note">
          {missing ? `No se calcula: ${missing}.` : `Ningún anuncio pasa los filtros de ${r.B === null ? (mode === 'maker' ? 'compradores' : 'vendedores') : mode === 'maker' ? 'vendedores' : 'compradores'}.`}
        </p>
      </div>
    );
  }
  return (
    <div className={`sc ${r.light}`}>
      <div className="status-row">
        <h3>{title}</h3>
        <span className={`light ${r.light}`}>{lightText[r.light!]}</span>
      </div>
      <p className="note">
        Comprás a {ars(r.B)} · vendés a {ars(r.S)}
        {r.cross && ` · transferencia ${net}: −${num(r.W)} USDT`}
      </p>
      <div className="kv">
        <div>
          <small>Por USDT</small>
          <span>{ars(r.perUsdt)}</span>
        </div>
        <div>
          <small>Neto</small>
          <span>{pct(r.pct)}</span>
        </div>
        <div>
          <small>{r.example ? 'Con 100 USDT' : 'Con tu capital'}</small>
          <span>{ars(r.profit, 0)}</span>
        </div>
      </div>
      <p className="note">
        Ciclo de {num(r.q)} USDT{r.example ? ' (ejemplo: cargá tu capital en Mi configuración)' : ''}.
      </p>
      {r.missing.length > 0 && <p className="warnline">Sin cargar: {r.missing.join(', ')}. Se tomó como 0.</p>}
    </div>
  );
}

// ---------------- Anuncios ----------------
function CopyBtn({ text }: { text: string }) {
  const [label, setLabel] = useState('Copiar');
  return (
    <button
      type="button"
      className="small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setLabel('Copiado');
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try {
            ok = document.execCommand('copy');
          } catch {}
          ta.remove();
          setLabel(ok ? 'Copiado' : 'Seleccioná y copiá');
        }
        setTimeout(() => setLabel('Copiar'), 1600);
      }}
    >
      {label}
    </button>
  );
}

function Field({ k, v, why, copy }: { k: string; v: React.ReactNode; why?: string; copy: string }) {
  return (
    <div className="fld">
      <div>
        <div className="k">{k}</div>
        <div className="v">{v}</div>
        {why && <div className="why">{why}</div>}
      </div>
      <CopyBtn text={copy} />
    </div>
  );
}

function AdCard({ pl, side, s, calc, best, usable }: { pl: Platform; side: AdSide; s: Settings; calc: CalcSettings; best: Best; usable: boolean }) {
  const sg = suggest(best, calc.fees[pl], calc);
  const price = side === 'buy' ? sg.buy : sg.sell;
  const qty = price ? (side === 'buy' ? calc.capitalArs / price : calc.capitalUsdt) : null;
  const maxOrder = qty && price ? Math.floor((qty * price) / 1000) * 1000 : null;
  const minUser = parseNum(s.minOrder);
  let minOrder = minUser ?? (maxOrder ? Math.max(1000, Math.round((maxOrder * 0.1) / 1000) * 1000) : null);
  if (minOrder !== null && maxOrder !== null && minOrder > maxOrder) minOrder = maxOrder;
  const ref = parseNum(s.ref[pl]);
  const floatPct = price && ref ? (price / ref) * 100 : null;
  const methods = methodLabels(s.methods).join(', ') || 'sin elegir';
  const top = side === 'buy' ? sg.buyTop : sg.sellTop;
  const priceWhy = !usable
    ? `Sin datos de ${PLAT_NAME[pl]}.`
    : price === null
      ? 'Ningún anuncio pasa los filtros de este lado.'
      : side === 'buy'
        ? top
          ? `${ars(calc.step)} arriba del mejor comprador (${ars(best.bid)}), así quedás primero.`
          : sg.note ?? 'Bajado para respetar tu ganancia mínima.'
        : `${ars(calc.step)} debajo del mejor vendedor (${ars(best.ask)}), así quedás primero.`;
  return (
    <details className="ad" open={pl === 'binance' && side === 'buy'}>
      <summary>
        <h3>
          {PLAT_NAME[pl]} · {side === 'buy' ? 'Compra' : 'Venta'}
        </h3>
        <span className={`tag ${side}`}>{side === 'buy' ? 'Compro USDT' : 'Vendo USDT'}</span>
      </summary>
      <div className="fields">
        <Field
          k="Tipo de precio"
          v={floatPct !== null ? `Fijo (o flotante al ${num(floatPct)} %)` : 'Fijo'}
          why="Recomiendo fijo: controlás exacto tu margen. Como la web se actualiza cada minuto, ajustalo cuando cambie el precio sugerido. El flotante se mueve solo con el precio de referencia, sirve si no vas a mirar la app."
          copy={floatPct !== null ? `Fijo · o flotante ${num(floatPct)} %` : 'Fijo'}
        />
        <Field k="Precio" v={<span className="num">{ars(price)}</span>} why={priceWhy} copy={price !== null ? price.toFixed(2).replace('.', ',') : ''} />
        <Field
          k="Cantidad total"
          v={<span className="num">{qty ? `${num(qty)} USDT` : 'sin dato'}</span>}
          why={qty ? (side === 'buy' ? `Con tus ${ars(calc.capitalArs, 0)} a ese precio.` : 'Todos tus USDT disponibles.') : 'Cargá tu capital en Mi configuración.'}
          copy={qty ? qty.toFixed(2).replace('.', ',') : ''}
        />
        <Field
          k="Límite por orden (ARS)"
          v={<span className="num">{minOrder !== null && maxOrder !== null ? `${ars(minOrder, 0)} a ${ars(maxOrder, 0)}` : 'sin dato'}</span>}
          why={minUser === null ? 'Mínimo automático: 10 % del máximo. Podés fijarlo en Mi configuración.' : undefined}
          copy={minOrder !== null && maxOrder !== null ? `${minOrder} - ${maxOrder}` : ''}
        />
        <Field k="Métodos de pago" v={methods} copy={methods} />
        <Field
          k="Tiempo de pago"
          v={`${s.payTime} min`}
          why={side === 'buy' ? 'Tiempo que tenés vos para pagar.' : 'Tiempo que tiene el comprador para pagarte.'}
          copy={`${s.payTime} min`}
        />
        <Field k="Requisitos de contraparte" v={COUNTERPARTY_REQS} why="Recomendado. Activá los que tu app permita." copy={COUNTERPARTY_REQS} />
        <Field k="Términos / Observaciones" v={<pre>{termsText(pl, side, methods)}</pre>} copy={termsText(pl, side, methods)} />
        <Field k="Respuesta automática" v={<pre>{autoReply(pl, side, methods)}</pre>} copy={autoReply(pl, side, methods)} />
      </div>
    </details>
  );
}

// ---------------- Configuración ----------------
function SettingsPanel({ s, update }: { s: Settings; update: Upd }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update((x) => ({ ...x, [k]: v }));
  const setFee = (pl: Platform, kind: 'maker' | 'taker', v: string) => update((x) => ({ ...x, fees: { ...x.fees, [pl]: { ...x.fees[pl], [kind]: v } } }));
  const toggle = (id: string, on: boolean) => update((x) => ({ ...x, methods: on ? [...new Set([...x.methods, id])] : x.methods.filter((m) => m !== id) }));
  return (
    <details className="fold">
      <summary>
        <h2>Mi configuración</h2>
        <span className="sub">se guarda sola</span>
      </summary>
      <div className="body">
        <h3>Comisiones por operación (%)</h3>
        <p className="note">Cargá las que ves en cada app para tu cuenta. Si dejás un campo vacío se calcula como 0 % y te avisamos.</p>
        <div className="grid2">
          {PLATFORMS.flatMap((pl) =>
            (['maker', 'taker'] as const).map((kind) => (
              <label key={pl + kind} className="f">
                {PLAT_NAME[pl]} · {kind === 'maker' ? 'con mi anuncio (maker)' : 'tomando anuncio (taker)'}
                <input type="text" inputMode="decimal" id={`fee-${pl}-${kind}`} placeholder="sin dato" value={s.fees[pl][kind]} onChange={(e) => setFee(pl, kind, e.target.value)} />
              </label>
            )),
          )}
        </div>

        <h3>Pasar USDT de una plataforma a otra</h3>
        <div className="grid3">
          <label className="f">
            Red
            <select id="net" value={s.net} onChange={(e) => set('net', e.target.value)}>
              {['TRC20', 'BEP20', 'Polygon', 'Solana', 'Arbitrum', 'Otra'].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="f">
            Retiro Binance→MEXC (USDT)
            <input type="text" inputMode="decimal" id="wd-binance" placeholder="sin dato" value={s.wd.binance} onChange={(e) => set('wd', { ...s.wd, binance: e.target.value })} />
          </label>
          <label className="f">
            Retiro MEXC→Binance (USDT)
            <input type="text" inputMode="decimal" id="wd-mexc" placeholder="sin dato" value={s.wd.mexc} onChange={(e) => set('wd', { ...s.wd, mexc: e.target.value })} />
          </label>
        </div>

        <h3>Mi capital y mi margen</h3>
        <div className="grid3">
          <label className="f">
            Pesos disponibles (ARS)
            <input type="text" inputMode="decimal" id="capArs" placeholder="0" value={s.capArs} onChange={(e) => set('capArs', e.target.value)} />
          </label>
          <label className="f">
            USDT disponibles
            <input type="text" inputMode="decimal" id="capUsdt" placeholder="0" value={s.capUsdt} onChange={(e) => set('capUsdt', e.target.value)} />
          </label>
          <label className="f">
            Ganancia mínima por ciclo (%)
            <input type="text" inputMode="decimal" id="minMargin" value={s.minMargin} onChange={(e) => set('minMargin', e.target.value)} />
          </label>
        </div>
        <div className="grid3">
          <label className="f">
            Mejorar el precio en (ARS)
            <input type="text" inputMode="decimal" id="step" value={s.step} onChange={(e) => set('step', e.target.value)} />
          </label>
          <label className="f">
            Mínimo por orden (ARS)
            <input type="text" inputMode="decimal" id="minOrder" placeholder="automático" value={s.minOrder} onChange={(e) => set('minOrder', e.target.value)} />
          </label>
          <label className="f">
            Tiempo de pago (min)
            <select id="payTime" value={s.payTime} onChange={(e) => set('payTime', e.target.value)}>
              {['15', '30', '45', '60'].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid2">
          {PLATFORMS.map((pl) => (
            <label key={pl} className="f">
              Precio de referencia {PLAT_NAME[pl]} (opcional)
              <input type="text" inputMode="decimal" id={`ref-${pl}`} placeholder="para anuncio flotante" value={s.ref[pl]} onChange={(e) => set('ref', { ...s.ref, [pl]: e.target.value })} />
            </label>
          ))}
        </div>

        <h3>Métodos de pago que uso</h3>
        <p className="note">Se usan para filtrar los anuncios y para armar los tuyos.</p>
        <div className="chips">
          {PAY_METHODS.map((pm) => (
            <label key={pm.id} className="chip">
              <input type="checkbox" id={`pm-${pm.id}`} checked={s.methods.includes(pm.id)} onChange={(e) => toggle(pm.id, e.target.checked)} /> {pm.label}
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}
