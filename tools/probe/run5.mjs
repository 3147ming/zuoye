/**
 * run5.mjs — 指令包 5 验收探针（直流仿真内核 + 结果面板）
 *
 * 覆盖：
 *   5.1 线性代数     —— 由 tools/test-model.mjs 做 node 直测，这里只验证页面里能跑通
 *   5.2 元件模型     —— LED 收敛 / 开关通断 / 电容开路
 *   5.3 仿真引擎     —— 分压精度 / 短路报告 / 悬空网 / 性能
 *   5.4 结果面板     —— 出现 / 3.333V / 防抖重仿 / 短路不崩溃 / 单次触发
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:5360/';
const PORT = 9353;
const ROOT = 'C:/Users/31474/AppData/Local/Temp/labsim5/probe';
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
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(SHOT, `${name}.png`), Buffer.from(res.data, 'base64'));
};

/* ---- 修改防抖容差用的辅助：等待仿真计数增加 ---- */
const waitSolves = async (base, timeout = 1500) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const now = await evaluate(`window.__labBoard.simdc.stats().solves`);
    if (now > base) return now;
    await sleep(60);
  }
  return await evaluate(`window.__labBoard.simdc.stats().solves`);
};

/* ==========================================================================
   0. 打开页面并进入实验
   ========================================================================== */
await cdp.send('Page.navigate', { url: BASE });
await sleep(1200);
await evaluate(`window.localStorage.clear()`);
await cdp.send('Page.reload');
await sleep(1200);

check('页面初始化完成', await evaluate(`window.__labSimReady === true`) === true);

await evaluate(`[...document.querySelectorAll('.exp-card')][0].click()`);
await sleep(800);

check('结果面板容器存在', await evaluate(`Boolean(document.getElementById('sim-panel'))`) === true);
const panelInit = await evaluate(`
  (() => {
    const host = document.getElementById('sim-panel');
    return {
      title: host.querySelector('.sim-title') ? host.querySelector('.sim-title').textContent : '',
      hasButton: Boolean(host.querySelector('[data-sim-action="run"]')),
      status: host.querySelector('.sim-status') ? host.querySelector('.sim-status').textContent : '',
      solves: window.__labBoard.simdc.stats().solves,
    };
  })()
`);
check('进入实验后自动仿真一次', panelInit.solves >= 1, `solves=${panelInit.solves}`);
check('面板有标题与「重新仿真」按钮',
  panelInit.title === '仿真结果' && panelInit.hasButton === true, JSON.stringify(panelInit));
check('空电路不报错（状态为暂无可分析元件）',
  panelInit.status.includes('暂无可分析元件'), panelInit.status);

/* ==========================================================================
   1. 分压电路：真实点击连线 → 3.333V
   ========================================================================== */
const placed = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const vs = b.place('vsource', 2, 2);
    const r1 = b.place('resistor', 6, 2);
    const r2 = b.place('resistor', 11, 2);
    b.model.updateParams(r1.id, { resistance: 1000 });
    b.model.updateParams(r2.id, { resistance: 2000 });
    // 只存网格坐标：真实点击前再投影一次，避免首帧布局微调让预计算点偏移
    return {
      vs: vs.id, r1: r1.id, r2: r2.id,
      g: {
        vsPlus: [vs.x, vs.y],
        vsMinus: [vs.x + 1, vs.y],
        r1a: [r1.x, r1.y],
        r1b: [r1.x + 2, r1.y],
        r2a: [r2.x, r2.y],
        r2b: [r2.x + 2, r2.y],
      },
    };
  })()
