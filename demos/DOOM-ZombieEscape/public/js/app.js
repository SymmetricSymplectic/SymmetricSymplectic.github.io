/**
 * app.js — cableado del laboratorio: controles → motor, telemetría → gráficas.
 *
 * Responsabilidades:
 *   - leer los controles y construir la configuración del experimento,
 *   - arrancar DzeEngine (una sola vez por carga de página),
 *   - volcar la telemetría del mod en las gráficas y en las cifras,
 *   - correr el lote Monte Carlo del modo analítico y ajustar α̂₁,
 *   - inyectar controles táctiles cuando el dispositivo los necesita.
 */

import { DzeEngine, checkEnginePresent, isCrossOriginIsolated } from './dze-loader.js';
import { createPlots } from './plots.js';
import { summarizeByLambda, fitLogLog } from './telemetry-bridge.js';
import { runBatch, runEpisode, DZE_CONST } from './dze-model.js';

const $ = (id) => document.getElementById(id);

const ui = {
  lambda: $('lambdaRange'),
  lambdaOut: $('lambdaValue'),
  lambdaExpect: $('lambdaExpect'),
  seed: $('seedInput'),
  controller: $('controllerSelect'),
  controlHint: $('controlHint'),
  stepTics: $('stepTicsRange'),
  stepTicsOut: $('stepTicsValue'),
  start: $('startBtn'),
  fullscreen: $('fullscreenBtn'),
  reset: $('resetBtn'),
  status: $('statusText'),
  progressText: $('progressText'),
  progressBar: $('progressBar'),
  enginePanel: $('enginePanel'),
  placeholder: $('enginePlaceholder'),
  missing: $('engineMissing'),
  canvas: $('canvas'),
  statSteps: $('statSteps'),
  statMinD: $('statMinD'),
  statShock: $('statShock'),
  statZombies: $('statZombies'),
  statCell: $('statCell'),
  resultText: $('resultText'),
  batchEpisodes: $('batchEpisodes'),
  batchController: $('batchController'),
  batchBtn: $('batchBtn'),
  batchStatus: $('batchStatus'),
  batchTable: $('batchTable'),
  exampleBtn: $('exampleBtn')
};

const plots = createPlots({
  radar: $('radarCanvas'),
  series: $('seriesCanvas'),
  regression: $('regressionCanvas'),
  alphaText: $('alphaText')
});

/* ------------------------------------------------------------------------- */
/* Controles                                                                  */
/* ------------------------------------------------------------------------- */

function readConfig() {
  const lambda = Number(ui.lambda.value);
  const seed = Math.max(0, Math.round(Number(ui.seed.value) || 0));
  const controller = Number(ui.controller.value);
  const stepTics = Math.max(1, Math.round(Number(ui.stepTics.value) || 7));
  return { lambda, seed, controller, stepTics };
}

function updateOutputs() {
  const cfg = readConfig();
  ui.lambdaOut.textContent = cfg.lambda.toFixed(3);
  ui.stepTicsOut.textContent = String(cfg.stepTics);
  const expected = Math.round(cfg.lambda * ((2 * DZE_CONST.RADIUS + 1) ** 2 - 1));
  ui.lambdaExpect.textContent = expected.toLocaleString('es-MX');
}

const CONTROL_HINTS = {
  0: 'T? mueves a Mindy con WASD o las flechas; los zombis avanzan cada dze_step_tics tics.',
  1: 'El algoritmo APW mueve a Mindy en cada paso; el teclado se ignora y solo puedes girar la vista.',
  2: 'El Greedy ?? mueve a Mindy en cada paso; el teclado se ignora y solo puedes girar la vista.',
  3: 'T? mueves a Mindy; el rombo violeta del radar es la gemela APW que juega el algoritmo.'
};

function updateControlHint() {
  if (!ui.controlHint) return;
  ui.controlHint.textContent = CONTROL_HINTS[Number(ui.controller.value)] || CONTROL_HINTS[0];
}

for (const el of [ui.lambda, ui.seed, ui.controller, ui.stepTics]) {
  el.addEventListener('input', () => {
    updateOutputs();
    updateControlHint();
  });
}
updateOutputs();
updateControlHint();

/* ------------------------------------------------------------------------- */
/* Estado del motor                                                           */
/* ------------------------------------------------------------------------- */

let engine = null;
let engineBooted = false;

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.progressText.textContent = '';
  ui.status.style.color = isError ? 'var(--bad)' : '';
}

function setProgress(overall, label, received, total) {
  const pct = Math.max(0, Math.min(1, overall || 0)) * 100;
  ui.progressBar.style.width = pct.toFixed(1) + '%';
  if (label) {
    const bytes = total
      ? formatPair(received, total)
      : received
        ? Math.round(received / 1024) + ' kB'
        : '';
    ui.progressText.textContent = label + (bytes ? ' · ' + bytes : '');
  }
}

function formatPair(a, b) {
  const f = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' kB');
  return f(a) + ' / ' + f(b);
}

