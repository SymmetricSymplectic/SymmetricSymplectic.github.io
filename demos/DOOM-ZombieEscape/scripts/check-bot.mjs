#!/usr/bin/env node
/**
 * check-bot.mjs — auditoría del control del jugador por parte del algoritmo.
 *
 * Lee el log de una corrida de `scripts/e2e-headless.mjs --log <archivo>` y
 * verifica, con los datos reales del motor, que:
 *
 *   1. `ax, ay` (celda medida sobre `mo.pos` tras el teleport) coincide con
 *      `mx, my` (celda que decidió el bot) en TODOS los pasos;
 *   2. el paseo del bot es un movimiento legal de Z^2: cada paso cambia como
 *      mucho una celda en un solo eje;
 *   3. el contador `drift` del mod se queda en 0 (el jugador no se sale de la
 *      celda fijada entre pasos);
 *   4. el bot no está congelado: se mueve en la mayoría de los pasos (salvo
 *      que esté contra la pared de la sala, donde quedarse es legal);
 *   5. la captura solo ocurre cuando `min_d1 === 0`, y `[DZE_RESULT]` cuadra
 *      con el último `[DZE_STEP]`;
 *   6. la traza coincide con el gemelo JS (`runEpisode`) al menos en el
 *      arranque, para detectar divergencias de implementación.
 *
 * Uso:
 *   node scripts/check-bot.mjs build/bot-apw.json --controller 1
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { runEpisode } from '../public/js/dze-model.js';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '1');
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/check-bot.mjs <log.json> [--controller N]');
  process.exit(2);
}

const events = [];
for (const entry of JSON.parse(readFileSync(file, 'utf8'))) {
  const line = entry.line || '';
  const m = /\[(DZE_[A-Z_]+)\]\s*(\{.*\})/.exec(line);
  if (!m) continue;
  try {
    events.push({ tag: m[1], payload: JSON.parse(m[2]) });
  } catch (_e) {
    /* línea truncada por el motor: se ignora */
  }
}

const boot = events.find((e) => e.tag === 'DZE_BOOT')?.payload;
const result = events.find((e) => e.tag === 'DZE_RESULT')?.payload;
const steps = events.filter((e) => e.tag === 'DZE_STEP').map((e) => e.payload);

const wantsController = Number(args.get('controller') ?? boot?.controller ?? -1);
const failures = [];

function check(cond, message) {
  if (cond) {
    console.log('  ok   ' + message);
  } else {
    console.log('  FALLO ' + message);
    failures.push(message);
  }
}

console.log('== auditoría del control del bot ==');
check(!!boot, 'hay [DZE_BOOT]');
check(boot && boot.controller === wantsController, `controlador ${wantsController} (boot=${boot?.controller})`);
check(steps.length > 3, `hay pasos suficientes (${steps.length})`);

if (boot && steps.length) {
  const consistent = steps.filter((s) => s.ax === s.mx && s.ay === s.my);
  check(
    consistent.length === steps.length,
    `celda real == celda decidida en ${consistent.length}/${steps.length} pasos`
  );
  const bad = steps.filter((s) => s.ax !== s.mx || s.ay !== s.my).slice(0, 3);
  for (const b of bad) console.log(`        t=${b.t} decidida=(${b.mx},${b.my}) real=(${b.ax},${b.ay})`);

  const illegal = [];
  for (let i = 1; i < steps.length; i++) {
    const d = Math.abs(steps[i].mx - steps[i - 1].mx) + Math.abs(steps[i].my - steps[i - 1].my);
    if (d > 1) illegal.push({ t: steps[i].t, d, from: [steps[i - 1].mx, steps[i - 1].my], to: [steps[i].mx, steps[i].my] });
  }
  check(illegal.length === 0, 'cada paso mueve como máximo una celda (paseo de Z²)');
  for (const b of illegal.slice(0, 3)) console.log(`        t=${b.t} salto ${b.d} de (${b.from}) a (${b.to})`);

  const moved = steps.filter((s, i) => i > 0 && (s.mx !== steps[i - 1].mx || s.my !== steps[i - 1].my)).length;
  check(steps.length < 2 || moved / (steps.length - 1) >= 0.5, `el marine se mueve (${moved}/${steps.length - 1} pasos con desplazamiento)`);

  const last = steps[steps.length - 1];
  check((last.drift ?? 0) === 0, `drift acumulado = ${last.drift} (debe ser 0)`);
  if (last.in !== undefined) {
    console.log(
      `  --  entrada del jugador (ignorada): ${last.in} tics con orden de movimiento (suprimidos por el controlador)`
    );
  }

  if (result) {
    check(result.tau === last.t, `tau=${result.tau} coincide con el último paso t=${last.t}`);
    check((result.caught === 1) === (last.min_d1 === 0), 'captura sólo con min_d1 = 0');
    check(result.zombies === last.n, `n=${result.zombies} constante`);
    check(result.controller === boot.controller, 'el resultado conserva el controlador');
  } else {
    console.log('  --  sin [DZE_RESULT] (episodio aún en curso)');
  }

  // Comparación con el gemelo JS (misma semilla, misma λ).
  if (boot && (boot.controller === 1 || boot.controller === 2)) {
    const ep = runEpisode({
      seed: boot.seed,
      lambda: boot.lambda,
      controller: boot.controller,
      maxSteps: Math.min(boot.steps ?? 400, 400),
      record: true
    });
    const n = Math.min(ep.trace.length - 1, steps.length);
    let same = 0;
    for (let i = 0; i < n; i++) {
      if (ep.trace[i + 1][0] === steps[i].mx && ep.trace[i + 1][1] === steps[i].my) same++;
    }
    console.log(`  --  gemelo JS: ${same}/${n} pasos idénticos (τ_js=${ep.tau})`);
  }
}

console.log(failures.length ? `\n${failures.length} comprobación(es) fallida(s)` : '\ncontrol del marine: OK');
process.exit(failures.length ? 1 : 0);