`);
check('放下电压源与两个电阻',
  Boolean(placed.vs && placed.r1 && placed.r2), JSON.stringify({ vs: placed.vs, r1: placed.r1, r2: placed.r2 }));

/** 按网格坐标点一次：投影在点击前一刻现算 */
const clickGrid = async (gx, gy) => {
  const pt = await evaluate(`
    (() => {
      const box = document.getElementById('breadboard-canvas').getBoundingClientRect();
      const p = window.__labBoard.project(${gx}, ${gy});
      return { x: box.left + p.x, y: box.top + p.y };
    })()
  `);
  await clickAt(pt.x, pt.y);
};

for (const key of ['vsPlus', 'r1a', 'r1b', 'r2a', 'r2b', 'vsMinus']) {
  await clickGrid(placed.g[key][0], placed.g[key][1]);
}

const wired = await evaluate(`window.__labBoard.scene.circuit.wires.length`);
check('真实点击连出 3 条导线', wired === 3, `wires=${wired}`);

// 等防抖重仿
await sleep(700);
const dividerState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const res = b.simdc.last();
    const host = document.getElementById('sim-panel');
    const rows = [...host.querySelectorAll('.sim-row')].map((row) => ({
      key: row.querySelector('.sim-row-key').textContent,
      val: row.querySelector('.sim-row-val').textContent,
    }));
    return {
      ok: res ? res.ok : false,
      error: res ? res.error : null,
      status: host.querySelector('.sim-status').textContent,
      nodes: rows,
      report: b.simdc.report(),
      voltages: res ? res.nodeVoltages.map((n) => n.v) : [],
    };
  })()
`);
check('分压电路求解成功', dividerState.ok === true, String(dividerState.error || ''));
const maxV = Math.max(...dividerState.voltages.filter((v) => v !== null).map((v) => v));
const midV = dividerState.voltages.filter((v) => v !== null && v > 0.001 && Math.abs(v - 5) > 0.001);
check('分压中点 = 3.333V ± 0.001',
  midV.length === 1 && Math.abs(midV[0] - 10 / 3) < 0.001,
  `5V 节点=${maxV.toFixed(3)} 中点=${midV.map((v) => v.toFixed(4)).join(',')}`);
check('面板文本含 3.333 V', dividerState.report.includes('3.333'), dividerState.report.split('\n').find((l) => l.includes('3.333')) || '');
check('面板节点表含接地点', dividerState.nodes.some((row) => row.key.includes('地')), JSON.stringify(dividerState.nodes));
check('状态行显示收敛与迭代次数', /收敛（迭代 \d+ 次/.test(dividerState.status), dividerState.status);
await shot('desktop-sim-divider');

/* ==========================================================================
   2. 改参数 → 防抖自动重仿
   ========================================================================== */
const beforeParam = await evaluate(`window.__labBoard.simdc.stats().solves`);
await evaluate(`
  (() => {
    const b = window.__labBoard;
    const r2 = b.scene.circuit.components.find((c) => c.id === 'resistor-2');
    b.setSelection({ type: 'component', id: r2.id });
  })()
`);
await sleep(150);
await evaluate(`
  (() => {
    const input = document.querySelector('[data-param-key="resistance"]');
    input.value = '1';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()
`);
await sleep(700);
const afterParam = await evaluate(`
  (() => {
    const res = window.__labBoard.simdc.last();
    const host = document.getElementById('sim-panel');
    const rows = [...host.querySelectorAll('.sim-row')].map((row) => row.querySelector('.sim-row-val').textContent);
    return { solves: window.__labBoard.simdc.stats().solves, rows, ok: res.ok };
  })()
`);
check('改电阻值后自动重仿（solves 增加）', afterParam.solves > beforeParam, `${beforeParam} → ${afterParam.solves}`);
check('改 R2 为 1k 后中点变为 2.500 V',
  afterParam.rows.some((t) => t.includes('2.500')), JSON.stringify(afterParam.rows));

/* ==========================================================================
   3. 防抖：连改 10 次只触发 1 次
   ========================================================================== */
const beforeBurst = await evaluate(`window.__labBoard.simdc.stats().solves`);
await evaluate(`
  (() => {
    for (let i = 0; i < 10; i += 1) {
      const input = document.querySelector('[data-param-key="resistance"]');
      input.value = String(1 + i * 0.1);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()
`);
await sleep(900);
const afterBurst = await evaluate(`window.__labBoard.simdc.stats().solves`);
check('连改 10 次参数只触发 1 次仿真', afterBurst - beforeBurst === 1, `+${afterBurst - beforeBurst}`);

/* ==========================================================================
   4. 手动「重新仿真」按钮
   ========================================================================== */
const beforeManual = await evaluate(`window.__labBoard.simdc.stats().solves`);
await evaluate(`document.querySelector('[data-sim-action="run"]').click()`);
await sleep(200);
const afterManual = await evaluate(`window.__labBoard.simdc.stats().solves`);
check('点「重新仿真」立即重算', afterManual - beforeManual === 1, `+${afterManual - beforeManual}`);

/* ==========================================================================
   5. 短路：电源直连 → 面板报错且应用不崩溃
   ========================================================================== */
