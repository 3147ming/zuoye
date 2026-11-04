/**
 * probe-feel.mjs — 手感与观感专项探针（指令包 17 · 任务 E）
 *
 * 覆盖移交验收的五项：
 *   1) 电平着色（导线按 net 电平上色 / 未驱动标 F / 开关持久化）
 *   2) 数字信号流动点（仅暂态运行中开启，停止即关）
 *   3) 示波器拟真（8×10 分度多级网格 + 荧光笔迹 / 触发标记有像素）
 *   4) 落点预览（合法绿 / 非法红，ghost 真实出现在 scene 上）
 *   5) 触屏命中（端子 12px 半径 + 元件本体仲裁）
 *
 * 运行：node tools/probe/probe-feel.mjs
 * 判定：日志末尾出现 `=== 探针结果：N/M 通过 ===` 即真跑完。
 */

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
    failures.push(`${name}${detail ? ' → ' + detail : ''}`);
    console.log(`FAIL ${name}${detail ? ' → ' + detail : ''}`);
  }
}

const INSTALL = `(() => {
  if (window.__FEEL) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  const q = (s) => document.querySelector(s);
  const canvas = () => q('#breadboard-canvas');
  window.__FEEL = {
    reset() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const m = M();
      const st = m.getState();
      st.wires.slice().forEach((w) => m.removeWire(w.id));
      st.components.slice().forEach((c) => m.removeComponent(c.id));
      m.clearUndo();
      const sc = B().scene;
      sc.wiring = null; sc.ghost = null; sc.pointer = null; sc.pendingFlash = null;
      B().interact.continuousPlace(false);
      B().setSelection(null);
      B().requestRender();
      return true;
    },
    place(type, x, y, params) { return B().place(type, x, y, params); },
    wire(a, at, b, bt) { return B().model.addWire({ componentId: a, terminal: at }, { componentId: b, terminal: bt }); },
    /** 端子屏幕坐标（用与交互层同一个 geometry 出口，避免自己算错） */
    screen(compId, terminal) { return B().geometry.screenTerminal(compId, terminal); },
    /** 真实指针路径：pointermove 到画布 CSS 坐标 */
    pointer(type, sx, sy) {
      const c = canvas();
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: r.left + sx, clientY: r.top + sy,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      return true;
    },
    cursor() { return canvas().style.cursor; },
    /** 静默填一片电阻，用来制造「没有空位」的落点 */
    fillBlock(x0, y0, cols, rows) {
      let n = 0;
      for (let dy = 0; dy < rows; dy += 1) {
        for (let dx = 0; dx < cols; dx += 1) {
          const res = M().addComponent('resistor', x0 + dx * 3, y0 + dy, { silent: true });
          if (res && res.ok) n += 1;
        }
      }
      B().requestRender();
      return n;
    },
    bodyCenter(compId) {
      const c = M().findComponent(compId);
      const maxDx = c.terminals.reduce((m2, t) => Math.max(m2, t.dx), 0);
      const maxDy = c.terminals.reduce((m2, t) => Math.max(m2, t.dy), 0);
      // 端子只给出轮廓，本体中心再往下半格（元件有厚度）
      return B().project(c.x + maxDx / 2, c.y + maxDy + 0.5);
    },
    pick(sx, sy) { return B().pick(sx, sy); },
    /** 走真实指针路径：pointermove 到画布坐标，返回画布光标（crosshair / move / pointer） */
    hoverAt(sx, sy) {
      const c = canvas();
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, composed: true,
        clientX: r.left + sx, clientY: r.top + sy,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      return { cursor: c.style.cursor, hover: B().scene.hover, pick: B().pick(sx, sy) };
    },
    /** 在两端子连线附近扫一遍，找第一个光标为 move 的落点（等价于"抓住元件本体"） */
    probeBody(compId, termA, termB) {
      const a = B().geometry.screenTerminal(compId, termA);
      const b = B().geometry.screenTerminal(compId, termB);
      const c = canvas();
      const r = c.getBoundingClientRect();
      for (const k of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const dy of [0, 4, 8]) {
          const sx = a.x + (b.x - a.x) * k;
          const sy = a.y + (b.y - a.y) * k + dy;
          c.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, cancelable: true, composed: true,
            clientX: r.left + sx, clientY: r.top + sy,
            pointerId: 1, button: 0, buttons: 1, isPrimary: true,
          }));
          if (c.style.cursor === 'move') return { cursor: 'move', sx, sy, k, dy };
        }
      }
      return { cursor: c.style.cursor || '', sx: null, sy: null };
    },
    /** 把示波器 CH1 挂到某元件的端子上，并跑一次暂态 */
    scopeProbe(compId, terminal) {
      const st = M().getState();
      const nl = M().getNetlist();
      const net = nl.netOf.get('c:' + compId + ':' + terminal);
      if (!net) return null;
      B().instruments.setProbe('ch1', net);
      B().simtrans.solve({ duration: 0.004, dt: 2e-6 });
      void st;
      return net;
    },
    levels: {
      on: () => B().levels.on(),
      set: (on) => B().levels.set(on),
      map: () => B().levels.map(),
      flow: () => B().levels.flow(),
    },
    setSwitch(id, state) { return M().updateParams(id, { state }); },
    simulate() { B().simdig.solve('probe-feel'); return B().simdig.last(); },
    transientStart() { return B().simtrans.start({ duration: 0.3, dt: 2e-6 }); },
    transientStop() { return B().simtrans.stop(); },
    scopeReady() { return Boolean(q('.inst-scope-canvas')); },
    selectTab(id) { const b = q('.inst-tab[data-tab="' + id + '"]'); if (!b) return false; b.click(); return true; },
    /** 示波器画布统计：不同亮度档数 + 是否存在暖色（黄）像素 */
    scopeStats() {
      const c = q('.inst-scope-canvas');
      if (!c) return null;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const luma = new Set();
      let warm = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        luma.add(Math.round((r + g + b) / 24));
        if (r > g + 12 && g > b) warm += 1;
      }
      return { width: c.width, height: c.height, lumaTiers: luma.size, warm };
    },
    /** 从元件库拖拽：pointerdown 在库项上，pointermove 到画布 */
    dragFromPalette(type, gx, gy) {
      const item = q('.palette-item[data-part-type="' + type + '"]');
      if (!item) return { ok: false, error: 'no palette item' };
      const r = item.getBoundingClientRect();
      item.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      const c = canvas();
      const rect = c.getBoundingClientRect();
      const p = B().project(gx, gy);
      c.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true,
        clientX: rect.left + p.x, clientY: rect.top + p.y,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      const g = B().scene.ghost;
      return g ? { ok: true, type: g.type, valid: g.valid, x: g.x, y: g.y } : { ok: false };
    },
    dragEnd() {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, buttons: 0, isPrimary: true }));
      B().scene.ghost = null;
      B().requestRender();
      return true;
    },
    levelStored() { try { return localStorage.getItem('lab-sim:level-color'); } catch (_) { return null; } },
    overflow() {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, bad: d.scrollWidth > d.clientWidth + 1 };
    },
  };
  return true;
})()`;

