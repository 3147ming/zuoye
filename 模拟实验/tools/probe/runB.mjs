/**
 * runB.mjs — 指令包 7B（交互手感与体验优化）无头 Edge + CDP 探针
 *
 * 覆盖 2.1–2.12 全部 12 项 + 回归（六档分辨率无横向溢出 / console 0 /
 * serializeCircuit 旋转 180·270 一致 / 仿真可求解）。
 *
 * 运行：node labsB/probe/runB.mjs
 * 判定：日志末尾出现「=== 探针结果：N/M 通过 ===」即真跑完。
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_URL = 'http://127.0.0.1:5360/';
const CDP_PORT = 9333;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- 结果记录 */

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`OK   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ' -> ' + detail : ''}`);
    console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

/* ---------------------------------------------------------------- CDP 客户端 */

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('CDP WebSocket 连接失败')), { once: true });
    });
    const cdp = new CDP(ws);
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code || ''})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method) {
        const list = cdp.listeners.get(msg.method) || [];
        list.forEach((fn) => fn(msg.params));
      }
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  close() {
    try {
      this.ws.close();
    } catch { /* ignore */ }
  }
}

export async function evalJs(cdp, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error(d.exception && d.exception.description ? d.exception.description : (d.text || 'evaluate failed'));
  }
  return res.result ? res.result.value : undefined;
}

export async function waitFor(fn, timeout, label) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(120);
  }
  throw new Error(`等待超时：${label}`);
}

/* ---------------------------------------------------------------- 服务 / 浏览器 */

export async function ensureServer() {
  try {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return null;
  } catch { /* not running */ }
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, stdio: 'ignore' });
  await waitFor(async () => {
    const res = await fetch(APP_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  }, 8000, '本地服务 5360');
  return proc;
}

export async function bootEdge() {
  const userDataDir = await mkdtemp(join(tmpdir(), 'lab-edge-'));
  const edge = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--window-size=1400,950',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  }, 15000, 'CDP 调试端口');

  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page') || list[0];
  if (!page || !page.webSocketDebuggerUrl) throw new Error('找不到可用的 CDP page 目标');

  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  return { cdp, edge, userDataDir };
}

/* ---------------------------------------------------------------- 页面助手 */

