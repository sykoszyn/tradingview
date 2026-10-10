# Planes BTC/ETH: análisis y simulación

App web (Next.js + TypeScript + Tailwind) que analiza **BTCUSDT** y **ETHUSDT** en Binance (spot y futuros perpetuos USDT-M), arma planes de entrada long y short con montos chicos y apalancamiento bajo, y te deja probarlos con backtest y paper trading antes de arriesgar plata.

> **Herramienta educativa. No es asesoramiento financiero. Los futuros apalancados pueden hacerte perder todo el margen.**
>
> La app **no ejecuta órdenes**, no pide API keys y no se conecta a ninguna cuenta. Si decidís operar, lo hacés vos a mano en Binance.

## Estado actual de la estrategia

La estrategia por defecto ("Zonas S/R en 4h") **no tiene ventaja demostrada**. En la validación fuera de muestra (últimos 4 meses, corrida una sola vez) dio −0,155 R por trade en 14 trades, igual que entrar al azar. El detalle está en [`docs/experimento-variantes.md`](docs/experimento-variantes.md).

Por eso la app arranca en la **Fase 0** y las fases con dinero real (2 a 4) están bloqueadas. La única vía para habilitarlas es la **validación en vivo**: el paper trading automático tiene que juntar al menos 30 trades con expectativa mayor a +0,15 R y ganarle a la línea base de azar. Aun así, la Fase 2 requiere tu confirmación manual.

---

## Guía paso a paso (para principiantes)

### 1. Instalar lo necesario (una sola vez)

1. **Node.js**: descargá la versión **LTS** (22 o más nueva) desde <https://nodejs.org> e instalala con las opciones por defecto.
2. **Git**: descargalo desde <https://git-scm.com/downloads> e instalalo con las opciones por defecto.
3. Abrí una terminal (en Windows: "Símbolo del sistema" o "PowerShell"; en Mac: "Terminal") y verificá que estén instalados:
   ```bash
   node -v
   git --version
   ```
   Si ves un número de versión en cada uno, está todo bien.

### 2. Correr la app en tu computadora

```bash
# 1) Descargar el código
git clone https://github.com/sykoszyn/tradingview.git
cd tradingview

# 2) Usar la rama con la app (si todavía no la uniste a main)
git checkout claude/crypto-trading-analyzer-x6085r

# 3) Instalar dependencias (tarda 1–2 minutos la primera vez)
npm install

# 4) Arrancar la app
npm run dev
```

Abrí <http://localhost:3000> en el navegador. Para cortarla, volvé a la terminal y apretá `Ctrl + C`.

**Verla desde el celular** (en la misma red WiFi):

1. Arrancala con `npm run dev -- -H 0.0.0.0`.
2. En el celular, abrí `http://IP-DE-TU-COMPU:3000`. Para saber la IP de tu compu: `ipconfig` en Windows, o Preferencias del Sistema → Red en Mac.

> **Ojo:** Binance bloquea las IPs de EE.UU. Desde Argentina funciona directo. Si alguna fuente falla, la app prueba sola las alternativas y muestra cuál está usando:
> 1. Servidor
> 2. Espejo `www.binance.com`
> 3. Directo desde el navegador
> 4. Bybit

**Comandos útiles:**

| Comando | Para qué sirve |
|---|---|
| `npm test` | Corre los tests (Vitest) |
| `npm run typecheck` | Revisa los tipos de TypeScript |
| `npm run build` | Compila la versión de producción |
| `npm run analyze -- ETHUSDT futures` | Muestra zonas, tendencia y señales recientes por consola |
| `npm run backtest -- 12` | Corre el backtest de 12 meses por consola |

### 3. Subir tus cambios a GitHub

El código ya está en `github.com/sykoszyn/tradingview`, en la rama `claude/crypto-trading-analyzer-x6085r`. Para pasarlo a la rama principal:

1. Entrá al repositorio en GitHub. Va a aparecer un aviso amarillo para crear un *Pull Request* desde la rama nueva: tocá **"Compare & pull request"**.
2. Revisá los cambios, tocá **"Create pull request"** y después **"Merge pull request"**.

Si más adelante cambiás algo en tu compu:

