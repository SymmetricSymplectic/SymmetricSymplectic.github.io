# Avisos de terceros — The Zombie Escape

Este proyecto combina cuatro capas con licencias distintas. El código propio
(mod ZScript, generador de mapas, laboratorio web y pruebas) se distribuye bajo
**GNU GPL v3** (ver `LICENSE`), porque se enlaza con el motor UZDoom, también
GPL v3.

---

## 1. UZDoom / GZDoom / ZDoom — GNU GPL v3

`public/engine/uzdoom.js`, `public/engine/uzdoom.wasm`, `public/engine/uzdoom.data`
y `public/engine/uzdoom.pk3` son el motor **UZDoom** (familia GZDoom, derivado de
ZDoom) compilado a WebAssembly con el port [`uzdoom-wasm`](https://github.com/abootnet/uzdoom-wasm).

> Copyright © 1993-1996 id Software, Inc.
> Copyright © 1999-2016 Randy Heit, Christoph Oelckers y colaboradores de ZDoom.
> Copyright © 2002-2025 The GZDoom/UZDoom authors.
> Licencia: GNU General Public License v3 (o posterior).

Se distribuye sin modificaciones. El código fuente del motor está disponible en
<https://github.com/UZDoom/UZDoom>.

## 2. Freedoom Phase 1 — BSD de 3 cláusulas

`uzdoom.data` incluye **Freedoom Phase 1** (y Phase 2) como IWAD libre, y los
sprites `POSS`/`PLSS` que usan `LatticeZombie` y `DZEGhost` provienen de esos
recursos.

> Copyright © 2001-2025 The Freedoom Project contributors.
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice,
>    this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holder nor the names of its contributors
>    may be used to endorse or promote products derived from this software
>    without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS”
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
> ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
> LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
> CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
> SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
> INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
> CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
> ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
> POSSIBILITY OF SUCH DAMAGE.

## 3. Joe Heyming — infraestructura web y loader

La disposición del runtime, el Service Worker de aislamiento y el arranque de
Emscripten se adaptaron de la implementación web de DOOM de **Joe Heyming**:

> <https://joeheyming.github.io/doom/> ·
> <https://github.com/joeheyming/joeheyming.github.com>

`public/engine/` contiene una copia de la subcarpeta `doom/` de ese repositorio,
con los PK3 de franquicias de terceros (Mario, Metroid, Castlevania, Sonic,
Legend of DOOM) eliminados. El commit exacto quedó registrado en
`public/engine/PROVENANCE.json`.

Este proyecto **no** reclama autoría sobre esa infraestructura; consulta el
repositorio original para los términos aplicables a esos archivos.

## 4. coi-serviceworker.js — MIT

> `coi-serviceworker v0.1.7` — Guido Zuidhof y colaboradores.
> Licencia MIT. Basado en <https://github.com/niccokunzmann/coi-serviceworker>.

Se conserva **intacto** (es el truco que permite `SharedArrayBuffer` en un sitio
estático como GitHub Pages) y se carga desde `public/coi-serviceworker.js`.

## 5. Trabajo académico citado

> Omer Angel (University of British Columbia), Paweł Prałat (Toronto
> Metropolitan University) y Peter Winkler (Dartmouth College),
> *“The Zombie Escape: Pursuit-evasion by greedy particles on lattices”*,
> Seminario de Probabilidad y Procesos Estocásticos (IMATE / IIMAS, UNAM).

El mod **no** redistribuye el artículo; implementa su modelo de transición
geodésica y el funcional de potencial descritos en la especificación del
proyecto. Las citas bibliográficas deben seguir las indicaciones de los autores
y de la publicación original.

## 6. DOOM

DOOM es una marca de id Software LLC. Este proyecto no está afiliado ni
respaldado por id Software, Bethesda, ZeniMax, UZDoom ni Freedoom. No se
distribuye ningún recurso propietario de DOOM.
