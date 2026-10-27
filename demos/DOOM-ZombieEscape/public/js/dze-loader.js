/**
 * dze-loader.js — adaptador sobre el loader de UZDoom-WASM de Joe Heyming.
 *
 * Diferencias con `uzdoom-loader.js` del sitio original (que muestra un
 * selector de 7 sabores de DOOM):
 *
 *   - No hay selector: se lanza siempre Freedoom Phase 1 (precargado por
 *     `uzdoom.data` como /freedoom1.wad) + `mods/zombie-escape.pk3`.
 *   - Los argumentos se construyen desde los controles del laboratorio, tal
 *     como pide la especificación §5: `+set dze_lambda ...`, `+map MAP01`.
 *   - Se conserva el Service Worker COOP/COEP (`coi-serviceworker.js`), el
 *     botón de borrado de datos guardados, el pointer-lock y los controles
 *     táctiles.
 *   - La telemetría del mod se engancha a `Module.print` (telemetry-bridge).
 *
 * El motor NO se arranca si `crossOriginIsolated` es falso: sin aislamiento
 * no hay SharedArrayBuffer y los pthreads de Emscripten se quedan colgados.
 */

import { createTelemetryBridge } from './telemetry-bridge.js';

const ENGINE_BASE = new URL('../engine/', import.meta.url);

/** Mismos recursos que consume el loader original de Joe Heyming. */
const CORE_ASSETS = [
  ['uzdoom.pk3', '/uzdoom.pk3'],
  ['game_support.pk3', '/game_support.pk3'],
  ['brightmaps.pk3', '/brightmaps.pk3'],
  ['lights.pk3', '/lights.pk3'],
  ['game_widescreen_gfx.pk3', '/game_widescreen_gfx.pk3'],
  ['soundfonts/uzdoom.sf2', '/soundfonts/uzdoom.sf2'],
  ['fm_banks/GENMIDI.GS.wopl', '/fm_banks/GENMIDI.GS.wopl'],
  ['fm_banks/gs-by-papiezak-and-sneakernets.wopn', '/fm_banks/gs-by-papiezak-and-sneakernets.wopn']
];

const PK3_URL = new URL('../mods/zombie-escape.pk3', import.meta.url);
const PK3_FS = '/wads/zombie-escape.pk3';

const BINDS = [
  'bind w "+forward"',
  'bind s "+back"',
  'bind a "+moveleft"',
  'bind d "+moveright"',
  'bind e "+use"',
  'bind space "+use"',
  'bind ctrl "+attack"',
  'bind mouse1 "+attack"',
  'bind leftarrow "+left"',
  'bind rightarrow "+right"',
  'bind uparrow "+forward"',
  'bind downarrow "+back"',
  'bind f "toggle fullscreen"',
  'use_joystick 0',
  'vid_maxfps 60',
  'cl_capfps 1',
  ''
].join('\n');