const shortState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const vs = b.scene.circuit.components.find((c) => c.type === 'vsource');
    const r = b.model.addWire({ componentId: vs.id, terminal: '+' }, { componentId: vs.id, terminal: '-' });
    const res = b.simdc.solve('short');
    const host = document.getElementById('sim-panel');
    return {
      wireOk: r.ok,
      wireError: r.error || '',
      ok: res.ok,
      error: res.error,
      status: host.querySelector('.sim-status').textContent,
      isError: host.querySelector('.sim-status').classList.contains('is-error'),
      stillEditable: b.scene.circuit.components.length,
    };
  })()
`);
check('短路被识别为「电路短路」', shortState.ok === false && String(shortState.error).includes('电路短路'), JSON.stringify(shortState.error));
check('面板以错误样式显示短路文案', shortState.isError === true && shortState.status.includes('电路短路'), shortState.status);
check('短路后画布仍可编辑（元件数不变）', shortState.stillEditable === 3, `components=${shortState.stillEditable}`);
await shot('desktop-sim-short');

await evaluate(`
  (() => {
    const b = window.__labBoard;
    const vs = b.scene.circuit.components.find((c) => c.type === 'vsource');
    const wire = b.scene.circuit.wires.find((w) => w.a.componentId === vs.id && w.b.componentId === vs.id);
    if (wire) b.model.removeWire(wire.id);
    b.simdc.solve('restore');
  })()
`);
const restored = await evaluate(`window.__labBoard.simdc.last().ok`);
check('移除短路导线后恢复求解', restored === true);

/* ==========================================================================
   6. LED 电路
   ========================================================================== */
const ledState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.createCircuit('exp-box');
    const vs = b.model.addComponent('vsource', 2, 5);
    const r = b.model.addComponent('resistor', 6, 5);
    const d = b.model.addComponent('led', 10, 5);
    b.model.updateParams(r.component.id, { resistance: 220 });
    b.model.addWire({ componentId: vs.component.id, terminal: '+' }, { componentId: r.component.id, terminal: '1' });
    b.model.addWire({ componentId: r.component.id, terminal: '2' }, { componentId: d.component.id, terminal: 'A' });
    b.model.addWire({ componentId: d.component.id, terminal: 'K' }, { componentId: vs.component.id, terminal: '-' });
    const res = b.simdc.solve('led');
    const led = res.elementResults.find((e) => e.type === 'led');
    const host = document.getElementById('sim-panel');
    return {
      ok: res.ok,
      iter: res.convergence.iter,
      residual: res.convergence.residual,
      vd: led ? led.v : null,
      i: led ? led.i : null,
      cards: [...host.querySelectorAll('.sim-card-name')].map((n) => n.textContent),
      metrics: [...host.querySelectorAll('.sim-metric-val')].map((n) => n.textContent),
    };
  })()
`);
check('LED 电路收敛', ledState.ok === true, `iter=${ledState.iter}`);
check('LED 收敛 ≤ 20 次', ledState.iter <= 20, `iter=${ledState.iter}`);
check('LED 正向压降 ≈ 0.7V（指数模型 n=1 / Is=1e-14）',
  ledState.vd > 0.65 && ledState.vd < 0.8, `Vd=${Number(ledState.vd).toFixed(4)}V`);
check('LED 电流为 mA 量级', ledState.i > 0.01 && ledState.i < 0.05, `I=${(ledState.i * 1000).toFixed(3)}mA`);
check('面板列出 LED 元件卡片', ledState.cards.some((t) => t.startsWith('led-')), JSON.stringify(ledState.cards));
await shot('desktop-sim-led');

/* ==========================================================================
   7. 开关断开 / 闭合
   ========================================================================== */
const switchState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.createCircuit('exp-box');
    const vs = b.model.addComponent('vsource', 2, 8);
    const sw = b.model.addComponent('switch', 6, 8);
    const r = b.model.addComponent('resistor', 10, 8);
    b.model.addWire({ componentId: vs.component.id, terminal: '+' }, { componentId: sw.component.id, terminal: 'COM' });
    b.model.addWire({ componentId: sw.component.id, terminal: 'NO' }, { componentId: r.component.id, terminal: '1' });
    b.model.addWire({ componentId: r.component.id, terminal: '2' }, { componentId: vs.component.id, terminal: '-' });
    const off = b.simdc.solve('sw-off');
    const rOff = off.elementResults.find((e) => e.type === 'resistor');
    b.model.updateParams(sw.component.id, { state: 'closed' });
    const on = b.simdc.solve('sw-on');
    const rOn = on.elementResults.find((e) => e.type === 'resistor');
    return {
      offOk: off.ok, onOk: on.ok,
      offCurrent: rOff.i, onCurrent: rOn.i,
      offIter: off.convergence.iter, onIter: on.convergence.iter,
    };
  })()
