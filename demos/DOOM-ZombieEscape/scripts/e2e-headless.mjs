#!/usr/bin/env node
/**
 * e2e-headless.mjs — prueba de humo de extremo a extremo con Chrome headless.
 *
 * Arranca Chrome con el protocolo DevTools, navega al laboratorio, recoge
 * consola/excepciones durante N segundos y guarda una captura de pantalla.
 * Sirve para verificar, sin interacción humana:
 *
 *   - que la página carga sin errores de JavaScript,
 *   - que `crossOriginIsolated` es true (SharedArrayBuffer),
 *   - que el motor arranca y el ZScript del mod compila,
 *   - que llega telemetría `[DZE_BOOT]` / `[DZE_STEP]` / `[DZE_RESULT]`.
 *
 * Uso:
 *   node scripts/e2e-headless.mjs --url "http://127.0.0.1:8123/demos/DOOM-ZombieEscape/public/?auto=1" \
 *        --seconds 90 --screenshot build/e2e.png
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '');
  const v = process.argv[i + 1] ?? '1';
  args.set(k, v);
}

const url = args.get('url');
const seconds = Number(args.get('seconds') || 60);
const screenshot = args.get('screenshot') || '';
const port = Number(args.get('port') || 9333);
const clickIds = (args.get('click') || '').split(',').filter(Boolean);
const evalJs = args.get('eval') || '';
const delayMs = Number(args.get('delay') || 0);
const fullPage = args.get('full') === '1';
const logFile = args.get('log') || '';
const holdKey = args.get('hold-key') || '';
const chromePath =
  args.get('chrome') ||
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (!url) {
  console.error('Falta --url');
  process.exit(2);
}

const profile = path.join(process.env.TEMP || '/tmp', 'dze-e2e-profile-' + Date.now());

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1280,900',
    'about:blank'
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

let chromeErr = '';
chrome.stderr.on('data', (d) => {
  chromeErr += d.toString();
  if (chromeErr.length > 200000) chromeErr = chromeErr.slice(-100000);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(pathname) {
  const res = await fetch('http://127.0.0.1:' + port + pathname);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' en ' + pathname);
  return res.json();
}

async function waitForChrome(timeoutMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      await getJson('/json/version');
      return;
    } catch (e) {
      if (Date.now() - t0 > timeoutMs) throw new Error('Chrome no respondió: ' + e.message);
      await sleep(250);
    }
  }
}

const logs = [];
let msgId = 1;
const pending = new Map();

function send(ws, method, params = {}) {
  const id = msgId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('timeout ' + method));
      }
    }, 30000);
  });
}

function clean(text) {
  return String(text).replace(/\s+$/, '');
}

function record(kind, text) {
  const line = clean(text);
  logs.push({ kind, line });
  if (line.length < 400) console.log('[' + kind + '] ' + line);
}

async function main() {
  await waitForChrome();
  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('sin pestaña');

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (_e) {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || [])
        .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
        .join(' ');
      record(msg.params.type || 'console', text);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      record('EXCEPTION', (d.exception && d.exception.description) || d.text || 'excepción');
    } else if (msg.method === 'Log.entryAdded') {
      record('LOG:' + msg.params.entry.level, msg.params.entry.text);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
  });

  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Page.navigate', { url });

  // Espera a que el documento y los módulos están listos antes de interactuar.
  if (evalJs || clickIds.length) {
    for (let i = 0; i < 40; i++) {
      const st = await send(ws, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      }).catch(() => null);
      if (st && st.result && st.result.value === 'complete') break;
      await sleep(250);
    }
    await sleep(1500);
  }
  if (evalJs) {
    const res = await send(ws, 'Runtime.evaluate', {
      expression: evalJs,
      returnByValue: true
    }).catch(() => null);
    record('eval', evalJs + '  =>  ' + ((res && res.result && res.result.value) ?? 'sin valor'));
  }
  for (const id of clickIds) {
    const res = await send(ws, 'Runtime.evaluate', {
      expression: `(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return 'sin ' + ${JSON.stringify(id)}; el.click(); return 'click ' + ${JSON.stringify(id)}; })()`,
      returnByValue: true
    }).catch(() => null);
    record('click', (res && res.result && res.result.value) || 'fallo');
  }
  if (delayMs) await sleep(delayMs);

  // Tecla mantenida de verdad (eventos trusted v?a CDP): sirve para probar que
  // el control humano no desplaza a Mindy en los modos autom?ticos.
  let holdTimer = null;
  if (holdKey) {
    const keyMap = {
      KeyW: { key: 'w', code: 'KeyW', vk: 87 },
      KeyA: { key: 'a', code: 'KeyA', vk: 65 },
      KeyS: { key: 's', code: 'KeyS', vk: 83 },
      KeyD: { key: 'd', code: 'KeyD', vk: 68 }
    };
    const k = keyMap[holdKey] || keyMap.KeyW;
    holdTimer = setInterval(() => {
      send(ws, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: k.key,
        code: k.code,
        windowsVirtualKeyCode: k.vk,
        nativeVirtualKeyCode: k.vk
      }).catch(() => {});
    }, 120);
    record('key', 'manteniendo ' + holdKey);
  }

  const t0 = Date.now();
  let lastReport = 0;
  while ((Date.now() - t0) / 1000 < seconds) {
    await sleep(1000);
    const elapsed = Math.round((Date.now() - t0) / 1000);
    if (elapsed - lastReport >= 15) {
      lastReport = elapsed;
      const probe = await send(ws, 'Runtime.evaluate', {
        expression:
          'JSON.stringify({iso: window.crossOriginIsolated, title: document.title, ' +
          'booted: !!(window.Module && window.Module.calledRun), ' +
          'status: (document.getElementById("statusText")||{}).textContent})',
        returnByValue: true
      }).catch(() => null);
      if (probe && probe.result) record('probe', probe.result.value || '');
    }
    if (screenshot && elapsed === Math.min(30, Math.floor(seconds / 2))) {
      const shot = await send(ws, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: fullPage
      }).catch(() => null);
      if (shot && shot.data) {
        await mkdir(path.dirname(screenshot), { recursive: true });
        await writeFile(screenshot, Buffer.from(shot.data, 'base64'));
        record('shot', 'captura en ' + screenshot);
      }
    }
  }

  const summary = await send(ws, 'Runtime.evaluate', {
    expression:
      'JSON.stringify({iso: window.crossOriginIsolated, booted: !!(window.Module && window.Module.calledRun), ' +
      'status: (document.getElementById("statusText")||{}).textContent, ' +
      'steps: (document.getElementById("statSteps")||{}).textContent, ' +
      'minD: (document.getElementById("statMinD")||{}).textContent, ' +
      'zombies: (document.getElementById("statZombies")||{}).textContent})',
    returnByValue: true
  }).catch(() => null);

  if (holdTimer) clearInterval(holdTimer);
  record('summary', (summary && summary.result && summary.result.value) || 'sin resumen');
  if (logFile) {
    await mkdir(path.dirname(logFile) || '.', { recursive: true });
    await writeFile(logFile, JSON.stringify(logs, null, 1));
    console.log('log: ' + logFile + ' (' + logs.length + ' l?neas)');
  }
  ws.close();

  const bad = logs.filter(
    (l) =>
      /^EXCEPTION/.test(l.kind) ||
      /ZScript|Script error|Uncaught|TypeError|ReferenceError|Abort|abort/i.test(l.line)
  );
  if (bad.length) {
    console.log('\n--- señales de problema (' + bad.length + ') ---');
    for (const b of bad.slice(0, 25)) console.log('[' + b.kind + '] ' + b.line);
  }
  console.log('\n' + logs.length + ' líneas de consola capturadas');
  return bad.length ? 1 : 0;
}

main()
  .then((code) => {
    chrome.kill('SIGKILL');
    process.exit(code || 0);
  })
  .catch((err) => {
    console.error('FALLO:', err.message);
    if (chromeErr) console.error('chrome stderr:\n' + chromeErr.slice(-3000));
    chrome.kill('SIGKILL');
    process.exit(1);
  });
