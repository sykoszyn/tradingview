# Cómo agregar una estrategia nueva

Toda estrategia pasa por el mismo proceso que la variante "zonas-4h". El objetivo es que nunca se elija una regla mirando los datos con los que después se la evalúa.

## 1. Definir las reglas

- Si alcanza con combinar parámetros existentes (temporalidad de señal, modo de tendencia, toques mínimos, tipo de stop), agregá un "patch" en `lib/strategies/patches.ts`.
- Si necesita setups nuevos, agregalos en `lib/analysis/setups.ts` (funciones puras, con tests) y exponé un parámetro de configuración para activarlos.

## 2. Ajuste

```bash
# Descarga 12+ meses y los guarda en un archivo (una sola vez)
BT_CACHE=datos.json npm run backtest -- 12
# Prueba variantes SOLO en el período de ajuste (los datos se recortan en el corte)
BT_CACHE=datos.json npm run experiment -- tune base mi-variante mi-variante+b
```

El corte es el fin de la última validación registrada: los datos ya usados para validar otra estrategia pueden usarse para ajustar, pero nunca para validar.

Limitá de antemano cuántas variantes vas a probar. Cada variante extra aumenta la probabilidad de encontrar una que "funcione" por azar.

## 3. Cerrar las reglas

1. Registrá la estrategia en `lib/strategies/registry.ts`, con el resultado del ajuste en `tuning`.
2. Hacé un commit **antes** de validar y anotá el hash en `frozenCommit`.

## 4. Validación única

```bash
BT_CACHE=datos-nuevos.json npm run experiment -- validate mi-estrategia
```

- Necesita al menos 60 días de datos posteriores al corte.
- Se puede correr **una sola vez**: el resultado queda en `lib/strategies/validations/<id>.json` y el script se niega a repetirla.
- Criterio de éxito: expectativa mayor a +0,15 R con al menos 30 trades, y ganarle al percentil 95 de 100 corridas de entradas al azar con las mismas distancias de stop y objetivo, la misma frecuencia y los mismos costos.

Importá el JSON en el registro (`validation`) y commiteá.

## 5. Validación en vivo (paper trading)

Con el "paper trading automático" activado, la app simula todas las señales de la estrategia activa desde que la activás. Eso es una nueva muestra fuera de muestra.

Cuando haya al menos 30 trades cerrados con expectativa mayor a +0,15 R y le ganen a la línea base de azar del mismo período, la app lo informa en la pestaña Fases. El paso a dinero real (Fase 2) siempre requiere confirmación manual.