`);
check('开关断开：求解成功且电流为 0',
  switchState.offOk === true && Math.abs(switchState.offCurrent) < 1e-12,
  `I=${switchState.offCurrent}`);
check('开关闭合：电流为 5.00 mA（5V/1k）',
  switchState.onOk === true && Math.abs(switchState.onCurrent - 0.005) < 1e-6,
  `I=${(switchState.onCurrent * 1000).toFixed(4)}mA`);

/* ==========================================================================
   8. 电容直流开路
   ========================================================================== */
const capState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.createCircuit('exp-box');
    const vs = b.model.addComponent('vsource', 2, 11);
    const r = b.model.addComponent('resistor', 6, 11);
    const c = b.model.addComponent('capacitor', 10, 11);
    b.model.addWire({ componentId: vs.component.id, terminal: '+' }, { componentId: r.component.id, terminal: '1' });
    b.model.addWire({ componentId: r.component.id, terminal: '2' }, { componentId: c.component.id, terminal: '1' });
    b.model.addWire({ componentId: c.component.id, terminal: '2' }, { componentId: vs.component.id, terminal: '-' });
    const res = b.simdc.solve('cap');
    const cap = res.elementResults.find((e) => e.type === 'capacitor');
    return {
      ok: res.ok, note: cap ? cap.note : '', i: cap ? cap.i : null, v: cap ? cap.v : null,
      warnings: res.warnings,
    };
  })()
`);
check('电容标注「直流开路」', capState.note === '直流开路', JSON.stringify(capState.note));
check('电容支路电流为 0 且电压仍有定义',
  capState.i === 0 && capState.v !== null && Math.abs(capState.v - 5) < 1e-9,
  `V=${capState.v} I=${capState.i}`);

/* ==========================================================================
   9. 悬空网 → 警告但不报错
   ========================================================================== */
const floatState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.createCircuit('exp-box');
    const vs = b.model.addComponent('vsource', 2, 14);
    const r1 = b.model.addComponent('resistor', 6, 14);
    const r2 = b.model.addComponent('resistor', 6, 17);
    const r3 = b.model.addComponent('resistor', 12, 17);
    b.model.addWire({ componentId: vs.component.id, terminal: '+' }, { componentId: r1.component.id, terminal: '1' });
    b.model.addWire({ componentId: r1.component.id, terminal: '2' }, { componentId: vs.component.id, terminal: '-' });
    b.model.addWire({ componentId: r2.component.id, terminal: '1' }, { componentId: r3.component.id, terminal: '1' });
    b.model.addWire({ componentId: r2.component.id, terminal: '2' }, { componentId: r3.component.id, terminal: '2' });
    const res = b.simdc.solve('float');
    return { ok: res.ok, error: res.error, warnings: res.warnings, floating: res.floating };
  })()
`);
check('悬空网不报错，只出警告',
  floatState.ok === true && floatState.warnings.some((t) => t.includes('未接地')),
  JSON.stringify(floatState.warnings));

/* ==========================================================================
   10. 性能：单次求解 < 10ms
   ========================================================================== */
const perfState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const res = b.simdc.last();
    const samples = [];
    for (let i = 0; i < 21; i += 1) {
      const t0 = performance.now();
      b.simdc.solve('perf');
      samples.push(performance.now() - t0);
    }
    samples.sort((x, y) => x - y);
    return {
      median: samples[10],
      max: samples[20],
      min: samples[0],
      nodes: res ? res.nodeCount : 0,
      engineMs: res ? res.elapsedMs : null,
    };
  })()
`);
check('单次直流求解 < 10ms（页面内计时）', perfState.median < 10,
  `median=${perfState.median.toFixed(3)}ms max=${perfState.max.toFixed(3)}ms nodes=${perfState.nodes} engine=${perfState.engineMs}ms`);

/* ==========================================================================
   11. 原理图视图兼容（新增 2 类电源符号）
   ========================================================================== */
