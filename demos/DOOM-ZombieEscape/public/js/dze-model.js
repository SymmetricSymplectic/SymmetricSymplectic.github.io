/**
 * dze-model.js — gemelo en JavaScript del modelo que corre dentro de GZDoom.
 *
 * Es la MISMA dinámica que `pk3_src/zscript/dze_controller.zc` y
 * `pk3_src/zscript/dze_mindy_bot.zc`:
 *
 *   - mismo LCG (Numerical Recipes, módulo 2^32) y mismo orden de sorteo,
 *   - misma transición geodésica l1 de los zombis (moneda con el bit 16),
 *   - mismo funcional J(p) y mismas reglas de desempate,
 *   - mismos recortes numéricos del núcleo gaussiano y del término de choque.
 *
 * Sirve para dos cosas:
 *   1. el "modo analítico" del laboratorio, que puede correr miles de
 *      episodios sin arrancar el motor, y
 *   2. los tests de `node --test`, que fijan la reproducibilidad del modelo.
 *
 * Nada de DOM ni de red: módulo puro.
 */

export const DZE_CONST = Object.freeze({
  RADIUS: 120, // celdas: -120..120
  CELL_UNITS: 64, // map units por celda
  CELL_TICS: 7, // tics por paso (5 pasos/s)
  MAX_STEPS: 3000, // horizonte del episodio
  MAX_ZOMBIES: 30000,
  TRAIL_LEN: 64,

  W_IMM: 1.0,
  W_SHOCK: 0.75,
  W_VALLEY: 1.5,
  GAMMA: 0.35,
  BETA: 1.0,
  IMM_RADIUS: 6,
  SHOCK_RADIUS: 64,
  VALLEY_CUT: 12.0,

  LAMBDA_MIN: 0.002,
  LAMBDA_MAX: 0.35,
  SEED_MIX: 2654435761
});

export const PI = Math.PI;

/* ------------------------------------------------------------------------- */
/* LCG                                                                       */
/* ------------------------------------------------------------------------- */

/** Estado inicial del LCG a partir de la semilla de usuario. */
export function createRng(seed) {
  return { state: (Math.imul(seed | 0, DZE_CONST.SEED_MIX) + 1013904223) >>> 0 };
}

export function rngNext(rng) {
  rng.state = (Math.imul(rng.state, 1664525) + 1013904223) >>> 0;
  return rng.state;
}

/** Uniforme en [0,1) con los 24 bits altos del estado (igual que ZScript). */
export function rngUnit(rng) {
  rngNext(rng);
  return (rng.state >>> 8) / 16777216;
}

/** Moneda 1/2 con el bit 16 (igual que ZScript). */
export function rngCoin(rng) {
  rngNext(rng);
  return ((rng.state >>> 16) & 1) === 1;
}

/* ------------------------------------------------------------------------- */
/* Aproximaciones numéricas (idénticas a DZEMath de dze_constants.zc)        */
/* ------------------------------------------------------------------------- */

/** exp(x) para x <= 0: bisección + Taylor de grado 12 + k cuadrados. */
export function expNeg(x) {
  if (x > 0) x = 0;
  if (x < -700) return 0;
  let t = x;
  let k = 0;
  while (t < -1) {
    t *= 0.5;
    k++;
  }
  let r =
    1 +
    t *
      (1 +
        t *
          (0.5 +
            t *
              (0.16666666666666666 +
                t *
                  (0.041666666666666664 +
                    t *
                      (0.008333333333333333 +
                        t *
                          (0.001388888888888889 +
                            t *
                              (0.0001984126984126984 +
                                t *
                                  (0.0000248015873015873 +
                                    t *
                                      (0.0000027557319223985893 +
                                        t *
                                          (0.00000027557319223985893 +
                                            t * 0.00000002505210838544171))))))))));
  for (let i = 0; i < k; i++) r *= r;
  return r;
}

/** ln(x) para x > 0 (reducción x = m 2^k, serie de atanh). */
export function ln(x) {
  if (x <= 0) return -700;
  let k = 0;
  while (x >= 2) {
    x *= 0.5;
    k++;
  }
  while (x < 1) {
    x *= 2;
    k--;
  }
  const z = (x - 1) / (x + 1);
  const z2 = z * z;
  let s = 0;
  for (let i = 21; i >= 1; i -= 2) s = s * z2 + 1 / i;
  return 2 * z * s + k * 0.69314718055994530942;
}

/** d^(-beta). */
export function invPow(d, beta = DZE_CONST.BETA) {
  if (d <= 0) return 1;
  if (beta === 1) return 1 / d;
  return expNeg(-beta * ln(d));
}