export const INSTALL = `(() => {
  if (window.__P) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  window.__P = {
    reset() {
      // 先走一次 Esc：清掉「待放置类型 / 连线起点态 / 连续放置模式」（官方退出路径）
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const m = M();
      const st = m.getState();
      st.wires.slice().forEach((w) => m.removeWire(w.id));
      st.components.slice().forEach((c) => m.removeComponent(c.id));
      m.clearUndo();
      // 同步清掉交互层残留：连线起点态 / 放置预览 / 连续放置模式 / 闪烁预告
      const sc = B().scene;
      sc.wiring = null;
      sc.ghost = null;
      sc.pointer = null;
      sc.pendingFlash = null;
      B().interact.continuousPlace(false);
      B().setSelection(null);
      B().requestRender();
      return { comps: m.getState().components.length, wires: m.getState().wires.length };
    },
    place(type, x, y) { return B().place(type, x, y); },
    state() {
      const m = M();
      const st = m.getState();
      return {
        comps: st.components.map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, rotation: c.rotation })),
        wires: st.wires.map((w) => ({ id: w.id, a: w.a, b: w.b })),
        canUndo: m.canUndo(),
        canRedo: m.canRedo(),
      };
    },
    rect(id) {
      const c = M().findComponent(id);
      return c ? M().rectOf(c) : null;
    },
    terms(id) { return B().geometry.terminals(id); },
    screen(id, name) { return B().geometry.screenTerminal(id, name); },
    project(gx, gy) { return B().project(gx, gy); },
    pick(x, y) { return B().pick(x, y); },
    blankPoint() {
      const c = document.getElementById('breadboard-canvas');
      const r = c.getBoundingClientRect();
      const candidates = [
        { x: 8, y: 8 }, { x: r.width - 8, y: 8 },
        { x: 8, y: r.height - 8 }, { x: r.width - 8, y: r.height - 8 },
        { x: r.width / 2, y: 8 }, { x: r.width / 2, y: r.height - 8 },
        { x: 8, y: r.height / 2 }, { x: r.width - 8, y: r.height / 2 },
      ];
      for (let i = 0; i < candidates.length; i += 1) {
        const p = candidates[i];
        if (!B().pick(p.x, p.y)) return p;
      }
      return { x: 4, y: 4 };
    },
    findCompHit(id) {
      const c = M().findComponent(id);
      if (!c) return null;
      const f = M().rectOf(c);
      let fallback = null;
      for (let gy = f.y; gy < f.y + f.h; gy += 1) {
        for (let gx = f.x; gx < f.x + f.w; gx += 1) {
          const p = B().project(gx + 0.5, gy + 0.5);
          const hit = B().pick(p.x, p.y);
          if (!hit) continue;
          if (hit.type === 'component' && hit.componentId === id) return { x: p.x, y: p.y };
          if (!fallback && hit.type === 'terminal' && hit.componentId === id) fallback = { x: p.x, y: p.y };
        }
      }
      return fallback;
    },
    findWireHit(idA, tA, idB, tB) {
      const a = B().geometry.screenTerminal(idA, tA);
      const b = B().geometry.screenTerminal(idB, tB);
      if (!a || !b) return null;
      // 导线是贝塞尔弧，直线采样会漏：对两端点包围盒做面扫描
      const minX = Math.min(a.x, b.x) - 56, maxX = Math.max(a.x, b.x) + 56;
      const minY = Math.min(a.y, b.y) - 56, maxY = Math.max(a.y, b.y) + 56;
      for (let y = minY; y <= maxY; y += 5) {
        for (let x = minX; x <= maxX; x += 5) {
          const hit = B().pick(x, y);
          if (hit && hit.type === 'wire') return { x, y, id: hit.wireId };
        }
      }
      return null;
    },
    pointer(type, sx, sy, extra) {
      const c = document.getElementById('breadboard-canvas');
      const r = c.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, composed: true,
        clientX: r.left + sx, clientY: r.top + sy,
        pointerId: 1, button: 0,
        buttons: type === 'pointerup' || type === 'pointerleave' ? 0 : 1,
        isPrimary: true,
      };
      if (extra) Object.assign(init, extra);
      c.dispatchEvent(new PointerEvent(type, init));
      return { clientX: init.clientX, clientY: init.clientY };
    },
    ctxAt(sx, sy) {
      const c = document.getElementById('breadboard-canvas');
      const r = c.getBoundingClientRect();
      return B().interact.contextmenu(r.left + sx, r.top + sy);
    },
    clickPalette(type) {
      const item = document.querySelector('[data-part-type="' + type + '"]');
      if (!item) return false;
      const r = item.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      item.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true,
        clientX: cx, clientY: cy, pointerId: 2, button: 0, buttons: 1, isPrimary: true,
      }));
      document.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, composed: true,
        clientX: cx, clientY: cy, pointerId: 2, button: 0, buttons: 0, isPrimary: true,
      }));
      return true;
    },
    key(key, init) {
      document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, init || {})));
      return true;
    },
    toastText() { return document.getElementById('toast-host').textContent; },
    toastCount() { return document.getElementById('toast-host').children.length; },
    clearToasts() { document.getElementById('toast-host').replaceChildren(); return true; },
    statusText() {
      const el = document.getElementById('canvas-status');
      return el ? el.textContent : '';
    },
    simPending() { return Boolean(B().scene && B().scene.simPending); },
    wiring() { return Boolean(B().scene && B().scene.wiring); },
    selection() { return B().scene ? B().scene.selection : null; },
    addWire(idA, tA, idB, tB) {
      return M().addWire({ componentId: idA, terminal: tA }, { componentId: idB, terminal: tB });
    },
    serialize() { return M().serializeCircuit(); },
    load(data) { return M().loadCircuit(data, M().getPlatformId()); },
    cursor() { return document.getElementById('breadboard-canvas').style.cursor; },
    overflow() {
      return {
        innerWidth: window.innerWidth,
        scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      };
    },
    contOn() { B().interact.continuousPlace(true); return true; },
    contOff() { B().interact.continuousPlace(false); return true; },
    cont() { return B().interact.isContinuousPlace(); },
    select(id) { return B().setSelection({ type: 'component', id }); },
    rot() { return B().interact.rotate(); },
    undo() { return B().undo(); },
    redo() { return B().interact.redo(); },
    del() {
      const ok = B().deleteSelection();
      return { ok, flash: Boolean(B().scene && B().scene.pendingFlash) };
    },
    lensOn() { B().lens.on(); return true; },
    lensOff() { B().lens.off(); return true; },
    platform() {
      const p = B().platforms.getPlatform(B().platformId);
      return { id: B().platformId, cols: p.cols, rows: p.rows };
    },
  };
  return true;
})()`;

/* ---------------------------------------------------------------- 主流程 */

