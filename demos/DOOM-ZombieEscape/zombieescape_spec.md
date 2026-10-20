---

```markdown
# SYSTEM SPECIFICATION & AGENT INSTRUCTIONS: DOOM-ZOMBIE-ESCAPE (WEB EDITION)
**Versión:** 3.0.0 (Self-Hosted `uzdoom-wasm` + Attribution & Sparse Clone Spec)  
**Autor del Proyecto:** Félix Camacho (Facultad de Ciencias / IMATE, UNAM)  
**Marco Teórico:** *"The Zombie Escape: Pursuit-evasion by greedy particles on lattices"* — Omer Angel (UBC), Paweł Prałat (TMU) & Peter Winkler (Dartmouth), presentado en el Seminario de Probabilidad y Procesos Estocásticos (UNAM, 2026).  
**Infraestructura Base:** Adaptación del port web `uzdoom-wasm` implementado por Joe Heyming (`joeheyming/joeheyming.github.com/doom/`).

---

## 1. PROTOCOLO DE CLONACIÓN SELECTIVA DE LA INFRAESTRUCTURA (`joeheyming`)

El agente de desarrollo local NO debe clonar todo el repositorio `joeheyming.github.com` (que contiene decenas de aplicaciones ajenas a Doom), sino extraer exclusivamente la subcarpeta `/doom/` utilizando `git sparse-checkout` y preservar el historial/créditos de los binarios base.

### 1.1 Script de Inicialización y Extracción (`scripts/bootstrap_infra.sh`)
El agente debe crear y ejecutar la siguiente secuencia para poblar `vendor/uzdoom/` con los artefactos necesarios:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_URL="[https://github.com/joeheyming/joeheyming.github.com.git](https://github.com/joeheyming/joeheyming.github.com.git)"
TMP_DIR=".tmp_joeheyming_clone"
TARGET_DIR="public/engine"

echo "[1/4] Clonando de forma selectiva /doom/ desde joeheyming/joeheyming.github.com..."
rm -rf "$TMP_DIR"
git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TMP_DIR"
cd "$TMP_DIR"
git sparse-checkout set doom
COMMIT_HASH=$(git rev-parse --short HEAD)
cd -

echo "[2/4] Copiando runtime de UZDoom WASM, Service Worker y Freedoom IWAD..."
mkdir -p "$TARGET_DIR"
# Copiar binarios WASM, JS loader, Service Worker (COOP/COEP), SoundFont e IWAD base (Freedoom)
cp -r "$TMP_DIR/doom/"* "$TARGET_DIR/"

# Eliminar sabores/mods externos de terceros que no se usarán (Mario, Metroid, Castlevania, Sonic, Zelda)
# para mantener el repositorio ligero y libre de assets con copyright de Nintendo/Konami/SEGA:
rm -f "$TARGET_DIR/"*mario* "$TARGET_DIR/"*met2* "$TARGET_DIR/"*Castlevania* "$TARGET_DIR/"*sonic* "$TARGET_DIR/"*LegendOfDoom* || true

echo "[3/4] Registrando metadatos de procedencia (Commit: $COMMIT_HASH)..."
cat <<EOF> "$TARGET_DIR/PROVENANCE.json"
{
  "upstream_repo": "[https://github.com/joeheyming/joeheyming.github.com](https://github.com/joeheyming/joeheyming.github.com)",
  "upstream_path": "doom/",
  "upstream_url": "[https://joeheyming.github.io/doom/](https://joeheyming.github.io/doom/)",
  "upstream_commit": "$COMMIT_HASH",
  "author": "Joe Heyming",
  "engine": "uzdoom-wasm (GPL v3)",
  "iwad": "Freedoom Phase 1 (BSD 3-Clause)"
}
EOF

echo "[4/4] Limpiando directorio temporal..."
rm -rf "$TMP_DIR"
echo "Infraestructura base lista en $TARGET_DIR"

```

### 1.2 Requisito Crítico de Despliegue: Aislamiento Cross-Origin (Service Worker)

El motor `uzdoom-wasm` utiliza `SharedArrayBuffer` y multihilo Posix (`pthreads` vía Web Workers). Para que funcione en un sitio estático propio (como GitHub Pages, Cloudflare Pages o Nginx personal) sin configurar cabeceras HTTP en el servidor, el agente **debe conservar intacto el Service Worker de aislamiento (`coi-serviceworker` / `sw.js`)** presente en `joeheyming/doom/` que inyecta:

