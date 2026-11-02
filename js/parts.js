/**
 * parts.js — 元件类型注册表
 *
 * 每个类型定义：
 *   size            未旋转时的网格占位（w × h，单位=孔位）
 *   terminals[]     { name, dx, dy, direction: 'in'|'out'|'bidir' }
 *   defaultParams   新建元件时的默认参数
 *   paramFields[]   右栏参数面板的表单字段描述
 *   draw(ctx, comp, style)  2.5D 外观绘制，style.frame 提供等距投影
 *
 * 绘制约定：只消费 style.frame.project(dx, dy)（dx/dy 为元件内部网格偏移），
 * 不直接接触画布原点，因此同一套 draw 既可用于主画布也可用于元件库图标。
 */

import { normalizeType, pinLabel, DIG_MODEL_ORDER, DIG_MODELS } from './digmodels.js';

/* ==========================================================================
   等距绘制基元
   ========================================================================== */

/** 填充一个多边形 */
export function poly(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

/** 把点整体上移 */
export function lift(point, height) {
  return { x: point.x, y: point.y - height };
}

/**
 * 画一个从网格矩形 [gx0..gx1] × [gy0..gy1] 立起来的等距棱柱。
 * 只绘制朝向观察者的两个侧面 + 顶面，保证遮挡关系正确。
 */
export function prism(ctx, frame, gx0, gy0, gx1, gy1, height, top, side1, side2, edge) {
  const a = frame.project(gx0, gy0);
  const b = frame.project(gx1, gy0);
  const c = frame.project(gx1, gy1);
  const d = frame.project(gx0, gy1);

  const at = lift(a, height);
  const bt = lift(b, height);
  const ct = lift(c, height);
  const dt = lift(d, height);

  // 右侧面 b-c，左侧面 c-d（c 是离观察者最近的点）
  poly(ctx, [bt, ct, c, b]);
  ctx.fillStyle = side1;
  ctx.fill();

  poly(ctx, [ct, dt, d, c]);
  ctx.fillStyle = side2;
  ctx.fill();

  poly(ctx, [at, bt, ct, dt]);
  ctx.fillStyle = top;
  ctx.fill();

  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** 在元件端子位置画一个金属接点 */
function drawLead(ctx, from, to, color, width) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** 元件下方投影：让元件"坐"在台面上 */
function drawContactShadow(ctx, frame, gx0, gy0, gx1, gy1) {
  const a = frame.project(gx0, gy0);
  const b = frame.project(gx1, gy0);
  const c = frame.project(gx1, gy1);
  const d = frame.project(gx0, gy1);
  poly(ctx, [a, b, c, d]);
  ctx.fillStyle = 'rgba(24, 24, 34, 0.14)';
  ctx.fill();
}

/* ==========================================================================
   各类型绘制
   ========================================================================== */

/** 电阻：米色柱体 + 三道色环 */
function drawResistor(ctx, comp, style) {
  const { frame, pinLabels } = style;
  void comp;

  drawContactShadow(ctx, frame, 0.15, 0.12, frame.w - 0.15, frame.h - 0.12);

  const body0 = 0.55;
  const body1 = frame.w - 0.55;
  const cy0 = 0.18;
  const cy1 = frame.h - 0.18;

  prism(ctx, frame, body0, cy0, body1, cy1, 9, '#e2d6b4', '#b8a87f', '#a0916c', 'rgba(60,52,36,0.45)');

  // 引线：从端子引到本体两端
  const leadColor = '#9aa0ae';
  const t1 = frame.project(0, 0);
  const t2 = frame.project(frame.w - 1, 0);
  const b1 = frame.project(body0, (cy0 + cy1) / 2);
  const b2 = frame.project(body1, (cy0 + cy1) / 2);
  drawLead(ctx, t1, b1, leadColor, 2);
  drawLead(ctx, t2, b2, leadColor, 2);

  // 色环（沿本体等距分布）
  const bands = ['#8c4a3c', '#c9772f', '#d8b34a'];
  const span = body1 - body0;
  bands.forEach((color, index) => {
    const gx = body0 + span * (0.24 + index * 0.2);
    const p0 = lift(frame.project(gx, cy0), 9);
    const p1 = lift(frame.project(gx, cy1), 9);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  });

  if (pinLabels) {
    drawPinLabel(ctx, t1, '1');
    drawPinLabel(ctx, t2, '2');
  }
}

/** LED：半透明灯珠 + 底座 */
function drawLed(ctx, comp, style) {
  const { frame, pinLabels } = style;
  const palette = { red: '#e2685f', green: '#5fd39a', yellow: '#f2c94c' };
  const color = palette[comp.params.color] || palette.red;

  drawContactShadow(ctx, frame, 0.15, 0.12, frame.w - 0.15, frame.h - 0.12);
  prism(ctx, frame, 0.28, 0.16, frame.w - 0.28, frame.h - 0.16, 4, '#3a3a48', '#23232d', '#1c1c25', 'rgba(0,0,0,0.5)');

  const center = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 5);
  const radius = Math.max(6, Math.min(frame.tileW * 0.42, 13));

  // 灯珠：外圈 + 高光
  ctx.beginPath();
  ctx.arc(center.x, center.y - radius * 0.55, radius, Math.PI, 0);
  ctx.lineTo(center.x + radius, center.y + 1);
  ctx.lineTo(center.x - radius, center.y + 1);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(center.x - radius * 0.3, center.y - radius * 0.9, radius * 0.26, radius * 0.4, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fill();

  // 引线
  drawLead(ctx, frame.project(0, 0), frame.project(0.3, frame.h / 2 - 0.5), '#9aa0ae', 1.6);
  drawLead(ctx, frame.project(frame.w - 1, 0), frame.project(frame.w - 0.3, frame.h / 2 - 0.5), '#9aa0ae', 1.6);

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), 'A');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), 'K');
  }
}

