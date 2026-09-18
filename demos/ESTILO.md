# Lineamientos de estilo para demos

Guía para que cualquier demo nuevo nazca ya alineado con el resto del sitio
(FelixNet). La fuente de verdad visual es [`../css/demos.css`](../css/demos.css).

## 1. Estructura

- Un demo es **un solo HTML autocontenido** en `demos/` (todo el CSS y JS dentro).
- **Sin dependencias externas**: nada de CDN, fuentes remotas ni peticiones de red.
  Debe funcionar abriendo el archivo o sirviéndolo por HTTP.
- Si el demo necesita varios archivos (módulos, datos), usa una subcarpeta:
  `demos/mi-demo/index.html`, `demos/mi-demo/motor.js`, etc.

## 2. Registrar el demo en el sitio

Añade una entrada al arreglo `demos` de [`../data/demos.json`](../data/demos.json):

```json
{
  "title": "Título en español",
  "description": "Una o dos frases en español.",
  "url": "demos/mi-demo.html",
  "lang": "es",
  "tags": ["tema", "otro-tema"]
}
```

## 3. Cabecera HTML

`lang="es"`, metadatos mínimos y el título en español. Enlaza la hoja unificada
**después** del `<style>` interno (sus reglas usan `!important` y ganan):

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Título del demo</title>
  <style>/* SOLO layout; nunca colores */</style>
  <link rel="stylesheet" href="../css/demos.css">
</head>
<body>
  <!-- chrome (ver §4) -->
  <main>…</main>
</body>
</html>
```

> La ruta al CSS depende de la profundidad: `demos/x.html` → `../css/demos.css`;
> `demos/x/index.html` → `../../css/demos.css`.

## 4. Chrome de navegación (obligatorio)

Pégalo al inicio de `<body>`, ajustando las rutas relativas:

```html
<nav class="demo-chrome">
  <a class="demo-chrome-brand" href="../index.html">FELIXNET</a>
  <span class="demo-chrome-links">
    <a href="../index.html">Inicio</a>
    <a href="../journal.html">Journal</a>
    <a href="../archivo.html">Archivo</a>
    <a href="../proyectos.html" aria-current="page">Proyectos</a>
    <a href="../sobre-mi.html">Sobre mí</a>
  </span>
</nav>
```

## 5. CSS: solo tokens, cero colores sueltos

- El `<style>` interno define **únicamente layout** (grid, tamaños, flujo). No
  declares `color`, `background`, `border-color` ni hex: ya los aporta
  `demos.css`.
- Si de verdad necesitas un color nuevo, **añádelo como token** en
  `css/demos.css` (`:root` y su variante oscura) y úsalo; no lo hardcodees.

Tokens disponibles (claro / oscuro automáticos):

| Token | Uso |
|---|---|
| `--bg`, `--surface`, `--surface-2` | fondos (página, panel, código) |
| `--text`, `--muted` | texto principal / secundario |
| `--line` | bordes, rejillas y ejes |
| `--accent`, `--accent-soft` | acento de marca y fondos suaves |
| `--c1`…`--c4` | series de datos (teal, ámbar, violeta, azul) |
| `--ok`, `--bad` | positivo / negativo |
| `--ok-soft`, `--bad-soft`, `--warn-soft` | fondos de estado |
| `--radius`, `--maxw` | radio y ancho máximo |

## 6. Componentes y clases compartidas

Reutiliza estos nombres para heredar el estilo:

- `.eyebrow` — antetítulo en mayúsculas.
- `section` / `.panel` — tarjeta de contenido.
- `.controls` — barra de controles; `.toolbar` — botones.
- `.grid` — rejilla de 2 columnas responsive.
- `.stats` con `strong` + `span` — cifras.
- `.legend` — leyenda de series con `.c1`…`.c4` (alias: `.teal`, `.amber`,
  `.violet`, `.mc`, `.flat`).
- `.note` — aviso con barra de acento a la izquierda.
- `code` / `.math` — código y fórmulas.
- `table` — tablas; `details`/`summary` — desplegables.
- `.tag` / `.badge` (con `.eligible`, `.pending`, `.rejected`) — etiquetas.
- `.muted` — texto atenuado.
- `button.primary` — acción principal (acento).

## 7. Canvas y JavaScript

- **Nunca** uses hex ni `rgb()` fijos al dibujar. Lee los tokens y recalcula en
  cada `draw()` para que el tema claro/oscuro se refleje:

```js
const tok = (n) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function draw() {
  const text = tok("--text");
  const muted = tok("--muted");
  const line = tok("--line");
  const series = [tok("--c1"), tok("--c2"), tok("--c3"), tok("--c4")];
  // …usar dentro de ctx.strokeStyle / fillStyle / font…
}

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
```

- Mantén la **semántica de series**: la serie 1 usa `--c1`, la 2 usa `--c2`, etc.
- Reutiliza la función de dibujo existente en el listener de cambio de tema.

## 8. Idioma

- Todo el **texto visible va en español**: encabezados, párrafos, etiquetas
  `<label>`, textos de `<option>`, `placeholder`, `aria-label`, `<summary>` y
  cualquier cadena generada por JS (estados, leyendas, ejes, tooltips).
- **No traduzcas**: fórmulas, siglas estándar (SABR, SDE, Monte Carlo, OVA…),
  nombres propios de papers/autores ni identificadores de código.

## 9. Accesibilidad

- Los `<canvas>` llevan `aria-label` descriptivo y, si es informativo,
  `role="img"`.
- Los mensajes de estado usan `role="status"` o `aria-live="polite"`.
- Cada control tiene su `<label>` asociado.

## 10. Checklist antes de publicar

- [ ] Un solo HTML autocontenido, sin red ni dependencias.
- [ ] `<link rel="stylesheet" href="…/css/demos.css">` tras el `<style>`.
- [ ] Chrome `demo-chrome` con rutas relativas correctas.
- [ ] Cero colores hardcodeados en CSS y JS (solo tokens).
- [ ] Canvas se redibuja al cambiar `prefers-color-scheme`.
- [ ] Todo el texto visible en español.
- [ ] Entrada agregada en `data/demos.json`.
- [ ] Verificado sirviendo por HTTP (`python -m http.server`) y sin errores de
      consola.