/** Formatea bytes para la UI. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' kB';
  return n + ' B';
}

/** Comprueba si el bootstrap de la infraestructura ya se ejecutó. */
export async function checkEnginePresent() {
  const required = ['uzdoom.js', 'uzdoom.wasm', 'uzdoom.data'];
  const missing = [];
  for (const name of required) {
    try {
      const res = await fetch(new URL(name, ENGINE_BASE), { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) missing.push(name);
    } catch (_e) {
      missing.push(name);
    }
  }
  return { ok: missing.length === 0, missing };
}

export function isCrossOriginIsolated() {
  return typeof window !== 'undefined' && window.crossOriginIsolated === true;
}

/**
 * Motor: un único objeto por página. `boot()` sólo puede llamarse una vez
 * (el runtime de Emscripten no se puede reiniciar; para reiniciar se recarga).
 */
export class DzeEngine {
  constructor(opts = {}) {
    this.canvas = opts.canvas || document.getElementById('canvas');
    this.onStatus = opts.onStatus || (() => {});
    this.onProgress = opts.onProgress || (() => {});
    this.onTelemetry = opts.onTelemetry || null;

    this.telemetry = createTelemetryBridge({
      handlers: {
        onBoot: (p) => this.onTelemetry && this.onTelemetry('boot', p),
        onStep: (p) => this.onTelemetry && this.onTelemetry('step', p),
        onResult: (p) => this.onTelemetry && this.onTelemetry('result', p),
        onLine: (line) => this.onTelemetry && this.onTelemetry('line', line)
      }
    });

    this.booted = false;
    this.booting = false;
    this.totalBytes = 0;
    this.args = [];
  }

  status(msg, extra = {}) {
    try {
      this.onStatus({ message: msg, ...extra });
    } catch (_e) {
      /* la UI no debe romper el arranque */
    }
  }

  /** Descarga un recurso dentro de MEMFS con progreso. */
  async fetchToFs(rel, fsPath, label) {
    const url = new URL(rel, ENGINE_BASE);
    const res = await fetch(url);
    if (!res.ok) throw new Error(rel + ': HTTP ' + res.status);

    const total = parseInt(res.headers.get('Content-Length') || '0', 10);
    let bytes;
    if (!res.body || !res.body.getReader) {
      bytes = new Uint8Array(await res.arrayBuffer());
    } else {
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        this.onProgress({
          label: label || rel,
          received,
          total,
          overall: this.totalBytes ? (this.totalBytes + received) / this.totalAssetsBytes : 0
        });
      }
      bytes = new Uint8Array(received);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.length;
      }
    }

    const dir = fsPath.substring(0, fsPath.lastIndexOf('/'));
    if (dir) {
      try {
        FS.mkdirTree(dir);
      } catch (_e) {
        /* ya existe */
      }
    }
    FS.writeFile(fsPath, bytes);
    this.totalBytes += bytes.length;
    return bytes.length;
  }

  /** Espera a que el runtime de Emscripten esté listo (o falle). */
  waitForRuntime(timeoutMs = 120000) {
    const Module = window.Module;
    return new Promise((resolve, reject) => {
      if (Module.calledRun) {
        resolve();
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('El runtime WASM no terminó de inicializar en ' + timeoutMs / 1000 + ' s'));
      }, timeoutMs);

      Module.onRuntimeInitialized = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      Module.onAbort = (reason) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(new Error('Abort del runtime: ' + reason));
      };
    });
  }

  async boot(config) {
    if (this.booted || this.booting) return;
    this.booting = true;

    try {
      if (!isCrossOriginIsolated()) {
        throw new Error(
          'La página no está aislada entre orígenes (COOP/COEP). ' +
            'Recarga la página o sírvela con scripts/serve.py; sin SharedArrayBuffer el motor no arranca.'
        );
      }

      const engineCheck = await checkEnginePresent();
      if (!engineCheck.ok) {
        throw new Error(
          'Falta la infraestructura del motor en public/engine/ (' +
            engineCheck.missing.join(', ') +
            '). Ejecuta `make bootstrap`.'
        );
      }

      this.status('Cargando el motor UZDoom…');

      // 1) Stub de Module antes de cargar uzdoom.js.
      const Module = this.installModuleStub();
      this.telemetry.attachToModule(Module);

      // 2) Cargar el pegamento de Emscripten.
      await this.loadScript(new URL('uzdoom.js', ENGINE_BASE).href);
      await this.waitForRuntime();

      // 3) Recursos del motor (pk3 base, soundfonts) en MEMFS.
      this.totalAssetsBytes = CORE_ASSETS.reduce(
        (acc, [rel]) => acc + guessAssetSize(rel),
        0
      );
      for (let i = 0; i < CORE_ASSETS.length; i++) {
        const [rel, fsPath] = CORE_ASSETS[i];
        this.status('Cargando recursos del motor (' + (i + 1) + '/' + CORE_ASSETS.length + ')…');
        try {
          await this.fetchToFs(rel, fsPath, rel);
        } catch (e) {
          // Los soundfonts son opcionales: sin ellos hay música sintetizada
          // por defecto o silencio, pero el juego funciona.
          console.warn('[DZE] recurso del motor no disponible:', rel, e);
          this.status('Aviso: no se pudo cargar ' + rel);
        }
      }

      // 4) El mod: PK3 en MEMFS.
      this.status('Montando zombie-escape.pk3…');
      const pk3 = await this.fetchToFs(PK3_URL.href, PK3_FS, 'mods/zombie-escape.pk3');
      if (pk3 < 1024) throw new Error('zombie-escape.pk3 parece vacío o incompleto');

      // 5) Configuración de teclas.
      try {
        FS.writeFile('/dze-binds.cfg', BINDS);
      } catch (e) {
        console.warn('[DZE] no se pudo escribir la configuración de teclas:', e);
      }

      // 6) Argumentos del laboratorio.
      this.args = buildArgs(config);
      Module.arguments = this.args;
      console.log('[DZE] argv:', this.args);

      if (!fileExists('/freedoom1.wad')) {
        throw new Error('No se encontró /freedoom1.wad: ¿se cargó uzdoom.data?');
      }

      // 7) Arrancar.
      this.status('Iniciando el motor…');
      this.booted = true;

      if (this.canvas) {
        this.canvas.classList.remove('hidden');
        // preventScroll: enfocar el canvas no debe arrastrar la página; el
        // salto de scroll se percibía como si los controles «se movieran solos».
        try {
          this.canvas.focus({ preventScroll: true });
        } catch (_e) {
          this.canvas.focus();
        }
      }

      this.installInputCapture();

      try {
        Module.callMain(this.args);
      } catch (e) {
        if (e && (e.name === 'ExitStatus' || e.name === 'ProgramExit')) {
          this.status('El motor terminó la sesión.');
          return;
        }
        throw e;
      }

      this.status('Motor en marcha.');
    } catch (err) {
      this.booting = false;
      this.booted = false;
      this.status('Error: ' + (err && err.message ? err.message : String(err)), { error: true });
      throw err;
    }
    this.booting = false;
  }

  installModuleStub() {
    const canvas = this.canvas;
    const self_ = this;

    const Module = {
      canvas,
      arguments: [],
      print(text) {
        console.log('[uzdoom]', text);
      },
      printErr(text) {
        console.warn('[uzdoom]', text);
      },
      setStatus(text) {
        self_.status(text || '');
      },
      monitorRunDependencies(n) {
        self_.status(n ? 'Cargando el motor… (' + n + ')' : 'Motor listo.');
      },
      locateFile(path /*, prefix */) {
        // Emscripten llama a locateFile("uzdoom.data", "") para el paquete de
        // datos y locateFile("uzdoom.wasm", scriptDirectory) para el binario.
        // Devolver siempre una URL absoluta contra engine/ evita que el .data
        // se busque junto al HTML (404 al montar el motor fuera de su carpeta).
        return new URL(path, ENGINE_BASE).href;
      },
      onAbort(reason) {
        console.warn('[uzdoom] abort:', reason);
      }
    };
    window.Module = Module;
    return Module;
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.body.appendChild(script);
    });
  }

  /**
   * Mientras el motor corre, las teclas del juego no deben disparar acciones
   * del navegador: con el foco en el canvas, ArrowUp/ArrowDown/Espacio hacían
   * scroll de la página (el visor se iba de la pantalla) y Backspace podía
   * navegar atrás. Se anula el comportamiento por defecto sin detener la
   * propagación, así que el motor sigue recibiendo el evento.
   */
  installInputCapture() {
    if (this.inputCaptureInstalled) return;
    this.disablePointerLock();
    this.inputCaptureInstalled = true;

    const GAME_KEYS = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
      'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyQ', 'KeyR',
      'PageUp', 'PageDown', 'Home', 'End', 'Backspace'
    ]);
    const isFormField = (el) =>
      !!el && el.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);

    this._onKeyDown = (e) => {
      if (!this.booted) return;
      // En un campo de la UI (semilla, episodios…) el teclado es del usuario.
      if (isFormField(e.target)) return;
      if (!GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      const c = this.canvas;
      if (c && document.activeElement !== c && c.focus) {
        try {
          c.focus({ preventScroll: true });
        } catch (_e) {
          c.focus();
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown, { capture: true, passive: false });

    // Rueda del ratón sobre el visor: no debe desplazar la página mientras se juega.
    const panel = this.canvas && this.canvas.parentElement;
    if (panel) {
      this._onWheel = (e) => {
        if (this.booted) e.preventDefault();
      };
      panel.addEventListener('wheel', this._onWheel, { passive: false });
    }

    // Los botones no conservan el foco: si lo hicieran, Espacio (usar) los
    // volvería a pulsar y reiniciaría el experimento.
    for (const btn of document.querySelectorAll('.toolbar button, .toolbar-wrap button, #startBtn')) {
      btn.addEventListener('click', () => btn.blur());
    }
  }

  /**
   * La cámara es fija: no hay ratón que capturar. El motor (SDL) pide
   * pointer-lock al activar el ratón relativo en el arranque, y el navegador
   * se queda con el cursor; aquí se desactiva esa petición para que el ratón
   * siga siendo del usuario (menús, rueda, selección de texto).
   */
  disablePointerLock() {
    if (this.pointerLockDisabled) return;
    this.pointerLockDisabled = true;

    const noop = () => Promise.resolve();
    const c = this.canvas;
    if (c) {
      for (const name of [
        'requestPointerLock',
        'mozRequestPointerLock',
        'webkitRequestPointerLock',
        'msRequestPointerLock'
      ]) {
        try {
          c[name] = noop;
        } catch (_e) {
          /* propiedad de solo lectura: se ignora */
        }
      }
    }
    // Otros caminos que usan Emscripten (document.body.requestPointerLock).
    try {
      if (document.body) document.body.requestPointerLock = noop;
    } catch (_e) {
      /* ignore */
    }

    // Red de seguridad: si aun así se bloquea, se libera de inmediato.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch (_e) {
          /* ignore */
        }
      }
    });
  }

  requestPointerLock() {
    const c = this.canvas;
    if (!c || !c.requestPointerLock) return;
    // Desactivado a propósito: la cámara es fija (ver disablePointerLock).
    return;
  }

  toggleFullscreen() {
    const c = this.canvas;
    if (!c) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (c.requestFullscreen) {
      c.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  }

  /** Borra datos guardados (IndexedDB/CacheStorage) y recarga. */
  async resetSavedData() {
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const d of dbs) {
          if (d && d.name) {
            await new Promise((resolve) => {
              const req = indexedDB.deleteDatabase(d.name);
              req.onsuccess = req.onerror = req.onblocked = () => resolve();
            });
          }
        }
      }
    } catch (e) {
      console.warn('[DZE] no se pudo borrar IndexedDB:', e);
    }
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.warn('[DZE] no se pudo borrar CacheStorage:', e);
    }
    this.status('Datos guardados borrados. Recargando…');
    setTimeout(() => window.location.reload(), 300);
  }
}

