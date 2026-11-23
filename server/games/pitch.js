/* ============================================================
 * server/games/pitch.js —— 球场（2v2 / 1v1 带球射门）
 * ------------------------------------------------------------
 * 玩法：
 *   · 每队一个球门（左队攻右门，右队攻左门），先进 3 球或 3 分钟到点，进球多的队赢；
 *   · 人推球：身体撞到球就把球顶出去，跑得越猛顶得越远；
 *   · 射门（空格）：朝当前朝向大力抽射，球在脚边才生效；
 *   · 两张场地：标准草地 / 冰面球馆（球滑得远、人也滑），随机切换。
 *
 * 为什么这个玩法特别适合做「客户端预测」：
 *   球和人都是同一套确定性物理，没有随机数、没有时间戳，
 *   客户端可以完整重算「我跑、我推球、我射门」的全过程，连球都能本地预测，
 *   高延迟下也能做到「按下就动、射门就飞」。
 *
 * 网络：
 *   · 输入 { x, y }（摇杆方向，-1..1，会做归一化）；
 *   · 动作 'kick'：朝当前朝向抽射一记（服务端有冷却，客户端同源判定）；
 *   · 快照：球 + 每个玩家位置/朝向 + 比分/剩余时间；进球等事件走 ev。
 * ============================================================ */
'use strict';

// #shared-begin pitch-physics
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

// #shared-end

var W = PT_C.w, H = PT_C.h;
var ROUND_TIME = 180;
var GOAL_TO_WIN = 3;
var GOAL_PAUSE = 2.4;          /* 进球后重新摆位的停顿 */
var COLORS = ['#ff7a7a', '#7ec8ff', '#ffd166', '#8ff0b5'];

var PITCHES = [
  { id: 'grass', name: '标准草地', ballFr: 0.9, humanFr: 2.6, acc: 1750 },
  { id: 'ice', name: '冰面球馆', ballFr: 0.28, humanFr: 0.7, acc: 1250 }
];

exports.meta = {
  name: '球场 2v2', min: 2, max: 4, colors: COLORS,
  pitches: PITCHES.map(function (p) { return p.name; }),
  desc: '带球推射，先 3 球'
};

