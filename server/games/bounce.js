/* ============================================================
 * server/games/bounce.js —— 咱俩碰碰（服务端权威）
 * ------------------------------------------------------------
 * 玩法：俯视竞技场，每人一辆碰碰车，WASD/摇杆推着走，撞对方造成击退 + 掉血；
 *       撞墙会反弹，血空了就被淘汰，最后活着的人赢。
 *
 * 1.20 起加厚三层：
 *   · 3 张随局切换的场地（古典竞技场 / 四柱回廊 / 双门窄道），带圆形与矩形障碍，
 *     车撞障碍会滑开并反弹（不是穿模，也不是硬停）；
 *   · 场上常驻 3 个道具点：治疗 / 加速 / 护盾 / 重击，吃到就有明确数值变化；
 *   · 冲刺（空格）：一段短促加速，冲刺中撞人伤害 ×1.6，3.2 秒冷却。
 *
 * 为什么服务端算：碰撞与击退是「同时发生」的，客户端各自算必然不一致。
 * 快照只发紧凑数组，30Hz 下 4 人约 500B/帧。
 * ============================================================ */
'use strict';

var DMG_BASE = 40;            /* 基础撞击伤害（越大撞得越狠） */
var DMG_MIN = 5;              /* 撞击伤害下限（防止轻碰毫无代价） */
var MAX_HP = 100;
var ROUND_TIME = 180;         /* 单局上限秒数，超时按血量排名 */

var DASH_CD = 3.2;            /* 冲刺冷却 */
var DASH_IMP = 640;           /* 冲刺给的速度增量 */
var DASH_T = 0.35;            /* 冲刺状态时长（此期间撞人更狠） */

var PICK_MAX = 3;             /* 场上道具上限 */
var PICK_RESPAWN = 3.2;       /* 被吃掉后多久补一个 */
var PICK_R = 17;

var COLORS = ['#ff7a7a', '#7ec8ff', '#8ff0b5', '#ffd166'];

/* 道具类型（下标即网络序号，客户端按同一张表画） */
var PICKS = [
  { id: 'heal', name: '治疗', glyph: '+', color: '#8ff0b5' },
  { id: 'speed', name: '加速', glyph: '≫', color: '#7ec8ff' },
  { id: 'shield', name: '护盾', glyph: '◈', color: '#ffd166' },
  { id: 'power', name: '重击', glyph: '✦', color: '#ff7a7a' }
];

/* 场地：obs 里 c = 圆（x,y,r），r 是矩形（x,y,w,h） */
var MAPS = [
  {
    id: 'arena', name: '古典竞技场',
    obs: [
      { t: 'c', x: 500, y: 320, r: 44 },
      { t: 'c', x: 300, y: 160, r: 34 },
      { t: 'c', x: 700, y: 480, r: 34 }
    ]
  },
  {
    id: 'pillars', name: '四柱回廊',
    obs: [
      { t: 'c', x: 330, y: 210, r: 54 },
      { t: 'c', x: 670, y: 210, r: 54 },
      { t: 'c', x: 330, y: 430, r: 54 },
      { t: 'c', x: 670, y: 430, r: 54 }
    ]
  },
  {
    id: 'gates', name: '双门窄道',
    obs: [
      { t: 'r', x: 0, y: 226, w: 250, h: 38 },
      { t: 'r', x: 750, y: 376, w: 250, h: 38 },
      { t: 'c', x: 500, y: 320, r: 40 }
    ]
  }
];

function pickMap(rand) {
  return MAPS[Math.floor(rand() * MAPS.length) % MAPS.length];
}

// #shared-begin bounce-physics
var W = 1000, H = 640;        /* 逻辑场地尺寸，客户端等比缩放 */
var R = 26;                   /* 车半径 */
var ACC = 1500;               /* 加速度 px/s² */
var FRICTION = 2.4;           /* 摩擦系数（每秒衰减） */
var BOUNCE = 0.92;            /* 撞墙反弹系数 */
var MAX_SPEED = 700;
/* 打包给共享块用的常量表：共享块里不直接读上面的 var，
   避免生成到浏览器后作用域对不上 */
var SH_C = { w: W, h: H, R: R, ACC: ACC, FRICTION: FRICTION, BOUNCE: BOUNCE, MAX_SPEED: MAX_SPEED };

