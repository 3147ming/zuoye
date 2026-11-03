/**
 * run6.mjs — 指令包 6 验收探针（数字仿真：门级 + 时序 + 实验箱元件）
 *
 * 覆盖：
 *   6.1 元件库    —— 10 类可放置、74LS 芯片 14 脚、数字源参数可改
 *   6.2 逻辑模型  —— 由 tools/test-model.mjs 做 node 直测，这里验证接线后行为
 *   6.3 数字引擎  —— 真值表 / 级联 / 环路 / 竞争 / LED 耦合
 *   6.4 呈现交互  —— 数字面板 / 点击切换 / LED 亮灭（含像素）/ 时钟步进 / 防抖 / 环路容错
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:5360/';
const PORT = 9357;
const ROOT = 'C:/Users/31474/AppData/Local/Temp/labsim6/probe';
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
  await sleep(120);
};
const shot = async (name) => {
  /* 截图同时记录几何：横版/竖屏、滚动、以及板子四角投影落点。
     若某张图的板子跑到画布外，能立刻看出是视图参数变了还是别的位移。 */
  const geo = await evaluate(`
    (() => {
      const b = window.__labBoard;
      const c = document.getElementById('breadboard-canvas');
      const v = b.view;
      const p = b.platforms.getPlatform(b.platformId);
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return {
        canvas: [Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)],
        attr: [c.width, c.height],
        scrollY: window.scrollY,
        areaScroll: (document.getElementById('canvas-area') || {}).scrollTop || 0,
        transform: cs.transform,
        view: { scale: +v.scale.toFixed(4), ox: +v.originX.toFixed(1), oy: +v.originY.toFixed(1), tileW: +v.tileW.toFixed(2) },
        corners: [[0, 0], [p.cols, 0], [0, p.rows], [p.cols, p.rows]].map(([gx, gy]) => {
          const q = b.project(gx, gy);
          return [Math.round(q.x), Math.round(q.y)];
        }),
      };
    })()
  `);
  console.log('  GEO ' + name + ' ' + JSON.stringify(geo));
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOT, `${name}.png`), Buffer.from(res.data, 'base64'));
};

/* 画布内网格点 → 屏幕坐标（每次都现算，避免布局微调后失准） */
const screenOf = async (gx, gy) => evaluate(`
  (() => {
    const b = window.__labBoard;
    const box = document.getElementById('breadboard-canvas').getBoundingClientRect();
    const p = b.project(${gx}, ${gy});
    return { x: box.left + p.x, y: box.top + p.y };
  })()
`);

const solves = () => evaluate(`window.__labBoard.simdc.stats().solves`);

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

check('数字调试入口已暴露',
  await evaluate(`Boolean(window.__labBoard && window.__labBoard.simdig
    && typeof window.__labBoard.simdig.stepClock === 'function')`) === true);

const palette = await evaluate(`
  (() => {
    const items = [...document.querySelectorAll('.palette-item')];
    return {
      count: items.length,
      labels: items.map((el) => el.querySelector('.palette-name').textContent),
      types: items.map((el) => el.dataset.partType),
    };
  })()
`);
check('元件库渲染全部元件（≥10 类）', palette.count >= 10, `count=${palette.count}`);
check('数字元件出现在元件库里',
  ['logic-switch', 'pulse', 'clock', 'ic74xx'].every((t) => palette.types.includes(t)),
  palette.types.join(','));
check('数字源有中文标签',
  palette.labels.includes('逻辑电平开关') && palette.labels.includes('脉冲源')
  && palette.labels.includes('时钟源'), palette.labels.join('/'));

const digPanelInit = await evaluate(`
  (() => {
    const host = document.getElementById('dig-panel');
    return {
      exists: Boolean(host),
      title: host && host.querySelector('.sim-title') ? host.querySelector('.sim-title').textContent : '',
      status: host && host.querySelector('.sim-status') ? host.querySelector('.sim-status').textContent : '',
    };
  })()
`);
check('数字状态面板存在且有标题',
  digPanelInit.exists === true && digPanelInit.title === '数字状态', JSON.stringify(digPanelInit));
check('空电路显示「没有数字元件」', digPanelInit.status.includes('没有数字元件'), digPanelInit.status);

/* ==========================================================================
   1. 逻辑开关 → 74LS00 → 面板电平
   ========================================================================== */
