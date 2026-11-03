/**
 * runA.mjs — 指令包 7A 验收探针（连线特征放大与导线双端辅助）
 *
 * 覆盖：
 *   7A.1 视图缩放与坐标换算（放大后拾取反变换精确命中 + 点 A 点 B 连线）
 *   7A.2 放大镜开关 / 跟随 / 点击聚焦
 *   7A.3 智能聚焦连线（点 A 自动 1.5× + 起点态；点 B 生成导线；Esc 取消并恢复）
 *   7A.4 悬停导线双端端点标记（R1.1 ⇄ LED.A）
 *   7A.5 工具栏 / 快捷键 / 集成；六档分辨率无横向溢出；console 0
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:5360/';
const PORT = 9361;
const ROOT = 'C:/Users/31474/AppData/Local/Temp/labsimA/probe';
const WORK = join(ROOT, 'work');
const SHOT = join(ROOT, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    const arr = this.listeners.get(method) || [];
    arr.push(fn);
    this.listeners.set(method, arr);
  }
}

await rm(WORK, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await mkdir(SHOT, { recursive: true });

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(WORK, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,920', 'about:blank',
], { stdio: 'ignore' });

let version = null;
for (let i = 0; i < 60; i += 1) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (res.ok) { version = await res.json(); break; }
  } catch (err) { /* 端口未就绪 */ }
  await sleep(250);
}
if (!version) throw new Error('Edge 调试端口未就绪');
console.log('浏览器：' + version['Browser']);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连接失败')); });
const cdp = new Cdp(ws);

const errors = [];
cdp.on('Runtime.exceptionThrown', (p) => {
  errors.push('异常：' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
});
cdp.on('Runtime.consoleAPICalled', (p) => {
  const text = p.args.map((a) => a.value ?? a.description).join(' ');
  if (p.type === 'error' || p.type === 'warning') errors.push(`${p.type}：${text}`);
});
cdp.on('Log.entryAdded', (p) => {
  if (p.entry.level === 'error' && p.entry.source !== 'network') errors.push('log：' + p.entry.text);
});

await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.send('Page.enable');
await cdp.send('DOM.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 920, deviceScaleFactor: 1, mobile: false,
});

const evaluate = async (expression) => {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true,
  });
  if (res.exceptionDetails) {
    throw new Error('页面异常：' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result.value;
};

const mouse = async (type, x, y, button = 'none', buttons = 0, clickCount = 0) => {
  await cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button, buttons, clickCount, pointerType: 'mouse',
  });
};
const clickAt = async (x, y) => {
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y, 'left', 1, 1);
  await mouse('mouseReleased', x, y, 'left', 0, 1);
  await sleep(140);
};
const moveTo = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(60); };

/* 元件端子 → 视口屏幕坐标（canvas 内 CSS 像素 + bounding rect 偏移） */
const termScreen = async (id, term) => evaluate(`
  (() => {
    const b = window.__labBoard;
    const ref = b.model.resolveRef({ componentId: '${id}', terminal: '${term}' });
    if (!ref) return null;
    const box = document.getElementById('breadboard-canvas').getBoundingClientRect();
    const p = b.project(ref.pos.x, ref.pos.y);
    return { x: box.left + p.x, y: box.top + p.y, label: ref.label, gx: ref.pos.x, gy: ref.pos.y, onNode: b.nodeAt(ref.pos.x, ref.pos.y).length > 0 };
  })()
`);

/* 列出元件所有端子的落点孔位状态 */
const listTerms = async (id) => evaluate(`
  (() => {
    const b = window.__labBoard;
    const c = b.model.findComponent('${id}');
    return c.terminals.map(t => {
      const ref = b.model.resolveRef({ componentId: '${id}', terminal: t.name });
      return { name: t.name, onNode: b.nodeAt(ref.pos.x, ref.pos.y).length > 0 };
    });
  })()
`);

/* 网格点 → 视口屏幕坐标 */
const screenOf = async (gx, gy) => evaluate(`
  (() => {
    const b = window.__labBoard;
    const box = document.getElementById('breadboard-canvas').getBoundingClientRect();
    const p = b.project(${gx}, ${gy});
    return { x: box.left + p.x, y: box.top + p.y };
  })()
`);

const shot = async (name) => {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOT, `${name}.png`), Buffer.from(res.data, 'base64'));
};

/* ==========================================================================
   0. 进入实验
   ========================================================================== */