async function run() {
  mkdir(join(ROOT, 'labsB'), { recursive: true }).catch(() => {});

  const serverProc = await ensureServer();
  let edgeProc = null;
  let userDataDir = null;

  try {
    const boot = await bootEdge();
    const { cdp } = boot;
    edgeProc = boot.edge;
    userDataDir = boot.userDataDir;

    const consoleErrors = [];
    const consoleWarnings = [];

    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : String(a.description || a.type || '')))
        .join(' ');
      if (params.type === 'error' || params.type === 'assert') consoleErrors.push(text);
      else if (params.type === 'warning') consoleWarnings.push(text);
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const d = params.exceptionDetails || {};
      consoleErrors.push(d.exception && d.exception.description ? d.exception.description : (d.text || 'uncaught'));
    });
    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      if (entry.level === 'error') consoleErrors.push(entry.text || 'log-error');
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: APP_URL });
    await loaded;
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labSimReady)'), 10000, 'app 就绪');
    await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (!c) return false; c.click(); return true; })()`);
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard)'), 10000, '实验台就绪');
    await evalJs(cdp, INSTALL);

    const plat = await evalJs(cdp, '__P.platform()');
    console.log(`\n# 平台：${plat.id}（${plat.cols}×${plat.rows}）\n`);

    /* ============ 2.3 四向旋转（占位 + 端子坐标） ============ */
    {
      await evalJs(cdp, '__P.reset()');
      const comp = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      check('2.3 放置电阻成功', Boolean(comp && comp.id), JSON.stringify(comp && comp.id));

      const expectedTerms = {
        0: [[2, 2], [4, 2]],
        90: [[2, 2], [2, 4]],
        180: [[4, 2], [2, 2]],
        270: [[2, 4], [2, 2]],
      };
      const expectedRect = {
        0: { w: 3, h: 1 },
        90: { w: 1, h: 3 },
        180: { w: 3, h: 1 },
        270: { w: 1, h: 3 },
      };

      await evalJs(cdp, `__P.select('${comp.id}')`);
      for (const step of [90, 180, 270, 0]) {
        const ok = await evalJs(cdp, '__P.rot()');
        check(`2.3 旋转到 ${step}° 成功`, ok === true, String(ok));
        const state = await evalJs(cdp, '__P.state()');
        const me = state.comps.find((c) => c.id === comp.id);
        check(`2.3 rotation 状态 = ${step}`, me && me.rotation === step, JSON.stringify(me));

        const rect = await evalJs(cdp, `__P.rect('${comp.id}')`);
        check(`2.3 占位 ${step}° = ${expectedRect[step].w}×${expectedRect[step].h}`,
          rect && rect.w === expectedRect[step].w && rect.h === expectedRect[step].h,
          JSON.stringify(rect));

        const terms = await evalJs(cdp, `__P.terms('${comp.id}')`);
        const exp = expectedTerms[step];
        const t1 = terms.find((t) => t.name === '1');
        const t2 = terms.find((t) => t.name === '2');
        check(`2.3 端子坐标 ${step}°`,
          t1 && t2 && t1.x === exp[0][0] && t1.y === exp[0][1] && t2.x === exp[1][0] && t2.y === exp[1][1],
          JSON.stringify({ t1, t2 }));
      }
    }

    /* ============ 2.3 存档一致（serializeCircuit 180/270） ============ */
    {
      await evalJs(cdp, '__P.reset()');
      const comp = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      await evalJs(cdp, `__P.select('${comp.id}')`);
      await evalJs(cdp, '__P.rot()'); // 90
      await evalJs(cdp, '__P.rot()'); // 180
      const s180 = await evalJs(cdp, '__P.serialize()');
      check('2.3 serialize 含 rotation=180', s180.components[0].rotation === 180, JSON.stringify(s180.components[0]));
      const loaded = await evalJs(cdp, `__P.load(${JSON.stringify(s180)})`);
      check('2.3 load 180° 成功', loaded && loaded.ok === true && loaded.components === 1, JSON.stringify(loaded));
      const st = await evalJs(cdp, '__P.state()');
      check('2.3 载入后 rotation 仍 180（旧存档兼容，不改写）', st.comps[0].rotation === 180, JSON.stringify(st.comps[0]));

      await evalJs(cdp, '__P.reset()');
      const comp2 = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      await evalJs(cdp, `__P.select('${comp2.id}')`);
      await evalJs(cdp, '__P.rot()');
      await evalJs(cdp, '__P.rot()');
      await evalJs(cdp, '__P.rot()'); // 270
      const s270 = await evalJs(cdp, '__P.serialize()');
      check('2.3 serialize 含 rotation=270', s270.components[0].rotation === 270, JSON.stringify(s270.components[0]));
      const loaded2 = await evalJs(cdp, `__P.load(${JSON.stringify(s270)})`);
      check('2.3 load 270° 成功', loaded2 && loaded2.ok === true && loaded2.components === 1, JSON.stringify(loaded2));
      const st2 = await evalJs(cdp, '__P.state()');
      check('2.3 载入后 rotation 仍 270', st2.comps[0].rotation === 270, JSON.stringify(st2.comps[0]));

      // 旧存档只有 0/90 的数据，加载不受影响
      await evalJs(cdp, `__P.load(${JSON.stringify({ version: 3, platform: s270.platform, components: [{ id: 'r-old', type: 'resistor', x: 2, y: 2, rotation: 90, params: {} }], wires: [] })})`);
      const st3 = await evalJs(cdp, '__P.state()');
      check('2.3 旧存档 90° 加载不受影响', st3.comps.length === 1 && st3.comps[0].rotation === 90, JSON.stringify(st3.comps));
    }

    /* ============ 2.5 重做 ============ */
    {
      await evalJs(cdp, '__P.reset()');
      await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      let st = await evalJs(cdp, '__P.state()');
      check('2.5 放置后 1 元件', st.comps.length === 1, JSON.stringify(st.comps));

      const undone = await evalJs(cdp, '__P.undo()');
      st = await evalJs(cdp, '__P.state()');
      check('2.5 撤销成功且元件消失', undone === true && st.comps.length === 0, JSON.stringify(st.comps));
      check('2.5 撤销后可重做', st.canRedo === true, String(st.canRedo));

      const redone = await evalJs(cdp, '__P.redo()');
      st = await evalJs(cdp, '__P.state()');
      check('2.5 重做成功且元件回来', redone === true && st.comps.length === 1, JSON.stringify(st.comps));
      check('2.5 重做后重做栈空', st.canRedo === false, String(st.canRedo));

      // 撤销后新操作清空重做栈
      await evalJs(cdp, '__P.undo()');
      await evalJs(cdp, `__P.place('led', 2, 4)`);
      st = await evalJs(cdp, '__P.state()');
      const redoAfterNew = await evalJs(cdp, '__P.redo()');
      check('2.5 撤销后新操作清空重做栈', st.canRedo === false && redoAfterNew === false && st.comps.length === 1,
        JSON.stringify({ canRedo: st.canRedo, redoAfterNew, comps: st.comps.length }));

      // 撤销/重做保留 rotation 与清空选中
      await evalJs(cdp, '__P.reset()');
      const comp = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      await evalJs(cdp, `__P.select('${comp.id}')`);
      await evalJs(cdp, '__P.rot()'); // 90
      await evalJs(cdp, '__P.undo()');
      let me = (await evalJs(cdp, '__P.state()')).comps[0];
      check('2.5 撤销恢复 rotation=0', me && me.rotation === 0, JSON.stringify(me));
      const selAfterUndo = await evalJs(cdp, '__P.selection()');
      check('2.5 撤销后清空选中', selAfterUndo === null, JSON.stringify(selAfterUndo));
      await evalJs(cdp, '__P.redo()');
      me = (await evalJs(cdp, '__P.state()')).comps[0];
      check('2.5 重做恢复 rotation=90', me && me.rotation === 90, JSON.stringify(me));
    }

    /* ============ 2.10 toast 队列（同屏最多 1 条） ============ */
    {
      await evalJs(cdp, '__P.reset()');
      await evalJs(cdp, '__P.clearToasts()');
      for (let i = 0; i < 5; i += 1) {
        await evalJs(cdp, `__P.place('resistor', ${2 + i * 5}, 2)`);
      }
      let maxSeen = 0;
      let sawAny = false;
      for (let i = 0; i < 40; i += 1) {
        const n = await evalJs(cdp, '__P.toastCount()');
        if (n > maxSeen) maxSeen = n;
        if (n > 0) sawAny = true;
        await sleep(120);
      }
      check('2.10 连续 5 次操作 toast 同屏最多 1 条（无堆积）', maxSeen <= 1, `max=${maxSeen}`);
      check('2.10 toast 正常展示', sawAny === true, `max=${maxSeen}`);
    }

    /* ============ 2.4 连续放置 ============ */
    {
      await evalJs(cdp, '__P.reset()');
      await evalJs(cdp, '__P.clearToasts()');
      await evalJs(cdp, '__P.contOn()');
      check('2.4 连续放置开关已开', (await evalJs(cdp, '__P.cont()')) === true);
      await evalJs(cdp, `__P.clickPalette('resistor')`);

      for (let i = 0; i < 3; i += 1) {
        const p = await evalJs(cdp, `__P.project(${2 + i * 5}, 4)`);
        await evalJs(cdp, `__P.pointer('pointerdown', ${p.x}, ${p.y})`);
        await evalJs(cdp, `__P.pointer('pointerup', ${p.x}, ${p.y})`);
      }
      const st = await evalJs(cdp, '__P.state()');
      check('2.4 连放 3 个同类元件', st.comps.length === 3, JSON.stringify(st.comps));
      check('2.4 放置后仍处连续模式', (await evalJs(cdp, '__P.cont()')) === true);

      // 合并提示"已放置 3 个"
      let toastOk = false;
      let lastT = '';
      for (let i = 0; i < 40; i += 1) {
        lastT = await evalJs(cdp, '__P.toastText()');
        if (lastT && lastT.indexOf('已放置 3 个') >= 0) { toastOk = true; break; }
        await sleep(300);
      }
      check('2.4/2.10 连续放置 toast 合并为"已放置 3 个"', toastOk, `toast=${JSON.stringify(lastT)}`);

      // Esc 退出连续放置
      await evalJs(cdp, `__P.key('Escape')`);
      const p4 = await evalJs(cdp, '__P.project(22, 4)');
      await evalJs(cdp, `__P.pointer('pointerdown', ${p4.x}, ${p4.y})`);
      await evalJs(cdp, `__P.pointer('pointerup', ${p4.x}, ${p4.y})`);
      const st2 = await evalJs(cdp, '__P.state()');
      check('2.4 Esc 后退出放置模式', st2.comps.length === 3, JSON.stringify(st2.comps));
    }

    /* ============ 2.1 拖拽释放连线 ============ */
    {
      await evalJs(cdp, '__P.reset()');
      const r = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      const l = await evalJs(cdp, `__P.place('led', 7, 2)`);
      const a = await evalJs(cdp, `__P.screen('${r.id}', '2')`);
      const b = await evalJs(cdp, `__P.screen('${l.id}', 'A')`);
      await evalJs(cdp, `__P.pointer('pointerdown', ${a.x}, ${a.y})`);
      const wiringAfterDown = await evalJs(cdp, '__P.wiring()');
      await evalJs(cdp, `__P.pointer('pointermove', ${(a.x + b.x) / 2}, ${(a.y + b.y) / 2})`);
      await evalJs(cdp, `__P.pointer('pointerup', ${b.x}, ${b.y})`);
      let st = await evalJs(cdp, '__P.state()');
      check('2.1 拖拽释放生成导线', st.wires.length === 1,
        `wires=${st.wires.length} wiringAfterDown=${wiringAfterDown} pickB=${JSON.stringify(await evalJs(cdp, `__P.pick(${b.x}, ${b.y})`))}`);

      // 拖到空白松手 = 取消
      const r2 = await evalJs(cdp, `__P.place('resistor', 12, 2)`);
      const a2 = await evalJs(cdp, `__P.screen('${r2.id}', '2')`);
      const blank = await evalJs(cdp, '__P.blankPoint()');
      await evalJs(cdp, `__P.pointer('pointerdown', ${a2.x}, ${a2.y})`);
      await evalJs(cdp, `__P.pointer('pointermove', ${blank.x}, ${blank.y})`);
      await evalJs(cdp, `__P.pointer('pointerup', ${blank.x}, ${blank.y})`);
      st = await evalJs(cdp, '__P.state()');
      check('2.1 拖到空白松手取消连线', st.wires.length === 1 && (await evalJs(cdp, '__P.wiring()')) === false,
        JSON.stringify({ wires: st.wires.length }));

      // 原地点击 = 进入点A点B起点态
      const a3 = await evalJs(cdp, `__P.screen('${r2.id}', '2')`);
      await evalJs(cdp, `__P.pointer('pointerdown', ${a3.x}, ${a3.y})`);
      await evalJs(cdp, `__P.pointer('pointerup', ${a3.x}, ${a3.y})`);
      check('2.1 原地点击仍进起点态', (await evalJs(cdp, '__P.wiring()')) === true);

      // 点A点B（并存路径）：点第二端完成
      const b2 = await evalJs(cdp, `__P.screen('${l.id}', 'K')`);
      const wiringBeforeB2 = await evalJs(cdp, '__P.wiring()');
      await evalJs(cdp, `__P.pointer('pointerdown', ${b2.x}, ${b2.y})`);
      st = await evalJs(cdp, '__P.state()');
      check('2.1 点A点B 并存：点击终点完成连线', st.wires.length === 2,
        `wires=${st.wires.length} wiringBeforeB2=${wiringBeforeB2}`);

      // 撤销栈一致
      await evalJs(cdp, '__P.undo()');
      st = await evalJs(cdp, '__P.state()');
      check('2.1 拖拽/点击连线撤销行为一致', st.wires.length === 1, JSON.stringify(st.wires));
    }

    /* ============ 2.2 非法终点具体原因 ============ */
    {
      await evalJs(cdp, '__P.reset()');
      await evalJs(cdp, '__P.clearToasts()');
      const r = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      const l = await evalJs(cdp, `__P.place('led', 7, 2)`);

      // 同元件端子
      const t1 = await evalJs(cdp, `__P.screen('${r.id}', '1')`);
      const t2 = await evalJs(cdp, `__P.screen('${r.id}', '2')`);
      await evalJs(cdp, `__P.pointer('pointerdown', ${t1.x}, ${t1.y})`);
      await evalJs(cdp, `__P.pointer('pointerdown', ${t2.x}, ${t2.y})`);
      const st = await evalJs(cdp, '__P.state()');
      check('2.2 同元件端子不产生导线且保留起点态',
        st.wires.length === 0 && (await evalJs(cdp, '__P.wiring()')) === true,
        JSON.stringify({ wires: st.wires.length }));
      let toastOk = false;
      let lastT = '';
      for (let i = 0; i < 40; i += 1) {
        lastT = await evalJs(cdp, '__P.toastText()');
        if (lastT && lastT.indexOf('不能连到同一元件的端子') >= 0) { toastOk = true; break; }
        await sleep(300);
      }
      check('2.2 同元件端子提示具体原因', toastOk, `toast=${JSON.stringify(lastT)}`);

      // 已存在连线
      await evalJs(cdp, `__P.key('Escape')`);
      await evalJs(cdp, `__P.addWire('${r.id}', '2', '${l.id}', 'A')`);
      await evalJs(cdp, '__P.clearToasts()');
      await evalJs(cdp, `__P.pointer('pointerdown', ${t2.x}, ${t2.y})`);
      const la = await evalJs(cdp, `__P.screen('${l.id}', 'A')`);
      await evalJs(cdp, `__P.pointer('pointerdown', ${la.x}, ${la.y})`);
      const st2 = await evalJs(cdp, '__P.state()');
      check('2.2 重复连线不产生新导线', st2.wires.length === 1, JSON.stringify(st2.wires));
      toastOk = false;
      lastT = '';
      for (let i = 0; i < 40; i += 1) {
        lastT = await evalJs(cdp, '__P.toastText()');
        if (lastT && lastT.indexOf('这两个端子已经连接') >= 0) { toastOk = true; break; }
        await sleep(300);
      }
      check('2.2 重复连线提示具体原因', toastOk, `toast=${JSON.stringify(lastT)}`);

      // 空白终点
      await evalJs(cdp, `__P.key('Escape')`);
      await evalJs(cdp, '__P.clearToasts()');
      await evalJs(cdp, `__P.pointer('pointerdown', ${t1.x}, ${t1.y})`);
      const blank = await evalJs(cdp, '__P.blankPoint()');
      await evalJs(cdp, `__P.pointer('pointerdown', ${blank.x}, ${blank.y})`);
      check('2.2 空白终点保留起点态', (await evalJs(cdp, '__P.wiring()')) === true);
      toastOk = false;
      lastT = '';
      for (let i = 0; i < 40; i += 1) {
        lastT = await evalJs(cdp, '__P.toastText()');
        if (lastT && lastT.indexOf('请点击端子或孔位作为终点') >= 0) { toastOk = true; break; }
        await sleep(300);
      }
      check('2.2 空白终点提示保留', toastOk, `toast=${JSON.stringify(lastT)}`);
    }

    /* ============ 2.6 删除预告 + 2.7 右键删除矩阵 ============ */
    {
      // 2.6 删除预告 + 撤销恢复
      await evalJs(cdp, '__P.reset()');
      const r = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      const l = await evalJs(cdp, `__P.place('led', 7, 2)`);
      await evalJs(cdp, `__P.addWire('${r.id}', '2', '${l.id}', 'A')`);
      await evalJs(cdp, `__P.select('${r.id}')`);
      const del = await evalJs(cdp, '__P.del()');
      check('2.6 删除成功且连带导线闪烁预告', del.ok === true && del.flash === true, JSON.stringify(del));
      let st = await evalJs(cdp, '__P.state()');
      check('2.6 连带导线一并删除', st.comps.length === 1 && st.wires.length === 0, JSON.stringify(st));
      await evalJs(cdp, '__P.undo()');
      st = await evalJs(cdp, '__P.state()');
      check('2.6 Ctrl+Z 完整恢复（元件+导线）', st.comps.length === 2 && st.wires.length === 1, JSON.stringify(st));

      // 2.7 右键导线
      await evalJs(cdp, '__P.reset()');
      const r1 = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      const l1 = await evalJs(cdp, `__P.place('led', 7, 2)`);
      await evalJs(cdp, `__P.addWire('${r1.id}', '2', '${l1.id}', 'A')`);
      const hit = await evalJs(cdp, `__P.findWireHit('${r1.id}', '2', '${l1.id}', 'A')`);
      check('2.7 找到导线命中点', Boolean(hit), JSON.stringify(hit));
      if (hit) {
        await evalJs(cdp, `__P.ctxAt(${hit.x}, ${hit.y})`);
        st = await evalJs(cdp, '__P.state()');
        check('2.7 右键导线只删该导线', st.comps.length === 2 && st.wires.length === 0, JSON.stringify(st));
        await evalJs(cdp, '__P.undo()');
        st = await evalJs(cdp, '__P.state()');
        check('2.7 右键删导线可撤销', st.wires.length === 1, JSON.stringify(st));
      }

      // 2.7 右键元件（连带导线）
      const chit = await evalJs(cdp, `__P.findCompHit('${r1.id}')`);
      check('2.7 找到元件命中点', Boolean(chit), JSON.stringify(chit));
      if (chit) {
        await evalJs(cdp, `__P.ctxAt(${chit.x}, ${chit.y})`);
        st = await evalJs(cdp, '__P.state()');
        check('2.7 右键元件连带导线一起删', st.comps.length === 1 && st.wires.length === 0, JSON.stringify(st));
        await evalJs(cdp, '__P.undo()');
        st = await evalJs(cdp, '__P.state()');
        check('2.7 右键删元件可撤销', st.comps.length === 2 && st.wires.length === 1, JSON.stringify(st));
      }

      // 2.7 右键端子 → 删所属元件
      const term = await evalJs(cdp, `__P.screen('${r1.id}', '1')`);
      await evalJs(cdp, `__P.ctxAt(${term.x}, ${term.y})`);
      st = await evalJs(cdp, '__P.state()');
      check('2.7 右键端子删所属元件', st.comps.length === 1, JSON.stringify(st.comps));

      // 2.7 右键空白 → 清空选中 / 不删
      const l2 = await evalJs(cdp, `__P.place('led', 2, 6)`);
      await evalJs(cdp, `__P.select('${l2.id}')`);
      const blank = await evalJs(cdp, '__P.blankPoint()');
      await evalJs(cdp, `__P.ctxAt(${blank.x}, ${blank.y})`);
      st = await evalJs(cdp, '__P.state()');
      const sel = await evalJs(cdp, '__P.selection()');
      check('2.7 右键空白清空选中且不删除', st.comps.length === 2 && sel === null, JSON.stringify({ comps: st.comps.length, sel }));

      // 2.7 连线起点态右键只取消不误删
      const r3 = await evalJs(cdp, `__P.place('resistor', 2, 8)`);
      const t3 = await evalJs(cdp, `__P.screen('${r3.id}', '1')`);
      await evalJs(cdp, `__P.pointer('pointerdown', ${t3.x}, ${t3.y})`);
      check('2.7 已进入连线起点态', (await evalJs(cdp, '__P.wiring()')) === true);
      await evalJs(cdp, `__P.ctxAt(${blank.x}, ${blank.y})`);
      st = await evalJs(cdp, '__P.state()');
      check('2.7 起点态右键只取消连线不误删',
        (await evalJs(cdp, '__P.wiring()')) === false && st.comps.some((c) => c.id === r3.id),
        JSON.stringify(st.comps));

      // 2.7 画布外右键不受影响
      const prevented = await evalJs(cdp, `(() => {
        const b = document.getElementById('btn-zoom-in');
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 2, clientY: 2 });
        b.dispatchEvent(ev);
        return ev.defaultPrevented;
      })()`);
      check('2.7 画布外右键保持默认菜单', prevented === false, String(prevented));
    }

    /* ============ 2.8 悬停光标区分 ============ */
    {
      await evalJs(cdp, '__P.reset()');
      const r = await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      const l = await evalJs(cdp, `__P.place('led', 7, 2)`);
      await evalJs(cdp, `__P.addWire('${r.id}', '2', '${l.id}', 'A')`);

      const t = await evalJs(cdp, `__P.screen('${r.id}', '1')`);
      await evalJs(cdp, `__P.pointer('pointermove', ${t.x}, ${t.y})`);
      check('2.8 端子 crosshair', (await evalJs(cdp, '__P.cursor()')) === 'crosshair', await evalJs(cdp, '__P.cursor()'));

      const ch = await evalJs(cdp, `__P.findCompHit('${r.id}')`);
      if (ch) {
        await evalJs(cdp, `__P.pointer('pointermove', ${ch.x}, ${ch.y})`);
        check('2.8 元件 move', (await evalJs(cdp, '__P.cursor()')) === 'move', await evalJs(cdp, '__P.cursor()'));
      }

      const wh = await evalJs(cdp, `__P.findWireHit('${r.id}', '2', '${l.id}', 'A')`);
      if (wh) {
        await evalJs(cdp, `__P.pointer('pointermove', ${wh.x}, ${wh.y})`);
        check('2.8 导线 pointer', (await evalJs(cdp, '__P.cursor()')) === 'pointer', await evalJs(cdp, '__P.cursor()'));
      } else {
        check('2.8 导线 pointer', false, '未命中导线');
      }

      const blank = await evalJs(cdp, '__P.blankPoint()');
      await evalJs(cdp, `__P.pointer('pointermove', ${blank.x}, ${blank.y})`);
      check('2.8 空白默认光标', (await evalJs(cdp, '__P.cursor()')) === '', JSON.stringify(await evalJs(cdp, '__P.cursor()')));

      await evalJs(cdp, '__P.lensOn()');
      await evalJs(cdp, `__P.pointer('pointermove', ${t.x}, ${t.y})`);
      check('2.8 放大镜开启 zoom-in（与 7A 一致）', (await evalJs(cdp, '__P.cursor()')) === 'zoom-in', await evalJs(cdp, '__P.cursor()'));
      await evalJs(cdp, '__P.lensOff()');
    }

    /* ============ 2.9 视图切换淡入 ============ */
    {
      const trans = await evalJs(cdp, `(() => {
        const el = document.getElementById('canvas-area');
        const cs = getComputedStyle(el);
        return { property: cs.transitionProperty, duration: cs.transitionDuration };
      })()`);
      check('2.9 画布含 opacity 淡入过渡',
        String(trans.property).indexOf('opacity') >= 0 && parseFloat(trans.duration) > 0,
        JSON.stringify(trans));

      for (let i = 0; i < 5; i += 1) {
        await evalJs(cdp, `(() => { document.getElementById('btn-view-schematic').click(); return true; })()`);
        await sleep(90);
        const schemVisible = await evalJs(cdp, `!document.getElementById('schematic-area').hidden`);
        await evalJs(cdp, `(() => { document.getElementById('btn-view-bench').click(); return true; })()`);
        await sleep(90);
        const benchVisible = await evalJs(cdp, `!document.getElementById('canvas-area').hidden`);
        if (!schemVisible || !benchVisible) {
          check('2.9 视图切换往返', false, `round ${i}: schem=${schemVisible} bench=${benchVisible}`);
          break;
        }
        if (i === 4) check('2.9 视图切换 5 次往返内容不变', true);
      }

      const after = await evalJs(cdp, '(() => { const s = __P.state(); return s.comps.length + ":" + s.wires.length; })()');
      check('2.9 切换后 model 不复制（包 4 契约）', typeof after === 'string', String(after));
    }

    /* ============ 2.11 仿真"计算中…" ============ */
    {
      await evalJs(cdp, '__P.reset()');
      await evalJs(cdp, '__P.clearToasts()');
      const during = await evalJs(cdp, `(() => {
        __P.place('resistor', 2, 2);
        return { pending: __P.simPending(), status: __P.statusText() };
      })()`);
      check('2.11 防抖期 simPending=true', during.pending === true, JSON.stringify(during));
      check('2.11 状态行显示"计算中…"', String(during.status).indexOf('计算中') >= 0, String(during.status));

      await sleep(700);
      const after = await evalJs(cdp, `({ pending: __P.simPending(), status: __P.statusText() })`);
      check('2.11 计算完成后 simPending=false', after.pending === false, JSON.stringify(after));
      check('2.11 完成后恢复结果摘要',
        String(after.status).indexOf('计算中') === -1 && String(after.status).indexOf('元件') >= 0,
        String(after.status));
    }

    /* ============ 2.12 回归：六档分辨率无横向溢出 ============ */
    {
      const sizes = [[360, 640], [480, 800], [768, 1024], [1024, 768], [1280, 800], [1600, 900]];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(220);
        const o = await evalJs(cdp, '__P.overflow()');
        check(`2.12 无横向溢出 ${w}×${h}`, o.scrollW <= o.innerWidth + 1,
          `scrollW=${o.scrollW} inner=${o.innerWidth}`);
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(150);
    }

    /* ============ 2.12 回归：仿真 / 重做快捷键入口 / console ============ */
    {
      const sim = await evalJs(cdp, `(() => {
        __P.reset();
        __P.place('resistor', 2, 2);
        __P.place('led', 7, 2);
        __P.addWire(__P.state().comps[0].id, '2', __P.state().comps[1].id, 'A');
        const solved = __labBoard.simdc.solve('probe');
        const last = __labBoard.simdc.last();
        const report = __labBoard.simdc.report();
        return { solved: !!solved, last: !!last, reportLen: String(report || '').length, stats: __labBoard.simdc.stats() };
      })()`);
      check('2.12 仿真可求解且有结果', sim.solved === true && sim.last === true, JSON.stringify(sim));

      // 快捷键入口：Ctrl+Y 与 __labBoard.interact.redo 等价
      await evalJs(cdp, '__P.reset()');
      await evalJs(cdp, `__P.place('resistor', 2, 2)`);
      await evalJs(cdp, '__P.undo()');
      await evalJs(cdp, `__P.key('y', { ctrlKey: true })`);
      const st = await evalJs(cdp, '__P.state()');
      check('2.12 Ctrl+Y 重做生效', st.comps.length === 1, JSON.stringify(st.comps));
      // 指令包 16：Ctrl+Shift+Z 分支已按规格删除，Shift 组合不得产生任何功能
      await evalJs(cdp, '__P.undo()');
      await evalJs(cdp, `__P.key('z', { ctrlKey: true, shiftKey: true })`);
      const st2 = await evalJs(cdp, '__P.state()');
      check('2.12 Ctrl+Shift+Z 不再重做（Shift 组合已移除）', st2.comps.length === 0, JSON.stringify(st2.comps));
    }

    /* ============ console 0 ============ */
    check('2.12 console 错误 0 条', consoleErrors.length === 0,
      consoleErrors.slice(0, 6).join(' | ') || '无');
    if (consoleWarnings.length > 0) {
      console.log(`INFO console 警告 ${consoleWarnings.length} 条：${consoleWarnings.slice(0, 3).join(' | ')}`);
    }

    await sleep(200);
    cdp.close();
  } finally {
    if (edgeProc) {
      try { edgeProc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    if (userDataDir) {
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
    if (serverProc) {
      try { serverProc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }

  if (failures.length > 0) {
    console.log('\n未通过项：');
    failures.forEach((f) => console.log(`  × ${f}`));
  }
  console.log(`\n=== 探针结果：${pass}/${pass + fail} 通过 ===`);
  if (fail > 0) process.exitCode = 1;
}

if (!process.env.__LAB_PROBE_LIB) run().catch((err) => {
  console.error('探针运行失败：', err && err.stack ? err.stack : err);
  // 中止不打印「探针结果」行，避免被误判为真跑完
  console.log('\n=== 探针中止：未跑完 ===');
  process.exitCode = 1;
});
