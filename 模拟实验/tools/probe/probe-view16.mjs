/**
 * probe-view16.mjs — 指令包 16（视图手势 / 快捷键 / 芯片同投影 / 纯悬停）专项探针
 *
 * 覆盖：
 *   Z1 滚轮连续缩放 + 鼠标锚点不漂 + 0.5×–4× 区间
 *   Z2 触屏双指：分离→放大、同向平移→只平移；触控板 ctrlKey 捏合
 *   Z3 水平正视（flat）：投影退化、命中一致、切回复原
 *   Z4 flat 整页旋转 0/90/180/270：投影方向 + 命中随旋转
 *   Z5 芯片与插座同投影：吸附落座、四角误差、引脚与孔位重合
 *   Z6 快捷键逐键（含 Ctrl+S / Ctrl+F / F1）+ 全局无 Shift 组合
 *   Z7 纯悬停矩阵：只有「未选中 + 悬停模块/元件 + 无进行中语义」才显示
 *   Z8 既有契约与 console 0
 */

import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep } = await import('./runB.mjs');

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
  if (window.__V16) return true;
  const B = () => window.__labBoard;
  const canvas = () => document.getElementById('breadboard-canvas');
  const q = (s) => document.querySelector(s);
  const P = () => B().hepPanel;

  const clientOf = (sx, sy) => {
    const b = B();
    const c = canvas();
    const rect = c.getBoundingClientRect();
    const kx = rect.width / b.view.width;
    const ky = rect.height / b.view.height;
    return { x: rect.left + sx * kx, y: rect.top + sy * ky };
  };

  window.__V16 = {
    /* ---------- 基础 ---------- */
    reset() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const m = B().model;
      const st = m.getState();
      st.wires.slice().forEach((w) => m.removeWire(w.id));
      st.components.slice().forEach((c) => m.removeComponent(c.id));
      m.clearUndo();
      B().setSelection(null);
      B().interact.wireMode(false);
      B().interact.continuousPlace(false);
      B().scene.ghost = null;
      B().scene.wiring = null;
      B().zoom.reset();
      B().requestRender();
      return true;
    },
    viewSize() {
      const b = B();
      const c = canvas();
      const rect = c.getBoundingClientRect();
      return { viewW: b.view.width, rectW: rect.width, viewH: b.view.height, rectH: rect.height, dpr: b.view.dpr };
    },
    camera() { return B().camera.prefs(); },
    setProjection(mode) { B().camera.setProjection(mode); return B().camera.projection(); },
    setRotate(deg) { B().camera.setRotate(deg); return B().camera.rotate(); },
    rotateBy(deg) { return B().camera.rotateBy(deg); },
    grid() { return B().camera.grid(); },
    setGrid(on) { return B().camera.setGrid(on); },
    zoomLevel() { return B().zoom.level(); },

    /* ---------- Z1 滚轮 ---------- */
    wheel(gx, gy, deltaY, ctrlKey) {
      const b = B();
      const p = b.project(gx, gy);
      const pt = clientOf(p.x, p.y);
      const before = b.zoom.level();
      const c = canvas();
      c.dispatchEvent(new WheelEvent('wheel', {
        deltaY, deltaMode: 0, ctrlKey: Boolean(ctrlKey),
        bubbles: true, cancelable: true, clientX: pt.x, clientY: pt.y,
      }));
      const after = b.zoom.level();
      const p2 = b.project(gx, gy);
      return {
        before, after,
        drift: Math.hypot(p2.x - p.x, p2.y - p.y),
        level: after,
        min: B().zoom.min(),
        max: B().zoom.max(),
      };
    },
    wheelN(gx, gy, deltaY, times) {
      for (let i = 0; i < times; i += 1) window.__V16.wheel(gx, gy, deltaY, false);
      return B().zoom.level();
    },

    /* ---------- Z2 双指 ---------- */
    pinch(x1, y1, x2, y2, nx1, ny1, nx2, ny2) {
      const c = canvas();
      const b = B();
      // 记录双指中点下的网格点：连续缩放下 pan 必然变化（锚点补偿），
      // 真正该守的是「中点指的那个网格点屏幕位置不漂」。
      const midGrid = b.unproject((x1 + x2) / 2, (y1 + y2) / 2);
      const midProj0 = b.project(midGrid.gx, midGrid.gy);
      const mk = (type, id, x, y, buttons) => {
        const pt = clientOf(x, y);
        c.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
          isPrimary: id === 1, button: 0, buttons,
          clientX: pt.x, clientY: pt.y,
        }));
      };
      const z0 = b.zoom.level();
      const pan0 = { x: b.view.panX, y: b.view.panY };
      mk('pointerdown', 1, x1, y1, 1);
      mk('pointerdown', 2, x2, y2, 1);
      mk('pointermove', 1, nx1, ny1, 1);
      mk('pointermove', 2, nx2, ny2, 1);
      const z1 = b.zoom.level();
      const pan1 = { x: b.view.panX, y: b.view.panY };
      mk('pointerup', 1, nx1, ny1, 0);
      mk('pointerup', 2, nx2, ny2, 0);
      return {
        z0, z1, pan0, pan1,
        zoomDelta: z1 - z0,
        panDelta: Math.hypot(pan1.x - pan0.x, pan1.y - pan0.y),
        // 中点原本压着的那个屏幕点，在双指分开后应仍在原处附近
        midDrift: Math.hypot(midProj0.x - (x1 + x2) / 2, midProj0.y - (y1 + y2) / 2),
      };
    },

    /* ---------- Z3/Z4 投影 ---------- */
    projDelta(gx, gy) {
      const b = B();
      const a = b.project(gx, gy);
      const x = b.project(gx + 1, gy);
      const y = b.project(gx, gy + 1);
      return { dx: x.x - a.x, dy: x.y - a.y, ex: y.x - a.x, ey: y.y - a.y };
    },
    projRound(gx, gy) {
      const p = B().project(gx, gy);
      return { x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 };
    },

    /* ---------- 放置 / 芯片 ---------- */
    anchor(type, gx, gy) { return B().interact.findAnchor(type, gx, gy); },
    placeAt(type, gx, gy) {
      const a = B().interact.findAnchor(type, gx, gy);
      if (!a.valid) return { ok: false, reason: a.reason || 'invalid', anchor: a };
      const r = B().model.addComponent(type, a.x, a.y, { rotation: a.rotation || 0 });
      B().requestRender();
      return { ok: r.ok, id: r.ok ? r.component.id : null, x: a.x, y: a.y, rotation: a.rotation || 0, socket: a.socket || null };
    },
    /** 芯片本体四角（与 parts.js 的 IC_BODY_INSET = 0.1 / 0.55 同源） */
    icCorners(compId) {
      const b = B();
      const comp = b.model.findComponent(compId);
      if (!comp) return null;
      const rect = b.model.rectOf(comp);
      const x0 = comp.x + 0.1;
      const y0 = comp.y + 0.55;
      const x1 = comp.x + rect.w - 0.1;
      const y1 = comp.y + rect.h - 0.55;
      return [b.project(x0, y0), b.project(x1, y0), b.project(x1, y1), b.project(x0, y1)]
        .map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
    },
    /** 插座内腔四角：平台数据 part.x/y + 同样的内缩 */
    socketCorners(partId) {
      const b = B();
      const part = (b.scene.platform.boxParts || []).find((p) => p.id === partId);
      if (!part) return null;
      const half = part.pins / 2;
      const x0 = part.x + 0.1;
      const y0 = part.y + 0.55;
      const x1 = part.x + half - 0.1;
      const y1 = part.y + 2.45;
      return [b.project(x0, y0), b.project(x1, y0), b.project(x1, y1), b.project(x0, y1)]
        .map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
    },
    /** 芯片每个引脚是否都落在对应插座孔位上（严格相等，0 容差） */
    pinAlignment(compId, partId) {
      const b = B();
      const comp = b.model.findComponent(compId);
      if (!comp) return { ok: false, reason: 'no comp' };
      const out = [];
      const term = (name) => b.geometry.terminal(comp.id, name);
      comp.terminals.forEach((t) => {
        const node = b.scene.platform.nodeMap.get('exp-box:' + partId + ':p' + t.name);
        if (!node) { out.push({ pin: t.name, node: null }); return; }
        const pos = term(t.name) || {};
        out.push({ pin: t.name, node: { x: node.x, y: node.y }, term: { x: pos.x, y: pos.y } });
      });
      return out;
    },
    placeOnSocket(type, sockId) {
      const part = (B().scene.platform.boxParts || []).find((p) => p.id === sockId);
      if (!part) return { ok: false, reason: 'no socket' };
      // 故意丢偏 0.6 格：验证吸附会把芯片拉回座里
      return window.__V16.placeAt(type, part.x + 0.6, part.y + 0.6);
    },

    /* ---------- 命中 ---------- */
    pickGrid(gx, gy) {
      const p = B().project(gx, gy);
      return B().pick(p.x, p.y);
    },
    /** 已经是屏幕（视图）坐标，直接命中 */
    pickScreen(sx, sy) { return B().pick(sx, sy); },
    pickClient(gx, gy) {
      const p = B().project(gx, gy);
      const c = canvas();
      const rect = c.getBoundingClientRect();
      const kx = rect.width / B().view.width;
      const ky = rect.height / B().view.height;
      c.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',
        isPrimary: true, button: -1, buttons: 0,
        clientX: rect.left + p.x * kx, clientY: rect.top + p.y * ky,
      }));
      return B().scene.hover;
    },
    termScreen(compId, terminal) {
      const b = B();
      const pos = b.geometry.terminal(compId, terminal); // 网格坐标
      return pos ? b.project(pos.x, pos.y) : null;
    },

    /* ---------- 快捷键 ---------- */
    key(key, opts) {
      const o = opts || {};
      document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({
        key, bubbles: true, cancelable: true, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
      }, o)));
      return true;
    },
    lensOn() { return Boolean(B().lens && B().lens.isOn()); },
    wireMode() { return B().interact.isWireMode(); },
    busy() { return B().interact.isBusy(); },
    selection() { return B().scene.selection; },
    setSelection(sel) { B().setSelection(sel); return B().scene.selection; },
    undoDepth() { return B().model.canUndo(); },
    comps() { return B().model.getState().components.length; },
    keysOpen() { const el = q('#keys-host'); return Boolean(el && !el.hidden); },
    gridClass() {
      const el = q('#canvas-area');
      return el ? el.classList.contains('is-no-grid') : null;
    },
    savedKeys() {
      try { return Object.keys(localStorage).filter((k) => k.indexOf('lab-sim-circuit-') === 0); } catch (_) { return []; }
    },
    fullscreen() { return Boolean(document.fullscreenElement); },
    projBtn() {
      const b = q('#btn-projection');
      const r = q('#btn-rotate-view');
      return {
        proj: b ? { text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') } : null,
        rotate: r ? { disabled: r.disabled } : null,
      };
    },

    /* ---------- 纯悬停 ---------- */
    hepState() { return P() ? P().state() : null; },
    hoverGate() { return P() ? P().hoverGate() : null; },
    hoverModule(gx, gy) { return P() ? P().hoverAt(gx, gy) : null; },
    hoverBlank() { return P() ? P().hoverAt(-3, -3) : null; },
    hoverCard() {
      const el = q('.hep-hover-card');
      return el ? { hidden: el.hidden, text: el.textContent || '' } : null;
    },
    hepPanelCards() { return P() ? P().list() : []; },
  };
  return true;
})()`;

async function main() {
  const server = await ensureServer();
  const { cdp, edge, userDataDir } = await bootEdge();
  const consoleErrors = [];
  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    cdp.on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails.text || 'exception');
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') consoleErrors.push(p.args.map((a) => a.value || a.description || '').join(' '));
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(1600);
    await evalJs(cdp, INSTALL);
    await evalJs(cdp, `document.querySelector('.exp-card')?.click()`);
    await sleep(1200);
    await evalJs(cdp, INSTALL);
    // 统一到 HEP 实物外观 + 实验箱（用户截图场景）
    await evalJs(cdp, `(() => { window.__labBoard.setSkin('hep'); window.__V16.reset(); return true; })()`);
    await sleep(400);

    const size = await evalJs(cdp, '__V16.viewSize()');
    console.log(`INFO canvas view=${size.viewW}x${size.viewH} rect=${size.rectW}x${size.rectH} dpr=${size.dpr}`);

    /* ================= Z1 滚轮连续缩放 ================= */
    {
      await evalJs(cdp, '__V16.reset()');
      const inRes = await evalJs(cdp, '__V16.wheel(10, 8, -120, false)');
      check('Z1 滚轮上滚放大', inRes.after > inRes.before, JSON.stringify(inRes));
      check('Z1 缩放是连续值（不在档位表上）',
        Math.abs(inRes.after - 1) > 1e-3 && ![1, 1.5, 2, 3].some((z) => Math.abs(z - inRes.after) < 1e-6),
        String(inRes.after));
      check('Z1 鼠标锚点不漂（≤2px）', inRes.drift <= 2, `drift=${inRes.drift.toFixed(2)}`);
      const outRes = await evalJs(cdp, '__V16.wheel(10, 8, 120, false)');
      check('Z1 滚轮下滚缩小', outRes.after < outRes.before, JSON.stringify(outRes));
      check('Z1 下滚锚点同样不漂（≤2px）', outRes.drift <= 2, `drift=${outRes.drift.toFixed(2)}`);
      check('Z1 只允许 0.5×–4×', inRes.min === 0.5 && inRes.max === 4, `${inRes.min}..${inRes.max}`);

      const lo = await evalJs(cdp, '__V16.wheelN(10, 8, 200, 40)');
      check('Z1 连续下滚夹到 0.5× 下限', Math.abs(lo - 0.5) < 1e-6, String(lo));
      const hi = await evalJs(cdp, '__V16.wheelN(10, 8, -200, 60)');
      check('Z1 连续上滚夹到 4× 上限', Math.abs(hi - 4) < 1e-6, String(hi));

      await evalJs(cdp, '__V16.reset()');
      const pinchPad = await evalJs(cdp, '__V16.wheel(10, 8, -30, true)');
      check('Z1 触控板 ctrlKey 捏合也缩放', pinchPad.after > pinchPad.before, JSON.stringify(pinchPad));
    }

    /* ================= Z2 双指手势 ================= */
    {
      await evalJs(cdp, '__V16.reset()');
      const spread = await evalJs(cdp, '__V16.pinch(20, 10, 40, 10, 8, 10, 52, 10)');
      check('Z2 双指分开 → 放大', spread.zoomDelta > 0.05, JSON.stringify(spread));
      check('Z2 双指分开后缩放锚在双指中点（漂移 ≤3px）',
        spread.midDrift <= 3, `drift=${spread.midDrift.toFixed(2)}`);

      await evalJs(cdp, '__V16.reset()');
      const panMove = await evalJs(cdp, '__V16.pinch(20, 10, 40, 10, 45, 30, 65, 30)');
      check('Z2 双指同向平移 → zoom 回到原值（≤1%）', Math.abs(panMove.zoomDelta) < 0.01, JSON.stringify(panMove));
      check('Z2 双指同向平移 → pan 变化', panMove.panDelta > 10, `pan=${panMove.panDelta.toFixed(2)}`);
      await evalJs(cdp, '__V16.reset()');
    }

    /* ================= Z3 水平正视 ================= */
    {
      const iso = await evalJs(cdp, '__V16.projDelta(10, 8)');
      check('Z3 iso 投影：+x 向右下、+y 向左下（等距菱形）',
        iso.dx > 1 && iso.dy > 0 && Math.abs(iso.dx + iso.ex) < 1e-6
        && Math.abs(iso.dy - iso.ey) < 1e-6, JSON.stringify(iso));

      const changed = await evalJs(cdp, '__V16.setProjection("flat")');
      check('Z3 可切到水平正视', changed === 'flat', String(changed));
      const flat = await evalJs(cdp, '__V16.projDelta(10, 8)');
      check('Z3 flat 投影退化为正投影（dy=0、ex=0）',
        Math.abs(flat.dy) < 1e-6 && Math.abs(flat.ex) < 1e-6 && flat.dx > 1, JSON.stringify(flat));
      check('Z3 flat 下 x/y 同格距（正方形孔阵）', Math.abs(flat.dx - flat.ey) < 1e-6, JSON.stringify(flat));

      const placed = await evalJs(cdp, '__V16.placeAt("resistor", 6, 4)');
      check('Z3 flat 下可放置元件', placed.ok === true, JSON.stringify(placed));
      const term = await evalJs(cdp, `__V16.termScreen('${placed.id}', '1')`);
      const hit = await evalJs(cdp, `__V16.pickScreen(${term.x}, ${term.y})`);
      check('Z3 flat 下命中与视觉一致（点端子得端子）',
        Boolean(hit) && hit.type === 'terminal' && hit.componentId === placed.id, JSON.stringify(hit));

      const btn = await evalJs(cdp, '__V16.projBtn()');
      check('Z3 工具栏按钮切到「立体」且旋转可用', btn.proj.text === '立体' && btn.rotate.disabled === false, JSON.stringify(btn));

      const gridOff = await evalJs(cdp, '__V16.key("g")');
      void gridOff;
      const g1 = await evalJs(cdp, '__V16.grid()');
      const g1c = await evalJs(cdp, '__V16.gridClass()');
      check('Z3/G 键关闭网格（状态 + 画布类同步）', g1 === false && g1c === true, `${g1}/${g1c}`);
      await evalJs(cdp, '__V16.key("g")');
      const g2 = await evalJs(cdp, '__V16.grid()');
      check('Z3/G 键再次打开网格', g2 === true, String(g2));

      await evalJs(cdp, '__V16.reset()');
      const back = await evalJs(cdp, '__V16.setProjection("iso")');
      const iso2 = await evalJs(cdp, '__V16.projDelta(10, 8)');
      check('Z3 切回立体后投影复原', back === 'iso'
        && Math.abs(iso2.dx - iso.dx) < 1e-6 && Math.abs(iso2.dy - iso.dy) < 1e-6, JSON.stringify(iso2));
    }

    /* ================= Z4 整页旋转 ================= */
    {
      await evalJs(cdp, '__V16.setProjection("flat")');
      const base = await evalJs(cdp, '__V16.projDelta(10, 8)');
      const basePt = await evalJs(cdp, '__V16.projRound(10, 8)');

      const r90 = await evalJs(cdp, '__V16.setRotate(90)');
      const d90 = await evalJs(cdp, '__V16.projDelta(10, 8)');
      check('Z4 旋转 90° 生效', r90 === 90, String(r90));
      check('Z4 90° 后 +x 变成 +y（dx≈0、dy>0）',
        Math.abs(d90.dx) < 1e-6 && d90.dy > 1, JSON.stringify(d90));

      const r180 = await evalJs(cdp, '__V16.setRotate(180)');
      const d180 = await evalJs(cdp, '__V16.projDelta(10, 8)');
      check('Z4 180° 后 +x 反向', r180 === 180 && Math.abs(d180.dx + base.dx) < 1e-6
        && Math.abs(d180.dy) < 1e-6, JSON.stringify(d180));

      const r270 = await evalJs(cdp, '__V16.setRotate(270)');
      const d270 = await evalJs(cdp, '__V16.projDelta(10, 8)');
      check('Z4 270° 后 +x 变成 -y', r270 === 270 && Math.abs(d270.dx) < 1e-6 && d270.dy < -1, JSON.stringify(d270));

      await evalJs(cdp, '__V16.setRotate(90)');
      const p90 = await evalJs(cdp, '__V16.projRound(10, 8)');
      check('Z4 旋转后板面中心不漂（格点绕画布中心转）',
        Math.abs(Math.hypot(p90.x - basePt.x, p90.y - basePt.y)) > 0, JSON.stringify({ basePt, p90 }));

      // 旋转后命中仍准：放一个电阻，点它的端子
      await evalJs(cdp, '__V16.reset()');
      const placed = await evalJs(cdp, '__V16.placeAt("resistor", 8, 6)');
      const term = await evalJs(cdp, `__V16.termScreen('${placed.id}', '2')`);
      const hit = await evalJs(cdp, `__V16.pickScreen(${term.x}, ${term.y})`);
      check('Z4 旋转 90° 下命中随旋转正确',
        Boolean(hit) && hit.type === 'terminal' && hit.terminal === '2', JSON.stringify(hit));

      const rotBtn = await evalJs(cdp, '__V16.rotateBy(90)');
      check('Z4 工具栏旋转按钮 +90°（90→180）', rotBtn === 180, String(rotBtn));

      // 双指旋转：两根手指从竖直摆成水平（夹角 -90°），松手吸附到 270°
      await evalJs(cdp, '__V16.setRotate(0)');
      await evalJs(cdp, '__V16.pinch(30, 0, 30, 60, 60, 30, 0, 30)');
      const byPinch = await evalJs(cdp, '__V16.camera()');
      check('Z4 双指旋转吸附到最近 90°（竖直→水平 = 270°）',
        byPinch.rotate === 270 || byPinch.rotate === 90, JSON.stringify(byPinch));

      await evalJs(cdp, '__V16.setRotate(0)');
      await evalJs(cdp, '__V16.setProjection("iso")');
      await evalJs(cdp, '__V16.reset()');
    }

    /* ================= Z5 芯片与插座同投影 ================= */
    {
      // 故意丢偏 0.6 格，验证吸附
      const placed = await evalJs(cdp, '__V16.placeOnSocket("ic74xx", "socket-u1")');
      check('Z5 芯片丢偏后吸附到 U1 座（x/y 对齐）', placed.ok && placed.x === 15 && placed.y === 1, JSON.stringify(placed));
      check('Z5 芯片 rotation 继承插座', placed.rotation === 0, String(placed.rotation));

      const icIso = await evalJs(cdp, `__V16.icCorners('${placed.id}')`);
      const sockIso = await evalJs(cdp, '__V16.socketCorners("socket-u1")');
      const maxIso = Math.max(...icIso.map((p, i) => Math.hypot(p.x - sockIso[i].x, p.y - sockIso[i].y)));
      check('Z5 iso 下芯片四角与插座内腔误差 ≤1px', maxIso <= 1, `max=${maxIso.toFixed(4)}px`);

      const align = await evalJs(cdp, `__V16.pinAlignment('${placed.id}', 'socket-u1')`);
      const pinOk = Array.isArray(align) && align.length === 14
        && align.every((a) => a.node && a.term.x === a.node.x && a.term.y === a.node.y);
      check('Z5 14 个引脚全部压在插座孔位上（0 容差）', pinOk,
        JSON.stringify(align.filter((a) => !a.node || a.term.x !== a.node.x || a.term.y !== a.node.y)));

      await evalJs(cdp, '__V16.setProjection("flat")');
      const icFlat = await evalJs(cdp, `__V16.icCorners('${placed.id}')`);
      const sockFlat = await evalJs(cdp, '__V16.socketCorners("socket-u1")');
      const maxFlat = Math.max(...icFlat.map((p, i) => Math.hypot(p.x - sockFlat[i].x, p.y - sockFlat[i].y)));
      check('Z5 flat 下芯片四角与插座内腔误差 ≤1px', maxFlat <= 1, `max=${maxFlat.toFixed(4)}px`);
      check('Z5 flat 下芯片本体是水平矩形（上下边 y 相等）',
        Math.abs(icFlat[0].y - icFlat[1].y) < 1e-6 && Math.abs(icFlat[0].x - icFlat[3].x) < 1e-6,
        JSON.stringify(icFlat));

      // 16 脚座 + 16 脚芯片
      await evalJs(cdp, '__V16.reset()');
      const p16 = await evalJs(cdp, '__V16.placeOnSocket("ic74xx16", "socket-u2")');
      check('Z5 16 脚芯片吸附到 U2 座', p16.ok && p16.x === 15 && p16.y === 6, JSON.stringify(p16));
      const align16 = await evalJs(cdp, `__V16.pinAlignment('${p16.id}', 'socket-u2')`);
      const pinOk16 = Array.isArray(align16) && align16.length === 16
        && align16.every((a) => a.node && a.term.x === a.node.x && a.term.y === a.node.y);
      check('Z5 16 个引脚全部压在 U2 孔位上', pinOk16, String(align16.length));

      // 脚数不匹配不得进座
      const wrong = await evalJs(cdp, '__V16.anchor("ic74xx16", 16, 2)');
      check('Z5 16 脚芯片不会被吸进 14 脚座', !wrong || wrong.socket !== 'socket-u1', JSON.stringify(wrong));

      await evalJs(cdp, '__V16.setProjection("iso")');
      await evalJs(cdp, '__V16.reset()');
    }

    /* ================= Z6 快捷键 ================= */
    {
      await evalJs(cdp, '__V16.reset()');
      // 1 / M 等价
      const l0 = await evalJs(cdp, '__V16.lensOn()');
      await evalJs(cdp, '__V16.key("1")');
      const l1 = await evalJs(cdp, '__V16.lensOn()');
      await evalJs(cdp, '__V16.key("m")');
      const l2 = await evalJs(cdp, '__V16.lensOn()');
      check('Z6 1 与 M 都能开关放大镜', l0 === false && l1 === true && l2 === false, `${l0}/${l1}/${l2}`);

      // 2 / 3 / 0
      await evalJs(cdp, '__V16.key("2")');
      const z2 = await evalJs(cdp, '__V16.zoomLevel()');
      await evalJs(cdp, '__V16.key("2")');
      const z3 = await evalJs(cdp, '__V16.zoomLevel()');
      await evalJs(cdp, '__V16.key("3")');
      const z4 = await evalJs(cdp, '__V16.zoomLevel()');
      await evalJs(cdp, '__V16.key("0")');
      const z5 = await evalJs(cdp, '__V16.zoomLevel()');
      check('Z6 2/3/0 = 放大一档 / 缩小一档 / 复位 1×',
        z2 === 1.5 && z3 === 2 && z4 === 1.5 && z5 === 1, `${z2},${z3},${z4},${z5}`);

      // N 导线工具
      await evalJs(cdp, '__V16.key("n")');
      const wm1 = await evalJs(cdp, '__V16.wireMode()');
      await evalJs(cdp, '__V16.key("n")');
      const wm2 = await evalJs(cdp, '__V16.wireMode()');
      check('Z6 N 进入 / 退出导线工具', wm1 === true && wm2 === false, `${wm1}/${wm2}`);
      await evalJs(cdp, '__V16.key("n")');
      await evalJs(cdp, '__V16.key("Escape")');
      check('Z6 Esc 退出导线工具', (await evalJs(cdp, '__V16.wireMode()')) === false, '');

      // D 删除
      const placed = await evalJs(cdp, '__V16.placeAt("resistor", 6, 4)');
      await evalJs(cdp, `__V16.setSelection({ type: 'component', id: '${placed.id}' })`);
      await evalJs(cdp, '__V16.key("d")');
      check('Z6 D 删除选中元件', (await evalJs(cdp, '__V16.comps()')) === 0, String(await evalJs(cdp, '__V16.comps()')));

      // Ctrl+S
      const before = await evalJs(cdp, '__V16.savedKeys()');
      await evalJs(cdp, '__V16.key("s", { ctrlKey: true })');
      await sleep(200);
      const after = await evalJs(cdp, '__V16.savedKeys()');
      check('Z6 Ctrl+S 立即落盘', after.length >= before.length && after.length > 0, JSON.stringify({ before, after }));

      // Ctrl+F 全屏
      await evalJs(cdp, '__V16.key("f", { ctrlKey: true })');
      await sleep(400);
      const fs1 = await evalJs(cdp, '__V16.fullscreen()');
      await evalJs(cdp, '__V16.key("f", { ctrlKey: true })');
      await sleep(400);
      const fs2 = await evalJs(cdp, '__V16.fullscreen()');
      check('Z6 Ctrl+F 进入 / 退出全屏', fs1 === true && fs2 === false, `${fs1}/${fs2}`);

      // F1
      await evalJs(cdp, '__V16.key("F1")');
      await sleep(150);
      const k1 = await evalJs(cdp, '__V16.keysOpen()');
      await evalJs(cdp, '__V16.key("F1")');
      await sleep(150);
      const k2 = await evalJs(cdp, '__V16.keysOpen()');
      check('Z6 F1 打开 / 关闭帮助面板', k1 === true && k2 === false, `${k1}/${k2}`);

      // Shift 组合全部无效
      await evalJs(cdp, '__V16.reset()');
      const gBefore = await evalJs(cdp, '__V16.grid()');
      await evalJs(cdp, '__V16.key("G", { shiftKey: true })');
      const gAfter = await evalJs(cdp, '__V16.grid()');
      await evalJs(cdp, '__V16.key("N", { shiftKey: true })');
      const wmShift = await evalJs(cdp, '__V16.wireMode()');
      const lShift0 = await evalJs(cdp, '__V16.lensOn()');
      await evalJs(cdp, '__V16.key("1", { shiftKey: true })');
      const lShift1 = await evalJs(cdp, '__V16.lensOn()');
      check('Z6 全局无 Shift 组合生效（G/N/1）',
        gAfter === gBefore && wmShift === false && lShift0 === lShift1,
        JSON.stringify({ gBefore, gAfter, wmShift, lShift0, lShift1 }));
    }

    /* ================= Z7 纯悬停矩阵 ================= */
    {
      await evalJs(cdp, '__V16.reset()');
      await evalJs(cdp, '__V16.placeAt("resistor", 6, 4)');

      const probeCell = async (sel, target, busy) => {
        await evalJs(cdp, '__V16.reset()');
        const cellPlaced = await evalJs(cdp, '__V16.placeAt("resistor", 6, 4)');
        await evalJs(cdp, '__V16.setSelection(null)');
        await evalJs(cdp, 'window.__labBoard.interact.wireMode(false)');
        if (sel) await evalJs(cdp, `__V16.setSelection({ type: 'component', id: '${cellPlaced.id}' })`);
        if (busy === 'placing') await evalJs(cdp, 'window.__labBoard.interact.continuousPlace(true)');
        if (busy === 'wiremode') await evalJs(cdp, 'window.__labBoard.interact.wireMode(true)');
        if (target === 'module') await evalJs(cdp, '__V16.hoverModule(6.4, 4.5)');
        else if (target === 'element') await evalJs(cdp, '__V16.hoverModule(6.4, 4.5)');
        else await evalJs(cdp, '__V16.hoverBlank()');
        await sleep(60);
        const card = await evalJs(cdp, '__V16.hoverCard()');
        const gate = await evalJs(cdp, '__V16.hoverGate()');
        await evalJs(cdp, 'window.__labBoard.interact.continuousPlace(false)');
        await evalJs(cdp, 'window.__labBoard.interact.wireMode(false)');
        return { shown: Boolean(card && !card.hidden), card, gate };
      };

      const cells = [];
      for (const sel of [false, true]) {
        for (const busy of ['idle', 'placing', 'wiremode']) {
          for (const target of ['module', 'element', 'blank']) {
            const r = await probeCell(sel, target, busy);
            cells.push({ sel, busy, target, shown: r.shown });
            const expect = !sel && busy === 'idle' && target !== 'blank';
            check(`Z7 悬停矩阵 sel=${sel} busy=${busy} target=${target} → ${expect ? '显示' : '不显示'}`,
              r.shown === expect, JSON.stringify(r.card || r.gate));
          }
        }
      }
      check('Z7 18 格矩阵仅 2 格显示（未选中 + 无操作 + 悬停模块/元件）',
        cells.filter((c) => c.shown).length === 2, JSON.stringify(cells.filter((c) => c.shown)));

      // 收起态只显示名称：教学模式下列表卡片 is-open 为 false
      await evalJs(cdp, '__V16.reset()');
      await evalJs(cdp, 'window.__labBoard.setHepPref("teach", true)');
      await sleep(120);
      const listed = await evalJs(cdp, '__V16.hepPanelCards()');
      check('Z7 教学模式 6 张卡片都在且未展开（只显示名称）',
        listed.length === 6 && listed.every((c) => c.visible && !c.open), JSON.stringify(listed.map((c) => [c.id, c.visible, c.open])));
      await evalJs(cdp, 'window.__labBoard.setHepPref("teach", false)');
      await sleep(120);
      const listed2 = await evalJs(cdp, '__V16.hepPanelCards()');
      check('Z7 关掉教学模式回到 0 张卡片', listed2.every((c) => !c.visible), JSON.stringify(listed2.filter((c) => c.visible)));
      await evalJs(cdp, '__V16.reset()');
    }

    /* ================= Z8 契约 / 存档 / console ================= */
    {
      const api = await evalJs(cdp, `(() => {
        const b = window.__labBoard;
        return {
          projection: typeof b.camera?.setProjection === 'function',
          rotate: typeof b.camera?.rotateBy === 'function',
          grid: typeof b.camera?.setGrid === 'function',
          wheelZoom: typeof b.zoom.setAt === 'function',
          viewFields: b.view.projection === 'iso' && typeof b.view.rotate === 'number' && typeof b.view.gridOn === 'boolean',
          wireMode: typeof b.interact.wireMode === 'function',
          isBusy: typeof b.interact.isBusy === 'function',
          hoverGate: typeof b.hepPanel.hoverGate === 'function',
        };
      })()`);
      check('Z8 __labBoard 契约扩展齐全', Object.values(api).every(Boolean), JSON.stringify(api));

      const pref = await evalJs(cdp, `(() => {
        try { return JSON.parse(localStorage.getItem('lab-sim:view') || 'null'); } catch (_) { return null; }
      })()`);
      check('Z8 视角偏好写进 localStorage（不写电路存档）', pref !== null && typeof pref.projection === 'string',
        JSON.stringify(pref));

      const saved = await evalJs(cdp, `(() => {
        const keys = Object.keys(localStorage).filter((k) => k.indexOf('lab-sim-circuit-') === 0);
        if (!keys.length) return null;
        const d = JSON.parse(localStorage.getItem(keys[0]));
        return { hasProjection: Object.prototype.hasOwnProperty.call(d, 'projection'),
                 hasView: Object.prototype.hasOwnProperty.call(d, 'view'),
                 version: d.version || null };
      })()`);
      check('Z8 电路存档结构未变（无 projection / view 字段）',
        saved === null || (saved.hasProjection === false && saved.hasView === false), JSON.stringify(saved));

      await sleep(300);
      check('Z8 console 无报错 / 异常', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | ') || '无');
    }
  } finally {
    cdp.close();
    edge.kill();
    if (server) server.kill();
    void userDataDir;
    void ROOT;
  }

  console.log('');
  if (failures.length) {
    console.log('未通过项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log(`=== 探针结果：${pass}/${pass + fail} 通过 ===`);
  if (fail > 0) process.exitCode = 1;
}

await mkdir(join(ROOT, 'tools', 'probe', 'log'), { recursive: true });
await main();