const built = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const M = b.model;
    const put = (type, x, y, params) => {
      const r = b.place(type, x, y);
      if (!r) return null;
      if (params) M.updateParams(r.id, params);
      return r.id;
    };
    const sa = put('logic-switch', 2, 14);
    const sb = put('logic-switch', 6, 14);
    M.updateParams(sb, { state: 'hi' });
    const ic = put('ic74xx', 2, 6, { type: '74LS00' });
    const wire = (a, at, c, ct) => M.addWire({ componentId: a, terminal: at }, { componentId: c, terminal: ct }).ok;
    const w1 = wire(sa, 'OUT', ic, '1');
    const w2 = wire(sb, 'OUT', ic, '2');
    b.simdc.solve('probe');
    const dig = b.simdig.last();
    const rec = dig.compStates.find((item) => item.componentId === ic);
    return {
      sa, sb, ic, w1, w2,
      ok: dig.ok,
      y: rec ? rec.outputs['3'] : null,
      units: dig.units.length,
      nets: dig.digNets.length,
      warnings: dig.warnings,
    };
  })()
`);
check('放下两个逻辑开关与一片 74LS00',
  Boolean(built && built.sa && built.sb && built.ic), JSON.stringify(built));
check('两条导线都接上', built.w1 === true && built.w2 === true, `${built.w1}/${built.w2}`);
check('数字求值成功', built.ok === true, '');
check('lo/hi → 1Y = 1', built.y === 1, String(built.y));

const panel1 = await evaluate(`
  (() => {
    const host = document.getElementById('dig-panel');
    const rows = [...host.querySelectorAll('.sim-row')].map((row) => ({
      key: row.querySelector('.sim-row-key').textContent,
      val: row.querySelector('.dig-net-text').textContent,
      chip: row.querySelector('.dig-chip').textContent,
    }));
    const cards = [...host.querySelectorAll('.sim-card')].map((card) => ({
      name: card.querySelector('.sim-card-name').textContent,
      pins: [...card.querySelectorAll('.dig-pin')].map((pin) => pin.textContent),
    }));
    return {
      status: host.querySelector('.sim-status').textContent,
      rows,
      cards,
    };
  })()
`);
check('面板状态显示数字单元与网络数', /数字逻辑 · \d+ 个单元 \/ \d+ 个网络/.test(panel1.status), panel1.status);
check('面板列出网络电平', panel1.rows.length >= 1, JSON.stringify(panel1.rows));
check('网络行有高/低文字与徽标', panel1.rows.some((row) => ['高', '低'].includes(row.val) && ['H', 'L'].includes(row.chip)),
  JSON.stringify(panel1.rows));
check('器件卡片列出 1Y 的电平', panel1.cards.some((card) => card.name === built.ic
  && card.pins.some((text) => text.startsWith('3'))), JSON.stringify(panel1.cards));

/* ==========================================================================
   2. 点击逻辑开关本体：hi/lo 切换 + 防抖重仿
   ========================================================================== */
const swPos = await evaluate(`
  (() => {
    const comp = window.__labBoard.model.findComponent('${built.sa}');
    return { x: comp.x, y: comp.y, state: comp.params.state };
  })()
`);
const tap = await screenOf(swPos.x + 0.5, swPos.y + 0.5);
const beforeTap = await solves();
await clickAt(tap.x, tap.y);
await sleep(500);
const afterTap = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const comp = b.model.findComponent('${built.sa}');
    const dig = b.simdig.last();
    const rec = dig.compStates.find((item) => item.componentId === '${built.ic}');
    return { state: comp.params.state, y: rec ? rec.outputs['3'] : null, solves: b.simdc.stats().solves };
  })()
`);
check('点击开关本体切换电平', swPos.state === 'lo' && afterTap.state === 'hi',
  `${swPos.state} → ${afterTap.state}`);
check('切换后自动重仿（防抖生效）', afterTap.solves === beforeTap + 1,
  `${beforeTap} → ${afterTap.solves}`);
check('点击后 hi/hi → 1Y = 0', afterTap.y === 0, String(afterTap.y));

const propValue = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.setSelection({ type: 'component', id: '${built.sa}' });
    const sel = document.querySelector('#props-panel select[data-param-key="state"]');
    return sel ? sel.value : null;
  })()