/* ============================================================
 * 共享物理（服务端权威 + 客户端预测）
 * ------------------------------------------------------------
 * createBody / stepBody 会被三处使用：
 *   · 本文件的服务端 step()；
 *   · 客户端 js/party/games.js（本地预测与重放）；
 *   · tools/predict-sim.mjs（离线仿真）。
 * 所以这里只允许「纯函数 + 常量引用」，不许读时间、不许用随机数、
 * 不许碰其它实体——一旦掺进别的，两边算出来的位置就会慢慢分叉。
 * 撞到障碍/墙时只做位置反弹，不产生伤害（伤害仍然只在服务端算）。
 * ============================================================ */
function createBody(x, y) {
  return { x: x, y: y, vx: 0, vy: 0, ox: 0, oy: 0, dashT: 0 };
}

function stepBody(b, inp, obsList) {
  var dt = 1 / 60;
  var ACC = SH_C.ACC, FRICTION = SH_C.FRICTION, MAX_SPEED = SH_C.MAX_SPEED, R = SH_C.R, BOUNCE = SH_C.BOUNCE, W = SH_C.w, H = SH_C.h;
  var ix = inp && inp.x || 0, iy = inp && inp.y || 0;
  var m = Math.hypot(ix, iy);
  if (m > 1) { ix /= m; iy /= m; }      /* 斜向不加速（摇杆可能给出 >1 的模） */
  b.ox = ix; b.oy = iy;
  var spd = (inp && inp.sp) || 1;       /* 加速道具：服务端折算成倍率下发，客户端不用知道道具含义 */
  var boost = spd;
  var cap = MAX_SPEED * boost;
  b.vx += b.ox * ACC * boost * dt;
  b.vy += b.oy * ACC * boost * dt;
  var damp = Math.max(0, 1 - FRICTION * dt);
  b.vx *= damp; b.vy *= damp;
  var sp = Math.hypot(b.vx, b.vy);
  if (sp > cap) { b.vx = b.vx / sp * cap; b.vy = b.vy / sp * cap; }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * BOUNCE; }
  if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx) * BOUNCE; }
  if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy) * BOUNCE; }
  if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy) * BOUNCE; }
  var o = obsList || (inp && inp.obs) || defObs;   /* 客户端把地形塞进输入里复用 */
  if (o) solidBody(b, o);
  return b;
}

/* 地形碰撞：圆 / 矩形，推出并沿法线反弹（与服务端 step 中的 solid 同源） */
function solidBody(b, obs) {
  var R = SH_C.R, BOUNCE = SH_C.BOUNCE, W = SH_C.w, H = SH_C.h;
  for (var i = 0; i < obs.length; i++) {
    var o = obs[i];
    if (o.t === 'c') {
      var dx = b.x - o.x, dy = b.y - o.y;
      var d = Math.hypot(dx, dy) || 0.001;
      var min = o.r + R;
      if (d >= min) continue;
      var nx = dx / d, ny = dy / d;
      b.x = o.x + nx * min;
      b.y = o.y + ny * min;
      var vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= (1 + BOUNCE) * vn * nx; b.vy -= (1 + BOUNCE) * vn * ny; }
    } else {
      var cx = Math.max(o.x, Math.min(b.x, o.x + o.w));
      var cy = Math.max(o.y, Math.min(b.y, o.y + o.h));
      var ex = b.x - cx, ey = b.y - cy;
      var ed = Math.hypot(ex, ey);
      if (ed >= R) continue;
      var mx, my;
      if (ed < 0.001) {
        var l = b.x - o.x, rr = o.x + o.w - b.x, tp = b.y - o.y, bt = o.y + o.h - b.y;
        var mm = Math.min(l, rr, tp, bt);
        mx = mm === l ? -1 : mm === rr ? 1 : 0;
        my = mm === tp ? -1 : mm === bt ? 1 : 0;
        b.x = cx + mx * R; b.y = cy + my * R;
      } else {
        mx = ex / ed; my = ey / ed;
        b.x = cx + mx * R;
        b.y = cy + my * R;
      }
      var vn2 = b.vx * mx + b.vy * my;
      if (vn2 < 0) { b.vx -= (1 + BOUNCE) * vn2 * mx; b.vy -= (1 + BOUNCE) * vn2 * my; }
    }
  }
}

