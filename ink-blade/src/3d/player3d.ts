import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Game3DRef } from './api3d';
import { Inventory } from '../data/items';
import { SKILL_INFO } from '../data/skills';
import { clamp, TAU } from '../core/utils';
import { S, createPlayerModel } from './models';

export type { SkillInfo } from '../data/skills';

export class Player3D {
  x = 0;
  y = 0;
  r = 13;
  hp = 120;
  maxHp = 120;
  chi = 100;
  maxChi = 100;
  stamina = 100;
  maxStamina = 100;
  money = 80;
  inv = new Inventory();

  speed = 215;
  facing = 0;
  dead = false;
  moving = false;
  animT = 0;

  invuln = 0;
  hurtT = 0;

  dodgeT = 0;
  dodgeMax = 0.3;
  dodgeCd = 0;
  dodgeDir = 0;
  perfectWindow = 0;
  ghostTimer = 0;

  dashT = 0;
  dashDir = 0;
  dashStruck = false;

  atkCd = 0;
  comboWindow = 0;
  comboStep = 0;
  swingT = 0;
  swingMax = 0.2;
  swingDir = 0;

  skillCd = [0, 0, 0];

  channel = 0;
  channelMax = 0.5;

  bladeT = 0;
  bladeTick = 0;
  bladeAngle = 0;

  buffs = { crit: 0, speed: 0, guard: 0 };

  kbx = 0;
  kby = 0;

  model = createPlayerModel();

  constructor(x: number, y: number) {
    this.reset(x, y);
  }

  reset(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.dead = false;
    this.hp = this.maxHp;
    this.chi = this.maxChi;
    this.stamina = this.maxStamina;
    this.invuln = 1;
    this.dodgeT = 0;
    this.dashT = 0;
    this.channel = 0;
    this.bladeT = 0;
    this.hurtT = 0;
    this.buffs = { crit: 0, speed: 0, guard: 0 };
    this.ghostTimer = 0;
    this.model.spin.rotation.z = 0;
    this.model.spin.position.y = 0;
    this.syncModel();
  }

  dmgMult() {
    return 1 + (this.buffs.crit > 0 ? 0.5 : 0);
  }