function ensureEngine() {
  if (engine) return engine;
  engine = new DzeEngine({
    canvas: ui.canvas,
    onStatus: (s) => {
      setStatus(s.message, s.error);
      if (s.message && /Listo|marcha/.test(s.message)) {
        ui.progressBar.style.width = '100%';
      }
    },
    onProgress: (p) => setProgress(p.overall, p.label, p.received, p.total),
    onTelemetry: (kind, payload) => {
      if (kind === 'boot') {
        ui.statZombies.textContent = Number(payload.zombies).toLocaleString('es-MX');
        plots.setBoot(payload);
        setStatus(
          'Episodio en marcha: λ=' +
            Number(payload.lambda).toFixed(3) +
            ', ' +
            payload.zombies +
            ' zombis, controlador ' +
            payload.controller +
            '.'
        );
      } else if (kind === 'step') {
        plots.pushStep(payload);
        ui.statSteps.textContent = String(payload.t);
        ui.statMinD.textContent = String(payload.min_d1);
        ui.statShock.textContent = String(payload.shock);
        ui.statCell.textContent = payload.mx + ', ' + payload.my;
      } else if (kind === 'result') {
        plots.setResult(payload);
        const caught = Number(payload.caught) === 1;
        ui.resultText.textContent = caught
          ? 'Atrapada en τ = ' + payload.tau + ' pasos (λ = ' + Number(payload.lambda).toFixed(3) + ').'
          : 'Supervivencia hasta el horizonte de ' + payload.tau + ' pasos (episodio censurado).';
        setStatus(caught ? 'Episodio terminado: captura en τ = ' + payload.tau + '.' : 'Horizonte alcanzado sin captura.');
      }
    }
  });
  return engine;
}

async function startExperiment() {
  if (engineBooted) {
    // El runtime WASM no se puede reiniciar: se recarga con la configuración
    // actual en la URL para repetir el experimento en las mismas condiciones.
    const cfg = readConfig();
    const params = new URLSearchParams({
      lambda: String(cfg.lambda),
      seed: String(cfg.seed),
      controller: String(cfg.controller),
      tics: String(cfg.stepTics),
      auto: '1'
    });
    window.location.search = params.toString();
    return;
  }

  const cfg = readConfig();
  ui.start.disabled = true;
  setStatus('Preparando el motor…');

  try {
    const eng = ensureEngine();
    await eng.boot(cfg);
    engineBooted = true;
    ui.placeholder.classList.add('hidden');
    ui.canvas.classList.remove('hidden');
    ui.start.textContent = 'Reiniciar con estos parámetros';
    setStatus('Motor en marcha.');
    ui.progressBar.style.width = '100%';
  } catch (err) {
    console.error('[DZE] fallo al arrancar:', err);
    setStatus(String(err && err.message ? err.message : err), true);
    ui.start.disabled = false;
  }
}

ui.start.addEventListener('click', startExperiment);

ui.canvas.addEventListener('click', () => {
  if (engine) engine.requestPointerLock();
});

ui.fullscreen.addEventListener('click', () => {
  if (engine) engine.toggleFullscreen();
  else if (ui.canvas.requestFullscreen) ui.canvas.requestFullscreen().catch(() => {});
});

ui.reset.addEventListener('click', () => {
  if (window.confirm('¿Borrar los datos guardados del motor (partidas, configuración) y recargar?')) {
    if (engine) engine.resetSavedData();
    else window.location.reload();
  }
});

/* ------------------------------------------------------------------------- */
/* Arranque: comprobaciones previas                                           */
/* ------------------------------------------------------------------------- */

(async function preflight() {
  // Autostart desde la URL (?lambda=…&seed=…&auto=1), usado por "Reiniciar".
  const params = new URLSearchParams(window.location.search);
  if (params.has('lambda')) {
    const l = Number(params.get('lambda'));
    if (Number.isFinite(l)) ui.lambda.value = String(Math.min(0.2, Math.max(0.005, l)));
  }
  if (params.has('seed')) ui.seed.value = params.get('seed');
  if (params.has('controller')) ui.controller.value = params.get('controller');
  if (params.has('tics')) ui.stepTics.value = params.get('tics');
  updateOutputs();

  const presence = await checkEnginePresent();
  if (!presence.ok) {
    ui.missing.hidden = false;
    ui.start.disabled = true;
    setStatus(
      'Falta la infraestructura del motor (' + presence.missing.join(', ') + '). Ejecuta `make bootstrap`.',
      true
    );
    return;
  }

  if (!isCrossOriginIsolated()) {
    setStatus(
      'La página no está aislada entre orígenes; el Service Worker debería recargarla en unos segundos…',
      true
    );
    return;
  }

  setStatus('Todo listo: pulsa «Iniciar experimento».');
  if (params.get('auto') === '1') {
    startExperiment();
  }
})();

/* ------------------------------------------------------------------------- */
/* Lote Monte Carlo (modo analítico)                                          */
/* ------------------------------------------------------------------------- */

