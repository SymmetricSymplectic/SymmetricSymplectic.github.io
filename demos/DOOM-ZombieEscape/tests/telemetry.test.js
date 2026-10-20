/**
 * tests/telemetry.test.js — parser de [DZE_*] y estadística del experimento.
 *
 * Cubre el criterio de aceptación §6.3: el parser de [DZE_STEP]/[DZE_RESULT] y
 * el cálculo de la pendiente α̂₁ por mínimos cuadrados ordinarios sobre
 * (log(1/λ), log τ).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DZE,
  parseLine,
  createTelemetryBridge,
  linearRegression,
  fitLogLog,
  summarizeByLambda
} from '../public/js/telemetry-bridge.js';

test('parseLine reconoce [DZE_STEP] con el formato de la especificación', () => {
  const evt = parseLine('[DZE_STEP] {"t":12,"mx":-3,"my":4,"min_d1":17,"shock":9}');
  assert.equal(evt.tag, DZE.STEP);
  assert.deepEqual(evt.missing, []);
  assert.equal(evt.payload.t, 12);
  assert.equal(evt.payload.mx, -3);
  assert.equal(evt.payload.my, 4);
  assert.equal(evt.payload.min_d1, 17);
  assert.equal(evt.payload.shock, 9);
});

test('parseLine sobrevive a prefijos del motor y a espacios', () => {
  const evt = parseLine('   [uzdoom] [DZE_RESULT] {"caught":1,"tau":28,"lambda":0.005}   \r');
  assert.ok(evt);
  assert.equal(evt.tag, DZE.RESULT);
  assert.equal(evt.payload.tau, 28);
  assert.deepEqual(evt.missing, ['seed', 'controller', 'zombies']);
});

test('parseLine ignora líneas ajenas y detecta JSON inválido', () => {
  assert.equal(parseLine('W_Init: Init WADfiles.'), null);
  assert.equal(parseLine(''), null);
  assert.equal(parseLine(null), null);

  const bad = parseLine('[DZE_STEP] {t:1,');
  assert.equal(bad.tag, DZE.STEP);
  assert.equal(bad.payload, null);
  assert.equal(bad.error, 'json-invalido');
});

test('el puente reensambla líneas partidas entre escrituras', () => {
  const seen = [];
  const bridge = createTelemetryBridge({ handlers: { onStep: (p) => seen.push(p) } });

  bridge.handleChunk('[DZE_STEP] {"t":1,"mx":0,"my":0,');
  assert.equal(seen.length, 0);
  bridge.handleChunk('"min_d1":3,"shock":1}\n[DZE_STEP] {"t":2,"mx":0,"my":1,"min_d1":2,"shock":2}\n');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].t, 2);
  assert.equal(bridge.counters.steps, 2);
});

test('el puente guarda BOOT/RESULT y acota el histórico', () => {
  const bridge = createTelemetryBridge({ maxSteps: 3 });
  bridge.handleChunk(
    '[DZE_BOOT] {"lambda":0.03,"seed":42,"controller":1,"step_tics":7,"zombies":1742}\n' +
      '[DZE_RESULT] {"caught":1,"tau":9,"lambda":0.03,"seed":42,"controller":1,"zombies":1742}\n' +
      [1, 2, 3, 4, 5]
        .map(
          (t) =>
            `[DZE_STEP] {"t":${t},"mx":${t},"my":0,"min_d1":${5 - t},"shock":0}\n`
        )
        .join('')
  );
  assert.equal(bridge.boot.zombies, 1742);
  assert.equal(bridge.result.tau, 9);
  assert.equal(bridge.steps.length, 3);
  assert.deepEqual(
    bridge.steps.map((s) => s.t),
    [3, 4, 5]
  );
});

test('attachToModule envuelve print sin perder la salida original', () => {
  const lines = [];
  const Module = { print: (t) => lines.push('orig:' + t) };
  const bridge = createTelemetryBridge({});
  bridge.attachToModule(Module);
  Module.print('[DZE_STEP] {"t":1,"mx":0,"my":0,"min_d1":4,"shock":0}');
  assert.equal(bridge.steps.length, 1);
  assert.deepEqual(lines, ['orig:[DZE_STEP] {"t":1,"mx":0,"my":0,"min_d1":4,"shock":0}']);
});

test('linearRegression recupera una recta exacta', () => {
  const pts = [0, 1, 2, 3, 4].map((x) => [x, 2 * x + 1]);
  const fit = linearRegression(pts);
  assert.ok(Math.abs(fit.slope - 2) < 1e-12);
  assert.ok(Math.abs(fit.intercept - 1) < 1e-12);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-12);
  assert.equal(fit.n, 5);
});

test('linearRegression descarta puntos no finitos y series degeneradas', () => {
  const fit = linearRegression([
    [1, 2],
    [NaN, 3],
    [2, 4],
    [3, null]
  ]);
  assert.equal(fit.n, 2);
  assert.ok(Math.abs(fit.slope - 2) < 1e-12);
  assert.ok(Number.isNaN(linearRegression([[1, 1]]).slope));
});

test('fitLogLog estima alpha en tau ~ lambda^-alpha', () => {
  // tau = 100 * lambda^-0.5  => log tau = log 100 + 0.5 log(1/lambda)
  const samples = [0.005, 0.01, 0.02, 0.04, 0.08, 0.16].map((lambda) => ({
    lambda,
    tau: 100 * Math.pow(lambda, -0.5)
  }));
  const fit = fitLogLog(samples);
  assert.equal(fit.n, 6);
  assert.ok(Math.abs(fit.alpha - 0.5) < 1e-12, 'alpha = ' + fit.alpha);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-12);
});

test('summarizeByLambda agrupa, promedia y calcula el error estándar', () => {
  const samples = [
    { lambda: 0.01, tau: 10 },
    { lambda: 0.01, tau: 14 },
    { lambda: 0.02, tau: 5 }
  ];
  const summary = summarizeByLambda(samples);
  assert.equal(summary.length, 2);
  assert.equal(summary[0].lambda, 0.01);
  assert.equal(summary[0].mean, 12);
  assert.equal(summary[0].n, 2);
  assert.ok(Math.abs(summary[0].se - Math.sqrt(8) / Math.sqrt(2)) < 1e-12);
});