/** 开关：底座 + 可动拨杆（state 只影响外观，不参与仿真） */
function drawSwitch(ctx, comp, style) {
  const { frame, pinLabels } = style;
  drawContactShadow(ctx, frame, 0.15, 0.12, frame.w - 0.15, frame.h - 0.12);
  prism(ctx, frame, 0.22, 0.14, frame.w - 0.22, frame.h - 0.14, 6, '#4a4a5c', '#2e2e3b', '#262631', 'rgba(0,0,0,0.5)');

  const closed = comp.params.state === 'closed';
  const pivot = lift(frame.project(0.5, frame.h / 2 - 0.5), 7);
  const tip = lift(frame.project(frame.w - 0.62, frame.h / 2 - 0.5), closed ? 7 : 11);

  drawLead(ctx, pivot, tip, closed ? '#f2a93b' : '#9aa0b8', 3);

  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#c8ccd8';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = closed ? '#f2a93b' : '#c8ccd8';
  ctx.fill();

  drawLead(ctx, frame.project(0, 0), frame.project(0.22, frame.h / 2 - 0.5), '#9aa0ae', 1.6);
  drawLead(ctx, frame.project(frame.w - 1, 0), frame.project(frame.w - 0.22, frame.h / 2 - 0.5), '#9aa0ae', 1.6);

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), 'COM');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), 'NO');
  }
}

/** 电容：两片极板 */
function drawCapacitor(ctx, comp, style) {
  const { frame, pinLabels } = style;
  drawContactShadow(ctx, frame, 0.15, 0.12, frame.w - 0.15, frame.h - 0.12);
  prism(ctx, frame, 0.25, 0.16, frame.w - 0.25, frame.h - 0.16, 5, '#33405c', '#232c40', '#1b2334', 'rgba(0,0,0,0.5)');

  const mid = frame.w / 2;
  const plateTop = lift(frame.project(mid - 0.12, 0.1), 5);
  const plateBot = lift(frame.project(mid - 0.12, frame.h - 0.1), 5);
  const plateTop2 = lift(frame.project(mid + 0.12, 0.1), 5);
  const plateBot2 = lift(frame.project(mid + 0.12, frame.h - 0.1), 5);

  ctx.beginPath();
  ctx.moveTo(plateTop.x, plateTop.y);
  ctx.lineTo(plateBot.x, plateBot.y);
  ctx.moveTo(plateTop2.x, plateTop2.y);
  ctx.lineTo(plateBot2.x, plateBot2.y);
  ctx.strokeStyle = '#cfd6e6';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  drawLead(ctx, frame.project(0, 0), frame.project(mid - 0.3, frame.h / 2 - 0.5), '#9aa0ae', 1.6);
  drawLead(ctx, frame.project(frame.w - 1, 0), frame.project(mid + 0.3, frame.h / 2 - 0.5), '#9aa0ae', 1.6);

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), '1');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), '2');
  }
}

