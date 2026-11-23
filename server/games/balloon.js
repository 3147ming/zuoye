/* ============================================================
 * server/games/balloon.js —— 泡泡堂（服务端权威）
 * ------------------------------------------------------------
 * 玩法：格子迷宫，每人一颗泡泡怪，走格子放水泡，水泡 2.4 秒后炸开成十字水柱，
 *       被水柱淹到就被淘汰；木箱挡路、也能被水柱炸掉。最后活着的人赢。
 *
 * 1.20 起加厚三层：
 *   · 3 套地图主题（经典街区 / 花园广场 / 石柱迷宫），箱子密度与柱子结构不同；
 *   · 木箱炸开有 55% 掉道具：泡泡数 +1 / 火力 +1 / 加速鞋（8 秒走得更快）；
 *   · 走位改成「按住方向持续走」，服务端按步进节流，手感更像掌机而不是一下一下点。
 *
 * 刻意做得很轻：15×11 格 / 4 人 / 30Hz 快照只发变化量。
 * ============================================================ */
'use strict';

var GW = 15, GH = 11;
var FUSE = 2.4;                /* 水泡引信秒数 */
var RANGE = 3;                 /* 初始水柱长度 */
var RANGE_MAX = 7;
var BOMB_MAX = 5;
var BOMB_CD = 0.22;
var STEP_T = 0.155;            /* 走一格的时间 */
var STEP_FAST = 0.10;          /* 加速鞋 */
var ROUND_TIME = 180;

/* 0 空地 1 硬墙 2 木箱 */
var COLORS = ['#7ec8ff', '#ff9f9f', '#8ff0b5', '#ffd166'];

/* 道具：0 泡泡+1 / 1 火力+1 / 2 加速鞋 */
var ITEMS = [
  { id: 'bomb', name: '泡泡 +1', glyph: '◍', color: '#7ec8ff' },
  { id: 'range', name: '火力 +1', glyph: '✳', color: '#ff9f9f' },
  { id: 'speed', name: '加速鞋', glyph: '➤', color: '#ffd166' }
];

var THEMES = [
  { id: 'street', name: '经典街区', box: 0.62, extra: 0 },
  { id: 'garden', name: '花园广场', box: 0.44, extra: 0 },
  { id: 'maze', name: '石柱迷宫', box: 0.55, extra: 1 }
];

function makeMap(rand, n, theme) {
  var m = [];
  for (var y = 0; y < GH; y++) {
    var row = [];
    for (var x = 0; x < GW; x++) {
      var edge = x === 0 || y === 0 || x === GW - 1 || y === GH - 1;
      var pillar = x % 2 === 0 && y % 2 === 0;
      row.push(edge || pillar ? 1 : 0);
    }
    m.push(row);
  }
  /* 迷宫主题：再插一圈 2×1 的短墙，走位更绕 */
  if (theme.extra) {
    [[3, 3], [3, 4], [11, 7], [11, 6], [7, 2], [7, 8]].forEach(function (c) {
      if (m[c[1]] && m[c[1]][c[0]] === 0) m[c[1]][c[0]] = 1;
    });
  }
  var spawns = [];
  var corners = [[1, 1], [GW - 2, GH - 2], [GW - 2, 1], [1, GH - 2]];
  for (var i = 0; i < n; i++) {
    var c = corners[i % 4];
    spawns.push([c[0], c[1]]);
    [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nx = c[0] + d[0], ny = c[1] + d[1];
      if (nx > 0 && ny > 0 && nx < GW - 1 && ny < GH - 1 && m[ny][nx] === 2) m[ny][nx] = 0;
    });
  }
  for (var y2 = 0; y2 < GH; y2++) {
    for (var x2 = 0; x2 < GW; x2++) {
      if (m[y2][x2] !== 0) continue;
      var nearSpawn = spawns.some(function (s) { return Math.abs(s[0] - x2) + Math.abs(s[1] - y2) <= 1; });
      if (nearSpawn) continue;
      if (rand() < theme.box) m[y2][x2] = 2;
    }
  }
  return { map: m, spawns: spawns };
}

exports.meta = { name: '泡泡堂', min: 2, max: 4, colors: COLORS, gw: GW, gh: GH, themes: THEMES.map(function (t) { return t.name; }) };

