import type { GameRef } from './api';
import type { EnemyKind, ItemId } from '../types';
import { TAU, angleDiff, angleTo, clamp, dist, randRange } from '../core/utils';

interface EnemyCfg {
  hp: number;
  speed: number;
  r: number;
  damage: number;
  aggro: number;
  range: number;
  windup: number;
  recover: number;
  cd: number;
  money: [number, number];
  drops: [ItemId, number, number][];
  keepDistance?: number;
}

const CFG: Record<'wolf' | 'ghost' | 'monk', EnemyCfg> = {
  wolf: {
    hp: 54,
    speed: 142,
    r: 13,
    damage: 11,
    aggro: 330,
    range: 58,
    windup: 0.38,
    recover: 0.5,
    cd: 1.25,
    money: [6, 13],
    drops: [
      ['bone', 0.62, 1],
      ['bloodsand', 0.18, 1],
    ],
  },
  ghost: {
    hp: 44,
    speed: 78,
    r: 14,
    damage: 10,
    aggro: 400,
    range: 320,
    windup: 0.6,
    recover: 0.6,
    cd: 2.1,
    money: [10, 18],
    drops: [['ghostfire', 0.6, 1]],
    keepDistance: 210,
  },
  monk: {
    hp: 118,
    speed: 70,
    r: 17,
    damage: 19,
    aggro: 270,
    range: 76,
    windup: 0.72,
    recover: 0.7,
    cd: 1.9,
    money: [16, 26],
    drops: [
      ['bloodsand', 0.55, 1],
      ['bone', 0.4, 1],
      ['herb', 0.18, 1],
    ],
  },
};

export class Enemy {
  kind: 'wolf' | 'ghost' | 'monk';
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  aggro: number;
  attackRange: number;
  windupT: number;
  recoverT: number;
  attackCd: number;
  money: [number, number];
  drops: [ItemId, number, number][];
  keepDistance = 0;

  state: 'idle' | 'chase' | 'windup' | 'strike' | 'recover' = 'idle';
  t = 0;
  cd = randRange(0.4, 1.2);
  facing = 0;
  dead = false;
  hurtT = 0;
  kbx = 0;
  kby = 0;
  wanderT = 0;
  wanderAngle = Math.random() * TAU;
  lockAngle = 0;
  lockX = 0;
  lockY = 0;
  struck = false;
  elite: boolean;
  name?: string;
  key?: string;
  animT = Math.random() * 10;

  constructor(kind: 'wolf' | 'ghost' | 'monk', x: number, y: number, elite = false, name?: string, key?: string) {
    const cfg = CFG[kind];
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.homeX = x;
    this.homeY = y;
    this.r = cfg.r * (elite ? 1.3 : 1);
    this.maxHp = cfg.hp * (elite ? 2.2 : 1);
    this.hp = this.maxHp;
    this.speed = cfg.speed * (elite ? 0.9 : 1);
    this.damage = cfg.damage * (elite ? 1.35 : 1);
    this.aggro = cfg.aggro;
    this.attackRange = cfg.range;
    this.windupT = cfg.windup;
    this.recoverT = cfg.recover;
    this.attackCd = cfg.cd;
    this.money = cfg.money;
    this.drops = cfg.drops;
    this.keepDistance = cfg.keepDistance ?? 0;
    this.elite = elite;
    this.name = name;
    this.key = key;
  }

