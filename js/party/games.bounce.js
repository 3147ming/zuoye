/* ============================================================
 * games.bounce.js —— 咱俩碰碰
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

  /* ============================================================
   * 咱俩碰碰
   * ============================================================ */
  var BOUNCE_PICK = [
    { name: '治疗', glyph: '+', color: '#8ff0b5' },
    { name: '加速', glyph: '≫', color: '#7ec8ff' },
    { name: '护盾', glyph: '◈', color: '#ffd166' },
    { name: '重击', glyph: '✦', color: '#ff7a7a' }
  ];

  /* 碰碰车的本地预测器。
     为什么单独包一层：stepBody 需要「地形 + 加速倍率 + 道具状态」这几个只有本局才知道
     的参数，而 Pred 只接口 (body, input)，所以在这里把参数闭合住：
       · 重放历史时：只用历史输入，倍率/道具按「当前权威状态」给（历史里没存这些）；
       · 本地推进时：用原始输入（含瞬时字段）。
     两者都调用共享块里的同一份 stepBody，所以和服务端逐字一致。 */
  function makeBouncePred(S, row) {
    var pred = null;

    /* 一帧：把道具状态塞进 body 的副本再算（stepBody 读 b.ox/b.oy、sp 走参数） */
    function run(b, ix, iy) {
      PHYS.stepBody(b, { x: ix, y: iy, sp: b.sp || 1 }, (S.g.mp && S.g.mp.o) || []);
    }

    pred = new PRED.Pred({
      key: S.you,
      x: row[1], y: row[2],
      vx: 0, vy: 0,                 /* 快照不带速度：从静止起算，靠重放/预测补回来 */
      hp: row[3],
      conv: 12,                     /* 收敛慢一点：被撞飞的位移是渐进的，别硬拽 */
      hard: 320,                    /* 撞飞位移经常 >260，放宽后才不会「瞬移贴合」 */
      idle: function () { return { x: 0, y: 0 }; },
      step: function (b, inp) { run(b, (inp && inp.x) || 0, (inp && inp.y) || 0); },
      snap: function (st) { return { x: st.x, y: st.y }; },
      apply: function (b, s) { b.x = s.x; b.y = s.y; }
    });
    return pred;
  }

  K.register('bounce', {
    aspect: 1000 / 640,
    howTo: '<b>WASD / 方向键 / 左摇杆</b> 推车（往哪推就往哪走，松手会滑一小段）<br>'
      + '撞到对手掉血，撞得越狠掉得越多 —— <b>空格 / 冲刺按钮</b> 冲刺，冲刺中撞人伤害 ×1.6<br>'
      + '场上 ◈护盾 ≫加速 ✦重击 + 治疗 四个道具，开过去就吃<br>'
      + '血空了出局，最后一个活着的赢；180 秒没打完按血量排名',
    keys: ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '],
    buttons: [{ label: '冲刺', onPress: function (S) { S.net.action('dash'); } }],
    init: function (S) { S.g = { b: [], ev: [], mp: null, fl: [], shake: 0, pred: null }; },
    onSnap: function (S, d) {
      if (d.mp) S.g.mp = d.mp;
      if (d.pu) S.g.puList = d.pu;
      S.g.b = K.slide(S.g.b, d.b || [], 1, 2, 0);
      /* ---- 客户端预测：把自己的车摆回权威位置，再重放服务端还没处理的输入 ---- */
      var mine = bodyOf(S, S.g.b, S.you);
      if (mine) {
        if (!S.g.pred && PRED && PHYS) S.g.pred = makeBouncePred(S, mine);
        if (S.g.pred) {
          /* _ax/_ay 是 KIT.slide 存下的服务端真值，mine[1]/mine[2] 已是插值起点 */
          var st = { x: mine._ax != null ? mine._ax : mine[1], y: mine._ay != null ? mine._ay : mine[2] };
          /* 被淘汰 / 复活：本地状态直接以服务端为准，不重放 */
          if (!mine[6] || S.g.pred.body.hp <= 0) S.g.pred.resync(st);
          else           S.g.pred.onSnap(ackOf(d, S.you), st);
          S.g.pred.body.hp = mine[3];
          S.g.pred.body.sp = mine[11] || 1;      /* 加速倍率：本地推进与重放共用 */
        }
      }
      (d.ev || []).forEach(function (e) {
        if (e.e === 'hit') {
          float(S, e.x, e.y, '-' + e.dmg, '#fff3d0', 18);
          if (e.by && (e.by[0] === S.you || e.by[1] === S.you)) S.g.shake = Math.min(12, S.g.shake + 8);
        } else if (e.e === 'out') {
          float(S, e.x, e.y, nameOf(S, e.id) + ' 出局', '#ff9f9f', 16);
        } else if (e.e === 'pick') {
          float(S, e.x, e.y, BOUNCE_PICK[e.k] ? BOUNCE_PICK[e.k].name : '道具', BOUNCE_PICK[e.k] ? BOUNCE_PICK[e.k].color : '#fff', 16);
        } else if (e.e === 'dash') {
          float(S, e.x, e.y, '冲刺', '#ffd166', 17);
        }
      });
      S.g.ev = S.g.ev.concat(d.ev || []).slice(-24);
    },
    onKey: function (S, k) { if (k === ' ') S.net.action('dash'); },
    sendInput: function (S, net) {
      var ax = S.axis.x, ay = S.axis.y;
      if (Math.abs(ax) < 0.15 && Math.abs(ay) < 0.15) { ax = 0; ay = 0; }
      /* ---- 客户端预测：先本地推进一帧（跟手），再带上 seq 上行 ---- */
      var p = S.g.pred;
      if (p) {
        p.correct(S.dt);
        p.tick(S.dt);
      }
      if (p) net.input({ x: ax, y: ay, seq: p.send({ x: ax, y: ay }) });
      else net.input({ x: ax, y: ay });
    },
    draw: function (S) {
      var c = S.draw;
      fit(S, 1000, 640);
      /* 被撞时轻微震屏（必须放在 fit 之后：fit 会重设变换矩阵） */
      var shk = S.g.shake;
      if (shk > 0.2) {
        var a = Math.random() * 6.283;
        c.translate(Math.cos(a) * shk, Math.sin(a) * shk);
        S.g.shake = shk * 0.86;
      } else S.g.shake = 0;

      /* 场地 */
      var g = c.createLinearGradient(0, 0, 0, 640);
      g.addColorStop(0, '#1b1630');
      g.addColorStop(1, '#0d0a18');
      c.fillStyle = g;
      rr(c, 0, 0, 1000, 640, 28);
      c.fill();
      c.strokeStyle = 'rgba(255,214,170,.18)';
      c.lineWidth = 3;
      c.stroke();
      /* 网格 */
      c.strokeStyle = 'rgba(255,255,255,.045)';
      c.lineWidth = 1;
      for (var x = 50; x < 1000; x += 50) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 640); c.stroke(); }
      for (var y = 40; y < 640; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(1000, y); c.stroke(); }

      /* 地形（首帧由服务端下发） */
      var mp = S.g.mp;
      if (mp && mp.o) {
        mp.o.forEach(function (o) {
          if (o.t === 'c') {
            var rg = c.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.35, 4, o.x, o.y, o.r);
            rg.addColorStop(0, '#4a4270');
            rg.addColorStop(1, '#2a2445');
            c.fillStyle = rg;
            c.beginPath(); c.arc(o.x, o.y, o.r, 0, 6.284); c.fill();
            c.strokeStyle = 'rgba(255,214,170,.22)';
            c.lineWidth = 3;
            c.stroke();
            c.strokeStyle = 'rgba(255,255,255,.08)';
            c.lineWidth = 6;
            c.beginPath(); c.arc(o.x, o.y, o.r - 8, -2.4, -0.9); c.stroke();
          } else {
            c.fillStyle = '#2a2445';
            rr(c, o.x, o.y, o.w, o.h, 10); c.fill();
            c.strokeStyle = 'rgba(255,214,170,.22)';
            c.lineWidth = 3; c.stroke();
            c.fillStyle = 'rgba(255,255,255,.07)';
            rr(c, o.x + 5, o.y + 5, o.w - 10, Math.max(4, o.h * 0.3), 6); c.fill();
          }
        });
      }

      /* 道具 */
      if (S.g.puList) {
        S.g.puList.forEach(function (p) {
          var info = BOUNCE_PICK[p[2]] || BOUNCE_PICK[0];
          var bob = Math.sin(S.t * 3 + p[0] * 0.02) * 4;
          c.save();
          c.translate(p[0], p[1] + bob);
          c.rotate(Math.sin(S.t * 1.6 + p[1] * 0.01) * 0.18);
          c.shadowColor = info.color;
          c.shadowBlur = 14;
          c.fillStyle = 'rgba(12,10,22,.9)';
          rr(c, -17, -17, 34, 34, 10); c.fill();
          c.shadowBlur = 0;
          c.strokeStyle = info.color;
          c.lineWidth = 2.5;
          c.stroke();
          c.fillStyle = info.color;
          c.font = '700 19px system-ui,sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(info.glyph, 0, 1);
          c.textBaseline = 'alphabetic';
          c.restore();
        });
      }

      var pv = S.g.pred;
      S.g.b.forEach(function (b) {
        var col = seatColor(S, b[0]);
        /* 自己那辆车用预测坐标画（跟手）；别人的车走插值后的快照 */
        var px = b[1], py = b[2];
        if (pv && pv.ready && b[0] === S.you) { px = pv.drawX(); py = pv.drawY(); }
        /* 存活位是 5，不是 6 —— 6 是「冲刺剩余冷却」。
           早先写成 b[6]，冷却一归零（开局就是 0）全场就被判成出局：
           车被画成灰叉、记分条写「出局」，但血条和碰撞都还是活的。 */
        if (!b[5]) {
          c.globalAlpha = 0.18;
          c.fillStyle = col;
          c.beginPath(); c.arc(px, py, 24, 0, 6.284); c.fill();
          c.globalAlpha = 1;
          c.strokeStyle = col;
          c.globalAlpha = 0.3;
          c.beginPath();
          c.moveTo(px - 9, py - 9); c.lineTo(px + 9, py + 9);
          c.moveTo(px + 9, py - 9); c.lineTo(px - 9, py + 9);
          c.stroke();
          c.globalAlpha = 1;
          return;
        }
        /* 加速 / 重击的尾迹 */
        var sp = Math.hypot(b[4], b[5]);
        if (sp > 80) {
          c.strokeStyle = b[11] ? '#fff6d8' : col;
          c.globalAlpha = Math.min(0.65, sp / 900);
          c.lineWidth = b[11] ? 10 : 6;
          c.lineCap = 'round';
          c.beginPath(); c.moveTo(px, py); c.lineTo(px - b[4] * 0.055, py - b[5] * 0.055); c.stroke();
          c.globalAlpha = 1;
        }
        /* 重击光环 */
        if (b[10] > 0) {
          var pg = c.createRadialGradient(px, py, 18, px, py, 44);
          pg.addColorStop(0, 'rgba(255,122,122,.35)');
          pg.addColorStop(1, 'rgba(255,122,122,0)');
          c.fillStyle = pg;
          c.beginPath(); c.arc(px, py, 44, 0, 6.284); c.fill();
        }
        /* 影子 */
        c.fillStyle = 'rgba(0,0,0,.35)';
        c.beginPath(); c.ellipse(px, py + 6, 24, 20, 0, 0, 6.284); c.fill();
        /* 车身 */
        c.fillStyle = col;
        c.beginPath(); c.arc(px, py, 24, 0, 6.284); c.fill();
        /* 高光 */
        c.fillStyle = 'rgba(255,255,255,.45)';
        c.beginPath(); c.arc(px - 8, py - 9, 7, 0, 6.284); c.fill();
        /* 车头小三角，方便看朝向 */
        var av = Math.atan2(b[5], b[4]);
        if (sp > 40) {
          c.fillStyle = 'rgba(255,255,255,.75)';
          c.beginPath();
          c.moveTo(px + Math.cos(av) * 24, py + Math.sin(av) * 24);
          c.lineTo(px + Math.cos(av + 2.5) * 16, py + Math.sin(av + 2.5) * 16);
          c.lineTo(px + Math.cos(av - 2.5) * 16, py + Math.sin(av - 2.5) * 16);
          c.closePath(); c.fill();
        }
        /* 护盾 */
        if (b[8] > 0) {
          c.strokeStyle = 'rgba(255,214,102,' + (0.45 + Math.sin(S.t * 6) * 0.2) + ')';
          c.lineWidth = 3;
          c.beginPath(); c.arc(px, py, 33, 0, 6.284); c.stroke();
        }
        /* 加速标记 */
        if (b[9] > 0) {
          c.fillStyle = '#7ec8ff';
          c.font = '700 11px system-ui,sans-serif';
          c.textAlign = 'center';
          c.fillText('≫', px + 30, py - 24);
        }
        /* 冲刺冷却环（自己的车才有） */
        if (b[0] === S.you) {
          var ready = 1 - Math.min(1, b[7] / 3.2);
          c.strokeStyle = ready >= 1 ? 'rgba(255,214,102,.32)' : 'rgba(255,255,255,.28)';
          c.lineWidth = 3;
          c.beginPath();
          c.arc(px, py, 29, -1.57, -1.57 + 6.284 * ready);
          c.stroke();
        }
        /* 血条 */
        var hp = b[3] / 100;
        c.fillStyle = 'rgba(0,0,0,.55)';
        rr(c, px - 26, py - 40, 52, 7, 3.5); c.fill();
        c.fillStyle = hp > 0.5 ? '#8ff0b5' : hp > 0.25 ? '#ffd166' : '#ff7a7a';
        rr(c, px - 26, py - 40, 52 * Math.max(0, hp), 7, 3.5); c.fill();
        /* 名字 */
        c.fillStyle = 'rgba(255,255,255,.85)';
        c.font = '600 13px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillText(nameOf(S, b[0]), px, py + 44);
      });

      drawFloats(S);
    },
    scoreRows: function (S) {
      return S.g.b.map(function (b) {
        /* 状态位：7 冲刺冷却 / 8 护盾 / 9 加速 / 10 重击 */
        var extra = b[8] > 0 ? ' ◈' : '';
        extra += b[10] > 0 ? ' ✦' : '';
        extra += b[9] > 0 ? ' ≫' : '';
        return { id: b[0], name: nameOf(S, b[0]), color: seatColor(S, b[0]), text: (b[5] ? b[3] + ' HP' + extra : '出局') };
      });
    }
  });

  /* ============================================================
   * 泡泡堂
   * ============================================================ */
})(typeof window !== 'undefined' ? window : globalThis);
