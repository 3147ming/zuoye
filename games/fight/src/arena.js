/* ============================================================
 * games/fight/src/arena.js —— 招式格斗：核心数据与物理
 * ------------------------------------------------------------
 * 自研实现。轻快风格：Q 版小人身、柔和配色、跳跃感强。
 *
 * 结构：
 *   ROLLS   角色表（4 个，各有体型/速度/跳跃/力量差异）
 *   SKILLS  技能表（每个角色 3 个技能 + 通用普通技）
 *   Arena   战斗场景：物理推进、攻击判定、结算
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 场地 ---------- */
  var W = 960, H = 540;
  var GROUND = 452;          /* 地面 y */
  var GRAV = 2100;           /* 重力 px/s² */
  var FRICTION = 0.86;       /* 地面摩擦 */
  var AIR_DRAG = 0.995;

  /* ---------- 角色表 ----------
     spd   水平速度倍率
     jump  起跳初速
     power 伤害倍率
     hp    生命上限
     w     身宽（用于受击框）
     h     身高
     col   主色
     accent 副色
  */
  var ROLLS = [
    {
      id: 'noodle', name: '面条', title: '软绵绵但很滑',
      spd: 1.18, jump: 700, power: 0.86, hp: 100, w: 34, h: 62,
      col: '#ffd8a8', accent: '#ffb27a', hair: '#8a5a3b',
      skills: ['dash', 'spin', 'cloud']
    },
    {
      id: 'sprout', name: '豆芽', title: '蹦得老高',
      spd: 1.02, jump: 790, power: 0.95, hp: 92, w: 32, h: 58,
      col: '#b7e58a', accent: '#7fc95f', hair: '#4f8f3a',
      skills: ['leap', 'leaf', 'root']
    },
    {
      id: 'pebble', name: '石子', title: '皮厚抗揍',
      spd: 0.84, jump: 620, power: 1.28, hp: 126, w: 42, h: 58,
      col: '#c3c8d6', accent: '#8f97ab', hair: '#5c6376',
      skills: ['charge', 'quake', 'guard']
    },
    {
      id: 'ember', name: '小火星', title: '出手最快',
      spd: 1.32, jump: 700, power: 0.9, hp: 88, w: 30, h: 60,
      col: '#ff9f6e', accent: '#ff6b4a', hair: '#ffd166',
      skills: ['blaze', 'afterimage', 'flare']
    }
  ];

  /* ---------- 技能表 ----------
     cd    冷却（秒）
     cost  能量消耗
     dur   持续时间（秒）
     dmg   伤害
     reach 攻击距离
     kind  判定形状
     spd   技能期间的移速倍率（1 表示不变）
     proj  是否是飞行道具
  */
  var SKILLS = {
    /* 通用 */
    punch: { name: '直拳', cd: 0.28, cost: 0, dur: 0.16, dmg: 7, reach: 46, kind: 'punch', spd: 0.9 },
    kick:  { name: '小踢', cd: 0.42, cost: 0, dur: 0.2,  dmg: 10, reach: 60, kind: 'kick',  spd: 0.75 },
    /* 面条 */
    dash:  { name: '滑步', cd: 1.5, cost: 18, dur: 0.28, dmg: 0,  reach: 0,  kind: 'dash',  spd: 3.4 },
    spin:  { name: '旋风踢', cd: 3.0, cost: 30, dur: 0.55, dmg: 13, reach: 66, kind: 'spin', spd: 1.5 },
    cloud: { name: '软绵绵', cd: 4.2, cost: 34, dur: 1.4, dmg: 0,  reach: 0,  kind: 'guard', spd: 1 },
    /* 豆芽 */
    leap:  { name: '跳豆', cd: 1.8, cost: 20, dur: 0.5, dmg: 12, reach: 52, kind: 'punch', spd: 1.2 },
    leaf:  { name: '叶刃', cd: 3.2, cost: 28, dur: 0.1, dmg: 11, reach: 0,  kind: 'proj',  spd: 0 },
    root:  { name: '扎根', cd: 4.5, cost: 32, dur: 1.2, dmg: 0,  reach: 0,  kind: 'guard', spd: 0 },
    /* 石子 */
    charge:{ name: '滚石冲', cd: 2.4, cost: 26, dur: 0.6, dmg: 16, reach: 44, kind: 'punch', spd: 2.6 },
    quake: { name: '震地', cd: 4.0, cost: 32, dur: 0.3, dmg: 14, reach: 120, kind: 'quake', spd: 0 },
    guard: { name: '石壳', cd: 5.0, cost: 34, dur: 1.6, dmg: 0,  reach: 0,  kind: 'guard', spd: 0.6 },
    /* 小火星 */
    blaze: { name: '火星拳', cd: 1.1, cost: 16, dur: 0.14, dmg: 8,  reach: 52, kind: 'punch', spd: 1.1 },
    afterimage:{ name: '残影', cd: 3.4, cost: 30, dur: 0.7, dmg: 0,  reach: 0,  kind: 'dash',  spd: 2.4 },
    flare: { name: '耀斑', cd: 5.5, cost: 38, dur: 0.35, dmg: 20, reach: 150, kind: 'quake', spd: 0 }
  };

  /* ---------- 工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rollOf(id) {
    for (var i = 0; i < ROLLS.length; i++) if (ROLLS[i].id === id) return ROLLS[i];
    return ROLLS[0];
  }
  function skillOf(id) {
    if (SKILLS[id]) return SKILLS[id];
    var r = rollOf(id);
    if (r && r.skills && r.skills.length) return SKILLS[r.skills[0]];
    return SKILLS.punch;
  }

  /* ---------- 角色实例 ---------- */
  function makeFighter(rollId, side, x) {
    var r = rollOf(rollId);
    return {
      roll: r.id,
      name: r.name,
      side: side,            /* -1 左，+1 右 */
      x: x, y: GROUND, vx: 0, vy: 0,
      hp: r.hp, max: r.hp,
      energy: 100, maxEnergy: 100,
      face: side,            /* 朝向 */
      onGround: true,
      atk: null,             /* 当前招式 {id, t, dur, hit:false} */
      cd: {},                /* 技能冷却剩余 */
      guard: 0,              /* 防御剩余时间 */
      hurt: 0,               /* 受击闪白 */
      stun: 0,               /* 硬直 */
      dash: 0,
      wins: 0,
      combo: 0,
      comboT: 0
    };
  }

  /* ---------- 攻击判定 ----------
     返回被击中的对手（没有则 null） */
  function hitTest(a, b) {
    if (!a.atk || a.atk.hit) return null;
    var s = SKILLS[a.atk.id];
    if (!s) return null;
    var reach = s.reach;
    if (s.kind === 'quake') {
      /* 震地：以自己为中心上下都算，范围是 reach */
      if (Math.abs(b.x - a.x) > reach) return null;
    } else if (s.kind === 'proj') {
      /* 飞行道具：由弹体判定，函数内不处理 */
      return null;
    } else {
      /* 近战：朝向 + 距离。
         贴身（两人贴在一起、dx 为负）也算命中 —— 格斗里贴脸出拳是
         最常见的进攻姿势，用「绝对距离」判定才符合直觉；
         玩家明明站到对手身上却打不到，会以为游戏坏了。 */
      var dx = (b.x - a.x) * a.face;
      if (dx > reach) return null;
      if (dx < -30) return null;
      if (Math.abs(b.x - a.x) > reach + 34) return null;
      var dy = Math.abs(b.y - a.y);
      if (dy > 58) return null;
    }
    a.atk.hit = true;
    return b;
  }

  /* ---------- 伤害结算 ---------- */
  function damage(a, b, s, out) {
    var r = rollOf(a.roll);
    var dmg = Math.round(s.dmg * r.power);
    var blocked = b.guard > 0;
    if (blocked) dmg = Math.max(1, Math.round(dmg * 0.25));
    b.hp -= dmg;
    b.hurt = 0.22;
    b.stun = blocked ? 0.06 : (s.kind === 'quake' ? 0.28 : 0.2);
    if (!blocked) {
      b.vx += a.face * (s.kind === 'quake' ? 40 : 150);
      b.vy -= s.kind === 'quake' ? 30 : 95;
      a.combo = (a.comboT > 0 ? a.combo + 1 : 1);
      a.comboT = 1.1;
    }
    if (out) out.push({ t: 'hit', x: b.x, y: b.y - 30, dmg: dmg, block: blocked, by: a.side });
    if (b.hp <= 0) {
      b.hp = 0;
      if (out) out.push({ t: 'ko', x: b.x, y: b.y - 40, by: a.side });
    }
    return dmg;
  }

  /* ---------- 主推进 ----------
     f1/f2    两名角色
     inp     { p1: {mx, jump, atk, skill}, p2: {...} }
     dt      秒
     out     事件数组（会 push）
     返回 { over: 0|1|-1, round }   -1 表示平局
  */
  function step(f1, f2, inp1, inp2, dt, out) {
    var list = [[f1, inp1 || {}], [f2, inp2 || {}]];
    for (var i = 0; i < 2; i++) {
      var f = list[i][0], inp = list[i][1];
      var foe = list[1 - i][0];

      /* 冷却与能量 */
      for (var k in f.cd) {
        if (f.cd[k] > 0) {
          f.cd[k] -= dt;
          if (f.cd[k] <= 0) delete f.cd[k];
        }
      }
      f.comboT = Math.max(0, f.comboT - dt);
      if (f.comboT === 0) f.combo = 0;
      f.hurt = Math.max(0, f.hurt - dt);
      f.stun = Math.max(0, f.stun - dt);
      f.guard = Math.max(0, f.guard - dt);

      if (f.stun > 0) { inp = { mx: 0, jump: 0, atk: null, skill: null }; }

      var r = rollOf(f.roll);

      /* 起跳 */
      if (inp.jump && f.onGround && f.stun <= 0) {
        f.vy = -r.jump;
        f.onGround = false;
        if (out) out.push({ t: 'jump', x: f.x, y: f.y });
      }

      /* 出招：普通技 */
      if (f.atk) {
        f.atk.t += dt;
        if (f.atk.t >= f.atk.dur) f.atk = null;
      } else if (inp.atk && f.stun <= 0) {
        var aid = inp.atk === 'kick' ? 'kick' : 'punch';
        var as = SKILLS[aid];
        if (!f.cd[aid]) {
          f.cd[aid] = as.cd;
          f.atk = { id: aid, t: 0, dur: as.dur, hit: false };
          if (out) out.push({ t: 'swing', x: f.x, y: f.y - 20, id: aid });
        }
      }

      /* 技能 */
      if (inp.skill && f.stun <= 0 && !f.atk) {
        var sid = inp.skill;
        var ss = SKILLS[sid];
        if (ss && !f.cd[sid] && f.energy >= ss.cost) {
          f.cd[sid] = ss.cd;
          f.energy -= ss.cost;
          f.atk = { id: sid, t: 0, dur: ss.dur, hit: false };
          if (ss.kind === 'guard') f.guard = ss.dur + 0.4;
          if (ss.kind === 'dash') f.dash = ss.dur;
          if (out) out.push({ t: 'cast', x: f.x, y: f.y - 26, id: sid, name: ss.name });
        }
      }

      /* 招式结算 */
      if (f.atk) {
        var s2 = SKILLS[f.atk.id];
        if (s2) {
          if (s2.kind === 'proj' && !f.atk.hit) {
            /* 飞行道具：生成一次 */
            f.atk.hit = true;
            if (out) out.push({ t: 'proj', x: f.x + f.face * 24, y: f.y - 26, id: f.atk.id, dir: f.face });
          } else if (s2.kind !== 'proj') {
            var t = hitTest(f, foe);
            if (t) damage(f, foe, s2, out);
          }
        }
      }

      /* 水平移动 */
      var mv = 0;
      if (inp.mx && f.stun <= 0) {
        var sp = r.spd * 300;
        var atkSpd = 1;
        if (f.atk) {
          var s3 = SKILLS[f.atk.id];
          if (s3) atkSpd = s3.spd || 1;
        }
        if (f.dash > 0) { f.dash -= dt; }
        mv = inp.mx * sp * atkSpd;
        if (inp.mx) f.face = inp.mx > 0 ? 1 : -1;
      }
      f.vx += (mv - f.vx) * Math.min(1, dt * 14);

      /* 物理 */
      f.vy += GRAV * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      /* 地面 */
      if (f.y >= GROUND) {
        f.y = GROUND;
        if (!f.onGround && f.vy > 260 && out) out.push({ t: 'land', x: f.x, y: GROUND });
        f.vy = 0;
        f.onGround = true;
        f.vx *= FRICTION;
      } else {
        f.onGround = false;
        f.vx *= AIR_DRAG;
      }

      /* 边界 */
      var half = r.w / 2;
      if (f.x < half) { f.x = half; f.vx = 0; }
      if (f.x > W - half) { f.x = W - half; f.vx = 0; }

      /* 不许穿过对方 */
      var dx = f.x - foe.x;
      var minD = (r.w + rollOf(foe.roll).w) / 2;
      if (Math.abs(dx) < minD && Math.abs(f.y - foe.y) < 46) {
        var push = (minD - Math.abs(dx)) / 2 * (dx > 0 ? 1 : -1);
        f.x += push;
        foe.x -= push;
      }

      /* 能量自然回复 */
      if (f.energy < f.maxEnergy) f.energy = Math.min(f.maxEnergy, f.energy + 13 * dt);
    }

    /* 结算 */
    if (f1.hp <= 0 && f2.hp <= 0) return { over: -1 };
    if (f2.hp <= 0) return { over: 1 };
    if (f1.hp <= 0) return { over: 2 };
    return { over: 0 };
  }

  global.FightArena = {
    W: W, H: H, GROUND: GROUND,
    ROLLS: ROLLS, SKILLS: SKILLS,
    makeFighter: makeFighter,
    rollOf: rollOf, skillOf: skillOf,
    step: step, damage: damage,
    clamp: clamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
