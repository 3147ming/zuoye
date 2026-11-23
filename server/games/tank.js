/* ============================================================
 * server/games/tank.js —— 坦克大战（服务端权威）
 * ------------------------------------------------------------
 * 玩法：2–4 人同图，各占一角，坦克可前后走、左右转向、开炮（有冷却）。
 *       炮弹打出后按炮口方向直飞，打中人就扣血、打中墙就消失。
 *       先拿 5 分（每次击中 +1，击毁 +3）。
 *
 * 1.20 起加厚三层：
 *   · 3 套战场（十字掩体 / 双塔对峙 / 巷战走廊），随局切换；
 *   · 砖墙可打碎（两发），打碎后多出一条射击线，残局不再僵持；
 *   · 三种补给（加速 / 护盾 / 连发）定期刷新，捡到就能翻盘。
 *
 * 服务端权威的好处：命中判定只在一个地方算，网络差也不会各说各话。
 * ============================================================ */
'use strict';

// #shared-begin tank-physics
var TK_C = { w: 1000, h: 660, spd: 190, turn: 2.6, shellSpd: 620 };
/* ============================================================
 * 共享物理（服务端权威 + 客户端预测）
 * ------------------------------------------------------------
 * stepTank / stepShell 同时被服务端和客户端使用，必须保持「纯」：
 * 只读传进来的 walls / bricks / tanks，不读时间、不用随机。
 * 命中与伤害仍然只在服务端算（客户端只借它做自己的位移与炮弹飞行）。
 * ============================================================ */
function stepTank(t, inp, walls, bricks, tanks, selfId) {
  var dt = 1 / 60;
  var SPD = TK_C.spd, TURN = TK_C.turn, W = TK_C.w, H = TK_C.h;
  var thr = inp && inp.thr || 0, turn = inp && inp.turn || 0;
  var spd = SPD * ((inp && inp.sp) || 1);
  if (turn) t.a += turn * TURN * dt;
  if (thr) {
    var nx = t.x + Math.cos(t.a) * thr * spd * dt;
    var ny = t.y + Math.sin(t.a) * thr * spd * dt;
    if (!tankBlocked(nx, ny, walls, bricks, tanks, selfId)) { t.x = nx; t.y = ny; }
  }
  return t;
}

function tankBlocked(x, y, walls, bricks, tanks, selfId) {
  var W = TK_C.w, H = TK_C.h;
  if (x < 24 || y < 24 || x > W - 24 || y > H - 24) return true;
  var i, w;
  for (i = 0; i < walls.length; i++) {
    w = walls[i];
    if (x > w[0] - 4 && x < w[0] + w[2] + 4 && y > w[1] - 4 && y < w[1] + w[3] + 4) return true;
  }
  for (i = 0; i < bricks.length; i++) {
    w = bricks[i];
    if (w[4] != null && w[4] <= 0) continue;
    if (x > w[0] - 4 && x < w[0] + w[2] + 4 && y > w[1] - 4 && y < w[1] + w[3] + 4) return true;
  }
  if (tanks) {
    for (i = 0; i < tanks.length; i++) {
      var o = tanks[i];
      if (!o || o.id === selfId || o.alive === false) continue;
      if (Math.hypot(o.x - x, o.y - y) < 42) return true;
    }
  }
  return false;
}

/* 炮弹一帧：返回 { hit:'wall'|'brick'|'tank'|'out'|null, tank:被命中的坦克 } */
function stepShell(s, walls, bricks, tanks, owner, skipIds) {
  var dt = 1 / 60;
  var W = TK_C.w, H = TK_C.h;
  s.life -= dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  if (s.life <= 0 || s.x < 0 || s.y < 0 || s.x > W || s.y > H) return { hit: 'out' };
  var i;
  for (i = 0; i < bricks.length; i++) {
    var bw = bricks[i];
    if (s.x > bw[0] && s.x < bw[0] + bw[2] && s.y > bw[1] && s.y < bw[1] + bw[3]) return { hit: 'brick', brick: i };
  }
  for (i = 0; i < walls.length; i++) {
    var w = walls[i];
    if (s.x > w[0] - 4 && s.x < w[0] + w[2] + 4 && s.y > w[1] - 4 && s.y < w[1] + w[3] + 4) return { hit: 'wall' };
  }
  for (i = 0; i < tanks.length; i++) {
    var v = tanks[i];
    if (!v || !v.alive || v.id === owner) continue;
    if (skipIds && skipIds.indexOf(v.id) >= 0) continue;   /* 客户端预测时排除自己 */
    if (Math.hypot(v.x - s.x, v.y - s.y) < 26) return { hit: 'tank', tank: v };
  }
  return null;
}