/** Distancia l1. */
export function l1(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/* ------------------------------------------------------------------------- */
/* Nube de Bernoulli(lambda)                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Sortea la nube inicial recorriendo x = -R..R y, para cada x, y = -R..R,
 * saltando el origen. Consume el LCG en ese orden exacto.
 * @returns {{zx: Int32Array, zy: Int32Array, count: number, rng: object}}
 */
export function buildCloud(seed, lambda, opts = {}) {
  const radius = opts.radius ?? DZE_CONST.RADIUS;
  const maxZombies = opts.maxZombies ?? DZE_CONST.MAX_ZOMBIES;
  const rng = opts.rng || createRng(seed);
  // El CVAR `float` del motor guarda lambda en 32 bits: se replica para que la
  // nube y los costes coincidan bit a bit con ZScript.
  const lam = Math.fround(lambda);

  const xs = [];
  const ys = [];
  outer: for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      if (i === 0 && j === 0) continue;
      rngNext(rng);
      const u = (rng.state >>> 8) / 16777216;
      if (u < lam) {
        xs.push(i);
        ys.push(j);
        if (xs.length >= maxZombies) break outer;
      }
    }
  }
  return { zx: Int32Array.from(xs), zy: Int32Array.from(ys), count: xs.length, rng };
}

/* ------------------------------------------------------------------------- */
/* Política de Mindy                                                          */
/* ------------------------------------------------------------------------- */

const DX = Object.freeze([0, 1, -1, 0, 0]);
const DY = Object.freeze([0, 0, 0, 1, -1]);

export function botDx(idx) {
  return DX[idx];
}
export function botDy(idx) {
  return DY[idx];
}

/**
 * J(p) del candidato (px, py). Devuelve 1e30 si la celda está ocupada
 * (movimiento prohibido), igual que la implementación ZScript.
 */
export function costAt(zx, zy, px, py, lambda) {
  const n = zx.length;
  const kValley = PI * Math.fround(lambda);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(zx[i] - px) + Math.abs(zy[i] - py);
    if (d === 0) return 1e30;
    if (d <= DZE_CONST.IMM_RADIUS) j += DZE_CONST.W_IMM * expNeg(-DZE_CONST.GAMMA * (d - 1));
    if (d <= DZE_CONST.SHOCK_RADIUS && (zx[i] === px || zy[i] === py)) {
      j += DZE_CONST.W_SHOCK * invPow(d, DZE_CONST.BETA);
    }
    const e = d * d * kValley;
    if (e <= DZE_CONST.VALLEY_CUT) j += DZE_CONST.W_VALLEY * expNeg(-e);
  }
  return j;
}

export function chooseAPW(zx, zy, cx, cy, lambda, rngState) {
  // Misma rotaci?n que el ZScript: bits altos y m?dulo sin signo.
  const rot = ((rngState >>> 8) % 5);
  let best = 0;
  let bestCost = 0;
  let have = false;
  for (let k = 0; k < 5; k++) {
    const idx = (k + rot) % 5;
    const c = costAt(zx, zy, cx + DX[idx], cy + DY[idx], lambda);
    if (!have || c < bestCost - 1e-9) {
      bestCost = c;
      best = idx;
      have = true;
    }
  }
  return best;
}