/** 74 系列 DIP 芯片壳：黑色本体 + 缺口 + 两排引脚 */
function drawIc(ctx, comp, style) {
  const { frame, pinLabels } = style;
  drawContactShadow(ctx, frame, 0.05, 0.55, frame.w - 0.05, frame.h - 0.55);
  prism(ctx, frame, 0.1, 0.55, frame.w - 0.1, frame.h - 0.55, 8, '#32323e', '#1e1e26', '#191920', 'rgba(0,0,0,0.55)');

  // 引脚：从本体边缘伸到端子
  const def = PARTS.ic74xx;
  const topCount = def.terminals.filter((t) => t.dy === 0).length;
  const pinColor = '#c2c7d4';
  for (let i = 0; i < topCount; i += 1) {
    const from = frame.project(0.1 + i, 0.55);
    const to = frame.project(i, 0);
    drawLead(ctx, from, to, pinColor, 1.6);
    const from2 = frame.project(0.1 + i, frame.h - 0.55);
    const to2 = frame.project(i, frame.h - 1);
    drawLead(ctx, from2, to2, pinColor, 1.6);
  }

  // 缺口：靠近 1 脚的半圆
  const notch = lift(frame.project(0.5, 0.55), 8);
  ctx.beginPath();
  ctx.arc(notch.x, notch.y, Math.max(2.5, frame.tileW * 0.13), 0, Math.PI * 2);
  ctx.fillStyle = '#12121a';
  ctx.fill();

  // 型号丝印
  const label = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 8);
  const size = Math.max(7, Math.min(11, frame.tileW * 0.3));
  ctx.font = `600 ${size}px "Cascadia Mono", Consolas, monospace`;
  ctx.fillStyle = 'rgba(226, 231, 242, 0.78)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(comp.params.type || '7408'), label.x, label.y);

  if (pinLabels) {
    const modelId = normalizeType(comp.params.type);
    def.terminals.forEach((t) => {
      const name = pinLabel(modelId, t.name);
      // 电源脚用琥珀色强调：接错 7/14 是实验台上最常见的"不工作"原因
      drawPinLabel(ctx, frame.project(t.dx, t.dy), name, t.name === '7' || t.name === '14');
    });
  }
}

/** 电压源：深色电源模块 + 顶面 ＋/− 标记 */
function drawVsource(ctx, comp, style) {
  drawSourceBase(ctx, style, true);
  const { frame, pinLabels } = style;
  const center = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 7);
  const size = Math.max(4.5, Math.min(8, frame.tileW * 0.42));
  const ink = '#f2a93b';

  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  // 长板（正极）
  ctx.beginPath();
  ctx.moveTo(center.x - size * 0.55, center.y - size * 0.7);
  ctx.lineTo(center.x - size * 0.55, center.y + size * 0.7);
  ctx.stroke();
  // 短板（负极）
  ctx.beginPath();
  ctx.moveTo(center.x + size * 0.55, center.y - size * 0.38);
  ctx.lineTo(center.x + size * 0.55, center.y + size * 0.38);
  ctx.stroke();

  const voltage = Number(comp.params.voltage);
  if (Number.isFinite(voltage) && voltage < 0) {
    // 反接：在模块下方画一个向下的箭头，避免只能靠端子小字辨认
    const tip = lift(frame.project(frame.w / 2 - 0.5, frame.h - 0.1), 6);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y - 5);
    ctx.lineTo(tip.x, tip.y + 3);
    ctx.moveTo(tip.x - 3, tip.y);
    ctx.lineTo(tip.x, tip.y + 3);
    ctx.lineTo(tip.x + 3, tip.y);
    ctx.stroke();
  }

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), '+');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), '−');
  }
}

