/**
 * probe-ui.mjs — 界面层专项探针（指令包 18 · P1 五项）
 *
 * 覆盖：
 *   1) 首屏「30 秒上手」三步 + 骨架卡片 → 真实卡片（20 个实验）
 *   2) 步骤 / 数据 tab 是真实内容（不再是"待后续指令包"占位）
 *   3) 浅色投影模式（body[data-theme] + localStorage）
 *   4) 快捷键面板（? / 按钮 / Esc）与首次角标
 *   5) LOD（拖拽中降档、松手恢复）与移动端底部抽屉布局
 *
 * 运行：node tools/probe/probe-ui.mjs
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
  if (window.__UI) return true;
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const B = () => window.__labBoard;
  window.__UI = {
    onboard() {
      const el = q('#onboard');
      if (!el) return { exists: false };
      return { exists: true, steps: el.querySelectorAll('.onboard-item').length, text: el.textContent };
    },
    grid() {
      return {
        cards: qa('#exp-grid .exp-card:not(.exp-card--skeleton)').length,
        skeletons: qa('#exp-grid .exp-card--skeleton').length,
        count: (q('#list-count') || {}).textContent || '',
      };
    },
    open(id) {
      const card = q('#exp-grid .exp-card[data-exp-id="' + id + '"]');
      if (!card) return false;
      card.click();
      return true;
    },
    tab(name) { const b = q('.tab[data-tab="' + name + '"]'); if (!b) return false; b.click(); return true; },
    stepCount() { return qa('#steps-body .tab-steps li').length; },
    stepText() { const el = q('#steps-body'); return el ? el.textContent : ''; },
    dataRows() { return qa('#data-body .tab-expect dt').length; },
    dataText() { const el = q('#data-body'); return el ? el.textContent : ''; },
    theme() {
      return {
        attr: document.body.dataset.theme || '',
        stored: (() => { try { return localStorage.getItem('lab-sim:theme'); } catch (_) { return null; } })(),
        label: (q('#btn-theme') || {}).textContent || '',
        pressed: (q('#btn-theme') || {}).getAttribute ? q('#btn-theme').getAttribute('aria-pressed') : null,
      };
    },
    clickTheme() { const b = q('#btn-theme'); if (!b) return false; b.click(); return true; },
    keysOpen() { const el = q('#keys-host'); return Boolean(el) && !el.hidden; },
    keysRows() { return qa('#keys-host .keys-row').length; },
    clickKeysBtn() { const b = q('#btn-keys'); if (!b) return false; b.click(); return true; },
    clickKeysClose() { const b = q('#keys-host [data-keys-close]'); if (!b) return false; b.click(); return true; },
    press(key) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return true;
    },
    tipVisible() { const el = q('#keys-tip'); return Boolean(el) && !el.hidden; },
    /** 从元件库拖拽到画布，返回拖拽中的 LOD 状态 */
    dragLod(type, gx, gy) {
      const item = q('.palette-item[data-part-type="' + type + '"]');
      if (!item) return { ok: false, error: 'no palette item' };
      const r = item.getBoundingClientRect();
      item.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      // 先挪出阈值，才会真正进入拖拽态
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: r.left + r.width / 2 + 30, clientY: r.top + r.height / 2 + 30,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      const c = q('#breadboard-canvas');
      const rect = c.getBoundingClientRect();
      const p = B().project(gx, gy);
      c.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true,
        clientX: rect.left + p.x, clientY: rect.top + p.y,
        pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      }));
      return { ok: true, lod: Boolean(B().scene.lod) };
    },
    endDrag() {
      // 监听挂在 document 上：必须派发到 document，派发到 window 不会向下冒泡
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, buttons: 0, isPrimary: true }));
      B().scene.ghost = null;
      B().requestRender();
      return { lod: Boolean(B().scene.lod) };
    },
    layout() {
      const grid = q('.ws-grid');
      const canvasPanel = q('.panel-canvas');
      const side = q('.panel-side');
      const lib = q('.panel-library');
      return {
        display: grid ? getComputedStyle(grid).display : '',
        order: {
          canvas: canvasPanel ? getComputedStyle(canvasPanel).order : '',
          library: lib ? getComputedStyle(lib).order : '',
          side: side ? getComputedStyle(side).order : '',
        },
        paletteOverflowX: lib ? getComputedStyle(q('#parts-palette')).overflowX : '',
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
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
    await evalJs(cdp, INSTALL);
    await sleep(260);

    /* ---- 1. 首屏：30 秒上手 + 骨架被真实卡片替换 ---- */
    {
      const ob = await evalJs(cdp, '__UI.onboard()');
      check('P1 首屏有「30 秒上手」三步引导',
        ob.exists === true && ob.steps === 3, JSON.stringify({ exists: ob.exists, steps: ob.steps }));
      check('P1 引导文案覆盖 选实验 / 拖元件 / 连导线',
        Boolean(ob.text) && ob.text.includes('选实验') && ob.text.includes('拖元件') && ob.text.includes('连导线'),
        String(ob.text).slice(0, 60));
      const g = await evalJs(cdp, '__UI.grid()');
      check('P1 骨架卡片已被真实卡片替换（0 个残留）', g.skeletons === 0, JSON.stringify(g));
      // 21 = 1 个内置「基本门电路逻辑验证」+ 20 个示例（8 模拟 + 12 数字）
      check('P1 列表共 21 个实验（1 内置 + 20 示例）', g.cards === 21, JSON.stringify(g));
    }

    /* ---- 2. 步骤 / 数据 tab 真实内容 ---- */
    {
      await evalJs(cdp, `__UI.open('dig-01-gates')`);
      await sleep(500);
      await evalJs(cdp, `__UI.tab('steps')`);
      await sleep(200);
      const n = await evalJs(cdp, '__UI.stepCount()');
      const text = await evalJs(cdp, '__UI.stepText()');
      check('P1 步骤 tab 列出真实步骤（≥3 条）', n >= 3, `steps=${n}`);
      check('P1 步骤 tab 不再是「待后续指令包」占位',
        !String(text).includes('待后续指令包') && String(text).includes('预期值'), String(text).slice(0, 50));

      await evalJs(cdp, `__UI.tab('data')`);
      await sleep(260);
      const rows = await evalJs(cdp, '__UI.dataRows()');
      const dtext = await evalJs(cdp, '__UI.dataText()');
      check('P1 数据 tab 汇总仪器读数（≥3 行）', rows >= 3, `rows=${rows}`);
      check('P1 数据 tab 不再是占位文案',
        !String(dtext).includes('待后续指令包') && String(dtext).includes('万用表'), String(dtext).slice(0, 50));
    }

    /* ---- 3. 浅色投影模式 ---- */
    {
      const before = await evalJs(cdp, '__UI.theme()');
      check('P1 默认深色主题（body 无 light）', before.attr !== 'light', JSON.stringify(before));
      await evalJs(cdp, '__UI.clickTheme()');
      await sleep(160);
      const light = await evalJs(cdp, '__UI.theme()');
      check('P1 点「浅色」切到 body[data-theme=light]', light.attr === 'light', JSON.stringify(light));
      check('P1 主题偏好写入 localStorage', light.stored === 'light', String(light.stored));
      check('P1 按钮文字与 aria-pressed 同步', light.label === '深色' && light.pressed === 'true', JSON.stringify(light));
      await evalJs(cdp, '__UI.clickTheme()');
      await sleep(160);
      const dark = await evalJs(cdp, '__UI.theme()');
      check('P1 再点切回深色并落盘', dark.attr !== 'light' && dark.stored === 'dark', JSON.stringify(dark));
    }

    /* ---- 4. 快捷键面板 ---- */
    {
      check('P1 首次进入显示快捷键角标', (await evalJs(cdp, '__UI.tipVisible()')) === true);
      await evalJs(cdp, `__UI.press('?')`);
      await sleep(160);
      check('P1 按 ? 打开快捷键面板', (await evalJs(cdp, '__UI.keysOpen()')) === true);
      check('P1 面板列出 ≥8 条快捷键', (await evalJs(cdp, '__UI.keysRows()')) >= 8, String(await evalJs(cdp, '__UI.keysRows()')));
      await evalJs(cdp, `__UI.press('Escape')`);
      await sleep(160);
      check('P1 Esc 关闭快捷键面板', (await evalJs(cdp, '__UI.keysOpen()')) === false);
      await evalJs(cdp, '__UI.clickKeysBtn()');
      await sleep(160);
      check('P1 顶部「快捷键」按钮也能打开', (await evalJs(cdp, '__UI.keysOpen()')) === true);
      await evalJs(cdp, '__UI.clickKeysClose()');
      await sleep(160);
      check('P1 面板内「关闭」按钮生效', (await evalJs(cdp, '__UI.keysOpen()')) === false);
    }

    /* ---- 5. LOD 与移动端布局 ---- */
    {
      await evalJs(cdp, `__UI.press('Escape')`);
      await evalJs(cdp, `__UI.tab('info')`);
      const drag = await evalJs(cdp, `__UI.dragLod('resistor', 20, 12)`);
      check('P1 拖拽元件时进入 LOD 降档', Boolean(drag && drag.ok && drag.lod === true), JSON.stringify(drag));
      const end = await evalJs(cdp, '__UI.endDrag()');
      check('P1 松手后恢复高保真绘制', Boolean(end && end.lod === false), JSON.stringify(end));

      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 1, mobile: false });
      await sleep(320);
      const layout = await evalJs(cdp, '__UI.layout()');
      check('P1 375px 下工作区改为纵向排列', layout.display === 'flex', JSON.stringify(layout));
      check('P1 移动端画布排第一、元件库第二、面板第三',
        layout.order.canvas === '1' && layout.order.library === '2' && layout.order.side === '3', JSON.stringify(layout.order));
      check('P1 元件库变成横向滚动托盘', layout.paletteOverflowX === 'auto', String(layout.paletteOverflowX));
      check('P1 375px 无横向溢出', layout.docOverflow === false, JSON.stringify(layout));
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }

    check('P1 console 无报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (err) {
    check('P1 探针执行无异常', false, String(err && err.stack ? err.stack.split('\n')[0] : err));
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