export function chooseGreedy(zx, zy, cx, cy, rngState) {
  const n = zx.length;
  // Misma rotaci?n que el ZScript: bits altos y m?dulo sin signo.
  const rot = ((rngState >>> 8) % 5);
  let best = 0;
  let bestMin = -1;
  let bestSum = -1;
  let have = false;
  for (let k = 0; k < 5; k++) {
    const idx = (k + rot) % 5;
    const px = cx + DX[idx];
    const py = cy + DY[idx];
    let mn = 1 << 20;
    let sumNear = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(zx[i] - px) + Math.abs(zy[i] - py);
      if (d < mn) mn = d;
      if (d <= DZE_CONST.SHOCK_RADIUS) sumNear += d;
    }
    if (!have || mn > bestMin || (mn === bestMin && sumNear > bestSum)) {
      bestMin = mn;
      bestSum = sumNear;
      best = idx;
      have = true;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------- */
/* Transición geodésica l1                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Mueve todos los zombis un paso hacia (mx, my) y mide el estado resultante.
 * @returns {{minD:number, shock:number, caught:number}}
 */
export function stepZombies(zx, zy, mx, my, rng) {
  const n = zx.length;
  let best = 1 << 24;
  let shock = 0;
  let caught = 0;

  for (let i = 0; i < n; i++) {
    let dx = mx - zx[i];
    let dy = my - zy[i];
    if (dx === 0 && dy === 0) {
      caught++;
      shock++;
      best = 0;
      continue;
    }
    if (dx !== 0 && dy !== 0) {
      if (rngCoin(rng)) zx[i] += dx > 0 ? 1 : -1;
      else zy[i] += dy > 0 ? 1 : -1;
    } else if (dx !== 0) {
      zx[i] += dx > 0 ? 1 : -1;
    } else {
      zy[i] += dy > 0 ? 1 : -1;
    }

    dx = mx - zx[i];
    dy = my - zy[i];
    const d = Math.abs(dx) + Math.abs(dy);
    if (d < best) best = d;
    if (dx === 0 || dy === 0) shock++;
    if (d === 0) caught++;
  }
  return { minD: best, shock, caught };
}

/* ------------------------------------------------------------------------- */
/* Episodio completo                                                          */
/* ------------------------------------------------------------------------- */

export function clampCell(c, radius = DZE_CONST.RADIUS) {
  const lim = radius + 6;
  if (c > lim) return lim;
  if (c < -lim) return -lim;
  return c;
}

/**
 * Corre un episodio completo.
 *
 * `controller`: 0 humano (se aproxima con APW en el modo analítico),
 *               1 APW, 2 Greedy L1, 3 humano + fantasma APW (usa APW).
 *
 * @returns {{tau:number, caught:boolean, steps:number, zombies:number,
 *            trace:number[][], minDSeries:number[], shockSeries:number[],
 *            cloud?:{zx:Int32Array, zy:Int32Array}}}
 */
export function runEpisode(cfg) {
  const seed = cfg.seed ?? 42;
  const lambda = cfg.lambda ?? 0.03;
  const maxSteps = cfg.maxSteps ?? DZE_CONST.MAX_STEPS;
  const radius = cfg.radius ?? DZE_CONST.RADIUS;
  const record = cfg.record !== false;
  const controller = cfg.controller ?? 1;
  const policy = controller === 2 ? 2 : 1;

  const cloud = buildCloud(seed, lambda, { radius });
  const rng = cloud.rng;

  let mx = 0;
  let my = 0;
  let ghostX = 0;
  let ghostY = 0;

  const trace = record ? [[mx, my]] : null;
  const minDSeries = record ? [] : null;
  const shockSeries = record ? [] : null;

  for (let t = 1; t <= maxSteps; t++) {
    const idx = policy === 2
      ? chooseGreedy(cloud.zx, cloud.zy, mx, my, rng.state)
      : chooseAPW(cloud.zx, cloud.zy, mx, my, lambda, rng.state);
    mx = clampCell(mx + DX[idx], radius);
    my = clampCell(my + DY[idx], radius);

    if (controller === 3) {
      const g = chooseAPW(cloud.zx, cloud.zy, ghostX, ghostY, lambda, rng.state);
      ghostX = clampCell(ghostX + DX[g], radius);
      ghostY = clampCell(ghostY + DY[g], radius);
    }

    const m = stepZombies(cloud.zx, cloud.zy, mx, my, rng);

    if (record) {
      trace.push([mx, my]);
      minDSeries.push(m.minD);
      shockSeries.push(m.shock);
    }

    if (m.caught > 0) {
      return {
        tau: t,
        caught: true,
        steps: t,
        zombies: cloud.count,
        trace,
        minDSeries,
        shockSeries,
        cloud: record ? { zx: cloud.zx, zy: cloud.zy } : undefined
      };
    }
  }

  return {
    tau: maxSteps,
    caught: false,
    steps: maxSteps,
    zombies: cloud.count,
    trace,
    minDSeries,
    shockSeries,
    cloud: record ? { zx: cloud.zx, zy: cloud.zy } : undefined
  };
}

/**
 * Lote Monte Carlo para el laboratorio analítico: n episodios con semillas
 * consecutivas para cada lambda de la lista.
 *
 * @param {{lambdas:number[], episodes:number, seed:number, controller:number,
 *          maxSteps?:number, radius?:number, onProgress?:Function}} cfg
 * @returns {Promise<Array<{lambda:number, tau:number, caught:boolean}>>}
 */
export async function runBatch(cfg) {
  const lambdas = cfg.lambdas || [0.01, 0.02, 0.04, 0.08, 0.16];
  const episodes = cfg.episodes || 8;
  const baseSeed = cfg.seed ?? 42;
  const controller = cfg.controller ?? 1;
  const maxSteps = cfg.maxSteps ?? 900;
  const radius = cfg.radius ?? DZE_CONST.RADIUS;
  const onProgress = cfg.onProgress;
  const sleep = cfg.sleep || (() => new Promise((r) => setTimeout(r, 0)));

  const out = [];
  let done = 0;
  const total = lambdas.length * episodes;
  let sinceYield = 0;

  for (const lambda of lambdas) {
    for (let e = 0; e < episodes; e++) {
      const seed = baseSeed + e * 7919;
      const ep = runEpisode({
        seed,
        lambda,
        controller,
        maxSteps,
        radius,
        record: false
      });
      out.push({ lambda, tau: ep.tau, caught: ep.caught, seed });
      done++;
      sinceYield++;
      // Ceder el hilo para que la UI siga viva (y poder cancelar).
      if (sinceYield >= 2) {
        sinceYield = 0;
        if (onProgress) onProgress(done, total, out);
        await sleep();
      }
    }
  }
  if (onProgress) onProgress(done, total, out);
  return out;
}