/** 电流源：深色电源模块 + 顶面指向 − 端的箭头 */
function drawIsource(ctx, comp, style) {
  drawSourceBase(ctx, style, true);
  const { frame, pinLabels } = style;
  const center = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 7);
  const size = Math.max(5, Math.min(9, frame.tileW * 0.46));

  ctx.strokeStyle = '#6fb2d8';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(center.x - size * 0.75, center.y);
  ctx.lineTo(center.x + size * 0.55, center.y);
  ctx.moveTo(center.x + size * 0.15, center.y - size * 0.38);
  ctx.lineTo(center.x + size * 0.6, center.y);
  ctx.lineTo(center.x + size * 0.15, center.y + size * 0.38);
  ctx.stroke();

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), '+');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), '−');
  }
}

/** 逻辑电平开关：单端子拨动开关，拨杆抬起 = 高电平 */
function drawLogicSwitch(ctx, comp, style) {
  const { frame, pinLabels } = style;
  const hi = comp.params.state === 'hi';
  drawContactShadow(ctx, frame, 0.15, 0.12, frame.w - 0.15, frame.h - 0.12);
  prism(
    ctx, frame, 0.24, 0.14, frame.w - 0.24, frame.h - 0.14, 6,
    hi ? '#4a4433' : '#3a3a48', hi ? '#322d20' : '#26262f', hi ? '#272318' : '#1e1e26',
    'rgba(0,0,0,0.5)',
  );

  // 拨杆：低电平倒向左侧，高电平倒向右侧并抬高
  const base = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 6);
  const tipX = base.x + (hi ? 1 : -1) * Math.max(3, frame.tileW * 0.24);
  const tipY = base.y - Math.max(6, frame.tileH * 0.9);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(tipX, tipY);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = hi ? '#f2a93b' : '#9aa0b8';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(tipX, tipY, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = hi ? '#f2a93b' : '#c8ccd8';
  ctx.fill();

  // 高/低标记
  const mark = lift(frame.project(0.55, frame.h - 0.55), 6);
  ctx.font = `${Math.max(7, Math.min(9, frame.tileW * 0.3))}px "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hi ? 'rgba(242, 169, 59, 0.92)' : 'rgba(150, 158, 175, 0.9)';
  ctx.fillText(hi ? '1' : '0', mark.x, mark.y);

  drawLead(ctx, frame.project(frame.w - 1, 0), frame.project(frame.w - 0.26, frame.h / 2 - 0.5), '#9aa0ae', 1.6);

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), 'OUT');
  }
}

/** 脉冲源：按键帽 + 脉冲波形，按一次发一个上升沿 */
function drawPulse(ctx, comp, style) {
  const { frame, pinLabels } = style;
  drawSourceBase(ctx, style, false);

  const center = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 7);
  const radius = Math.max(4, Math.min(7, frame.tileW * 0.34));
  ctx.beginPath();
  ctx.arc(center.x, center.y - radius * 0.35, radius, 0, Math.PI * 2);
  ctx.fillStyle = comp.params.mode === 'toggle' ? '#4a6a8c' : '#5a5f74';
  ctx.fill();
  ctx.strokeStyle = 'rgba(210, 220, 240, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 键帽上的脉冲符号
  const w = radius * 0.55;
  ctx.beginPath();
  ctx.moveTo(center.x - w, center.y - radius * 0.35 + w * 0.5);
  ctx.lineTo(center.x - w * 0.3, center.y - radius * 0.35 + w * 0.5);
  ctx.lineTo(center.x - w * 0.3, center.y - radius * 0.35 - w * 0.5);
  ctx.lineTo(center.x + w * 0.4, center.y - radius * 0.35 - w * 0.5);
  ctx.lineTo(center.x + w * 0.4, center.y - radius * 0.35 + w * 0.5);
  ctx.lineTo(center.x + w, center.y - radius * 0.35 + w * 0.5);
  ctx.strokeStyle = '#e8eefc';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), '+');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), '−');
  }
}

/** 时钟源：方波图标 + 频率丝印 */
function drawClock(ctx, comp, style) {
  const { frame, pinLabels } = style;
  drawSourceBase(ctx, style, true);

  const center = lift(frame.project(frame.w / 2 - 0.5, frame.h / 2 - 0.5), 7);
  const size = Math.max(4, Math.min(7, frame.tileW * 0.34));

  ctx.beginPath();
  ctx.moveTo(center.x - size, center.y + size * 0.5);
  ctx.lineTo(center.x - size * 0.5, center.y + size * 0.5);
  ctx.lineTo(center.x - size * 0.5, center.y - size * 0.5);
  ctx.lineTo(center.x + size * 0.2, center.y - size * 0.5);
  ctx.lineTo(center.x + size * 0.2, center.y + size * 0.5);
  ctx.lineTo(center.x + size, center.y + size * 0.5);
  ctx.strokeStyle = '#7fd6c2';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const hz = Number(comp.params.frequency);
  if (Number.isFinite(hz)) {
    ctx.font = `${Math.max(6.5, Math.min(8.5, frame.tileW * 0.26))}px "Cascadia Mono", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180, 200, 215, 0.8)';
    ctx.fillText(`${hz}Hz`, center.x, center.y + size * 1.35);
  }

  if (pinLabels) {
    drawPinLabel(ctx, frame.project(0, 0), '+');
    drawPinLabel(ctx, frame.project(frame.w - 1, 0), 'GND');
  }
}

