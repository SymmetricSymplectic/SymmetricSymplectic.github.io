/**
 * tests/model.test.js — el modelo en JS.
 *
 * Verifica que la implementación de referencia (public/js/dze-model.js) sea
 * determinista, que respete las constantes del mod (pk3_src/zscript/
 * dze_constants.zc) y que reproduzca las propiedades cualitativas esperadas:
 * densidad media, transición geodésica y crecimiento de τ al bajar λ.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DZE_CONST,
  botDx,
  botDy,
  createRng,
  rngNext,
  rngUnit,
  buildCloud,
  stepZombies,
  costAt,
  chooseAPW,
  chooseGreedy,
  runEpisode,
  runBatch,
  expNeg,
  ln,
  invPow,
  l1
} from '../public/js/dze-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const par = (name) => {
  const src = readFileSync(join(REPO, 'pk3_src/zscript/dze_constants.zc'), 'utf8');
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*([-0-9.eE]+)\\s*;').exec(src);
  assert.ok(m, 'constante ' + name + ' no encontrada en dze_constants.zc');
  return Number(m[1]);
};

test('las constantes de dze_constants.zc coinciden con DZE_CONST', () => {
  const pairs = [
    ['DZE_LATTICE_R', DZE_CONST.RADIUS],
    ['DZE_CELL_UNITS', DZE_CONST.CELL_UNITS],
    ['DZE_CELL_TICS_DEF', DZE_CONST.CELL_TICS],
    ['DZE_MAX_STEPS', DZE_CONST.MAX_STEPS],
    ['DZE_MAX_ZOMBIES', DZE_CONST.MAX_ZOMBIES],
    ['DZE_W_IMM', DZE_CONST.W_IMM],
    ['DZE_W_SHOCK', DZE_CONST.W_SHOCK],
    ['DZE_W_VALLEY', DZE_CONST.W_VALLEY],
    ['DZE_GAMMA', DZE_CONST.GAMMA],
    ['DZE_BETA', DZE_CONST.BETA],
    ['DZE_IMM_RADIUS', DZE_CONST.IMM_RADIUS],
    ['DZE_SHOCK_RADIUS', DZE_CONST.SHOCK_RADIUS],
    ['DZE_VALLEY_CUT', DZE_CONST.VALLEY_CUT],
    ['DZE_LAMBDA_MIN', DZE_CONST.LAMBDA_MIN],
    ['DZE_LAMBDA_MAX', DZE_CONST.LAMBDA_MAX],
    ['DZE_SEED_MIX', DZE_CONST.SEED_MIX]
  ];
  for (const [name, value] of pairs) {
    assert.equal(par(name), value, name + ' difiere entre ZScript y JS');
  }
});

test('el LCG es determinista y módulo 2^32', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 50; i++) {
    assert.equal(rngNext(a), rngNext(b));
  }
  const c = createRng(43);
  assert.notEqual(rngNext(c), rngNext(createRng(42)));

  // Recurrencia exacta: x1 = 1664525 * x0 + 1013904223 (mod 2^32).
  const rng = createRng(42);
  const x0 = rng.state;
  const expected = (Math.imul(x0, 1664525) + 1013904223) >>> 0;
  assert.equal(rngNext(rng), expected);
  for (let i = 0; i < 1000; i++) {
    const v = rngUnit(rng);
    assert.ok(v >= 0 && v < 1, 'uniforme fuera de [0,1): ' + v);
  }
});

test('expNeg y ln coinciden con Math con error despreciable', () => {
  for (const x of [0, -0.02, -0.5, -1, -2.5, -7.3, -20, -60]) {
    const mine = expNeg(x);
    const ref = Math.exp(x);
    assert.ok(Math.abs(mine - ref) <= Math.max(1e-9, 2e-3 * ref), `expNeg(${x}) = ${mine} vs ${ref}`);
  }
  for (const x of [0.001, 0.5, 1, 1.7, 2, 9.2, 1000, 123456]) {
    assert.ok(Math.abs(ln(x) - Math.log(x)) < 1e-9, 'ln(' + x + ')');
  }
  assert.ok(Math.abs(invPow(4, 1) - 0.25) < 1e-12);
  assert.ok(Math.abs(invPow(9, 0.5) - 1 / 3) < 1e-9);
});

test('la nube respeta λ, el tamaño de la ventana y excluye el origen', () => {
  const cloud = buildCloud(42, 0.03);
  const cells = (2 * DZE_CONST.RADIUS + 1) ** 2 - 1;
  const expected = cells * 0.03;
  assert.ok(Math.abs(cloud.count - expected) < expected * 0.1, `n=${cloud.count} vs ${expected}`);
  assert.equal(cloud.zx.length, cloud.count);
  for (let i = 0; i < cloud.count; i++) {
    assert.ok(!(cloud.zx[i] === 0 && cloud.zy[i] === 0), 'el origen debe quedar libre');
    assert.ok(Math.abs(cloud.zx[i]) <= DZE_CONST.RADIUS);
    assert.ok(Math.abs(cloud.zy[i]) <= DZE_CONST.RADIUS);
  }
});

test('la nube es reproducible y depende de la semilla', () => {
  const a = buildCloud(7, 0.02);
  const b = buildCloud(7, 0.02);
  const c = buildCloud(8, 0.02);
  assert.deepEqual(Array.from(a.zx), Array.from(b.zx));
  assert.deepEqual(Array.from(a.zy), Array.from(b.zy));
  assert.notDeepEqual(Array.from(a.zx), Array.from(c.zx));
});

test('transición geodésica: sobre la línea de choque avanza recto', () => {
  // Un zombi en (5, 0) y Mindy en (0, 0): dy = 0 => debe acercarse en X.
  const zx = Int32Array.from([5]);
  const zy = Int32Array.from([0]);
  const rng = createRng(1);
  const m = stepZombies(zx, zy, 0, 0, rng);
  assert.equal(zx[0], 4);
  assert.equal(zy[0], 0);
  assert.equal(m.minD, 4);
  assert.equal(m.caught, 0);
});

test('transición geodésica: fuera de la línea de choque mueve un solo eje', () => {
  const zx = Int32Array.from([3]);
  const zy = Int32Array.from([4]);
  const rng = createRng(1);
  stepZombies(zx, zy, 0, 0, rng);
  const movedX = zx[0] === 2 && zy[0] === 4;
  const movedY = zx[0] === 3 && zy[0] === 3;
  assert.ok(movedX || movedY, `movimiento inesperado: (${zx[0]}, ${zy[0]})`);
});

test('captura cuando el zombi alcanza la celda de Mindy', () => {
  const zx = Int32Array.from([1]);
  const zy = Int32Array.from([0]);
  const m = stepZombies(zx, zy, 0, 0, createRng(1));
  assert.equal(m.caught, 1);
  assert.equal(m.minD, 0);
});

test('J penaliza sin límite la celda ocupada', () => {
  const zx = Int32Array.from([2]);
  const zy = Int32Array.from([0]);
  assert.ok(costAt(zx, zy, 2, 0, 0.03) >= 1e29);
  assert.ok(costAt(zx, zy, 0, 0, 0.03) < 1e3);
});

test('APW evita las líneas de choque y se aleja del zombi', () => {
  // Un único zombi a la derecha: la celda (0,0) está sobre su fila (y=0),
  // así que el término de choque debe empujar a Mindy fuera de la fila.
  const zx = Int32Array.from([6]);
  const zy = Int32Array.from([0]);
  const idx = chooseAPW(zx, zy, 0, 0, 0.2, 42);
  assert.notEqual(idx, 0, 'no debería quedarse quieta');
  const nx = [0, 1, -1, 0, 0][idx];
  const ny = [0, 0, 0, 1, -1][idx];
  assert.ok(!(ny === 0), `eligió (${nx},${ny}): seguiría en la fila de choque`);
});

test('Greedy se aleja del zombi más cercano', () => {
  const zx = Int32Array.from([5]);
  const zy = Int32Array.from([0]);
  const idx = chooseGreedy(zx, zy, 0, 0, 42);
  assert.equal(idx, 2, 'debería moverse a (-1, 0)');
  assert.ok(l1(-1, 0, 5, 0) > l1(0, 0, 5, 0));
});

test('runEpisode es determinista y devuelve trazas coherentes', () => {
  const cfg = { seed: 123, lambda: 0.02, controller: 1, maxSteps: 60 };
  const a = runEpisode({ ...cfg, record: true });
  const b = runEpisode({ ...cfg, record: true });
  assert.equal(a.tau, b.tau);
  assert.equal(a.caught, b.caught);
  assert.equal(a.trace.length, b.trace.length);
  assert.equal(a.minDSeries.length, a.trace.length - 1);
  assert.equal(a.cloud.zx.length, a.zombies);
  assert.ok(a.minDSeries.every((d) => d >= 0));
});

test('a menor densidad, mayor tiempo de supervivencia medio', () => {
  const mean = (lambda) => {
    let sum = 0;
    const n = 5;
    for (let i = 0; i < n; i++) {
      sum += runEpisode({ seed: 1000 + i, lambda, controller: 1, maxSteps: 400, record: false }).tau;
    }
    return sum / n;
  };
  const dense = mean(0.08);
  const sparse = mean(0.005);
  assert.ok(sparse > dense, `τ(0.005)=${sparse} debería superar a τ(0.08)=${dense}`);
});

test('runBatch produce el número pedido de episodios por densidad', async () => {
  const samples = await runBatch({
    lambdas: [0.02, 0.05],
    episodes: 2,
    seed: 3,
    controller: 2,
    maxSteps: 40,
    sleep: () => Promise.resolve()
  });
  assert.equal(samples.length, 4);
  for (const s of samples) {
    assert.ok(s.lambda > 0);
    assert.ok(s.tau >= 1);
    assert.equal(typeof s.caught, 'boolean');
  }
});

test('los ?ndices del bot siempre est?n en 0..4 y la elecci?n es el argmin', () => {
  // Regresi?n: con rngState >= 2^31 el m?dulo con signo de ZScript daba ?ndices
  // negativos y el bot se quedaba clavado. Aqu? se barren estados altos.
  const states = [0, 1, 5, 2 ** 31, 3394686277, 4222266314, 4294967295, 123456789];
  const zx = Int32Array.from([4, -3, 7, 0, -8, 2, 9]);
  const zy = Int32Array.from([1, 5, -2, 6, 3, -7, 0]);

  for (const rngState of states) {
    const apw = chooseAPW(zx, zy, 0, 0, 0.03, rngState);
    const greedy = chooseGreedy(zx, zy, 0, 0, rngState);
    assert.ok(apw >= 0 && apw <= 4, `APW devolvi? ${apw} con rngState=${rngState}`);
    assert.ok(greedy >= 0 && greedy <= 4, `Greedy devolvi? ${greedy} con rngState=${rngState}`);

    // La elecci?n debe ser un m?nimo de J (con la tolerancia del desempate).
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      best = Math.min(best, costAt(zx, zy, botDx(i), botDy(i), 0.03));
    }
    const chosen = costAt(zx, zy, botDx(apw), botDy(apw), 0.03);
    assert.ok(chosen <= best + 1e-6, `APW eligi? ${chosen} con m?nimo ${best} (rngState=${rngState})`);
  }
});

test('la rotaci?n de desempate cubre 0..4 sin ?ndices inv?lidos', () => {
  const rotations = new Set();
  for (let rngState = 0; rngState < 200000; rngState += 997) {
    const rot = ((rngState >>> 8) % 5);
    assert.ok(rot >= 0 && rot <= 4, 'rot fuera de rango: ' + rot);
    rotations.add(rot);
  }
  assert.equal(rotations.size, 5, 'la rotaci?n debe alcanzar los cinco valores');
});