exports.create = function (ctx) {
  var rand = ctx.random;
  var theme = THEMES[Math.floor(rand() * THEMES.length) % THEMES.length];
  var built = makeMap(rand, ctx.players.length, theme);
  var map = built.map;
  var players = [];
  var bombs = [];        /* {x, y, owner, at, range} */
  var blasts = [];       /* {x, y, until, owner} */
  var boxes = [];        /* 本帧被炸掉的木箱，前端播动画 */
  var items = [];        /* {x, y, k} */
  var events = [];
  var over = null;
  var snapInited = false;
  var t0 = Date.now();

  ctx.players.forEach(function (p, i) {
    var s = built.spawns[i];
    players.push({
      id: p.id, seat: p.seat, name: p.name, x: s[0], y: s[1],
      alive: true, maxBombs: 1, range: RANGE, cd: 0, kills: 0,
      hold: '', lastHold: '', acc: 0, fastT: 0, items: 0
    });
  });

  function at(id) {
    for (var i = 0; i < players.length; i++) if (players[i].id === id) return players[i];
    return null;
  }
  function blastAt(x, y) {
    for (var i = 0; i < blasts.length; i++) if (blasts[i].x === x && blasts[i].y === y) return true;
    return false;
  }
  function bombAt(x, y) {
    for (var i = 0; i < bombs.length; i++) if (bombs[i].x === x && bombs[i].y === y) return bombs[i];
    return null;
  }
  function itemAt(x, y) {
    for (var i = 0; i < items.length; i++) if (items[i].x === x && items[i].y === y) return items[i];
    return null;
  }
  function walkable(x, y) {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return false;
    return map[y][x] === 0;
  }

  function dropItem(x, y) {
    if (rand() > 0.55) return;
    var r = rand();
    var k = r < 0.36 ? 0 : r < 0.72 ? 1 : 2;
    items.push({ x: x, y: y, k: k });
  }

  function explode(b) {
    var owner = at(b.owner);
    var cells = [[b.x, b.y]];
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var d = 0; d < 4; d++) {
      for (var r = 1; r <= b.range; r++) {
        var nx = b.x + dirs[d][0] * r, ny = b.y + dirs[d][1] * r;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) break;
        if (map[ny][nx] === 1) break;                /* 硬墙挡水柱 */
        cells.push([nx, ny]);
        if (map[ny][nx] === 2) {                     /* 木箱吃掉这一格并终止 */
          map[ny][nx] = 0;
          boxes.push([nx, ny]);
          dropItem(nx, ny);
          break;
        }
      }
    }
    cells.forEach(function (c) {
      blasts.push({ x: c[0], y: c[1], until: FUSE + 0.55, owner: b.owner });
    });
    /* 连锁引爆：水柱打中别的水泡就直接引爆 */
    cells.forEach(function (c) {
      var other = bombAt(c[0], c[1]);
      if (other && other !== b) { other.at = 0; }
    });
    events.push({ e: 'boom', x: b.x, y: b.y });
  }

  function tryStep(me, dir) {
    var dx = 0, dy = 0;
    if (dir === 'u') dy = -1; else if (dir === 'd') dy = 1;
    else if (dir === 'l') dx = -1; else if (dir === 'r') dx = 1;
    else return false;
    var nx = me.x + dx, ny = me.y + dy;
    if (!walkable(nx, ny)) return false;
    if (bombAt(nx, ny)) return false;
    me.x = nx; me.y = ny;
    /* 走到道具上就吃掉 */
    var it = itemAt(nx, ny);
    if (it) {
      if (it.k === 0) me.maxBombs = Math.min(BOMB_MAX, me.maxBombs + 1);
      else if (it.k === 1) me.range = Math.min(RANGE_MAX, me.range + 1);
      else { me.fastT = 8; }
      me.items += 1;
      items.splice(items.indexOf(it), 1);
      events.push({ e: 'item', id: me.id, k: it.k, x: nx, y: ny });
    }
    events.push({ e: 'mv', id: me.id, x: nx, y: ny });
    return true;
  }

  var api = {
    onInput: function (p, d) {
      var me = at(p.id);
      if (!me || !me.alive || !d) return;
      var dir = d.d;
      if (dir === 'u' || dir === 'd' || dir === 'l' || dir === 'r') me.hold = dir;
      else if (dir === '') me.hold = '';
    },
    onAction: function (p, d) {
      var me = at(p.id);
      if (!me || !me.alive || me.cd > 0) return;
      if (d && d.a === 'bomb') {
        if (bombAt(me.x, me.y)) return;
        var mine = bombs.filter(function (b) { return b.owner === me.id; }).length;
        if (mine >= me.maxBombs) return;
        bombs.push({ x: me.x, y: me.y, owner: me.id, at: FUSE, range: me.range });
        me.cd = BOMB_CD;
        events.push({ e: 'bomb', x: me.x, y: me.y, by: me.id });
      } else if (d && d.a === 'use') {
        /* 踩掉自己脚下的水泡（防止把自己困死） */
        var b = bombAt(me.x, me.y);
        if (b && b.owner === me.id) b.at = 0;
      }
    },
    step: function (dt, tick) {
      var i, p;
      for (i = 0; i < players.length; i++) {
        p = players[i];
        if (p.cd > 0) p.cd -= dt;
        if (p.fastT > 0) p.fastT -= dt;
        if (!p.alive) continue;
        /* 按住方向持续走：按步进时间累积，方向一变立刻反应 */
        if (p.hold) {
          var st = p.fastT > 0 ? STEP_FAST : STEP_T;
          if (p.hold !== p.lastHold) { p.lastHold = p.hold; p.acc = st; }
          p.acc += dt;
          var guard = 0;
          while (p.acc >= st && guard < 3) {
            p.acc -= st;
            guard += 1;
            if (!tryStep(p, p.hold)) { p.acc = 0; break; }
          }
        } else {
          p.lastHold = '';
          p.acc = 0;
        }
      }
      /* 水泡倒计时 */
      for (i = bombs.length - 1; i >= 0; i--) {
        bombs[i].at -= dt;
        if (bombs[i].at <= 0) {
          explode(bombs[i]);
          bombs.splice(i, 1);
        }
      }
      /* 水柱存活 + 伤害判定 */
      for (i = blasts.length - 1; i >= 0; i--) {
        blasts[i].until -= dt;
        if (blasts[i].until <= 0) blasts.splice(i, 1);
      }
      for (i = 0; i < players.length; i++) {
        p = players[i];
        if (!p.alive) continue;
        if (blastAt(p.x, p.y)) {
          p.alive = false;
          var own = blasts.filter(function (b) { return b.x === p.x && b.y === p.y; })[0];
          var killer = own ? at(own.owner) : null;
          if (killer && killer.alive && killer.id !== p.id) killer.kills += 1;
          events.push({ e: 'out', id: p.id, by: killer ? killer.id : null, x: p.x, y: p.y });
        }
      }
      var live = players.filter(function (x) { return x.alive; });
      if (live.length <= 1 && !over) {
        var rank = players.slice().sort(function (a, b) { return a.alive === b.alive ? 0 : (a.alive ? -1 : 1); });
        over = {
          game: 'balloon',
          winner: rank[0] ? rank[0].id : null,
          scores: rank.map(function (b, idx) {
            return { id: b.id, name: b.name, score: (b.alive ? 100 : 0) + b.kills * 30, rank: idx + 1, kills: b.kills };
          }),
          reason: live.length === 0 ? 'draw' : 'knockout'
        };
      }
      if (!over && (Date.now() - t0) / 1000 > ROUND_TIME) {
        var r2 = players.slice().sort(function (a, b) { return b.kills - a.kills; });
        over = {
          game: 'balloon', winner: r2[0] ? r2[0].id : null, reason: 'timeout',
          scores: r2.map(function (b, idx) { return { id: b.id, name: b.name, score: b.kills * 30, rank: idx + 1, kills: b.kills }; })
        };
      }
    },
    snapshot: function (tick) {
      var out = {
        t: tick,
        p: players.map(function (p) {
          return [p.id, p.x, p.y, p.alive ? 1 : 0, p.maxBombs, p.range, p.fastT > 0 ? 1 : 0];
        }),
        b: bombs.map(function (b) { return [b.x, b.y, Math.max(0, Math.round(b.at * 10) / 10)]; })
      };
      if (blasts.length) out.bl = blasts.map(function (b) { return [b.x, b.y]; });
      if (items.length) out.it = items.map(function (v) { return [v.x, v.y, v.k]; });
      /* 地图同步：首帧发全量（客户端据此铺图），之后只发被炸掉的坐标 */
      if (!snapInited) {
        out.gm = map.map(function (row) { return row.join(''); });
        out.mn = theme.id;
        snapInited = true;
      }
      if (boxes.length) { out.box = boxes.slice(0, 12); boxes.length = 0; }
      if (events.length) { out.ev = events.slice(0, 16); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      var me = at(p.id);
      if (me) me.alive = false;
    }
  };
  return api;
};
