/**
 * plots.js — gráficas del laboratorio (canvas 2D, sin dependencias).
 *
 * Tres vistas:
 *   1. radar: trayectoria de Mindy sobre Z^2, nube de zombis del episodio de
 *      ejemplo, líneas de choque y estela del marine.
 *   2. series: min d1(t) y masa de choque a lo largo del episodio en vivo.
 *   3. regresión: log τ frente a log(1/λ) con la recta de MCO y α̂₁.
 *
 * Todos los colores se leen de los tokens CSS (--c1…--c4, --text, --muted,
 * --line, --accent), nunca literales, y se recalculan en cada draw() para que
 * el tema claro/oscuro se refleje sin recargar.
 */

import { fitLogLog, summarizeByLambda } from './telemetry-bridge.js';
import { DZE_CONST } from './dze-model.js';

const tok = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const FONT = '11px ui-monospace, Consolas, monospace';

function hidpi(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function axisFrame(ctx, w, h, pad, colors) {
  ctx.strokeStyle = colors.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

/**
 * @param {{radar: HTMLCanvasElement, series: HTMLCanvasElement,
 *          regression: HTMLCanvasElement, alphaText: HTMLElement}} refs
 */
export function createPlots(refs) {
  const state = {
    boot: null,
    result: null,
    steps: [],
    example: null,
    batch: []
  };
  const MAX_LIVE = 900;
  let frame = 0;

  function colors() {
    return {
      text: tok('--text'),
      muted: tok('--muted'),
      line: tok('--line'),
      surface: tok('--surface'),
      accent: tok('--accent'),
      series: [tok('--c1'), tok('--c2'), tok('--c3'), tok('--c4')],
      ok: tok('--ok'),
      bad: tok('--bad')
    };
  }

  /* ------------------------------------------------------------------ */
  /* 1. Radar                                                            */
  /* ------------------------------------------------------------------ */
  function drawRadar(c) {
    const canvas = refs.radar;
    if (!canvas) return;
    const { ctx, w, h } = hidpi(canvas);
    const pad = { l: 34, r: 14, t: 14, b: 26 };
    const R = DZE_CONST.RADIUS;
    const side = Math.min(w - pad.l - pad.r, h - pad.t - pad.b);
    if (side < 40) return;
    const ox = pad.l + (w - pad.l - pad.r - side) / 2;
    const oy = pad.t;

    const px = (cx) => ox + ((cx + R) / (2 * R + 1)) * side;
    const py = (cy) => oy + side - ((cy + R) / (2 * R + 1)) * side;

    axisFrame(ctx, w, h, pad, c);

    // Rejilla de referencia.
    ctx.strokeStyle = c.line;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let g = -R; g <= R; g += 20) {
      ctx.moveTo(px(g), oy);
      ctx.lineTo(px(g), oy + side);
      ctx.moveTo(ox, py(g));
      ctx.lineTo(ox + side, py(g));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ejes x = 0, y = 0.
    ctx.strokeStyle = c.muted;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(px(0), oy);
    ctx.lineTo(px(0), oy + side);
    ctx.moveTo(ox, py(0));
    ctx.lineTo(ox + side, py(0));
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Nube de zombis (episodio de ejemplo).
    if (state.example && state.example.cloud) {
      const { zx, zy } = state.example.cloud;
      ctx.fillStyle = c.series[1];
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < zx.length; i++) {
        ctx.fillRect(px(zx[i]), py(zy[i]), 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    }

    const last = state.steps.length ? state.steps[state.steps.length - 1] : null;

    // Líneas de choque de Mindy (fila y columna).
    if (last) {
      ctx.strokeStyle = c.series[1];
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ox, py(last.my));
      ctx.lineTo(ox + side, py(last.my));
      ctx.moveTo(px(last.mx), oy);
      ctx.lineTo(px(last.mx), oy + side);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Estela del ejemplo (punteada) y del episodio en vivo.
    if (state.example && state.example.trace) {
      ctx.strokeStyle = c.series[3];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      state.example.trace.forEach(([x, y], i) => {
        const X = px(x);
        const Y = py(y);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (state.steps.length > 1) {
      ctx.strokeStyle = c.series[0];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      state.steps.forEach((s, i) => {
        const X = px(s.mx);
        const Y = py(s.my);
        if (i === 0) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      ctx.stroke();
    }

    // Mindy.
    if (last) {
      ctx.fillStyle = c.ok;
      ctx.beginPath();
      ctx.arc(px(last.mx), py(last.my), 3.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Etiquetas.
    ctx.fillStyle = c.muted;
    ctx.font = FONT;
    ctx.fillText('x', ox + side - 8, oy + side + 16);
    ctx.fillText('y', ox - 18, oy + 10);
    ctx.fillText('−120', ox - 6, oy + side + 16);
    ctx.fillText('120', ox + side - 18, oy + side + 16);
    ctx.fillStyle = c.text;
    ctx.fillText('Mindy en Z²', ox + 4, oy + 12);
  }

  /* ------------------------------------------------------------------ */
  /* 2. Series temporales                                                */
  /* ------------------------------------------------------------------ */
  function drawSeries(c) {
    const canvas = refs.series;
    if (!canvas) return;
    const { ctx, w, h } = hidpi(canvas);
    const pad = { l: 36, r: 38, t: 14, b: 24 };
    axisFrame(ctx, w, h, pad, c);

    const steps = state.steps.slice(-400);
    if (steps.length < 2) {
      ctx.fillStyle = c.muted;
      ctx.font = FONT;
      ctx.fillText('Sin telemetría todavía.', pad.l + 8, pad.t + 18);
      return;
    }

    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const n = steps.length;

    const maxD = Math.max(6, ...steps.map((s) => s.min_d1));
    const maxShock = Math.max(2, ...steps.map((s) => s.shock));

    const X = (i) => pad.l + (i / (n - 1)) * innerW;
    const Yd = (v) => pad.t + innerH - (v / maxD) * innerH;
    const Ys = (v) => pad.t + innerH - (v / maxShock) * innerH;

    // Umbral de peligro (d1 = 1).
    ctx.strokeStyle = c.bad;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, Yd(1));
    ctx.lineTo(pad.l + innerW, Yd(1));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // min d1.
    ctx.strokeStyle = c.series[0];
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    steps.forEach((s, i) => {
      const y = Yd(s.min_d1);
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.stroke();

    // Masa de choque.
    ctx.strokeStyle = c.series[1];
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    steps.forEach((s, i) => {
      const y = Ys(s.shock);
      if (i === 0) ctx.moveTo(X(i), y);
      else ctx.lineTo(X(i), y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = c.muted;
    ctx.font = FONT;
    ctx.fillText(String(maxD), 6, pad.t + 8);
    ctx.fillText('0', 20, pad.t + innerH);
    ctx.fillText(String(maxShock), w - pad.r + 4, pad.t + 8);
    ctx.fillText('t=' + steps[n - 1].t, pad.l + innerW - 52, h - 6);

    // Leyenda.
    ctx.fillStyle = c.series[0];
    ctx.fillRect(pad.l + 4, h - 12, 10, 2);
    ctx.fillStyle = c.text;
    ctx.fillText('min d₁', pad.l + 18, h - 8);
    ctx.fillStyle = c.series[1];
    ctx.fillRect(pad.l + 70, h - 12, 10, 2);
    ctx.fillStyle = c.text;
    ctx.fillText('masa de choque', pad.l + 84, h - 8);
  }

  /* ------------------------------------------------------------------ */
  /* 3. Regresión log-log                                                */
  /* ------------------------------------------------------------------ */
  function drawRegression(c) {
    const canvas = refs.regression;
    if (!canvas) return;
    const { ctx, w, h } = hidpi(canvas);
    const pad = { l: 40, r: 16, t: 16, b: 30 };
    axisFrame(ctx, w, h, pad, c);

    const samples = state.batch;
    if (!samples.length) {
      ctx.fillStyle = c.muted;
      ctx.font = FONT;
      ctx.fillText('Ejecuta el lote Monte Carlo para ajustar α̂₁.', pad.l + 6, pad.t + 18);
      return;
    }

    const fit = fitLogLog(samples);
    const pts = fit.points;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const dx = xMax - xMin || 1;
    const dy = yMax - yMin || 1;
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const X = (x) => pad.l + ((x - xMin) / dx) * innerW;
    const Y = (y) => pad.t + innerH - ((y - yMin) / dy) * innerH;

    // Recta de MCO.
    if (Number.isFinite(fit.slope)) {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(X(xMin), Y(fit.intercept + fit.slope * xMin));
      ctx.lineTo(X(xMax), Y(fit.intercept + fit.slope * xMax));
      ctx.stroke();
    }

    // Puntos.
    ctx.fillStyle = c.series[3];
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Medias por λ (más grandes).
    const summary = summarizeByLambda(samples);
    ctx.strokeStyle = c.series[2];
    ctx.fillStyle = c.series[2];
    for (const g of summary) {
      const x = Math.log(1 / g.lambda);
      const y = Math.log(g.mean > 0 ? g.mean : 1e-9);
      ctx.beginPath();
      ctx.arc(X(x), Y(y), 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = c.muted;
    ctx.font = FONT;
    ctx.fillText('log(1/λ)', w - pad.r - 52, h - 8);
    ctx.fillText('log τ', 4, pad.t + 10);
    ctx.fillStyle = c.text;
    ctx.fillText(
      'α̂₁ = ' + (Number.isFinite(fit.slope) ? fit.slope.toFixed(3) : '—') +
        '   R² = ' + (Number.isFinite(fit.r2) ? fit.r2.toFixed(3) : '—'),
      pad.l + 4,
      pad.t + 12
    );

    if (refs.alphaText) {
      refs.alphaText.textContent = Number.isFinite(fit.slope)
        ? 'α̂₁ = ' + fit.slope.toFixed(3) + ' (n = ' + fit.n + ', R² = ' + fit.r2.toFixed(3) + ')'
        : 'α̂₁ = — (hacen falta al menos dos densidades con τ > 0)';
    }
  }

  function redraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const c = colors();
      drawRadar(c);
      drawSeries(c);
      drawRegression(c);
    });
  }

  /* ------------------------------------------------------------------ */
  /* API pública                                                         */
  /* ------------------------------------------------------------------ */
  function pushStep(step) {
    state.steps.push(step);
    if (state.steps.length > MAX_LIVE) state.steps.splice(0, state.steps.length - MAX_LIVE);
    redraw();
  }

  function setBoot(boot) {
    state.boot = boot;
    redraw();
  }

  function setResult(result) {
    state.result = result;
    redraw();
  }

  function setExample(ep) {
    state.example = ep;
    redraw();
  }

  function setBatch(samples) {
    state.batch = samples || [];
    redraw();
  }

  function resetLive() {
    state.steps = [];
    state.boot = null;
    state.result = null;
    redraw();
  }

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => redraw());
    for (const canvas of [refs.radar, refs.series, refs.regression]) {
      if (canvas) ro.observe(canvas);
    }
  } else {
    window.addEventListener('resize', redraw);
  }

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', redraw);

  redraw();

  return {
    pushStep,
    setBoot,
    setResult,
    setExample,
    setBatch,
    resetLive,
    redraw,
    state
  };
}