/** 电源类共用的底座：深色矮模块 + 两侧引线 */
function drawSourceBase(ctx, style, accent) {
  const { frame } = style;
  drawContactShadow(ctx, frame, 0.15, 0.12, frame.w - 0.15, frame.h - 0.12);
  prism(
    ctx, frame, 0.26, 0.14, frame.w - 0.26, frame.h - 0.14, 7,
    accent ? '#3d445c' : '#3a3a48', '#262c3c', '#1e2331', 'rgba(0,0,0,0.5)',
  );
  drawLead(ctx, frame.project(0, 0), frame.project(0.28, frame.h / 2 - 0.5), '#9aa0ae', 1.6);
  drawLead(ctx, frame.project(frame.w - 1, 0), frame.project(frame.w - 0.28, frame.h / 2 - 0.5), '#9aa0ae', 1.6);
}

/** 端子旁的小字标签 */
function drawPinLabel(ctx, point, text, highlight) {
  const size = 8.5;
  ctx.font = `${size}px "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = highlight ? 'rgba(242, 169, 59, 0.95)' : 'rgba(60, 66, 82, 0.85)';
  ctx.fillText(text, point.x, point.y - 7);
}

/* ==========================================================================
   类型注册表
   ========================================================================== */

export const PARTS = {
  resistor: {
    id: 'resistor',
    label: '电阻',
    group: '基础元件',
    size: { w: 3, h: 1 },
    terminals: [
      { name: '1', dx: 0, dy: 0, direction: 'bidir' },
      { name: '2', dx: 2, dy: 0, direction: 'bidir' },
    ],
    defaultParams: { resistance: 1000 },
    paramFields: [
      {
        key: 'resistance',
        label: '阻值',
        type: 'number',
        unit: 'kΩ',
        factor: 1000, // 存储单位 Ω，界面单位 kΩ
        step: 0.1,
        min: 0.001,
        max: 1000,
      },
    ],
    draw: drawResistor,
  },

  led: {
    id: 'led',
    label: 'LED',
    group: '基础元件',
    size: { w: 2, h: 1 },
    terminals: [
      { name: 'A', dx: 0, dy: 0, direction: 'in' },
      { name: 'K', dx: 1, dy: 0, direction: 'out' },
    ],
    defaultParams: { color: 'red' },
    paramFields: [
      {
        key: 'color',
        label: '颜色',
        type: 'select',
        options: [
          { value: 'red', label: '红色' },
          { value: 'green', label: '绿色' },
          { value: 'yellow', label: '黄色' },
        ],
      },
    ],
    draw: drawLed,
  },

  switch: {
    id: 'switch',
    label: '开关',
    group: '基础元件',
    size: { w: 2, h: 1 },
    terminals: [
      { name: 'COM', dx: 0, dy: 0, direction: 'bidir' },
      { name: 'NO', dx: 1, dy: 0, direction: 'bidir' },
    ],
    defaultParams: { state: 'open' },
    paramFields: [
      {
        key: 'state',
        label: '状态',
        type: 'select',
        options: [
          { value: 'open', label: '断开' },
          { value: 'closed', label: '闭合' },
        ],
      },
    ],
    draw: drawSwitch,
  },

  ic74xx: {
    id: 'ic74xx',
    label: '74LS 芯片',
    group: '集成电路',
    size: { w: 7, h: 3 },
    // 端子名就是**真实引脚号**（DIP-14）。逻辑功能（1A/1B/1Y…）由 digmodels 按
    // params.type 映射，所以七种芯片共用这一套 14 个端子，不需要每种重排。
    // 引脚 1..7 在顶边（1 在左），8..14 在底边（14 在最左）——与真实 DIP 封装一致。
    terminals: (() => {
      const list = [];
      for (let pin = 1; pin <= 14; pin += 1) {
        const isTop = pin <= 7;
        const col = isTop ? pin - 1 : 14 - pin;
        list.push({
          name: String(pin),
          dx: col,
          dy: isTop ? 0 : 2,
          direction: pin === 7 || pin === 14 ? 'power' : 'bidir',
          role: pin === 7 ? 'GND' : pin === 14 ? 'VCC' : 'io',
        });
      }
      return list;
    })(),
    defaultParams: { type: '74LS00' },
    paramFields: [
      {
        key: 'type',
        label: '型号',
        type: 'select',
        // 直接由数字模型表生成：两边不可能对不上
        options: DIG_MODEL_ORDER.map((id) => ({ value: id, label: DIG_MODELS[id].label })),
        // 旧存档写的是 7408 这种四位短号，显示时归一化到 74LS08
        normalize: (value) => normalizeType(value),
      },
    ],
    draw: drawIc,
  },

  capacitor: {
    id: 'capacitor',
    label: '电容',
    group: '基础元件',
    size: { w: 2, h: 1 },
    terminals: [
      { name: '1', dx: 0, dy: 0, direction: 'bidir' },
      { name: '2', dx: 1, dy: 0, direction: 'bidir' },
    ],
    defaultParams: { capacitance: 0.00001 },
    paramFields: [
      {
        key: 'capacitance',
        label: '容值',
        type: 'number',
        unit: 'μF',
        factor: 0.000001, // 存储单位 F，界面单位 μF
        step: 0.1,
        min: 0.001,
        max: 10000,
      },
    ],
    draw: drawCapacitor,
  },

  vsource: {
    id: 'vsource',
    label: '电压源',
    group: '电源',
    size: { w: 2, h: 1 },
    terminals: [
      { name: '+', dx: 0, dy: 0, direction: 'out' },
      { name: '-', dx: 1, dy: 0, direction: 'out' },
    ],
    defaultParams: { voltage: 5 },
    paramFields: [
      {
        key: 'voltage',
        label: '电压',
        type: 'number',
        unit: 'V',
        factor: 1, // 存储单位 V，界面单位 V
        step: 0.5,
        min: -30,
        max: 30,
      },
    ],
    draw: drawVsource,
  },

  isource: {
    id: 'isource',
    label: '电流源',
    group: '电源',
    size: { w: 2, h: 1 },
    terminals: [
      { name: '+', dx: 0, dy: 0, direction: 'out' },
      { name: '-', dx: 1, dy: 0, direction: 'out' },
    ],
    defaultParams: { current: 0.01 },
    paramFields: [
      {
        key: 'current',
        label: '电流',
        type: 'number',
        unit: 'mA',
        factor: 0.001, // 存储单位 A，界面单位 mA
        step: 1,
        min: -1000,
        max: 1000,
      },
    ],
    draw: drawIsource,
  },

  'logic-switch': {
    id: 'logic-switch',
    label: '逻辑电平开关',
    group: '数字实验箱',
    size: { w: 2, h: 1 },
    terminals: [
      { name: 'OUT', dx: 1, dy: 0, direction: 'out' },
    ],
    defaultParams: { state: 'lo' },
    paramFields: [
      {
        key: 'state',
        label: '电平',
        type: 'select',
        options: [
          { value: 'lo', label: '低电平 0' },
          { value: 'hi', label: '高电平 1' },
        ],
      },
    ],
    draw: drawLogicSwitch,
  },

  pulse: {
    id: 'pulse',
    label: '脉冲源',
    group: '数字实验箱',
    size: { w: 2, h: 1 },
    terminals: [
      { name: '+', dx: 0, dy: 0, direction: 'out' },
      { name: '-', dx: 1, dy: 0, direction: 'out' },
    ],
    defaultParams: { mode: 'momentary' },
    paramFields: [
      {
        key: 'mode',
        label: '方式',
        type: 'select',
        options: [
          { value: 'momentary', label: '按键脉冲（单次）' },
          { value: 'toggle', label: '翻转保持' },
        ],
      },
    ],
    draw: drawPulse,
  },

  clock: {
    id: 'clock',
    label: '时钟源',
    group: '数字实验箱',
    size: { w: 2, h: 1 },
    terminals: [
      { name: '+', dx: 0, dy: 0, direction: 'out' },
      { name: 'GND', dx: 1, dy: 0, direction: 'out' },
    ],
    defaultParams: { frequency: 1, duty: 50 },
    paramFields: [
      {
        key: 'frequency',
        label: '频率',
        type: 'number',
        unit: 'Hz',
        factor: 1,
        step: 1,
        min: 0.1,
        max: 1000,
      },
      {
        key: 'duty',
        label: '占空比',
        type: 'number',
        unit: '%',
        factor: 1,
        step: 5,
        min: 5,
        max: 95,
      },
    ],
    draw: drawClock,
  },
};

/** 元件库展示顺序 */
export const PART_ORDER = [
  'resistor',
  'led',
  'switch',
  'capacitor',
  'vsource',
  'isource',
  'logic-switch',
  'pulse',
  'clock',
  'ic74xx',
];

/** 取元件定义，未知类型返回 null */
export function getPart(type) {
  return Object.prototype.hasOwnProperty.call(PARTS, type) ? PARTS[type] : null;
}

/** 旋转后的占位尺寸（90° 交换宽高） */
export function footprintOf(def, rotation) {
  if (!def) return { w: 1, h: 1 };
  return rotation === 90
    ? { w: def.size.h, h: def.size.w }
    : { w: def.size.w, h: def.size.h };
}

/** 元件某端子的网格坐标（考虑旋转） */
export function terminalPos(comp, terminalName) {
  const def = getPart(comp.type);
  if (!def) return null;
  const terminal = def.terminals.find((item) => item.name === terminalName);
  if (!terminal) return null;
  if (comp.rotation === 90) {
    return { x: comp.x + (def.size.h - 1 - terminal.dy), y: comp.y + terminal.dx };
  }
  return { x: comp.x + terminal.dx, y: comp.y + terminal.dy };
}

/** 元件全部端子的网格坐标 */
export function terminalPositions(comp) {
  const def = getPart(comp.type);
  if (!def) return [];
  return def.terminals.map((terminal) => ({
    name: terminal.name,
    direction: terminal.direction,
    ...terminalPos(comp, terminal.name),
  }));
}

/**
 * 在元件库小画布上用同一套 draw 函数画图标。
 * 让图标与画布上的实物保持同一视觉语言，避免维护两套素材。
 */
export function drawPaletteIcon(canvas, type, colors) {
  const def = getPart(type);
  if (!def || !canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 44;
  const cssH = canvas.clientHeight || 30;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const tileW = 9;
  const tileH = 4.5;
  const fw = def.size.w;
  const fh = def.size.h;
  const spanX = (fw + fh) * tileW / 2;
  const startX = (cssW - spanX) / 2 + fh * tileW / 2;
  const startY = (cssH - (fw + fh) * tileH / 2) / 2 + (fw + fh) * tileH / 4 - 3;

  const frame = {
    w: fw,
    h: fh,
    tileW,
    tileH,
    project: (dx, dy) => ({
      x: startX + (dx - dy) * tileW / 2,
      y: startY + (dx + dy) * tileH / 2,
    }),
  };

  const style = {
    frame,
    theme: colors || {},
    scale: 0.3, // 图标尺度：隐藏引脚小字
    pinLabels: false,
    selected: false,
    hover: false,
  };

  ctx.save();
  def.draw(ctx, { type, params: { ...def.defaultParams }, rotation: 0 }, style);
  ctx.restore();
}