function newShell(t) {
  return {
    x: t.x + Math.cos(t.a) * 30,
    y: t.y + Math.sin(t.a) * 30,
    vx: Math.cos(t.a) * SHELL_SPD,
    vy: Math.sin(t.a) * SHELL_SPD,
    owner: t.id, life: 2.4
  };
}


/* 数值真值源在共享块的 TK_C 里，这边只是起别名，改数值请改 TK_C */
var W = TK_C.w, H = TK_C.h;
var SPD = TK_C.spd;
var TURN = TK_C.turn;         /* 弧度/秒 */
var FIRE_CD = 0.62;
var SHELL_SPD = TK_C.shellSpd;
var HP = 100;
var DMG = 25;
var SCORE_TO_WIN = 5;

var COLORS = ['#ffd166', '#7ec8ff', '#8ff0b5', '#ff9f9f'];

/* 地图：[实心掩体], [砖墙] —— 砖墙有 hp 2，两发打碎 */
var MAPS = [
  {
    id: 'cross', name: '十字掩体',
    walls: [[420, 120, 160, 36], [420, 504, 160, 36], [300, 300, 36, 180], [664, 300, 36, 180], [470, 300, 60, 60]],
    bricks: [[120, 300, 120, 34], [760, 300, 120, 34], [470, 60, 60, 90], [470, 510, 60, 90]]
  },
  {
    id: 'twin', name: '双塔对峙',
    walls: [[210, 210, 110, 110], [680, 210, 110, 110], [210, 340, 110, 110], [680, 340, 110, 110]],
    bricks: [[470, 150, 60, 120], [470, 390, 60, 120], [0, 310, 120, 40], [880, 310, 120, 40]]
  },
  {
    id: 'alley', name: '巷战走廊',
    walls: [[300, 60, 36, 200], [300, 400, 36, 200], [664, 60, 36, 200], [664, 400, 36, 200]],
    bricks: [[420, 300, 160, 30], [420, 330, 30, 60], [550, 330, 30, 60], [120, 120, 90, 32], [790, 508, 90, 32]]
  }
];

var PICKS = [
  { id: 'speed', name: '加速', glyph: '≫', color: '#7ec8ff' },
  { id: 'shield', name: '护盾', glyph: '◈', color: '#8ff0b5' },
  { id: 'rapid', name: '连发', glyph: '⁙', color: '#ffd166' }
];

var PK_MAX = 2;
var PK_RESPAWN = 11;

// #shared-end

function cloneRects(list) {
  return list.map(function (w) { return [w[0], w[1], w[2], w[3]]; });
}

exports.meta = { name: '坦克大战', min: 2, max: 4, colors: COLORS, w: W, h: H, maps: MAPS.map(function (m) { return m.name; }) };

