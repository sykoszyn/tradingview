# Mesa P2P USDT

Web pensada para el celular que lee sola los anuncios P2P USDT/ARS de **Binance** y **MEXC**. Con esos precios te dice a cuánto comprar y vender, cuánto ganás neto de comisiones y cómo armar cada anuncio. No pide claves, no se conecta a tu cuenta y no opera por vos.

> Herramienta de cálculo. No es asesoramiento financiero.

## Datos de mercado

La web no tiene campos para cargar precios. Pide `/api/p2p` al abrirse y después cada 60 segundos; también hay un botón "Actualizar ahora". Esa ruta de servidor corre en Vercel, en la región `gru1` (São Paulo), consulta las plataformas y le devuelve los anuncios a la web.

### Binance: funcionando

```
POST https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search
Content-Type: application/json
{ "fiat": "ARS", "asset": "USDT", "tradeType": "BUY", "page": 1, "rows": 20, "payTypes": [], "publisherType": null }
```

- `tradeType: "BUY"` trae los anuncios de quienes **venden** USDT (la pestaña "Comprar" de la app). `"SELL"` trae los de quienes **compran** USDT (la pestaña "Vender").
- De cada anuncio se usa:
  - `adv.price`
  - `adv.minSingleTransAmount`
  - `adv.dynamicMaxSingleTransAmount`, que es el máximo que se puede operar ahora
  - `adv.tradableQuantity`
  - `adv.tradeMethods[].identifier` y `.tradeMethodName`
  - `advertiser.userType`: `"merchant"` significa comerciante verificado
  - `advertiser.monthFinishRate` (0 a 1) y `advertiser.monthOrderCount`
- No manda cabeceras CORS, por eso el navegador no puede llamarlo directo y la consulta pasa por `/api/p2p`.
- Si `p2p.binance.com` falla, se reintenta con el mismo camino en `www.binance.com`.
- El código está en `lib/p2p/binance.ts` y hay una respuesta real guardada para los tests en `tests/fixtures/binance.json`.

### MEXC: pendiente (hoy muestra "sin datos de MEXC")

- **No se pudo ver la página:** la página P2P de MEXC (`https://www.mexc.com/buy-crypto/p2p`) bloquea las conexiones desde EE.UU. (Akamai responde "Access Denied"). Por eso no se pudo inspeccionar qué endpoint usa, y **no se inventó**.
- **La API oficial no sirve tal cual:** MEXC tiene una API P2P oficial con `GET /api/v3/fiat/market/ads/pagination` ("Get Market Ads List", con `fiatUnit` y `coinId` obligatorios). Pide API key con permiso "P2P Account Read" y no publica el formato de la respuesta, así que no se usa.

**Cómo destrabarlo (1 minuto, desde una compu en Argentina):**

1. Abrí `https://www.mexc.com/buy-crypto/p2p` en Chrome, con USDT y ARS elegidos.
2. Apretá F12 → pestaña **Red** (Network) → filtro **Fetch/XHR**.
3. Recargá la página y buscá la llamada que devuelve la lista de anuncios (tiene los precios en la respuesta).
4. Clic derecho sobre esa llamada → **Copiar → Copiar como cURL**, y pegámelo junto con un pedazo de la respuesta.

Con eso se completan `MEXC_ENDPOINT` y el lector en `lib/p2p/mexc.ts`, igual que con Binance.

Si una plataforma falla, la web muestra "Sin datos de Binance/MEXC" y **no calcula con valores anteriores**. Las lecturas de más de 2 minutos tampoco se usan.

## Filtros automáticos (configurables)

- Solo comerciantes verificados.
- Porcentaje de finalización mínimo (95 % por defecto) y órdenes completadas en 30 días (50 por defecto).
- Tus métodos de pago.
- Que el límite del anuncio cubra el monto que querés operar.
- Descartar precios a más de X % de la mediana (3 % por defecto).

Con lo que queda se toma el mejor precio real de cada lado: el vendedor más barato y el comprador que más paga. Esos precios se usan en todos los cálculos y anuncios.

## Correrlo en tu compu

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # tests
```

Desde EE.UU. Binance puede bloquear la consulta. Desde Argentina o en Vercel (gru1) funciona.

## Publicarlo en Vercel

1. En <https://vercel.com>, **Add New → Project** y elegí este repositorio.
2. Si la rama no está unida a `main`, poné como *Production Branch* la rama `claude/crypto-trading-analyzer-x6085r` (Settings → Git).
3. **Deploy.** No hace falta configurar nada más: `vercel.json` ya fija la región `gru1`.

Tu configuración (comisiones, capital, filtros, métodos) se guarda en el navegador de cada dispositivo.