`);
check('属性面板同步显示新高电平', propValue === 'hi', String(propValue));

/* ==========================================================================
   3. 防抖：连点 10 次只算一次
   ========================================================================== */
const beforeBurst = await solves();
const stateBeforeBurst = await evaluate(`window.__labBoard.model.findComponent('${built.sa}').params.state`);
for (let i = 0; i < 10; i += 1) {
  await clickAt(tap.x, tap.y);
}
await sleep(600);
const afterBurst = await evaluate(`
  (() => {
    const b = window.__labBoard;
    return { solves: b.simdc.stats().solves, state: b.model.findComponent('${built.sa}').params.state };
  })()
`);
check('连点 10 次防抖后只算 1 次（≤2）', afterBurst.solves - beforeBurst <= 2,
  `${beforeBurst} → ${afterBurst.solves}`);
check('连点 10 次（偶数次）后状态回到点击前', afterBurst.state === stateBeforeBurst,
  `${stateBeforeBurst} → ${afterBurst.state}`);

/* ==========================================================================
   4. 门 → 220Ω → LED：亮/灭 + 像素判定
   ========================================================================== */
const ledBuild = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const M = b.model;
    const put = (type, x, y, params) => {
      const r = b.place(type, x, y);
      if (!r) return null;
      if (params) M.updateParams(r.id, params);
      return r.id;
    };
    // 先把输入改成 hi/lo，保证 NAND 输出 1
    M.updateParams('${built.sa}', { state: 'hi' });
    M.updateParams('${built.sb}', { state: 'lo' });
    const src = put('vsource', 2, 18, { voltage: 5 });
    const res = put('resistor', 14, 6, { resistance: 220 });
    const led = put('led', 18, 6, { color: 'red' });
    const wire = (a, at, c, ct) => M.addWire({ componentId: a, terminal: at }, { componentId: c, terminal: ct }).ok;
    const ok = [
      wire(src, '+', '${built.ic}', '14'),
      wire(src, '-', '${built.ic}', '7'),
      wire('${built.ic}', '3', res, '1'),
      wire(res, '2', led, 'A'),
      wire(led, 'K', '${built.ic}', '7'),
    ];
    b.simdc.solve('probe');
    const sim = b.simdig.last();
    return {
      src, res, led, ok,
      y: (sim.compStates.find((item) => item.componentId === '${built.ic}') || { outputs: {} }).outputs['3'],
      leds: b.simdig.leds(),
      analogOk: b.simdc.last().ok,
      drove: b.simdig.last() !== null,
      elems: b.simdc.last().elementResults.map((e) => ({ id: e.componentId, v: e.v, i: e.i })),
    };
  })()
`);
check('电源 / 电阻 / LED 全部放下并入网', ledBuild.ok.every(Boolean), JSON.stringify(ledBuild.ok));
check('数字输出 1', ledBuild.y === 1, String(ledBuild.y));
check('直流侧求解成功', ledBuild.analogOk === true, '');
check('LED 状态数据为 on', ledBuild.leds.length === 1 && ledBuild.leds[0].on === true,
  JSON.stringify(ledBuild.leds));
check('LED 支路电流约 19.4mA',
  Math.abs(ledBuild.leds[0].i - 0.0194) < 0.001, `${(ledBuild.leds[0].i * 1000).toFixed(2)}mA`);

// 画布像素：亮时 LED 区域应明显更红
const sampleLed = async (id) => evaluate(`
  (() => {
    const b = window.__labBoard;
    const comp = b.model.findComponent('${id}');
    const p = b.project(comp.x + 0.5, comp.y);
    const canvas = document.getElementById('breadboard-canvas');
    const dpr = b.view.dpr;
    const ctx = canvas.getContext('2d');
    const w = Math.round(26 * dpr);
    const data = ctx.getImageData(Math.round(p.x * dpr) - w, Math.round((p.y - 6) * dpr) - w, w * 2, w * 2).data;
    let r = 0; let g = 0; let b2 = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b2 += data[i + 2]; }
    const n = data.length / 4;
    return { r: r / n, g: g / n, b: b2 / n };
  })()
`);
await evaluate(`window.__labBoard.requestRender(); window.__labBoard.simdc.solve('probe')`);
await sleep(350);
const glowOn = await sampleLed(ledBuild.led);
await shot('dig-led-on');

const offState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.updateParams('${built.sb}', { state: 'hi' });
    b.simdc.solve('probe');
    return { y: (b.simdig.last().compStates.find((item) => item.componentId === '${built.ic}') || { outputs: {} }).outputs['3'], leds: b.simdig.leds() };
  })()