exports.create = function (ctx) {
  var rand = ctx.random;
  var map = MAPS[Math.floor(rand() * MAPS.length) % MAPS.length];
  var walls = cloneRects(map.walls);
  var bricks = map.bricks.map(function (b) { return [b[0], b[1], b[2], b[3], 2]; });
  var tanks = [];
  var shells = [];
  var picks = [];
  var events = [];
  var over = null;
  var t0 = Date.now();
  var wallSent = false;
  var brickDirty = true;
  var brickVer = 0;
  var shellSeq = 1;

  var spots = [[60, 60, 0], [W - 60, H - 60, Math.PI], [W - 60, 60, Math.PI / 2], [60, H - 60, -Math.PI / 2]];

  ctx.players.forEach(function (p, i) {
    var s = spots[i % 4];
    tanks.push({
      id: p.id, name: p.name, seat: p.seat,
      x: s[0], y: s[1], a: s[2],
      hp: HP, cd: 0, alive: true,
      thr: 0, turn: 0, fire: false,
      score: 0, hits: 0, kills: 0, respawn: 0,
      fastT: 0, shieldT: 0, rapidT: 0, got: 0
    });
  });

  function tank(id) {
    for (var i = 0; i < tanks.length; i++) if (tanks[i].id === id) return tanks[i];
    return null;
  }
  function hitWall(x, y) {
    var i, w;
    for (i = 0; i < walls.length; i++) {
      w = walls[i];
      if (x > w[0] - 4 && x < w[0] + w[2] + 4 && y > w[1] - 4 && y < w[1] + w[3] + 4) return true;
    }
    for (i = 0; i < bricks.length; i++) {
      w = bricks[i];
      if (x > w[0] - 4 && x < w[0] + w[2] + 4 && y > w[1] - 4 && y < w[1] + w[3] + 4) return true;
    }
    return false;
  }
  function collide(x, y, self) {
    if (x < 24 || y < 24 || x > W - 24 || y > H - 24) return true;
    if (hitWall(x, y)) return true;
    for (var i = 0; i < tanks.length; i++) {
      var t = tanks[i];
      if (t === self || !t.alive) continue;
      if (Math.hypot(t.x - x, t.y - y) < 42) return true;
    }
    return false;
  }
  function fire(t) {
    if (!t.alive) return;
    var cd = t.rapidT > 0 ? 0.28 : FIRE_CD;
    if (t.cd > 0) return;
    t.cd = cd;
    var sh = newShell(t);
    sh.sid = shellSeq++;
    shells.push(sh);
    events.push({ e: 'fire', x: Math.round(t.x), y: Math.round(t.y), a: Math.round(t.a * 100) / 100, by: t.id });
  }
  function spawnPick() {
    for (var k = 0; k < 30; k++) {
      var x = 90 + rand() * (W - 180);
      var y = 90 + rand() * (H - 180);
      if (hitWall(x, y)) continue;
      var bad = false;
      for (var i = 0; i < picks.length; i++) if (Math.hypot(picks[i].x - x, picks[i].y - y) < 180) bad = true;
      for (var j = 0; j < tanks.length && !bad; j++) if (Math.hypot(tanks[j].x - x, tanks[j].y - y) < 100) bad = true;
      if (bad) continue;
      picks.push({ x: x, y: y, k: Math.floor(rand() * PICKS.length) });
      return;
    }
  }
  for (var s0 = 0; s0 < PK_MAX; s0++) spawnPick();

  function finish(reason) {
    var rank = tanks.slice().sort(function (a, b) { return (b.score - a.score) || (b.hits - a.hits); });
    over = {
      game: 'tank', winner: rank[0] ? rank[0].id : null, reason: reason || 'score',
      scores: rank.map(function (b, i) {
        return { id: b.id, name: b.name, score: b.score, hits: b.hits, kills: b.kills, rank: i + 1 };
      })
    };
  }

  var api = {
    onInput: function (p, d) {
      var t = tank(p.id);
      if (!t || !d) return;
      if (typeof d.thr === 'number') t.thr = Math.max(-1, Math.min(1, d.thr));
      if (typeof d.turn === 'number') t.turn = Math.max(-1, Math.min(1, d.turn));
      if (d.fire) fire(t);
    },
    onAction: function (p, d) {
      var t = tank(p.id);
      if (t && d && d.a === 'fire') fire(t);
    },
    step: function (dt, tick) {
      var i, t;
      for (i = 0; i < tanks.length; i++) {
        t = tanks[i];
        if (t.cd > 0) t.cd -= dt;
        if (t.fastT > 0) t.fastT -= dt;
        if (t.shieldT > 0) t.shieldT -= dt;
        if (t.rapidT > 0) t.rapidT -= dt;
        if (!t.alive) continue;
        stepTank(t, { thr: t.thr, turn: t.turn, sp: t.fastT > 0 ? 1.45 : 1 }, walls, bricks, tanks, t.id);
        /* 捡补给 */
        for (var q = picks.length - 1; q >= 0; q--) {
          if (Math.hypot(picks[q].x - t.x, picks[q].y - t.y) < 30) {
            if (picks[q].k === 0) t.fastT = 9;
            else if (picks[q].k === 1) t.shieldT = 9;
            else t.rapidT = 9;
            t.got += 1;
            events.push({ e: 'pick', id: t.id, k: picks[q].k, x: Math.round(picks[q].x), y: Math.round(picks[q].y) });
            picks.splice(q, 1);
          }
        }
      }
      if (picks.length < PK_MAX) {
        api._pkT = (api._pkT || 0) + dt;
        if (api._pkT > PK_RESPAWN) { api._pkT = 0; spawnPick(); }
      }
      /* 炮弹推进 + 命中：位移与碰撞判定走共享 stepShell，伤害结算只在这里做 */
      for (i = shells.length - 1; i >= 0; i--) {
        var s = shells[i];
        var r = stepShell(s, walls, bricks, tanks, s.owner);
        if (!r) continue;
        if (r.hit === 'brick') {
          var bw = bricks[r.brick];
          if (bw) {
            bw[4] -= 1;
            if (bw[4] <= 0) {
              bricks.splice(r.brick, 1);
              events.push({ e: 'brick', x: Math.round(bw[0] + bw[2] / 2), y: Math.round(bw[1] + bw[3] / 2) });
            }
            brickDirty = true;
          }
        } else if (r.hit === 'tank') {
          var v = r.tank;
          var shooter = tank(s.owner);
          var take = v.shieldT > 0 ? 0.3 : 1;
          v.hp -= DMG * take;
          if (shooter) { shooter.hits += 1; shooter.score += 1; }
          events.push({ e: 'hit', x: Math.round(s.x), y: Math.round(s.y), by: s.owner, on: v.id });
          if (v.hp <= 0) {
            v.alive = false; v.hp = 0; v.respawn = 2.2;
            if (shooter) { shooter.kills += 1; shooter.score += 3; }
            events.push({ e: 'kill', id: v.id, by: s.owner, x: Math.round(v.x), y: Math.round(v.y) });
          }
        }
        events.push({ e: 'pop', x: Math.round(s.x), y: Math.round(s.y), sid: s.sid });
        shells.splice(i, 1);
      }
      /* 复活（保证局面不会只剩一个人干等） */
      for (i = 0; i < tanks.length; i++) {
        t = tanks[i];
        if (!t.alive && t.respawn > 0) {
          t.respawn -= dt;
          if (t.respawn <= 0) {
            var alive = tanks.filter(function (x) { return x.alive; });
            if (alive.length >= 2) { t.alive = true; t.hp = HP; }
            else t.respawn = 0;
          }
        }
      }
      if (tanks.some(function (x) { return x.score >= SCORE_TO_WIN; })) { finish('score'); return; }
      if ((Date.now() - t0) / 1000 > 180) finish('timeout');
    },
    snapshot: function (tick) {
      var out = {
        t: tick,
        k: tanks.map(function (x) {
          return [
            x.id, Math.round(x.x * 10) / 10, Math.round(x.y * 10) / 10, Math.round(x.a * 100) / 100,
            Math.round(x.hp), x.alive ? 1 : 0, x.score,
            x.fastT > 0 ? 1 : 0, x.shieldT > 0 ? 1 : 0, x.rapidT > 0 ? 1 : 0,
            x.cd > 0 ? 1 : 0                                   /* 10: 炮管还在冷却 */
          ];
        }),
        /* 炮弹带 id（自增）与主人，客户端据此做「自己的炮弹本地预测」 */
        s: shells.map(function (x) { return [x.sid, x.owner, Math.round(x.x), Math.round(x.y), Math.round(x.vx), Math.round(x.vy)]; })
      };
      if (!wallSent) { out.wl = walls; out.mn = map.id; wallSent = true; }
      if (brickDirty) { out.br = bricks; brickDirty = false; brickVer += 1; }
      if (picks.length) out.pu = picks.map(function (p) { return [Math.round(p.x), Math.round(p.y), p.k]; });
      if (events.length) { out.ev = events.slice(0, 16); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      var t = tank(p.id);
      if (t) t.alive = false;
    }
  };
  return api;
};

exports.SCORE_TO_WIN = SCORE_TO_WIN;
exports.stepTank = stepTank;
exports.stepShell = stepShell;
exports.newShell = newShell;
exports.tankBlocked = tankBlocked;
exports.DATA = { w: W, h: H, spd: SPD, turn: TURN, fireCd: FIRE_CD, shellSpd: SHELL_SPD, hp: HP };
exports.DT = 1 / 60;