  update(dt: number, move: { x: number; y: number; len: number }, aim: number, game: Game3DRef) {
    if (this.dead) {
      this.syncModel();
      return;
    }
    this.facing = aim;

    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.perfectWindow = Math.max(0, this.perfectWindow - dt);
    this.ghostTimer = Math.max(0, this.ghostTimer - dt);
    for (let i = 0; i < 3; i++) this.skillCd[i] = Math.max(0, this.skillCd[i] - dt);
    this.buffs.crit = Math.max(0, this.buffs.crit - dt);
    this.buffs.speed = Math.max(0, this.buffs.speed - dt);
    this.buffs.guard = Math.max(0, this.buffs.guard - dt);

    if (this.comboWindow <= 0) this.comboStep = 0;

    if (this.channel <= 0) this.chi = Math.min(this.maxChi, this.chi + 9 * dt);
    this.stamina = Math.min(this.maxStamina, this.stamina + 24 * dt);

    // 击退
    if (Math.abs(this.kbx) > 1 || Math.abs(this.kby) > 1) {
      this.moveBy(this.kbx * dt, this.kby * dt, game);
      this.kbx *= 1 - Math.min(1, dt * 9);
      this.kby *= 1 - Math.min(1, dt * 9);
    }

    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const p = 1 - this.dodgeT / this.dodgeMax;
      const sp = 560 * (1 - p * 0.55);
      this.moveBy(Math.cos(this.dodgeDir) * sp * dt, Math.sin(this.dodgeDir) * sp * dt, game);
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.045;
        game.fx.ghost(this.x, this.y, this.facing, 'rgba(120,220,255,0.4)');
      }
      if (this.dodgeT <= 0) this.dodgeCd = 0.16;
      this.syncModel();
      return;
    }

    if (this.channel > 0) {
      this.channel -= dt;
      game.fx.embers(this.x, this.y, 2, '#ff8a4a');
      if (this.channel <= 0) this.releaseSkill3(game);
      this.syncModel();
      return;
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      const sp = 900;
      this.moveBy(Math.cos(this.dashDir) * sp * dt, Math.sin(this.dashDir) * sp * dt, game);
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.04;
        game.fx.ghost(this.x, this.y, this.dashDir, 'rgba(255,90,90,0.5)');
        game.fx.embers(this.x, this.y, 1, '#ff6a4a');
      }
      if (!this.dashStruck && this.dashT <= 0) {
        this.dashStruck = true;
        const dmg = 48 * this.dmgMult();
        const hits = game.hitEnemies(this.x, this.y, this.dashDir, 118, 1.35, dmg, 260);
        game.fx.slash(this.x, this.y, this.dashDir, 130, '#ff5766', 1.35, 12, 0.5);
        game.fx.slash(this.x, this.y, this.dashDir + 0.1, 108, '#ffe6c0', 1.1, 5, 0.42);
        game.fx.ring(this.x, this.y, 20, 95, 'rgba(255,120,90,0.85)', 4, 0.45);
        game.fx.burst(this.x + Math.cos(this.dashDir) * 60, this.y + Math.sin(this.dashDir) * 60, {
          count: 24,
          color: '#ff5a5a',
          color2: '#ffd27a',
          speed: 260,
          size: 3,
          life: 0.6,
          angle: this.dashDir,
          spread: 2.2,
        });
        game.shake(hits > 0 ? 12 : 6);
        game.punchZoom(hits > 0 ? 5 : 3);
        if (hits > 0) game.audio.hit(true);
      }
      this.syncModel();
      return;
    }

    const moving = move.len > 0;
    this.moving = moving;
    if (moving) {
      const sp = this.speed * (this.buffs.speed > 0 ? 1.28 : 1);
      this.moveBy(move.x * sp * dt, move.y * sp * dt, game);
      this.animT += dt * (this.buffs.speed > 0 ? 1.25 : 1);
    }

    const input: Input = game.input;
    const attackPressed = input.mouse.down || input.mouse.clicked || input.isDown('KeyJ') || input.wasPressed('KeyJ');
    if (attackPressed && this.atkCd <= 0) {
      this.basicAttack(game, aim);
    }

    if (input.wasAnyPressed(['Space', 'ShiftLeft', 'ShiftRight'])) {
      this.tryDodge(move, game, aim);
    }

    if (input.wasPressed('Digit1')) this.castSkill(0, game, aim);
    if (input.wasPressed('Digit2')) this.castSkill(1, game, aim);
    if (input.wasPressed('Digit3')) this.castSkill(2, game, aim);

    if (this.bladeT > 0) {
      this.bladeT -= dt;
      this.bladeAngle += dt * 9;
      this.bladeTick -= dt;
      if (this.bladeTick <= 0) {
        this.bladeTick = 0.15;
        const dmg = 9 * this.dmgMult();
        game.areaEnemies(this.x, this.y, 132, dmg, 40);
        game.fx.ring(this.x, this.y, 60, 132, 'rgba(140,220,255,0.55)', 2, 0.22);
      }
    }

    this.syncModel();
  }

  private syncModel() {
    const m = this.model;
    m.group.position.set(this.x * S, 0, this.y * S);
    m.group.rotation.y = -this.facing;

    let spinRot = 0;
    let lift = 0;
    if (this.dodgeT > 0) {
      const p = 1 - this.dodgeT / this.dodgeMax;
      spinRot = p * TAU;
      lift = 0.14;
    }
    m.spin.rotation.y = spinRot;
    m.spin.position.y = lift;

    const amp = this.moving ? 0.62 : 0.04;
    const sin = Math.sin(this.animT * 12);
    m.legL.rotation.z = sin * amp;
    m.legR.rotation.z = -sin * amp;
    m.armL.rotation.z = -sin * amp * 0.7;
    m.armR.rotation.z = sin * amp * 0.5;

    if (this.swingT > 0) {
      const p = 1 - this.swingT / this.swingMax;
      m.swordPivot.rotation.y = -1.25 + p * 2.7;
      m.swordPivot.rotation.z = 0.16;
    } else if (this.channel > 0) {
      m.swordPivot.rotation.y = -1.7;
      m.swordPivot.rotation.z = 1.15;
    } else if (this.dashT > 0) {
      m.swordPivot.rotation.y = 0.35;
      m.swordPivot.rotation.z = 0.1;
    } else {
      m.swordPivot.rotation.y = -0.5 + Math.sin(performance.now() * 0.002) * 0.045;
      m.swordPivot.rotation.z = 0.05;
    }

    m.aura.visible = this.buffs.crit > 0;
    if (m.aura.visible) {
      const t = performance.now() * 0.006;
      m.aura.rotation.z = t;
      (m.aura.material as THREE.MeshBasicMaterial).opacity = 0.38 + Math.sin(t * 3) * 0.16;
    }

    m.bladeWheel.visible = this.bladeT > 0;
    if (m.bladeWheel.visible) {
      m.bladeWheel.rotation.y = this.bladeAngle;
      m.bladeWheel.position.y = 0.8 + Math.sin(this.bladeAngle * 2) * 0.08;
    }
  }

  private moveBy(dx: number, dy: number, game: Game3DRef) {
    const p = game.world.collide(this.x + dx, this.y + dy, this.r);
    this.x = p.x;
    this.y = p.y;
  }

  private basicAttack(game: Game3DRef, aim: number) {
    if (this.stamina < 8) {
      game.toast('气力不足');
      return;
    }
    this.stamina -= 8;
    this.comboStep = this.comboWindow > 0 ? (this.comboStep + 1) % 3 : 0;
    const dmg = [12, 14, 22][this.comboStep] * this.dmgMult();
    const range = [74, 78, 96][this.comboStep];
    const arc = [1.9, 2.0, 2.6][this.comboStep];
    const hits = game.hitEnemies(this.x, this.y, aim, range, arc, dmg, 90 + this.comboStep * 30);
    this.atkCd = 0.27;
    this.comboWindow = 0.55;
    this.swingT = 0.2;
    this.swingMax = 0.2;
    this.swingDir = aim;
    const color = this.comboStep === 2 ? '#ffd7a0' : '#ff6b6b';
    game.fx.slash(this.x, this.y, aim, range * 0.95, color, arc, this.comboStep === 2 ? 10 : 7, 0.34);
    game.audio.swing();
    if (hits > 0) {
      game.fx.burst(this.x + Math.cos(aim) * range * 0.7, this.y + Math.sin(aim) * range * 0.7, {
        count: 10,
        color: '#ff8a7a',
        color2: '#fff0c8',
        speed: 210,
        size: 2.6,
        life: 0.34,
        angle: aim,
        spread: 1.6,
      });
      game.audio.hit(this.comboStep === 2);
      game.shake(3 + this.comboStep);
    }
    this.x += Math.cos(aim) * 5;
    this.y += Math.sin(aim) * 5;
  }

  tryDodge(move: { x: number; y: number; len: number }, game: Game3DRef, aim: number) {
    if (this.dodgeT > 0 || this.dodgeCd > 0) return;
    if (this.stamina < 25) {
      game.toast('气力不足，无法翻滚');
      return;
    }
    this.stamina -= 25;
    this.dodgeT = this.dodgeMax;
    this.dodgeDir = move.len > 0 ? Math.atan2(move.y, move.x) : aim;
    this.invuln = Math.max(this.invuln, 0.24);
    this.perfectWindow = 0.16;
    this.ghostTimer = 0;
    game.audio.dodge();
    game.fx.burst(this.x, this.y, {
      count: 12,
      color: 'rgba(180,190,200,0.8)',
      color2: 'rgba(255,220,180,0.6)',
      speed: 90,
      size: 3,
      life: 0.35,
    });
  }

  castSkill(i: number, game: Game3DRef, aim: number) {
    if (this.dead || this.channel > 0 || this.dashT > 0) return;
    const info = SKILL_INFO[i];
    if (this.skillCd[i] > 0) {
      game.toast(`${info.name} 尚在调息`);
      return;
    }
    if (this.chi < info.cost) {
      game.toast('内力不足');
      game.audio.deny();
      return;
    }
    this.chi -= info.cost;
    this.skillCd[i] = info.cd;

    if (i === 0) {
      this.dashT = 0.18;
      this.dashDir = aim;
      this.dashStruck = false;
      this.invuln = Math.max(this.invuln, 0.42);
      this.ghostTimer = 0;
      game.audio.skill1();
      game.fx.rune(this.x, this.y, 34, '#ff7a5a', 0.5);
      game.fx.ring(this.x, this.y, 10, 50, 'rgba(255,120,80,0.75)', 3, 0.35);
    } else if (i === 1) {
      this.bladeT = 1.15;
      this.bladeTick = 0;
      this.bladeAngle = Math.random() * TAU;
      game.audio.skill2();
      game.fx.rune(this.x, this.y, 56, '#7fd8ff', 0.9);
      game.fx.ring(this.x, this.y, 20, 140, 'rgba(150,220,255,0.6)', 3, 0.5);
    } else {
      this.channel = this.channelMax;
      this.invuln = Math.max(this.invuln, 0.3);
      game.audio.skill3();
      game.fx.rune(this.x, this.y, 96, '#ff9a52', 0.65);
      game.fx.ring(this.x, this.y, 20, 190, 'rgba(255,140,70,0.45)', 4, 0.55);
      game.shake(4);
    }
  }

  private releaseSkill3(game: Game3DRef) {
    const dmg = 95 * this.dmgMult();
    const hits = game.areaEnemies(this.x, this.y, 220, dmg, 340);
    game.fx.ring(this.x, this.y, 30, 250, 'rgba(255,190,120,0.95)', 8, 0.65);
    game.fx.ring(this.x, this.y, 10, 200, 'rgba(255,90,60,0.85)', 5, 0.5);
    game.fx.ring(this.x, this.y, 60, 150, 'rgba(255,240,200,0.9)', 2, 0.32);
    for (let k = 0; k < 4; k++) {
      game.fx.slash(this.x, this.y, (k / 4) * TAU + 0.4, 150, '#ff6a4a', 1.3, 12, 0.62);
    }
    game.fx.burst(this.x, this.y, {
      count: 80,
      color: '#ff6a3a',
      color2: '#ffd27a',
      speed: 420,
      size: 3.6,
      life: 0.95,
      grav: -60,
    });
    game.fx.embers(this.x, this.y, 36, '#ff8a4a');
    game.shake(hits > 0 ? 22 : 14);
    game.punchZoom(9);
    game.flash('#ffd296', 0.55);
    game.slowmo(0.24, 0.28);
    game.audio.hit(hits > 0);
  }

  perfectDodge(game: Game3DRef) {
    this.perfectWindow = 0;
    this.buffs.crit = 5;
    this.chi = Math.min(this.maxChi, this.chi + 25);
    this.stamina = Math.min(this.maxStamina, this.stamina + 40);
    game.slowmo(0.55, 0.3);
    game.shake(10);
    game.flash('#96e6ff', 0.4);
    game.fx.ring(this.x, this.y, 16, 130, 'rgba(150,235,255,0.9)', 4, 0.55);
    game.fx.text(this.x, this.y - 20, '完美闪避', '#9ef2ff', 20);
    game.fx.text(this.x, this.y - 40, '刀意·破', '#ffd889', 14);
    game.audio.perfect();
    game.onPerfectDodge();
  }

  takeDamage(amount: number, fromX: number, fromY: number, game: Game3DRef) {
    if (this.dead) return;
    if (this.invuln > 0 || this.dodgeT > 0 || this.dashT > 0) {
      if (this.perfectWindow > 0) {
        this.perfectWindow = 0;
        this.perfectDodge(game);
      }
      return;
    }
    let dmg = amount;
    if (this.buffs.guard > 0) dmg *= 0.5;
    dmg = Math.max(1, Math.round(dmg));
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtT = 0.35;
    this.invuln = 0.7;
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.kbx += Math.cos(a) * 240;
    this.kby += Math.sin(a) * 240;
    game.fx.text(this.x, this.y - 20, `-${dmg}`, '#ff6b6b', 18);
    game.fx.burst(this.x, this.y, {
      count: 16,
      color: '#c23c3c',
      color2: '#ff9a7a',
      speed: 190,
      size: 3,
      life: 0.5,
    });
    game.shake(9);
    game.audio.hurt();
    if (this.hp <= 0) {
      this.dead = true;
      this.model.spin.rotation.z = -Math.PI / 2;
      this.model.spin.position.y = 0.24;
      game.onPlayerDeath();
    }
  }

  heal(n: number, game: Game3DRef) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    game.fx.text(this.x, this.y - 24, `+${Math.round(this.hp - before)}`, '#8ef0a0', 16);
    game.fx.burst(this.x, this.y, {
      count: 14,
      color: '#7be08a',
      color2: '#d8ffcf',
      speed: 60,
      size: 2.6,
      life: 0.8,
      grav: -40,
    });
    game.audio.heal();
  }

  restoreChi(n: number, game: Game3DRef) {
    this.chi = Math.min(this.maxChi, this.chi + n);
    game.fx.text(this.x, this.y - 24, `内力 +${n}`, '#8ec8ff', 15);
    game.fx.burst(this.x, this.y, {
      count: 14,
      color: '#6aa7e8',
      color2: '#d8f0ff',
      speed: 80,
      size: 2.4,
      life: 0.7,
      grav: -30,
    });
    game.audio.heal();
  }
}

export { clamp };
