import { randRange, roundRect, setPixelText } from './utils';

type Shape = 'dot' | 'spark' | 'ember' | 'smoke' | 'petal' | 'shard';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  grav: number;
  shape: Shape;
  rot: number;
  spin: number;
  glow: boolean;
}

interface Ghost {
  x: number;
  y: number;
  angle: number;
  life: number;
  max: number;
  color: string;
}

interface Slash {
  x: number;
  y: number;
  angle: number;
  range: number;
  arc: number;
  life: number;
  max: number;
  color: string;
  width: number;
  sweep: number;
}

interface RingFx {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  fill: boolean;
}

interface LineFx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

interface TextFx {
  x: number;
  y: number;
  vy: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface RuneFx {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
  rot: number;
}

export interface BurstOptions {
  count?: number;
  color?: string;
  color2?: string;
  speed?: number;
  size?: number;
  life?: number;
  grav?: number;
  drag?: number;
  shape?: Shape;
  angle?: number;
  spread?: number;
  glow?: boolean;
}

export class FX {
  particles: Particle[] = [];
  ghosts: Ghost[] = [];
  slashes: Slash[] = [];
  rings: RingFx[] = [];
  lines: LineFx[] = [];
  texts: TextFx[] = [];
  runes: RuneFx[] = [];

  clear() {
    this.particles.length = 0;
    this.ghosts.length = 0;
    this.slashes.length = 0;
    this.rings.length = 0;
    this.lines.length = 0;
    this.texts.length = 0;
    this.runes.length = 0;
  }

