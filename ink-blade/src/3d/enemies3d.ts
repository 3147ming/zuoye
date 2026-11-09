import * as THREE from 'three';
import type { Game3DRef } from './api3d';
import type { EnemyKind, ItemId } from '../types';
import { TAU, angleTo, clamp, dist, randRange } from '../core/utils';
import { S, createGhostModel, createMonkModel, createWolfModel, disposeObject, glowSprite } from './models';

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

export class Enemy3D {
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
  elite: boolean;
  name?: string;
  key?: string;
  dead = false;

  state: 'idle' | 'chase' | 'windup' | 'strike' | 'recover' = 'idle';
  t = 0;
  cd = randRange(0.4, 1.2);
  facing = 0;
  hurtT = 0;
  kbx = 0;
  kby = 0;
  wanderT = 0;
  wanderAngle = Math.random() * TAU;
  lockAngle = 0;
  lockX = 0;
  lockY = 0;
  struck = false;
  animT = Math.random() * 10;

  group: THREE.Group;
  private body: THREE.Group;
  private legs: THREE.Group[];
  private telegraph: THREE.Mesh;
  private tMat: THREE.MeshBasicMaterial;

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

    if (kind === 'wolf') {
      const m = createWolfModel(elite);
      this.group = m.group;
      this.body = m.body;
      this.legs = m.legs;
    } else if (kind === 'ghost') {
      const m = createGhostModel();
      this.group = m.group;
      this.body = m.body;
      this.legs = [];
    } else {
      const m = createMonkModel(elite);
      this.group = m.group;
      this.body = m.body;
      this.legs = [];
    }

