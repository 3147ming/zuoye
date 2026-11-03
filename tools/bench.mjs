/**
 * bench.mjs — 性能基准 B1–B5（指令包 14）
 *
 * B1 直流 100 元件 / B2 暂态 RC 1s(1ms) / B3 数字 6 芯片×24 门 1000 步：
 *   纯 node 计时，取 5 次中位数。
 * B4 画布渲染 100 元件+200 导线 / B5 100 元件场景 pointermove：
 *   无头 Edge + CDP 在页面内计时（render 一帧 / 派发一次 pointermove）。
 */
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as M from '../js/model.js';
import { solveDC } from '../js/simdc.js';
import { solveTransient, resetTransientState } from '../js/simtrans.js';
import { solveDig } from '../js/simdig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const median = (list) => {
  const s = list.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function timeIt(fn, runs = 5) {
  const out = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return { median: Number(median(out).toFixed(2)), min: Number(Math.min(...out).toFixed(2)), max: Number(Math.max(...out).toFixed(2)) };
}

/* B1：100 元件直流 */
function b1() {
  M.createCircuit('breadboard');
  const vs = M.addComponent('vsource', 2, 2, { params: { voltage: 5 } }).component.id;
  let prev = vs;
  let pin = '+';
  for (let i = 0; i < 100; i += 1) {
    const r = M.addComponent('resistor', 2 + (i % 20) * 3, 4 + Math.floor(i / 20) * 2, { params: { resistance: 1000 } });
    if (!r.ok) break;
    M.addWire({ componentId: prev, terminal: pin }, { componentId: r.component.id, terminal: '1' });
    prev = r.component.id;
    pin = '2';
  }
  M.addWire({ componentId: prev, terminal: pin }, { componentId: vs, terminal: '-' });
  return timeIt(() => solveDC(M));
}

/* B2：RC 1s / 1ms */
function b2() {
  M.createCircuit('breadboard');
  resetTransientState();
  const vs = M.addComponent('vsource', 2, 2, { params: { voltage: 5 } }).component.id;
  const r = M.addComponent('resistor', 6, 2, { params: { resistance: 1000 } }).component.id;
  const c = M.addComponent('capacitor', 10, 2, { params: { capacitance: 100e-6 } }).component.id;
  const W = (a, ta, b, tb) => M.addWire({ componentId: a, terminal: ta }, { componentId: b, terminal: tb });
  W(vs, '+', r, '1'); W(r, '2', c, '1'); W(c, '2', vs, '-');
  return timeIt(() => solveTransient(M, { duration: 1, dt: 0.001 }), 3);
}

/* B3：6 芯片 × 4 门 = 24 门，1000 步时钟 */
function b3() {
  M.createCircuit('exp-box');
  const ids = [];
  for (let i = 0; i < 6; i += 1) {
    const r = M.addComponent('ic74xx', 2 + (i % 3) * 8, 2 + Math.floor(i / 3) * 5, { params: { type: '74LS00' } });
    if (!r.ok) break;
    ids.push(r.component.id);
  }
  for (let i = 0; i < ids.length - 1; i += 1) {
    M.addWire({ componentId: ids[i], terminal: '3' }, { componentId: ids[i + 1], terminal: '1' });
    M.addWire({ componentId: ids[i], terminal: '3' }, { componentId: ids[i + 1], terminal: '2' });
  }
  return timeIt(() => {
    for (let i = 0; i < 1000; i += 1) solveDig(M);
  }, 3);
}

const b1r = b1();
const b2r = b2();
const b3r = b3();

/* B4/B5：浏览器 */
process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, waitFor } = await import('./probe/runB.mjs');

const serverProc = await ensureServer();
const boot = await bootEdge();
const { cdp } = boot;
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5360/' });
await loaded;
await waitFor(async () => evalJs(cdp, 'Boolean(window.__labSimReady)'), 12000, 'app');
await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (!c) return false; c.click(); return true; })()`);
await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard)'), 12000, 'board');

const browser = await evalJs(cdp, `(() => {
  const B = window.__labBoard;
  const M = B.model;
  M.createCircuit('breadboard');
  const vs = M.addComponent('vsource', 2, 2, { params: { voltage: 5 } }).component.id;
  const comps = [vs];
  // 100 元件（50 电阻 + 50 电容）铺在面包板上
  for (let i = 0; i < 50; i += 1) {
    const x = 2 + (i % 20) * 3;
    const y = 4 + Math.floor(i / 20) * 3;
    const r = M.addComponent('resistor', x, y, { params: { resistance: 1000 } });
    if (r.ok) comps.push(r.component.id);
    const c = M.addComponent('capacitor', x, y + 1, { params: { capacitance: 1e-6 } });
    if (c.ok) comps.push(c.component.id);
  }
  for (let i = 0; i < 200; i += 1) {
    const a = comps[1 + (i % (comps.length - 1))];
    const b = comps[1 + ((i + 7) % (comps.length - 1))];
    M.addWire({ componentId: a, terminal: '1' }, { componentId: b, terminal: '1' });
  }
  B.requestRender();
  // B4：强制 5 帧取中位数
  const frames = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    B.renderNow();
    frames.push(performance.now() - t0);
  }
  frames.sort((a, b) => a - b);
  // B5：pointermove 处理
  const canvas = document.getElementById('breadboard-canvas');
  const rect = canvas.getBoundingClientRect();
  const moves = [];
  for (let i = 0; i < 20; i += 1) {
    const t0 = performance.now();
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 20 + i, clientY: rect.top + 20 + i, bubbles: true }));
    moves.push(performance.now() - t0);
  }
  moves.sort((a, b) => a - b);
  return { renderMs: frames[2], moveMs: moves[10], comps: M.getState().components.length, wires: M.getState().wires.length };
})()`);

boot.edge.kill();
if (serverProc) serverProc.kill();

const payload = {
  at: new Date().toISOString(),
  host: '本机 Windows x64 / Node ' + process.version,
  B1: { ...b1r, budget: 10, target: '100 元件直流 ≤10ms' },
  B2: { ...b2r, budget: 500, target: 'RC 1s/1ms ≤500ms' },
  B3: { ...b3r, budget: 100, target: '24 门 ×1000 步 ≤100ms' },
  B4: { median: browser.renderMs, budget: 16, target: '100 元件+200 导线一帧 ≤16ms', comps: browser.comps, wires: browser.wires },
  B5: { median: browser.moveMs, budget: 4, target: 'pointermove ≤4ms' },
};
payload.ok = ['B1', 'B2', 'B3', 'B4', 'B5'].every((k) => payload[k].median <= payload[k].budget);

console.log(JSON.stringify(payload, null, 2));
await writeFile(join(ROOT, 'tools', 'bench-result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
process.exitCode = payload.ok ? 0 : 1;
