# FelixNet

Sitio personal estático (GitHub Pages), minimalista, construido como testbed de HTML/CSS/JS.

## Estructura

```
index.html        Portada / índice
journal.html      Journal de películas, series, anime y juegos
archivo.html      Archivo de documentos y cosas interesantes
proyectos.html    Substack, despacho, ORCiD y demos
sobre-mi.html     Bio y experiencia
hannya.html       Página del yokai 般若
demos/            Exploradores numéricos interactivos (HTML autocontenido)
css/styles.css    Sistema de diseño (tokens, nav, tarjetas, dark mode)
css/demo-chrome.css  Barra de navegación común inyectada en los demos
data/*.json       Contenido editable del journal, el archivo y los demos
js/*.js           Renderizadores (filtros, búsqueda) de cada JSON
resources/        Imágenes y PDFs
shake/            Landing, APK y política de privacidad de Shake (sin enlazar por ahora)
```

## Actualizar contenido

- **Journal**: añade objetos al arreglo `entries` de `data/journal.json`.
  Campos: `title`, `medium` (`juego`, `película`, `serie`, `anime`), `years`,
  `status` (`completado`, `abandonado`, `en-curso`), `rating` (1–5 o `null`), `note`.
- **Archivo**: añade objetos al arreglo `items` de `data/archivo.json`.
  Campos: `title`, `author`, `type`, `source`, `description`, `url`, `image`, `tags`.
- **Demos**: añade objetos al arreglo `demos` de `data/demos.json` y copia el HTML
  autocontenido a `demos/`. Campos: `title`, `description`, `url`, `lang`, `tags`.

Los JSON se cargan por `fetch`, por lo que el sitio debe servirse por HTTP
(GitHub Pages o un servidor local, p. ej. `python -m http.server`).