    const geo = new THREE.RingGeometry(0.9, 1, 40);
    geo.rotateX(-Math.PI / 2);
    this.tMat = new THREE.MeshBasicMaterial({
      color: kind === 'ghost' ? '#63e0cf' : '#ff6a4a',
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.telegraph = new THREE.Mesh(geo, this.tMat);
    this.telegraph.visible = false;
    this.telegraph.position.y = 0.07;
    this.group.add(this.telegraph);

    this.sync();
  }

  update(dt: number, game: Game3DRef) {
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
      this.sync();
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
            this.move(a + (Math.PI / 2) * side, this.speed * 0.5, dt, game);
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
        if (this.t <= 0) this.strike(game);
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
    this.sync();
  }

  private move(angle: number, speed: number, dt: number, game: Game3DRef) {
    const p = game.world.collide(this.x + Math.cos(angle) * speed * dt, this.y + Math.sin(angle) * speed * dt, this.r);
    this.x = p.x;
    this.y = p.y;
  }

  private strike(game: Game3DRef) {
    const player = game.player;
    if (this.kind === 'wolf') {
      this.state = 'strike';
      this.t = 0.22;
      this.struck = false;
      game.fx.slash(this.x, this.y, this.lockAngle, 62, '#ff6a5a', 1.2, 5, 0.3);
      game.audio.swing();
      return;
    }
    if (this.kind === 'monk') {
      game.fx.ring(this.lockX, this.lockY, 10, 88, 'rgba(255,120,80,0.7)', 4, 0.4);
      game.fx.burst(this.lockX, this.lockY, {
        count: 18,
        color: '#c9a06a',
        color2: '#ff9a6a',
        speed: 180,
        size: 3,
        life: 0.5,
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

  takeDamage(amount: number, angle: number, game: Game3DRef) {
    if (this.dead) return;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;
    this.hurtT = 0.16;
    this.kbx += Math.cos(angle) * 150;
    this.kby += Math.sin(angle) * 150;
    game.fx.text(this.x + randRange(-6, 6), this.y - 20, `${dmg}`, this.elite ? '#ffd889' : '#ffffff', this.elite ? 18 : 15);
    game.fx.burst(this.x, this.y, {
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

  private die(game: Game3DRef) {
    this.dead = true;
    game.fx.burst(this.x, this.y, {
      count: this.elite ? 46 : 22,
      color: this.kind === 'ghost' ? '#63e0cf' : '#c94a3f',
      color2: '#ffd0a0',
      speed: this.elite ? 260 : 180,
      size: 3,
      life: 0.9,
      grav: -30,
    });
    game.fx.ring(this.x, this.y, 8, this.elite ? 110 : 54, 'rgba(255,160,110,0.6)', 3, 0.5);
    game.onEnemyKilled(this);
  }

  private sync() {
    this.group.position.set(this.x * S, 0, this.y * S);
    this.group.rotation.y = -this.facing;

    if (this.hurtT > 0) {
      this.body.position.x = Math.sin(this.hurtT * 70) * 0.05;
    } else {
      this.body.position.x = 0;
    }

    if (this.kind === 'wolf') {
      const run = this.state === 'chase' || this.state === 'strike' ? 1 : 0.25;
      const sw = Math.sin(this.animT * 15) * 0.55 * run;
      for (let i = 0; i < this.legs.length; i++) {
        this.legs[i].rotation.z = (i % 2 === 0 ? sw : -sw);
      }
      this.body.rotation.z = this.state === 'windup' ? -0.2 : this.state === 'strike' ? 0.22 : 0;
      this.body.position.y = Math.abs(Math.sin(this.animT * 15)) * 0.04 * run;
    } else if (this.kind === 'ghost') {
      this.body.position.y = 0.3 + Math.sin(this.animT * 2.2) * 0.12;
      this.body.rotation.z = Math.sin(this.animT * 1.3) * 0.06;
    } else {
      this.body.rotation.z = this.state === 'windup' ? -0.12 : 0;
    }

    const winding = this.state === 'windup';
    this.telegraph.visible = winding;
    if (winding) {
      const tx = this.kind === 'monk' ? this.lockX : this.x + Math.cos(this.lockAngle) * 34;
      const ty = this.kind === 'monk' ? this.lockY : this.y + Math.sin(this.lockAngle) * 34;
      this.telegraph.position.set((tx - this.x) * S, 0.07, (ty - this.y) * S);
      const rad = (this.kind === 'monk' ? 88 : 62) * S;
      this.telegraph.scale.setScalar(rad);
      const k = 1 - this.t / Math.max(0.001, this.windupT);
      this.tMat.opacity = 0.25 + k * 0.35;
      this.telegraph.rotation.y = -this.animT * 1.5;
    }
  }

  dispose() {
    disposeObject(this.group);
    this.group.removeFromParent();
  }
}

export class Projectile3D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  kind: 'fire' | 'soul';
  life = 4;
  dead = false;
  group: THREE.Group;
  private glow: THREE.Object3D;

  constructor(x: number, y: number, angle: number, speed: number, damage: number, kind: 'fire' | 'soul') {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.kind = kind;
    const color = kind === 'fire' ? '#ff6a4a' : '#63e0cf';
    this.group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 7),
      new THREE.MeshBasicMaterial({ color }),
    );
    this.group.add(core);
    this.glow = glowSprite(color, 1.1, 0.85);
    this.group.add(this.glow);
    this.group.position.set(x * S, 0.8, y * S);
  }

  update(dt: number, game: Game3DRef) {
    if (this.dead) return;
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const yOff = 0.65 + Math.sin(this.life * 18) * 0.06;
    this.group.position.set(this.x * S, yOff, this.y * S);
    game.fx.embers(this.x, this.y, 1, this.kind === 'fire' ? '#ff8a4a' : '#63e0cf');
    if (this.life <= 0 || this.x < 0 || this.y < 0 || this.x > game.region.w || this.y > game.region.h) {
      this.dead = true;
      return;
    }
    if (game.world.pointBlocked(this.x, this.y)) {
      this.dead = true;
      game.fx.burst(this.x, this.y, {
        count: 14,
        color: this.kind === 'fire' ? '#ff8a4a' : '#63e0cf',
        color2: '#ffe6c8',
        speed: 170,
        size: 2.4,
        life: 0.4,
      });
      return;
    }
    const p = game.player;
    if (!p.dead && dist(this.x, this.y, p.x, p.y) < p.r + 13) {
      p.takeDamage(this.damage, this.x, this.y, game);
      this.dead = true;
      game.fx.burst(this.x, this.y, {
        count: 18,
        color: this.kind === 'fire' ? '#ff8a4a' : '#63e0cf',
        color2: '#fff0d8',
        speed: 200,
        size: 2.8,
        life: 0.5,
      });
    }
  }

  dispose() {
    disposeObject(this.group);
    this.group.removeFromParent();
  }
}
