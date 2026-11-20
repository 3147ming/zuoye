/* ============================================================
 * games.tank.js —— 坦克大战
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

  var TW = 1000, TH = 660;
  var TANK_DEFAULT_WALLS = [[420, 120, 160, 36], [420, 504, 160, 36], [300, 300, 36, 180], [664, 300, 36, 180], [470, 300, 60, 60]];
  var TANK_PICK = [
    { glyph: '≫', color: '#7ec8ff', name: '加速' },
    { glyph: '◈', color: '#8ff0b5', name: '护盾' },
    { glyph: '⁙', color: '#ffd166', name: '连发' }
  ];

  /* 坦克的本地预测器。
     坦克比碰碰简单：位移只由 (thr, turn) 和自己周围的墙决定，
     所以 stepTank 直接就是「一帧物理」，两边算出来完全一样。
     炮弹不在这里预测（命中判定涉及别人位置，交给服务端），
     但自己的炮口火光响应走本地（action 时立即播）。 */
  function makeTankPred(S, row) {
    function walls() { return S.g.wl || TANK_DEFAULT_WALLS; }
    function bricks() { return S.g.br || []; }
    /* 别的坦克当成静态挡板（服务端也是这么判的：距离 42 内不能进） */
    function others() {
      return S.g.k.map(function (t) { return { id: t[0], x: t[1], y: t[2], alive: !!t[5] }; });
    }
    return new PRED.Pred({
      key: S.you,
      x: row[1], y: row[2], a: row[3],
      hp: row[4],
      idle: function () { return { thr: 0, turn: 0 }; },
      step: function (b, inp) {
        PHYS.stepTank(b, { thr: (inp && inp.thr) || 0, turn: (inp && inp.turn) || 0, sp: b.sp || 1 },
          walls(), bricks(), others(), S.you);
      },
      snap: function (st) { return { x: st.x, y: st.y, a: st.a }; },
      apply: function (b, s) { b.x = s.x; b.y = s.y; if (s.a != null) b.a = s.a; }
    });
  }

  K.register('tank', {
    aspect: TW / TH,
    howTo: '<b>W / ↑ = 前进</b>（朝车头方向开，不是朝屏幕上方开）<br>'
      + '<b>S / ↓ = 倒退</b> · <b>A D / ← → = 原地转向</b> · 摇杆往上推也是前进<br>'
      + '<b>空格 / 开炮按钮</b> 开炮，炮管冷却 0.62 秒；炮弹会被砖墙挡<br>'
      + '打中对手 +1 分、击毁 +3 分，<b>先到 5 分赢</b>',
    keys: ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '],
    buttons: [{ label: '开炮', onPress: function (S) { S.net.action('fire'); } }],
    init: function (S) { S.g = { k: [], s: [], ev: [], myA: 0, wl: null, br: null, pu: [], fl: [], shake: 0, pred: null }; },
    onSnap: function (S, d) {
      S.g.k = K.slide(S.g.k, d.k || [], 1, 2, 0);
      S.g.s = d.s || [];
      if (d.wl) S.g.wl = d.wl;
      if (d.br) S.g.br = d.br;
      S.g.pu = d.pu || [];
      /* ---- 客户端预测 ---- */
      var mine = bodyOf(S, S.g.k, S.you);
      if (mine) {
        if (!S.g.pred && PRED && PHYS) S.g.pred = makeTankPred(S, mine);
        if (S.g.pred) {
          /* 必须用 _ax/_ay（KIT.slide 存下来的服务端真值）。
             mine[1]/mine[2] 已经被改写成插值起点，拿它当权威值会一直把自己拉回去。 */
          var st = {
            x: mine._ax != null ? mine._ax : mine[1],
            y: mine._ay != null ? mine._ay : mine[2],
            a: mine[3]
          };
          if (!mine[5]) S.g.pred.resync(st);          /* 被击毁：以服务端为准 */
          else S.g.pred.onSnap(ackOf(d, S.you), st);
          S.g.pred.body.hp = mine[4];
          S.g.pred.body.sp = mine[7] ? 1.45 : 1;      /* 加速补给：本地推进也用同一倍率 */
        }
      }
      (d.ev || []).forEach(function (e) {
        if (e.e === 'hit') { float(S, e.x, e.y, '命中', '#fff3d0', 15); if (e.on === S.you) S.g.shake = 6; }
        else if (e.e === 'pick') {
          var it = TANK_PICK[e.k] || TANK_PICK[0];
          float(S, e.x, e.y, it.name, it.color, 15);
        } else if (e.e === 'kill') float(S, e.x, e.y, '击毁', '#ff9f9f', 17);
        else if (e.e === 'brick') S.g.shake = Math.max(S.g.shake, 3);
      });
      S.g.ev = S.g.ev.concat(d.ev || []).slice(-30);
    },
    onKey: function (S, k) { if (k === ' ') S.net.action('fire'); },
    sendInput: function (S, net) {
      var thr = 0, turn = 0;
      if (S.keys.w || S.keys.arrowup) thr += 1;
      if (S.keys.s || S.keys.arrowdown) thr -= 1;
      if (S.keys.a || S.keys.arrowleft) turn -= 1;
      if (S.keys.d || S.keys.arrowright) turn += 1;
      /* 摇杆：屏幕坐标 y 向下，往上推是负数 —— 「往上」应该是前进，
         所以这里要取反。以前写成 ay > 0 ? 1 : -1，结果往上推变后退、往下推变前进，
         键盘和摇杆的直觉正好相反。只取模长决定前后，不关心正负号本身。 */
      if (Math.abs(S.axis.y) > 0.3) thr = S.axis.y < 0 ? 1 : -1;
      if (Math.abs(S.axis.x) > 0.3) turn = S.axis.x > 0 ? 1 : -1;
      var p = S.g.pred;
      if (p) {
        p.correct(S.dt);
        p.tick(S.dt);
        net.input({ thr: thr, turn: turn, seq: p.send({ thr: thr, turn: turn }) });
      } else net.input({ thr: thr, turn: turn });
    },
    draw: function (S) {
      var c = S.draw;
      fit(S, TW, TH);
      var shk = S.g.shake || 0;
      if (shk > 0.3) {
        c.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk);
        S.g.shake = shk * 0.86;
      } else S.g.shake = 0;
      c.fillStyle = '#141118';
      c.fillRect(0, 0, TW, TH);
      /* 沙地纹理 */
      c.strokeStyle = 'rgba(255,220,160,.05)';
      for (var i = 0; i < TW; i += 40) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i, TH); c.stroke();
      }
      for (var j = 0; j < TH; j += 40) { c.beginPath(); c.moveTo(0, j); c.lineTo(TW, j); c.stroke(); }
      /* 掩体 */
      var walls = S.g.wl || TANK_DEFAULT_WALLS;
      walls.forEach(function (w) {
        c.fillStyle = '#4a4356';
        rr(c, w[0], w[1], w[2], w[3], 6); c.fill();
        c.fillStyle = 'rgba(255,255,255,.1)';
        rr(c, w[0] + 3, w[1] + 3, w[2] - 6, Math.max(4, w[3] / 3), 4); c.fill();
      });
      /* 砖墙：hp 2 → 完整，1 → 裂缝 */
      if (S.g.br) {
        S.g.br.forEach(function (w) {
          c.fillStyle = w[4] > 1 ? '#7d4a34' : '#5d3626';
          rr(c, w[0], w[1], w[2], w[3], 4); c.fill();
          c.strokeStyle = 'rgba(0,0,0,.35)';
          c.lineWidth = 1;
          for (var bx = w[0] + 12; bx < w[0] + w[2]; bx += 16) {
            c.beginPath(); c.moveTo(bx, w[1] + 2); c.lineTo(bx, w[1] + w[3] - 2); c.stroke();
          }
          if (w[4] <= 1) {
            c.strokeStyle = 'rgba(0,0,0,.55)';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(w[0] + w[2] * 0.3, w[1] + 3);
            c.lineTo(w[0] + w[2] * 0.45, w[1] + w[3] * 0.6);
            c.lineTo(w[0] + w[2] * 0.35, w[1] + w[3] - 3);
            c.stroke();
          }
        });
      }
      /* 补给 */
      S.g.pu.forEach(function (p) {
        var info = TANK_PICK[p[2]] || TANK_PICK[0];
        var py = p[1] + Math.sin(S.t * 3 + p[0] * 0.02) * 4;
        c.save();
        c.translate(p[0], py);
        c.shadowColor = info.color;
        c.shadowBlur = 12;
        c.fillStyle = 'rgba(12,10,18,.9)';
        rr(c, -15, -15, 30, 30, 9); c.fill();
        c.shadowBlur = 0;
        c.strokeStyle = info.color;
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = info.color;
        c.font = '700 17px system-ui,sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(info.glyph, 0, 1);
        c.textBaseline = 'alphabetic';
        c.restore();
      });
      /* 炮弹 */
      S.g.s.forEach(function (s) {
        c.fillStyle = '#ffd9a0';
        c.beginPath(); c.arc(s[0], s[1], 6, 0, 6.284); c.fill();
        c.strokeStyle = 'rgba(255,180,90,.5)';
        c.lineWidth = 3;
        c.beginPath(); c.moveTo(s[0], s[1]); c.lineTo(s[0] - s[2] * 0.03, s[1] - s[3] * 0.03); c.stroke();
      });
      /* 坦克 */
      var pv = S.g.pred;
      S.g.k.forEach(function (t) {
        var col = seatColor(S, t[0]);
        /* 自己那辆用预测坐标 + 预测朝向画（转得跟手）；别人走插值后的快照 */
        var px = t[1], py = t[2], pa = t[3], me = pv && pv.ready && t[0] === S.you;
        if (me) { px = pv.drawX(); py = pv.drawY(); pa = pv.body.a; }
        if (t[8]) {
          c.strokeStyle = 'rgba(143,240,181,' + (0.4 + Math.sin(S.t * 6) * 0.2) + ')';
          c.lineWidth = 3;
          c.beginPath(); c.arc(px, py, 30, 0, 6.284); c.stroke();
        }
        c.save();
        c.translate(px, py);
        c.rotate(pa);
        c.globalAlpha = t[5] ? 1 : 0.28;
        /* 履带 */
        c.fillStyle = '#3a3448';
        rr(c, -20, -24, 40, 48, 8); c.fill();
        c.fillStyle = 'rgba(0,0,0,.35)';
        for (var k = -18; k < 20; k += 8) c.fillRect(-20, k, 40, 3);
        /* 炮管 */
        c.fillStyle = '#6a6178';
        rr(c, 0, -5, 34, 10, 4); c.fill();
        /* 炮塔 */
        c.fillStyle = col;
        c.beginPath(); c.arc(0, 0, 17, 0, 6.284); c.fill();
        c.fillStyle = 'rgba(255,255,255,.4)';
        c.beginPath(); c.arc(-5, -5, 5, 0, 6.284); c.fill();
        c.restore();
        /* 状态标记 */
        var tag = '';
        if (t[7]) tag += '≫';
        if (t[8]) tag += '◈';
        if (t[9]) tag += '⁙';
        if (tag) {
          c.fillStyle = 'rgba(255,255,255,.75)';
          c.font = '700 11px system-ui,sans-serif';
          c.textAlign = 'center';
          c.fillText(tag, px, py - 47);
        }
        /* 血条 + 名字 */
        c.fillStyle = 'rgba(0,0,0,.5)';
        rr(c, px - 24, py - 40, 48, 6, 3); c.fill();
        c.fillStyle = t[4] > 50 ? '#8ff0b5' : t[4] > 25 ? '#ffd166' : '#ff7a7a';
        rr(c, px - 24, py - 40, 48 * Math.max(0, t[4] / 100), 6, 3); c.fill();
        c.fillStyle = 'rgba(255,255,255,.85)';
        c.font = '600 12px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillText(nameOf(S, t[0]) + ' · ' + t[6], px, py + 42);
      });
      drawFloats(S);
    },
    scoreRows: function (S) {
      return S.g.k.map(function (t) {
        return { id: t[0], name: nameOf(S, t[0]), color: seatColor(S, t[0]), text: t[6] + ' / 5 分' };
      });
    }
  });

  /* ============================================================
   * 贪吃蛇大作战
   * ============================================================ */
})(typeof window !== 'undefined' ? window : globalThis);