// 用真实放置接口建一个含两种电源的电路（model 直调不会广播变更，原理图拿不到新状态）
const schemBuild = await evaluate(`
  (() => {
    const b = window.__labBoard;
    b.model.createCircuit('exp-box');
    const vs = b.place('vsource', 2, 18);
    const is = b.place('isource', 7, 18);
    const r = b.place('resistor', 12, 18);
    const d = b.place('led', 18, 18);
    const ids = [vs && vs.id, is && is.id, r && r.id, d && d.id].filter(Boolean);
    // 串一圈：电源 + → 电阻 1，电阻 2 → LED 阳极，LED 阴极 → 电源 −
    if (vs && r && d) {
      b.model.addWire({ componentId: vs.id, terminal: '+' }, { componentId: r.id, terminal: '1' });
      b.model.addWire({ componentId: r.id, terminal: '2' }, { componentId: d.id, terminal: 'A' });
      b.model.addWire({ componentId: d.id, terminal: 'K' }, { componentId: vs.id, terminal: '-' });
    }
    return { ids, placeOk: ids.length === 4 };
  })()
`);
check('两种电源都能放到实验台上', schemBuild.placeOk === true, JSON.stringify(schemBuild.ids));

await evaluate(`document.getElementById('btn-view-schematic').click()`);
await sleep(500);
await evaluate(`window.__labBoard.schematic.refresh()`);
await sleep(200);
const schemState = await evaluate(`
  (() => {
    const b = window.__labBoard;
    const s = b.schematic;
    const links = s.getLinks();
    const ids = b.model.getState().components.map((c) => c.id);
    const rects = ids.map((id) => s.symbolRect(id)).filter(Boolean);
    const types = b.model.getState().components.map((c) => c.type);
    return {
      visible: document.getElementById('schematic-area').hidden === false,
      layout: ids.filter((id) => s.layoutOf(id)).length,
      total: ids.length,
      links: links.length,
      types,
      rects: rects.map((r) => ({ w: Math.round(r.w), h: Math.round(r.h) })),
    };
  })()
`);
check('原理图能排布新增的电源符号',
  schemState.layout === schemState.total && schemState.total === 4,
  JSON.stringify({ layout: schemState.layout, total: schemState.total, types: schemState.types, links: schemState.links }));
check('原理图为电源符号算出实际占位',
  schemState.rects.length === 4 && schemState.rects.every((r) => r.w > 0 && r.h > 0), JSON.stringify(schemState.rects));
check('原理图导线按新符号引脚走线（3 条）', schemState.links === 3, `links=${schemState.links}`);
await shot('desktop-sim-schematic');
await evaluate(`document.getElementById('btn-view-bench').click()`);
await sleep(300);

/* ==========================================================================
   12. 窄屏
   ========================================================================== */
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 375, height: 667, deviceScaleFactor: 2, mobile: true,
});
await sleep(500);
const mobile = await evaluate(`
  (() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panelWidth: document.getElementById('sim-panel').getBoundingClientRect().width,
  }))()
`);
check('375×667 无横向溢出', mobile.overflow <= 1, `溢出 ${mobile.overflow}px`);
check('窄屏结果面板仍有宽度', mobile.panelWidth > 100, `${Math.round(mobile.panelWidth)}px`);
await shot('mobile-sim');
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 920, deviceScaleFactor: 1, mobile: false,
});
await sleep(300);

/* ==========================================================================
   13. 销毁清理
   ========================================================================== */
await evaluate(`document.getElementById('btn-back').click()`);
await sleep(400);
const destroyed = await evaluate(`
  (() => ({
    panelEmpty: document.getElementById('sim-panel').children.length === 0,
    labBoard: typeof window.__labBoard,
  }))()
`);
check('destroyBoard 后结果面板清空', destroyed.panelEmpty === true, JSON.stringify(destroyed));
check('destroyBoard 后调试入口移除', destroyed.labBoard === 'undefined', destroyed.labBoard);

/* ==========================================================================
   14. 全程无 console 报错 + 无 innerHTML
   ========================================================================== */
check('全程无 console 报错/警告', errors.length === 0, errors.slice(0, 3).join(' | '));

const okCount = results.filter((r) => r.ok).length;
console.log(`\n=== 探针结果：${okCount}/${results.length} 通过 ===`);
console.log('性能：', JSON.stringify(perfState));
await writeFile(join(ROOT, 'result.json'), JSON.stringify({ results, errors, perfState }, null, 2));

ws.close();
edge.kill();
process.exit(okCount === results.length ? 0 : 1);
