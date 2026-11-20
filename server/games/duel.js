/* ============================================================
 * server/games/duel.js —— 弹弹岛对战（服务端权威 · 回合制抛物线对轰）
 * ------------------------------------------------------------
 * 2–4 人按座位分左右两岸，轮流调角度/力度开炮；炮弹受重力与风影响，
 * 撞人扣血、撞岛/气球爆炸、落海出局，最后站着的人赢。
 * 和单机弹弹岛同一套手感：重力 860、初速 1060、风横向加速。
 *
 * 服务端算一切（弹道 / 命中 / 回合 / 风），客户端只画快照。
 * 回合限时 22 秒，超时按当前角度力度自动开火，避免挂机卡局。
 * ============================================================ */
'use strict';

var DEF = {
  W: 1200, H: 675, SEA: 520,
  GRAV: 860, SPD: 1060, DT: 1 / 120,
  TURN_SEC: 22, HP: 100, DMG: 34, R: 30,
  AIM_MIN: 8, AIM_MAX: 88
};

/* 静态岛：[中心x, 顶面y, 半宽]。左岸 seat 偶数用 0 号岛，右岸 seat 奇数用最后一个岛 */
var MAPS = [
  { name: '双岸', isles: [[180, 430, 150], [1020, 430, 150]], wind: 26,
    balloons: [[600, 250, 26, 120, 0.9]] },
  { name: '三礁', isles: [[170, 450, 140], [600, 360, 84], [1030, 440, 150]], wind: 40,
    balloons: [[430, 240, 24, 100, 1.1], [800, 300, 24, 110, 0.8]] },
  { name: '强风岬', isles: [[170, 460, 138], [1030, 400, 150]], wind: 66,
    balloons: [[600, 280, 28, 160, 1.25]] }
];

var COLORS = ['#ff7a7a', '#7ec8ff', '#8ff0b5', '#ffd166'];

