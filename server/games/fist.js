/* ============================================================
 * server/games/fist.js —— 招式格斗（服务端权威）
 * ------------------------------------------------------------
 * 玩法：2 人同台，Q 版轻快格斗。左右各一人，跳跃、拳脚、三个专属技能。
 *       把对手血打空赢下这一回合，三局两胜。
 *
 * 服务端权威：位置、命中、伤害、冷却全部在服务端算，
 * 客户端只发输入（方向/跳/出招/技能）并画快照。
 * 网络差也不会出现「我明明打到了他没掉血」。
 *
 * 与单机版（games/fight/src/arena.js）共用同一套数值与判定规则，
 * 两边规则一致：同一个角度、同一个距离、同一个伤害公式。
 * ============================================================ */
'use strict';

/* ---------- 数值（与单机版一致） ---------- */
var FW = 960, FH = 540, GROUND = 452;
var GRAV = 2100, FRICTION = 0.86, AIR_DRAG = 0.995;

/* 角色表：id / 名字 / 速度 / 跳跃 / 力量 / 体力 / 身宽 / 身高 / 主色 / 副色 / 三个技能 */
var ROLLS = [
  { id: 'noodle', name: '面条', spd: 1.18, jump: 700, power: 0.86, hp: 100, w: 34, h: 62,
    col: '#ffd8a8', ac: '#ffb27a', skills: ['dash', 'spin', 'cloud'] },
  { id: 'sprout', name: '豆芽', spd: 1.02, jump: 790, power: 0.95, hp: 92, w: 32, h: 58,
    col: '#b7e58a', ac: '#7fc95f', skills: ['leap', 'leaf', 'root'] },
  { id: 'pebble', name: '石子', spd: 0.84, jump: 620, power: 1.28, hp: 126, w: 42, h: 58,
    col: '#c3c8d6', ac: '#8f97ab', skills: ['charge', 'quake', 'guard'] },
  { id: 'ember', name: '小火星', spd: 1.32, jump: 700, power: 0.9, hp: 88, w: 30, h: 60,
    col: '#ff9f6e', ac: '#ff6b4a', skills: ['blaze', 'afterimage', 'flare'] }
];

/* 技能表 */
var SKILLS = {
  punch:     { name: '直拳', cd: 0.28, cost: 0,  dur: 0.16, dmg: 7,  reach: 46,  kind: 'punch', spd: 0.9 },
  kick:      { name: '小踢', cd: 0.42, cost: 0,  dur: 0.2,  dmg: 10, reach: 60,  kind: 'kick',  spd: 0.75 },
  dash:      { name: '滑步', cd: 1.5,  cost: 18, dur: 0.28, dmg: 0,  reach: 0,   kind: 'dash',  spd: 3.4 },
  spin:      { name: '旋风踢', cd: 3.0, cost: 30, dur: 0.55, dmg: 13, reach: 66,  kind: 'spin',  spd: 1.5 },
  cloud:     { name: '软绵绵', cd: 4.2, cost: 34, dur: 1.4, dmg: 0,  reach: 0,   kind: 'guard', spd: 1 },
  leap:      { name: '跳豆', cd: 1.8,  cost: 20, dur: 0.5,  dmg: 12, reach: 52,  kind: 'punch', spd: 1.2 },
  leaf:      { name: '叶刃', cd: 3.2,  cost: 28, dur: 0.1,  dmg: 11, reach: 0,   kind: 'proj',  spd: 0 },
  root:      { name: '扎根', cd: 4.5,  cost: 32, dur: 1.2, dmg: 0,  reach: 0,   kind: 'guard', spd: 0 },
  charge:    { name: '滚石冲', cd: 2.4, cost: 26, dur: 0.6,  dmg: 16, reach: 44,  kind: 'punch', spd: 2.6 },
  quake:     { name: '震地', cd: 4.0,  cost: 32, dur: 0.3,  dmg: 14, reach: 120, kind: 'quake', spd: 0 },
  guard:     { name: '石壳', cd: 5.0,  cost: 34, dur: 1.6,  dmg: 0,  reach: 0,   kind: 'guard', spd: 0.6 },
  blaze:     { name: '火星拳', cd: 1.1, cost: 16, dur: 0.14, dmg: 8,  reach: 52,  kind: 'punch', spd: 1.1 },
  afterimage:{ name: '残影', cd: 3.4,  cost: 30, dur: 0.7,  dmg: 0,  reach: 0,   kind: 'dash',  spd: 2.4 },
  flare:     { name: '耀斑', cd: 5.5,  cost: 38, dur: 0.35, dmg: 20, reach: 150, kind: 'quake', spd: 0 }
};

