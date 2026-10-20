/**
 * telemetry-bridge.js — puente entre el motor UZDoom/WASM y el laboratorio.
 *
 * El mod emite una línea JSON por evento a través de `Console.Printf`, que en
 * el build WASM termina en `Module.print` (stdout de Emscripten). Este módulo:
 *
 *   1. envuelve `Module.print`/`printErr` sin romper el logging del motor,
 *   2. reensambla líneas partidas entre escrituras,
 *   3. reconoce `[DZE_BOOT]`, `[DZE_STEP]` y `[DZE_RESULT]`,
 *   4. valida y normaliza el JSON,
 *   5. calcula la estadística del experimento (MCO sobre log(1/lambda), log(tau)).
 *
 * Es código puro (sin DOM) para poder probarse con `node --test`.
 */

export const DZE = Object.freeze({
  BOOT: 'DZE_BOOT',
  STEP: 'DZE_STEP',
  RESULT: 'DZE_RESULT'
});

/** Etiqueta + objeto JSON al final de la línea (tolera prefijos del motor). */
const LINE_RE = /\[(DZE_[A-Z_]+)\]\s*(\{[^\n]*\})\s*$/;

/** Claves mínimas que debe traer cada evento según la especificación §4.3. */
const REQUIRED = Object.freeze({
  DZE_BOOT: ['lambda', 'seed', 'controller', 'step_tics', 'zombies'],
  DZE_STEP: ['t', 'mx', 'my', 'min_d1', 'shock'],
  DZE_RESULT: ['caught', 'tau', 'lambda', 'seed', 'controller', 'zombies']
});

/**
 * Interpreta una línea de stdout del motor.
 * @param {string} line
 * @returns {{tag: string, payload: object, missing: string[], raw: string}|null}
 */