* `Cross-Origin-Opener-Policy: same-origin`
* `Cross-Origin-Embedder-Policy: require-corp`

---

## 2. ESTRUCTURA FINAL DEL SITIO WEB PROPIO

```text
doom-zombie-escape/
├── README.md                      # Documentación general, modelo matemático y créditos
├── LICENSE                        # Licencia GPL v3 (requerida por UZDoom) + Avisos BSD
├── Makefile                       # Comandos: make bootstrap, make build-pk3, make serve, make test
├── scripts/
│   ├── bootstrap_infra.sh         # Clona selectivamente joeheyming/doom/ y limpia mods ajenos
│   └── build_pk3.py               # Genera MAP01.wad (retícula Z^2) y compila zombie-escape.pk3
├── pk3_src/                       # Código fuente del mod "The Zombie Escape"
│   ├── MAPINFO.txt                # Configuración de MAP01 y registro del EventHandler
│   ├── CVARINFO.txt               # CVARs: dze_lambda, dze_seed, dze_controller, dze_step_tics
│   ├── ZSCRIPT.zc                 # Includes principales
│   └── zscript/
│       ├── dze_constants.zc       # Dimensiones de Z^2 y constantes de potencial
│       ├── dze_zombie.zc          # Actor LatticeZombie (-SOLID, caminata geodésica L1)
│       ├── dze_mindy_bot.zc       # Agente APW (Valles de Poisson + Oscilación Ortogonal) y Greedy
│       ├── dze_controller.zc      # LCG determinista, Spawner Bernoulli(lambda) y JSON stdout logger
│       └── dze_hud.zc             # Radar táctico 2D con visualización de Shock Lines
└── public/                        # Raíz estática lista para desplegar en sitio propio / GitHub Pages
    ├── index.html                 # Interfaz principal: Viewport UZDoom + Laboratorio Estocástico + Citaciones
    ├── coi-serviceworker.js       # Service Worker de aislamiento COOP/COEP heredado de joeheyming/doom
    ├── css/
    │   └── lab.css                # Estilo académico / Bloomberg-Doom oscuro
    ├── js/
    │   ├── dze-loader.js          # Adaptador sobre el loader de Joe Heyming para auto-cargar zombie-escape.pk3
    │   ├── telemetry-bridge.js    # Interceptor de Module.print para leer [DZE_TELEMETRY] y [DZE_RESULT]
    │   └── plots.js               # Gráficas en tiempo real: Retícula Z^2, Shock Mass y Regresión Log-Log
    ├── mods/
    │   └── zombie-escape.pk3      # Artefacto compilado por scripts/build_pk3.py
    └── engine/                    # Archivos extraídos de joeheyming/[joeheyming.github.com/doom/](https://joeheyming.github.com/doom/)
        ├── PROVENANCE.json
        ├── uzdoom.js
        ├── uzdoom.wasm
        └── ... (Freedoom IWAD y SoundFont empaquetados)

```

---

## 3. ESPECIFICACIÓN DE CITACIÓN Y LICENCIAMIENTO OBLIGATORIO

El agente de desarrollo debe incluir tanto en el `README.md` como en el pie de página visible (`<footer id="citations-and-credits">`) de `public/index.html` los tres bloques de atribución formal:

### 3.1 Atribución de Infraestructura Web y Motor

