/**
 * interact.js — 实验台交互
 *
 * 职责：元件库拖拽 / 放置吸附 / 选中 / 连线 / 删除 / 撤销 / 错误检测。
 * 事件一律走委托与 pointer 事件（鼠标、触摸、触控笔同一套代码），
 * 键盘快捷键绑在 document 上，输入框聚焦时自动让路。
 */

import * as model from './model.js';
import * as platforms from './platforms.js';
import { getPart, PART_ORDER, footprintOf, terminalPos, drawPaletteIcon } from './parts.js';
import {
  project,
  unproject,
  pickAt,
  terminalScreenPos,
  setZoom,
  setPan,
  getZoom,
  zoomIn,
  zoomOut,
  resetView,
  focusOnGrid,
} from './render.js';

/** 拖拽判定阈值：超过才算"拖"，否则按点击处理 */
const DRAG_THRESHOLD = 4;

/** 吸附搜索半径（网格） */
const SNAP_RADIUS = 2;

/** 交互层工厂：board.js 传入画布、视图与场景对象，返回可挂载/卸载的控制器 */
export function createInteraction(config) {
  const {
    canvas,
    paletteHost,
    view,
    scene,
    requestRender,
    toast,
    onChange,
    onSelectionChange,
  } = config;

  /** 交互内部状态 */
  const state = {
    pendingType: null, // 点击元件库后待放置的类型
    drag: null, // { type, ghostEl, startX, startY, active }
    dragCleanup: null, // 拖拽期间临时监听的清理函数
    pan: null, // 画布空白处拖拽平移：{ startX, startY, panX, panY, moved }
    attached: false,
  };

  /* ---------------------------------------------------------------- 工具 */

  /** 事件坐标 → 画布 CSS 像素 */
  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      inside: event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom,
    };
  }

  /** 通知外部（工具栏倍率显示）缩放已变化 */
  function emitZoom() {
    try {
      canvas.dispatchEvent(new CustomEvent('viewzoom', { detail: { level: getZoom(view) } }));
    } catch (err) { /* 老浏览器无 CustomEvent 时静默 */ }
  }

  /** 端点引用（端子或孔位） */
  function refOfEndpoint(hit) {
    if (!hit) return null;
    if (hit.type === 'terminal') return { componentId: hit.componentId, terminal: hit.terminal };
    if (hit.type === 'node') return { node: hit.nodeId };
    return null;
  }

  /** 计算「可连端子」集合：排除同元件、同端对、已存在的连线对（供智能聚焦连线的弱高亮提示） */
  function computeConnectable(fromRef) {
    if (!fromRef || !fromRef.componentId) return [];
    const fromComp = model.findComponent(fromRef.componentId);
    if (!fromComp) return [];
    const circuit = model.getState();
    const existing = new Set();
    circuit.wires.forEach((w) => {
      const a = model.refKey(w.a);
      const b = model.refKey(w.b);
      existing.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    });
    const fromKey = model.refKey(fromRef);
    const hints = [];
    circuit.components.forEach((comp) => {
      if (comp.id === fromComp.id) return; // 同元件端子不可连
      comp.terminals.forEach((terminal) => {
        const targetRef = { componentId: comp.id, terminal: terminal.name };
        const targetKey = model.refKey(targetRef);
        if (targetKey === fromKey) return;
        const pairKey = fromKey < targetKey ? `${fromKey}|${targetKey}` : `${targetKey}|${fromKey}`;
        if (existing.has(pairKey)) return; // 已连过
        const pos = terminalPos(comp, terminal.name);
        if (pos) hints.push({ componentId: comp.id, terminal: terminal.name, x: pos.x, y: pos.y });
      });
    });
    return hints;
  }

  /** 进入连线起点态（智能聚焦）：高亮起点 + 自动放大 1.5× + 标注可连端子 */
  function startWiring(ref, point) {
    const prevZoom = getZoom(view);
    scene.wiring = { from: ref, connectable: computeConnectable(ref), prevZoom };
    scene.pointer = { x: point.x, y: point.y };
    // 智能聚焦：当前视图小于 1.5× 时自动放大，端子更清晰易点
    if (getZoom(view) < 1.5 - 1e-6) setZoom(view, 1.5);
    emitZoom();
    toast('已选起点，再点另一端完成连线（或拖到目标端子）');
    requestRender();
  }

  /** 取消连线起点态（恢复此前可能自动放大的 zoom） */
  function cancelWiring() {
    const prevZoom = scene.wiring ? scene.wiring.prevZoom : null;
    scene.wiring = null;
    scene.pointer = null;
    if (prevZoom != null && Math.abs(getZoom(view) - prevZoom) > 1e-6) {
      setZoom(view, prevZoom);
      emitZoom();
    }
    toast('已取消连线');
    requestRender();
  }

  /** 元件的可读名字 */
  function labelOf(type) {
    const def = getPart(type);
    return def ? def.label : type;
  }

  /* ---------------------------------------------------------------- 放置吸附 */

  /**
   * 计算落点。
   * 先在光标附近找"所有端子都落在孔位上且不重叠"的锚点（真吸附），
   * 找不到就退回原始锚点，由调用方判断是否可放——这样用户故意丢到
   * 已占位置时仍然会得到"位置被占用"，而不是被悄悄挪走。
   */
  function findAnchor(type, gx, gy) {
    const def = getPart(type);
    const platform = scene.platform;
    if (!def || !platform) return { x: 0, y: 0, valid: false, reason: '平台未就绪' };

    const footprint = footprintOf(def, 0);
    const clampX = (value) => Math.max(0, Math.min(platform.cols - footprint.w, value));
    const clampY = (value) => Math.max(0, Math.min(platform.rows - footprint.h, value));

    const baseX = clampX(Math.round(gx - footprint.w / 2));
    const baseY = clampY(Math.round(gy - footprint.h / 2));

    const inBounds = (x, y) => x >= 0 && y >= 0
      && x + footprint.w <= platform.cols
      && y + footprint.h <= platform.rows;

    const free = (x, y) => {
      const rect = { x, y, w: footprint.w, h: footprint.h };
      return !model.getState().components.some(
        (comp) => model.rectsOverlap(rect, model.rectOf(comp)),
      );
    };

    const onNodes = (x, y) => {
      const probe = { type, x, y, rotation: 0 };
      return def.terminals.every((terminal) => {
        const pos = terminalPos(probe, terminal.name);
        return pos && platforms.nodesAt(platform.id, pos.x, pos.y).length > 0;
      });
    };

    // 先判基础锚点：用户把元件故意丢在已占位置时，宁可如实拒绝，
    // 也不能"偷偷挪到旁边空位"——那会把重叠冲突藏起来，用户完全无法感知。
    if (!inBounds(baseX, baseY)) {
      return { x: baseX, y: baseY, valid: false, reason: '超出实验台边界' };
    }
    if (!free(baseX, baseY)) {
      return { x: baseX, y: baseY, valid: false, reason: '位置被占用' };
    }

    // 吸附：在 ±SNAP_RADIUS 内找"端子全部落在孔位且不重叠"的锚点
    let snapped = null;
    let snappedScore = Infinity;
    for (let dy = -SNAP_RADIUS; dy <= SNAP_RADIUS; dy += 1) {
      for (let dx = -SNAP_RADIUS; dx <= SNAP_RADIUS; dx += 1) {
        const x = baseX + dx;
        const y = baseY + dy;
        if (!inBounds(x, y) || !free(x, y) || !onNodes(x, y)) continue;
        const score = dx * dx + dy * dy;
        if (score < snappedScore) {
          snappedScore = score;
          snapped = { x, y };
        }
      }
    }
    if (snapped) return { x: snapped.x, y: snapped.y, valid: true, snapped: true };

    return { x: baseX, y: baseY, valid: true, snapped: false };
  }

  /* ---------------------------------------------------------------- 元件库 */

  /** 构建左栏元件库（一次构建，靠委托处理拖拽） */
  function buildPalette() {
    if (!paletteHost) return;
    paletteHost.replaceChildren();

    const groups = new Map();
    PART_ORDER.forEach((type) => {
      const def = getPart(type);
      if (!def) return;
      if (!groups.has(def.group)) groups.set(def.group, []);
      groups.get(def.group).push(type);
    });

    groups.forEach((types, groupName) => {
      const section = document.createElement('section');
      section.className = 'palette-group';

      const heading = document.createElement('p');
      heading.className = 'palette-group-title';
      heading.textContent = groupName;
      section.append(heading);

      types.forEach((type) => {
        const def = getPart(type);
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'palette-item';
        item.dataset.partType = type;
        item.setAttribute('aria-label', `放置 ${def.label}`);

        const icon = document.createElement('canvas');
        icon.className = 'palette-icon';
        icon.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'palette-text';
        const name = document.createElement('span');
        name.className = 'palette-name';
        name.textContent = def.label;
        const meta = document.createElement('span');
        meta.className = 'palette-meta';
        meta.textContent = paletteMeta(type);
        text.append(name, meta);

        item.append(icon, text);
        section.append(item);

        // 图标要等布局有尺寸后再画
        requestAnimationFrame(() => {
          if (icon.isConnected) drawPaletteIcon(icon, type);
        });
      });

      paletteHost.append(section);
    });
  }

  /** 元件库副标题：把关键默认参数显示出来 */
  function paletteMeta(type) {
    const def = getPart(type);
    if (!def) return '';
    if (type === 'resistor') return '默认 1 kΩ';
    if (type === 'led') return '红 / 绿 / 黄';
    if (type === 'switch') return '2 端子';
    if (type === 'capacitor') return '默认 10 μF';
    if (type === 'ic74xx') return '14 脚 DIP';
    return `${def.terminals.length} 端子`;
  }

  /* ---------------------------------------------------------------- 选中 */

  function setSelection(selection) {
    scene.selection = selection;
    onSelectionChange();
    requestRender();
  }

  function clearSelection() {
    if (!scene.selection) return;
    scene.selection = null;
    onSelectionChange();
    requestRender();
  }

  /* ---------------------------------------------------------------- 画布事件 */

  /** 指针移动：更新悬停、悬停分组、放置预览、连线橡皮筋 */
  function handlePointerMove(event) {
    const point = canvasPoint(event);
    if (!point.inside) {
      if (scene.hover || scene.hoverGroup) {
        scene.hover = null;
        scene.hoverGroup = null;
        requestRender();
      }
      return;
    }
    scene.pointerInside = true;

    scene.pointer = { x: point.x, y: point.y };

    // 画布平移：空白处按下后拖动 → 改变 view.pan（纯渲染变换，不动 model）
    if (state.pan) {
      const dx = point.x - state.pan.startX;
      const dy = point.y - state.pan.startY;
      if (!state.pan.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) state.pan.moved = true;
      if (state.pan.moved) {
        setPan(view, state.pan.panX + dx, state.pan.panY + dy);
        requestRender();
        return;
      }
    }

    if (state.pendingType) {
      const grid = unproject(view, point.x, point.y);
      const anchor = findAnchor(state.pendingType, grid.gx, grid.gy);
      scene.ghost = {
        type: state.pendingType,
        x: anchor.x,
        y: anchor.y,
        valid: anchor.valid,
        reason: anchor.reason,
      };
      requestRender();
      return;
    }

    if (scene.wiring) {
      requestRender();
      return;
    }

    const hit = pickAt(view, scene, point.x, point.y);
    const changed = JSON.stringify(hit) !== JSON.stringify(scene.hover);
    if (changed) {
      scene.hover = hit;
      scene.hoverGroup = hit && hit.type === 'node'
        ? [hit.nodeId, ...platforms.getConnectedNodes(hit.nodeId)]
        : null;
      requestRender();
    }
  }

  /** 指针按下：放置 / 放大镜聚焦 / 连线 / 选中 / 平移起点 */
  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const point = canvasPoint(event);
    if (!point.inside) return;

    // 放置模式：点击落点
    if (state.pendingType) {
      const grid = unproject(view, point.x, point.y);
      const anchor = findAnchor(state.pendingType, grid.gx, grid.gy);
      if (!anchor.valid) {
        toast(anchor.reason || '无法放置', 'error');
        return;
      }
      placeComponent(state.pendingType, anchor.x, anchor.y);
      return;
    }

    const hit = pickAt(view, scene, point.x, point.y);

    // 放大镜开启时：点元件/端子 → 主视图聚焦到该处 2× 并关闭放大镜；
    // 点空白 → 直接关闭放大镜（避免卡在开启态）。
    if (scene.lens && scene.lens.on) {
      if (hit && (hit.type === 'component' || hit.type === 'terminal')) {
        const compId = hit.type === 'terminal' ? hit.componentId : hit.componentId;
        const comp = model.findComponent(compId);
        if (comp) {
          const def = getPart(comp.type);
          const cgx = comp.x + def.size.w / 2 - 0.5;
          const cgy = comp.y + def.size.h / 2 - 0.5;
          focusOnGrid(view, cgx, cgy, 2);
          emitZoom();
        }
      }
      scene.lens.on = false;
      requestRender();
      return;
    }

    // 连线中的第二击
    if (scene.wiring) {
      if (!hit) {
        cancelWiring();
        return;
      }
      const target = refOfEndpoint(hit);
      if (!target) {
        toast('请点击端子或孔位作为终点', 'error');
        return;
      }
      finishWire(target);
      return;
    }

    if (!hit) {
      // 空白处：可能是「平移画布」的起点（拖动）或「点击取消选中」（松手无位移时）
      state.pan = { startX: point.x, startY: point.y, panX: view.panX, panY: view.panY, moved: false };
      return;
    }

    if (hit.type === 'terminal' || hit.type === 'node') {
      const ref = refOfEndpoint(hit);
      startWiring(ref, point);
      return;
    }

    if (hit.type === 'component') {
      setSelection({ type: 'component', id: hit.componentId });
      return;
    }

    if (hit.type === 'wire') {
      setSelection({ type: 'wire', id: hit.wireId });
    }
  }

  /** 指针抬起：收尾平移（无位移视为点击空白） */
  function handlePointerUp(event) {
    if (state.pan) {
      const wasMoved = state.pan.moved;
      state.pan = null;
      if (!wasMoved) {
        if (scene.wiring) cancelWiring();
        else clearSelection();
      }
    }
  }

  /** 指针离开画布：清掉悬停与预览 */
  function handlePointerLeave() {
    scene.pointerInside = false;
    scene.pointer = null;
    if (scene.hover || scene.hoverGroup || scene.ghost) {
      scene.hover = null;
      scene.hoverGroup = null;
      if (!state.pendingType) scene.ghost = null;
      requestRender();
    }
  }

  /* ---------------------------------------------------------------- 动作 */

  /** 放置元件 */
  function placeComponent(type, x, y) {
    const result = model.addComponent(type, x, y);
    if (!result.ok) {
      toast(result.error || '放置失败', 'error');
      requestRender();
      return null;
    }
    state.pendingType = null;
    scene.ghost = null;
    scene.selection = { type: 'component', id: result.component.id };
    toast(`已放置 ${labelOf(type)} ${result.component.id}`, 'success');
    onChange('place');
    onSelectionChange();
    requestRender();
    return result.component;
  }

  /** 完成一次连线 */
  function finishWire(target) {
    const from = scene.wiring ? scene.wiring.from : null;
    if (!from) return;
    const keyFrom = model.refKey(from);
    const keyTo = model.refKey(target);
    if (keyFrom === keyTo) {
      scene.wiring = null;
      scene.pointer = null;
      toast('已取消连线');
      requestRender();
      return;
    }

    const result = model.addWire(from, target);
    scene.wiring = null;
    scene.pointer = null;

    if (result.ok) {
      toast('已连接', 'success');
      onChange('wire');
    } else {
      toast(result.error || '连线失败', 'error');
    }
    requestRender();
  }

  /** 删除当前选中项 */
  function deleteSelection() {
    if (!scene.selection) return false;
    if (scene.selection.type === 'component') {
      const id = scene.selection.id;
      const result = model.removeComponent(id);
      if (!result.ok) return false;
      scene.selection = null;
      toast(
        result.removedWires > 0
          ? `已删除 ${id}，连带 ${result.removedWires} 条导线`
          : `已删除 ${id}`,
        'success',
      );
    } else {
      const id = scene.selection.id;
      const result = model.removeWire(id);
      if (!result.ok) return false;
      scene.selection = null;
      toast(`已删除导线 ${id}`, 'success');
    }
    onChange('delete');
    onSelectionChange();
    requestRender();
    return true;
  }

  /** 撤销一步 */
  function undo() {
    const ok = model.undo();
    if (!ok) {
      toast('没有可撤销的操作');
      return false;
    }
    // 撤销后选中项可能已不存在，直接清空更安全
    scene.selection = null;
    scene.wiring = null;
    toast('已撤销', 'success');
    onChange('undo');
    onSelectionChange();
    requestRender();
    return true;
  }

  /** 旋转选中元件 */
  function rotateSelection() {
    if (!scene.selection || scene.selection.type !== 'component') {
      toast('请先选中一个元件');
      return false;
    }
    const result = model.rotateComponent(scene.selection.id);
    if (!result.ok) {
      toast(result.error, 'error');
      return false;
    }
    toast('已旋转 90°', 'success');
    onChange('rotate');
    onSelectionChange();
    requestRender();
    return true;
  }

  /* ---------------------------------------------------------------- 键盘 */

  /** 输入控件聚焦时不吃快捷键 */
  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function handleKeyDown(event) {
    if (isTypingTarget(event.target)) return;

    const key = event.key;

    if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      undo();
      return;
    }

    if (key === 'Delete' || key === 'Backspace') {
      if (!scene.selection) return;
      event.preventDefault();
      deleteSelection();
      return;
    }

    if (key === 'r' || key === 'R') {
      if (!scene.selection) return;
      event.preventDefault();
      rotateSelection();
      return;
    }

    // 视图缩放：+ / = 放大，- 缩小，0 复位（与工具栏按钮一致）
    if (key === '+' || key === '=') {
      zoomIn(view);
      emitZoom();
      requestRender();
      return;
    }
    if (key === '-' || key === '_') {
      zoomOut(view);
      requestRender();
      emitZoom();
      return;
    }
    if (key === '0') {
      resetView(view);
      emitZoom();
      requestRender();
      return;
    }
    // 放大镜开关（与工具栏按钮一致）
    if (key === 'm' || key === 'M') {
      if (scene.lens) {
        scene.lens.on = !scene.lens.on;
        if (!scene.lens.on && scene.pointer) requestRender();
        try {
          canvas.dispatchEvent(new CustomEvent('lensstate', { detail: { on: scene.lens.on } }));
        } catch (err) { /* 忽略 */ }
        toast(scene.lens.on ? '放大镜：开' : '放大镜：关');
      }
      return;
    }

    if (key === 'Escape') {
      if (scene.wiring) {
        cancelWiring();
        state.pendingType = null;
        scene.ghost = null;
      } else if (state.pendingType) {
        state.pendingType = null;
        scene.ghost = null;
        toast('已取消');
        requestRender();
      } else if (scene.selection) {
        clearSelection();
      }
    }
  }

  /* ---------------------------------------------------------------- 元件库拖拽 */

  function startPaletteDrag(event, type) {
    const item = event.currentTarget;
    const start = { x: event.clientX, y: event.clientY };
    const drag = { type, active: false, ghostEl: null, startX: start.x, startY: start.y };
    state.drag = drag;

    /** 解绑拖拽期间的临时监听（拖拽取消 / 组件卸载时都要能清干净） */
    function cleanupDragListeners() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    }

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - drag.startX;
      const dy = moveEvent.clientY - drag.startY;
      if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!drag.active) {
        drag.active = true;
        drag.ghostEl = document.createElement('div');
        drag.ghostEl.className = 'drag-ghost';
        drag.ghostEl.textContent = labelOf(type);
        document.body.append(drag.ghostEl);
      }
      drag.ghostEl.style.transform = `translate(${moveEvent.clientX + 12}px, ${moveEvent.clientY + 10}px)`;

      // 画布内同步显示吸附预览，让用户看清会落在哪几个孔上
      const point = canvasPoint(moveEvent);
      if (point.inside && scene.platform) {
        const grid = unproject(view, point.x, point.y);
        const anchor = findAnchor(type, grid.gx, grid.gy);
        scene.ghost = {
          type,
          x: anchor.x,
          y: anchor.y,
          valid: anchor.valid,
          reason: anchor.reason,
        };
      } else if (scene.ghost) {
        scene.ghost = null;
      }
      requestRender();
    };

    const onUp = (upEvent) => {
      cleanupDragListeners();
      if (drag.ghostEl) drag.ghostEl.remove();
      state.drag = null;
      state.dragCleanup = null;

      if (!drag.active) {
        // 没拖动 → 进入"点选后落点"模式
        state.pendingType = state.pendingType === type ? null : type;
        scene.ghost = null;
        toast(state.pendingType ? `已选 ${labelOf(type)}，在画布上点击放置` : '已取消选择');
        requestRender();
        return;
      }

      const point = canvasPoint(upEvent);
      if (!point.inside) {
        scene.ghost = null;
        requestRender();
        toast('拖到实验台上再松手');
        return;
      }
      const grid = unproject(view, point.x, point.y);
      const anchor = findAnchor(type, grid.gx, grid.gy);
      if (!anchor.valid) {
        scene.ghost = null;
        requestRender();
        toast(anchor.reason || '无法放置', 'error');
        return;
      }
      placeComponent(type, anchor.x, anchor.y);
    };

    // 指针捕获可能因浏览器策略失败，事件监听直接挂 document 更稳
    if (item.setPointerCapture) {
      try {
        item.setPointerCapture(event.pointerId);
      } catch (err) {
        // 捕获失败不影响：document 上的监听会兜住
      }
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    state.dragCleanup = () => {
      cleanupDragListeners();
      if (drag.ghostEl) drag.ghostEl.remove();
    };
  }

  /** 元件库事件委托：所有条目共用一个 listener */
  function handlePalettePointerDown(event) {
    const item = event.target.closest('[data-part-type]');
    if (!item) return;
    event.preventDefault();
    startPaletteDrag(event, item.dataset.partType);
  }

  /* ---------------------------------------------------------------- 挂载 / 卸载 */

  function attach() {
    if (state.attached) return;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    if (paletteHost) paletteHost.addEventListener('pointerdown', handlePalettePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    state.attached = true;
  }

  function detach() {
    if (!state.attached) return;
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointerleave', handlePointerLeave);
    if (paletteHost) paletteHost.removeEventListener('pointerdown', handlePalettePointerDown);
    document.removeEventListener('keydown', handleKeyDown);
    if (state.dragCleanup) state.dragCleanup();
    state.dragCleanup = null;
    state.drag = null;
    state.pendingType = null;
    scene.hover = null;
    scene.ghost = null;
    scene.wiring = null;
    state.pan = null;
    state.attached = false;
  }

  /** 选中项被外部改动（如撤销）后同步内部状态 */
  function syncScene() {
    if (scene.selection && scene.selection.type === 'component') {
      if (!model.findComponent(scene.selection.id)) scene.selection = null;
    } else if (scene.selection && scene.selection.type === 'wire') {
      if (!model.findWire(scene.selection.id)) scene.selection = null;
    }
  }

  return {
    attach,
    detach,
    buildPalette,
    placeComponent,
    deleteSelection,
    undo,
    rotateSelection,
    clearSelection,
    syncScene,
    findAnchor,
    getPendingType: () => state.pendingType,
    isWiring: () => Boolean(scene.wiring),
  };
}

/** 供 board 复用的几何工具（端子屏幕坐标） */
export { terminalScreenPos, project };
