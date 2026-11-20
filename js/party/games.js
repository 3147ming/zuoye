/* ============================================================
 * js/party/games.js —— 联机玩法公共底座
 * ------------------------------------------------------------
 * 约定：服务端算一切，客户端只负责「把快照画好看」。
 * 每个玩法（games.<id>.js）暴露：
 *   aspect   逻辑宽高比
 *   init(S)  初始化本地容器
 *   sendInput / buttons  上行输入
 *   draw(S)  每帧绘制
 *   scoreRows(S)  顶部记分条
 * 位图与文字全用 canvas 画，不额外拉图片，弱网也能秒开。
 *
 * 拆分说明（1.24.9）：原来七个玩法挤在这一个 2000 行的文件里，
 * 改坦克要滚过碰碰、球场，改抢答要在 2000 行里找 DOM 结构。
 * 现在这里只留「大家都要用的东西」，玩法各自成文件：
 *   games.bounce.js / games.balloon.js / games.tank.js /
 *   games.snake.js / games.quiz.js / games.draw.js / games.pitch.js
 * 加载顺序：本文件必须先加载（它建立 WH_PARTY_GAMES 命名空间）。
 * ============================================================ */
(function (global) {
  'use strict';

  var K = global.PartyKit;
  if (!K) return;

  var COLORS = ['#ff7a7a', '#7ec8ff', '#8ff0b5', '#ffd166'];

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function seatColor(S, id) {
    var seat = 0;
    for (var i = 0; i < S.players.length; i++) if (S.players[i].id === id) seat = S.players[i].seat || 0;
    return COLORS[seat % 4];
  }

  function nameOf(S, id) {
    for (var i = 0; i < S.players.length; i++) if (S.players[i].id === id) return S.players[i].name;
    return '玩家';
  }

  /* ---------- 客户端预测的公共零件 ---------- */
  var PRED = global.WH_PREDICT;
  var PHYS = global.WH_SHARED;   /* 与服务端同源的一帧物理（注意别和贪吃蛇的 SH=场地高 撞名） */

  /* 从快照里找出「我的输入被服务端处理到哪一条」。
     服务端在 room-core 里回显 d.ak = [[pid, seq], ...]，缺了就返回 0
     （0 表示「还没确认任何输入」，Pred 会保守地整段重放，画面不会抖）。 */
  function ackOf(d, me) {
    var ak = d && d.ak;
    if (!ak) return 0;
    for (var i = 0; i < ak.length; i++) if (ak[i][0] === me) return ak[i][1] || 0;
    return 0;
  }

  function bodyOf(S, list, id) {
    for (var i = 0; i < list.length; i++) if (list[i][0] === id) return list[i];
    return null;
  }

  function fit(S, lw, lh) {
    /* 逻辑坐标 → 视图坐标 */
    var s = Math.min(S.view.w / lw, S.view.h / lh);
    var ox = (S.view.w - lw * s) / 2;
    var oy = (S.view.h - lh * s) / 2;
    S.draw.setTransform(S.view.dpr, 0, 0, S.view.dpr, 0, 0);
    S.draw.translate(ox, oy);
    S.draw.scale(s, s);
    return { s: s, ox: ox, oy: oy };
  }

  /* 方向：把 (axis.x, axis.y) 量化成 4 向（格子游戏用） */
  function dirOf(ax, ay) {
    if (Math.abs(ax) < 0.3 && Math.abs(ay) < 0.3) return '';
    if (Math.abs(ax) > Math.abs(ay)) return ax > 0 ? 'r' : 'l';
    return ay > 0 ? 'd' : 'u';
  }

  /* 飘字：统一收口，避免每个玩法各写一套 */
  function float(S, x, y, txt, color, size) {
    S.g.fl = S.g.fl || [];
    S.g.fl.push({ x: x, y: y, txt: txt, c: color || '#fff', sz: size || 20, t: S.t });
    if (S.g.fl.length > 24) S.g.fl.shift();
  }

  function drawFloats(S) {
    var c = S.draw, list = S.g.fl;
    if (!list || !list.length) return;
    for (var i = list.length - 1; i >= 0; i--) {
      var f = list[i];
      var age = S.t - f.t;
      if (age > 1.05) { list.splice(i, 1); continue; }
      var k = age / 1.05;
      c.globalAlpha = 1 - k * k;
      c.fillStyle = f.c;
      c.font = '700 ' + f.sz + 'px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText(f.txt, f.x, f.y - 26 - k * 46);
    }
    c.globalAlpha = 1;
  }


  /* 导出给各玩法文件：它们在自己的 IIFE 里，拿不到这里的私有变量 */
  global.WH_PARTY_GAMES = {
    COLORS: COLORS, rr: rr, seatColor: seatColor, nameOf: nameOf,
    PRED: PRED, PHYS: PHYS, ackOf: ackOf, bodyOf: bodyOf,
    fit: fit, dirOf: dirOf, float: float, drawFloats: drawFloats
  };
})(typeof window !== 'undefined' ? window : globalThis);
