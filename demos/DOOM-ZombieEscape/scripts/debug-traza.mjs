#!/usr/bin/env node
/**
 * debug-traza.mjs — compara paso a paso la traza del motor con el gemelo JS.
 *
 * Reproduce la secuencia de jugadas del motor sobre el modelo JS (misma nube,
 * mismo LCG) y, en el primer paso donde el argmin de J difiere de lo que hizo
 * el bot dentro de GZDoom, imprime los cinco costes. Sirve para distinguir un
 * error de implementación de un empate roto por redondeo.
 */

import { readFileSync } from 'node:fs';
import process from 'node:process';

import { buildCloud, costAt, createRng, stepZombies, botDx, botDy } from '../public/js/dze-model.js';

const file = process.argv[2];
const events = JSON.parse(readFileSync(file, 'utf8'))
  .map((e) => /\[(DZE_[A-Z_]+)\]\s*(\{.*\})/.exec(e.line || ''))
  .filter(Boolean)
  .map((m) => ({ tag: m[1], payload: JSON.parse(m[2]) }));

const boot = events.find((e) => e.tag === 'DZE_BOOT').payload;
const steps = events.filter((e) => e.tag === 'DZE_STEP').map((e) => e.payload);

const cloud = buildCloud(boot.seed, boot.lambda);

function hash(zx, zy) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < zx.length; i++) {
    h = Math.imul((h ^ ((zx[i] + 1000) >>> 0)) >>> 0, 16777619) >>> 0;
    h = Math.imul((h ^ ((zy[i] + 1000) >>> 0)) >>> 0, 16777619) >>> 0;
  }
  return h | 0;
}

console.log('nube: motor=%d js=%d  hash motor=%d js=%d', boot.zombies, cloud.count, boot.hash, hash(cloud.zx, cloud.zy));

let mx = 0;
let my = 0;
for (const s of steps) {
  const costs = [0, 1, 2, 3, 4].map((i) => costAt(cloud.zx, cloud.zy, mx + botDx(i), my + botDy(i), boot.lambda));
  let best = 0;
  for (let i = 1; i < 5; i++) if (costs[i] < costs[best] - 1e-9) best = i;

  const engineIdx = [0, 1, 2, 3, 4].find((i) => mx + botDx(i) === s.mx && my + botDy(i) === s.my);
  const fmt = costs.map((c, i) => `${i}:${c.toFixed(6)}`).join('  ');
  if (engineIdx !== best) {
    console.log(`t=${s.t} DIVERGE  estado=(${mx},${my})  motor->${engineIdx} (${s.mx},${s.my})  js->${best}`);
    console.log('   ' + fmt);
    console.log('   Δ =', (costs[engineIdx] - costs[best]).toExponential(3));
    process.exit(0);
  }
  if (engineIdx === undefined) {
    console.log(`t=${s.t} movimiento del motor no es de N[M]: (${s.mx},${s.my}) desde (${mx},${my})`);
    process.exit(0);
  }

  mx = s.mx;
  my = s.my;
  const m = stepZombies(cloud.zx, cloud.zy, mx, my, cloud.rng);
  const h = hash(cloud.zx, cloud.zy);
  if (m.minD !== s.min_d1 || m.shock !== s.shock || (s.h !== undefined && h !== s.h)) {
    console.log(
      `t=${s.t} ESTADO DIVERGE: js minD=${m.minD} shock=${m.shock} hash=${h}  motor minD=${s.min_d1} shock=${s.shock} hash=${s.h}`
    );
    process.exit(0);
  }
}
console.log('sin divergencias en %d pasos', steps.length);