exports.meta = {
  name: '弹弹岛对战', min: 2, max: 4, colors: COLORS,
  w: DEF.W, h: DEF.H, maps: MAPS.map(function (m) { return m.name; })
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function solidAt(isles, x, y) {
  for (var i = 0; i < isles.length; i++) {
    var s = isles[i];
    /* 岛是一个从顶面一直到海底的梯形台，顶部中间高两边低一点（做成圆润的丘） */
    if (x < s[0] - s[2] || x > s[0] + s[2] || y < s[1]) continue;
    var edge = Math.abs(x - s[0]) / s[2];
    var top = s[1] + Math.round(edge * edge * 16);
    if (y >= top) return true;
  }
  return false;
}
function topAt(isles, x) {
  var best = DEF.H + 10;
  for (var i = 0; i < isles.length; i++) {
    var s = isles[i];
    if (x < s[0] - s[2] || x > s[0] + s[2]) continue;
    var edge = Math.abs(x - s[0]) / s[2];
    var top = s[1] + Math.round(edge * edge * 16);
    if (top < best) best = top;
  }
  return best;
}

exports.create = function (ctx) {
  var rand = ctx.random;
  var map = MAPS[Math.floor(rand() * MAPS.length) % MAPS.length];
  var isles = map.isles;
  var balloons = map.balloons.map(function (b) {
    return { bx: b[0], x: b[0], y: b[1], r: b[2], amp: b[3], spd: b[4], ph: rand() * 6.28 };
  });

  var units = [];
  ctx.players.forEach(function (p, i) {
    var left = (p.seat % 2) === 0;
    var home = left ? isles[0] : isles[isles.length - 1];
    var spread = home[2] * 0.5;
    var x = home[0] + (i > 1 ? (rand() * 2 - 1) * spread : 0);
    units.push({
      id: p.id, name: p.name, seat: p.seat,
      x: x, y: topAt(isles, x) - 20, dir: left ? 1 : -1,
      hp: DEF.HP, alive: true,
      angle: 50, power: 0.78, lo: home[0] - home[2] + 20, hi: home[0] + home[2] - 20,
      respawn: 0, moved: false
    });
  });

  var shells = [];
  var events = [];
  var over = null;
  var turnIdx = 0, turnLeft = 0, phase = 'aim', flyT = 0, seq = 1;
  var order = units.slice().sort(function (a, b) { return a.seat - b.seat; }).map(function (u) { return u.id; });
  var startMs = Date.now();
  var mapSent = false;

  function unit(id) { for (var i = 0; i < units.length; i++) if (units[i].id === id) return units[i]; return null; }
  function aliveUnits() { return units.filter(function (u) { return u.alive; }); }
  /* 按固定座次轮转，跳过已出局的人 */
  function cur() {
    for (var i = 0; i < order.length; i++) {
      var u = unit(order[(turnIdx + i) % order.length]);
      if (u && u.alive) return u;
    }
    return null;
  }
  function nextTurn() {
    var n = order.length;
    for (var i = 1; i <= n; i++) {
      var u = unit(order[(turnIdx + i) % n]);
      if (u && u.alive) { turnIdx = (turnIdx + i) % n; return; }
    }
  }

  function finish(reason) {
    var alive = aliveUnits();
    var rank = units.slice().sort(function (a, b) {
      return (b.alive - a.alive) || (b.hp - a.hp);
    });
    over = {
      game: 'duel', winner: alive.length === 1 ? alive[0].id : null, reason: reason,
      scores: rank.map(function (u, i) {
        return { id: u.id, name: u.name, score: u.alive ? 1 : 0, rank: i + 1 };
      })
    };
  }

  function launch(u) {
    if (!u || !u.alive || phase !== 'aim') return;
    var a = u.angle * Math.PI / 180;
    var sp = DEF.SPD * u.power;
    var bx = u.x + u.dir * Math.cos(a) * 34;
    var by = u.y - Math.sin(a) * 34;
    shells.push({
      id: seq++, owner: u.id,
      x: bx, y: by, vx: u.dir * Math.cos(a) * sp, vy: -Math.sin(a) * sp,
      life: 6
    });
    events.push({ e: 'fire', id: u.id });
    phase = 'fly'; flyT = 0;
  }

  function explode(s) {
    events.push({ e: 'boom', x: Math.round(s.x), y: Math.round(s.y), r: DEF.R });
    var i;
    for (i = 0; i < units.length; i++) {
      var u = units[i];
      if (!u.alive) continue;
      var d = Math.hypot(u.x - s.x, u.y - s.y);
      if (d < DEF.R + 24) {
        u.hp -= Math.round(DEF.DMG * (1 - 0.45 * d / (DEF.R + 24)));
        events.push({ e: 'hit', id: u.id, x: Math.round(u.x) });
        if (u.hp <= 0) {
          u.hp = 0; u.alive = false;
          events.push({ e: 'out', id: u.id, x: Math.round(u.x), y: Math.round(u.y) });
        }
      }
    }
  }

  var api = {
    onInput: function (p, d) {
      var u = unit(p.id);
      if (!u || !u.alive || phase !== 'aim' || cur() !== u) return;
      if (typeof d.angle === 'number') u.angle = clamp(d.angle, DEF.AIM_MIN, DEF.AIM_MAX);
      if (typeof d.power === 'number') u.power = clamp(d.power, 0.2, 1);
      if (typeof d.move === 'number' && d.move) {
        var nx = clamp(u.x + Math.sign(d.move) * 6, u.lo, u.hi);
        if (topAt(isles, nx) < DEF.H) { u.x = nx; u.y = topAt(isles, nx) - 20; u.moved = true; }
      }
    },
    onAction: function (p, d) {
      var u = unit(p.id);
      if (!u || !d) return;
      if (d.a === 'fire' && phase === 'aim' && cur() === u) launch(u);
    },
    step: function (dt, tick) {
      var i, k;
      /* 气球巡逻 */
      for (i = 0; i < balloons.length; i++) {
        var b = balloons[i];
        b.x = b.bx + Math.sin(tick * DEF.DT * b.spd + b.ph) * b.amp;
      }
      /* 掉海检测（脚下没地就往下掉） */
      for (i = 0; i < units.length; i++) {
        var u = units[i];
        if (!u.alive) continue;
        if (!solidAt(isles, u.x, u.y + 21)) {
          u.y += 220 * dt;
          if (u.y > DEF.SEA + 20) {
            u.alive = false; u.hp = 0;
            events.push({ e: 'out', id: u.id, x: Math.round(u.x), y: Math.round(u.y) });
          }
        }
      }
      /* 炮弹积分（固定步长，客户端可用同一常量预测轨迹） */
      if (phase === 'fly') {
        var steps = Math.min(12, Math.max(1, Math.round(dt / DEF.DT)));
        for (k = shells.length - 1; k >= 0; k--) {
          var s = shells[k];
          var gone = false;
          for (var q = 0; q < steps && !gone; q++) {
            s.vx += map.wind * DEF.DT;       /* 风：地图固定横风，正=吹向右 */
            s.vy += DEF.GRAV * DEF.DT;
            s.x += s.vx * DEF.DT;
            s.y += s.vy * DEF.DT;
            s.life -= DEF.DT;
            /* 出界：直接消失，不炸 */
            if (s.y > DEF.H + 30 || s.x < -60 || s.x > DEF.W + 60 || s.life <= 0) { gone = true; break; }
            /* 撞地形：炸 */
            if (solidAt(isles, s.x, s.y)) { explode(s); gone = true; break; }
            /* 撞气球：炸 */
            var onB = false;
            for (var bi = 0; bi < balloons.length; bi++) {
              if (Math.hypot(s.x - balloons[bi].x, s.y - balloons[bi].y) < balloons[bi].r + 6) { onB = true; break; }
            }
            if (onB) { explode(s); gone = true; break; }
            /* 撞人（不含发射者）：炸 */
            var onU = false;
            for (var ui = 0; ui < units.length; ui++) {
              var t = units[ui];
              if (t.alive && t.id !== s.owner && Math.hypot(t.x - s.x, t.y - s.y) < 24) { onU = true; break; }
            }
            if (onU) { explode(s); gone = true; break; }
          }
          if (gone) shells.splice(k, 1);
        }
        if (shells.length === 0) {
          flyT += dt;
          if (flyT > 0.5) {
            if (aliveUnits().length <= 1) { finish('last'); return; }
            nextTurn();
            phase = 'aim';
            turnLeft = DEF.TURN_SEC;
          }
        }
      } else if (phase === 'aim') {
        turnLeft -= dt;
        var actor = cur();
        if (actor && actor.alive && turnLeft <= 0) { launch(actor); }
      }
      if (Date.now() - startMs > 240000) finish('timeout');
    },
    snapshot: function (tick) {
      var out = {
        t: tick,
        ph: phase, tl: Math.max(0, Math.ceil(turnLeft)),
        act: cur() ? cur().id : null,
        w: map.wind,
        p: units.map(function (u) {
          return [u.id, Math.round(u.x), Math.round(u.y), Math.round(u.hp), u.alive ? 1 : 0,
                  u.dir, Math.round(u.angle), Math.round(u.power * 100)];
        }),
        s: shells.map(function (s) {
          return [s.id, s.owner, Math.round(s.x), Math.round(s.y), Math.round(s.vx), Math.round(s.vy)];
        }),
        bl: balloons.map(function (b) { return [Math.round(b.x), Math.round(b.y), b.r]; })
      };
      if (!mapSent) { out.is = isles; out.mn = map.name; mapSent = true; }
      if (events.length) { out.ev = events.slice(0, 16); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      var u = unit(p.id);
      if (u) { u.alive = false; u.hp = 0; }
    }
  };
  turnLeft = DEF.TURN_SEC;
  return api;
};

exports.DEF = DEF;
