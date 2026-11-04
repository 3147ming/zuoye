/**
 * probe-hep.mjs — HEP-DCTS-01 实物外观复刻专项探针（无头 Edge + CDP）
 *
 * 覆盖：默认 0 张卡片（显示分层）/ 写实 canvas 像素 / 机箱丝印开关 /
 * 悬停轻量信息卡 / 点击展开单张与一次一张 / 图钉 / 总开关 / 教学模式 /
 * 6 热点与状态灯入画布 / 模块元件行为联动 / 两台真实仪器前面板 /
 * 小屏底部抽屉 / 三档分辨率 / 既有契约与存档 v4 未破坏 / console 0。
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
  const P = () => B().hepPanel;
  const CENTERS = {
    m1: [6.4, 4.5], m2: [18.1, 4.5], m3: [29.7, 4.5],
    m4: [6.4, 12.65], m5: [18.1, 12.65], m6: [29.7, 12.65],
  };
  const q = (s) => document.querySelector(s);
  window.__HEP = {
    info() {
      const b = B();
      return { skin: b.skin, platformId: b.platformId,
               hepPanel: Boolean(b.hepPanel), probeMarkers: Boolean(b.probeMarkers),
               instruments: Boolean(b.instruments) };
    },
    layer() {
      const el = q('.hep-panel-layer');
      return el ? { exists: true, hidden: el.hidden, cards: el.querySelectorAll('.hep-module-card').length,
                    shown: [...el.querySelectorAll('.hep-module-card')].filter((c) => !c.hidden).length }
                : { exists: false, hidden: null, cards: 0, shown: 0 };
    },
    modules() { return P() ? P().list() : []; },
    state() { return P() ? P().state() : null; },
    resetView() { return P() ? P().resetView() : false; },
    setSkin(id) { return B().setSkin(id); },
    switchPlatform(id) { return B().switchPlatform(id); },
    clickSkinBtn() { const b = q('#btn-skin'); if (!b) return false; b.click(); return true; },
    skinBtn() {
      const b = q('#btn-skin');
      return b ? { exists: true, pressed: b.getAttribute('aria-pressed'), disabled: b.disabled }
               : { exists: false };
    },
    storedSkin() { try { return localStorage.getItem('lab-sim:skin'); } catch (_) { return null; } },
    hepViewStored() {
      try { return JSON.parse(localStorage.getItem('lab-sim:hep-view') || 'null'); } catch (_) { return null; }
    },
    /** 电路存档是 500ms 防抖写入；优先读当前实验的键，避免命中历史残留键 */
    savedData() {
      try {
        const expId = B().expId;
        const keys = Object.keys(localStorage).filter((k) => k.indexOf('lab-sim-circuit-') === 0);
        const key = (expId && keys.indexOf('lab-sim-circuit-' + expId) >= 0)
          ? 'lab-sim-circuit-' + expId : keys[0];
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
    pixelAt(gx, gy) {
      const b = B();
      const c = q('#breadboard-canvas');
      const ctx = c.getContext('2d');
      const dpr = b.view.dpr;
      const p = b.project(gx, gy);
      const x = Math.max(0, Math.min(c.width - 3, Math.round(p.x * dpr) - 2));
      const y = Math.max(0, Math.min(c.height - 3, Math.round(p.y * dpr) - 2));
      const d = ctx.getImageData(x, y, 3, 3).data;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n += 1; }
      return { r: r / n, g: g / n, b: bl / n };
    },
    /**
     * 模块①铭牌带多点采样：单个像素可能落在字形缝隙里导致误判，
     * 这里在网格 x∈[1.5,11.5] / y∈[0.7,1.7] 上取一组 RGB 三元组。
     */
    silkBand() {
      const b = B();
      const c = q('#breadboard-canvas');
      const ctx = c.getContext('2d');
      const dpr = b.view.dpr;
      const out = [];
      for (let gx = 1.5; gx <= 11.5; gx += 0.5) {
        for (let gy = 0.7; gy <= 1.7; gy += 0.25) {
          const p = b.project(gx, gy);
          const x = Math.round(p.x * dpr), y = Math.round(p.y * dpr);
          if (x < 1 || y < 1 || x >= c.width - 1 || y >= c.height - 1) continue;
          const d = ctx.getImageData(x, y, 1, 1).data;
          out.push([d[0], d[1], d[2]]);
        }
      }
      return out;
    },
    /** 平台层写实绘制生效与否：蓝色主板区应明显偏蓝（b - r 大） */
    pixel() {
      const pts = [[18, 4.6], [19.5, 4.8], [30, 3.4], [6, 10.5], [27, 12]];
      let r = 0, g = 0, bl = 0, n = 0;
      pts.forEach(([gx, gy]) => {
        const s = window.__HEP.pixelAt(gx, gy);
        r += s.r; g += s.g; bl += s.b; n += 1;
      });
      return { r: r / n, g: g / n, b: bl / n, blue: (bl - r) / n };
    },
    runtime() {
      const h = B().view.hep;
      return { key: h.runtimeKey || '', data: h.runtime || null, hover: h.hoverModule || null,
               silk: Boolean(h.silk), teach: Boolean(h.teach), all: Boolean(h.all) };
    },
    selectTab(id) {
      const btn = q('.inst-tab[data-tab="' + id + '"]');
      if (!btn) return false;
      btn.click();
      return true;
    },
    faces() {
      const s = q('.hep-scope-face');
      const f = q('.hep-fgen-face');
      return {
        scope: s ? s.textContent : null,
        fgen: f ? f.textContent : null,
        scopeCanvas: Boolean(q('.inst-scope-canvas')),
        bezel: Boolean(q('.hep-scope-bezel')),
        measure: Boolean(q('.inst-measure')),
      };
    },
    /* ---- 显示分层：悬停 / 点击 / 图钉 / 偏好 ---- */
    hoverAt(id) { const c = CENTERS[id]; return c ? P().hoverAt(c[0], c[1]) : null; },
    clickAt(id) { const c = CENTERS[id]; return c ? P().clickAt(c[0], c[1]) : null; },
    clickAtBlank() { return P().clickAt(-6, -6); },
    open(id) { return P().open(id); },
    close() { return P().close(); },
    pin(id) { return P().pin(id); },
    unpin(id) { return P().unpin(id); },
    setPref(name, value) { return P().setPref(name, value); },
    hoverCard() {
      const el = q('.hep-hover-card');
      if (!el) return { exists: false };
      const t = q('.hep-hover-title');
      const s = q('.hep-hover-sub');
      return { exists: true, hidden: el.hidden,
               title: t ? t.textContent : '', sub: s ? s.textContent : '',
               pointerEvents: getComputedStyle(el).pointerEvents };
    },
    moduleScreen(id) {
      const c = CENTERS[id];
      if (!c) return null;
      const b = B();
      const p = b.project(c[0], c[1]);
      const canvas = q('#breadboard-canvas');
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + p.x * (rect.width / b.view.width),
               y: rect.top + p.y * (rect.height / b.view.height) };
    },
    toolbar() {
      const p = q('#btn-hep-panel');
      const d = q('#btn-hep-display');
      const m = q('#hep-display-menu');
      const s = q('#hep-opt-silk');
      const t = q('#hep-opt-teach');
      return {
        panel: p ? { exists: true, pressed: p.getAttribute('aria-pressed'), disabled: p.disabled } : { exists: false },
        display: d ? { exists: true, expanded: d.getAttribute('aria-expanded'), disabled: d.disabled } : { exists: false },
        menuHidden: m ? m.hidden : null,
        silk: s ? s.checked : null,
        teach: t ? t.checked : null,
      };
    },
    clickPanelBtn() { const b = q('#btn-hep-panel'); if (!b) return false; b.click(); return true; },
    clickDisplayBtn() { const b = q('#btn-hep-display'); if (!b) return false; b.click(); return true; },
    setSilk(on) { const b = q('#hep-opt-silk'); if (!b) return false; b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); return true; },
    setTeach(on) { const b = q('#hep-opt-teach'); if (!b) return false; b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); return true; },
    pinBtnCount() { return document.querySelectorAll('.hep-pin').length; },
    clickPin(index) {
      const list = document.querySelectorAll('.hep-pin');
      if (!list[index]) return false;
      list[index].click();
      return true;
    },
    cardBox(id) {
      const el = q('.hep-module-card[data-module="' + id + '"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { hidden: el.hidden, position: getComputedStyle(el).position,
               top: r.top, left: r.left, width: r.width, height: r.height };
    },
    /* ---- 模块元件行为 ---- */
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
      const d = q('.hep-seven-seg');
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
    await sleep(300);

    /* ---- 1. 默认状态：0 张卡片 ---- */
    {
      const info = await evalJs(cdp, '__HEP.info()');
      check('HEP 默认皮肤为 hep（实物外观）', info.skin === 'hep', JSON.stringify(info));
      check('HEP 平台 id 仍是 exp-box（未新增平台）', info.platformId === 'exp-box', String(info.platformId));
      check('HEP hepPanel 与 probeMarkers 共存', info.hepPanel === true && info.probeMarkers === true, JSON.stringify(info));
      const layer = await evalJs(cdp, '__HEP.layer()');
      check('HEP 生成 6 张模块卡片但默认全部隐藏',
        layer.exists === true && layer.cards === 6 && layer.shown === 0, JSON.stringify(layer));
      check('HEP 默认整层隐藏（屏幕上 0 张卡片）', layer.hidden === true, JSON.stringify(layer));
      const st = await evalJs(cdp, '__HEP.state()');
      check('HEP 默认 openId / pinned / all / teach 全空',
        st.openId === null && st.pinned.length === 0 && st.all === false && st.teach === false,
        JSON.stringify(st));
      check('HEP 悬停信息卡默认隐藏', (await evalJs(cdp, '__HEP.hoverCard()')).hidden === true);
      const btn = await evalJs(cdp, '__HEP.skinBtn()');
      check('HEP 工具栏「实物外观」按钮存在且按下', btn.exists === true && btn.pressed === 'true', JSON.stringify(btn));
      const tb = await evalJs(cdp, '__HEP.toolbar()');
      check('HEP 「模块面板」总开关存在且默认未按下',
        tb.panel.exists === true && tb.panel.pressed === 'false', JSON.stringify(tb.panel));
      check('HEP 「显示」按钮存在且 popover 默认收起',
        tb.display.exists === true && tb.menuHidden === true, JSON.stringify(tb.display));
      const pref = await evalJs(cdp, '__HEP.hepViewStored()');
      check('HEP 显示偏好默认：丝印开 / 教学模式关 / 总开关关',
        pref === null || (pref.silk !== false && !pref.teach && !pref.all), JSON.stringify(pref));
    }

    /* ---- 2. 写实 canvas 平台层 + 状态灯 ---- */
    {
      const hepPx = await evalJs(cdp, '__HEP.pixel()');
      check('HEP 皮肤下平台层为蓝色主板（b-r 显著为正）', hepPx.blue > 30, JSON.stringify(hepPx));
      const rt = await evalJs(cdp, '__HEP.runtime()');
      check('HEP 帧前钩子写入状态灯 runtime（8 位 bits + 逻辑笔）',
        Boolean(rt.data) && rt.data.bits.length === 8 && 'probe' in rt.data, JSON.stringify(rt.data));
      await evalJs(cdp, `__HEP.setSkin('classic')`);
      await sleep(220);
      const classicPx = await evalJs(cdp, '__HEP.pixel()');
      check('HEP 切回通用实验箱后不再是蓝色主板', classicPx.blue < hepPx.blue - 20, JSON.stringify(classicPx));
      check('HEP localStorage 记录 classic 偏好', (await evalJs(cdp, '__HEP.storedSkin()')) === 'classic');
      await evalJs(cdp, `__HEP.setSkin('hep')`);
      await sleep(220);
      check('HEP 切回实物外观后蓝色主板恢复', (await evalJs(cdp, '__HEP.pixel()')).blue > 30);
    }

    /* ---- 3. 机箱丝印开关 ---- */
    {
      const before = await evalJs(cdp, '__HEP.silkBand()');
      await evalJs(cdp, '__HEP.setSilk(false)');
      await sleep(240);
      const after = await evalJs(cdp, '__HEP.silkBand()');
      let delta = 0;
      let changed = 0;
      for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
        const d = Math.abs(before[i][0] - after[i][0])
                + Math.abs(before[i][1] - after[i][1])
                + Math.abs(before[i][2] - after[i][2]);
        delta += d;
        if (d > 20) changed += 1;
      }
      check('HEP 关闭机箱丝印后模块铭牌区像素明显变化',
        changed >= 5 && delta > 200,
        `changed=${changed}/${before.length} delta=${delta.toFixed(0)}`);
      check('HEP 丝印偏好写入 localStorage', (await evalJs(cdp, '__HEP.hepViewStored()')).silk === false);
      check('HEP 丝印开关同步到 view.hep', (await evalJs(cdp, '__HEP.runtime()')).silk === false);
      check('HEP 「机箱丝印」checkbox 同步为未勾选', (await evalJs(cdp, '__HEP.toolbar()')).silk === false);
      await evalJs(cdp, '__HEP.setSilk(true)');
      await sleep(220);
      check('HEP 重新打开丝印后偏好恢复', (await evalJs(cdp, '__HEP.runtime()')).silk === true);
    }

    /* ---- 4. 悬停轻量信息卡 ---- */
    {
      await evalJs(cdp, `__HEP.hoverAt('m1')`);
      await sleep(220);
      const hc = await evalJs(cdp, '__HEP.hoverCard()');
      check('HEP 悬停模块浮出信息卡', hc.exists === true && hc.hidden === false, JSON.stringify(hc));
      check('HEP 信息卡显示模块名称', hc.title.indexOf('逻辑开关') >= 0, hc.title);
      check('HEP 信息卡含两行（标题 + 状态摘要）', hc.sub.length > 0, hc.sub);
      check('HEP 信息卡不吃指针事件', hc.pointerEvents === 'none', hc.pointerEvents);
      check('HEP 悬停写入 view.hep.hoverModule（画布高亮）',
        (await evalJs(cdp, '__HEP.runtime()')).hover === 'm1');
      await evalJs(cdp, '__HEP.clickAtBlank()');
      await sleep(200);
      check('HEP 点空白处后悬停信息卡隐藏', (await evalJs(cdp, '__HEP.hoverCard()')).hidden === true);
      // 真实鼠标事件（CDP）验证事件监听确实挂在 host 上
      const pt = await evalJs(cdp, `__HEP.moduleScreen('m4')`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
      await sleep(240);
      const real = await evalJs(cdp, '__HEP.hoverCard()');
      check('HEP 真实鼠标悬停（CDP）也浮出信息卡',
        real.hidden === false && real.title.indexOf('数码管') >= 0, JSON.stringify(real));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
      await sleep(220);
      check('HEP 鼠标移出画布后信息卡自动隐藏', (await evalJs(cdp, '__HEP.hoverCard()')).hidden === true);
    }

    /* ---- 5. 点击展开单张 / 一次一张 / Esc ---- */
    {
      await evalJs(cdp, `__HEP.clickAt('m1')`);
      await sleep(220);
      let st = await evalJs(cdp, '__HEP.state()');
      check('HEP 点击模块只展开 1 张卡片', st.shown.length === 1 && st.shown[0] === 'm1', JSON.stringify(st.shown));
      check('HEP 默认仍有 5 张保持隐藏', (await evalJs(cdp, '__HEP.layer()')).shown === 1);
      check('HEP 展开卡片带图钉按钮', (await evalJs(cdp, '__HEP.pinBtnCount()')) === 6);
      await evalJs(cdp, `__HEP.clickAt('m5')`);
      await sleep(220);
      st = await evalJs(cdp, '__HEP.state()');
      check('HEP 点另一个模块时自动收起上一张（一次只开一张）',
        st.shown.length === 1 && st.shown[0] === 'm5', JSON.stringify(st.shown));
      await evalJs(cdp, `__HEP.clickAt('m5')`);
      await sleep(200);
      check('HEP 再点同一模块收起', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
      await evalJs(cdp, `__HEP.open('m2')`);
      await sleep(200);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(220);
      check('HEP Esc 收起展开的面板', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
    }

    /* ---- 6. 图钉钉住 ---- */
    {
      await evalJs(cdp, `__HEP.pin('m1')`);
      await sleep(220);
      check('HEP 图钉钉住后模块常驻显示', (await evalJs(cdp, '__HEP.state()')).shown.indexOf('m1') >= 0);
      await evalJs(cdp, `__HEP.clickAtBlank()`);
      await sleep(200);
      check('HEP 点空白后钉住的模块仍显示', (await evalJs(cdp, '__HEP.state()')).shown.indexOf('m1') >= 0);
      await evalJs(cdp, `__HEP.unpin('m1')`);
      await sleep(200);
      check('HEP 取消图钉后回到 0 张卡片', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
    }

    /* ---- 7. 总开关 / 教学模式 ---- */
    {
      await evalJs(cdp, '__HEP.clickPanelBtn()');
      await sleep(240);
      check('HEP 总开关一键展开 6 块模块', (await evalJs(cdp, '__HEP.state()')).shown.length === 6);
      check('HEP 总开关按钮 aria-pressed 同步为 true', (await evalJs(cdp, '__HEP.toolbar()')).panel.pressed === 'true');
      check('HEP 总开关偏好写入 localStorage', (await evalJs(cdp, '__HEP.hepViewStored()')).all === true);
      await evalJs(cdp, '__HEP.clickPanelBtn()');
      await sleep(220);
      check('HEP 再点总开关全部收起', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
      await evalJs(cdp, '__HEP.setTeach(true)');
      await sleep(220);
      check('HEP 教学模式让 6 块模块全部常驻', (await evalJs(cdp, '__HEP.state()')).shown.length === 6);
      check('HEP 教学模式 checkbox 同步勾选', (await evalJs(cdp, '__HEP.toolbar()')).teach === true);
      await evalJs(cdp, '__HEP.setTeach(false)');
      await sleep(220);
      check('HEP 关闭教学模式回到 0 张卡片', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
      await evalJs(cdp, '__HEP.clickDisplayBtn()');
      await sleep(160);
      check('HEP 「显示」按钮展开 popover', (await evalJs(cdp, '__HEP.toolbar()')).menuHidden === false);
      await evalJs(cdp, '__HEP.clickDisplayBtn()');
      await sleep(160);
      check('HEP 再点「显示」收起 popover', (await evalJs(cdp, '__HEP.toolbar()')).menuHidden === true);
    }

    /* ---- 8. 工具栏按钮联动（原有） ---- */
    {
      await evalJs(cdp, '__HEP.clickSkinBtn()');
      await sleep(200);
      const info = await evalJs(cdp, '__HEP.info()');
      const btn = await evalJs(cdp, '__HEP.skinBtn()');
      check('HEP 点工具栏按钮切到 classic', info.skin === 'classic', JSON.stringify(info));
      check('HEP 按钮 aria-pressed 同步为 false', btn.pressed === 'false', JSON.stringify(btn));
      check('HEP classic 下模块层自动隐藏', (await evalJs(cdp, '__HEP.layer()')).hidden === true);
      await evalJs(cdp, '__HEP.clickSkinBtn()');
      await sleep(200);
      check('HEP 再点按钮切回 hep', (await evalJs(cdp, '__HEP.info()')).skin === 'hep');
      check('HEP 回到 hep 后仍是 0 张卡片（不自动铺满）',
        (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
    }

    /* ---- 9. 两台真实仪器前面板 ---- */
    {
      await evalJs(cdp, `__HEP.selectTab('scope')`);
      await sleep(180);
      const f = await evalJs(cdp, '__HEP.faces()');
      check('HEP 示波器 tab 出现 SIGLENT SDS 1102CNL 前面板',
        Boolean(f.scope) && f.scope.indexOf('SDS 1102CNL') >= 0 && f.scope.indexOf('100MHz') >= 0,
        String(f.scope).slice(0, 90));
      check('HEP 示波器屏幕外框保留 .inst-scope-canvas', f.scopeCanvas === true && f.bezel === true, JSON.stringify(f));
      check('HEP 示波器 .inst-measure 契约未破坏', f.measure === true, JSON.stringify(f));
      await evalJs(cdp, `__HEP.selectTab('fgen')`);
      await sleep(180);
      const f2 = await evalJs(cdp, '__HEP.faces()');
      check('HEP 函数发生 tab 出现 UTG9005A 前面板',
        Boolean(f2.fgen) && f2.fgen.indexOf('UTG9005A') >= 0 && f2.fgen.indexOf('5MHz') >= 0,
        String(f2.fgen).slice(0, 90));
      await evalJs(cdp, `__HEP.setSkin('classic')`);
      await sleep(180);
      check('HEP classic 下真实仪器装饰层消失', (await evalJs(cdp, '__HEP.faces()')).fgen === null);
      await evalJs(cdp, `__HEP.setSkin('hep')`);
      await sleep(180);
      check('HEP 切回 hep 前面板恢复', (await evalJs(cdp, '__HEP.faces()')).fgen !== null);
    }

    /* ---- 10. 6 模块结构 ---- */
    {
      const mods = await evalJs(cdp, '__HEP.modules()');
      const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
      check('HEP 6 模块 id 齐全', ids.every((id) => mods.some((m) => m.id === id)), JSON.stringify(mods.map((m) => m.id)));
      check('HEP 6 模块类型覆盖开关/插座/显示/脉冲/电源',
        ['switches', 'sockets', 'display', 'pulse', 'utility'].every((k) => mods.some((m) => m.kind === k)),
        JSON.stringify(mods.map((m) => m.kind)));
      check('HEP 模块面板跟随 skin=hep', mods.every((m) => m.skin === 'hep'), JSON.stringify(mods.map((m) => m.skin)));
    }

    /* ---- 11. 模块元件行为 + 状态灯联动（先展开再操作） ---- */
    {
      const placed = await evalJs(cdp, '__HEP.placeSwitches(4)');
      await sleep(340);
      check('HEP 放入 4 路逻辑电平开关', placed === 4, String(placed));
      const states = await evalJs(cdp, '__HEP.switchStates()');
      check('HEP 4 路开关进入电路', states.length === 4, JSON.stringify(states));
      await evalJs(cdp, '__HEP.setPref("all", true)');
      await sleep(260);
      check('HEP 全展开下两个开关模块共 16 个位按钮', (await evalJs(cdp, '__HEP.bitCount()')) === 16);
      const pb = await evalJs(cdp, '__HEP.pulseButtons()');
      check('HEP 脉冲模块含单次/步进/频率档位按钮', pb.pulse >= 2 && pb.freq === 4, JSON.stringify(pb));
      const digit0 = await evalJs(cdp, '__HEP.digit()');
      check('HEP 七段数码管模块显示 BCD 译码结果',
        digit0 !== null && digit0 !== '—' && /^[0-9A-F]$/.test(digit0), String(digit0));
      check('HEP canvas 状态数码管与卡片 BCD 同步',
        (await evalJs(cdp, '__HEP.runtime()')).data.digit === digit0, String(digit0));

      const before = states[0] && states[0].state;
      const ledBefore = await evalJs(cdp, '__HEP.pixelAt(1.4, 4.75)');
      const keyBefore = (await evalJs(cdp, '__HEP.runtime()')).key;
      await evalJs(cdp, '__HEP.clickBit(0)');
      await sleep(320);
      const after = await evalJs(cdp, '__HEP.switchStates()');
      check('HEP 点击位按钮真的翻转元件电平并重仿',
        after[0] && after[0].state !== before, `${before} → ${after[0] && after[0].state}`);
      const rt = await evalJs(cdp, '__HEP.runtime()');
      check('HEP 拨位后状态灯 runtime 指纹变化', rt.key !== keyBefore, `${keyBefore} → ${rt.key}`);
      check('HEP 拨位后 8 路状态灯数据同步', rt.data.bits[0] === 1, JSON.stringify(rt.data.bits));
      const ledAfter = await evalJs(cdp, '__HEP.pixelAt(1.4, 4.75)');
      check('HEP 状态灯真的画进 canvas（LED 区红色增强）',
        (ledAfter.r - ledBefore.r) > 20 || (ledAfter.r - ledAfter.b) > 40,
        `before=${JSON.stringify(ledBefore)} after=${JSON.stringify(ledAfter)}`);
      await evalJs(cdp, '__HEP.setPref("all", false)');
      await sleep(200);
      check('HEP 关总开关后回到 0 张卡片', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
    }

    /* ---- 12. 面包板隔离与存档 ---- */
    {
      await evalJs(cdp, `__HEP.switchPlatform('breadboard')`);
      await sleep(240);
      const info = await evalJs(cdp, '__HEP.info()');
      check('HEP 切到面包板后平台 id 正确', info.platformId === 'breadboard', JSON.stringify(info));
      check('HEP 面包板下模块层隐藏', (await evalJs(cdp, '__HEP.layer()')).hidden === true);
      check('HEP 面包板下实物外观按钮禁用', (await evalJs(cdp, '__HEP.skinBtn()')).disabled === true);
      const tb = await evalJs(cdp, '__HEP.toolbar()');
      check('HEP 面包板下「模块面板 / 显示」按钮一并禁用',
        tb.panel.disabled === true && tb.display.disabled === true, JSON.stringify(tb));
      await evalJs(cdp, `__HEP.switchPlatform('exp-box')`);
      await sleep(240);
      check('HEP 切回实验箱后 skin 偏好保留', (await evalJs(cdp, '__HEP.info()')).skin === 'hep');
      check('HEP 切回实验箱后仍是 0 张卡片', (await evalJs(cdp, '__HEP.state()')).shown.length === 0);
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

    /* ---- 13. 小屏底部抽屉 + 布局 + console ---- */
    {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: false });
      await sleep(240);
      await evalJs(cdp, `__HEP.open('m1')`);
      await sleep(260);
      check('HEP 375px 下识别为底部抽屉模式', (await evalJs(cdp, '__HEP.state()')).drawer === true);
      const box = await evalJs(cdp, '__HEP.cardBox("m1")');
      check('HEP 窄屏展开卡片改为底部抽屉（不再绝对定位盖画布）',
        box && box.hidden === false && box.position === 'relative' && box.top > 200,
        JSON.stringify(box));
      check('HEP 窄屏抽屉不超出屏宽', box && box.width <= 375, JSON.stringify(box));
      await evalJs(cdp, '__HEP.close()');

      const sizes = [[1440, 900], [1024, 768], [375, 667]];
      const bad = [];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(220);
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
