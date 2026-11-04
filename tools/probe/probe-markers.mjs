/**
 * probe-markers.mjs — 画布可拖拽探针标记（包 15 遗留建议 2）无头 Edge + CDP 探针
 *
 * 覆盖：4 枚标记 / 拖放挂点 / 下拉联动 / 真实指针事件拖拽 / 移除 / 显隐 /
 * 网格坐标存档往返 / 缩放重投影 / 六档分辨率无横向溢出 / console 0。
 */

import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep, waitFor } = await import('./runB.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_URL = 'http://127.0.0.1:5360/';

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`OK   ${name}`); }
  else {
    fail += 1;
    failures.push(`${name}${detail ? ' -> ' + detail : ''}`);
    console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

const INSTALL = `(() => {
  if (window.__PM) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  const PM = () => B().probeMarkers;
  window.__PM = {
    reset() {
      const m = M();
      const st = m.getState();
      st.wires.slice().forEach((w) => m.removeWire(w.id));
      st.components.slice().forEach((c) => m.removeComponent(c.id));
      m.clearUndo();
      B().setSelection(null);
      ['dmm', 'dmmB', 'ch1', 'ch2'].forEach((s) => PM().remove(s));
      B().instruments.setDmm({ mode: 'volt', netId: null, netB: null, componentId: null });
      B().instruments.setScope({ ch1: null, ch2: null });
      B().requestRender();
      return true;
    },
    place(type, x, y, params) {
      const r = M().addComponent(type, x, y, params ? { params } : undefined);
      if (!r.ok) return { ok: false, error: r.error };
      B().requestRender();
      return { ok: true, id: r.component.id };
    },
    wire(a, ta, b, tb) {
      const r = M().addWire({ componentId: a, terminal: ta }, { componentId: b, terminal: tb });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    net(comp, pin) { return M().getNetlist().netOf.get('c:' + comp + ':' + pin) || null; },
    screen(comp, pin) { return B().geometry.screenTerminal(comp, pin); },
    list() { return PM().list(); },
    drag(slot, x, y) { return PM().drag(slot, x, y); },
    remove(slot) { return PM().remove(slot); },
    visible(on) { return PM().setVisible(on); },
    snapshot() { return B().instruments.snapshot(); },
    restore(data) { B().instruments.restore(data); return PM().list(); },
    dmmNet() { return B().instruments.snapshot().dmm.netId; },
    scopeCh1() { return B().instruments.snapshot().scope.ch1; },
    setDmmNet(netId) { return B().instruments.setDmm({ netId }); },
    markerCount() { return document.querySelectorAll('.probe-marker').length; },
    layerHidden() {
      const el = document.querySelector('.probe-layer');
      return el ? el.classList.contains('is-hidden') : null;
    },
    markerBox(slot) {
      const el = document.querySelector('.probe-marker[data-slot="' + slot + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const h = document.getElementById('canvas-area').getBoundingClientRect();
      return { cx: r.left - h.left + r.width / 2, bottom: r.top - h.top + r.height,
               centerX: r.left + r.width / 2, centerY: r.top + r.height / 2 };
    },
    canvasRect() {
      const r = document.getElementById('canvas-area').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    },
    zoomIn() { B().zoom.in(); },
    zoomReset() { B().zoom.reset(); },
    project(gx, gy) { return B().project(gx, gy); },
    overflow() {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, bad: d.scrollWidth > d.clientWidth + 1 };
    },
  };
  return true;
})()`;

async function run() {
  mkdir(join(ROOT, 'labsim15b'), { recursive: true }).catch(() => {});
  await ensureServer();
  let edgeProc = null;

  try {
    const boot = await bootEdge();
    const { cdp } = boot;
    edgeProc = boot.edge;

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : String(a.description || a.type || ''))).join(' ');
      if (p.type === 'error' || p.type === 'assert') consoleErrors.push(text);
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      consoleErrors.push(d.exception && d.exception.description ? d.exception.description : (d.text || 'uncaught'));
    });
    cdp.on('Log.entryAdded', (p) => { if ((p.entry || {}).level === 'error') consoleErrors.push((p.entry || {}).text || 'log-error'); });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: APP_URL });
    await loaded;
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labSimReady)'), 12000, 'app');
    await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (!c) return false; c.click(); return true; })()`);
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard && window.__labBoard.probeMarkers)'), 12000, 'board+markers');
    await evalJs(cdp, INSTALL);

    /* ---- 1. 初始结构 ---- */
    {
      const count = await evalJs(cdp, '__PM.markerCount()');
      check('PM 画布生成 4 枚探针标记', count === 4, String(count));
      const list = await evalJs(cdp, '__PM.list()');
      check('PM 四个槽位齐全',
        ['dmm', 'dmmB', 'ch1', 'ch2'].every((s) => list.some((p) => p.slot === s)),
        JSON.stringify(list.map((p) => p.slot)));
      check('PM 初始全部停靠托盘且未挂测点',
        list.every((p) => p.docked === true && p.netId === null), JSON.stringify(list));
      const hidden = await evalJs(cdp, '__PM.layerHidden()');
      check('PM 标记层默认可见', hidden === false, String(hidden));
    }

    /* ---- 2. 拖放挂点 ---- */
    await evalJs(cdp, '__PM.reset()');
    const vs = (await evalJs(cdp, `__PM.place('vsource', 2, 2, { voltage: 5 })`)).id;
    const r1 = (await evalJs(cdp, `__PM.place('resistor', 6, 2, { resistance: 1000 })`)).id;
    const r2 = (await evalJs(cdp, `__PM.place('resistor', 10, 2, { resistance: 1000 })`)).id;
    await evalJs(cdp, `__PM.wire('${vs}','+','${r1}','1')`);
    await evalJs(cdp, `__PM.wire('${r1}','2','${r2}','1')`);
    await evalJs(cdp, `__PM.wire('${r2}','2','${vs}','-')`);
    await sleep(220);
    const mid = await evalJs(cdp, `__PM.net('${r1}','2')`);
    const vcc = await evalJs(cdp, `__PM.net('${vs}','+')`);
    const gnd = await evalJs(cdp, `__PM.net('${vs}','-')`);
    check('PM 分压电路三个网互不相同',
      Boolean(mid && vcc && gnd) && new Set([mid, vcc, gnd]).size === 3,
      `${mid}/${vcc}/${gnd}`);

    const midPos = await evalJs(cdp, `__PM.screen('${r1}','2')`);
    const drop = await evalJs(cdp, `__PM.drag('dmm', ${midPos.x}, ${midPos.y})`);
    check('PM 拖放命中端子并挂上测点',
      drop.ok === true && drop.netId === mid, JSON.stringify(drop));
    const dmmNet = await evalJs(cdp, '__PM.dmmNet()');
    check('PM 拖放与下拉共用同一份测点状态', dmmNet === mid, String(dmmNet));

    let list = await evalJs(cdp, '__PM.list()');
    const dmm = list.find((p) => p.slot === 'dmm');
    check('PM 标记显示 netId 且脱离托盘',
      dmm && dmm.netId === mid && dmm.docked === false, JSON.stringify(dmm));
    check('PM 标记位置记为网格坐标',
      dmm && Number.isFinite(dmm.gx) && Number.isFinite(dmm.gy), JSON.stringify(dmm));

    /* ---- 3. 与下拉联动 ---- */
    await evalJs(cdp, `__PM.setDmmNet('${vcc}')`);
    list = await evalJs(cdp, '__PM.list()');
    const dmm2 = list.find((p) => p.slot === 'dmm');
    check('PM 下拉改测点后标记自动同步',
      dmm2 && dmm2.netId === vcc && dmm2.docked === false, JSON.stringify(dmm2));

    const gndPos = await evalJs(cdp, `__PM.screen('${vs}','-')`);
    const drop2 = await evalJs(cdp, `__PM.drag('dmm', ${gndPos.x}, ${gndPos.y})`);
    check('PM 再拖到另一网络会换测点',
      drop2.ok === true && drop2.netId === gnd && (await evalJs(cdp, '__PM.dmmNet()')) === gnd,
      JSON.stringify(drop2));

    /* ---- 4. 真实指针事件拖拽（CDP 鼠标） ---- */
    {
      const box = await evalJs(cdp, `__PM.markerBox('ch1')`);
      const rect = await evalJs(cdp, '__PM.canvasRect()');
      const target = await evalJs(cdp, `__PM.screen('${r1}','1')`);
      const tx = rect.left + target.x;
      const ty = rect.top + target.y;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.centerX, y: box.centerY, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (box.centerX + tx) / 2, y: (box.centerY + ty) / 2, button: 'left', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty, button: 'left', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
      await sleep(160);
      const ch1 = await evalJs(cdp, '__PM.scopeCh1()');
      check('PM 真实鼠标拖拽挂上 CH1', ch1 === vcc, `${ch1} / expect ${vcc}`);
      const ch1State = (await evalJs(cdp, '__PM.list()')).find((p) => p.slot === 'ch1');
      check('PM 拖拽后 CH1 标记处于已挂状态',
        ch1State && ch1State.netId === vcc && ch1State.docked === false, JSON.stringify(ch1State));
    }

    /* ---- 5. 对齐 / 缩放跟随 ---- */
    {
      const dmmState = (await evalJs(cdp, '__PM.list()')).find((p) => p.slot === 'dmm');
      const p = await evalJs(cdp, `__PM.project(${dmmState.gx}, ${dmmState.gy})`);
      const box = await evalJs(cdp, `__PM.markerBox('dmm')`);
      check('PM 标记尖端对准被测网格点',
        Math.abs(box.cx - p.x) < 3 && Math.abs(box.bottom - p.y) < 3,
        `box=${JSON.stringify(box)} p=${JSON.stringify(p)}`);

      const before = box.cx;
      await evalJs(cdp, '__PM.zoomIn()');
      await sleep(220);
      const after = await evalJs(cdp, `__PM.markerBox('dmm')`);
      const p2 = await evalJs(cdp, `__PM.project(${dmmState.gx}, ${dmmState.gy})`);
      check('PM 缩放后标记重投影不漂移',
        Math.abs(after.cx - p2.x) < 3 && Math.abs(after.bottom - p2.y) < 3,
        `after=${JSON.stringify(after)} p2=${JSON.stringify(p2)}`);
      check('PM 缩放确实改变了标记屏幕位置', Math.abs(after.cx - before) > 1, `${before} → ${after.cx}`);
      await evalJs(cdp, '__PM.zoomReset()');
    }

    /* ---- 6. 移除 / 显隐 ---- */
    {
      await evalJs(cdp, `__PM.remove('dmm')`);
      const after = (await evalJs(cdp, '__PM.list()')).find((p) => p.slot === 'dmm');
      check('PM 移除测点后回到托盘',
        (await evalJs(cdp, '__PM.dmmNet()')) === null && after.netId === null && after.docked === true,
        JSON.stringify(after));

      await evalJs(cdp, '__PM.visible(false)');
      check('PM 关闭开关隐藏标记层', (await evalJs(cdp, '__PM.layerHidden()')) === true);
      await evalJs(cdp, '__PM.visible(true)');
      check('PM 打开开关恢复标记层', (await evalJs(cdp, '__PM.layerHidden()')) === false);
    }

    /* ---- 7. 存档往返 ---- */
    {
      const pos = await evalJs(cdp, `__PM.screen('${r1}','2')`);
      await evalJs(cdp, `__PM.drag('dmm', ${pos.x}, ${pos.y})`);
      const snap = await evalJs(cdp, '__PM.snapshot()');
      const saved = snap.markers && snap.markers.dmm;
      check('PM 标记位置写进仪器快照',
        Boolean(saved) && Number.isFinite(saved.gx) && Number.isFinite(saved.gy),
        JSON.stringify(snap.markers));
      await evalJs(cdp, `__PM.remove('dmm')`);
      const restored = await evalJs(cdp, `__PM.restore(${JSON.stringify(snap)})`);
      const dmmR = restored.find((p) => p.slot === 'dmm');
      check('PM 存档恢复后测点与坐标都回来',
        (await evalJs(cdp, '__PM.dmmNet()')) === mid && dmmR && Math.abs(dmmR.gx - saved.gx) < 1e-6,
        JSON.stringify(dmmR));
    }

    /* ---- 8. 布局与 console ---- */
    {
      const sizes = [[1440, 900], [1024, 768], [375, 667]];
      let bad = [];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(180);
        const o = await evalJs(cdp, '__PM.overflow()');
        if (o.bad) bad.push(`${w}x${h}:${o.scrollW}/${o.clientW}`);
      }
      check('PM 三档分辨率无横向溢出', bad.length === 0, bad.join(','));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    check('PM console 无报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('PM 探针执行无异常', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
  } finally {
    if (edgeProc) { try { edgeProc.kill(); } catch (_) { /* 忽略 */ } }
  }

  console.log('');
  if (failures.length > 0) {
    console.log('未通过项：');
    failures.forEach((f) => console.log(`  × ${f}`));
  }
  console.log(`=== 探针结果：${pass}/${pass + fail} 通过 ===`);
  if (fail > 0) process.exitCode = 1;
}

await run();
