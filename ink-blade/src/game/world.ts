import type { ChestDef, NodeDef, PropDef, RegionDef } from '../types';
import { circleRect, clamp, mulberry32, TAU, randRange } from '../core/utils';

export interface RuntimeNode {
  def: NodeDef;
  alive: boolean;
  timer: number;
}

export interface RuntimeChest {
  def: ChestDef;
  opened: boolean;
}

export interface LightSource {
  x: number;
  y: number;
  r: number;
  color: string;
  flicker?: number;
}

export interface GroundDecal {
  x: number;
  y: number;
  r: number;
  color: string;
  alpha: number;
  kind: 'stain' | 'crack' | 'moss';
}

const DEFAULT_SIZE: Partial<Record<PropDef['kind'], [number, number]>> = {
  tree: [30, 20],
  deadwood: [28, 18],
  rock: [30, 22],
  boulder: [46, 34],
  lantern: [12, 10],
  torch: [12, 10],
  bamboo: [26, 18],
  statue: [50, 34],
  pillar: [30, 26],
  well: [66, 46],
  stall: [120, 60],
  bones: [20, 12],
  shrine: [54, 36],
  censer: [40, 28],
  brazier: [34, 24],
  fence: [52, 14],
};

function propSize(p: PropDef) {
  const d = DEFAULT_SIZE[p.kind] ?? [24, 18];
  return { w: p.w ?? d[0], h: p.h ?? d[1] };
}

export function propRect(p: PropDef) {
  const s = propSize(p);
  return { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h };
}

export class World {
  region: RegionDef;
  nodes: RuntimeNode[] = [];
  chests: RuntimeChest[] = [];
  decals: GroundDecal[] = [];

  constructor(region: RegionDef, openedChests: Set<string>, goneNodes: Set<string>) {
    this.region = region;
    this.nodes = region.nodes.map((def) => ({
      def,
      alive: !goneNodes.has(def.id),
      timer: 0,
    }));
    this.chests = region.chests.map((def) => ({ def, opened: openedChests.has(def.id) }));
    this.buildDecals();
  }

  private buildDecals() {
    const rng = mulberry32(
      this.region.id === 'town' ? 111 : this.region.id === 'forest' ? 222 : this.region.id === 'temple' ? 333 : 444,
    );
    const count = this.region.id === 'forest' ? 90 : 55;
    for (let i = 0; i < count; i++) {
      const kindRoll = rng();
      this.decals.push({
        x: rng() * this.region.w,
        y: rng() * this.region.h,
        r: 20 + rng() * 70,
        color: kindRoll > 0.72 ? 'rgba(120,150,110,0.16)' : 'rgba(6,8,12,0.35)',
        alpha: 0.35 + rng() * 0.4,
        kind: kindRoll > 0.72 ? 'moss' : kindRoll > 0.5 ? 'crack' : 'stain',
      });
    }
  }

  collide(x: number, y: number, r: number) {
    let px = clamp(x, r, this.region.w - r);
    let py = clamp(y, r, this.region.h - r);
    for (let iter = 0; iter < 2; iter++) {
      for (const p of this.region.props) {
        if (!p.solid) continue;
        const rect = propRect(p);
        if (!circleRect(px, py, r, rect)) continue;
        const cx = clamp(px, rect.x, rect.x + rect.w);
        const cy = clamp(py, rect.y, rect.y + rect.h);
        const dx = px - cx;
        const dy = py - cy;
        const d = Math.hypot(dx, dy);
        if (d < 0.001) {
          const left = px - rect.x;
          const right = rect.x + rect.w - px;
          const top = py - rect.y;
          const bottom = rect.y + rect.h - py;
          const m = Math.min(left, right, top, bottom);
          if (m === left) px = rect.x - r;
          else if (m === right) px = rect.x + rect.w + r;
          else if (m === top) py = rect.y - r;
          else py = rect.y + rect.h + r;
        } else {
          const push = r - d;
          px += (dx / d) * push;
          py += (dy / d) * push;
        }
      }
    }
    return { x: px, y: py };
  }

