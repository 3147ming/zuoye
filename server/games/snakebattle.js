/* ============================================================
 * server/games/snakebattle.js —— 贪吃蛇大作战（服务端权威）
 * ------------------------------------------------------------
 * 玩法：环形地图，每人的蛇一直朝当前方向走，左右转向；吃到光点变长，
 *       撞到别人的身体（或自己）就出局；头对头相撞，短的那条死。
 *
 * 1.20 起加厚三层：
 *   · 三种食物：普通光点（+2 节）/ 金果（+3 节、+30 分）/ 加速果（5 秒双倍速）；
 *   · 冲刺：消耗 2 节身体换 1.2 秒爆发，用来抢食或逃命（2 秒冷却）；
 *   · 死亡后身体散成光点，场上越打越乱，翻盘机会更多。
 * ============================================================ */
'use strict';

var W = 1200, H = 800;
var SEG = 14;               /* 每节格子尺寸 */
var STEP = 0.115;           /* 每步推进间隔（秒/格） */
var START_LEN = 5;
var MAX_LEN = 90;
var FOODS = 60;
var TURN_MIN = 0.06;        /* 两次转向最短间隔，避免一路原地打转 */
var BOOST_T = 1.2;
var BOOST_CD = 2.2;

var COLORS = ['#7ec8ff', '#ff9f9f', '#8ff0b5', '#ffd166'];

exports.meta = { name: '贪吃蛇大作战', min: 2, max: 4, colors: COLORS, w: W, h: H, seg: SEG };