> **Web Engine & Runtime Infrastructure:**
> Adaptado de la implementación web de DOOM en [Heyming OS (`joeheyming.github.io/doom/`)](https://joeheyming.github.io/doom/) desarrollada por **Joe Heyming** ([`github.com/joeheyming/joeheyming.github.com`](https://github.com/joeheyming/joeheyming.github.com)).
> Ejecutado sobre **UZDoom** compilado a WebAssembly (`uzdoom-wasm`, licenciado bajo **GNU GPL v3**) utilizando los recursos libres de **Freedoom Phase 1** (Licencia BSD de 3 cláusulas).

### 3.2 Citación Académica del Modelo Matemático

> **Mathematical Model & Asymptotic Bounds:**
> Basado en el trabajo *"The Zombie Escape: Pursuit-evasion by greedy particles on lattices"* de **Omer Angel** (University of British Columbia), **Paweł Prałat** (Toronto Metropolitan University) y **Peter Winkler** (Dartmouth College), presentado en la sesión extraordinaria del **Seminario de Probabilidad y Procesos Estocásticos** (IMATE / IIMAS, UNAM, septiembre de 2026).

### 3.3 Autoría del Experimento y Simulación

> **Experimental Design, ZScript Stochastic Mod & APW Controller:**
> Desarrollado por **Félix Camacho** (Facultad de Ciencias, UNAM).

---

## 4. ESPECIFICACIÓN DEL MOD `zombie-escape.pk3` Y PUENTE WASM

### 4.1 Generación Programática del Mapa Reticular (`scripts/build_pk3.py`)

El script en Python sin dependencias externas pesadas (solo `struct` y `zipfile` de la librería estándar) debe generar:

1. **`maps/MAP01.wad`:**
* Un sector cuadrado plano centrado en $(0,0)$ con coordenadas desde $-8192$ hasta $+8192$ ($256 \times 256$ celdas de $64 \times 64$ *map units*).
* Textura de piso contrastante en cuadrícula de $64 \times 64$ (ej. `FLOOR0_1` o `CONS1_1` de Freedoom) para que el jugador humano perciba visualmente las aristas de $\mathbb{Z}^2$ al correr.
* `Thing 1` (*Player 1 Start*) en $(0, 0)$.


2. **Empaquetado `.pk3`:** Comprimir `MAP01.wad`, `MAPINFO.txt`, `CVARINFO.txt` y `ZSCRIPT.zc` junto con `zscript/*.zc` dentro de `public/mods/zombie-escape.pk3`.

### 4.2 Variables de Control (`CVARINFO.txt`)

```c
server float dze_lambda = 0.03;      // Densidad inicial de Bernoulli en Z^2
server int   dze_seed = 42;          // Semilla del LCG para experimentos pareados Humano vs Bot
server int   dze_controller = 0;     // 0 = Humano, 1 = Algoritmo APW, 2 = Greedy L1, 3 = Humano + Ghost APW
server int   dze_step_tics = 7;      // Tics por paso en la retícula (5 pasos/seg). Si es 1 = Tiempo real continuo

```

### 4.3 Lógica Exacta en ZScript (`dze_controller.zc` y `dze_mindy_bot.zc`)

1. **Inicialización Bernoulli($\lambda$):**
* Usando un generador LCG interno inicializado con `dze_seed`, se recorre $(i, j) \in \{-120, \dots, 120\}^2 \setminus \{(0,0)\}$. Con probabilidad $\lambda$, se agrega el zombi a los arreglos virtuales `zx.Push(i)` y `zy.Push(j)`.


2. **Transición Geodésica $\ell_1$ de los Zombis:**
* En cada turno $t \to t+1$, tras moverse Mindy a $(x_m, y_m)$, cada zombi evalúa $dx = x_m - x_z$ y $dy = y_m - y_z$.
* Si $dx \neq 0$ y $dy \neq 0$, elige con probabilidad $1/2$ (usando el LCG dedicado) avanzar en $X$ o en $Y$.
* Si $dx == 0$ o $dy == 0$ (el zombi está sobre la **Línea de Choque** ortogonal de Mindy), avanza determinísticamente sobre el eje hacia Mindy.


3. **Política del Algoritmo APW (`dze_mindy_bot.zc`):**
* Evalúa los 5 movimientos candidatos $p \in \mathcal{N}[M_t]$ minimizando:

$$J(p) = w_{\text{imm}} \sum_{d_1 \le 6} e^{-\gamma (d_1(z, p) - 1)} + w_{\text{shock}} \sum_{x_z = x_p \lor y_z = y_p} d_1(z, p)^{-\beta} + w_{\text{valley}} \sum_{z} e^{-d_1(z, p)^2 / (2\sigma_\lambda^2)}$$


* **Modo Fantasma (`dze_controller == 3`):** Mientras el jugador humano controla a Mindy real, el controlador simula en paralelo una segunda partícula $M_t^{\text{APW}}$ sobre la nube original y renderiza su posición en el radar (y un actor translúcido en 3D) para comparar en vivo la trayectoria humana frente a la trayectoria teórica.


4. **Telemetría hacia JavaScript:**
* En cada paso emite `Console.Printf("[DZE_STEP] {\"t\":%d,\"mx\":%d,\"my\":%d,\"min_d1\":%d,\"shock\":%d}\n", ...)` que `telemetry-bridge.js` captura en `Module.print` para actualizar los gráficos del navegador sin latencia.



---

## 5. FLUJO DE AUTOCARGA EN EL NAVEGADOR (`public/js/dze-loader.js`)

En lugar de mostrar el selector de 7 juegos de la página original de Joe Heyming (Classic Doom, Mario, Metroid, etc.), el agente adaptará la UI de lanzamiento para que:

1. Cargue automáticamente el **Freedoom Phase 1** incluido en el motor como IWAD base.
2. Descargue y monte automáticamente `mods/zombie-escape.pk3` en el `MEMFS` de Emscripten antes de invocar `callMain`.
3. Pase los argumentos de línea de comandos seleccionados en los controles del laboratorio web:
```javascript
const args = [
  "-iwad", "freedoom1.wad",
  "-file", "/mods/zombie-escape.pk3",
  "+set", "dze_lambda", String(uiConfig.lambda),
  "+set", "dze_seed", String(uiConfig.seed),
  "+set", "dze_controller", String(uiConfig.controller),
  "+set", "dze_step_tics", String(uiConfig.stepTics),
  "+map", "MAP01"
];

```


4. Conserve el botón de **"Reset saved data"** y los controles táctiles/teclado del port de Joe Heyming para compatibilidad móvil y desktop.

---

## 6. CRITERIOS DE ACEPTACIÓN Y PRUEBAS (`make test`)

1. `make bootstrap` descarga únicamente `/doom/` de `joeheyming/joeheyming.github.com`, elimina los PK3 de franquicias externas y genera `PROVENANCE.json`.
2. `make build-pk3` ejecuta `scripts/build_pk3.py`, verifica que `MAP01.wad` tenga cabeceras `PWAD` válidas y genera `public/mods/zombie-escape.pk3`.
3. Pruebas unitarias en JS (`node --test`) verifican el parser de `[DZE_STEP]` / `[DZE_RESULT]` y el cálculo de la pendiente $\hat{\alpha}_1$ por mínimos cuadrados ordinarios sobre $(\log(1/\lambda), \log \tau)$.
4. `make serve` levanta un servidor local en `http://localhost:8080`, registra el Service Worker de `SharedArrayBuffer` y permite jugar o correr el bot APW directamente en el navegador.

```

---

### Puntos clave que resuelve esta especificación para tu agente local

* **Limpieza legal y de peso del repo:** El script `bootstrap_infra.sh` usa `git sparse-checkout set doom` para no bajar el resto del sitio de tu colega, y enseguida borra los `.pk3` pesados de Mario, Metroid, Sonic, Castlevania y Zelda (~150 MB ahorrados), dejando únicamente el runtime `uzdoom-wasm` (`GPL v3`) y `Freedoom Phase 1` (`BSD`).
* **Aislamiento `COOP/COEP` preservado:** Destaca explícitamente conservar el Service Worker de `joeheyming/doom/`, que es el truco técnico que permite que `uzdoom-wasm` funcione en un `github.io` o dominio propio sin que el navegador bloquee `SharedArrayBuffer`.
* **Trazabilidad automática (`PROVENANCE.json` + Footer):** Guarda el hash exacto del commit de `joeheyming/joeheyming.github.com` en el momento de clonar y deja maquetado el bloque de citación tanto para tu colega como para la conferencia de Omer Angel, Paweł Prałat y Peter Winkler en la UNAM.

<ElicitationsGroup message="¿Quieres que generemos ahora los scripts ejecutables para arrancar el repositorio?">
  <Elicitation label="Generar build_pk3.py (creador de MAP01.wad y compilador PK3)" query="Genera el código completo de scripts/build_pk3.py en Python estándar que construye binariamente MAP01.wad y empaqueta pk3_src/ en public/mods/zombie-escape.pk3."/>
  <Elicitation label="Generar todos los archivos ZScript del mod (pk3_src/)" query="Escribe el código completo de todos los archivos dentro de pk3_src/ (MAPINFO.txt, CVARINFO.txt, ZSCRIPT.zc y los módulos en zscript/) listos para empaquetarse."/>
  <Elicitation label="Generar index.html, dze-loader.js y telemetry-bridge.js" query="Escribe el código de public/index.html, public/js/dze-loader.js y public/js/telemetry-bridge.js adaptando el cargador de joeheyming/doom con el dashboard de gráficas y el bloque de citación."/>
</ElicitationsGroup>

```