  pointBlocked(x: number, y: number) {
    if (x < 0 || y < 0 || x > this.region.w || y > this.region.h) return true;
    for (const p of this.region.props) {
      if (!p.solid) continue;
      const rect = propRect(p);
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return true;
    }
    return false;
  }

  update(dt: number) {
    for (const n of this.nodes) {
      if (!n.alive) {
        n.timer -= dt;
        if (n.timer <= 0) n.alive = true;
      }
    }
  }

  drawGround(ctx: CanvasRenderingContext2D, pattern: CanvasPattern | null, time: number) {
    const r = this.region;
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, r.w, r.h);
    } else {
      ctx.fillStyle = '#1b2028';
      ctx.fillRect(0, 0, r.w, r.h);
    }
    // 地面墨渍
    for (const d of this.decals) {
      ctx.save();
      ctx.globalAlpha = d.alpha;
      if (d.kind === 'stain') {
        ctx.fillStyle = '#05070b';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r, d.r * 0.55, 0, 0, TAU);
        ctx.fill();
      } else if (d.kind === 'moss') {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r * 0.7, d.r * 0.4, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + d.r * 0.6, d.y + d.r * 0.3);
        ctx.lineTo(d.x + d.r * 0.9, d.y - d.r * 0.2);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 边界暗角
    const g = ctx.createRadialGradient(r.w / 2, r.h / 2, Math.min(r.w, r.h) * 0.25, r.w / 2, r.h / 2, Math.max(r.w, r.h) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, r.w, r.h);

    // 区域色调
    ctx.fillStyle = r.tint;
    ctx.fillRect(0, 0, r.w, r.h);

    // 飘浮薄雾
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const t = time * 0.05 + i * 1.7;
      const x = ((Math.sin(t) * 0.5 + 0.5) * r.w + i * 260) % r.w;
      const y = ((Math.cos(t * 0.7) * 0.5 + 0.5) * r.h + i * 190) % r.h;
      const rad = 150 + i * 30;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, 'rgba(120,150,160,0.025)');
      grad.addColorStop(1, 'rgba(120,150,160,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  drawProp(ctx: CanvasRenderingContext2D, p: PropDef, time: number) {
    const s = p.scale ?? 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(s, s);
    const flick = 0.85 + Math.sin(time * 9 + p.x * 0.1) * 0.15;

    switch (p.kind) {
      case 'house': {
        const w = p.w ?? 280;
        const h = p.h ?? 160;
        // 墙体
        ctx.fillStyle = '#201d1a';
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.fillStyle = '#2a241f';
        ctx.fillRect(-w / 2, -h, w, 16);
        // 窗户
        for (let i = -1; i <= 1; i++) {
          const wx = i * (w / 3.4);
          ctx.fillStyle = '#3a2a1c';
          ctx.fillRect(wx - 22, -h * 0.62, 44, 32);
          ctx.fillStyle = `rgba(230,150,70,${0.5 + Math.sin(time * 3 + i) * 0.1})`;
          ctx.fillRect(wx - 18, -h * 0.62 + 4, 16, 24);
          ctx.fillStyle = 'rgba(255,200,120,0.25)';
          ctx.fillRect(wx + 2, -h * 0.62 + 4, 16, 24);
        }
        // 门
        ctx.fillStyle = '#17130f';
        ctx.fillRect(-22, -66, 44, 66);
        ctx.fillStyle = '#8f2b2e';
        ctx.fillRect(-3, -40, 6, 16);
        // 屋顶
        ctx.fillStyle = '#151a20';
        ctx.beginPath();
        ctx.moveTo(-w / 2 - 26, -h);
        ctx.quadraticCurveTo(-w / 2 + 20, -h - 34, 0, -h - 42);
        ctx.quadraticCurveTo(w / 2 - 20, -h - 34, w / 2 + 26, -h);
        ctx.lineTo(w / 2 + 8, -h + 10);
        ctx.lineTo(-w / 2 - 8, -h + 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#232b33';
        for (let i = 0; i < 8; i++) {
          ctx.fillRect(-w / 2 + i * (w / 7) - 6, -h - 24, 8, 22);
        }
        // 檐灯
        ctx.fillStyle = 'rgba(255,120,60,0.9)';
        ctx.beginPath();
        ctx.arc(-w / 2 + 12, -h + 24, 4, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(w / 2 - 12, -h + 24, 4, 0, TAU);
        ctx.fill();
        // 牌匾
        ctx.fillStyle = '#3a2a1e';
        ctx.fillRect(-46, -h - 12, 92, 22);
        ctx.strokeStyle = '#8a6a3a';
        ctx.strokeRect(-46, -h - 12, 92, 22);
        ctx.fillStyle = '#d8b87a';
        ctx.font = '13px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(['酒', '药', '铁', '当'][p.variant ?? 0], 0, -h - 1);
        break;
      }
      case 'tree': {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 22, 8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2a1c18';
        ctx.fillRect(-4, -46, 8, 48);
        ctx.strokeStyle = '#2a1c18';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -34);
        ctx.lineTo(-14, -50);
        ctx.moveTo(0, -40);
        ctx.lineTo(13, -54);
        ctx.stroke();
        const sway = Math.sin(time * 1.2 + p.x) * 4;
        const blobs: [number, number, number, string][] = [
          [-14 + sway, -62, 20, '#3b2026'],
          [12 + sway, -70, 24, '#4a2529'],
          [1 + sway, -84, 22, '#5a2b2f'],
          [-2 + sway, -64, 18, '#6b3434'],
        ];
        for (const [bx, by, br, col] of blobs) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(180,80,80,0.25)';
        ctx.beginPath();
        ctx.arc(4 + sway, -82, 9, 0, TAU);
        ctx.fill();
        break;
      }
      case 'deadwood': {
        ctx.strokeStyle = '#241a16';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -40);
        ctx.lineTo(-14, -56);
        ctx.moveTo(0, -32);
        ctx.lineTo(16, -50);
        ctx.moveTo(-6, -46);
        ctx.lineTo(-20, -46);
        ctx.moveTo(12, -44);
        ctx.lineTo(22, -58);
        ctx.stroke();
        break;
      }
      case 'rock':
      case 'boulder': {
        const big = p.kind === 'boulder';
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 2, big ? 28 : 18, big ? 10 : 6, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2d333c';
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(-14, -22);
        ctx.lineTo(2, -30);
        ctx.lineTo(18, -18);
        ctx.lineTo(20, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#3b444f';
        ctx.beginPath();
        ctx.moveTo(-14, -22);
        ctx.lineTo(2, -30);
        ctx.lineTo(8, -16);
        ctx.lineTo(-6, -12);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'lantern': {
        ctx.fillStyle = '#2c231c';
        ctx.fillRect(-2, -48, 4, 48);
        ctx.fillStyle = '#3a2a20';
        ctx.fillRect(-9, -50, 18, 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,110,50,${0.9 * flick})`;
        ctx.beginPath();
        ctx.ellipse(0, -40, 8, 10, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,180,90,0.2)';
        ctx.beginPath();
        ctx.arc(0, -40, 24 * flick, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#8f2b2e';
        ctx.fillRect(-1, -52, 2, 4);
        break;
      }
      case 'torch': {
        ctx.fillStyle = '#2c231c';
        ctx.fillRect(-2, -34, 4, 34);
        ctx.globalCompositeOperation = 'lighter';
        const fh = 12 + Math.sin(time * 12 + p.x) * 3;
        ctx.fillStyle = 'rgba(255,120,40,0.9)';
        ctx.beginPath();
        ctx.ellipse(0, -38, 5, fh, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,220,140,0.95)';
        ctx.beginPath();
        ctx.ellipse(0, -37, 2.5, fh * 0.6, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,140,60,0.16)';
        ctx.beginPath();
        ctx.arc(0, -38, 26, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'brazier': {
        ctx.fillStyle = '#2a2622';
        ctx.fillRect(-2, -18, 4, 18);
        ctx.fillRect(-10, -2, 20, 3);
        ctx.fillStyle = '#3b332a';
        ctx.beginPath();
        ctx.ellipse(0, -22, 16, 7, 0, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,110,40,${0.85 * flick})`;
        ctx.beginPath();
        ctx.ellipse(0, -30, 11, 15 * flick, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,215,130,0.9)';
        ctx.beginPath();
        ctx.ellipse(0, -29, 5, 8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,120,50,0.14)';
        ctx.beginPath();
        ctx.arc(0, -28, 40 * flick, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'bamboo': {
        ctx.strokeStyle = '#3f5a3a';
        ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) {
          const bx = -12 + i * 8;
          const bh = 40 + i * 9;
          ctx.beginPath();
          ctx.moveTo(bx, 0);
          ctx.lineTo(bx + Math.sin(time + i) * 2, -bh);
          ctx.stroke();
          ctx.fillStyle = '#4f7047';
          for (let j = 0; j < 3; j++) {
            ctx.beginPath();
            ctx.ellipse(bx + 6, -bh + j * 10, 8, 2.5, -0.5, 0, TAU);
            ctx.fill();
          }
        }
        break;
      }
      case 'grass': {
        ctx.strokeStyle = 'rgba(70,90,60,0.7)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          const gx = -10 + i * 4;
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.quadraticCurveTo(gx + Math.sin(time + i) * 4, -8, gx + Math.sin(time + i) * 7, -14 - (i % 3) * 4);
          ctx.stroke();
        }
        break;
      }
      case 'statue': {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 3, 26, 9, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2b3038';
        ctx.fillRect(-22, -8, 44, 10);
        ctx.fillStyle = '#343b44';
        ctx.beginPath();
        ctx.arc(0, -30, 12, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-18, -8);
        ctx.quadraticCurveTo(-14, -30, 0, -30);
        ctx.quadraticCurveTo(14, -30, 18, -8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(150,180,190,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, -30, 16, 0, TAU);
        ctx.stroke();
        break;
      }
      case 'pillar': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 16, 6, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2b313a';
        ctx.fillRect(-9, -66, 18, 68);
        ctx.fillStyle = '#3a424d';
        ctx.fillRect(-7, -64, 6, 64);
        ctx.fillStyle = '#252b33';
        ctx.fillRect(-13, -70, 26, 7);
        ctx.fillRect(-13, -4, 26, 6);
        ctx.strokeStyle = 'rgba(150,170,190,0.18)';
        ctx.beginPath();
        ctx.moveTo(-2, -60);
        ctx.lineTo(2, -46);
        ctx.lineTo(-3, -34);
        ctx.stroke();
        break;
      }
      case 'banner': {
        ctx.fillStyle = '#2a211a';
        ctx.fillRect(-1.5, -70, 3, 70);
        ctx.fillStyle = '#5a2026';
        const sway = Math.sin(time * 2 + p.y) * 3;
        ctx.beginPath();
        ctx.moveTo(1, -66);
        ctx.lineTo(15 + sway, -62);
        ctx.lineTo(13 + sway, -18);
        ctx.lineTo(1, -22);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d8b87a';
        ctx.font = '9px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.fillText('烬', 7 + sway * 0.6, -40);
        break;
      }
      case 'well': {
        ctx.fillStyle = '#2a2e35';
        ctx.beginPath();
        ctx.ellipse(0, 0, 34, 16, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0a0d11';
        ctx.beginPath();
        ctx.ellipse(0, 0, 25, 10, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#4a3a2a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-28, -6);
        ctx.lineTo(-28, -48);
        ctx.moveTo(28, -6);
        ctx.lineTo(28, -48);
        ctx.moveTo(-30, -46);
        ctx.lineTo(30, -46);
        ctx.stroke();
        ctx.fillStyle = '#3a2c20';
        ctx.beginPath();
        ctx.moveTo(-38, -46);
        ctx.lineTo(0, -62);
        ctx.lineTo(38, -46);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'stall': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 58, 12, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2c2119';
        ctx.fillRect(-54, -34, 8, 34);
        ctx.fillRect(46, -34, 8, 34);
        ctx.fillStyle = '#382a20';
        ctx.fillRect(-58, -36, 116, 10);
        // 遮棚
        ctx.fillStyle = '#4a2428';
        ctx.beginPath();
        ctx.moveTo(-66, -52);
        ctx.lineTo(66, -52);
        ctx.lineTo(52, -74);
        ctx.lineTo(-52, -74);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(210,180,120,0.25)';
        for (let i = -2; i <= 2; i++) ctx.fillRect(i * 22, -74, 8, 22);
        // 药罐
        ctx.fillStyle = '#c9b48a';
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(-40 + i * 22, -46, 10, 12);
          ctx.fillStyle = '#8a6a4a';
          ctx.fillRect(-40 + i * 22, -49, 10, 4);
          ctx.fillStyle = '#c9b48a';
        }
        break;
      }
      case 'censer': {
        ctx.fillStyle = '#2c2a26';
        ctx.fillRect(-3, -10, 3, 10);
        ctx.fillRect(4, -10, 3, 10);
        ctx.fillRect(0, -8, 3, 10);
        ctx.fillStyle = '#5a4a32';
        ctx.beginPath();
        ctx.ellipse(0, -16, 17, 9, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#9aa8a0';
        for (let i = 0; i < 3; i++) {
          const t = (time * 0.4 + i * 0.33) % 1;
          ctx.beginPath();
          ctx.arc(Math.sin(t * 6 + i) * 10, -30 - t * 40, 4 + t * 8, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'bones': {
        ctx.fillStyle = '#c9c0a8';
        ctx.beginPath();
        ctx.arc(0, -4, 5, 0, TAU);
        ctx.fill();
        ctx.fillRect(-8, 1, 16, 2);
        ctx.fillRect(-6, -8, 2, 9);
        ctx.fillRect(4, -8, 2, 9);
        ctx.fillStyle = '#a89e84';
        ctx.fillRect(-13, -2, 8, 2);
        ctx.fillRect(6, 3, 9, 2);
        break;
      }
      case 'shrine': {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 28, 9, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2c2b2e';
        ctx.fillRect(-26, -6, 52, 9);
        ctx.fillStyle = '#3a383c';
        ctx.fillRect(-20, -30, 40, 25);
        ctx.fillStyle = '#4a474a';
        ctx.fillRect(-24, -34, 48, 6);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,190,90,${0.9 * flick})`;
        ctx.beginPath();
        ctx.ellipse(0, -40, 5, 8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,180,80,0.18)';
        ctx.beginPath();
        ctx.arc(0, -40, 36 * flick, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'gate': {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 2, 50, 10, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2a211a';
        ctx.fillRect(-44, -96, 9, 96);
        ctx.fillRect(35, -96, 9, 96);
        ctx.fillStyle = '#3a2c20';
        ctx.fillRect(-52, -104, 104, 12);
        ctx.fillRect(-46, -86, 92, 7);
        ctx.fillStyle = '#4a2428';
        ctx.beginPath();
        ctx.moveTo(-50, -104);
        ctx.lineTo(50, -104);
        ctx.lineTo(60, -118);
        ctx.lineTo(-60, -118);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d8b87a';
        ctx.font = '15px "Noto Serif SC",serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('烬', 0, -97);
        break;
      }
      case 'fence': {
        ctx.strokeStyle = '#3a2c20';
        ctx.lineWidth = 3;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 12, 0);
          ctx.lineTo(i * 12, -20);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-26, -12);
        ctx.lineTo(26, -12);
        ctx.stroke();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  drawPortal(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    time: number,
    unlocked: boolean,
    near: boolean,
  ) {
    ctx.save();
    ctx.translate(x, y);
    const color = unlocked ? 'rgba(255,180,100,' : 'rgba(200,60,50,';
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const p = (time * 0.6 + i / 3) % 1;
      ctx.globalAlpha = (1 - p) * (unlocked ? 0.5 : 0.32);
      ctx.strokeStyle = color + '1)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 26 + p * 70, 9 + p * 24, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = unlocked ? 0.5 : 0.24;
    ctx.fillStyle = color + '1)';
    ctx.beginPath();
    ctx.ellipse(0, -60, 5, 60, 0, 0, TAU);
    ctx.fill();
    if (near) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = unlocked ? '#ffe0b0' : '#ff8a7a';
      ctx.font = '15px "Noto Serif SC",serif';
      ctx.textAlign = 'center';
      ctx.fillText(unlocked ? '可前往' : '封闭', 0, -128);
    }
    ctx.restore();
  }

  drawNode(ctx: CanvasRenderingContext2D, n: RuntimeNode, time: number) {
    if (!n.alive) return;
    ctx.save();
    ctx.translate(n.def.x, n.def.y);
    const pulse = 0.7 + Math.sin(time * 3 + n.def.x) * 0.3;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = n.def.item === 'ghostfire' ? 'rgba(90,230,210,0.14)' : 'rgba(120,230,140,0.12)';
    ctx.beginPath();
    ctx.arc(0, -10, 26 * pulse, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    if (n.def.item === 'ghostfire') {
      ctx.fillStyle = '#63e8d6';
      ctx.beginPath();
      ctx.ellipse(0, -16, 5, 9, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#d8fffa';
      ctx.beginPath();
      ctx.ellipse(0, -18, 2, 4, 0, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#4d9c63';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(0, -22);
      ctx.moveTo(0, -10);
      ctx.lineTo(-8, -18);
      ctx.moveTo(0, -14);
      ctx.lineTo(8, -22);
      ctx.stroke();
      ctx.fillStyle = '#7ad08e';
      ctx.beginPath();
      ctx.ellipse(-8, -19, 5, 2.6, -0.6, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(8, -23, 5, 2.6, 0.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawChest(ctx: CanvasRenderingContext2D, c: RuntimeChest, time: number) {
    ctx.save();
    ctx.translate(c.def.x, c.def.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 2, 18, 6, 0, 0, TAU);
    ctx.fill();
    if (!c.opened) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(240,190,90,0.1)';
      ctx.beginPath();
      ctx.arc(0, -12, 28 + Math.sin(time * 3) * 4, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(-15, -20, 30, 20);
    ctx.fillStyle = '#4d3822';
    ctx.fillRect(-15, -24, 30, 8);
    ctx.fillStyle = '#c9a34f';
    ctx.fillRect(-2.5, -20, 5, 12);
    ctx.fillRect(-15, -16, 30, 2.5);
    if (c.opened) {
      ctx.fillStyle = '#15110c';
      ctx.fillRect(-13, -18, 26, 10);
      ctx.fillStyle = '#4d3822';
      ctx.fillRect(-15, -28, 30, 6);
    }
    ctx.restore();
  }

  lights(time: number): LightSource[] {
    const out: LightSource[] = [];
    for (const p of this.region.props) {
      if (p.kind === 'lantern') out.push({ x: p.x, y: p.y - 40, r: 130, color: 'rgba(255,150,80,0.9)', flicker: 0.6 });
      else if (p.kind === 'torch') out.push({ x: p.x, y: p.y - 38, r: 150, color: 'rgba(255,140,70,0.9)', flicker: 0.8 });
      else if (p.kind === 'brazier') out.push({ x: p.x, y: p.y - 30, r: 190, color: 'rgba(255,120,60,0.95)', flicker: 0.8 });
      else if (p.kind === 'shrine') out.push({ x: p.x, y: p.y - 40, r: 170, color: 'rgba(255,200,120,0.9)', flicker: 0.4 });
      else if (p.kind === 'house') {
        const w = p.w ?? 280;
        out.push({ x: p.x - w * 0.28, y: p.y - 40, r: 90, color: 'rgba(255,160,80,0.6)' });
        out.push({ x: p.x, y: p.y - 100, r: 80, color: 'rgba(255,150,70,0.5)' });
      }
    }
    for (const n of this.nodes) {
      if (n.alive) {
        out.push({
          x: n.def.x,
          y: n.def.y - 12,
          r: n.def.item === 'ghostfire' ? 90 : 60,
          color: n.def.item === 'ghostfire' ? 'rgba(90,230,210,0.8)' : 'rgba(120,230,140,0.5)',
          flicker: 0.3,
        });
      }
    }
    for (const p of this.region.portals) {
      out.push({ x: p.x, y: p.y, r: 170, color: 'rgba(255,170,90,0.7)', flicker: 0.3 });
    }
    void time;
    return out;
  }
}