await cdp.send('Page.navigate', { url: BASE });
await sleep(1200);
await evaluate(`window.localStorage.clear()`);
await cdp.send('Page.reload');
await sleep(1300);

check('页面初始化完成', await evaluate(`window.__labSimReady === true`) === true);
await evaluate(`[...document.querySelectorAll('.exp-card')][0].click()`);
await sleep(900);

check('缩放 API 已暴露',
  await evaluate(`Boolean(window.__labBoard && window.__labBoard.zoom
    && typeof window.__labBoard.zoom.set === 'function'
    && typeof window.__labBoard.zoom.level === 'function'
    && Array.isArray(window.__labBoard.zoom.levels()))`) === true);
check('放大镜 / 聚焦 API 已暴露',
  await evaluate(`Boolean(window.__labBoard.lens && window.__labBoard.focus
    && typeof window.__labBoard.lens.on === 'function'
    && typeof window.__labBoard.focus.onGrid === 'function')`) === true);

const zoomInit = await evaluate(`window.__labBoard.zoom.level()`);
check('初始缩放为 1×', zoomInit === 1, `level=${zoomInit}`);

const platformInfo = await evaluate(`(() => { const b=window.__labBoard; const p=b.platforms.getPlatform(b.platformId); return { id:p.id, cols:p.cols, rows:p.rows }; })()`);
console.log('  平台：' + JSON.stringify(platformInfo));

/* ==========================================================================
   1. 放置两个元件（电阻 / LED），挑选落在孔位上的端子作为 A / B
   ========================================================================== */
const built = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const r = b.place('resistor', 10, 8);
    const l = b.place('led', 24, 8);
    return { r: r ? r.id : null, l: l ? l.id : null, wires0: b.model.getState().wires.length };
  })()