```bash
git add -A
git commit -m "Describí el cambio"
git push
```

### 4. Publicarla en Vercel (gratis)

1. Entrá a <https://vercel.com> y tocá **Sign Up** → **Continue with GitHub**.
2. Tocá **Add New… → Project** y elegí el repositorio `tradingview` (si no aparece, tocá "Adjust GitHub App Permissions" y dale acceso).
3. Vercel detecta Next.js solo. No hace falta cambiar nada ni cargar variables de entorno. Tocá **Deploy**.
4. En 1–2 minutos te da una dirección del tipo `https://tradingview-xxxx.vercel.app`. Abrila en el celular.
5. **Agregarla a la pantalla de inicio:**
   - iPhone (Safari): Compartir → "Agregar a inicio".
   - Android (Chrome): menú ⋮ → "Agregar a pantalla principal".

Detalles importantes:

- **Región:** `vercel.json` fija las funciones en **gru1 (São Paulo)** para que Binance no las bloquee. No la cambies.
- **Rama publicada:** si no uniste la rama a `main`, en Vercel andá a Settings → Git → *Production Branch* y poné `claude/crypto-trading-analyzer-x6085r`. Lo más simple es unirla a `main` (paso 3).
- **Actualizaciones:** cada `git push` a la rama de producción vuelve a publicar la app sola.

### 5. Tus datos

- Todo (diario, paper trading, fases, configuración) se guarda **en el navegador** del dispositivo que uses. Si usás la app en el celular y en la compu, son diarios separados.
- Exportá seguido desde **Diario → Exportar todo (JSON)**. Con "Importar JSON" lo recuperás o lo pasás a otro dispositivo.
- La capa de datos (`lib/storage/repository.ts`) está lista para migrar a Supabase o Vercel Postgres: hay que implementar la interfaz `JournalRepository`.

---

## Cómo se usa

| Pestaña | Qué hace |
|---|---|
| **Señales** | Gráfico con zonas, tendencia y planes vigentes (solo velas cerradas). Cada tarjeta tiene el plan completo, el tamaño, la liquidación, el funding y la checklist de Binance. Desde ahí podés copiar el plan, simularlo o registrar un trade real. |
| **Backtest** | 12 meses o más, en un Web Worker, con las mismas reglas que en vivo. Muestra los resultados en R y en USDT (tamaño de la Fase 2); los setups con expectativa negativa quedan en rojo como "NO USAR". |
| **Diario** | Trades simulados (automáticos y manuales) y reales, con estadísticas separadas. Exportar e importar. |
| **Fases** | Fase actual, requisitos de cada fase, validación en vivo y confirmación manual de la Fase 2. |
| **Configuración** | Estrategia, riesgo, comisiones, límites, umbrales de fases, noticias, mínimos de cada par (1x/2x/3x) y brackets. |

**Topes que no se pueden cambiar:**

- Apalancamiento máximo 3x (en spot siempre 1x).
- Margen siempre aislado.
- Margen mínimo de 10 USDT por entrada.

## Estructura

```
app/                 páginas y ruta /api/market/[resource] (proxy de solo lectura, región gru1)
components/          interfaz (Señales, Backtest, Diario, Fases, Configuración, gráfico)
hooks/               datos en vivo, paper trading, fases, backtest
lib/analysis         pivots, zonas, tendencia, setups (funciones puras)
lib/plan             tamaño, comisiones, liquidación, funding, plan y checklist
lib/engine           pipeline señal→plan y simulador (compartidos por vivo, backtest y paper)
lib/backtest         historial, backtest, métricas, línea base al azar
lib/journal          paper trading, trades reales, validación en vivo
lib/risk             fases, límites de riesgo, noticias
lib/strategies       registro de estrategias y sus validaciones
scripts/             backtest, experimento (ajuste/validación) y análisis por consola
tests/               Vitest
docs/                experimento de variantes y guía para estrategias nuevas
```

Para agregar una estrategia nueva hay que seguir el proceso de [`docs/nuevas-estrategias.md`](docs/nuevas-estrategias.md): ajuste, reglas cerradas, validación única contra el azar y validación en vivo.