/* 地图由外部传入（客户端把快照里下的地形塞进输入 obs），这里只做兜底 */
var defObs = null;

/* 把点从障碍里推出去（出生点 / 道具点用） */
function freeSpot(x, y, obs, pad) {
  for (var k = 0; k < 12; k++) {
    var moved = false;
    for (var i = 0; i < obs.length; i++) {
      var o = obs[i];
      if (o.t === 'c') {
        var dx = x - o.x, dy = y - o.y;
        var d = Math.hypot(dx, dy) || 0.001;
        var min = o.r + pad;
        if (d < min) { x = o.x + dx / d * min; y = o.y + dy / d * min; moved = true; }
      } else {
        var cx = Math.max(o.x, Math.min(x, o.x + o.w));
        var cy = Math.max(o.y, Math.min(y, o.y + o.h));
        var ddx = x - cx, ddy = y - cy;
        var dd = Math.hypot(ddx, ddy) || 0.001;
        if (dd < pad) {
          if (dd < 1) { x = cx + pad; y = cy; }
          else { x = cx + ddx / dd * pad; y = cy + ddy / dd * pad; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return [
    Math.max(R + 6, Math.min(W - R - 6, x)),
    Math.max(R + 6, Math.min(H - R - 6, y))
  ];
}

// #shared-end

exports.meta = { name: '咱俩碰碰', min: 2, max: 4, colors: COLORS, maps: MAPS.map(function (m) { return m.name; }) };

exports.create = function (ctx) {
  var rand = ctx.random;
  var map = pickMap(rand);
  var obs = map.obs;
  var bodies = [];
  var picks = [];
  var events = [];
  var over = null;
  var t0 = Date.now();
  var n = ctx.players.length;

  ctx.players.forEach(function (p, i) {
    /* 均匀撒在半径 210 的圆上，再推到障碍外，避免开局卡在柱子里 */
    var a = (Math.PI * 2 * i) / n + rand() * 0.3;
    var pos = freeSpot(W / 2 + Math.cos(a) * 240, H / 2 + Math.sin(a) * 190, obs, R + 6);
    bodies.push({
      id: p.id, seat: p.seat, name: p.name,
      x: pos[0], y: pos[1],
      vx: 0, vy: 0,
      hp: MAX_HP,
      alive: true,
      ox: 0, oy: 0,          /* 输入方向 */
      cd: 0,                 /* 撞击冷却：防止一次接触连打 */
      lastHit: 0,            /* 最近被谁撞 */
      kills: 0,
      dashCd: 0, dashT: 0,
      shieldT: 0, speedT: 0, powT: 0,
      got: 0                 /* 吃到几个道具，用于赛后统计 */
    });
  });

  function spawnPick() {
    for (var t = 0; t < 24; t++) {
      var x = 90 + rand() * (W - 180);
      var y = 80 + rand() * (H - 160);
      var spot = freeSpot(x, y, obs, PICK_R + 10);
      var bad = false;
      for (var i = 0; i < picks.length; i++) {
        if (Math.hypot(picks[i].x - spot[0], picks[i].y - spot[1]) < 130) { bad = true; break; }
      }
      if (bad) continue;
      for (var j = 0; j < bodies.length && !bad; j++) {
        if (Math.hypot(bodies[j].x - spot[0], bodies[j].y - spot[1]) < 120) bad = true;
      }
      if (bad) continue;
      picks.push({ x: spot[0], y: spot[1], k: Math.floor(rand() * PICKS.length), born: Date.now() });
      return;
    }
  }
  for (var pi = 0; pi < PICK_MAX; pi++) spawnPick();

  function body(id) {
    for (var i = 0; i < bodies.length; i++) if (bodies[i].id === id) return bodies[i];
    return null;
  }

  function living() {
    return bodies.filter(function (b) { return b.alive; });
  }

  function finish(reason) {
    if (over) return;
    var rank = bodies.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.hp - a.hp;
    });
    over = {
      game: 'bounce',
      winner: (rank[0] && rank[0].alive) ? rank[0].id : null,
      draw: !(rank[0] && rank[0].alive),
      scores: rank.map(function (b, i) {
        return { id: b.id, name: b.name, score: Math.max(0, Math.round(b.hp)) + b.kills * 20, rank: i + 1, hp: Math.max(0, Math.round(b.hp)), kills: b.kills };
      }),
      reason: reason || 'knockout'
    };
  }

  /* 地形碰撞直接用共享实现，保证客户端预测算的一样 */
  function solid(b) { solidBody(b, obs); }

  function givePick(b, p) {
    b.got += 1;
    if (p.k === 0) {
      b.hp = Math.min(MAX_HP, b.hp + 34);
    } else if (p.k === 1) {
      b.speedT = 7;
    } else if (p.k === 2) {
      b.shieldT = 7;
    } else {
      b.powT = 8;
    }
    events.push({ e: 'pick', id: b.id, k: p.k, x: Math.round(p.x), y: Math.round(p.y) });
  }

  var api = {
    /* 输入：{x, y} 归一化方向 */
    onInput: function (p, d) {
      var b = body(p.id);
      if (!b || !b.alive) return;
      if (d && typeof d.x === 'number') {
        var m = Math.hypot(d.x, d.y) || 1;
        b.ox = d.x / m; b.oy = d.y / m;
      }
    },
    onAction: function (p, d) {
      var b = body(p.id);
      if (!b || !b.alive || !d) return;
      if (d.a === 'dash' && b.dashCd <= 0) {
        /* 有输入就朝输入方向冲，没输入就朝当前速度方向 */
        var ax = b.ox, ay = b.oy;
        if (!ax && !ay) {
          var sp = Math.hypot(b.vx, b.vy);
          if (sp > 30) { ax = b.vx / sp; ay = b.vy / sp; }
          else { ax = 0; ay = -1; }
        }
        b.vx += ax * DASH_IMP;
        b.vy += ay * DASH_IMP;
        b.dashCd = DASH_CD;
        b.dashT = DASH_T;
        events.push({ e: 'dash', id: b.id, x: Math.round(b.x), y: Math.round(b.y), a: Math.atan2(ay, ax) });
      }
    },
    step: function (dt, tick) {
      var i, j, b;
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (b.dashCd > 0) b.dashCd -= dt;
        if (b.dashT > 0) b.dashT -= dt;
        if (b.shieldT > 0) b.shieldT -= dt;
        if (b.speedT > 0) b.speedT -= dt;
        if (b.powT > 0) b.powT -= dt;
        if (!b.alive) continue;
        /* 车体位移走共享公式：把「加速道具倍率」和地形一起传进去，
           其余（加速度、摩擦、限速、挡墙）与客户端逐字一致 */
        stepBody(b, { x: b.ox, y: b.oy, sp: b.speedT > 0 ? 1.35 : 1 }, obs);
        if (b.cd > 0) b.cd -= dt;
      }
      /* 车与车：弹性分离 + 伤害 */
      for (i = 0; i < bodies.length; i++) {
        for (j = i + 1; j < bodies.length; j++) {
          var a = bodies[i], c = bodies[j];
          if (!a.alive || !c.alive) continue;
          var dx = c.x - a.x, dy = c.y - a.y;
          var d = Math.hypot(dx, dy) || 0.001;
          var min = R * 2;
          if (d >= min) continue;
          var nx = dx / d, ny = dy / d;
          var overlap = min - d;
          a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
          c.x += nx * overlap / 2; c.y += ny * overlap / 2;
          var rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          var imp = Math.abs(rel);
          var p2 = (a.vx * nx + a.vy * ny) - (c.vx * nx + c.vy * ny);
          a.vx -= p2 * nx * 0.9; a.vy -= p2 * ny * 0.9;
          c.vx += p2 * nx * 0.9; c.vy += p2 * ny * 0.9;
          c.vx += nx * 60; c.vy += ny * 60;
          a.vx -= nx * 60; a.vy -= ny * 60;
          if (imp > 90 && a.cd <= 0 && c.cd <= 0) {
            var dmg = Math.max(DMG_MIN, Math.min(30, Math.round(imp * DMG_BASE / 900)));
            /* 谁速度更快谁占便宜：撞击方向与自己前进方向一致的一方多打一点 */
            var aAgg = (a.vx * nx + a.vy * ny) > 0 ? 1.25 : 0.85;
            var cAgg = (c.vx * -nx + c.vy * -ny) > 0 ? 1.25 : 0.85;
            /* 冲刺 ×1.6，重击道具 ×1.7，护盾把受到的伤害压到 35% */
            var aOut = (a.powT > 0 ? 1.7 : 1) * (a.dashT > 0 ? 1.6 : 1);
            var cOut = (c.powT > 0 ? 1.7 : 1) * (c.dashT > 0 ? 1.6 : 1);
            var aTake = a.shieldT > 0 ? 0.35 : 1;
            var cTake = c.shieldT > 0 ? 0.35 : 1;
            a.hp -= dmg * cAgg * cOut * aTake;
            c.hp -= dmg * aAgg * aOut * cTake;
            a.cd = 0.28; c.cd = 0.28;
            a.lastHit = c.id; c.lastHit = a.id;
            events.push({ e: 'hit', x: Math.round((a.x + c.x) / 2), y: Math.round((a.y + c.y) / 2), dmg: Math.round(dmg), by: [a.id, c.id] });
          }
        }
      }
      /* 吃道具 */
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (!b.alive) continue;
        for (j = picks.length - 1; j >= 0; j--) {
          if (Math.hypot(picks[j].x - b.x, picks[j].y - b.y) < R + PICK_R) {
            givePick(b, picks[j]);
            picks.splice(j, 1);
          }
        }
      }
      if (picks.length < PICK_MAX) {
        api._pickTimer = (api._pickTimer || 0) + dt;
        if (api._pickTimer > PICK_RESPAWN) { api._pickTimer = 0; spawnPick(); }
      }
      /* 淘汰判定 */
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (!b.alive) continue;
        if (b.hp <= 0) {
          b.hp = 0; b.alive = false;
          var killer = b.lastHit ? body(b.lastHit) : null;
          if (killer && killer.alive) killer.kills += 1;
          events.push({ e: 'out', id: b.id, by: b.lastHit || null, x: Math.round(b.x), y: Math.round(b.y) });
        }
      }
      var live = living();
      if (over) return;
      if (live.length <= 1) { finish('knockout'); return; }
      if ((Date.now() - t0) / 1000 > ROUND_TIME) finish('timeout');
    },
    snapshot: function (tick) {
      /* 快照只发「位置 + 血量 + 状态」，速度不再发：
         自己的速度由本地预测给出；别人的速度由客户端按位置差分算，
         这样 30Hz 的快照不会被速度字段带出抖动。 */
      var arr = bodies.map(function (b) {
        return [
          b.id, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.hp),
          Math.round(Math.atan2(b.vy, b.vx) * 100) / 100,   /* 4: 朝向（弧度） */
          b.alive ? 1 : 0,
          Math.round(b.dashCd * 10) / 10,
          Math.round(b.shieldT * 10) / 10,
          Math.round(b.speedT * 10) / 10,
          Math.round(b.powT * 10) / 10,
          b.dashT > 0 ? 1 : 0,
          b.speedT > 0 ? 1.35 : 1,                          /* 11: 加速倍率 */
          Math.round(b.ox * 100) / 100,                     /* 12: 输入方向，供客户端补位 */
          Math.round(b.oy * 100) / 100                      /* 13 */
        ];
      });
      var out = {
        t: tick,
        b: arr,
        pu: picks.map(function (p) { return [Math.round(p.x), Math.round(p.y), p.k]; })
      };
      /* 地形只在首帧发一次（客户端缓存），省带宽 */
      if (!api._mapSent) { out.mp = { id: map.id, name: map.name, o: obs }; api._mapSent = true; }
      if (events.length) { out.ev = events.slice(0, 12); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      var b = body(p.id);
      if (b && b.alive) { b.alive = false; b.hp = 0; events.push({ e: 'out', id: b.id, by: null, x: Math.round(b.x), y: Math.round(b.y) }); }
    }
  };
  return api;
};

exports.FIELD = { w: W, h: H, r: R, maps: MAPS, picks: PICKS, acc: ACC, fr: FRICTION, bounce: BOUNCE, maxSpd: MAX_SPEED };
exports.createBody = createBody;
exports.stepBody = stepBody;
exports.DT = 1 / 60;
