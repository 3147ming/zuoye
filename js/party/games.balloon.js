/* ============================================================
 * games.balloon.js —— 泡泡堂
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

  var GW = 15, GH = 11, TS = 44;
  var BALL_ITEM = [
    { glyph: '◍', color: '#7ec8ff', name: '泡泡+1' },
    { glyph: '✳', color: '#ff9f9f', name: '火力+1' },
    { glyph: '➤', color: '#ffd166', name: '加速鞋' }
  ];

  K.register('balloon', {
    aspect: (GW * TS) / (GH * TS),
    howTo: '<b>WASD / 方向键 / 左摇杆</b> 走格子，一次走一格（按住不放会一直走）<br>'
      + '<b>空格 / 放泡按钮</b> 放水泡，水泡 3 秒后炸出十字水柱<br>'
      + '炸掉木箱会掉 ◍泡泡+1 / ✳火力+1 / ➤加速鞋，踩上去就吃<br>'
      + '水柱碰到自己也会死，放完记得走开',
    keys: ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '],
    buttons: [{ label: '放泡', onPress: function (S) { S.net.action('bomb'); } }],
    init: function (S) {
      S.g = { p: [], b: [], bl: [], box: [], ev: [], it: [], map: null, lastSent: 'x', fl: [] };
    },
    onSnap: function (S, d) {
      S.g.p = K.slide(S.g.p, d.p || [], 1, 2, 0);
      S.g.b = d.b || [];
      S.g.bl = d.bl || [];
      S.g.it = d.it || [];
      if (d.gm) {
        /* 首帧整图：1 硬墙 / 2 木箱 / 0 空地 */
        S.g.map = d.gm.map(function (row) { return row.split('').map(Number); });
      }
      if (d.box && S.g.map) {
        d.box.forEach(function (c) { if (S.g.map[c[1]]) S.g.map[c[1]][c[0]] = 0; });
      }
      (d.ev || []).forEach(function (e) {
        if (e.e === 'item') {
          var it = BALL_ITEM[e.k] || BALL_ITEM[0];
          float(S, e.x * TS + TS / 2, e.y * TS + TS / 2, it.name, it.color, 15);
        } else if (e.e === 'boom') {
          S.g.shake = 5;
        } else if (e.e === 'out') {
          float(S, e.x * TS + TS / 2, e.y * TS + TS / 2, nameOf(S, e.id) + ' 出局', '#ff9f9f', 15);
        }
      });
      S.g.ev = S.g.ev.concat(d.ev || []).slice(-30);
    },
    onKey: function (S, k) {
      if (k === ' ') { S.net.action('bomb'); }
    },
    sendInput: function (S, net) {
      /* 按住方向持续走：服务端按步进节流，这里只在方向变化时上报 */
      var dir = dirOf(S.axis.x, S.axis.y);
      if (dir !== S.g.lastSent) {
        S.g.lastSent = dir;
        net.input({ d: dir });
      }
    },
    draw: function (S) {
      var c = S.draw;
      fit(S, GW * TS, GH * TS);
      var shk = S.g.shake || 0;
      if (shk > 0.3) {
        c.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk);
        S.g.shake = shk * 0.85;
      } else S.g.shake = 0;
      c.fillStyle = '#12182b';
      c.fillRect(0, 0, GW * TS, GH * TS);
      /* 地板棋盘 */
      for (var y = 0; y < GH; y++) {
        for (var x = 0; x < GW; x++) {
          c.fillStyle = (x + y) % 2 ? '#18223a' : '#141c30';
          c.fillRect(x * TS, y * TS, TS, TS);
        }
      }
      /* 地形：服务端首帧给了整图就按图铺；没到之前只按边界 + 偶数格推断硬墙 */
      var map = S.g.map;
      function cellAt(x, y) {
        if (map && map[y]) return map[y][x];
        return (x === 0 || y === 0 || x === GW - 1 || y === GH - 1 || (x % 2 === 0 && y % 2 === 0)) ? 1 : 0;
      }
      for (var y2 = 0; y2 < GH; y2++) {
        for (var x2 = 0; x2 < GW; x2++) {
          var cell = cellAt(x2, y2);
          if (cell === 1) {
            c.fillStyle = '#2b3350';
            rr(c, x2 * TS + 2, y2 * TS + 2, TS - 4, TS - 4, 6); c.fill();
            c.fillStyle = 'rgba(255,255,255,.08)';
            rr(c, x2 * TS + 6, y2 * TS + 6, TS - 12, (TS - 12) / 2, 4); c.fill();
          } else if (cell === 2) {
            /* 木箱：木色 + 斜纹，和硬墙一眼能分开 */
            c.fillStyle = '#8a6234';
            rr(c, x2 * TS + 4, y2 * TS + 4, TS - 8, TS - 8, 5); c.fill();
            c.strokeStyle = 'rgba(255,214,170,.45)';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(x2 * TS + 8, y2 * TS + 8);
            c.lineTo(x2 * TS + TS - 8, y2 * TS + TS - 8);
            c.moveTo(x2 * TS + TS - 8, y2 * TS + 8);
            c.lineTo(x2 * TS + 8, y2 * TS + TS - 8);
            c.stroke();
            c.strokeStyle = 'rgba(0,0,0,.28)';
            c.strokeRect(x2 * TS + 4, y2 * TS + 4, TS - 8, TS - 8);
          }
        }
      }
      /* 道具 */
      S.g.it.forEach(function (it) {
        var info = BALL_ITEM[it[2]] || BALL_ITEM[0];
        var px = it[0] * TS + TS / 2, py = it[1] * TS + TS / 2 + Math.sin(S.t * 3 + it[0]) * 3;
        c.fillStyle = 'rgba(10,14,26,.85)';
        rr(c, px - 15, py - 15, 30, 30, 9); c.fill();
        c.strokeStyle = info.color;
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = info.color;
        c.font = '700 17px system-ui,sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(info.glyph, px, py + 1);
        c.textBaseline = 'alphabetic';
      });
      /* 水柱 */
      S.g.bl.forEach(function (b) {
        var g = c.createRadialGradient(b[0] * TS + TS / 2, b[1] * TS + TS / 2, 4, b[0] * TS + TS / 2, b[1] * TS + TS / 2, TS * 0.75);
        g.addColorStop(0, 'rgba(180,235,255,.95)');
        g.addColorStop(1, 'rgba(90,170,235,.35)');
        c.fillStyle = g;
        rr(c, b[0] * TS + 3, b[1] * TS + 3, TS - 6, TS - 6, 10); c.fill();
      });
      /* 水泡 */
      S.g.b.forEach(function (b) {
        var px = b[0] * TS + TS / 2, py = b[1] * TS + TS / 2;
        var pulse = 1 + Math.sin(S.t * 8 + b[0]) * 0.06 * (1 - Math.min(1, b[2] / 2.4));
        c.fillStyle = 'rgba(0,0,0,.3)';
        c.beginPath(); c.arc(px, py + 4, TS * 0.32, 0, 6.284); c.fill();
        c.fillStyle = '#5fa8e8';
        c.beginPath(); c.arc(px, py, TS * 0.33 * pulse, 0, 6.284); c.fill();
        c.fillStyle = 'rgba(255,255,255,.65)';
        c.beginPath(); c.arc(px - 6, py - 7, 5, 0, 6.284); c.fill();
        /* 引信倒计时环 */
        c.strokeStyle = b[2] < 0.8 ? '#ff7a7a' : 'rgba(255,255,255,.5)';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(px, py, TS * 0.4, -1.57, -1.57 + 6.284 * Math.max(0, b[2] / 2.4));
        c.stroke();
      });
      /* 玩家泡泡怪 */
      S.g.p.forEach(function (p) {
        var px = p[1] * TS + TS / 2, py = p[2] * TS + TS / 2;
        var col = seatColor(S, p[0]);
        if (!p[3]) {
          c.globalAlpha = 0.2; c.fillStyle = col;
          c.beginPath(); c.arc(px, py, TS * 0.3, 0, 6.284); c.fill();
          c.globalAlpha = 1;
          return;
        }
        c.fillStyle = 'rgba(0,0,0,.35)';
        c.beginPath(); c.ellipse(px, py + TS * 0.24, TS * 0.3, TS * 0.14, 0, 0, 6.284); c.fill();
        c.fillStyle = col;
        c.beginPath(); c.arc(px, py, TS * 0.34, 0, 6.284); c.fill();
        c.fillStyle = 'rgba(255,255,255,.5)';
        c.beginPath(); c.arc(px - 5, py - 6, 5, 0, 6.284); c.fill();
        c.fillStyle = '#20263a';
        c.beginPath(); c.arc(px - 5, py - 1, 2.4, 0, 6.284); c.fill();
        c.beginPath(); c.arc(px + 5, py - 1, 2.4, 0, 6.284); c.fill();
        /* 加速鞋特效 */
        if (p[6]) {
          c.strokeStyle = 'rgba(255,209,102,.8)';
          c.lineWidth = 2;
          c.beginPath(); c.arc(px, py + 2, TS * 0.4, 0.4, 2.2); c.stroke();
        }
        c.font = '600 11px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillStyle = 'rgba(255,255,255,.9)';
        c.fillText(nameOf(S, p[0]), px, py + TS * 0.62);
      });
      drawFloats(S);
    },
    scoreRows: function (S) {
      return S.g.p.map(function (p) {
        return { id: p[0], name: nameOf(S, p[0]), color: seatColor(S, p[0]), text: p[3] ? '◍' + p[4] + ' ✳' + p[5] : '出局' };
      });
    }
  });

  /* ============================================================
   * 坦克大战
   * ============================================================ */
})(typeof window !== 'undefined' ? window : globalThis);