`);
check('放置电阻与 LED', Boolean(built.r && built.l), JSON.stringify(built));

const rTerms = await listTerms(built.r);
const lTerms = await listTerms(built.l);
console.log('  电阻端子:' + JSON.stringify(rTerms) + ' LED端子:' + JSON.stringify(lTerms));
const A = (rTerms.find((t) => t.onNode) || rTerms[0]).name;
const B = (lTerms.find((t) => t.onNode) || lTerms[0]).name;

const rScreen = await termScreen(built.r, A);
const lScreen = await termScreen(built.l, B);
check('电阻起点端子可取（落在孔位优先）', rScreen.onNode === true, `label=${rScreen.label} onNode=${rScreen.onNode}`);
check('LED 目标端子可取', lScreen !== null, `label=${lScreen.label} onNode=${lScreen.onNode}`);

/* ==========================================================================
   2. 拾取精度：1× / 2× / 3× 下端子投影点能精确拾取到该端子
   ========================================================================== */
for (const z of [1, 2, 3]) {
  await evaluate(`window.__labBoard.zoom.set(${z})`);
  await sleep(120);
  const hit = await evaluate(`(() => {
    const b = window.__labBoard;
    const ref = b.model.resolveRef({ componentId: '${built.r}', terminal: '${A}' });
    const p = b.project(ref.pos.x, ref.pos.y);
    return b.pick(p.x, p.y);
  })()`);
  check(`拾取精度 ${z}×：投影点命中本端子`,
    hit && hit.type === 'terminal' && hit.componentId === built.r && hit.terminal === A,
    `${z}× hit=${JSON.stringify(hit)}`);
}
await evaluate(`window.__labBoard.zoom.reset()`);
await sleep(120);

/* ==========================================================================
   3. 智能聚焦连线：点 A（自动 1.5×）→ 点 B（生成导线）
   ========================================================================== */
const beforeWires = await evaluate(`window.__labBoard.model.getState().wires.length`);
await clickAt(rScreen.x, rScreen.y);
await sleep(150);
const afterStart = await evaluate(`(() => { const b=window.__labBoard; return { wiring: b.scene.wiring ? b.scene.wiring.from : null, zoom: b.zoom.level() }; })()`);
check('点 A 进入连线起点态', afterStart.wiring !== null, `from=${JSON.stringify(afterStart.wiring)}`);
check('点 A 后自动放大到 1.5×', Math.abs(afterStart.zoom - 1.5) < 1e-6, `zoom=${afterStart.zoom}`);

// 放大后重新计算点 B 的屏幕坐标（验证拾取反变换）
const lScreenZoomed = await termScreen(built.l, B);
check('放大后点 B 屏幕坐标随 zoom 变化',
  Math.abs(lScreenZoomed.x - lScreen.x) > 1 || Math.abs(lScreenZoomed.y - lScreen.y) > 1,
  `${lScreen.x.toFixed(0)},${lScreen.y.toFixed(0)} -> ${lScreenZoomed.x.toFixed(0)},${lScreenZoomed.y.toFixed(0)}`);

await clickAt(lScreenZoomed.x, lScreenZoomed.y);
await sleep(180);
const afterB = await evaluate(`(() => { const b=window.__labBoard; return { wiring: b.scene.wiring, wires: b.model.getState().wires.length }; })()`);
check('点 B 后连线起点态清除', afterB.wiring === null, `wiring=${JSON.stringify(afterB.wiring)}`);
check('点 B 后新增一条导线', afterB.wires === beforeWires + 1, `${beforeWires} -> ${afterB.wires}`);

const wireInfo = await evaluate(`(() => {
  const b = window.__labBoard;
  const w = b.model.getState().wires[b.model.getState().wires.length - 1];
  const a = b.model.resolveRef(w.a);
  const c = b.model.resolveRef(w.b);
  return { a: a ? a.label : null, b: c ? c.label : null, id: w.id };
})()`);
check('新增导线两端标签正确（R.x ⇄ LED.x）',
  wireInfo.a && wireInfo.b && wireInfo.a.startsWith(built.r) && wireInfo.b.startsWith(built.l),
  JSON.stringify(wireInfo));

/* ==========================================================================
   4. 悬停导线：高亮 + 双端端点标记（R1.1 ⇄ LED.A）
   悬停点取导线上方水平段的几何中点（wirePath 会先抬升 accent 再水平走）
   ========================================================================== */
const wireMid = await evaluate(`(() => {
  const b = window.__labBoard;
  const w = b.model.getState().wires[b.model.getState().wires.length - 1];
  const a = b.model.resolveRef(w.a).pos;
  const c = b.model.resolveRef(w.b).pos;
  const pa = b.project(a.x, a.y);
  const pc = b.project(c.x, c.y);
  const accent = Math.max(6, Math.min(18, b.view.tileH * 0.62));
  const mx = (pa.x + pc.x) / 2;
  const my = (pa.y + pc.y) / 2 - accent;
  const box = document.getElementById('breadboard-canvas').getBoundingClientRect();
  return { x: box.left + mx, y: box.top + my, wireId: w.id, accent };
})()`);
await moveTo(wireMid.x, wireMid.y);
await sleep(150);
const hover = await evaluate(`(() => { const b=window.__labBoard; return b.scene.hover; })()`);
check('悬停导线 → hover.type 为 wire', hover && hover.type === 'wire' && hover.wireId === wireMid.wireId, JSON.stringify(hover));

const markerPixel = await evaluate(`(() => {
  const b = window.__labBoard;
  const ref = b.model.resolveRef({ componentId: '${built.l}', terminal: '${B}' });
  const box = document.getElementById('breadboard-canvas').getBoundingClientRect();
  const p = b.project(ref.pos.x, ref.pos.y);
  const canvas = document.getElementById('breadboard-canvas');
  const dpr = b.view.dpr;
  const cx = Math.round((box.left + p.x - box.left) * dpr);
  const cy = Math.round((box.top + p.y - box.top) * dpr);
  const ctx = canvas.getContext('2d');
  const r = Math.round(6 * dpr);
  const data = ctx.getImageData(cx - r, cy - r, r * 2, r * 2).data;
  let cyan = 0;
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    if (B > 170 && G > 170 && R < 200) cyan += 1;
  }
  return { cyan, total: data.length / 4 };
})()`);
check('悬停时 LED 端点出现青色标记像素', markerPixel.cyan > 0, `cyan=${markerPixel.cyan}/${markerPixel.total}`);
await shot('7A-wire-hover');

/* ==========================================================================
   5. 放大镜：开启 + 指针跟随
   ========================================================================== */
await evaluate(`window.__labBoard.lens.on()`);
const canvasCenter = await screenOf((platformInfo.cols / 2) | 0, (platformInfo.rows / 2) | 0);
await moveTo(canvasCenter.x, canvasCenter.y);
await sleep(150);
const lensState = await evaluate(`(() => { const b=window.__labBoard; return { on: b.scene.lens.on, inside: b.scene.pointerInside, hasPointer: Boolean(b.scene.pointer) }; })()`);
check('放大镜开启', lensState.on === true, JSON.stringify(lensState));
check('放大镜跟随指针（pointerInside + pointer 已设置）', lensState.inside === true && lensState.hasPointer === true, JSON.stringify(lensState));
await shot('7A-lens');
await evaluate(`window.__labBoard.lens.off()`);
await evaluate(`(() => { const b=window.__labBoard; b.scene.pointer=null; b.scene.pointerInside=false; b.requestRender(); })()`);

/* ==========================================================================
   6. Esc 取消连线并恢复 zoom（用当前缩放下实时坐标点 A）
   ========================================================================== */
await evaluate(`window.__labBoard.zoom.reset()`);
await sleep(120);
const rScreenFresh = await termScreen(built.r, A);
await clickAt(rScreenFresh.x, rScreenFresh.y);
await sleep(150);
const startedZoom = await evaluate(`window.__labBoard.zoom.level()`);
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
await sleep(150);
const afterEsc = await evaluate(`(() => { const b=window.__labBoard; return { wiring: b.scene.wiring, zoom: b.zoom.level() }; })()`);
check('Esc 取消连线起点态', afterEsc.wiring === null, JSON.stringify(afterEsc));
check('Esc 后 zoom 恢复为 1×', afterEsc.zoom === 1, `from ${startedZoom} -> ${afterEsc.zoom}`);

/* ==========================================================================
   7. 工具栏按钮：放大 / 缩小 / 复位（档位循环 1→1.5→2→1.5→1）
   ========================================================================== */
await evaluate(`window.__labBoard.zoom.reset()`);
await sleep(100);
await evaluate(`document.getElementById('btn-zoom-in').click()`);
await sleep(100);
const afterIn = await evaluate(`window.__labBoard.zoom.level()`);
await evaluate(`document.getElementById('btn-zoom-in').click()`);
await sleep(100);
const afterIn2 = await evaluate(`window.__labBoard.zoom.level()`);
await evaluate(`document.getElementById('btn-zoom-out').click()`);
await sleep(100);
const afterOut = await evaluate(`window.__labBoard.zoom.level()`);
await evaluate(`document.getElementById('btn-zoom-reset').click()`);
await sleep(100);
const afterReset = await evaluate(`window.__labBoard.zoom.level()`);
check('工具栏放大按钮升档到 1.5×', afterIn === 1.5, `level=${afterIn}`);
check('再次放大升档到 2×', afterIn2 === 2, `level=${afterIn2}`);
check('工具栏缩小按钮降档 2×→1.5×', afterOut === 1.5, `level=${afterOut}`);
check('工具栏复位按钮回到 1×', afterReset === 1, `level=${afterReset}`);

/* ==========================================================================
   8. 六档分辨率无横向溢出
   ========================================================================== */
const resolutions = [
  [1440, 920], [1366, 768], [1280, 720], [1024, 600], [820, 720], [375, 667],
];
for (const [w, h] of resolutions) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  });
  await evaluate(`window.__labBoard.relayout()`);
  await sleep(250);
  const ov = await evaluate(`(() => {
    const tools = document.getElementById('canvas-tools');
    const toolsRect = tools ? tools.getBoundingClientRect() : null;
    const panel = document.querySelector('.panel-canvas');
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      toolsOverflow: toolsRect && panelRect ? (toolsRect.right > panelRect.right + 1) : false,
      zoomReadout: document.getElementById('zoom-level') ? document.getElementById('zoom-level').textContent : '',
    };
  })()`);
  check(`分辨率 ${w}×${h} 无横向溢出`, ov.overflowX === false, JSON.stringify(ov));
}

/* ==========================================================================
   汇总
   ========================================================================== */
check('无 console 报错或异常', errors.length === 0, errors.slice(0, 6).join(' / '));

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 7A 探针：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length > 0) {
  console.log('未通过项：');
  failed.forEach((r) => console.log('  × ' + r.name + (r.detail ? ' | ' + r.detail : '')));
}
if (errors.length > 0) {
  console.log('\n控制台输出：');
  errors.slice(0, 10).forEach((e) => console.log('  ! ' + e));
}

ws.close();
edge.kill();
process.exitCode = failed.length > 0 ? 1 : 0;