function rollOf(id) {
  for (var i = 0; i < ROLLS.length; i++) if (ROLLS[i].id === id) return ROLLS[i];
  return ROLLS[0];
}

var COLORS = ['#ffd8a8', '#b7e58a', '#c3c8d6', '#ff9f6e'];
var WINS_TO_TAKE = 2;      /* 三局两胜 */
var ROUND_LIMIT = 45;      /* 单回合上限（秒） */

exports.meta = {
  name: '招式格斗', min: 2, max: 2, colors: COLORS, w: FW, h: FH,
  rolls: ROLLS.map(function (r) { return { id: r.id, name: r.name, col: r.col, ac: r.ac }; })
};

exports.create = function (ctx) {
  var rand = ctx.random;
  var players = ctx.players;
  var events = [];
  var over = null;

  /* 角色分配：两人各拿一个不同的角色。
     先给 0 号位随机一个，再给 1 号位从剩下的里挑。 */
  var rollPool = ROLLS.map(function (r) { return r.id; });
  var firstRoll = rollPool.splice(Math.floor(rand() * rollPool.length) % rollPool.length, 1)[0];
  var secondRoll = rollPool[Math.floor(rand() * rollPool.length) % rollPool.length];

  /* 座位 0 在左（朝右），座位 1 在右（朝左） */
  var fighters = players.map(function (p, i) {
    var rid = i === 0 ? firstRoll : secondRoll;
    var r = rollOf(rid);
    return {
      id: p.id, name: p.name, seat: p.seat, roll: rid,
      x: i === 0 ? 250 : FW - 250, y: GROUND, vx: 0, vy: 0,
      hp: r.hp, max: r.hp, energy: 100,
      face: i === 0 ? 1 : -1,
      onGround: true,
      atk: null, cd: {}, guard: 0, hurt: 0, stun: 0, dash: 0,
      mx: 0, wantJump: false, wantAtk: null, wantSkill: null,
      wins: 0, combo: 0, comboT: 0
    };
  });

  var proj = [];            /* 飞行道具 */
  var round = 1;
  var roundT = 0;
  var roundEnd = 0;         /* >0 表示已结算，等客户端播完动画 */

  function byId(id) {
    for (var i = 0; i < fighters.length; i++) if (fighters[i].id === id) return fighters[i];
    return null;
  }
  function other(f) { return fighters[0] === f ? fighters[1] : fighters[0]; }

  function hurt(att, def, s) {
    var r = rollOf(att.roll);
    var dmg = Math.round(s.dmg * r.power);
    var blocked = def.guard > 0;
    if (blocked) dmg = Math.max(1, Math.round(dmg * 0.25));
    def.hp -= dmg;
    def.hurt = 0.22;
    def.stun = blocked ? 0.06 : (s.kind === 'quake' ? 0.28 : 0.2);
    if (!blocked) {
      def.vx += att.face * (s.kind === 'quake' ? 40 : 150);
      def.vy -= s.kind === 'quake' ? 30 : 95;
      att.combo = att.comboT > 0 ? att.combo + 1 : 1;
      att.comboT = 1.1;
    }
    events.push({ e: 'hit', x: Math.round(def.x), y: Math.round(def.y - 30), dmg: dmg, block: blocked, by: att.id, on: def.id });
    if (def.hp <= 0) {
      def.hp = 0;
      events.push({ e: 'ko', x: Math.round(def.x), y: Math.round(def.y - 40), by: att.id });
    }
  }

  function hitTest(a, b) {
    if (!a.atk || a.atk.hit) return null;
    var s = SKILLS[a.atk.id];
    if (!s) return null;
    if (s.kind === 'quake') {
      if (Math.abs(b.x - a.x) > s.reach) return null;
    } else {
      var dx = (b.x - a.x) * a.face;
      /* 近战判定：正前方 reach 内命中。
         贴身（两人贴在一起、dx 为负）也算命中 —— 格斗里贴脸出拳是
         最常见的进攻姿势，因为判定用「绝对距离」而不是「方向 + 距离」，
         玩家明明站到了对手身上却打不到，会以为游戏坏了。 */
      if (dx > s.reach) return null;
      if (dx < -30) return null;
      if (Math.abs(b.x - a.x) > s.reach + 34) return null;
      if (Math.abs(b.y - a.y) > 58) return null;
    }
    a.atk.hit = true;
    return b;
  }

  function startRound() {
    roundT = 0;
    roundEnd = 0;
    proj.length = 0;
    fighters.forEach(function (f, i) {
      var r = rollOf(f.roll);
      f.x = i === 0 ? 250 : FW - 250;
      f.y = GROUND; f.vx = 0; f.vy = 0;
      f.hp = r.hp; f.energy = 100;
      f.atk = null; f.cd = {}; f.guard = 0; f.hurt = 0; f.stun = 0; f.dash = 0;
      f.combo = 0; f.comboT = 0;
      f.face = i === 0 ? 1 : -1;
    });
    events.push({ e: 'round', n: round });
  }

  function finishRound(winnerId) {
    if (roundEnd) return;
    roundEnd = 1.1;                       /* 留 1.1 秒播 K.O. */
    var w = winnerId ? byId(winnerId) : null;
    if (w) w.wins += 1;
    events.push({ e: 'roundend', winner: winnerId || '', wins: fighters.map(function (f) { return f.wins; }) });
  }

  function finish(reason) {
    if (over) return;
    var rank = fighters.slice().sort(function (a, b) { return b.wins - a.wins || b.hp - a.hp; });
    over = {
      game: 'fist', winner: rank[0] ? rank[0].id : null, reason: reason || 'rounds',
      scores: rank.map(function (f, i) {
        return { id: f.id, name: f.name, score: f.wins, rank: i + 1, roll: f.roll };
      })
    };
  }

  function stepFighter(f, dt) {
    var r = rollOf(f.roll);

    for (var k in f.cd) {
      if (f.cd[k] > 0) { f.cd[k] -= dt; if (f.cd[k] <= 0) delete f.cd[k]; }
    }
    f.comboT = Math.max(0, f.comboT - dt);
    if (f.comboT === 0) f.combo = 0;
    f.hurt = Math.max(0, f.hurt - dt);
    f.stun = Math.max(0, f.stun - dt);
    f.guard = Math.max(0, f.guard - dt);

    if (f.stun > 0) { f.mx = 0; f.wantJump = false; f.wantAtk = null; f.wantSkill = null; }

    if (f.wantJump && f.onGround && f.stun <= 0) {
      f.vy = -r.jump; f.onGround = false;
      events.push({ e: 'jump', x: Math.round(f.x), y: Math.round(f.y) });
    }

    if (f.atk) {
      f.atk.t += dt;
      if (f.atk.t >= f.atk.dur) f.atk = null;
    } else if (f.wantAtk && f.stun <= 0) {
      var aid = f.wantAtk === 'kick' ? 'kick' : 'punch';
      var as = SKILLS[aid];
      if (!f.cd[aid]) {
        f.cd[aid] = as.cd;
        f.atk = { id: aid, t: 0, dur: as.dur, hit: false };
        events.push({ e: 'swing', x: Math.round(f.x), y: Math.round(f.y - 20), id: aid, by: f.id });
      }
    }

    if (f.wantSkill && f.stun <= 0 && !f.atk) {
      var sid = f.wantSkill;
      var ss = SKILLS[sid];
      if (ss && !f.cd[sid] && f.energy >= ss.cost) {
        f.cd[sid] = ss.cd;
        f.energy -= ss.cost;
        f.atk = { id: sid, t: 0, dur: ss.dur, hit: false };
        if (ss.kind === 'guard') f.guard = ss.dur + 0.4;
        if (ss.kind === 'dash') f.dash = ss.dur;
        events.push({ e: 'cast', x: Math.round(f.x), y: Math.round(f.y - 26), id: sid, name: ss.name, by: f.id });
        /* 飞行道具：真正生成一个弹体，让它飞出去打中人。
           （之前只播特效，弹体从没生成过 —— 「叶刃」按出去什么也不会发生。） */
        if (ss.kind === 'proj') {
          proj.push({ x: f.x + f.face * 24, y: f.y - 26, dir: f.face, owner: f.id, skill: sid });
        }
      }
    }

    /* 招式命中 */
    if (f.atk) {
      var s2 = SKILLS[f.atk.id];
      if (s2 && s2.kind !== 'proj') {
        var t = hitTest(f, other(f));
        if (t) hurt(f, t, s2);
      }
    }

    /* 水平移动 */
    var sp = r.spd * 300;
    var atkSpd = 1;
    if (f.atk) { var s3 = SKILLS[f.atk.id]; if (s3) atkSpd = s3.spd || 1; }
    var mv = (f.mx && f.stun <= 0) ? f.mx * sp * atkSpd : 0;
    if (f.mx) f.face = f.mx > 0 ? 1 : -1;
    f.vx += (mv - f.vx) * Math.min(1, dt * 14);

    f.vy += GRAV * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    if (f.y >= GROUND) {
      f.y = GROUND;
      if (!f.onGround && f.vy > 260) events.push({ e: 'land', x: Math.round(f.x), y: GROUND });
      f.vy = 0; f.onGround = true; f.vx *= FRICTION;
    } else {
      f.onGround = false; f.vx *= AIR_DRAG;
    }

    var half = r.w / 2;
    if (f.x < half) { f.x = half; f.vx = 0; }
    if (f.x > FW - half) { f.x = FW - half; f.vx = 0; }

    if (f.energy < 100) f.energy = Math.min(100, f.energy + 13 * dt);
  }

  var api = {
    onInput: function (p, d) {
      var f = byId(p.id);
      if (!f || !d) return;
      if (typeof d.mx === 'number') f.mx = Math.max(-1, Math.min(1, d.mx));
      if (d.jump) f.wantJump = true;
      if (d.atk) f.wantAtk = d.atk;
      if (d.skill) f.wantSkill = d.skill;
    },
    onAction: function (p, d) {
      var f = byId(p.id);
      if (!f || !d) return;
      if (d.a === 'jump') f.wantJump = true;
      else if (d.a === 'atk') f.wantAtk = d.atk || 'punch';
      else if (d.a === 'skill') f.wantSkill = d.skill;
    },
    step: function (dt) {
      if (over) return;
      /* 输入是一次性的，用完清掉（避免一直按着就反复触发） */
      var i;
      for (i = 0; i < fighters.length; i++) {
        var f = fighters[i];
        stepFighter(f, dt);
        f.wantJump = false; f.wantAtk = null; f.wantSkill = null;
      }

      /* 推挤：两人不能完全重叠（否则会站进对方身体里，判定全靠宽容区间兜底） */
      if (fighters.length === 2) {
        var a = fighters[0], b = fighters[1];
        var minD = (rollOf(a.roll).w + rollOf(b.roll).w) / 2;
        var gap = b.x - a.x;
        if (Math.abs(gap) < minD && Math.abs(a.y - b.y) < 46) {
          var push = (minD - Math.abs(gap)) / 2 * (gap >= 0 ? 1 : -1);
          a.x -= push; b.x += push;
          a.x = Math.max(rollOf(a.roll).w / 2, Math.min(FW - rollOf(a.roll).w / 2, a.x));
          b.x = Math.max(rollOf(b.roll).w / 2, Math.min(FW - rollOf(b.roll).w / 2, b.x));
        }
      }

      /* 两人不能互相穿过：贴到身宽之和的一半就推开。
         （少了这一步，双方会「穿模」swap 位置，攻击方向判定全乱，
           实测表现为走近了却打不到人。） */
      if (fighters.length === 2) {
        var a0 = fighters[0], b0 = fighters[1];
        var ra = rollOf(a0.roll), rb = rollOf(b0.roll);
        var minD = (ra.w + rb.w) / 2;
        var ddx = a0.x - b0.x;
        if (Math.abs(ddx) < minD && Math.abs(a0.y - b0.y) < 46) {
          var push = (minD - Math.abs(ddx)) / 2 * (ddx > 0 ? 1 : -1);
          a0.x += push; b0.x -= push;
        }
      }

      /* 飞行道具 */
      for (i = proj.length - 1; i >= 0; i--) {
        var pr = proj[i];
        var pskill = SKILLS[pr.skill] || SKILLS.leaf;
        pr.x += pr.dir * 420 * dt;
        var owner = byId(pr.owner);
        var target = owner ? other(owner) : null;
        if (target && Math.abs(pr.x - target.x) < 24 && Math.abs(pr.y - (target.y - 26)) < 40) {
          if (owner) hurt(owner, target, pskill);
          proj.splice(i, 1);
          continue;
        }
        if (pr.x < -30 || pr.x > FW + 30) proj.splice(i, 1);
      }

    /* 回合结算 */
    if (roundEnd > 0) {        roundEnd -= dt;
        if (roundEnd <= 0) {
          var champ = null;
          for (i = 0; i < fighters.length; i++) if (fighters[i].wins >= WINS_TO_TAKE) champ = fighters[i].id;
          if (champ) { finish('rounds'); return; }
          round += 1;
          startRound();
        }
        return;
      }

      roundT += dt;
      var dead = [];
      for (i = 0; i < fighters.length; i++) if (fighters[i].hp <= 0) dead.push(fighters[i].id);
      if (dead.length) {
        /* 都倒下算平局 */
        var w = dead.length === fighters.length ? null : (dead[0] === fighters[0].id ? fighters[1].id : fighters[0].id);
        finishRound(w);
        return;
      }
      if (roundT > ROUND_LIMIT) {
        /* 时间到：血少的一方算输 */
        var a = fighters[0], b = fighters[1];
        finishRound(a.hp === b.hp ? null : (a.hp < b.hp ? b.id : a.id));
      }
    },
    snapshot: function (tick) {
      var out = {
        t: tick,
        r: round,
        rt: Math.round(Math.max(0, ROUND_LIMIT - roundT)),
        /* 每个角色：[id, x, y, face, hp, maxHp, energy, rollIdx, atkId, guard, combo, wins]
           坐标保留 1 位小数：格斗是像素级连续动作，压太狠会看出跳动。
           其它数值都是整数。 */
        f: fighters.map(function (x) {
          var r = ROLLS.indexOf(rollOf(x.roll));
          return [
            x.id, Math.round(x.x * 10) / 10, Math.round(x.y * 10) / 10, x.face,
            Math.round(x.hp), x.max, Math.round(x.energy),
            r, x.atk ? x.atk.id : '', x.guard > 0 ? 1 : 0,
            x.combo, x.wins
          ];
        }),
        p: proj.length ? proj.map(function (x) { return [Math.round(x.x), Math.round(x.y), x.dir]; }) : undefined,
        /* 技能冷却：只发非零的，省带宽。空数组（而不是 undefined），
           免得 JSON 序列化成 null 让客户端读到 null。 */
        sk: fighters.map(function (x) {
          var r = rollOf(x.roll);
          var out2 = [];
          for (var i = 0; i < r.skills.length; i++) {
            var cd = x.cd[r.skills[i]] || 0;
            if (cd > 0) out2.push([i, Math.round(cd * 10) / 10]);
          }
          return out2;
        })
      };
      if (events.length) { out.ev = events.slice(0, 16); events.length = 0; }
      if (roundEnd > 0) out.re = Math.round(roundEnd * 100) / 100;
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      /* 有人走了：直接判另一方赢，别让剩下的人对着空气挥拳 */
      var f = byId(p.id);
      if (!f || over) return;
      var o = other(f);
      if (o) { o.wins = WINS_TO_TAKE; finish('leave'); }
    }
  };

  startRound();
  return api;
};
