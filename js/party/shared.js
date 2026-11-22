/* ============================================================
 * js/party/shared.js —— 与服务端同源的「一帧物理」（自动生成，别手改）
 * ------------------------------------------------------------
 * 由 tools/gen-physics.mjs 从下列代码块原样抽取：
 *   bounce.js:bounce-physics (125 行)
 *   tank.js:tank-physics (122 行)
 *   pitch.js:pitch-physics (185 行)
 * 源码指纹：432c2a2284
 * 改动玩法物理后执行 node tools/gen-physics.mjs 重新生成；
 * 构建脚本会检查这里和源码是否同步（不同步直接报错）。
 * ============================================================ */
(function (global) {
  'use strict';
  var SHARED = {};

  /* ---- bounce.js :: bounce-physics ---- */
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


  /* ---- tank.js :: tank-physics ---- */
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


  /* ---- pitch.js :: pitch-physics ---- */
  /* 物理参数表。默认值 = 标准草地；冰面由服务端在开局时改写，
     客户端拿到快照里的 md.C 后覆盖同一份数值（两边必须逐字节一致）。
     注意：这张表里**不放场地宽高以外的展示数据**，w/h 也放在这里，
     保证「参数表 = 一局物理的全部输入」。 */
  var PT_C = {
    w: 1040, h: 620,           /* 场地尺寸 */
    PR: 34,                    /* 球员碰撞半径（人碰球用，比视觉大一圈，好控球） */
    R: 21,                     /* 球员视觉半径 */
    BR: 15,                    /* 球半径 */
    ACC: 1750,                 /* 球员加速度 */
    FRICTION: 2.6,             /* 球员摩擦（每秒速度衰减比例） */
    MAX_SPD: 360,              /* 球员最大速度（比球慢，才追得上带球节奏） */
    BALL_FR: 0.9,              /* 球摩擦（每秒速度衰减比例，越大越黏） */
    BALL_MAX: 1250,            /* 球最大速度 */
    KICK: 780,                 /* 射门给球的基础速度 */
    KICK_R: 70,                /* 射门判定半径：球在这个距离内就能踢（远大于人球碰撞半径） */
    KICK_CD: 0.42,             /* 射门冷却 */
    PUSH: 0.9,                 /* 顶球时给球的倍率：略小于 1，球比人慢一点点，才带得住 */
    PUSH_MIN: 24,              /* 顶球的最小初速（随机捅一脚） */
    CARRY: 170,                /* 横向切向速度的限幅（防止横着跑把球甩飞） */
    GOAL_W: 210,               /* 球门宽度（沿 y） */
    GOAL_D: 26,                /* 球门深度（从边线往里） */
    WALL: 0.82                 /* 球撞门柱/边线的反弹系数 */
  };

  /* 球场几何：门柱、禁区线都从这里算，客户端画场地也读它 */
  function pitchGeom() {
    var C = PT_C;
    var gy0 = (C.h - C.GOAL_W) / 2, gy1 = (C.h + C.GOAL_W) / 2;
    return {
      w: C.w, h: C.h,
      goalY0: gy0, goalY1: gy1, goalD: C.GOAL_D,
      boxW: 150, boxH: C.GOAL_W + 120
    };
  }

  function createBall(x, y) { return { x: x, y: y, vx: 0, vy: 0 }; }

  /* 一帧球：摩擦 + 限速 + 边界/门柱反弹 + 进球检测。
     返回 null 或 { goal: 'L' | 'R' }（进的是哪边的门）。 */
  function stepBall(b, dt, g, C) {
    C = C || PT_C;
    g = g || pitchGeom();
    dt = dt || 1 / 60;
    var damp = Math.max(0, 1 - C.BALL_FR * dt);
    b.vx *= damp; b.vy *= damp;
    var sp = Math.hypot(b.vx, b.vy);
    if (sp > C.BALL_MAX) { b.vx = b.vx / sp * C.BALL_MAX; b.vy = b.vy / sp * C.BALL_MAX; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    var w = g.w, h = g.h, R = C.BR, k = C.WALL;
    var gy0 = g.goalY0, gy1 = g.goalY1;

    /* 进球：球心进到球门深度里，且整个球在两根门柱之间 */
    if (b.x < g.goalD && b.y > gy0 && b.y < gy1) return { goal: 'L' };
    if (b.x > w - g.goalD && b.y > gy0 && b.y < gy1) return { goal: 'R' };

    /* 边线：撞墙弹回（球门区域那一段已经在上面的进球判定里处理过）。
       注意这里**不做「被墙包住就出不来」的防护**——那件事放在比赛层的
       stuckBall() 里做，stepBall 保持纯物理（客户端要拿它逐帧重算）。 */
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * k; }
    if (b.x > w - R) { b.x = w - R; b.vx = -Math.abs(b.vx) * k; }
    if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy) * k; }
    if (b.y > h - R) { b.y = h - R; b.vy = -Math.abs(b.vy) * k; }

    /* 门柱：球顶在门柱端点（x=goalD / w-goalD，y=gy0 / gy1）上弹开，
       而不是「擦着门柱穿进去」——两根柱子各用一个圆做碰撞。 */
    var posts = [[g.goalD, gy0], [g.goalD, gy1], [w - g.goalD, gy0], [w - g.goalD, gy1]];
    for (var i = 0; i < posts.length; i++) {
      var dx = b.x - posts[i][0], dy = b.y - posts[i][1];
      var d = Math.hypot(dx, dy);
      if (d > 0.0001 && d < R) {
        var nx = dx / d, ny = dy / d;
        b.x = posts[i][0] + nx * R;
        b.y = posts[i][1] + ny * R;
        var vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + k) * vn * nx; b.vy -= (1 + k) * vn * ny; }
      }
    }
    return null;
  }

  /* 球员一帧：加速 + 摩擦 + 边界；撞到球时把球顶出去。
     返回 true 表示这一帧碰到球。
     C 必须包含 w/h/R/BR（PT_C 的副本），这样人、球、场地的尺寸只有一个来源
     —— 少一个字段就会「人穿出场地、球永远碰不到」，所以统一在这里兜底。 */

  /* 推球的「贴近速度」下限（px/s）：人朝球方向的速度小于它时不算在推球。
     约等于 3 帧走 1px，比任何可感知的移动都小，但足以把
     「站着不动的人被球擦到」与「人在带球」区分开。 */
  var CLOSE_EPS = 0.2;

  function stepPlayer(p, inp, ball, dt, C) {
    C = C || PT_C;
    var w = C.w || PT_C.w, h = C.h || PT_C.h;
    var CR = C.PR || PT_C.PR, BR = C.BR || PT_C.BR;
    dt = dt || 1 / 60;
    var ix = (inp && inp.x) || 0, iy = (inp && inp.y) || 0;
    var m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }
    var spd = (inp && inp.sp) || 1;
    p.ix = ix; p.iy = iy;

    if (m > 0.2) {
      var want = Math.atan2(iy, ix);
      var da = want - (p.a || 0);
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      p.a = (p.a || 0) + da * Math.min(1, dt * 16);
    }

    p.vx += ix * C.ACC * spd * dt;
    p.vy += iy * C.ACC * spd * dt;
    var damp = Math.max(0, 1 - C.FRICTION * dt);
    p.vx *= damp; p.vy *= damp;
    var sp = Math.hypot(p.vx, p.vy);
    var cap = C.MAX_SPD * spd;
    if (sp > cap) { p.vx = p.vx / sp * cap; p.vy = p.vy / sp * cap; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < CR) { p.x = CR; if (p.vx < 0) p.vx *= -0.4; }
    if (p.x > w - CR) { p.x = w - CR; if (p.vx > 0) p.vx *= -0.4; }
    if (p.y < CR) { p.y = CR; if (p.vy < 0) p.vy *= -0.4; }
    if (p.y > h - CR) { p.y = h - CR; if (p.vy > 0) p.vy *= -0.4; }

    var dx = ball.x - p.x, dy = ball.y - p.y;
    var d = Math.hypot(dx, dy);
    var min = CR + BR;
    if (d >= min) return false;

    var nx, ny;
    var degenerate = d < 0.0001;
    if (degenerate) { nx = 1; ny = 0; } else { nx = dx / d; ny = dy / d; }
    /* min 是「贴身吸附」距离：把球按到接触点上正好。
       只有当人确实在往球这边走时才吸附——否则站着不动的人会把
       擦身而过的球「吸」住（球滚到场边贴着站桩队友，它会一路被带着走，
       甚至被自己的队友推进自家门）。 */
    var closing = p.vx * nx + p.vy * ny;
    /* 完全重合（开局/复活撞一起）没有方向可言，也要硬推开，否则会穿模 */
    if (degenerate || closing >= CLOSE_EPS) { ball.x = p.x + nx * min; ball.y = p.y + ny * min; }

    /* 给球的速度取「当前法向 + 人推的速度」，永远不小于 0。
       站着不动的人在 CLOSE_EPS 以内仍然挡球（它有质量），只是不给球额外加速。

       为什么法向要打 PUSH 折扣（<1）、横向还要限幅：
         球摩擦 0.9/s，带球摩擦 2.6/s —— 同一次接触之后球衰减得比人慢。
         如果按人的全速给球加速（旧版 PUSH=1.12），人踩到全速的那一脚会把球
         送到 400+，而人最多 360，球就永远跑在人前面：实测 3 秒只碰到球 19 帧，
         其余时间都在「追球」。改成 PUSH=0.9 后接触帧数从 19 涨到 131/180，
         球稳稳贴在脚前 54px，是真带球。
         横向（切向）那一点只保留 12% 并限幅 CARRY，保证「朝哪跑，球就往哪滚」。
         射门走 kickBall，不受这里影响。 */
    var push = Math.max(0, closing);
    var bn = ball.vx * nx + ball.vy * ny;
    var target = Math.max(bn, push * C.PUSH + C.PUSH_MIN);
    ball.vx += nx * (target - bn);
    ball.vy += ny * (target - bn);
    var tx = -ny, ty = nx;
    var pt = p.vx * tx + p.vy * ty;
    var lat = pt * 0.12;
    var latCap = C.CARRY || 0;
    if (latCap > 0 && Math.abs(lat) > latCap) lat = lat > 0 ? latCap : -latCap;
    ball.vx += tx * lat;
    ball.vy += ty * lat;
    return true;
  }

  /* 射门：朝朝向大力抽射。球离脚太远就不生效（判定两端一致）。 */
  function kickBall(p, ball, C) {
    C = C || PT_C;
    var a = p.a || 0;
    var dx = Math.cos(a), dy = Math.sin(a);
    var d = Math.hypot(ball.x - p.x, ball.y - p.y);
    if (d > C.KICK_R) return false;
    var sp = Math.hypot(p.vx, p.vy);
    var power = C.KICK + Math.min(260, sp * 0.8);
    ball.vx = dx * power + p.vx * 0.25;
    ball.vy = dy * power + p.vy * 0.25;
    ball.x = p.x + dx * (C.R + C.BR);
    ball.y = p.y + dy * (C.R + C.BR);
    return true;
  }


  var EXPORTS = { createBody: createBody, stepBody: stepBody, solidBody: solidBody, stepTank: stepTank, tankBlocked: tankBlocked, stepShell: stepShell, newShell: newShell, PT_C: PT_C, pitchGeom: pitchGeom, createBall: createBall, stepBall: stepBall, stepPlayer: stepPlayer, kickBall: kickBall};
  for (var k in EXPORTS) if (Object.prototype.hasOwnProperty.call(EXPORTS, k)) SHARED[k] = EXPORTS[k];
  SHARED.__hash = '432c2a2284';
  global.WH_SHARED = SHARED;
  if (typeof module === 'object' && module.exports) module.exports = SHARED;
})(typeof globalThis !== 'undefined' ? globalThis : this);