/** Argumentos de línea de comandos del experimento (especificación §5.3). */
export function buildArgs(config = {}) {
  const cfg = {
    lambda: 0.03,
    seed: 42,
    controller: 0,
    stepTics: DZE_DEFAULT_STEP_TICS,
    ...config
  };
  return [
    '-iwad',
    '/freedoom1.wad',
    '-file',
    PK3_FS,
    '-exec',
    '/dze-binds.cfg',
    '+set',
    'dze_lambda',
    String(cfg.lambda),
    '+set',
    'dze_seed',
    String(cfg.seed),
    '+set',
    'dze_controller',
    String(cfg.controller),
    '+set',
    'dze_step_tics',
    String(cfg.stepTics),
    '+vid_fullscreen',
    '0',
    // Observador: sin barra de estado y con campo de vision amplio.
    '+set',
    'screenblocks',
    '11',
    '+set',
    'fov',
    '100',
    '+map',
    'MAP01'
  ];
}

const DZE_DEFAULT_STEP_TICS = 7;

/** Los tamaños se conocen sólo al descargar; estimación para la barra global. */
function guessAssetSize(rel) {
  if (rel.endsWith('uzdoom.pk3')) return 2988981;
  if (rel.endsWith('game_support.pk3')) return 2375551;
  if (rel.endsWith('game_widescreen_gfx.pk3')) return 5530182;
  if (rel.endsWith('.sf2')) return 3299098;
  return 300000;
}

function fileExists(path) {
  try {
    FS.stat(path);
    return true;
  } catch (_e) {
    return false;
  }
}
