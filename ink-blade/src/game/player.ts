import type { Input } from '../core/input';
import type { GameRef } from './api';
import { Inventory } from '../data/items';
import { clamp, TAU, angleDiff } from '../core/utils';

export interface SkillInfo {
  key: string;
  name: string;
  cost: number;
  cd: number;
  desc: string;
}

export const SKILL_INFO: SkillInfo[] = [
  { key: '1', name: '裂空·一闪', cost: 22, cd: 6, desc: '瞬身突进，斩出一道裂空刀光。' },
  { key: '2', name: '回风·刃轮', cost: 32, cd: 9, desc: '旋身引刃，八道刀气环身回旋。' },
  { key: '3', name: '烬灭·斩', cost: 45, cd: 15, desc: '蓄势引爆刀意，焚尽周身之敌。' },
];

export class Player {
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
  }

  dmgMult() {
    return 1 + (this.buffs.crit > 0 ? 0.5 : 0);
  }

  update(dt: number, input: Input, aim: number, game: GameRef) {
    if (this.dead) return;
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

    // 内力与气力回复
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
        this.ghostTimer = 0.035;
        game.fx.ghost(this.x, this.y, this.facing, 'rgba(120,220,255,0.4)');
      }
      if (this.dodgeT <= 0) this.dodgeCd = 0.16;
      return;
    }

    if (this.channel > 0) {
      this.channel -= dt;
      game.fx.embers(this.x, this.y - 8, 2, '#ff8a4a');
      if (this.channel <= 0) this.releaseSkill3(game);
      return;
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      const sp = 900;
      this.moveBy(Math.cos(this.dashDir) * sp * dt, Math.sin(this.dashDir) * sp * dt, game);
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.03;
        game.fx.ghost(this.x, this.y, this.dashDir, 'rgba(255,90,90,0.5)');
        game.fx.embers(this.x, this.y - 10, 1, '#ff6a4a');
      }
      if (!this.dashStruck && this.dashT <= 0) {
        this.dashStruck = true;
        const dmg = 48 * this.dmgMult();
        const hits = game.hitEnemies(this.x, this.y, this.dashDir, 118, 1.35, dmg, 260);
        game.fx.slash(this.x, this.y - 6, this.dashDir, 120, '#ff5766', 2.4, 13, 0.9);
        game.fx.slash(this.x, this.y - 6, this.dashDir + 0.12, 100, '#ffe6c0', 2.0, 5, 0.7);
        game.fx.ring(this.x, this.y, 20, 90, 'rgba(255,120,90,0.8)', 4, 0.4);
        game.fx.burst(this.x + Math.cos(this.dashDir) * 60, this.y + Math.sin(this.dashDir) * 60, {
          count: 22,
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
      return;
    }

    // 移动
    const mv = input.moveVec;
    this.moving = mv.len > 0;
    if (this.moving) {
      const sp = this.speed * (this.buffs.speed > 0 ? 1.28 : 1);
      this.moveBy(mv.x * sp * dt, mv.y * sp * dt, game);
      this.animT += dt;
    }

    // 普攻
    if ((input.mouse.down || input.isDown('KeyJ')) && this.atkCd <= 0) {
      this.basicAttack(game, aim);
    }

    // 闪避
    if (input.wasAnyPressed(['Space', 'ShiftLeft', 'ShiftRight'])) {
      this.tryDodge(input, game, aim);
    }

    // 技能
    if (input.wasPressed('Digit1')) this.castSkill(0, game, aim);
    if (input.wasPressed('Digit2')) this.castSkill(1, game, aim);
    if (input.wasPressed('Digit3')) this.castSkill(2, game, aim);

    // 刃轮
    if (this.bladeT > 0) {
      this.bladeT -= dt;
      this.bladeAngle += dt * 9;
      this.bladeTick -= dt;
      if (this.bladeTick <= 0) {
        this.bladeTick = 0.15;
        const dmg = 9 * this.dmgMult();
        game.areaEnemies(this.x, this.y, 132, dmg, 40);
        game.fx.ring(this.x, this.y, 60, 128, 'rgba(140,220,255,0.55)', 2, 0.22);
      }
    }
  }

  private moveBy(dx: number, dy: number, game: GameRef) {
    const p = game.world.collide(this.x + dx, this.y + dy, this.r);
    this.x = p.x;
    this.y = p.y;
  }

  private basicAttack(game: GameRef, aim: number) {
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
    game.fx.slash(this.x, this.y - 5, aim, range * 0.95, color, arc, this.comboStep === 2 ? 10 : 7, 0.55);
    game.audio.swing();
    if (hits > 0) {
      game.fx.burst(this.x + Math.cos(aim) * range * 0.7, this.y + Math.sin(aim) * range * 0.7, {
        count: 8,
        color: '#ff8a7a',
        color2: '#fff0c8',
        speed: 210,
        size: 2.4,
        life: 0.3,
        angle: aim,
        spread: 1.6,
      });
      game.audio.hit(this.comboStep === 2);
      game.shake(3 + this.comboStep);
    }
    this.x += Math.cos(aim) * 5;
    this.y += Math.sin(aim) * 5;
  }

  tryDodge(input: Input, game: GameRef, aim: number) {
    if (this.dodgeT > 0 || this.dodgeCd > 0) return;
    if (this.stamina < 25) {
      game.toast('气力不足，无法翻滚');
      return;
    }
    this.stamina -= 25;
    this.dodgeT = this.dodgeMax;
    this.dodgeDir = input.moveVec.len > 0 ? Math.atan2(input.moveVec.y, input.moveVec.x) : aim;
    this.invuln = Math.max(this.invuln, 0.24);
    this.perfectWindow = 0.16;
    this.ghostTimer = 0;
    this.audioDodge(game);
    game.fx.burst(this.x, this.y + 4, {
      count: 10,
      color: 'rgba(180,190,200,0.8)',
      color2: 'rgba(255,220,180,0.6)',
      speed: 90,
      size: 3,
      life: 0.35,
      shape: 'smoke',
      glow: false,
    });
  }

  private audioDodge(game: GameRef) {
    game.audio.dodge();
  }

  castSkill(i: number, game: GameRef, aim: number) {
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
      game.fx.rune(this.x, this.y + 2, 34, '#ff7a5a', 0.4);
      game.fx.ring(this.x, this.y, 10, 46, 'rgba(255,120,80,0.7)', 3, 0.3);
    } else if (i === 1) {
      this.bladeT = 1.15;
      this.bladeTick = 0;
      this.bladeAngle = Math.random() * TAU;
      game.audio.skill2();
      game.fx.rune(this.x, this.y + 2, 56, '#7fd8ff', 0.8);
      game.fx.ring(this.x, this.y, 20, 130, 'rgba(150,220,255,0.55)', 3, 0.45);
    } else {
      this.channel = this.channelMax;
      this.invuln = Math.max(this.invuln, 0.3);
      game.audio.skill3();
      game.fx.rune(this.x, this.y + 2, 96, '#ff9a52', 0.6);
      game.fx.ring(this.x, this.y, 20, 180, 'rgba(255,140,70,0.4)', 4, 0.5, true);
      game.shake(4);
    }
  }

  private releaseSkill3(game: GameRef) {
    const dmg = 95 * this.dmgMult();
    const hits = game.areaEnemies(this.x, this.y, 220, dmg, 340);
    game.fx.ring(this.x, this.y, 30, 240, 'rgba(255,190,120,0.95)', 8, 0.6);
    game.fx.ring(this.x, this.y, 10, 190, 'rgba(255,90,60,0.85)', 5, 0.45);
    game.fx.ring(this.x, this.y, 60, 150, 'rgba(255,240,200,0.9)', 2, 0.3);
    for (let k = 0; k < 4; k++) {
      game.fx.slash(this.x, this.y - 4, (k / 4) * TAU + 0.4, 150, '#ff6a4a', 2.6, 12, 0.8);
    }
    game.fx.burst(this.x, this.y, {
      count: 70,
      color: '#ff6a3a',
      color2: '#ffd27a',
      speed: 420,
      size: 3.6,
      life: 0.9,
      shape: 'ember',
    });
    game.fx.embers(this.x, this.y, 40, '#ff8a4a');
    game.shake(hits > 0 ? 22 : 14);
    game.punchZoom(9);
    game.flash('rgba(255,210,150,X)', 0.55);
    game.slowmo(0.24, 0.28);
    game.audio.hit(hits > 0);
  }

  perfectDodge(game: GameRef) {
    this.perfectWindow = 0;
    this.buffs.crit = 5;
    this.chi = Math.min(this.maxChi, this.chi + 25);
    this.stamina = Math.min(this.maxStamina, this.stamina + 40);
    game.slowmo(0.55, 0.3);
    game.shake(10);
    game.flash('rgba(150,230,255,X)', 0.4);
    game.fx.ring(this.x, this.y, 16, 120, 'rgba(150,235,255,0.9)', 4, 0.5);
    game.fx.text(this.x, this.y - 46, '完美闪避', '#9ef2ff', 20);
    game.fx.text(this.x, this.y - 68, '刀意·破', '#ffd889', 14);
    game.audio.perfect();
    game.onPerfectDodge();
  }

  takeDamage(amount: number, fromX: number, fromY: number, game: GameRef) {
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
    game.fx.text(this.x, this.y - 38, `-${dmg}`, '#ff6b6b', 18);
    game.fx.burst(this.x, this.y - 8, {
      count: 14,
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
      game.onPlayerDeath();
    }
  }

  heal(n: number, game: GameRef) {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    game.fx.text(this.x, this.y - 42, `+${Math.round(this.hp - before)}`, '#8ef0a0', 16);
    game.fx.burst(this.x, this.y - 10, {
      count: 12,
      color: '#7be08a',
      color2: '#d8ffcf',
      speed: 60,
      size: 2.6,
      life: 0.8,
      grav: -40,
      glow: true,
    });
    game.audio.heal();
  }

  restoreChi(n: number, game: GameRef) {
    this.chi = Math.min(this.maxChi, this.chi + n);
    game.fx.text(this.x, this.y - 42, `内力 +${n}`, '#8ec8ff', 15);
    game.fx.burst(this.x, this.y - 10, {
      count: 12,
      color: '#6aa7e8',
      color2: '#d8f0ff',
      speed: 80,
      size: 2.4,
      life: 0.7,
      grav: -30,
    });
    game.audio.heal();
  }

  /* ------------------------------ 绘制 ------------------------------ */
  draw(ctx: CanvasRenderingContext2D, time: number) {
    ctx.save();
    ctx.translate(Math.round(this.x), Math.round(this.y));

    // 影子
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 5, 15, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (this.dead) {
      ctx.rotate(-Math.PI / 2);
      ctx.globalAlpha = 0.8;
      this.drawBody(ctx, time, true);
      ctx.restore();
      return;
    }

    const bob = this.moving ? Math.sin(this.animT * 15) * 1.4 : Math.sin(time * 2.2) * 0.8;

    if (this.dodgeT > 0) {
      const p = 1 - this.dodgeT / this.dodgeMax;
      ctx.rotate(this.dodgeDir + Math.PI / 2);
      ctx.scale(1.05, 0.72 + Math.abs(Math.cos(p * Math.PI)) * 0.25);
      ctx.globalAlpha = 0.55 + (1 - p) * 0.45;
    }

    this.drawBody(ctx, time, false, bob);

    // 武器
    if (this.channel <= 0) {
      const swingP = this.swingT > 0 ? this.swingT / this.swingMax : 0;
      let swordAngle = this.facing;
      if (swingP > 0) {
        swordAngle = this.facing + Math.sin((1 - swingP) * Math.PI) * 1.5 - 0.75;
      }
      ctx.save();
      ctx.translate(4, -15);
      ctx.rotate(swordAngle);
      ctx.translate(9, 0);
      const crit = this.buffs.crit > 0;
      ctx.shadowColor = crit ? '#ff3b4a' : 'rgba(255,120,90,0.55)';
      ctx.shadowBlur = crit ? 16 : 8;
      ctx.fillStyle = '#2c3038';
      ctx.fillRect(-7, -2.4, 9, 4.8);
      ctx.fillStyle = crit ? '#ffe0d0' : '#dce6f2';
      ctx.fillRect(2, -1.7, 34, 3.4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, -1.7, 34, 1);
      ctx.restore();
    }

    // 完美闪避刀意光环
    if (this.buffs.crit > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + Math.sin(time * 10) * 0.12;
      ctx.strokeStyle = '#ff4d5a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 2, 20, 9, 0, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // 技能引导法阵
    if (this.channel > 0) {
      const p = 1 - this.channel / this.channelMax;
      ctx.save();
      ctx.translate(this.x, this.y + 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + p * 0.5;
      ctx.strokeStyle = '#ff9a52';
      ctx.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, 26 + p * 90 + k * 8, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, time: number, lying: boolean, bob = 0) {
    const hurt = this.hurtT > 0 && Math.floor(this.hurtT * 30) % 2 === 0;
    const robe = hurt ? '#e8b0a0' : '#181b22';
    const robeLight = hurt ? '#f0c4b4' : '#232833';
    const trim = '#8f2b33';
    const skin = hurt ? '#fff0e8' : '#d8b28c';

    if (!lying) {
      // 腿
      const stride = this.moving ? Math.sin(this.animT * 15) * 4 : 0;
      ctx.fillStyle = '#111319';
      ctx.fillRect(-7, -8 + stride * 0.2, 5, 10);
      ctx.fillRect(2, -8 - stride * 0.2, 5, 10);
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(-7, 0 + stride * 0.2, 5, 3);
      ctx.fillRect(2, 0 - stride * 0.2, 5, 3);

      // 披风
      ctx.fillStyle = robe;
      ctx.beginPath();
      ctx.moveTo(-12, -14 + bob);
      ctx.lineTo(-16 + Math.sin(time * 3) * 1.5, 4);
      ctx.lineTo(-4, 1);
      ctx.lineTo(0, -12 + bob);
      ctx.closePath();
      ctx.fill();

      // 身体
      ctx.fillStyle = robeLight;
      ctx.beginPath();
      ctx.moveTo(-8, -20 + bob);
      ctx.lineTo(8, -20 + bob);
      ctx.lineTo(9, -6 + bob);
      ctx.lineTo(-9, -6 + bob);
      ctx.closePath();
      ctx.fill();

      // 腰带
      ctx.fillStyle = trim;
      ctx.fillRect(-9, -11 + bob, 18, 3);
      ctx.fillStyle = '#d8a86a';
      ctx.fillRect(-2, -11 + bob, 4, 3);

      // 肩
      ctx.fillStyle = robe;
      ctx.fillRect(-11, -21 + bob, 22, 5);

      // 头
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, -27 + bob, 6.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#14161b';
      ctx.fillRect(-5, -32 + bob, 10, 4);
      // 斗笠
      ctx.fillStyle = '#2a2923';
      ctx.beginPath();
      ctx.ellipse(0, -31 + bob, 14, 5, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3a382f';
      ctx.beginPath();
      ctx.ellipse(0, -33 + bob, 7, 4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#8c2f36';
      ctx.fillRect(-2, -36 + bob, 4, 3);
    } else {
      ctx.fillStyle = robe;
      ctx.fillRect(-16, -10, 32, 12);
      ctx.fillStyle = trim;
      ctx.fillRect(-16, -2, 32, 3);
      ctx.fillStyle = '#2a2923';
      ctx.beginPath();
      ctx.ellipse(-4, -12, 10, 4, 0.2, 0, TAU);
      ctx.fill();
    }
  }

  drawOverlay(ctx: CanvasRenderingContext2D, time: number) {
    if (this.bladeT > 0) {
      const fade = Math.min(1, this.bladeT / 0.25);
      ctx.save();
      ctx.translate(this.x, this.y - 6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9 * fade;
      for (let i = 0; i < 8; i++) {
        const a = this.bladeAngle + (i / 8) * TAU;
        const r = 92 + Math.sin(time * 12 + i) * 6;
        ctx.save();
        ctx.rotate(a);
        ctx.translate(r, 0);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = 'rgba(160,230,255,0.85)';
        ctx.shadowColor = '#6ec8ff';
        ctx.shadowBlur = 12;
        ctx.fillRect(-1.4, -14, 2.8, 28);
        ctx.restore();
      }
      ctx.restore();
    }
  }
}