export function parseLine(line) {
  if (typeof line !== 'string') return null;
  const text = line.replace(/\r$/, '');
  const m = LINE_RE.exec(text.trim());
  if (!m) {
    // Etiqueta conocida pero objeto ilegible (línea cortada por el motor).
    const partial = /\[(DZE_[A-Z_]+)\]\s*(\{.*)$/.exec(text.trim());
    if (partial) {
      return { tag: partial[1], payload: null, missing: [], raw: text, error: 'json-invalido' };
    }
    return null;
  }

  const tag = m[1];
  let payload;
  try {
    payload = JSON.parse(m[2]);
  } catch (_e) {
    return { tag, payload: null, missing: [], raw: text, error: 'json-invalido' };
  }
  if (!payload || typeof payload !== 'object') {
    return { tag, payload: null, missing: [], raw: text, error: 'payload-no-objeto' };
  }

  const missing = (REQUIRED[tag] || []).filter((k) => !(k in payload));
  return { tag, payload, missing, raw: text };
}

/** MCO simple: y = a + b x. Devuelve pendiente b, intercepto a, R^2 y n. */
export function linearRegression(points) {
  const pts = (points || []).filter(
    (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
  );
  const n = pts.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN, n };

  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx;
    const dy = y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return { slope: NaN, intercept: NaN, r2: NaN, n };

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

/**
 * Ajuste log-log del tiempo de supervivencia frente a la densidad.
 * x = log(1/lambda), y = log(tau)  =>  tau ~ lambda^(-alpha), alpha = slope.
 * @param {Array<{lambda:number, tau:number}>} samples
 */
export function fitLogLog(samples) {
  const pts = (samples || [])
    .filter((s) => s && s.lambda > 0 && s.tau > 0)
    .map((s) => [Math.log(1 / s.lambda), Math.log(s.tau)]);
  const fit = linearRegression(pts);
  return { ...fit, points: pts, alpha: fit.slope };
}

/** Agrupa muestras por lambda y devuelve la media (y el error estándar). */
export function summarizeByLambda(samples) {
  const groups = new Map();
  for (const s of samples || []) {
    if (!s || !(s.lambda > 0) || !(s.tau >= 0)) continue;
    const key = Number(s.lambda.toPrecision(6));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s.tau);
  }
  const out = [];
  for (const [lambda, taus] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    const n = taus.length;
    const mean = taus.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? taus.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
    out.push({ lambda, mean, se: Math.sqrt(variance / n), n, samples: taus });
  }
  return out;
}

/**
 * Crea el puente. `handlers.onStep/onBoot/onResult/onLine` son opcionales.
 * @param {{maxStepsí: number, handlersí: object}} [opts]
 */
export function createTelemetryBridge(opts = {}) {
  const maxSteps = opts.maxSteps || 6000;
  const handlers = opts.handlers || {};

  const state = {
    boot: null,
    result: null,
    steps: [],
    rawLog: [],
    pending: '',
    counters: { lines: 0, steps: 0, boot: 0, result: 0, invalid: 0 }
  };

  function emit(name, arg) {
    const fn = handlers[name];
    if (typeof fn === 'function') {
      try {
        fn(arg);
      } catch (e) {
        console.error('[DZE] handler ' + name + ' falló:', e);
      }
    }
  }

  function pushStep(step) {
    state.steps.push(step);
    if (state.steps.length > maxSteps) state.steps.splice(0, state.steps.length - maxSteps);
  }

  function handleLine(line) {
    state.counters.lines++;
    if (state.rawLog.length < 4000) state.rawLog.push(line);
    const evt = parseLine(line);
    if (!evt) {
      emit('onLine', line);
      return null;
    }
    if (evt.error || evt.missing.length) {
      state.counters.invalid++;
      console.warn('[DZE] evento incompleto:', evt.error || evt.missing.join(','), line);
      emit('onLine', line);
      return evt;
    }
    if (evt.tag === DZE.BOOT) {
      state.boot = evt.payload;
      state.counters.boot++;
      emit('onBoot', evt.payload);
    } else if (evt.tag === DZE.STEP) {
      pushStep(evt.payload);
      state.counters.steps++;
      emit('onStep', evt.payload);
    } else if (evt.tag === DZE.RESULT) {
      state.result = evt.payload;
      state.counters.result++;
      emit('onResult', evt.payload);
    }
    emit('onEvent', evt);
    return evt;
  }

  /** Texto arbitrario de stdout (puede venir partido). */
  function handleChunk(text) {
    if (typeof text !== 'string') return;
    state.pending += text;
    let idx;
    while ((idx = state.pending.indexOf('\n')) >= 0) {
      const line = state.pending.slice(0, idx);
      state.pending = state.pending.slice(idx + 1);
      if (line.length) handleLine(line);
    }
    // Líneas anormalmente largas sin salto: se descartan para no crecer sin fin.
    if (state.pending.length > 8192) state.pending = '';
  }

  /**
   * Envuelve Module.print/printErr. Devuelve una función para restaurarlos.
   * @param {object} Module
   */
  function attachToModule(Module) {
    if (!Module || Module.__dzeAttached) return () => {};
    Module.__dzeAttached = true;

    const original = {
      print: Module.print,
      printErr: Module.printErr
    };
    Module.print = function (text) {
      handleChunk(String(text) + '\n');
      if (typeof original.print === 'function') original.print.call(Module, text);
      else console.log('[uzdoom]', text);
    };
    Module.printErr = function (text) {
      handleChunk(String(text) + '\n');
      if (typeof original.printErr === 'function') original.printErr.call(Module, text);
      else console.warn('[uzdoom]', text);
    };
    return function detach() {
      Module.print = original.print;
      Module.printErr = original.printErr;
      Module.__dzeAttached = false;
    };
  }

  function reset() {
    state.boot = null;
    state.result = null;
    state.steps.length = 0;
    state.pending = '';
    state.counters = { lines: 0, steps: 0, boot: 0, result: 0, invalid: 0 };
  }

  return {
    state,
    counters: state.counters,
    handleLine,
    handleChunk,
    attachToModule,
    reset,
    get steps() {
      return state.steps;
    },
    get boot() {
      return state.boot;
    },
    get result() {
      return state.result;
    }
  };
}
