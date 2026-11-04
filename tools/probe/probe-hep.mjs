/**
 * probe-hep.mjs — HEP-DCTS-01 实物外观复刻专项探针（无头 Edge + CDP）
 *
 * 覆盖：默认皮肤 / 写实 canvas 像素 / 工具栏切换 / localStorage 偏好 /
 * 面包板隔离 / 6 模块结构 / 模块元件行为（逻辑开关→重仿→数码管） /
 * SIGLENT SDS 1102CNL 与 UTG9005A 前面板 / 既有探针契约未破坏 /
 * 三档分辨率无横向溢出 / console 0 / 平台 id 未新增。
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
  if (window.__HEP) return true;
  const B = () => window.__labBoard;
  window.__HEP = {
    info() {
      const b = B();
      return { skin: b.skin, platformId: b.platformId,
               hepPanel: Boolean(b.hepPanel), probeMarkers: Boolean(b.probeMarkers),
               instruments: Boolean(b.instruments) };
    },
    layer() {
      const el = document.querySelector('.hep-panel-layer');
      return el ? { exists: true, hidden: el.hidden, cards: el.querySelectorAll('.hep-module-card').length }
                : { exists: false, hidden: null, cards: 0 };
    },
    modules() { return B().hepPanel ? B().hepPanel.list() : []; },
    setSkin(id) { return B().setSkin(id); },
    switchPlatform(id) { return B().switchPlatform(id); },
    clickSkinBtn() { const b = document.getElementById('btn-skin'); if (!b) return false; b.click(); return true; },
    skinBtn() {
      const b = document.getElementById('btn-skin');
      return b ? { exists: true, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled }
               : { exists: false };
    },
    storedSkin() { try { return localStorage.getItem('lab-sim:skin'); } catch (_) { return null; } },
    /** 电路存档是 500ms 防抖写入；优先读当前实验的键，避免命中历史残留键 */
    savedData() {
      try {
        const expId = B().expId;
        const keys = Object.keys(localStorage).filter((k) => k.indexOf('lab-sim-circuit-') === 0);
        const key = (expId && keys.indexOf('lab-sim-circuit-' + expId) >= 0)
          ? 'lab-sim-circuit-' + expId
          : keys[0];
        if (!key) return null;
        const d = JSON.parse(localStorage.getItem(key));
        if (!d || typeof d !== 'object') return null;
        return { platform: d.platform || null, hasSkin: Object.prototype.hasOwnProperty.call(d, 'skin'), version: d.version || null };
      } catch (_) { return null; }
    },
    savedPlatform() {
      const d = window.__HEP.savedData();
      return d ? d.platform : null;
    },
    /** 平台层写实绘制生效与否：蓝色主板区应明显偏蓝（b - r 大） */
    pixel() {
      const b = B();
      const c = document.getElementById('breadboard-canvas');
      const ctx = c.getContext('2d');
      const dpr = b.view.dpr;
      const pts = [[18, 4.6], [19.5, 4.8], [30, 3.4], [6, 10.5], [27, 12]];
      let r = 0, g = 0, bl = 0, n = 0;
      pts.forEach(([gx, gy]) => {
        const p = b.project(gx, gy);
        const x = Math.max(0, Math.min(c.width - 3, Math.round(p.x * dpr) - 2));
        const y = Math.max(0, Math.min(c.height - 3, Math.round(p.y * dpr) - 2));
        const d = ctx.getImageData(x, y, 3, 3).data;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n += 1; }
      });
      return { r: r / n, g: g / n, b: bl / n, blue: (bl - r) / n };
    },
    selectTab(id) {
      const btn = document.querySelector('.inst-tab[data-tab="' + id + '"]');
      if (!btn) return false;
      btn.click();
      return true;
    },
    faces() {
      const s = document.querySelector('.hep-scope-face');
      const f = document.querySelector('.hep-fgen-face');
      return {
        scope: s ? s.textContent : null,
        fgen: f ? f.textContent : null,
        scopeCanvas: Boolean(document.querySelector('.inst-scope-canvas')),
        bezel: Boolean(document.querySelector('.hep-scope-bezel')),
        measure: Boolean(document.querySelector('.inst-measure')),
      };
    },
    placeSwitches(n) {
      const b = B();
      const m = b.model;
      const platform = b.platforms.getPlatform(b.platformId);
      let placed = 0;
      for (let y = 1; y < platform.rows - 2 && placed < n; y += 2) {
        for (let x = 1; x < platform.cols - 2 && placed < n; x += 2) {
          const r = m.addComponent('logic-switch', x, y, { silent: true });
          if (r && r.ok) placed += 1;
        }
      }
      b.simdc.solve('probe-hep');
      b.requestRender();
      return placed;
    },
    switchStates() {
      return B().model.getState().components
        .filter((c) => c.type === 'logic-switch')
        .map((c) => ({ id: c.id, state: c.params && c.params.state }));
    },
    bitCount() { return document.querySelectorAll('.hep-module-card--switches .hep-bit').length; },
    clickBit(index) {
      const bits = document.querySelectorAll('.hep-module-card--switches .hep-bit');
      if (!bits[index]) return false;
      bits[index].click();
      return true;
    },
    digit() {
      const d = document.querySelector('.hep-seven-seg');
      return d ? d.textContent.trim() : null;
    },
    pulseButtons() {
      return {
        pulse: document.querySelectorAll('.hep-module-card--pulse .hep-btn').length,
        freq: document.querySelectorAll('.hep-freq-row .hep-btn').length,
      };
    },
    overflow() {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, bad: d.scrollWidth > d.clientWidth + 1 };
    },
  };
  return true;
})()`;

/** 电路存档由 scheduleSave() 防抖 500ms 落盘，轮询等它真正写入（超时返回 null，不抛异常） */
async function waitSavedPlatform(cdp, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = await evalJs(cdp, '__HEP.savedPlatform()');
    if (v) return v;
    await sleep(120);
  }
  return null;
}

async function run() {
  mkdir(join(ROOT, 'labsim16'), { recursive: true }).catch(() => {});
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
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard && window.__labBoard.hepPanel)'), 12000, 'board+hepPanel');
    await evalJs(cdp, INSTALL);
    await sleep(260);

    /* ---- 1. 默认状态 ---- */
    {
      const info = await evalJs(cdp, '__HEP.info()');
      check('HEP 默认皮肤为 hep（实物外观）', info.skin === 'hep', JSON.stringify(info));
      check('HEP 平台 id 仍是 exp-box（未新增平台）', info.platformId === 'exp-box', String(info.platformId));
      check('HEP hepPanel 与 probeMarkers 共存', info.hepPanel === true && info.probeMarkers === true, JSON.stringify(info));
      const layer = await evalJs(cdp, '__HEP.layer()');
      check('HEP 生成 6 张模块卡片且默认可见',
        layer.exists === true && layer.hidden === false && layer.cards === 6, JSON.stringify(layer));
      const btn = await evalJs(cdp, '__HEP.skinBtn()');
      check('HEP 工具栏「实物外观」按钮存在且按下', btn.exists === true && btn.pressed === 'true', JSON.stringify(btn));
    }

    /* ---- 2. 写实 canvas 平台层真的生效 ---- */
    {
      const hepPx = await evalJs(cdp, '__HEP.pixel()');
      check('HEP 皮肤下平台层为蓝色主板（b-r 显著为正）', hepPx.blue > 30, JSON.stringify(hepPx));
      await evalJs(cdp, `__HEP.setSkin('classic')`);
      await sleep(220);
      const classicPx = await evalJs(cdp, '__HEP.pixel()');
      check('HEP 切回通用实验箱后不再是蓝色主板', classicPx.blue < hepPx.blue - 20, JSON.stringify(classicPx));
      check('HEP localStorage 记录 classic 偏好', (await evalJs(cdp, '__HEP.storedSkin()')) === 'classic');
      await evalJs(cdp, `__HEP.setSkin('hep')`);
      await sleep(220);
      const backPx = await evalJs(cdp, '__HEP.pixel()');
      check('HEP 切回实物外观后蓝色主板恢复', backPx.blue > 30, JSON.stringify(backPx));
    }

    /* ---- 3. 工具栏按钮联动 ---- */
    {
      await evalJs(cdp, '__HEP.clickSkinBtn()');
      await sleep(180);
      const info = await evalJs(cdp, '__HEP.info()');
      const btn = await evalJs(cdp, '__HEP.skinBtn()');
      check('HEP 点工具栏按钮切到 classic', info.skin === 'classic', JSON.stringify(info));
      check('HEP 按钮 aria-pressed 同步为 false', btn.pressed === 'false', JSON.stringify(btn));
      const layer = await evalJs(cdp, '__HEP.layer()');
      check('HEP classic 下模块面板自动隐藏', layer.hidden === true, JSON.stringify(layer));
      await evalJs(cdp, '__HEP.clickSkinBtn()');
      await sleep(180);
      check('HEP 再点按钮切回 hep', (await evalJs(cdp, '__HEP.info()')).skin === 'hep');
      check('HEP 模块面板恢复可见', (await evalJs(cdp, '__HEP.layer()')).hidden === false);
    }

    /* ---- 4. 两台真实仪器前面板 ---- */
    {
      await evalJs(cdp, `__HEP.selectTab('scope')`);
      await sleep(160);
      const f = await evalJs(cdp, '__HEP.faces()');
      check('HEP 示波器 tab 出现 SIGLENT SDS 1102CNL 前面板',
        Boolean(f.scope) && f.scope.indexOf('SDS 1102CNL') >= 0 && f.scope.indexOf('100MHz') >= 0,
        String(f.scope).slice(0, 90));
      check('HEP 示波器屏幕外框保留 .inst-scope-canvas', f.scopeCanvas === true && f.bezel === true, JSON.stringify(f));
      check('HEP 示波器 .inst-measure 契约未破坏', f.measure === true, JSON.stringify(f));
      await evalJs(cdp, `__HEP.selectTab('fgen')`);
      await sleep(160);
      const f2 = await evalJs(cdp, '__HEP.faces()');
      check('HEP 函数发生 tab 出现 UTG9005A 前面板',
        Boolean(f2.fgen) && f2.fgen.indexOf('UTG9005A') >= 0 && f2.fgen.indexOf('5MHz') >= 0,
        String(f2.fgen).slice(0, 90));
      await evalJs(cdp, `__HEP.setSkin('classic')`);
      await sleep(160);
      const f3 = await evalJs(cdp, '__HEP.faces()');
      check('HEP classic 下真实仪器装饰层消失', f3.fgen === null, JSON.stringify(f3));
      await evalJs(cdp, `__HEP.setSkin('hep')`);
      await sleep(160);
      check('HEP 切回 hep 前面板恢复', (await evalJs(cdp, '__HEP.faces()')).fgen !== null);
    }

    /* ---- 5. 6 模块结构 ---- */
    {
      const mods = await evalJs(cdp, '__HEP.modules()');
      const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
      check('HEP 6 模块 id 齐全', ids.every((id) => mods.some((m) => m.id === id)), JSON.stringify(mods.map((m) => m.id)));
      check('HEP 6 模块类型覆盖开关/插座/显示/脉冲/电源',
        ['switches', 'sockets', 'display', 'pulse', 'utility'].every((k) => mods.some((m) => m.kind === k)),
        JSON.stringify(mods.map((m) => m.kind)));
      check('HEP 模块面板跟随 skin=hep', mods.every((m) => m.skin === 'hep'), JSON.stringify(mods.map((m) => m.skin)));
    }

    /* ---- 6. 模块元件行为（真实驱动 model + 重仿） ---- */
    {
      const placed = await evalJs(cdp, '__HEP.placeSwitches(4)');
      await sleep(320);
      check('HEP 放入 4 路逻辑电平开关', placed === 4, String(placed));
      const states = await evalJs(cdp, '__HEP.switchStates()');
      check('HEP 4 路开关进入电路', states.length === 4, JSON.stringify(states));
      check('HEP 两个开关模块共 16 个位按钮', (await evalJs(cdp, '__HEP.bitCount()')) === 16);
      const before = states[0] && states[0].state;
      await evalJs(cdp, '__HEP.clickBit(0)');
      await sleep(220);
      const after = await evalJs(cdp, '__HEP.switchStates()');
      check('HEP 点击位按钮真的翻转元件电平并重仿',
        after[0] && after[0].state !== before, `${before} → ${after[0] && after[0].state}`);
      const digit = await evalJs(cdp, '__HEP.digit()');
      check('HEP 七段数码管模块显示 BCD 译码结果',
        digit !== null && digit !== '—' && /^[0-9A-F]$/.test(digit), String(digit));
      const pb = await evalJs(cdp, '__HEP.pulseButtons()');
      check('HEP 脉冲模块含单次/步进/频率档位按钮', pb.pulse >= 2 && pb.freq === 4, JSON.stringify(pb));
    }

    /* ---- 7. 面包板隔离 ---- */
    {
      await evalJs(cdp, `__HEP.switchPlatform('breadboard')`);
      await sleep(220);
      const info = await evalJs(cdp, '__HEP.info()');
      const layer = await evalJs(cdp, '__HEP.layer()');
      check('HEP 切到面包板后平台 id 正确', info.platformId === 'breadboard', JSON.stringify(info));
      check('HEP 面包板下模块面板隐藏', layer.hidden === true, JSON.stringify(layer));
      const btn = await evalJs(cdp, '__HEP.skinBtn()');
      check('HEP 面包板下实物外观按钮禁用', btn.disabled === true, JSON.stringify(btn));
      await evalJs(cdp, `__HEP.switchPlatform('exp-box')`);
      await sleep(220);
      check('HEP 切回实验箱后 skin 偏好保留', (await evalJs(cdp, '__HEP.info()')).skin === 'hep');
      check('HEP 切回实验箱后模块面板恢复', (await evalJs(cdp, '__HEP.layer()')).hidden === false);
      // 平台切换会重置 500ms 防抖计时器，必须等落盘完成后再断言存档
      const savedPlatform = await waitSavedPlatform(cdp);
      check('HEP 存档 platform 字段仍是合法平台 id',
        ['exp-box', 'breadboard'].includes(savedPlatform), String(savedPlatform));
      check('HEP 存档 platform 与当前平台一致',
        savedPlatform === (await evalJs(cdp, '__HEP.info()')).platformId,
        `${savedPlatform} vs ${(await evalJs(cdp, '__HEP.info()')).platformId}`);
      const savedData = await evalJs(cdp, '__HEP.savedData()');
      check('HEP 外观偏好不写进电路存档（存档 v4 结构未变）',
        Boolean(savedData) && savedData.hasSkin === false, JSON.stringify(savedData));
    }

    /* ---- 8. 布局与 console ---- */
    {
      const sizes = [[1440, 900], [1024, 768], [375, 667]];
      const bad = [];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(200);
        const o = await evalJs(cdp, '__HEP.overflow()');
        if (o.bad) bad.push(`${w}x${h}:${o.scrollW}/${o.clientW}`);
      }
      check('HEP 三档分辨率无横向溢出', bad.length === 0, bad.join(','));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    check('HEP console 无报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('HEP 探针执行无异常', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
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