  burst(x: number, y: number, o: BurstOptions = {}) {
    const count = o.count ?? 12;
    const baseAngle = o.angle ?? 0;
    const spread = o.spread ?? Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (Math.random() - 0.5) * spread;
      const sp = (o.speed ?? 160) * randRange(0.35, 1.2);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: (o.life ?? 0.6) * randRange(0.6, 1.2),
        max: o.life ?? 0.6,
        size: (o.size ?? 3) * randRange(0.6, 1.5),
        color: Math.random() < 0.35 && o.color2 ? o.color2 : o.color ?? '#ff5a5a',
        drag: o.drag ?? 3,
        grav: o.grav ?? 0,
        shape: o.shape ?? 'spark',
        rot: Math.random() * 6.28,
        spin: randRange(-8, 8),
        glow: o.glow ?? true,
      });
    }
    if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900);
  }

  embers(x: number, y: number, n = 8, color = '#ff7a45') {
    this.burst(x, y, {
      count: n,
      color,
      color2: '#ffd27a',
      speed: 70,
      size: 2.6,
      life: 1.4,
      grav: -26,
      drag: 1.2,
      shape: 'ember',
    });
  }

  slash(x: number, y: number, angle: number, range: number, color = '#ff4d5a', arc = 2.1, width = 8, sweep = 0.5) {
    this.slashes.push({ x, y, angle, range, arc, life: 0.24, max: 0.24, color, width, sweep });
    this.burst(x + Math.cos(angle) * range * 0.65, y + Math.sin(angle) * range * 0.65, {
      count: 7,
      color,
      color2: '#fff2c8',
      speed: 220,
      size: 2,
      life: 0.3,
      angle,
      spread: 1.4,
    });
  }

  ring(x: number, y: number, r0: number, r1: number, color = '#ffe3a8', width = 4, life = 0.5, fill = false) {
    this.rings.push({ x, y, r0, r1, life, max: life, color, width, fill });
  }

  line(x1: number, y1: number, x2: number, y2: number, color = '#ff5c5c', width = 3, life = 0.3) {
    this.lines.push({ x1, y1, x2, y2, life, max: life, color, width });
  }

  text(x: number, y: number, text: string, color = '#fff3d2', size = 16) {
    this.texts.push({ x, y, vy: -38, text, life: 0.85, max: 0.85, color, size });
  }

  ghost(x: number, y: number, angle: number, color = 'rgba(90,220,255,0.55)') {
    this.ghosts.push({ x, y, angle, life: 0.28, max: 0.28, color });
  }

  rune(x: number, y: number, r: number, color = '#ff9a52', life = 0.9) {
    this.runes.push({ x, y, r, life, max: life, color, rot: Math.random() * 6.28 });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vx -= p.vx * p.drag * dt;
      p.vy -= p.vy * p.drag * dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1);
    }
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].life -= dt;
      if (this.slashes[i].life <= 0) this.slashes.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      this.lines[i].life -= dt;
      if (this.lines[i].life <= 0) this.lines.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 1 - 2.4 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.runes.length - 1; i >= 0; i--) {
      this.runes[i].life -= dt;
      if (this.runes[i].life <= 0) this.runes.splice(i, 1);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    // runes
    for (const r of this.runes) {
      const p = 1 - r.life / r.max;
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot + p * 0.8);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - p) * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r.r * (0.55 + p * 0.45), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r.r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r.r * 0.8, Math.sin(a) * r.r * 0.8);
        ctx.lineTo(Math.cos(a) * r.r * 0.96, Math.sin(a) * r.r * 0.96);
        ctx.stroke();
      }
      ctx.restore();
    }

    // rings
    for (const r of this.rings) {
      const p = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * p;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - p;
      if (r.fill) {
        ctx.fillStyle = r.color;
        ctx.globalAlpha = (1 - p) * 0.16;
        ctx.beginPath();
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1 - p;
      }
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - p * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // slashes
    for (const s of this.slashes) {
      const p = 1 - s.life / s.max;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.globalCompositeOperation = 'lighter';
      const a = Math.pow(1 - p, 0.7);
      ctx.globalAlpha = a;
      ctx.strokeStyle = s.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = s.width * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, s.range, -s.arc / 2 + p * s.sweep, s.arc / 2 + p * s.sweep);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = '#fff6e0';
      ctx.lineWidth = s.width * 0.32 * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, s.range * 0.96, -s.arc / 2 + p * s.sweep, s.arc / 2 + p * s.sweep);
      ctx.stroke();
      ctx.restore();
    }

    // lines
    for (const l of this.lines) {
      const p = 1 - l.life / l.max;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = l.color;
      ctx.lineWidth = l.width * (1 - p * 0.5);
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.stroke();
      ctx.restore();
    }

    // ghosts
    for (const g of this.ghosts) {
      const p = 1 - g.life / g.max;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.globalAlpha = (1 - p) * 0.5;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.moveTo(-9, 10);
      ctx.lineTo(-6, -18);
      ctx.lineTo(0, -24);
      ctx.lineTo(6, -18);
      ctx.lineTo(9, 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(Math.cos(g.angle) * 22, -8 + Math.sin(g.angle) * 14);
      ctx.stroke();
      ctx.restore();
    }

    // particles
    for (const p of this.particles) {
      const t = Math.max(0, p.life / p.max);
      ctx.save();
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, t * 1.4);
      ctx.fillStyle = p.color;
      if (p.shape === 'dot') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'spark') {
        const len = p.size * 4;
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-len / 2, -p.size * 0.35, len * t, p.size * 0.7 * t + 0.6);
      } else if (p.shape === 'smoke') {
        ctx.globalAlpha = t * 0.35;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (2.2 - t), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'petal') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        roundRect(ctx, -p.size, -p.size * 0.5, p.size * 2, p.size, p.size * 0.4);
        ctx.fill();
      } else if (p.shape === 'shard') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 1.6);
        ctx.lineTo(p.size, 0);
        ctx.lineTo(0, p.size * 1.6);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // floating texts
    for (const t of this.texts) {
      const a = Math.min(1, t.life / t.max + 0.2);
      ctx.save();
      ctx.globalAlpha = a;
      setPixelText(ctx, t.size);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(8,10,14,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
      ctx.restore();
    }
  }
}