function renderTable(samples) {
  const summary = summarizeByLambda(samples);
  if (!summary.length) {
    ui.batchTable.innerHTML = '<tr><td colspan="6" class="muted">Sin resultados.</td></tr>';
    return;
  }
  ui.batchTable.innerHTML = summary
    .map((g) => {
      const captured = g.samples.filter((t) => t > 0).length;
      return (
        '<tr>' +
        '<td>' + g.lambda.toFixed(4) + '</td>' +
        '<td>' + Math.log(1 / g.lambda).toFixed(3) + '</td>' +
        '<td>' + g.n + '</td>' +
        '<td>' + g.mean.toFixed(1) + '</td>' +
        '<td>' + g.se.toFixed(2) + '</td>' +
        '<td>' + captured + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

async function runBatchNow() {
  ui.batchBtn.disabled = true;
  ui.exampleBtn.disabled = true;
  ui.batchStatus.textContent = 'Ejecutando lote…';

  const lambdas = [0.01, 0.02, 0.04, 0.08, 0.16];
  const episodes = Math.max(1, Math.min(60, Number(ui.batchEpisodes.value) || 8));
  const controller = Number(ui.batchController.value);
  const seed = readConfig().seed;

  try {
    const samples = await runBatch({
      lambdas,
      episodes,
      seed,
      controller,
      maxSteps: 900,
      onProgress: (done, total, out) => {
        ui.batchStatus.textContent = 'Ejecutando lote… ' + done + '/' + total + ' episodios';
        if (done % 8 === 0) renderTable(out);
      }
    });

    renderTable(samples);
    plots.setBatch(samples);
    const fit = fitLogLog(samples);
    ui.batchStatus.textContent = Number.isFinite(fit.slope)
      ? 'Lote terminado: ' + samples.length + ' episodios, α̂₁ = ' + fit.slope.toFixed(3) +
        ' (R² = ' + fit.r2.toFixed(3) + ').'
      : 'Lote terminado, pero no hay suficientes densidades con τ > 0 para ajustar α̂₁.';
  } catch (err) {
    console.error(err);
    ui.batchStatus.textContent = 'Error en el lote: ' + err.message;
  } finally {
    ui.batchBtn.disabled = false;
    ui.exampleBtn.disabled = false;
  }
}

ui.batchBtn.addEventListener('click', runBatchNow);

ui.exampleBtn.addEventListener('click', () => {
  const cfg = readConfig();
  const controller = Number(ui.batchController.value);
  const started = performance.now();
  const ep = runEpisode({
    seed: cfg.seed,
    lambda: cfg.lambda,
    controller,
    maxSteps: 900,
    record: true
  });
  const ms = Math.round(performance.now() - started);
  plots.setExample(ep);
  ui.batchStatus.textContent =
    'Episodio de ejemplo: ' + (ep.caught ? 'captura en τ = ' + ep.tau : 'supervivencia ' + ep.tau) +
    ', ' + ep.zombies + ' zombis, ' + ms + ' ms (controlador ' +
    (controller === 2 ? 'Greedy ℓ¹' : 'APW') + ').';
});

/* ------------------------------------------------------------------------- */
/* Controles táctiles                                                        */
/* ------------------------------------------------------------------------- */

const KEYMAP = {
  forward: { code: 'KeyW', key: 'w', keyCode: 87 },
  back: { code: 'KeyS', key: 's', keyCode: 83 },
  left: { code: 'KeyA', key: 'a', keyCode: 65 },
  right: { code: 'KeyD', key: 'd', keyCode: 68 },
  use: { code: 'KeyE', key: 'e', keyCode: 69 },
  fire: { code: 'ControlLeft', key: 'Control', keyCode: 17 },
  menu: { code: 'Escape', key: 'Escape', keyCode: 27 }
};

function synth(action, down) {
  const k = KEYMAP[action];
  if (!k) return;
  const evt = new KeyboardEvent(down ? 'keydown' : 'keyup', {
    code: k.code,
    key: k.key,
    keyCode: k.keyCode,
    which: k.keyCode,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(evt);
}

function installTouchPad() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!coarse || !ui.enginePanel) return;

  const pad = document.createElement('div');
  pad.className = 'touch-pad';
  pad.innerHTML =
    '<div class="cluster">' +
    '<button type="button" class="up" data-act="forward" aria-label="Avanzar">▲</button>' +
    '<button type="button" class="left" data-act="left" aria-label="Izquierda">◀</button>' +
    '<button type="button" class="down" data-act="back" aria-label="Retroceder">▼</button>' +
    '<button type="button" class="right" data-act="right" aria-label="Derecha">▶</button>' +
    '</div>' +
    '<div>' +
    '<button type="button" data-act="use" aria-label="Usar">E</button>' +
    '<button type="button" data-act="fire" aria-label="Disparar">◎</button>' +
    '<button type="button" data-act="menu" aria-label="Menú">≡</button>' +
    '</div>';

  for (const btn of pad.querySelectorAll('button')) {
    const act = btn.dataset.act;
    const start = (e) => {
      e.preventDefault();
      synth(act, true);
    };
    const stop = (e) => {
      e.preventDefault();
      synth(act, false);
    };
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('touchend', stop, { passive: false });
    btn.addEventListener('touchcancel', stop, { passive: false });
    btn.addEventListener('mousedown', start);
    btn.addEventListener('mouseup', stop);
  }

  ui.enginePanel.appendChild(pad);
}

installTouchPad();