exports.create = function (ctx) {
  var rand = ctx.random;
  var pitch = PITCHES[Math.floor(rand() * PITCHES.length) % PITCHES.length];
  var geo = pitchGeom();

  /* 本局物理参数 = 默认表的一份副本，再按场地改写。
     这份对象既给服务端用，也原样下发客户端（md.C），两端零差异。 */
  var phys = {};
  for (var key in PT_C) phys[key] = PT_C[key];
  phys.ACC = pitch.acc;
  phys.FRICTION = pitch.humanFr;
  phys.BALL_FR = pitch.ballFr;
  /* 门区禁入线：玩家在门框高度区间里最靠里只能站到这里。
     值必须大于球员碰撞半径（PR），否则一摆位就会被夹在墙和球门之间来回弹。 */
  var WALL_X = 120;

  var ball = createBall(W / 2, H / 2);
  var players = [];
  var events = [];
  var over = null;
  var t0 = Date.now();
  var score = { L: 0, R: 0 };
  var pause = GOAL_PAUSE;        /* 开局也要摆一次位（不然球停在中间没人碰） */
  var lastGoalBy = null;
  var sentMeta = false;

  /* 分边：前一半坐左边（攻右门），后一半坐右边。
     每队两人一上一下错开，别都挤在一条竖线上。 */
  var n = ctx.players.length;
  var half = Math.ceil(n / 2);
  /* 出生点：本队半场两个站位（后场 / 前场各一）。
     x 必须大于 WALL_X，否则开局摆位就会被「门区禁入」夹住。 */
  function spawnOf(i) {
    var side = i < half ? 'L' : 'R';
    var k = i % 2;                      /* 0 上 1 下 */
    var back = k ? 0.18 : 0.30;
    return [W * (side === 'L' ? back : 1 - back), H * (k ? 0.70 : 0.30)];
  }

  ctx.players.forEach(function (pl, i) {
    var s = spawnOf(i);
    players.push({
      id: pl.id, name: pl.name, seat: pl.seat,
      side: i < half ? 'L' : 'R',
      x: s[0], y: s[1], vx: 0, vy: 0, a: i < half ? 0 : Math.PI,
      ix: 0, iy: 0, cd: 0, score: 0, shots: 0, touches: 0
    });
  });

  function at(id) {
    for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i];
    return null;
  }

  function resetPositions() {
    ball.x = W / 2; ball.y = H / 2; ball.vx = 0; ball.vy = 0;
    players.forEach(function (p, i) {
      var s = spawnOf(i);
      p.x = s[0]; p.y = s[1]; p.vx = 0; p.vy = 0;
      p.a = p.side === 'L' ? 0 : Math.PI;
    });
  }

  /* 结算：先比「所在队是否获胜」，同队内再比个人进球数、触球数。
     注意判平局（winSide === null）时两队同权，只比个人数据。 */
  function finish(reason) {
    if (over) return;
    var winSide = score.L === score.R ? null : (score.L > score.R ? 'L' : 'R');
    function rankValue(p) {
      var teamWin = winSide && p.side === winSide ? 1 : 0;
      var teamTie = !winSide ? 1 : 0;
      return (teamWin + teamTie) * 1e6 + p.score * 1e4 + p.touches;
    }
    var rank = players.slice().sort(function (a, b) { return rankValue(b) - rankValue(a); });
    var best = rank[0];
    over = {
      game: 'pitch',
      /* 平局就是平局，不硬塞一个赢家 */
      winner: winSide ? best.id : null,
      draw: !winSide,
      scores: rank.map(function (p, i) {
        return {
          id: p.id, name: p.name, rank: i + 1,
          /* 展示分：进球 100 分/个 + 触球 1 分，队伍胜负已在 rank 里体现 */
          score: teamScore(p),
          goals: p.score, shots: p.shots, touches: p.touches,
          side: p.side
        };
      }),
      detail: { L: score.L, R: score.R },
      reason: reason || 'goals'
    };
  }
  function teamScore(p) {
    return Math.round((p.side === 'L' ? score.L : score.R) * 100 + p.score * 10 + p.touches);
  }

  /* 球被顶进角落时「自行脱困」。
     为什么会卡：球速每帧先乘摩擦、再被墙反号，人一直往里压时
     球速长期停在 ±14 px/s，永远走不出 21px 的角 —— 实测能卡一整局。
     这里不是改物理，而是加一条「比赛规则」：
     球贴着同一条边线超过 1.2 秒、且几乎没在动，就沿着这条边线轻轻推出去。
     刻意**不放在 stepBall 里**：客户端要拿 stepBall 逐帧重算，加进去就两边不一致了。
     客户端那边读服务端下发的权威位置 + 插值，视觉效果一致。 */
  /* ---- 球贴墙脱困（比赛规则，不是物理）----
     球被顶进死角时，人每帧把它往墙里按、墙又把它弹回来，位置在 1px 内抖动，
     永远走不出 21px 的角。这是规则问题不是物理问题，所以放在比赛层：
     同一片边线连续 1.2 秒没有明显位移，就把球朝场地中心挪 3px 并给一点向内的速度。
     刻意不在 stepBall 里做 —— 客户端要逐帧重算 stepBall，加进去就两端不一致了。 */
  var wallT = 0, wallKey = '', wallSlide = 0;
  function stuckBall(dt) {
    var R = phys.BR + 6;               /* 比贴墙点宽 6px，包住「人肉顶住」的抖动 */
    var key = '';
    if (ball.x < R) key += 'L';
    if (ball.x > W - R) key += 'R';
    if (ball.y < R) key += 'U';
    if (ball.y > H - R) key += 'D';
    if (!key) { wallT = 0; wallKey = ''; return; }

    /* 沿墙坐标：左右墙看 y，上下墙看 x */
    var slide = (key === 'U' || key === 'D') ? ball.x : ball.y;
    if (key !== wallKey) { wallKey = key; wallT = 0; wallSlide = slide; }
    /* 沿墙滑出 10px 就说明球在正常滚动，不是卡死 */
    if (Math.abs(slide - wallSlide) > 10) { wallT = 0; wallSlide = slide; }

    wallT += dt;
    if (wallT < 1.2) return;
    wallT = 0;

    var cx = W / 2 - ball.x, cy = H / 2 - ball.y;
    var cm = Math.hypot(cx, cy) || 1;
    ball.x += cx / cm * 3;
    ball.y += cy / cm * 3;
    ball.vx += cx / cm * 35;
    ball.vy += cy / cm * 35;
    events.push({ e: 'unstuck', x: Math.round(ball.x), y: Math.round(ball.y) });
  }

  var api = {
    onInput: function (p, d) {
      var me = at(p.id);
      if (!me || !d || over) return;
      if (typeof d.x === 'number') me.ix = Math.max(-1, Math.min(1, d.x));
      if (typeof d.y === 'number') me.iy = Math.max(-1, Math.min(1, d.y));
    },
    onAction: function (p, d) {
      var me = at(p.id);
      if (!me || !d || over || pause > 0) return;
      if (d.a === 'kick' && me.cd <= 0) {
        if (kickBall(me, ball, phys)) {
          me.cd = phys.KICK_CD;
          me.shots += 1;
          events.push({
            e: 'kick', id: me.id, a: Math.round((me.a || 0) * 100) / 100,
            x: Math.round(me.x), y: Math.round(me.y)
          });
        }
      }
    },
    step: function (dt, tick) {
      var i;
      if (over) return;
      if (pause > 0) {
        pause -= dt;
        if (pause <= 0) { resetPositions(); pause = 0; events.push({ e: 'go', x: W / 2, y: H / 2 }); }
        return;
      }

      /* 先处理所有球员（含推球），再推进球：一帧内人的动作要能马上作用到球上。
         注意顺序：脱困必须在「人推完、球还没走」之间做 ——
         放 stepBall 之后的话，人下一帧一接触又会把球速盖回去，
         球就被永久钉在角上（实测每 1.2 秒弹一次、永远出不来）。 */
      for (i = 0; i < players.length; i++) {
        var p = players[i];
        if (p.cd > 0) p.cd = Math.max(0, p.cd - dt);
        var hitP = stepPlayer(p, { x: p.ix, y: p.iy, sp: 1 }, ball, dt, phys);
        if (hitP) p.touches += 1;
        /* 不许站进球门：站在门里能把球堵死 */
        if (p.x < WALL_X && p.y > geo.goalY0 - phys.PR && p.y < geo.goalY1 + phys.PR) p.x = WALL_X;
        if (p.x > W - WALL_X && p.y > geo.goalY0 - phys.PR && p.y < geo.goalY1 + phys.PR) p.x = W - WALL_X;
      }

      /* 球被顶进角落超过 1.2 秒 → 轻微脱困（详见 stuckBall 注释） */
      stuckBall(dt);

      /* 球员之间互相推开（不传速度：靠身体卡位） */
      for (i = 0; i < players.length; i++) {
        for (var j = i + 1; j < players.length; j++) {
          var a = players[i], b = players[j];
          var ddx = b.x - a.x, ddy = b.y - a.y;
          var dd = Math.hypot(ddx, ddy);
          var mm = phys.PR * 2;
          if (dd > 0.0001 && dd < mm) {
            var nx = ddx / dd, ny = ddy / dd, ov = (mm - dd) / 2;
            a.x -= nx * ov; a.y -= ny * ov;
            b.x += nx * ov; b.y += ny * ov;
          }
        }
      }

      /* 所有人推完、脱困做完，才让球滚一帧。
         这样这一帧里球的速度是最终版，不会再被下一次接触盖掉。 */
      var g = stepBall(ball, dt, geo, phys);
      if (g) {
        score[g.goal] += 1;
        /* 进球人：离球最近、且属于「进球那一边的对家」的球员。
           自己打进自家门（乌龙）也算对面进的，这里就找不到本队的人。 */
        var scorer = null, best = 1e9;
        for (i = 0; i < players.length; i++) {
          var q = players[i];
          if (q.side === g.goal) continue;
          var dq = Math.hypot(q.x - ball.x, q.y - ball.y);
          if (dq < best) { best = dq; scorer = q; }
        }
        if (scorer) scorer.score += 1;
        lastGoalBy = scorer ? scorer.id : null;
        events.push({
          e: 'goal', side: g.goal, by: lastGoalBy,
          x: Math.round(ball.x), y: Math.round(ball.y), sc: [score.L, score.R]
        });
        ball.vx = 0; ball.vy = 0;
        if (score[g.goal] >= GOAL_TO_WIN) { finish('goals'); return; }
        pause = GOAL_PAUSE;
        return;
      }
      if ((Date.now() - t0) / 1000 > ROUND_TIME) finish('timeout');
    },
    snapshot: function (tick) {
      var out = {
        t: tick,
        /* ba 带前两维坐标、第三/四维是速度：客户端插值要用速度做外推，
           否则 30Hz 快照下球看起来总是慢半拍、拖影。速度取整到 10 就够，
           反正只用来外推 30ms。 */
        ba: [
          Math.round(ball.x * 10) / 10, Math.round(ball.y * 10) / 10,
          Math.round(ball.vx / 10) * 10, Math.round(ball.vy / 10) * 10
        ],
        pl: players.map(function (p) {
          return [
            p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10,
            Math.round((p.a || 0) * 100) / 100, p.side === 'L' ? 0 : 1,
            Math.round(p.cd * 100) / 100
          ];
        }),
        sc: [score.L, score.R],
        ps: pause > 0 ? Math.round(pause * 10) / 10 : 0
      };
      if (!sentMeta) {
        out.md = { id: pitch.id, name: pitch.name, geo: geo, C: phys };
        sentMeta = true;
      }
      if (events.length) { out.ev = events.slice(0, 8); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      var me = at(p.id);
      if (me) { me.ix = 0; me.iy = 0; me.gone = true; }
    }
  };
  return api;
};

exports.DATA = PT_C;
exports.PITCHES = PITCHES;
exports.geom = pitchGeom;
exports.stepBall = stepBall;
exports.stepPlayer = stepPlayer;
exports.kickBall = kickBall;
exports.createBall = createBall;
exports.DT = 1 / 60;