`);
await sleep(350);
const glowOff = await sampleLed(ledBuild.led);
await shot('dig-led-off');

check('输出 0 时 LED 数据为 off', offState.y === 0 && offState.leds[0].on === false,
  JSON.stringify(offState.leds));
check('亮时 LED 区域红色分量更高',
  glowOn.r > glowOff.r + 6 && glowOn.r > glowOn.b,
  `on(${glowOn.r.toFixed(1)},${glowOn.g.toFixed(1)},${glowOn.b.toFixed(1)}) vs off(${glowOff.r.toFixed(1)},${glowOff.g.toFixed(1)},${glowOff.b.toFixed(1)})`);

/* ==========================================================================
   5. 时钟步进：74LS74 上升沿采样
   ========================================================================== */
const ffBuild = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const M = b.model;
    const put = (type, x, y, params) => {
      const r = b.place(type, x, y);
      if (!r) return null;
      if (params) M.updateParams(r.id, params);
      return r.id;
    };
    // 放到面包板右侧，避免与已有元件重叠
    const d = put('logic-switch', 26, 14);
    const clk = put('clock', 32, 14, { frequency: 1, duty: 50 });
    const ff = put('ic74xx', 24, 6, { type: '74LS74' });
    const wire = (a, at, c, ct) => M.addWire({ componentId: a, terminal: at }, { componentId: c, terminal: ct }).ok;
    const ok = [wire(d, 'OUT', ff, '2'), wire(clk, '+', ff, '3')];
    M.updateParams(d, { state: 'hi' });
    b.simdc.solve('probe');
    const dig = b.simdig.last();
    return { d, clk, ff, ok, q: (dig.compStates.find((i) => i.componentId === ff) || { outputs: {} }).outputs['5'], okDig: dig.ok };
  })()
`);
check('放下时钟源与 74LS74 并接线', ffBuild.ok.every(Boolean) && ffBuild.okDig === true, JSON.stringify(ffBuild));
check('触发器初始 Q=0', ffBuild.q === 0, String(ffBuild.q));

const hasStepBtn = await evaluate(`Boolean(document.querySelector('#dig-panel [data-dig-action="step"]'))`);
check('面板出现「时钟步进」按钮', hasStepBtn === true);
await evaluate(`document.querySelector('#dig-panel [data-dig-action="step"]').click()`);
await sleep(450);
const afterStep1 = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const dig = b.simdig.last();
    return {
      q: (dig.compStates.find((i) => i.componentId === '${ffBuild.ff}') || { outputs: {} }).outputs['5'],
      edge: dig.units.some((u) => u.edge),
    };
  })()
`);
check('步进一次 → Q=1（采样 D=hi）', afterStep1.q === 1, String(afterStep1.q));

await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.updateParams('${ffBuild.d}', { state: 'lo' });
    document.querySelector('#dig-panel [data-dig-action="step"]').click();
  })()
`);
await sleep(450);
const afterStep2 = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const dig = b.simdig.last();
    return (dig.compStates.find((i) => i.componentId === '${ffBuild.ff}') || { outputs: {} }).outputs['5'];
  })()
`);
check('D 改 lo 再步进 → Q=0', afterStep2 === 0, String(afterStep2));

// 空格快捷键
const beforeSpace = await evaluate(`window.__labBoard.simdig.last().units.some((u) => u.edge)`);
await evaluate(`
  (() => {
    window.__labBoard.model.updateParams('${ffBuild.d}', { state: 'hi' });
    document.body.focus();
  })()
`);
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
await sleep(450);
const afterSpace = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const dig = b.simdig.last();
    return (dig.compStates.find((i) => i.componentId === '${ffBuild.ff}') || { outputs: {} }).outputs['5'];
  })()
`);
check('空格快捷键也能步进（D=hi → Q=1）', afterSpace === 1, `before=${beforeSpace} after=${afterSpace}`);

/* ==========================================================================
   6. 组合环路：面板报错但不崩溃
   ========================================================================== */
const loopBuild = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const M = b.model;
    const put = (type, x, y, params) => {
      const r = b.place(type, x, y);
      if (!r) return null;
      if (params) M.updateParams(r.id, params);
      return r.id;
    };
    const g1 = put('ic74xx', 2, 2, { type: '74LS00' });
    const g2 = put('ic74xx', 12, 2, { type: '74LS02' });
    const wire = (a, at, c, ct) => M.addWire({ componentId: a, terminal: at }, { componentId: c, terminal: ct }).ok;
    const ok = [wire(g1, '3', g2, '2'), wire(g2, '1', g1, '1')];
    b.simdc.solve('probe');
    const dig = b.simdig.last();
    return { g1, g2, ok, wired: ok.every(Boolean), okDig: dig.ok, error: dig.error, cycle: dig.cycle };
  })()
