import * as THREE from 'three';
import type { Game3DRef } from './api3d';
import { TAU, angleDiff, angleTo, dist, lerpAngle, randRange } from '../core/utils';
import { S, createBossModel, disposeObject, glowSprite } from './models';
import type { BossModel } from './models';

type BossState = 'intro' | 'idle' | 'windup' | 'dash' | 'combo' | 'ring' | 'recover' | 'phase' | 'ultimate';

interface Spike {
  x: number;
  y: number;
  t: number;
  max: number;
  r: number;
  triggered: boolean;
  life: number;
  warn?: THREE.Mesh;
  shards?: THREE.Group;
}

const WINDUP: Record<string, number> = {
  dash: 0.72,
  combo: 0.48,
  ring: 0.95,
  spikes: 0.6,
  summon: 0.75,
  ultimate: 1.05,
};

export class Boss3D {
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

  model: BossModel;
  private ringTick = 0;
  private comboVisual = 0;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.facing = Math.PI / 2;
    this.model = createBossModel();
    this.model.group.position.set(x * S, 0, y * S);
    this.model.group.rotation.y = -this.facing;
  }

  update(dt: number, game: Game3DRef) {
    if (this.dead) return;
    this.animT += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.comboVisual = Math.max(0, this.comboVisual - dt);

    // 地刺
    for (const s of this.spikes) {
      if (!s.triggered) {
        s.t -= dt;
        if (s.warn) {
          const k = 1 - s.t / s.max;
          s.warn.scale.setScalar(s.r * S);
          const m = s.warn.material as THREE.MeshBasicMaterial;
          m.opacity = 0.2 + Math.sin(k * 24) * 0.1 + k * 0.22;
        }
        if (s.t <= 0) {
          s.triggered = true;
          s.life = 0.45;
          if (s.warn) s.warn.visible = false;
          this.buildShards(s, game);
          game.fx.ring(s.x, s.y, 8, s.r + 10, 'rgba(255,90,60,0.9)', 5, 0.35);
          game.fx.burst(s.x, s.y, {
            count: 20,
            color: '#ff5a3a',
            color2: '#ffd27a',
            speed: 240,
            size: 3,
            life: 0.6,
            grav: -60,
          });
          game.shake(7);
          game.audio.hit();
          if (dist(s.x, s.y, game.player.x, game.player.y) < s.r + game.player.r) {
            game.player.takeDamage(20, s.x, s.y, game);
          }
        }
      } else {
        s.life -= dt;
        if (s.shards) {
          const k = Math.max(0, s.life / 0.45);
          s.shards.scale.set(1, 0.4 + k * 0.6, 1);
          s.shards.position.y = (1 - k) * -1.4;
        }
      }
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      if (s.triggered && s.life <= 0) {
        this.cleanSpike(s);
        this.spikes.splice(i, 1);
      }
    }

    const p = game.player;
    if (p.dead) {
      this.state = 'idle';
      this.sync(dt);
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
        const dashDist = dist(this.x, this.y, p.x, p.y);
        if (!this.dashHit && dashDist < this.r + p.r + 14) {
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
            this.comboVisual = 0.26;
            const ang = angleTo(this.x, this.y, p.x, p.y);
            this.facing = lerpAngle(this.facing, ang, 0.55);
            game.fx.slash(
              this.x + Math.cos(this.facing) * 30,
              this.y + Math.sin(this.facing) * 30,
              this.facing,
              120,
              '#ff4a4a',
              2.2,
              12,
              0.7,
            );
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
        this.ringTick -= dt;
        if (this.ringTick <= 0) {
          this.ringTick = 0.07;
          game.fx.ring(this.x, this.y, this.ringR, this.ringR + 18, 'rgba(255,80,60,0.55)', 3, 0.3);
        }
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
    this.sync(dt);
  }

  private buildShards(s: Spike, game: Game3DRef) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#3a2a26', roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.3, 4), mat);
      cone.position.set(Math.cos(a) * 0.55, 0.55, Math.sin(a) * 0.55);
      cone.rotation.z = Math.cos(a) * 0.4;
      cone.rotation.x = -Math.sin(a) * 0.4;
      g.add(cone);
    }
    g.position.set(s.x * S, 0, s.y * S);
    g.scale.set(s.r / 48, 0.4, s.r / 48);
    game.world.scene.add(g);
    s.shards = g;
  }

  private cleanSpike(s: Spike) {
    if (s.warn) {
      s.warn.removeFromParent();
      s.warn.geometry.dispose();
      (s.warn.material as THREE.Material).dispose();
      s.warn = undefined;
    }
    if (s.shards) {
      disposeObject(s.shards);
      s.shards.removeFromParent();
      s.shards = undefined;
    }
  }

  private move(angle: number, sp: number, dt: number, game: Game3DRef) {
    const pos = game.world.collide(this.x + Math.cos(angle) * sp * dt, this.y + Math.sin(angle) * sp * dt, this.r);
    this.x = pos.x;
    this.y = pos.y;
  }

  private recover(t: number) {
    this.state = 'recover';
    this.t = t;
  }

  private chooseAttack(game: Game3DRef) {
    const r = Math.random();
    let attack: string;
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

  private execute(game: Game3DRef) {
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
      this.ringTick = 0;
      game.audio.skill3();
      game.fx.ring(this.x, this.y, 50, 90, 'rgba(255,80,60,0.6)', 4, 0.4);
    } else if (this.attack === 'spikes') {
      for (let i = 0; i < 3; i++) {
        const bx = p.x + randRange(-26, 26) * i;
        const by = p.y + randRange(-26, 26) * i;
        const s: Spike = { x: bx, y: by, t: 0.5 + i * 0.3, max: 0.5 + i * 0.3, r: 48, triggered: false, life: 0 };
        const geo = new THREE.RingGeometry(0.9, 1, 40);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: '#ff5a3a',
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const warn = new THREE.Mesh(geo, mat);
        warn.position.set(bx * S, 0.06, by * S);
        warn.scale.setScalar(48 * S);
        game.world.scene.add(warn);
        s.warn = warn;
        this.spikes.push(s);
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

  takeDamage(amount: number, angle: number, game: Game3DRef) {
    if (this.dead || this.invuln > 0) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;
    this.hurtT = 0.14;
    game.fx.text(this.x + randRange(-10, 10), this.y - 40, `${dmg}`, '#ffe0b0', 17);
    game.fx.burst(this.x, this.y, {
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

  private enterPhase(n: number, game: Game3DRef) {
    this.phase = n;
    this.state = 'phase';
    this.t = 1.15;
    this.invuln = 1.3;
    for (const s of this.spikes) this.cleanSpike(s);
    this.spikes = [];
    game.shake(20);
    game.flash('#ff4632', 0.45);
    game.slowmo(0.5, 0.35);
    game.audio.bossRoar();
    game.fx.ring(this.x, this.y, 30, 260, 'rgba(255,70,50,0.9)', 7, 0.7);
    game.fx.ring(this.x, this.y, 10, 200, 'rgba(255,220,160,0.8)', 3, 0.55);
    game.fx.burst(this.x, this.y, {
      count: 60,
      color: '#ff4a3a',
      color2: '#ffcf8a',
      speed: 380,
      size: 3.4,
      life: 1.0,
    });
    game.banner(n === 2 ? '无面 · 二相' : '无面 · 三相', n === 2 ? '「你的刀，开始像他了。」' : '「看清楚——面具下面是谁。」');
    if (n === 2) {
      game.spawnEnemy('ghost', this.x + 110, this.y);
      game.spawnEnemy('ghost', this.x - 110, this.y);
    }
  }

  private die(game: Game3DRef) {
    this.dead = true;
    this.model.body.rotation.z = -1.35;
    this.model.body.position.y = 0.25;
    this.model.aura.visible = false;
    game.fx.burst(this.x, this.y, {
      count: 90,
      color: '#ff4a3a',
      color2: '#ffe2b0',
      speed: 380,
      size: 4,
      life: 1.4,
      grav: -20,
    });
    game.fx.ring(this.x, this.y, 20, 320, 'rgba(255,90,60,0.9)', 8, 1.0);
    game.shake(24);
    game.flash('#fff0dc', 0.8);
    game.audio.bossRoar();
    game.onBossDefeated();
  }

  private sync(dt: number) {
    const m = this.model;
    m.group.position.set(this.x * S, 0, this.y * S);
    m.group.rotation.y = -this.facing;

    const bob = Math.sin(this.animT * 2) * 0.04;
    m.body.position.y = bob + (this.hurtT > 0 ? Math.sin(this.hurtT * 80) * 0.03 : 0);
    m.capeL.rotation.z = 0.14 + Math.sin(this.animT * 2) * 0.05;
    m.capeR.rotation.z = -0.14 + Math.sin(this.animT * 2 + 1) * 0.05;

    // 挥剑表现
    if (this.state === 'combo' && this.comboVisual > 0) {
      const k = 1 - this.comboVisual / 0.26;
      m.sword.rotation.y = -0.9 + k * 2.2;
    } else if (this.state === 'windup') {
      m.sword.rotation.y = -1.35;
    } else if (this.state === 'dash') {
      m.sword.rotation.y = 0.4;
    } else {
      m.sword.rotation.y = -0.35 + Math.sin(this.animT * 1.4) * 0.05;
    }

    const auraMat = m.aura.material as THREE.MeshBasicMaterial;
    auraMat.opacity = 0.35 + Math.sin(this.animT * 4) * 0.12 + (this.phase - 1) * 0.1;
    m.aura.rotation.z += dt * (0.6 + this.phase * 0.3);
    const glowMat = (m.glow as THREE.Sprite).material;
    glowMat.opacity = 0.28 + (this.phase - 1) * 0.14 + Math.sin(this.animT * 5) * 0.06;
    m.glow.scale.setScalar(3.2 + (this.phase - 1) * 0.8 + Math.sin(this.animT * 3) * 0.2);
  }

  dispose() {
    for (const s of this.spikes) this.cleanSpike(s);
    this.spikes.length = 0;
    disposeObject(this.model.group);
    this.model.group.removeFromParent();
  }
}
