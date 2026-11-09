import type { GameRef } from './api';
import { TAU, angleDiff, angleTo, dist, lerpAngle, randRange } from '../core/utils';

type BossState = 'intro' | 'idle' | 'windup' | 'dash' | 'combo' | 'ring' | 'recover' | 'phase' | 'ultimate';

interface Spike {
  x: number;
  y: number;
  t: number;
  max: number;
  r: number;
  triggered: boolean;
  life: number;
}

const WINDUP: Record<string, number> = {
  dash: 0.72,
  combo: 0.48,
  ring: 0.95,
  spikes: 0.6,
  summon: 0.75,
  ultimate: 1.05,
};

export class Boss {
  x: number;
  y: number;
  r = 30;
  hp = 1000;
  maxHp = 1000;
  phase = 1;
  dead = false;
  state: BossState = 'intro';
  t = 1.6;
  cd = 1.4;
  facing = 0;
  attack = '';
  lockAngle = 0;
  invuln = 1.4;
  hurtT = 0;
  animT = 0;

  ringR = 60;
  ringHit = false;
  dashHit = false;
  comboFlags = [true, true, true];
  spikes: Spike[] = [];
  ultTimer = 0;
  ultWave = 0;
  summonCount = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.facing = Math.PI / 2;
  }

  update(dt: number, game: GameRef) {
    if (this.dead) return;
    this.animT += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    // 地刺
    for (const s of this.spikes) {
      if (!s.triggered) {
        s.t -= dt;
        if (s.t <= 0) {
          s.triggered = true;
          s.life = 0.4;
          game.fx.ring(s.x, s.y, 8, s.r + 10, 'rgba(255,90,60,0.9)', 5, 0.35, true);
          game.fx.burst(s.x, s.y, {
            count: 20,
            color: '#ff5a3a',
            color2: '#ffd27a',
            speed: 240,
            size: 3,
            life: 0.6,
            grav: -60,
            shape: 'shard',
          });
          game.shake(7);
          game.audio.hit();
          if (dist(s.x, s.y, game.player.x, game.player.y) < s.r + game.player.r) {
            game.player.takeDamage(20, s.x, s.y, game);
          }
        }
      } else {
        s.life -= dt;
      }
    }
    this.spikes = this.spikes.filter((s) => !s.triggered || s.life > 0);

    const p = game.player;
    if (p.dead) {
      this.state = 'idle';
      return;
    }
    const d = dist(this.x, this.y, p.x, p.y);
    const a = angleTo(this.x, this.y, p.x, p.y);
    if (this.state !== 'dash' && this.state !== 'combo') {
      this.facing = lerpAngle(this.facing, a, Math.min(1, dt * 2.4));
    }

    switch (this.state) {
      case 'intro':
        this.t -= dt;
        if (this.t <= 0) {
          this.state = 'idle';
          this.cd = 1.0;
        }
        break;
      case 'idle': {
        if (d > 300) this.move(a, 92, dt, game);
        else if (d < 140) this.move(a + Math.PI, 64, dt, game);
        this.cd -= dt;
        if (this.cd <= 0) this.chooseAttack(game);
        break;
      }
      case 'windup': {
        this.t -= dt;
        if (this.t <= 0) this.execute(game);
        break;
      }
      case 'dash': {
        this.t -= dt;
        this.move(this.lockAngle, 820, dt, game);
        game.fx.embers(this.x, this.y, 2, '#ff4a3a');
        if (!this.dashHit && d < this.r + p.r + 14) {
          this.dashHit = true;
          p.takeDamage(24, this.x, this.y, game);
          game.fx.slash(this.x, this.y, this.lockAngle, 90, '#ff4a3a', 2.4, 12, 0.6);
        }
        if (this.t <= 0) this.recover(0.55);
        break;
      }
      case 'combo': {
        this.t -= dt;
        const thresholds = [1.02, 0.68, 0.34];
        for (let i = 0; i < 3; i++) {
          if (!this.comboFlags[i] && this.t <= thresholds[i]) {
            this.comboFlags[i] = true;
            const ang = angleTo(this.x, this.y, p.x, p.y);
            this.facing = lerpAngle(this.facing, ang, 0.55);
            game.fx.slash(this.x + Math.cos(this.facing) * 30, this.y + Math.sin(this.facing) * 30, this.facing, 120, '#ff4a4a', 2.2, 12, 0.7);
            game.shake(6);
            game.audio.swing();
            if (d < 145 && Math.abs(angleDiff(this.facing, ang)) < 1.5) {
              p.takeDamage(15, this.x, this.y, game);
            }
          }
        }
        if (this.t <= 0) this.recover(0.5);
        break;
      }
      case 'ring': {
        this.t -= dt;
        this.ringR += 560 * dt;
        if (!this.ringHit && Math.abs(d - this.ringR) < 30) {
          this.ringHit = true;
          p.takeDamage(20, this.x, this.y, game);
        }
        if (this.t <= 0) this.recover(0.55);
        break;
      }
      case 'ultimate': {
        this.t -= dt;
        this.ultTimer -= dt;
        if (this.ultTimer <= 0 && this.ultWave < 3) {
          this.ultTimer = 0.34;
          const offset = this.ultWave * 0.18;
          for (let i = 0; i < 12; i++) {
            const ang = (i / 12) * TAU + offset + this.animT;
            game.spawnProjectile(this.x, this.y - 10, ang, 240, 12, 'soul');
          }
          this.ultWave++;
          game.shake(8);
          game.audio.skill2();
        }
        if (this.t <= 0) this.recover(0.7);
        break;
      }
      case 'phase': {
        this.t -= dt;
        if (this.t <= 0) {
          this.state = 'idle';
          this.cd = 0.9;
        }
        break;
      }
      case 'recover': {
        this.t -= dt;
        if (this.t <= 0) {
          this.state = 'idle';
          this.cd = 0.5;
        }
        break;
      }
    }
  }

  private move(angle: number, sp: number, dt: number, game: GameRef) {
    const pos = game.world.collide(this.x + Math.cos(angle) * sp * dt, this.y + Math.sin(angle) * sp * dt, this.r);
    this.x = pos.x;
    this.y = pos.y;
  }

  private recover(t: number) {
    this.state = 'recover';
    this.t = t;
  }

  private chooseAttack(game: GameRef) {
    const r = Math.random();
    let attack = 'combo';
    if (this.phase === 1) {
      attack = r < 0.36 ? 'dash' : r < 0.7 ? 'combo' : 'ring';
    } else if (this.phase === 2) {
      attack = r < 0.24 ? 'dash' : r < 0.48 ? 'combo' : r < 0.68 ? 'ring' : r < 0.87 ? 'spikes' : 'summon';
    } else {
      attack = r < 0.18 ? 'dash' : r < 0.36 ? 'combo' : r < 0.52 ? 'ring' : r < 0.72 ? 'spikes' : r < 0.88 ? 'summon' : 'ultimate';
    }
    if (attack === 'summon' && this.summonCount >= 3) attack = 'combo';
    this.attack = attack;
    this.state = 'windup';
    this.t = WINDUP[attack] ?? 0.7;
    this.lockAngle = angleTo(this.x, this.y, game.player.x, game.player.y);
    game.audio.bossRoar();
  }

  private execute(game: GameRef) {
    const p = game.player;
    if (this.attack === 'dash') {
      this.state = 'dash';
      this.t = 0.3;
      this.dashHit = false;
      this.lockAngle = angleTo(this.x, this.y, p.x, p.y);
      game.audio.skill1();
    } else if (this.attack === 'combo') {
      this.state = 'combo';
      this.t = 1.3;
      this.comboFlags = [false, false, false];
      game.audio.skill1();
    } else if (this.attack === 'ring') {
      this.state = 'ring';
      this.t = 0.7;
      this.ringR = 60;
      this.ringHit = false;
      game.audio.skill3();
      game.fx.ring(this.x, this.y, 50, 90, 'rgba(255,80,60,0.6)', 4, 0.4);
    } else if (this.attack === 'spikes') {
      for (let i = 0; i < 3; i++) {
        const bx = p.x + randRange(-26, 26) * i;
        const by = p.y + randRange(-26, 26) * i;
        this.spikes.push({ x: bx, y: by, t: 0.5 + i * 0.3, max: 0.5 + i * 0.3, r: 48, triggered: false, life: 0 });
      }
      game.audio.bossRoar();
      this.recover(1.15);
    } else if (this.attack === 'summon') {
      this.summonCount++;
      for (let i = 0; i < 2; i++) {
        const ang = Math.random() * TAU;
        game.spawnEnemy('ghost', this.x + Math.cos(ang) * 90, this.y + Math.sin(ang) * 90);
      }
      game.fx.rune(this.x, this.y, 100, '#ff5a4a', 0.8);
      game.fx.ring(this.x, this.y, 30, 140, 'rgba(255,70,60,0.7)', 4, 0.6);
      game.audio.bossRoar();
      this.recover(1.0);
    } else if (this.attack === 'ultimate') {
      this.state = 'ultimate';
      this.t = 1.5;
      this.ultWave = 0;
      this.ultTimer = 0.05;
      game.audio.bossRoar();
      game.shake(12);
    } else {
      this.recover(0.6);
    }
  }

  takeDamage(amount: number, angle: number, game: GameRef) {
    if (this.dead || this.invuln > 0) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;
    this.hurtT = 0.14;
    game.fx.text(this.x + randRange(-10, 10), this.y - 70, `${dmg}`, '#ffe0b0', 17);
    game.fx.burst(this.x, this.y - 20, {
      count: 8,
      color: '#ff6a4a',
      color2: '#ffd8a0',
      speed: 180,
      size: 2.6,
      life: 0.4,
      angle,
      spread: 2,
    });
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(game);
      return;
    }
    const ratio = this.hp / this.maxHp;
    if (this.phase === 1 && ratio <= 0.66) this.enterPhase(2, game);
    else if (this.phase === 2 && ratio <= 0.33) this.enterPhase(3, game);
  }

  private enterPhase(n: number, game: GameRef) {
    this.phase = n;
    this.state = 'phase';
    this.t = 1.15;
    this.invuln = 1.3;
    this.spikes = [];
    game.shake(20);
    game.flash('rgba(255,70,50,X)', 0.45);
    game.slowmo(0.5, 0.35);
    game.audio.bossRoar();
    game.fx.ring(this.x, this.y, 30, 260, 'rgba(255,70,50,0.9)', 7, 0.7);
    game.fx.ring(this.x, this.y, 10, 200, 'rgba(255,220,160,0.8)', 3, 0.55);
    game.fx.burst(this.x, this.y - 20, {
      count: 60,
      color: '#ff4a3a',
      color2: '#ffcf8a',
      speed: 380,
      size: 3.4,
      life: 1.0,
      shape: 'ember',
    });
    game.banner(n === 2 ? '无面 · 二相' : '无面 · 三相', n === 2 ? '「你的刀，开始像他了。」' : '「看清楚——面具下面是谁。」');
    if (n === 2) {
      game.spawnEnemy('ghost', this.x + 110, this.y);
      game.spawnEnemy('ghost', this.x - 110, this.y);
    }
  }

  private die(game: GameRef) {
    this.dead = true;
    game.fx.burst(this.x, this.y - 20, {
      count: 90,
      color: '#ff4a3a',
      color2: '#ffe2b0',
      speed: 380,
      size: 4,
      life: 1.4,
      grav: -20,
      shape: 'shard',
    });
    game.fx.ring(this.x, this.y, 20, 320, 'rgba(255,90,60,0.9)', 8, 1.0);
    game.shake(24);
    game.flash('rgba(255,240,220,X)', 0.8);
    game.audio.bossRoar();
    game.onBossDefeated();
  }

  draw(ctx: CanvasRenderingContext2D, time: number) {
    if (this.dead) return;
    if (this.state === 'windup') this.drawTelegraph(ctx);
    if (this.state === 'ring') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#ff5a3a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.ringR, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.ringR - 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    // 地刺预警
    for (const s of this.spikes) {
      if (!s.triggered) {
        const p = 1 - s.t / s.max;
        ctx.save();
        ctx.globalAlpha = 0.25 + Math.sin(p * 22) * 0.15;
        ctx.fillStyle = 'rgba(255,80,50,0.4)';
        ctx.strokeStyle = '#ff6a4a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * p, 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else {
        // 石刺
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.globalAlpha = Math.min(1, s.life / 0.4);
        ctx.fillStyle = '#3a2a26';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
          ctx.lineTo(Math.cos(a + 0.3) * s.r * 0.9, Math.sin(a + 0.3) * s.r * 0.9);
          ctx.lineTo(Math.cos(a - 0.3) * s.r * 0.6, Math.sin(a - 0.3) * s.r * 0.6);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }

    const bob = Math.sin(time * 2) * 2;
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 5, 34, 12, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 红色气焰
    ctx.globalCompositeOperation = 'lighter';
    const aura = 0.08 + Math.sin(time * 4) * 0.03 + (this.phase - 1) * 0.04;
    ctx.fillStyle = `rgba(255,60,40,${aura})`;
    ctx.beginPath();
    ctx.ellipse(0, -34, 52, 62, 0, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const hurt = this.hurtT > 0;
    // 披风
    ctx.fillStyle = hurt ? '#6a2a26' : '#141318';
    ctx.beginPath();
    ctx.moveTo(-16, -56 + bob);
    ctx.lineTo(-30 + Math.sin(time * 2) * 3, 6);
    ctx.lineTo(-6, 2);
    ctx.lineTo(0, -58 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16, -56 + bob);
    ctx.lineTo(30 + Math.sin(time * 2 + 1) * 3, 6);
    ctx.lineTo(6, 2);
    ctx.lineTo(0, -58 + bob);
    ctx.closePath();
    ctx.fill();

    // 身躯
    ctx.fillStyle = hurt ? '#7a3a32' : '#1e1d24';
    ctx.beginPath();
    ctx.moveTo(-16, -58 + bob);
    ctx.lineTo(16, -58 + bob);
    ctx.lineTo(20, -18 + bob);
    ctx.lineTo(0, -8 + bob);
    ctx.lineTo(-20, -18 + bob);
    ctx.closePath();
    ctx.fill();
    // 甲片
    ctx.fillStyle = '#2b2a33';
    ctx.fillRect(-15, -50 + bob, 30, 6);
    ctx.fillRect(-17, -40 + bob, 34, 5);
    // 红裂纹
    ctx.strokeStyle = 'rgba(255,70,50,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-10, -54 + bob);
    ctx.lineTo(-4, -44 + bob);
    ctx.lineTo(-9, -34 + bob);
    ctx.lineTo(-2, -24 + bob);
    ctx.moveTo(8, -55 + bob);
    ctx.lineTo(4, -46 + bob);
    ctx.lineTo(11, -38 + bob);
    ctx.stroke();

    // 肩甲
    ctx.fillStyle = hurt ? '#83443a' : '#2a2830';
    ctx.beginPath();
    ctx.ellipse(-22, -52 + bob, 12, 8, -0.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(22, -52 + bob, 12, 8, 0.2, 0, TAU);
    ctx.fill();

    // 面具头
    ctx.fillStyle = '#e9e4d8';
    ctx.beginPath();
    ctx.ellipse(0, -68 + bob, 10, 13, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#cfc8b8';
    ctx.beginPath();
    ctx.ellipse(0, -64 + bob, 7, 8, 0, 0, TAU);
    ctx.fill();
    // 面具裂纹
    ctx.strokeStyle = 'rgba(180,40,36,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-5, -74 + bob);
    ctx.lineTo(-1, -68 + bob);
    ctx.lineTo(-4, -62 + bob);
    ctx.stroke();

    // 兵器
    const flip = Math.cos(this.facing) < 0 ? -1 : 1;
    ctx.save();
    ctx.scale(flip, 1);
    ctx.translate(20, -46 + bob);
    ctx.rotate(0.42 + Math.sin(time * 1.5) * 0.04);
    ctx.fillStyle = '#33241c';
    ctx.fillRect(-3, -4, 6, 16);
    ctx.fillStyle = '#c9d6e6';
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(6, 52);
    ctx.lineTo(0, 72);
    ctx.lineTo(-5, 50);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,80,60,0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 12);
    ctx.lineTo(0, 66);
    ctx.stroke();
    ctx.restore();

    // 阶段光芒
    if (this.phase >= 2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = this.phase === 3 ? 'rgba(255,90,60,0.55)' : 'rgba(255,60,50,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 30, 12, 0, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  private drawTelegraph(ctx: CanvasRenderingContext2D) {
    const p = 1 - this.t / (WINDUP[this.attack] ?? 0.7);
    const pulse = 0.2 + Math.sin(p * 22) * 0.1 + p * 0.15;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.attack === 'dash') {
      ctx.rotate(this.lockAngle);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(255,60,40,0.28)';
      ctx.fillRect(18, -24, 460, 48);
      ctx.strokeStyle = '#ff5a3a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(18, -24);
      ctx.lineTo(478, -24);
      ctx.moveTo(18, 24);
      ctx.lineTo(478, 24);
      ctx.stroke();
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 5; i++) {
        const x = 200 + i * 60;
        ctx.beginPath();
        ctx.moveTo(x, -18);
        ctx.lineTo(x + 18, 0);
        ctx.lineTo(x, 18);
        ctx.stroke();
      }
    } else if (this.attack === 'combo') {
      ctx.rotate(this.facing);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(255,60,40,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 140, -1.2, 1.2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ff6a4a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 140, -1.2, 1.2);
      ctx.stroke();
    } else if (this.attack === 'ring') {
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ff5a3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 300, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = pulse * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 100, 0, TAU);
      ctx.stroke();
    } else if (this.attack === 'ultimate') {
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ff5a3a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + this.animT;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 40, Math.sin(a) * 40);
        ctx.lineTo(Math.cos(a) * 320, Math.sin(a) * 320);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = pulse;
      ctx.fillStyle = 'rgba(255,80,50,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, 80, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ff6a4a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 80, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }
}