  update(dt: number, game: GameRef) {
    if (this.dead) return;
    this.animT += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (Math.abs(this.kbx) > 1 || Math.abs(this.kby) > 1) {
      const p = game.world.collide(this.x + this.kbx * dt, this.y + this.kby * dt, this.r);
      this.x = p.x;
      this.y = p.y;
      this.kbx *= 1 - Math.min(1, dt * 10);
      this.kby *= 1 - Math.min(1, dt * 10);
    }

    const player = game.player;
    if (player.dead) {
      this.state = 'idle';
      return;
    }
    const d = dist(this.x, this.y, player.x, player.y);
    const a = angleTo(this.x, this.y, player.x, player.y);

    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = randRange(1.4, 3.4);
          this.wanderAngle = Math.random() * TAU;
        }
        if (d < this.aggro) {
          this.state = 'chase';
          break;
        }
        if (dist(this.x, this.y, this.homeX, this.homeY) > 120) {
          this.wanderAngle = angleTo(this.x, this.y, this.homeX, this.homeY);
        }
        this.move(this.wanderAngle, this.speed * 0.32, dt, game);
        break;
      }
      case 'chase': {
        this.facing = a;
        this.cd -= dt;
        if (this.keepDistance > 0) {
          if (d < this.keepDistance * 0.8) this.move(a + Math.PI, this.speed, dt, game);
          else if (d > this.keepDistance * 1.15) this.move(a, this.speed, dt, game);
          else {
            const side = this.animT % 4 < 2 ? 1 : -1;
            this.move(a + Math.PI / 2 * side, this.speed * 0.5, dt, game);
          }
        } else {
          this.move(a, this.speed, dt, game);
        }
        if (d < this.attackRange && this.cd <= 0) {
          this.state = 'windup';
          this.t = this.windupT;
          this.lockAngle = a;
          this.lockX = player.x;
          this.lockY = player.y;
          this.struck = false;
        }
        break;
      }
      case 'windup': {
        this.facing = this.lockAngle;
        this.t -= dt;
        if (this.kind === 'ghost') {
          this.facing = angleTo(this.x, this.y, player.x, player.y);
          this.lockX = player.x;
          this.lockY = player.y;
        }
        if (this.t <= 0) {
          this.strike(game);
        }
        break;
      }
      case 'strike': {
        this.t -= dt;
        if (this.kind === 'wolf') {
          this.move(this.lockAngle, 470, dt, game);
          if (!this.struck && dist(this.x, this.y, player.x, player.y) < this.r + player.r + 14) {
            this.struck = true;
            player.takeDamage(this.damage, this.x, this.y, game);
          }
        }
        if (this.t <= 0) {
          this.state = 'recover';
          this.t = this.recoverT;
          this.cd = this.attackCd;
        }
        break;
      }
      case 'recover': {
        this.t -= dt;
        if (this.t <= 0) this.state = 'chase';
        break;
      }
    }
    this.x = clamp(this.x, this.r, game.region.w - this.r);
    this.y = clamp(this.y, this.r, game.region.h - this.r);
  }

  private move(angle: number, speed: number, dt: number, game: GameRef) {
    const p = game.world.collide(this.x + Math.cos(angle) * speed * dt, this.y + Math.sin(angle) * speed * dt, this.r);
    this.x = p.x;
    this.y = p.y;
  }

  private strike(game: GameRef) {
    const player = game.player;
    if (this.kind === 'wolf') {
      this.state = 'strike';
      this.t = 0.22;
      this.struck = false;
      this.state = 'strike';
      game.fx.slash(this.x, this.y - 4, this.lockAngle, 62, '#ff6a5a', 1.2, 5, 0.3);
      game.audio.swing();
      return;
    }
    if (this.kind === 'monk') {
      game.fx.ring(this.lockX, this.lockY, 10, 88, 'rgba(255,120,80,0.7)', 4, 0.4, true);
      game.fx.burst(this.lockX, this.lockY, {
        count: 18,
        color: '#c9a06a',
        color2: '#ff9a6a',
        speed: 180,
        size: 3,
        life: 0.5,
        shape: 'smoke',
        glow: false,
      });
      game.shake(6);
      game.audio.hit();
      if (dist(this.lockX, this.lockY, player.x, player.y) < 88 + player.r) {
        player.takeDamage(this.damage, this.lockX, this.lockY, game);
      }
      this.state = 'recover';
      this.t = this.recoverT;
      this.cd = this.attackCd;
      return;
    }
    // ghost
    const ang = angleTo(this.x, this.y - 18, this.lockX, this.lockY);
    game.spawnProjectile(this.x, this.y - 18, ang, 300, this.damage, 'fire');
    game.fx.burst(this.x, this.y - 18, {
      count: 12,
      color: '#63e0cf',
      color2: '#d8fffa',
      speed: 90,
      size: 2.6,
      life: 0.5,
    });
    game.audio.swing();
    this.state = 'recover';
    this.t = this.recoverT;
    this.cd = this.attackCd;
  }

  takeDamage(amount: number, angle: number, game: GameRef) {
    if (this.dead) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;
    this.hurtT = 0.16;
    this.kbx += Math.cos(angle) * 150;
    this.kby += Math.sin(angle) * 150;
    game.fx.text(this.x + randRange(-6, 6), this.y - 40, `${dmg}`, this.elite ? '#ffd889' : '#ffffff', this.elite ? 18 : 15);
    game.fx.burst(this.x, this.y - 10, {
      count: 6,
      color: '#ff8a6a',
      color2: '#ffe6c8',
      speed: 150,
      size: 2.2,
      life: 0.3,
      angle,
      spread: 1.8,
    });
    this.state = 'chase';
    this.cd = Math.max(this.cd, 0.35);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(game);
    }
  }

  private die(game: GameRef) {
    this.dead = true;
    game.fx.burst(this.x, this.y - 10, {
      count: this.elite ? 46 : 22,
      color: this.kind === 'ghost' ? '#63e0cf' : '#c94a3f',
      color2: '#ffd0a0',
      speed: this.elite ? 260 : 180,
      size: 3,
      life: 0.9,
      grav: -30,
      shape: 'shard',
    });
    game.fx.ring(this.x, this.y, 8, this.elite ? 110 : 54, 'rgba(255,160,110,0.6)', 3, 0.5);
    game.onEnemyKilled(this);
  }

  draw(ctx: CanvasRenderingContext2D, time: number) {
    if (this.dead) return;
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    // shadow
    ctx.globalAlpha = 0.36;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 4, this.r + 4, 6, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.state === 'windup') this.drawTelegraph(ctx);

    const flip = Math.cos(this.facing) < 0 ? -1 : 1;
    if (this.kind === 'wolf') this.drawWolf(ctx, time, flip);
    else if (this.kind === 'ghost') this.drawGhost(ctx, time);
    else this.drawMonk(ctx, time, flip);

    // 血条
    if (this.hp < this.maxHp) {
      const w = this.elite ? 74 : 38;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(-w / 2, -this.r - (this.kind === 'ghost' ? 52 : 44), w, 5);
      ctx.fillStyle = this.elite ? '#e0b85a' : '#c8453f';
      ctx.fillRect(-w / 2 + 1, -this.r - (this.kind === 'ghost' ? 52 : 44) + 1, (w - 2) * (this.hp / this.maxHp), 3);
    }
    if (this.name) {
      ctx.font = '13px "Noto Serif SC","Songti SC",serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.elite ? '#f0cf87' : '#dfe6ef';
      ctx.fillText(this.name, 0, -this.r - (this.kind === 'ghost' ? 62 : 52));
    }
    ctx.restore();
  }

  private drawTelegraph(ctx: CanvasRenderingContext2D) {
    const p = 1 - this.t / this.windupT;
    const pulse = 0.25 + Math.sin(p * 18) * 0.12 + p * 0.15;
    if (this.kind === 'ghost') {
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(this.lockX - this.x, this.lockY - this.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (this.kind === 'monk') {
      ctx.save();
      ctx.globalAlpha = pulse * 0.8;
      ctx.fillStyle = 'rgba(255,80,60,0.22)';
      ctx.strokeStyle = '#ff6a4a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.lockX - this.x, this.lockY - this.y, 88, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.rotate(this.lockAngle);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(255,80,60,0.25)';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.arc(0, 0, 74, -0.7, 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawWolf(ctx: CanvasRenderingContext2D, time: number, flip: number) {
    const crouch = this.state === 'windup' ? 0.8 : 1;
    ctx.save();
    ctx.scale(flip * (this.elite ? 1.3 : 1), crouch);
    ctx.fillStyle = this.hurtT > 0 ? '#e8b0a0' : '#1d2026';
    ctx.beginPath();
    ctx.ellipse(0, -12, 20, 11, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.hurtT > 0 ? '#f0c4b4' : '#262a32';
    ctx.beginPath();
    ctx.ellipse(14, -16, 10, 8, -0.2, 0, TAU);
    ctx.fill();
    // 耳朵
    ctx.fillStyle = '#15181d';
    ctx.beginPath();
    ctx.moveTo(16, -23);
    ctx.lineTo(21, -31);
    ctx.lineTo(24, -22);
    ctx.closePath();
    ctx.fill();
    // 腿
    const stride = Math.sin(this.animT * 12) * 4;
    ctx.fillStyle = '#14171c';
    ctx.fillRect(-14, -6, 4, 10 + stride * 0.3);
    ctx.fillRect(-4, -6, 4, 10 - stride * 0.3);
    ctx.fillRect(8, -6, 4, 10 + stride * 0.3);
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(-14, 3 + stride * 0.3, 5, 3);
    ctx.fillRect(7, 3 - stride * 0.3, 5, 3);
    // 尾巴
    ctx.strokeStyle = '#1d2026';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-19, -14);
    ctx.quadraticCurveTo(-30, -18 + Math.sin(time * 4) * 3, -32, -26);
    ctx.stroke();
    // 眼睛
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff4d3a';
    ctx.beginPath();
    ctx.arc(19, -18, 1.8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,90,60,0.3)';
    ctx.beginPath();
    ctx.arc(19, -18, 6, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawGhost(ctx: CanvasRenderingContext2D, time: number) {
    const bob = Math.sin(time * 2 + this.animT) * 4;
    ctx.save();
    ctx.translate(0, bob);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(70,220,200,0.10)';
    ctx.beginPath();
    ctx.arc(0, -20, 26, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = this.hurtT > 0 ? '#d8d0c0' : '#121820';
    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.quadraticCurveTo(-16, -34, 0, -40);
    ctx.quadraticCurveTo(16, -34, 13, 0);
    ctx.lineTo(6, -6);
    ctx.lineTo(2, 1);
    ctx.lineTo(-3, -5);
    ctx.lineTo(-8, 2);
    ctx.closePath();
    ctx.fill();

    // 内里幽火
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(84,230,210,0.8)';
    ctx.beginPath();
    ctx.ellipse(0, -20, 5, 8, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(210,255,250,0.9)';
    ctx.beginPath();
    ctx.ellipse(0, -22, 2, 4, 0, 0, TAU);
    ctx.fill();
    // 面具
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#e8e2d2';
    ctx.beginPath();
    ctx.ellipse(0, -35, 7, 9, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#20242a';
    ctx.fillRect(-4, -37, 2, 1.6);
    ctx.fillRect(2, -37, 2, 1.6);
    ctx.fillStyle = '#8f2b33';
    ctx.fillRect(-1, -30, 2, 3);
    ctx.restore();
  }

  private drawMonk(ctx: CanvasRenderingContext2D, time: number, flip: number) {
    ctx.save();
    ctx.scale(flip * (this.elite ? 1.3 : 1), 1);
    const sway = Math.sin(this.animT * 3) * 1.5;
    // 破袈裟
    ctx.fillStyle = this.hurtT > 0 ? '#e0b8a8' : this.elite ? '#4a3a2a' : '#2c2a26';
    ctx.beginPath();
    ctx.moveTo(-14, 2);
    ctx.lineTo(-11, -30);
    ctx.lineTo(0, -36);
    ctx.lineTo(11, -30);
    ctx.lineTo(15, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = this.elite ? '#a8843e' : '#5d4432';
    ctx.fillRect(-13, -12, 26, 4);
    // 头
    ctx.fillStyle = this.hurtT > 0 ? '#f0d0c0' : '#8a8070';
    ctx.beginPath();
    ctx.arc(0, -40, 7.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#3a3228';
    ctx.fillRect(-6, -44, 12, 5);
    // 绷带眼
    ctx.strokeStyle = '#d8cdb0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-7, -40);
    ctx.lineTo(7, -41);
    ctx.stroke();
    // 佛珠
    ctx.fillStyle = '#6a4a32';
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3;
      ctx.beginPath();
      ctx.arc(Math.sin(a) * 10, -24 + Math.cos(a) * 3, 1.6, 0, TAU);
      ctx.fill();
    }
    // 禅杖
    ctx.save();
    ctx.translate(15, -18);
    ctx.rotate(0.18 + sway * 0.02);
    ctx.fillStyle = '#5a4632';
    ctx.fillRect(-2, -36, 4, 66);
    ctx.fillStyle = this.elite ? '#e0b85a' : '#8c7a50';
    ctx.beginPath();
    ctx.arc(0, -38, 7, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (this.elite) {
      ctx.strokeStyle = 'rgba(230,190,100,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -18, 24, 30, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}

export class Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  kind: 'fire' | 'soul' | 'blade';
  dead = false;
  life = 4;
  r = 8;
  angle = 0;
  trailTimer = 0;

  constructor(x: number, y: number, angle: number, speed: number, damage: number, kind: 'fire' | 'soul' | 'blade') {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.kind = kind;
    this.angle = angle;
  }

  update(dt: number, game: GameRef) {
    if (this.dead) return;
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.04;
      game.fx.embers(this.x, this.y, 1, this.kind === 'fire' ? '#5fe6d2' : this.kind === 'soul' ? '#ff5a4a' : '#9fdcff');
    }
    if (this.life <= 0) {
      this.dead = true;
      return;
    }
    if (game.world.pointBlocked(this.x, this.y)) {
      this.dead = true;
      game.fx.burst(this.x, this.y, { count: 8, color: '#8fe8dc', speed: 90, size: 2.4, life: 0.3 });
      return;
    }
    const p = game.player;
    if (!p.dead && dist(this.x, this.y, p.x, p.y - 12) < this.r + p.r) {
      this.dead = true;
      p.takeDamage(this.damage, this.x, this.y, game);
      game.fx.burst(this.x, this.y, {
        count: 12,
        color: this.kind === 'fire' ? '#5fe6d2' : '#ff5a4a',
        color2: '#ffe0c0',
        speed: 160,
        size: 2.6,
        life: 0.4,
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, time: number) {
    if (this.dead) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalCompositeOperation = 'lighter';
    const color = this.kind === 'fire' ? '#63e8d6' : this.kind === 'soul' ? '#ff5a4a' : '#9fdcff';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 9 + Math.sin(time * 20) * 1.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f0fffb';
    ctx.beginPath();
    ctx.ellipse(0, 0, 3, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
