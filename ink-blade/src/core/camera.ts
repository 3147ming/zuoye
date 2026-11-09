import { clamp } from './utils';

export class Camera {
  cx = 0;
  cy = 0;
  zoom = 1;
  shake = 0;
  sx = 0;
  sy = 0;
  pulse = 0;
  viewW: number;
  viewH: number;

  constructor(viewW: number, viewH: number) {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  snap(x: number, y: number) {
    this.cx = x;
    this.cy = y;
  }

  punch(amount: number) {
    this.pulse = Math.max(this.pulse, amount);
  }

  addShake(amount: number) {
    this.shake = Math.min(34, this.shake + amount);
  }

  update(dt: number, tx: number, ty: number, worldW: number, worldH: number) {
    this.pulse = Math.max(0, this.pulse - dt * 4.2);
    const zoomTarget = 1 + this.pulse * 0.05;
    this.zoom += (zoomTarget - this.zoom) * Math.min(1, dt * 12);

    const halfW = this.viewW / (2 * this.zoom);
    const halfH = this.viewH / (2 * this.zoom);
    let dx = tx;
    let dy = ty;
    if (worldW > halfW * 2) dx = clamp(dx, halfW, worldW - halfW);
    else dx = worldW / 2;
    if (worldH > halfH * 2) dy = clamp(dy, halfH, worldH - halfH);
    else dy = worldH / 2;

    const k = 1 - Math.exp(-9 * dt);
    this.cx += (dx - this.cx) * k;
    this.cy += (dy - this.cy) * k;

    this.shake = Math.max(0, this.shake - dt * 46);
    const s = this.shake;
    this.sx = (Math.random() * 2 - 1) * s;
    this.sy = (Math.random() * 2 - 1) * s;
  }

  apply(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.viewW / 2 + this.sx, this.viewH / 2 + this.sy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.cx, -this.cy);
  }

  restore(ctx: CanvasRenderingContext2D) {
    ctx.restore();
  }

  screenToWorld(sx: number, sy: number) {
    const x = (sx - this.viewW / 2 - this.sx) / this.zoom + this.cx;
    const y = (sy - this.viewH / 2 - this.sy) / this.zoom + this.cy;
    return { x, y };
  }
}
