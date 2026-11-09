import type { ItemId } from '../types';

export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function randRange(a: number, b: number) {
  return a + Math.random() * (b - a);
}
export function randInt(a: number, b: number) {
  return Math.floor(randRange(a, b + 1));
}

export function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function angleTo(x1: number, y1: number, x2: number, y2: number) {
  return Math.atan2(y2 - y1, x2 - x1);
}

/** 归一化到 [-PI, PI] */
export function angleDiff(a: number, b: number) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function lerpAngle(a: number, b: number, t: number) {
  return a + angleDiff(b, a) * t;
}

export function circleRect(x: number, y: number, r: number, rect: { x: number; y: number; w: number; h: number }) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function setPixelText(ctx: CanvasRenderingContext2D, size: number) {
  ctx.font = `${size}px "Noto Serif SC","Songti SC","STSong",serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

/* ------------------------------------------------------------------ */
/*  道具图标：用 Canvas 画 32×32 像素图，避免额外资源                  */
/* ------------------------------------------------------------------ */
const ICON_COLORS: Record<string, string[]> = {};

export function drawItemIcon(ctx: CanvasRenderingContext2D, id: ItemId, size: number) {
  const s = size / 32;
  ctx.save();
  ctx.scale(s, s);
  ctx.imageSmoothingEnabled = false;
  const R = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  switch (id) {
    case 'herb': {
      R(14, 6, 3, 22, '#2f6b46');
      R(8, 10, 7, 3, '#4d9c63');
      R(8, 10, 3, 8, '#4d9c63');
      R(18, 14, 7, 3, '#66b878');
      R(22, 14, 3, 8, '#66b878');
      R(12, 24, 7, 4, '#8c5a3c');
      R(10, 28, 12, 3, '#6d4227');
      break;
    }
    case 'bloodsand': {
      R(9, 14, 14, 13, '#5b2b2b');
      R(7, 12, 18, 4, '#7a3a34');
      R(10, 7, 3, 8, '#a33b36');
      R(15, 4, 3, 11, '#c2483f');
      R(20, 8, 3, 7, '#8f302e');
      R(12, 27, 8, 3, '#3d1c1c');
      R(13, 17, 6, 3, '#d95a4c');
      break;
    }
    case 'bone': {
      R(8, 20, 5, 5, '#e6ddc4');
      R(12, 16, 4, 4, '#d8cfb4');
      R(15, 13, 9, 4, '#efe8d2');
      R(22, 10, 5, 5, '#e6ddc4');
      R(6, 22, 3, 3, '#c9bfa4');
      break;
    }
    case 'ghostfire': {
      R(13, 8, 6, 16, '#2fc6b5');
      R(10, 13, 4, 10, '#2fc6b5');
      R(18, 12, 4, 11, '#2fc6b5');
      R(14, 5, 4, 8, '#8af7e6');
      R(12, 16, 8, 8, '#55e2cf');
      R(14, 12, 4, 6, '#d8fffa');
      R(10, 19, 4, 4, '#1d8b80');
      R(18, 19, 4, 4, '#1d8b80');
      break;
    }
    case 'pill_heal': {
      R(11, 9, 10, 16, '#e8e2d2');
      R(9, 7, 14, 4, '#b7a98d');
      R(12, 13, 8, 10, '#c23c40');
      R(13, 14, 3, 3, '#f0a0a0');
      R(12, 23, 8, 3, '#8f2b2e');
      break;
    }
    case 'pill_chi': {
      R(11, 9, 10, 16, '#dfe6ef');
      R(9, 7, 14, 4, '#8d9aae');
      R(12, 13, 8, 10, '#356fb8');
      R(13, 14, 2, 3, '#9cc6f2');
      R(12, 23, 8, 3, '#234c85');
      break;
    }
    case 'pill_speed': {
      R(6, 12, 12, 4, '#3c8a5a');
      R(10, 8, 12, 4, '#4fa96d');
      R(14, 16, 12, 4, '#6fc98a');
      R(20, 12, 5, 3, '#2f6b46');
      R(8, 20, 6, 3, '#9ad9ad');
      break;
    }
    case 'pill_guard': {
      R(10, 6, 12, 4, '#c8a24a');
      R(8, 10, 16, 12, '#9a7526');
      R(11, 12, 10, 8, '#e3c073');
      R(14, 14, 4, 4, '#6b4f16');
      R(12, 22, 8, 3, '#7d5d1d');
      break;
    }
    case 'key': {
      R(8, 10, 7, 7, '#b08a3e');
      R(10, 12, 3, 3, '#1a1d24');
      R(14, 13, 12, 3, '#c9a34f');
      R(22, 16, 3, 5, '#c9a34f');
      R(17, 16, 3, 4, '#c9a34f');
      break;
    }
    case 'talisman': {
      R(12, 5, 9, 22, '#25222a');
      R(10, 7, 13, 3, '#8f2b2e');
      R(10, 24, 13, 3, '#8f2b2e');
      R(14, 11, 5, 11, '#b3382f');
      R(15, 13, 3, 7, '#f0c05a');
      break;
    }
  }
  ctx.restore();
  void ICON_COLORS;
}

export function makeIconCanvas(id: ItemId, size: number) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  drawItemIcon(ctx, id, size);
  return c;
}