`);
const loopPanel = await evaluate(`
  (() => {
    const host = document.getElementById('dig-panel');
    const status = host.querySelector('.sim-status');
    return {
      text: status ? status.textContent : '',
      isError: status ? status.classList.contains('is-error') : false,
      warns: [...host.querySelectorAll('.sim-warn')].map((el) => el.textContent),
      components: window.__labBoard.model.getState().components.length,
    };
  })()
`);
check('环路两个芯片都放下并接上线', loopBuild.wired === true, JSON.stringify(loopBuild.ok));
check('组合环路被判为错误',
  loopBuild.okDig === false && loopBuild.error === '检测到组合逻辑环路（请检查连线）', String(loopBuild.error));
check('环路列出环上元件', loopBuild.cycle.length >= 2, JSON.stringify(loopBuild.cycle));
check('面板显示环路错误文案',
  loopPanel.isError === true && loopPanel.text.includes('组合逻辑环路'), loopPanel.text);
check('环路不崩溃：画布元件仍在', loopPanel.components > 0, String(loopPanel.components));
await shot('dig-loop-error');

/* ==========================================================================
   7. 性能与清理
   ========================================================================== */
const perf = await evaluate(`
  (() => {
    const b = window.__labBoard;
    // 先把环路那两块芯片摘掉，回到"能算出结果"的电路再量性能，
    // 否则测到的只是环路检测本身（0 个单元），5ms 断言会变成假通过。
    b.model.removeComponent('${loopBuild.g1}');
    b.model.removeComponent('${loopBuild.g2}');
    b.simdc.solve('probe');
    const samples = [];
    for (let i = 0; i < 9; i += 1) {
      const t = performance.now();
      b.simdig.solve('perf');
      samples.push(performance.now() - t);
    }
    samples.sort((a, c) => a - c);
    return {
      median: samples[4],
      digital: b.simdig.last().elapsedMs,
      units: b.simdig.last().units.length,
    };
  })()
`);
check('数字求值单次 < 5ms', perf.digital < 5, `${perf.digital}ms（${perf.units} 单元，整链中位 ${perf.median.toFixed(2)}ms）`);

// 返回列表再进来一次：数字状态要被清干净，不残留上一轮的 Q
await evaluate(`document.getElementById('btn-back').click()`);
await sleep(600);
await evaluate(`[...document.querySelectorAll('.exp-card')][0].click()`);
await sleep(900);
const reentry = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const dig = b.simdig.last();
    const ff = dig && dig.compStates ? dig.compStates.find((i) => i.componentId === '${ffBuild.ff}') : null;
    return {
      hasDig: Boolean(dig),
      hasDigital: dig ? Boolean(dig.hasDigital) : null,
      q: ff ? ff.outputs['5'] : null,
      simPanel: Boolean(document.getElementById('sim-panel')),
      digPanel: Boolean(document.getElementById('dig-panel')),
    };
  })()
`);
check('重进实验后两个面板都在', reentry.simPanel && reentry.digPanel, JSON.stringify(reentry));
check('重进实验后数字状态重新求值', reentry.hasDig === true, JSON.stringify(reentry));
check('重进实验等于断电重上：触发器记忆清零（Q 回到 0）', reentry.q === 0, String(reentry.q));

await shot('dig-after-reentry');

/* ---- 窄屏 ---- */
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 820, height: 720, deviceScaleFactor: 1, mobile: false,
});
await evaluate(`window.__labBoard.relayout(); window.__labBoard.simdc.solve('probe')`);
await sleep(400);
const narrow = await evaluate(`
  (() => {
    const host = document.getElementById('dig-panel');
    const rect = host.getBoundingClientRect();
    return {
      width: rect.width,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      rows: host.querySelectorAll('.sim-row').length,
    };
  })()
`);
check('窄屏下数字面板不产生横向溢出', narrow.overflowX === false, JSON.stringify(narrow));

await shot('dig-narrow');

/* ==========================================================================
   汇总
   ========================================================================== */
check('无 console 报错或异常', errors.length === 0, errors.slice(0, 6).join(' / '));

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 数字仿真探针：${results.length - failed.length}/${results.length} 通过 ===`);
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
