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

### MEXC: funcionando

Son los endpoints que usa la propia página P2P de MEXC. Se identificaron desde el navegador (DevTools → Red) el 10/10/2026 y se verificaron con respuestas reales.

```
GET https://www.mexc.com/api/platform/p2p/api/market
    ?blockTrade=false&countryCode=&tradeType=SELL&currency=ARS&payMethod=&amount=
    &coinId=128f589271cb4951b03e71e6323eb7be&page=1&pageSize=20&certifiedMerchant=false
    &allowTrade=false&haveTrade=false&follow=false&adsType=1&adOrderSortField=price&adOrderSort=0
Encabezados: language: en-US · X-Client: H5 · x-platform-type: h5 · Referer: https://www.mexc.com/buy-crypto/p2p/buy/USDT/ARS
```

- `coinId=128f…` es USDT.
- **Ojo, al revés que Binance:**
  - `tradeType=SELL` (ordenado con `adOrderSort=0`) trae a quienes **venden** USDT, lo que ves en "Buy".
  - `tradeType=BUY` (con `adOrderSort=1`) trae a quienes **compran** USDT.
- De cada anuncio se usa:
  - `price`, `minTradeLimit`, `maxTradeLimit`, `availableQuantity`
  - `payMethod`: ids separados por coma
  - `merchant.merchantType`: `merchant` y `prime` cuentan como comerciantes
  - `merchantStatistics.thirtyDayCompletionRate` y `merchantStatistics.doneLastMonthCount`
- Los anuncios con `orderTag.i18nKey = "mc_merchant_new_user_exclusive"` ("Flash Sale") son **solo para usuarios nuevos**: se descartan siempre.
- Los ids de métodos de pago se traducen con `GET https://www.mexc.com/api/platform/p2p/api/payment/method?currency=ARS` (por ejemplo, `207` = Mercadopago).
- MEXC bloquea su página web desde EE.UU., pero estos endpoints respondieron. Si en algún momento fallan, la web muestra "Sin datos de MEXC".
- El código está en `lib/p2p/mexc.ts` y hay respuestas reales guardadas en `tests/fixtures/mexc.json`.

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