async function run() {
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
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard && window.__labBoard.levels)'), 12000, 'board');
    await evalJs(cdp, INSTALL);
    await sleep(300);

    /* ---- 1. 电平着色 ---- */
    {
      await evalJs(cdp, '__FEEL.reset()');
      const sw = await evalJs(cdp, `__FEEL.place('logic-switch', 4, 4)`);
      const r = await evalJs(cdp, `__FEEL.place('resistor', 8, 4)`);
      await evalJs(cdp, `__FEEL.wire('${sw.id}', 'OUT', '${r.id}', '1')`);
      await evalJs(cdp, '__FEEL.simulate()');
      await sleep(160);

      check('E1 电平着色默认开启', (await evalJs(cdp, '__FEEL.levels.on()')) === true);
      const map = await evalJs(cdp, '__FEEL.levels.map()');
      check('E1 仿真后每条导线都有电平映射', map.length === 1, JSON.stringify(map));
      check('E1 逻辑开关默认低电平 → 导线 level=0', map[0] && map[0].level === 0, JSON.stringify(map[0]));

      await evalJs(cdp, `__FEEL.setSwitch('${sw.id}', 'hi')`);
      await evalJs(cdp, '__FEEL.simulate()');
      await sleep(160);
      const hi = await evalJs(cdp, '__FEEL.levels.map()');
      check('E1 拨到高电平 → 导线 level=1', hi[0] && hi[0].level === 1, JSON.stringify(hi[0]));

      // 未驱动 net（两个电阻互连，没有数字源）应标 F
      const r2 = await evalJs(cdp, `__FEEL.place('resistor', 12, 4)`);
      await evalJs(cdp, `__FEEL.wire('${r.id}', '2', '${r2.id}', '1')`);
      await evalJs(cdp, '__FEEL.simulate()');
      await sleep(160);
      const two = await evalJs(cdp, '__FEEL.levels.map()');
      const undriven = two.find((item) => item.level === 'F');
      check('E1 没有数字驱动的 net 标为 F（未驱动）', Boolean(undriven), JSON.stringify(two));

      await evalJs(cdp, `document.getElementById('btn-levels').click()`);
      await sleep(140);
      check('E1 工具栏「电平」按钮可关闭着色', (await evalJs(cdp, '__FEEL.levels.on()')) === false);
      check('E1 着色偏好写入 localStorage', (await evalJs(cdp, '__FEEL.levelStored()')) === '0');
      await evalJs(cdp, `document.getElementById('btn-levels').click()`);
      await sleep(140);
      check('E1 再点恢复开启', (await evalJs(cdp, '__FEEL.levels.on()')) === true);
    }

    /* ---- 2. 流动点 ---- */
    let r0 = null;
    {
      await evalJs(cdp, '__FEEL.reset()');
      const v = await evalJs(cdp, `__FEEL.place('vsource', 2, 2)`);
      const r = await evalJs(cdp, `__FEEL.place('resistor', 6, 2)`);
      r0 = r.id;
      await evalJs(cdp, `__FEEL.wire('${v.id}', '+', '${r.id}', '1')`);
      await evalJs(cdp, `__FEEL.wire('${r.id}', '2', '${v.id}', '-')`);
      await evalJs(cdp, '__FEEL.simulate()');
      await evalJs(cdp, '__FEEL.transientStart()');
      await sleep(220);
      const on = await evalJs(cdp, '__FEEL.levels.flow()');
      check('E2 暂态运行中流动点开启', Boolean(on && on.on === true), JSON.stringify(on));
      await evalJs(cdp, '__FEEL.transientStop()');
      await sleep(200);
      const off = await evalJs(cdp, '__FEEL.levels.flow()');
      check('E2 停止暂态后流动点关闭', Boolean(off && off.on === false), JSON.stringify(off));
    }

    /* ---- 3. 示波器拟真 ---- */
    {
      // 分压到 2.5V 再挂 CH1：5V 直连会超出 4 格屏高被裁掉，看不到轨迹
      await evalJs(cdp, '__FEEL.reset()');
      const v = await evalJs(cdp, `__FEEL.place('vsource', 2, 2)`);
      const ra = await evalJs(cdp, `__FEEL.place('resistor', 6, 2)`);
      const rb = await evalJs(cdp, `__FEEL.place('resistor', 10, 2)`);
      await evalJs(cdp, `__FEEL.wire('${v.id}', '+', '${ra.id}', '1')`);
      await evalJs(cdp, `__FEEL.wire('${ra.id}', '2', '${rb.id}', '1')`);
      await evalJs(cdp, `__FEEL.wire('${rb.id}', '2', '${v.id}', '-')`);
      const net = await evalJs(cdp, `__FEEL.scopeProbe('${ra.id}', '2')`);
      await sleep(220);
      await evalJs(cdp, '__FEEL.selectTab("scope")');
      await sleep(320);
      check('E3 示波器画布存在', (await evalJs(cdp, '__FEEL.scopeReady()')) === true);
      const stats = await evalJs(cdp, '__FEEL.scopeStats()');
      check('E3 8×10 分度多级网格（≥3 档亮度）',
        Boolean(stats) && stats.lumaTiers >= 3, JSON.stringify(stats));
      check('E3 CH1 轨迹有暖色像素（中点是 2.5V，落在屏内）',
        Boolean(stats) && stats.warm > 0, `net=${net} ${JSON.stringify(stats)}`);
    }

    /* ---- 4. 落点预览 ---- */
    {
      await evalJs(cdp, '__FEEL.reset()');
      const okGhost = await evalJs(cdp, '__FEEL.dragFromPalette("resistor", 20, 12)');
      check('E4 拖拽时出现 ghost 预览', Boolean(okGhost && okGhost.ok), JSON.stringify(okGhost));
      check('E4 空位落点 ghost 判为合法', Boolean(okGhost && okGhost.valid === true), JSON.stringify(okGhost));
      await evalJs(cdp, '__FEEL.dragEnd()');
      // 填满一片区域，吸附半径 2 内都没有空位 → ghost 必须判非法
      const filled = await evalJs(cdp, '__FEEL.fillBlock(21, 9, 5, 9)');
      const badGhost = await evalJs(cdp, '__FEEL.dragFromPalette("resistor", 30, 13)');
      check('E4 无可用空位时 ghost 判为非法',
        Boolean(badGhost && badGhost.ok && badGhost.valid === false),
        `filled=${filled} ${JSON.stringify(badGhost)}`);
      await evalJs(cdp, '__FEEL.dragEnd()');
    }

    /* ---- 5. 触屏命中 ---- */
    {
      await evalJs(cdp, '__FEEL.reset()');
      const r = await evalJs(cdp, `__FEEL.place('resistor', 4, 4)`);
      const t = await evalJs(cdp, `__FEEL.screen('${r.id}', '1')`);
      const near = await evalJs(cdp, `__FEEL.hoverAt(${t.x + 10}, ${t.y})`);
      check('E5 距端子 10px 仍命中端子（半径 ≥12px）',
        Boolean(near && near.cursor === 'crosshair'), JSON.stringify(near));
      const bodyCursor = await evalJs(cdp, `__FEEL.probeBody('${r.id}', '1', '2')`);
      check('E5 本体中心判为元件（引脚不吃掉整块本体）',
        Boolean(bodyCursor && bodyCursor.cursor === 'move'), JSON.stringify(bodyCursor));
      const far = await evalJs(cdp, `__FEEL.hoverAt(${t.x + 60}, ${t.y + 60})`);
      check('E5 远离元件处不再误判端子',
        Boolean(far && far.cursor !== 'crosshair'), JSON.stringify(far));
    }

    /* ---- 6. 布局与 console ---- */
    {
      const sizes = [[1440, 900], [1024, 768], [375, 667]];
      const bad = [];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(200);
        const o = await evalJs(cdp, '__FEEL.overflow()');
        if (o.bad) bad.push(`${w}x${h}:${o.scrollW}/${o.clientW}`);
      }
      check('E6 三档分辨率无横向溢出', bad.length === 0, bad.join(','));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    check('E6 console 无报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('E 探针执行无异常', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
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
