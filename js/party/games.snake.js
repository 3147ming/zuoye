/* ============================================================
 * games.snake.js —— 贪吃蛇大作战
 * 公共件在 games.js（WH_PARTY_GAMES），本文件必须先于它之后加载。
 * ============================================================ */
(function (global) {
  'use strict';

  var K = global.PartyKit;
  var G = global.WH_PARTY_GAMES;
  if (!K || !G) return;

  var COLORS, rr, seatColor, nameOf, PRED, PHYS, ackOf, bodyOf, fit, dirOf, float, drawFloats;
  if (G) { COLORS = G.COLORS; rr = G.rr; seatColor = G.seatColor; nameOf = G.nameOf;
    PRED = G.PRED; PHYS = G.PHYS; ackOf = G.ackOf; bodyOf = G.bodyOf;
    fit = G.fit; dirOf = G.dirOf; float = G.float; drawFloats = G.drawFloats; }

  var SW = 1200, SH = 800, SEG = 14;

  K.register('snakebattle', {
    aspect: SW / SH,
    howTo: '<b>WASD / 方向键</b> 直接指定往哪走（按 ↑ 就往上，不用管现在朝哪）<br>'
      + '<b>空格 / 冲刺按钮</b> 加速冲刺，冲刺要消耗身长，且更容易撞到人<br>'
      + '吃豆子变长，撞到别人身体 / 墙 / 自己就出局；金果 +3 节<br>'
      + '身长最长的赢，撞死别人能捡他掉的豆子',
    keys: ['a', 'd', 'arrowleft', 'arrowright', 'w', 's', 'arrowup', 'arrowdown', ' '],
    buttons: [
      { label: '左转', onPress: function (S) { S.net.input({ turn: 'l' }); } },
      { label: '右转', onPress: function (S) { S.net.input({ turn: 'r' }); }, cls: 'pk-btn-alt' },
      { label: '冲刺', onPress: function (S) { S.net.action('boost'); }, cls: 'pk-btn-alt' }
    ],
    init: function (S) { S.g = { s: [], f: [], trails: {}, ev: [], fl: [] }; },
    onSnap: function (S, d) {
      S.g.s = d.s || [];
      S.g.f = d.f || [];
      (d.ev || []).forEach(function (e) {
        if (e.e === 'gold') float(S, e.x, e.y, '+3 金果', '#ffd166', 15);
        else if (e.e === 'speed') float(S, e.x, e.y, '加速', '#7ec8ff', 14);
        else if (e.e === 'boost') float(S, e.x, e.y, '冲刺', '#ffd166', 15);
      });
      S.g.ev = S.g.ev.concat(d.ev || []).slice(-24);
      /* 本地维护轨迹：服务端只发头，身体在这里按走位累积 */
      var t = S.t;
      S.g.s.forEach(function (h) {
        var tr = S.g.trails[h[0]] || (S.g.trails[h[0]] = []);
        var last = tr[0];
        if (!last || Math.hypot(last[0] - h[1], last[1] - h[2]) > 6) tr.unshift([h[1], h[2], h[3], t]);
        while (tr.length > 90) tr.pop();
      });
    },
    /* 转向用「一次性按键」，不用持续输入（持续输入会转个不停） */
    onKey: function (S, k) {
      /* 用「绝对方向」而不是左右转：
         以前 w 和 a 都发 turn:'l'、s 和 d 都发 turn:'r'，是按「相对当前朝向」转的，
         蛇在往右走时按 ↑ 会变成往下（因为左转一次）—— 跟人的直觉完全相反。
         服务端本来就支持 {d:'u'|'d'|'l'|'r'}，直接发方向最直观。 */
      if (k === 'w' || k === 'arrowup') S.net.input({ d: 'u' });
      else if (k === 's' || k === 'arrowdown') S.net.input({ d: 'd' });
      else if (k === 'a' || k === 'arrowleft') S.net.input({ d: 'l' });
      else if (k === 'd' || k === 'arrowright') S.net.input({ d: 'r' });
      else if (k === ' ') S.net.action('boost');
    },
    sendInput: function () { /* 转向在 onKey 里发，避免每帧重发 */ },
    draw: function (S) {
      var c = S.draw;
      fit(S, SW, SH);
      c.fillStyle = '#0d1118';
      c.fillRect(0, 0, SW, SH);
      c.strokeStyle = 'rgba(120,220,180,.05)';
      for (var i = 0; i < SW; i += 60) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, SH); c.stroke(); }
      for (var j = 0; j < SH; j += 60) { c.beginPath(); c.moveTo(0, j); c.lineTo(SW, j); c.stroke(); }
      /* 食物：0 普通 / 1 金果 / 2 加速果 */
      S.g.f.forEach(function (p, idx) {
        var type = p[2] || 0;
        var pulse = 0.7 + Math.sin(S.t * 4 + idx) * 0.3;
        if (type === 1) {
          c.fillStyle = 'rgba(255,209,102,' + (0.55 + pulse * 0.4) + ')';
          c.beginPath(); c.arc(p[0], p[1], 8 + pulse * 3, 0, 6.284); c.fill();
          c.strokeStyle = 'rgba(255,240,200,.8)';
          c.lineWidth = 2;
          c.beginPath(); c.arc(p[0], p[1], 11 + pulse * 3, 0, 6.284); c.stroke();
        } else if (type === 2) {
          c.fillStyle = 'rgba(126,200,255,' + (0.5 + pulse * 0.4) + ')';
          c.beginPath(); c.arc(p[0], p[1], 6 + pulse * 2, 0, 6.284); c.fill();
        } else {
          c.fillStyle = 'rgba(255,225,150,' + (0.35 + pulse * 0.5) + ')';
          c.beginPath(); c.arc(p[0], p[1], 5 + pulse * 2, 0, 6.284); c.fill();
        }
      });
      /* 蛇 */
      S.g.s.forEach(function (h) {
        var col = seatColor(S, h[0]);
        var tr = S.g.trails[h[0]] || [];
        var len = h[4];
        for (var k = Math.min(tr.length - 1, len - 1); k >= 0; k--) {
          var p = tr[k];
          var r = SEG * 0.52 * (1 - k / (len + 6) * 0.35);
          c.globalAlpha = h[5] ? (1 - k / (len + 8) * 0.5) : 0.2;
          c.fillStyle = col;
          c.beginPath(); c.arc(p[0], p[1], r, 0, 6.284); c.fill();
        }
        c.globalAlpha = h[5] ? 1 : 0.25;
        /* 冲刺 / 加速果的外发光 */
        if (h[6] || h[7]) {
          c.fillStyle = h[6] ? 'rgba(255,214,102,.28)' : 'rgba(126,200,255,.22)';
          c.beginPath(); c.arc(h[1], h[2], SEG * 1.5, 0, 6.284); c.fill();
        }
        c.fillStyle = col;
        c.beginPath(); c.arc(h[1], h[2], SEG * 0.62, 0, 6.284); c.fill();
        c.fillStyle = '#0d1118';
        var dx = [1, 0, -1, 0][h[3]] || 0, dy = [0, 1, 0, -1][h[3]] || 0;
        c.beginPath(); c.arc(h[1] + dx * 4 - dy * 4, h[2] + dy * 4 + dx * 4, 2.4, 0, 6.284); c.fill();
        c.beginPath(); c.arc(h[1] + dx * 4 + dy * 4, h[2] + dy * 4 - dx * 4, 2.4, 0, 6.284); c.fill();
        c.globalAlpha = 1;
        c.fillStyle = 'rgba(255,255,255,.8)';
        c.font = '600 11px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillText(nameOf(S, h[0]), h[1], h[2] - 14);
      });
      drawFloats(S);
    },
    scoreRows: function (S) {
      return S.g.s.map(function (h) {
        return { id: h[0], name: nameOf(S, h[0]), color: seatColor(S, h[0]), text: h[5] ? h[4] + ' 节' : '出局' };
      });
    }
  });

  /* ============================================================
   * 抢答赛
   * ============================================================ */
})(typeof window !== 'undefined' ? window : globalThis);
