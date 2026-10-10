# Experimento de variantes (historial separado)

Protocolo acordado antes de empezar:

- Ajuste con los primeros 8 meses; validación con los últimos 4, que no se miran hasta cerrar las reglas y se corren **una sola vez**.
- Variantes permitidas (no más): a) stop por ATR(14) 1× y 1,5×; b) solo a favor de la tendencia de 4h; c) señales en velas de 4h; d) zona con ≥ 3 toques. Por separado y combinando las que mejoren.
- Línea base de entradas al azar con las mismas distancias de stop/objetivos, frecuencia, temporalidad, comisiones, slippage y funding (100 corridas). Una variante "le gana claramente al azar" si su expectativa supera el percentil 95 del azar.
- Criterio de éxito (validación): expectativa > +0,15 R con al menos 30 trades. Si no se cumple, la app queda como herramienta de análisis y paper trading, sin pasar a real.
- Datos: ETHUSDT y BTCUSDT, spot y futuros USDT-M. Carril R (sin límites de tamaño), con comisiones, slippage 0,05 % y funding histórico.

## Ajuste (2025-10-10 → 2026-06-10)

```
AJUSTE: 2025-10-10 → 2026-06-10 (los datos se recortan en el corte)
Variante        Trades Acierto   R:R   Exp R  Tot R   DD R | Azar: media   p5    p95   p-val | ¿Le gana al azar?
base                86     14%  1.61  -0.711  -61.1   63.5 |      -0.360 -0.673 -0.012   0.98 | no
                ETHUSDT futures: 39 tr -0.82R · BTCUSDT futures: 35 tr -0.51R · ETHUSDT spot: 9 tr -1.09R · BTCUSDT spot: 3 tr -0.51R
a1                  16     13%  1.62  -0.705  -11.3   12.6 |      -0.072 -0.729 +0.929   0.94 | no
                ETHUSDT futures: 8 tr -1.05R · BTCUSDT futures: 7 tr -0.27R · ETHUSDT spot: 1 tr -1.04R · BTCUSDT spot: 0 tr +0.00R
a15                  5      0%  0.00  -1.033   -5.2    5.2 |      -0.021 -1.032 +1.312   0.96 | no
                ETHUSDT futures: 3 tr -1.03R · BTCUSDT futures: 1 tr -1.03R · ETHUSDT spot: 1 tr -1.03R · BTCUSDT spot: 0 tr +0.00R
b                   64     14%  1.49  -0.727  -46.5   48.9 |      -0.432 -0.801 -0.041   0.91 | no
                ETHUSDT futures: 28 tr -0.82R · BTCUSDT futures: 29 tr -0.61R · ETHUSDT spot: 4 tr -1.09R · BTCUSDT spot: 3 tr -0.51R
c                   26     23%  2.05  -0.316   -8.2   10.6 |      -0.255 -0.800 +0.363   0.55 | no
                ETHUSDT futures: 12 tr -0.23R · BTCUSDT futures: 10 tr -0.45R · ETHUSDT spot: 3 tr +0.04R · BTCUSDT spot: 1 tr -1.06R
d                   40     10%  1.30  -0.856  -34.2   34.3 |      -0.440 -0.819 +0.024   0.98 | no
                ETHUSDT futures: 15 tr -0.89R · BTCUSDT futures: 18 tr -0.74R · ETHUSDT spot: 5 tr -1.09R · BTCUSDT spot: 2 tr -1.09R

a1+c                 8      0%  0.00  -1.037   -8.3    8.3 |      -0.082 -0.672 +0.809   0.97 | no
                ETHUSDT futures: 3 tr -1.02R · BTCUSDT futures: 4 tr -1.04R · ETHUSDT spot: 0 tr +0.00R · BTCUSDT spot: 1 tr -1.05R
```

Lectura:

- La base pierde **más** que entradas al azar (p-valor 0,98).
- Mejoran respecto de la base: **c** (−0,32 R) y, de forma insignificante, **a1** (−0,705 vs −0,711 con 16 trades). b, d y a15 empeoran.
- La combinación a1+c empeora (8 trades, todos perdedores).
- **Reglas cerradas para validar: variante `c`** (señales en velas de 4h; zonas de pivots de 4h; porcentajes de stop ×2; vencimiento en velas de 4h). Ninguna variante le ganó al azar en el ajuste.

## Validación (2026-06-10 → 2026-10-09)

Corrida única con la variante `c` (registro completo en `lib/strategies/validations/zonas-4h.json`).

| Métrica | Valor |
|---|---|
| Trades | 14 |
| Aciertos | 21,4 % |
| R:R promedio realizado | 2,99 |
| Expectativa | **−0,155 R** |
| Total / DD máximo | −2,17 R / 7,48 R |
| Liquidaciones | 0 |
| Azar (100 corridas): media / p5 / p95 | −0,193 / −0,842 / +0,462 R (p-valor 0,42) |

Por par: ETHUSDT futuros 8 trades +0,53 R · BTCUSDT futuros 3 trades −1,08 R · BTCUSDT spot 3 trades −1,06 R · ETHUSDT spot 0 trades.

**Resultado: NO cumple el criterio** (expectativa ≤ +0,15 R y menos de 30 trades), y no le gana al azar.
Conclusión acordada: la app queda como herramienta de análisis y paper trading, sin pasar a operar real.
El +0,53 R de ETHUSDT futuros sale de 8 trades y no es evidencia: elegir ese subconjunto después de ver la validación sería sobreajustar.