exports.create = function (ctx) {
  var rand = ctx.random;
  var foods = [];
  var snakes = [];
  var events = [];
  var over = null;
  var t0 = Date.now();

  var spots = [
    { x: 160, y: 160, d: 1 }, { x: W - 160, y: H - 160, d: 3 },
    { x: W - 160, y: 160, d: 2 }, { x: 160, y: H - 160, d: 0 }
  ];
  /* 0 右 1 下 2 左 3 上 */
  var DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function foodType() {
    var r = rand();
    if (r < 0.12) return 1;      /* 金果 */
    if (r < 0.28) return 2;      /* 加速果 */
    return 0;
  }

  function dropFood(type) {
    for (var t = 0; t < 40; t++) {
      var x = Math.floor(rand() * (W / SEG)) * SEG + SEG / 2;
      var y = Math.floor(rand() * (H / SEG)) * SEG + SEG / 2;
      var bad = false;
      for (var i = 0; i < snakes.length && !bad; i++) {
        for (var j = 0; j < snakes[i].body.length; j++) {
          if (Math.abs(snakes[i].body[j][0] - x) < SEG && Math.abs(snakes[i].body[j][1] - y) < SEG) { bad = true; break; }
        }
      }
      if (!bad) { foods.push([x, y, type == null ? foodType() : type]); return; }
    }
  }

  ctx.players.forEach(function (p, i) {
    var s = spots[i % 4];
    var body = [];
    var d = DIR[s.d];
    for (var k = 0; k < START_LEN; k++) body.push([s.x - d[0] * k * SEG, s.y - d[1] * k * SEG]);
    snakes.push({
      id: p.id, name: p.name, seat: p.seat,
      body: body, dir: s.d, want: s.d, alive: true, grow: 0,
      acc: 0, turnCd: 0, kills: 0, best: START_LEN, deadAt: 0,
      gold: 0, boostT: 0, boostCd: 0, fastT: 0
    });
  });
  for (var f = 0; f < FOODS; f++) dropFood(0);

  function snake(id) {
    for (var i = 0; i < snakes.length; i++) if (snakes[i].id === id) return snakes[i];
    return null;
  }

  function finish(reason) {
    var rank = snakes.slice().sort(function (a, b) {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.body.length - a.body.length;
    });
    over = {
      game: 'snakebattle', winner: rank[0] ? rank[0].id : null, reason: reason || 'knockout',
      scores: rank.map(function (s, i) {
        return { id: s.id, name: s.name, score: s.body.length * 10 + s.kills * 25 + s.gold * 30, len: s.body.length, kills: s.kills, rank: i + 1 };
      })
    };
  }

  return {
    onInput: function (p, d) {
      var s = snake(p.id);
      if (!s || !s.alive || !d) return;
      var want = null;
      if (typeof d.dir === 'number') want = d.dir;
      else if (d.d === 'u') want = 3; else if (d.d === 'd') want = 1;
      else if (d.d === 'l') want = 2; else if (d.d === 'r') want = 0;
      else if (d.turn === 'l' || d.turn === 'left') want = (s.dir + 3) % 4;
      else if (d.turn === 'r' || d.turn === 'right') want = (s.dir + 1) % 4;
      if (want == null || want === s.dir) return;
      if ((want + 2) % 4 === s.dir) return;       /* 不能 180° 掉头 */
      if (s.turnCd > 0) return;
      s.want = want;
      s.turnCd = TURN_MIN;
    },
    onAction: function (p, d) {
      var s = snake(p.id);
      if (!s || !s.alive || !d) return;
      if (d.a !== 'boost') return;
      if (s.boostCd > 0 || s.body.length <= 6) return;
      /* 用两节身体换一次爆发 */
      s.body.pop(); s.body.pop();
      s.boostT = BOOST_T;
      s.boostCd = BOOST_CD;
      events.push({ e: 'boost', id: s.id, x: Math.round(s.body[0][0]), y: Math.round(s.body[0][1]) });
    },
    step: function (dt) {
      var i, j, s;
      for (i = 0; i < snakes.length; i++) {
        s = snakes[i];
        if (s.boostCd > 0) s.boostCd -= dt;
        if (s.boostT > 0) s.boostT -= dt;
        if (s.fastT > 0) s.fastT -= dt;
        if (!s.alive) continue;
        if (s.turnCd > 0) s.turnCd -= dt;
        var mul = s.boostT > 0 ? 2 : (s.fastT > 0 ? 1.6 : 1);
        s.acc += dt * mul;
        while (s.acc >= STEP) {
          s.acc -= STEP;
          s.dir = s.want;
          var d = DIR[s.dir];
          var head = s.body[0];
          var nx = head[0] + d[0] * SEG;
          var ny = head[1] + d[1] * SEG;
          /* 穿墙（环形地图比撞墙友好，手机更好操作） */
          if (nx < 0) nx += W; if (nx >= W) nx -= W;
          if (ny < 0) ny += H; if (ny >= H) ny -= H;
          s.body.unshift([nx, ny]);
          if (s.grow > 0) { s.grow -= 1; } else { s.body.pop(); }
        }
      }
      /* 吃光点 */
      for (i = 0; i < snakes.length; i++) {
        s = snakes[i];
        if (!s.alive) continue;
        var h = s.body[0];
        for (j = foods.length - 1; j >= 0; j--) {
          if (Math.abs(foods[j][0] - h[0]) < SEG * 0.7 && Math.abs(foods[j][1] - h[1]) < SEG * 0.7) {
            var type = foods[j][2] || 0;
            foods.splice(j, 1);
            if (type === 1) {
              if (s.body.length + s.grow < MAX_LEN) s.grow += 3;
              s.gold += 1;
              events.push({ e: 'gold', id: s.id, x: h[0], y: h[1] });
            } else if (type === 2) {
              if (s.body.length + s.grow < MAX_LEN) s.grow += 1;
              s.fastT = 5;
              events.push({ e: 'speed', id: s.id, x: h[0], y: h[1] });
            } else {
              if (s.body.length + s.grow < MAX_LEN) s.grow += 2;
              events.push({ e: 'eat', id: s.id, x: h[0], y: h[1] });
            }
            dropFood(0);
          }
        }
      }
      /* 碰撞：头撞身体 */
      for (i = 0; i < snakes.length; i++) {
        s = snakes[i];
        if (!s.alive) continue;
        var head = s.body[0];
        var dead = false, killerId = null;
        for (j = 0; j < snakes.length && !dead; j++) {
          var o = snakes[j];
          if (!o.alive) continue;
          var start = (o.id === s.id) ? 1 : 0;
          for (var k = start; k < o.body.length; k++) {
            var seg = o.body[k];
            if (Math.abs(seg[0] - head[0]) < SEG * 0.75 && Math.abs(seg[1] - head[1]) < SEG * 0.75) {
              /* 头对头：短的死 */
              if (k === 0 && o.id !== s.id) {
                if (o.body.length >= s.body.length) { dead = true; killerId = o.id; }
                else { o.alive = false; o.deadAt = Date.now(); s.kills += 1; events.push({ e: 'out', id: o.id, by: s.id, x: o.body[0][0], y: o.body[0][1] }); }
              } else {
                dead = true; killerId = o.id;
              }
              break;
            }
          }
        }
        if (dead) {
          s.alive = false; s.deadAt = Date.now();
          var killer = killerId ? snake(killerId) : null;
          if (killer && killer.alive && killer.id !== s.id) killer.kills += 1;
          events.push({ e: 'out', id: s.id, by: killerId, x: head[0], y: head[1] });
          /* 尸体变成光点，给场上加点料 */
          for (var b = 0; b < s.body.length; b += 3) if (foods.length < FOODS + 40) foods.push([s.body[b][0], s.body[b][1], 0]);
        }
      }
      var live = snakes.filter(function (x) { return x.alive; });
      if (live.length <= 1 && !over) finish(live.length === 1 ? 'knockout' : 'draw');
      if (!over && (Date.now() - t0) / 1000 > 240) finish('timeout');
    },
    snapshot: function (tick) {
      var out = {
        t: tick,
        /* 只发头 + 长度 + 方向，身体由客户端按长度外插（省 90% 带宽） */
        s: snakes.map(function (x) {
          var h = x.body[0];
          return [x.id, Math.round(h[0]), Math.round(h[1]), x.dir, x.body.length, x.alive ? 1 : 0, x.boostT > 0 ? 1 : 0, x.fastT > 0 ? 1 : 0];
        }),
        f: foods.slice(0, 90).map(function (p) { return [Math.round(p[0]), Math.round(p[1]), p[2] || 0]; })
      };
      if (events.length) { out.ev = events.slice(0, 14); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      var s = snake(p.id);
      if (s) s.alive = false;
    }
  };
};
