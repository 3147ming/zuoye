/* ============================================================
 * js/party/games.js —— 6 个联机玩法的客户端渲染
 * ------------------------------------------------------------
 * 约定：服务端算一切，客户端只负责「把快照画好看」。
 * 每个游戏暴露：
 *   aspect   逻辑宽高比
 *   init(S)  初始化本地容器
 *   sendInput / buttons  上行输入
 *   draw(S)  每帧绘制
 *   scoreRows(S)  顶部记分条
 * 位图与文字全用 canvas 画，不额外拉图片，弱网也能秒开。
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
  K.register('quiz', {
    aspect: 16 / 10,
    howTo: '<b>鼠标点选项</b>，或按 <b>1 / 2 / 3 / 4</b> 选第几个答案<br>'
      + '答对 <b>+100 分</b>，抢得越早分越高；<b>连续答对</b>每题再加 15（最多 +45）<br>'
      + '<b>答错扣 20 分</b>且这题不能再答；一局 10 题，总分最高者赢',
    keys: ['1', '2', '3', '4'],
    init: function (S) {
      S.g = { q: null, a: [], ph: 'intro', i: 0, n: 10, left: 0, sc: [], ans: [], k: -1, chosen: -1, cat: '', cb: {}, hit: {}, fb: null };
      buildQuizDom(S);
    },
    onKey: function (S, k) {
      var idx = ['1', '2', '3', '4'].indexOf(k);
      if (idx >= 0) answer(S, idx);
    },
    sendInput: function () { /* 抢答没有持续输入 */ },
    onSnap: function (S, d) {
      var g = S.g;
      if (d.ph === 'question' && g.ph !== 'question') { g.chosen = -1; g.fb = null; }
      g.ph = d.ph; g.i = d.i; g.n = d.n; g.left = d.left; g.sc = d.sc || []; g.ans = d.ans || [];
      g.cat = d.cat || '';
      if (d.cb) { g.cb = {}; d.cb.forEach(function (x) { g.cb[x[0]] = x[1]; }); }
      if (d.q) { g.q = d.q.q || ''; g.a = d.q.a || []; }
      if (typeof d.k === 'number') g.k = d.k;
      /* 自己已答则锁定按钮 */
      var mine = g.ans.filter(function (x) { return x[0] === S.you; })[0];
      g.chosen = mine ? mine[1] : -1;
      paintQuiz(S);
      /* 顺序要紧：paintQuiz 会把反馈条重写成「已选 X · 等其他人作答…」，
         事件必须放在它之后处理，否则「答对了 +100」立刻被盖掉 —— 
         实测现象就是答对了、分数也涨到 100，但反馈条还写着「等其他人」。 */
      (d.ev || []).forEach(function (e) { quizEvent(S, e); });
    },
    draw: function () { /* 抢答用 DOM，不画 canvas */ },
    scoreRows: function (S) {
      return (S.g.sc || []).map(function (x) {
        var streak = (S.g.cb || {})[x[0]] || 0;
        return {
          id: x[0], name: nameOf(S, x[0]), color: seatColor(S, x[0]),
          text: x[1] + ' 分' + (streak > 1 ? ' · 连对 ' + streak : '')
        };
      }).sort(function (a, b) { return parseInt(b.text) - parseInt(a.text); });
    }
  });

  function answer(S, idx) {
    var g = S.g;
    if (g.ph !== 'question' || g.chosen >= 0) return;
    if (idx >= (g.a || []).length) return;
    g.chosen = idx;
    S.net.action('answer', { k: idx });
    paintQuiz(S);
  }

  /* 服务端判定结果即时回话，不用等 7 秒揭晓。
     注意：抢答赛的事件是塞在快照的 ev 里下发的（server/games/quiz.js 只往
     events 里 push，没有单独发 event 包），所以只能从 onSnap 里消费 ——
     挂在 onEvent 上永远收不到，玩家就只能看着「已选 A」干等。 */
  function quizEvent(S, d) {
    if (!d || !S.g) return;
    var g = S.g;
    if (d.e === 'right') {
      if (d.id === S.you) {
        g.fb = { k: 'ok', t: '答对了 +' + d.gain + (d.bonus ? ' 分 · 连对 ' + d.streak + ' 题再 +' + d.bonus : ' 分') };
      } else {
        g.fb = { k: 'wait', t: nameOf(S, d.id) + ' 抢先答对了（答案 ' + String.fromCharCode(65 + d.k) + '）' };
      }
    } else if (d.e === 'wrong' && d.id === S.you) {
      g.fb = { k: 'bad', t: '答错了 -20 分，这题不能再答' };
    }
  }

  function buildQuizDom(S) {
    var host = S.canvasWrap || document.querySelector('.pk-canvas-wrap');
    if (!host) return;
    var box = document.createElement('div');
    box.className = 'qz';
    box.innerHTML =
      '<div class="qz-top"><span class="qz-idx">准备中</span><span class="qz-cat"></span><span class="qz-timer"><i></i></span></div>' +
      '<div class="qz-q">等房主开局…</div>' +
      '<div class="qz-opts"></div>' +
      '<div class="qz-fb"></div>' +
      '<div class="qz-tip">按 1 / 2 / 3 / 4 或直接点选项</div>';
    host.insertBefore(box, host.firstChild);
    S.g.dom = box;
    var opts = box.querySelector('.qz-opts');
    for (var i = 0; i < 4; i++) {
      (function (idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'qz-opt';
        b.onclick = function () { answer(S, idx); };
        opts.appendChild(b);
      })(i);
    }
    /* 抢答不需要 canvas：连容器一起收起来，让 DOM 面板吃掉整块高度 */
    var canvas = host.querySelector('canvas');
    if (canvas) canvas.style.display = 'none';
    host.classList.add('pk-quiz');
    box.style.position = 'static';
    box.style.inset = 'auto';
    box.querySelector('.qz-tip').textContent = '按 1 / 2 / 3 / 4 或直接点选项 · 答得越快分越高 · 连对再加分';
    /* 抢答不需要摇杆 */
    var touch = host.querySelector('.pk-touch');
    if (touch) touch.style.display = 'none';
  }

  function paintQuiz(S) {
    var g = S.g, box = g.dom;
    if (!box) return;
    var idxEl = box.querySelector('.qz-idx');
    var catEl = box.querySelector('.qz-cat');
    var qEl = box.querySelector('.qz-q');
    var opts = box.querySelectorAll('.qz-opt');
    var timer = box.querySelector('.qz-timer i');
    idxEl.textContent = g.i >= 0 ? ('第 ' + (g.i + 1) + ' / ' + g.n + ' 题') : '准备中';
    catEl.textContent = g.cat || '';
    catEl.style.display = g.cat ? '' : 'none';
    timer.style.width = Math.max(0, Math.min(100, (g.left / 7) * 100)) + '%';
    box.classList.toggle('reveal', g.ph === 'reveal');
    if (!g.q) { qEl.textContent = '等下一题…'; return; }
    qEl.textContent = g.q;
    var count = (g.a || []).length || 4;
    for (var i = 0; i < 4; i++) {
      var b = opts[i];
      if (!b) continue;
      if (i >= count) { b.style.display = 'none'; continue; }
      b.style.display = '';
      b.textContent = String.fromCharCode(65 + i) + '. ' + (g.a[i] || '');
      b.className = 'qz-opt';
      if (g.ph === 'reveal') {
        if (i === g.k) b.classList.add('right');
        else if (i === g.chosen) b.classList.add('wrong');
      } else if (i === g.chosen) {
        b.classList.add('picked');
      }
    }
    /* 即时反馈条完全由 S.g.fb 驱动。
       为什么不能只在事件里写一次：paintQuiz 每收到一帧快照（30Hz）就会重跑，
       事件写进去的那句「答对了 +100」会在 33ms 内被重绘覆盖掉，玩家根本看不到。
       所以把「要说什么」存进 S.g.fb，由这里每帧照它渲染。 */
    var fb = box.querySelector('.qz-fb');
    if (fb) {
      var mine = null;
      for (var j = 0; j < (g.ans || []).length; j++) if (g.ans[j][0] === S.you) { mine = g.ans[j]; break; }
      if (g.ph === 'reveal' && g.k >= 0) {
        if (mine && mine[1] === g.k) { fb.className = 'qz-fb ok'; fb.textContent = '答对了！正确答案就是 ' + String.fromCharCode(65 + g.k); }
        else if (mine) { fb.className = 'qz-fb bad'; fb.textContent = '答错了，正确答案是 ' + String.fromCharCode(65 + g.k); }
        else { fb.className = 'qz-fb'; fb.textContent = '这题没作答 · 正确答案是 ' + String.fromCharCode(65 + g.k); }
      } else if (g.fb && g.fb.t) {
        fb.className = 'qz-fb ' + (g.fb.k || '');
        fb.textContent = g.fb.t;
      } else if (mine) {
        fb.className = 'qz-fb wait';
        fb.textContent = '已选 ' + String.fromCharCode(65 + mine[1]) + ' · 等其他人作答…';
      } else {
        fb.className = 'qz-fb';
        fb.textContent = '';
      }
    }
  }

  /* ============================================================
   * 你画我猜
   * ------------------------------------------------------------
   * 画板用一张离屏 canvas 累积笔画（服务端只发增量点），
   * 主 canvas 每帧把离屏图贴上去，60fps 画几千个点也不掉帧。
   * ============================================================ */
  var DW_W = 1000, DW_H = 640;
  var DW_COLORS = ['#2b2440', '#ff5d5d', '#2f7cf6', '#f5b301', '#2fbf71', '#a259ff', '#8b5a2b', '#fdfaf3'];
  var DW_WIDTHS = [3, 6, 11, 18];

  K.register('draw', {
    aspect: DW_W / DW_H,
    howTo: '轮到你画：屏幕下方是调色板和笔宽，<b>按住拖动</b> 画，把词画出来<br>'
      + '轮到别人画：在底部输入框 <b>打字猜</b>，回车提交，猜对得分<br>'
      + '谁先猜对谁分高，画的人也会按猜中人数加分；<b>词本身不能写出来</b>',
    reserve: 130,          /* 顶部提示条 + 底部猜词框，画布要让开 */
    reserveFor: function (S) { return S.g && S.g.isDrawer ? 128 : 130; },
    keys: [],
    init: function (S) {
      S.g = {
        ph: 'intro', dr: '', tl: 0, tot: 70, mk: '', wd: '', no: 0,
        sc: [], gd: [], gw: [], word: '', cat: '', isDrawer: false,
        color: 0, width: 1, applied: 0, needAt: 0, dash: null, fl: []
      };
      buildDrawBoard(S);
      buildDrawUi(S);
    },
    onStart: function (S) {
      /* 新一局：清板并重新要一次全量 */
      resetBoard(S, true);
    },
    onEvent: function (S, d) {
      if (!d) return;
      if (d.e === 'word') {
        S.g.word = d.w || '';
        S.g.cat = d.c || '';
        paintDraw(S);
      } else if (d.e === 'turn') {
        S.g.word = '';
        S.g.isDrawer = (d.dr === S.you);
        S.g.applied = 0;
        S.g.no = 0;
        resetBoard(S, false);
        if (S.g.isDrawer) S.net.action('needword', {});
        paintDraw(S);
      }
    },
    onSnap: function (S, d) {
      var g = S.g;
      if (d.full) {
        resetBoard(S, false);
        applyOps(S, d.ds || []);
        /* 全量之后把计数顶到很高，避免因为服务端裁剪旧增量而反复要全量 */
        g.applied = 1e9;
        return;
      }
      g.ph = d.ph || g.ph;
      /* 换画者：把上一轮的词清掉，避免下一个画者看到别人的答案 */
      if (d.dr && d.dr !== g.dr) { g.dr = d.dr; g.word = ''; }
      g.dr = d.dr || g.dr;
      g.tl = d.tl || 0;
      g.tot = d.tot || 70;
      g.sc = d.sc || [];
      g.gd = d.gd || [];
      g.gw = d.gw || [];
      if (typeof d.mk === 'string') g.mk = d.mk;
      if (d.wd) g.wd = d.wd;
      g.isDrawer = (g.dr === S.you);
      if (d.ti) g.ti = d.ti;
      if (d.tn) g.tn = d.tn;
      /* 开局那一下 START 先到、词事件可能比渲染早，落到这里补一次 */
      if (g.isDrawer && !g.word && g.ph === 'drawing' && S.t > (g.wordAt || 0)) {
        g.wordAt = S.t + 1.2;
        S.net.action('needword', {});
      }
      if (d.ds) { applyOps(S, d.ds); g.applied += d.ds.length; }
      /* 增量对不上（中途进来 / 丢过包）：要一次全量 */
      if (typeof d.no === 'number' && d.no > g.applied && S.t > g.needAt) {
        g.needAt = S.t + 2;
        S.net.action('redraw', {});
      }
      paintDraw(S);
    },
    sendInput: function () { /* 画板用一次性动作，不用持续输入 */ },
    draw: function (S) {
      var c = S.draw;
      fit(S, DW_W, DW_H);
      var g = S.g;
      /* 纸面 */
      c.fillStyle = '#fdfaf3';
      rr(c, 0, 0, DW_W, DW_H, 18);
      c.fill();
      /* 淡网格，方便构图 */
      c.strokeStyle = 'rgba(43,36,64,.05)';
      c.lineWidth = 1;
      for (var x = 50; x < DW_W; x += 50) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, DW_H); c.stroke(); }
      for (var y = 50; y < DW_H; y += 50) { c.beginPath(); c.moveTo(0, y); c.lineTo(DW_W, y); c.stroke(); }
      if (g.board) {
        c.drawImage(g.board, 0, 0, DW_W * DW_PIX, DW_H * DW_PIX, 0, 0, DW_W, DW_H);
      }
      c.strokeStyle = 'rgba(43,36,64,.16)';
      c.lineWidth = 2;
      rr(c, 1, 1, DW_W - 2, DW_H - 2, 18);
      c.stroke();
      /* 低头提示 */
      if (g.ph === 'intro') {
        c.fillStyle = 'rgba(43,36,64,.35)';
        c.font = '600 26px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillText('准备开始 · 第 ' + (g.ti || 1) + ' / ' + (g.tn || 1) + ' 轮', DW_W / 2, DW_H / 2);
      }
      drawFloats(S);
    },
    scoreRows: function (S) {
      return (S.g.sc || []).map(function (x) {
        var solved = (S.g.gd || []).indexOf(x[0]) >= 0;
        return { id: x[0], name: nameOf(S, x[0]), color: seatColor(S, x[0]), text: x[1] + ' 分' + (solved ? ' ✓' : '') };
      }).sort(function (a, b) { return parseInt(b.text) - parseInt(a.text); });
    }
  });
  /* ============================================================
   * 球场 2v2（第七个联机玩法）
   * ------------------------------------------------------------
   * 这是第一个「全流程客户端预测」的玩法：
   *   · 跑动：本地每帧预测（Pred），快照到达后摆回 + 重放；
   *   · 球：也用 Pred 组件预测，但它的「输入」是本帧所有球员的位置——
   *     球在物理上就是被人的位置推着走的，所以它的可预测性和人一样好；
   *   · 射门：本地立即生效（球飞出去 + 脚上冒火光），服务端回头确认。
   * 唯一「等服务端」的是进球与比分——因为那需要知道全场所有人的位置，
   * 而进球后本来就有 2.4 秒的重摆停顿，等一趟 RTT 根本看不出来。
   * ============================================================ */
  var PITCH_FALLBACK_GEO = {
    w: 1040, h: 620,
    goalY0: (620 - 210) / 2, goalY1: (620 + 210) / 2, goalD: 26, boxW: 150, boxH: 330
  };
  var PITCH_FALLBACK_C = {
    w: 1040, h: 620, PR: 34, R: 21, BR: 15,
    ACC: 1750, FRICTION: 2.6, MAX_SPD: 360,
    BALL_FR: 0.9, BALL_MAX: 1250,
    KICK: 780, KICK_R: 70, KICK_CD: 0.42,
    PUSH: 1.12, PUSH_MIN: 24, GOAL_W: 210, GOAL_D: 26, WALL: 0.82
  };
  var PITCH_WALL_X = 120;        /* 与服务端 WALL_X 一致：不许站进球门 */

  K.register('pitch', {
    aspect: 1040 / 620,
    howTo: '<b>WASD / 方向键 / 左摇杆</b> 跑位，<b>空格 / 射门按钮</b> 射门<br>'
      + '射门要<b>球在脚边</b>（太远按空格只会有提示），离球越近越好控<br>'
      + '2v2：进球多的队赢；记分条显示你是「我的队」还是「对手」',
    keys: ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '],
    buttons: [{ label: '射门', onPress: function (S) { pitchKick(S); } }],

    init: function (S) {
      S.g = {
        pl: [],         /* 插值后的球员（服务端权威） */
        ba: null,       /* 插值后的球 */
        sc: [0, 0], ps: 0,
        md: null,       /* 场地元信息 { id,name,geo,C } */
        geo: PITCH_FALLBACK_GEO, C: PITCH_FALLBACK_C,
        fl: [], shake: 0, kickAt: -9, side: 0, human: null,
        pPred: null, bPred: null, flash: 0, flashAt: 0,
        readyOnce: false, scoredOnce: false     /* scoredOnce：进过球没有，用来区分「准备开球 / 重新开球」 */
      };
    },

    onSnap: function (S, d) {
      var g = S.g;
      if (d.md) {
        g.md = d.md;
        if (d.md.geo) g.geo = d.md.geo;
        if (d.md.C) {
          /* 服务端下发的参数表是权威的；缺字段补默认值，防止老服务端把新客户端算崩 */
          g.C = {};
          for (var k in PITCH_FALLBACK_C) g.C[k] = d.md.C[k] != null ? d.md.C[k] : PITCH_FALLBACK_C[k];
        }
      }
      g.pl = K.slide(g.pl, d.pl || [], 1, 2, 0);
      if (d.ba) {
        /* 球的插值必须是「对象数组」，喂进去的每一行都要自带 x/y：
           直接塞裸坐标 [x, y] 会让 KIT.slide 读 row[1]/row[2] 拿到 undefined，
           插完变成 [520, 310, null]，球就再也不动了。这里转成 {x,y} 数组。
           目标点 = 服务端权威位置 + 半个快照间隔的速度外推（ba[2]/ba[3] 是球速）：
           30Hz 快照下人眼看到的是「一格一格」的坐标，外推 30ms 后视觉上连续，
           球不会看起来总慢半拍。外推只影响显示，不参与判定。 */
        var look = 0.03;
        var ex = (d.ba[2] || 0) * look, ey = (d.ba[3] || 0) * look;
        var one = K.slide(g.ba ? [g.ba] : [], [{ x: d.ba[0] + ex, y: d.ba[1] + ey }], 1, 2, 0);
        if (one && one[0]) g.ba = one[0];
        else g.ba = { x: d.ba[0], y: d.ba[1] };
      }
      if (d.sc) g.sc = d.sc;
      g.ps = d.ps || 0;

      /* ---- 自己 + 球 ---- */
      var mine = bodyOf(S, g.pl, S.you);
      if (mine && PRED && PHYS) {
        g.side = mine[4];
        if (!g.pPred) g.pPred = makePitchPlayerPred(S, mine);
        if (!g.bPred) g.bPred = makePitchBallPred(S, g.ba);
        var st = {
          x: mine._ax != null ? mine._ax : mine[1],
          y: mine._ay != null ? mine._ay : mine[2],
          a: mine[3]
        };
        if (g.ps > 0 || !g.readyOnce) {
          /* 重摆停顿 / 首帧：这期间没人能动，直接以服务端为准 */
          g.pPred.resync(st);
          if (g.bPred && g.ba) g.bPred.resync({ x: g.ba.x, y: g.ba.y });
          g.human = { x: st.x, y: st.y, vx: 0, vy: 0, a: st.a };
          g.readyOnce = true;
        } else {
          g.pPred.onSnap(ackOf(d, S.you), st);
        }
        g.pPred.body.cd = mine[5] || 0;
      }

      (d.ev || []).forEach(function (e) {
        if (e.e === 'goal') {
          var mySide = g.side === 0 ? 'L' : 'R';
          var own = e.side === mySide;    /* 球进的是自己这边 = 被进球 */
          float(S, e.x, e.y, own ? '被进球…' : '进球！', own ? '#ff9f9f' : '#8ff0b5', 30);
          g.flash = own ? -1 : 1;
          g.flashAt = S.t;
          g.shake = 10;
          g.readyOnce = false;
          g.scoredOnce = true;
        } else if (e.e === 'kick') {
          float(S, e.x, e.y, '射门', '#ffd166', 15);
          if (e.id === S.you) g.kickAt = S.t;
        } else if (e.e === 'go') {
          float(S, e.x, e.y, '开球', '#7ee0c0', 22);
          g.flash = 0;
        }
      });
    },

    onKey: function (S, k) { if (k === ' ') pitchKick(S); },


    sendInput: function (S, net) {
      var g = S.g;
      var ax = S.axis.x, ay = S.axis.y;
      if (Math.abs(ax) < 0.15 && Math.abs(ay) < 0.15) { ax = 0; ay = 0; }
      var dt = S.dt || 1 / 60;
      var p = g.pPred;
      if (!p) { net.input({ x: ax, y: ay }); return; }

      /* 1. 自己先动（跟手），再让球被自己推一下——顺序与服务端 step() 一致 */
      p.correct(dt);
      p.tick(dt);
      g.human = { x: p.body.x, y: p.body.y, vx: p.body.vx, vy: p.body.vy, a: p.body.a };

      /* 2. 球的预测：用「本地自己 + 插值后的别人」当输入 */
      if (g.bPred) {
        g.bPred.correct(dt);
        g.bPred.tick(dt);
      }
      net.input({ x: ax, y: ay, seq: p.send({ x: ax, y: ay }) });
    },

    draw: function (S) {
      var c = S.draw, g = S.g;
      var geo = g.geo, C = g.C;
      fit(S, geo.w, geo.h);
      var shk = g.shake || 0;
      if (shk > 0.4) {
        c.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk);
        g.shake = shk * 0.85;
      } else g.shake = 0;

      drawPitchField(S, c, geo, C);
      drawPitchGoals(S, c, geo, C);
      drawPitchPlayers(S, c, geo, C);
      drawPitchBall(S, c, geo, C);
      drawPitchHUD(S, c, geo, C);
      drawFloats(S);
    },

    scoreRows: function (S) {
      var g = S.g;
      return (g.pl || []).map(function (p) {
        return {
          id: p[0], name: nameOf(S, p[0]), color: seatColor(S, p[0]),
          text: p[4] === (g.side || 0) ? '我的队' : '对手'
        };
      });
    }
  });

  /* ---------- 球场：预测器 ---------- */
  function makePitchPlayerPred(S, row) {
    var g = S.g;
    /* 球用哪个位置取决于当前是「本地推进」还是「重放历史」：
       本地推进时球也是本地预测的（跟手）；重放历史时球必须用插值快照，
       否则会拿「未来的球」去重放「过去的自己」，越算越偏。 */
    var replaying = false;
    function ballNow() {
      if (!replaying && g.bPred && g.bPred.ready) return g.bPred.body;
      return { x: (g.ba && g.ba.x) || g.geo.w / 2, y: (g.ba && g.ba.y) || g.geo.h / 2, vx: 0, vy: 0 };
    }
    function clampGoal(b) {
      var geo = g.geo, PR = g.C.PR;
      if (b.x < PITCH_WALL_X && b.y > geo.goalY0 - PR && b.y < geo.goalY1 + PR) b.x = PITCH_WALL_X;
      if (b.x > geo.w - PITCH_WALL_X && b.y > geo.goalY0 - PR && b.y < geo.goalY1 + PR) b.x = geo.w - PITCH_WALL_X;
    }
    var pred = new PRED.Pred({
      key: S.you,
      x: row[1], y: row[2], a: row[3],
      snap: function (st) { return { x: st.x, y: st.y, a: st.a }; },
      apply: function (b, s) { b.x = s.x; b.y = s.y; if (s.a != null) b.a = s.a; },
      idle: function () { return { x: 0, y: 0 }; },
      step: function (b, inp) {
        PHYS.stepPlayer(b, { x: (inp && inp.x) || 0, y: (inp && inp.y) || 0, sp: 1 }, ballNow(), 1 / 60, g.C);
        clampGoal(b);
      }
    });
    /* Pred.onSnap 里重放时用的就是 pred.step，这里打标记切换球的数据源 */
    var rawOnSnap = pred.onSnap.bind(pred);
    pred.onSnap = function (ack, st) {
      replaying = true;
      var r = rawOnSnap(ack, st);
      replaying = false;
      return r;
    };
    return pred;
  }

  function makePitchBallPred(S, ba) {
    var g = S.g;
    function others() {
      /* 除自己以外的球员：用插值快照的位置。
         他们的速度我们不知道，也不该猜（猜错就是「球自己长腿」）。 */
      var out = [];
      (g.pl || []).forEach(function (p) {
        if (p[0] === S.you) return;
        out.push({ x: p[1], y: p[2], vx: 0, vy: 0, a: p[3] });
      });
      return out;
    }
    return new PRED.Pred({
      key: '__ball__',
      x: (ba && ba[1]) || g.geo.w / 2,
      y: (ba && ba[2]) || g.geo.h / 2,
      vx: 0, vy: 0,
      conv: 26,                /* 球速快、误差涨得快，收敛要更积极 */
      hard: 320,
      snap: function (st) { return { x: st.x, y: st.y }; },
      apply: function (b, s) { b.x = s.x; b.y = s.y; },
      idle: function () { return null; },
      step: function (b) {
        var dt = 1 / 60, C = g.C;
        var list = others(), i;
        /* 1. 别人推球（只用位置） */
        for (i = 0; i < list.length; i++) PHYS.stepPlayer(list[i], { x: 0, y: 0, sp: 1 }, b, dt, C);
        /* 2. 自己推球：用本地预测出来的自己（含速度），跟手感全靠它 */
        if (g.human) {
          var h = { x: g.human.x, y: g.human.y, vx: g.human.vx, vy: g.human.vy, a: g.human.a };
          PHYS.stepPlayer(h, { x: 0, y: 0, sp: 1 }, b, dt, C);
        }
        /* 3. 球自己滚 */
        PHYS.stepBall(b, dt, g.geo, C);
      }
    });
  }

  /* 射门：本地立即反应（脚上火光 + 球被踢出去），服务端确认后播「射门」飘字 */
  function pitchKick(S) {
    var g = S.g;
    if (S.over) return;
    /* 球必须在脚边才起脚：KICK_R 是服务端判定半径（70），
       这里提前卡一道，免得「球在 200px 外按空格也能踢」的假手感。
       比 KICK_R 宽 10px，留给网络延迟下的位置误差。 */
    var dist = g.pPred && g.bPred
      ? Math.hypot(g.bPred.body.x - g.pPred.body.x, g.bPred.body.y - g.pPred.body.y)
      : 0;
    if (dist > (g.C.KICK_R || 70) + 10) {
      /* 球在死角时最常见的疑惑就是「按空格没反应」——直接把原因说出来 */
      var geo0 = g.geo, cd0 = Math.min(
        Math.hypot(g.ba.x, g.ba.y), Math.hypot(geo0.w - g.ba.x, g.ba.y),
        Math.hypot(g.ba.x, geo0.h - g.ba.y), Math.hypot(geo0.w - g.ba.x, geo0.h - g.ba.y)
      );
      var msg = cd0 < 120 ? '球在死角，往回拨' : '离球太远';
      if (S.t - (g.kickWarnAt || -9) > 0.5) {
        g.kickWarnAt = S.t;
        float(S, g.pPred.body.x, g.pPred.body.y - 30, msg, '#ffb0b0', 14);
      }
      return;
    }
    if (g.pPred && g.pPred.body.cd > 0.05) return;   /* 冷却中，别重复起脚 */

    /* 本地立刻把球踢出去，不等服务端确认。
       第一版只发了 net.action，等快照里的权威球速回来才位移：
       球在屏幕上要顿 50~150ms 才动，「按空格没反应」的错觉就是这么来的。
       服务端稍后会用同一条 kickBall 算出同样的球速，快照来了按常规校正收敛，
       所以这里多踢一次不会「踢两次球」。
       注意：预测器要「立即对齐服务端再用」，否则本地这一步是基于旧状态跑的。 */
    if (g.bPred && g.pPred) {
      var bp = g.bPred.body;
      /* 先按预测自己的权威态对齐一次（只对齐位置，速度由 step 里重算） */
      bp.x = g.ba.x; bp.y = g.ba.y;
      bp.vx = g.ba.vx || 0; bp.vy = g.ba.vy || 0;
      pitchDoKick(S);          /* 内部用 pPred.body 的真实朝向重算一次 */
    }
    S.net.action('kick');
    g.kickAt = S.t;
  }

  /* 本地射门要和服务端算得一样，唯一差别是「球可能不在正前方」。
     服务端按 p.a 抽射；这里如果球明显偏在侧面，就先把朝向拧到球门方向，
     让这一脚是「朝门抽」而不是「朝墙抽」——否则玩家会遇到
     「明明在门前按空格，球却飞出边线」。
     这个临时朝向只用于本地这一脚，下一帧会被 pPred.correct/tick 正常接管。 */
  function pitchDoKick(S) {
    var g = S.g;
    if (!g.pPred || !g.bPred) return;
    var b = g.pPred.body, ball = g.bPred.body;
    var dx = ball.x - b.x, dy = ball.y - b.y;
    if (Math.hypot(dx, dy) > 1) {
      var want = Math.atan2(dy, dx);
      var geo = g.geo;
      var goalX = g.side === 0 ? geo.w : 0;
      var goalY = (geo.goalY0 + geo.goalY1) / 2;
      /* 球在「球门方向」的前半区（点积 > 0）时，直接把朝向对到球门 */
      var gdx = goalX - b.x, gdy = goalY - b.y, gm = Math.hypot(gdx, gdy) || 1;
      if ((dx * gdx + dy * gdy) / gm > 0) want = Math.atan2(gdy, gdx);
      b.a = want;
    }
    PHYS.kickBall(b, ball, g.C);
  }

  /* ---------- 球场：绘制 ---------- */
  function drawPitchField(S, c, geo, C) {
    var g = S.g;
    var ice = g.md && g.md.id === 'ice';
    var W = geo.w, H = geo.h;

    var grd = c.createLinearGradient(0, 0, 0, H);
    if (ice) {
      grd.addColorStop(0, '#12243a');
      grd.addColorStop(1, '#0a1626');
    } else {
      /* 草地：原来只有 10 条 2.2% 白度的竖条，远看就是一整块墨绿，
         玩家反馈「分不清中线在哪、看不出人是在动还是画面卡了」。
         改成 12 条 5% 的草皮条 + 条间极淡的横向滚纹，静止时也有纵深。 */
      grd.addColorStop(0, '#1b4026');
      grd.addColorStop(1, '#0f2a19');
    }
    c.fillStyle = grd;
    rr(c, 0, 0, W, H, 22);
    c.fill();

    if (ice) {
      c.strokeStyle = 'rgba(160,220,255,.06)';
      c.lineWidth = 1;
      for (var ix = -H; ix < W; ix += 46) {
        c.beginPath(); c.moveTo(ix, 0); c.lineTo(ix + H * 0.45, H); c.stroke();
      }
    } else {
      var band = W / 12;
      for (var bi = 0; bi < 12; bi += 2) {
        c.fillStyle = 'rgba(255,255,255,.038)';
        c.fillRect(bi * band, 0, band, H);
      }
      /* 横向割草纹：极淡，只是让整块不「死」 */
      c.fillStyle = 'rgba(0,0,0,.05)';
      for (var ry = 0; ry < H; ry += 68) c.fillRect(0, ry, W, 34);
    }

    /* 中线 / 中圈 */
    c.strokeStyle = 'rgba(255,255,255,.16)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 92, 0, 6.284); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.18)';
    c.beginPath(); c.arc(W / 2, H / 2, 5, 0, 6.284); c.fill();

    /* 两侧禁区 */
    [0, 1].forEach(function (side) {
      var x0 = side ? W - geo.boxW : 0;
      c.strokeStyle = 'rgba(255,255,255,.12)';
      c.lineWidth = 2;
      c.beginPath();
      c.rect(x0, (H - geo.boxH) / 2, geo.boxW, geo.boxH);
      c.stroke();
    });

    /* 四角装饰 */
    c.strokeStyle = 'rgba(126,224,192,.32)';
    c.lineWidth = 3;
    var pad = 10, len = 26;
    [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]].forEach(function (q) {
      c.beginPath();
      c.moveTo(q[0] + q[2] * len, q[1]);
      c.lineTo(q[0], q[1]);
      c.lineTo(q[0], q[1] + q[3] * len);
      c.stroke();
    });
  }

  function drawPitchGoals(S, c, geo, C) {
    var W = geo.w;
    [[0, '#ff9f9f'], [1, '#a6dcff']].forEach(function (t) {
      var left = t[0] === 0;
      var y0 = geo.goalY0, y1 = geo.goalY1, d = geo.goalD;
      var x = left ? 0 : W - d;
      var grad = c.createLinearGradient(x, 0, x + d, 0);
      grad.addColorStop(0, left ? 'rgba(255,122,122,.30)' : 'rgba(126,200,255,.30)');
      grad.addColorStop(1, 'rgba(0,0,0,.10)');
      c.fillStyle = grad;
      c.fillRect(x, y0, d, y1 - y0);
      /* 网 */
      c.strokeStyle = 'rgba(255,255,255,.12)';
      c.lineWidth = 1;
      for (var yy = y0 + 16; yy < y1; yy += 18) {
        c.beginPath(); c.moveTo(x, yy); c.lineTo(x + d, yy); c.stroke();
      }
      /* 门柱 */
      c.strokeStyle = t[1];
      c.lineWidth = 5;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(left ? d : W - d, y0);
      c.lineTo(left ? 2 : W - 2, y0);
      c.lineTo(left ? 2 : W - 2, y1);
      c.lineTo(left ? d : W - d, y1);
      c.stroke();
    });
  }

  function drawPitchPlayers(S, c, geo, C) {
    var g = S.g;
    var R = C.R || 21;
    var meSide = g.side;

    (g.pl || []).forEach(function (p) {
      var isMe = p[0] === S.you;
      var side = p[4];
      var isMine = side === meSide;
      var col = side === 0 ? (isMine ? '#ff7a7a' : '#a3505a') : (isMine ? '#7ec8ff' : '#4d7898');
      var x = p[1], y = p[2], a = p[3];

      if (isMe && g.pPred && g.pPred.ready) {
        x = g.pPred.drawX(); y = g.pPred.drawY(); a = g.pPred.body.a;
      }

      /* 影子 */
      c.fillStyle = 'rgba(0,0,0,.34)';
      c.beginPath(); c.ellipse(x, y + 7, R * 1.05, R * 0.7, 0, 0, 6.284); c.fill();
      /* 身体 */
      c.fillStyle = col;
      c.beginPath(); c.arc(x, y, R, 0, 6.284); c.fill();
      c.fillStyle = 'rgba(255,255,255,.18)';
      c.beginPath(); c.arc(x, y, R * 0.66, 0, 6.284); c.fill();
      /* 朝向小三角 */
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.beginPath();
      c.moveTo(x + Math.cos(a) * (R + 8), y + Math.sin(a) * (R + 8));
      c.lineTo(x + Math.cos(a + 2.3) * (R - 4), y + Math.sin(a + 2.3) * (R - 4));
      c.lineTo(x + Math.cos(a - 2.3) * (R - 4), y + Math.sin(a - 2.3) * (R - 4));
      c.closePath(); c.fill();

      if (isMe) {
        c.strokeStyle = 'rgba(255,255,255,' + (0.5 + Math.sin(S.t * 5) * 0.2) + ')';
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(x, y, R + 6, 0, 6.284); c.stroke();
        /* 射门冷却环 */
        var cd = g.pPred ? (g.pPred.body.cd || 0) : 0;
        if (cd > 0) {
          var k = Math.min(1, cd / (C.KICK_CD || 0.42));
          c.strokeStyle = 'rgba(255,209,102,.65)';
          c.lineWidth = 3;
          c.beginPath(); c.arc(x, y, R + 11, -1.57, -1.57 + 6.284 * (1 - k)); c.stroke();
        }
      } else if (isMine) {
        c.strokeStyle = 'rgba(255,255,255,.22)';
        c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, R + 5, 0, 6.284); c.stroke();
      }

      c.fillStyle = isMine ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.58)';
      c.font = '600 13px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText(nameOf(S, p[0]), x, y + R + 20);
    });

    /* 本地射门的脚上火光 */
    var age = S.t - (g.kickAt || -9);
    if (age >= 0 && age < 0.26 && g.pPred) {
      var kk = age / 0.26;
      var kx = g.pPred.drawX(), ky = g.pPred.drawY(), ka = g.pPred.body.a;
      var fx = kx + Math.cos(ka) * 30, fy = ky + Math.sin(ka) * 30;
      c.globalAlpha = 1 - kk;
      var rg = c.createRadialGradient(fx, fy, 2, fx, fy, 40);
      rg.addColorStop(0, 'rgba(255,240,190,.95)');
      rg.addColorStop(0.5, 'rgba(255,200,90,.5)');
      rg.addColorStop(1, 'rgba(255,160,40,0)');
      c.fillStyle = rg;
      c.beginPath(); c.arc(fx, fy, 40, 0, 6.284); c.fill();
      c.globalAlpha = 1;
    }
  }

  function drawPitchBall(S, c, geo, C) {
    var g = S.g;
    var BR = C.BR || 15;
    var bx, by, vx = 0, vy = 0;
    if (g.bPred && g.bPred.ready) {
      bx = g.bPred.drawX();
      by = g.bPred.drawY();
      vx = g.bPred.body.vx; vy = g.bPred.body.vy;
    } else if (g.ba) {
      bx = g.ba.x; by = g.ba.y;
    } else {
      bx = geo.w / 2; by = geo.h / 2;
    }
    var spd = Math.hypot(vx, vy);
    /* 拖尾 */
    if (spd > 120) {
      c.strokeStyle = 'rgba(255,255,255,.26)';
      c.lineWidth = BR * 0.9;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx - vx * 0.045, by - vy * 0.045);
      c.stroke();
    }
    /* 影子 */
    c.fillStyle = 'rgba(0,0,0,.4)';
    c.beginPath(); c.ellipse(bx, by + 5, BR * 1.05, BR * 0.8, 0, 0, 6.284); c.fill();
    /* 球体 */
    var bg = c.createRadialGradient(bx - BR * 0.35, by - BR * 0.4, BR * 0.15, bx, by, BR);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(1, '#cfd8e6');
    c.fillStyle = bg;
    c.beginPath(); c.arc(bx, by, BR, 0, 6.284); c.fill();
    /* 花纹：随速度转 */
    c.fillStyle = 'rgba(44,56,74,.5)';
    var spin = S.t * (2 + Math.min(14, spd / 90));
    for (var i = 0; i < 5; i++) {
      var ang = spin + i * 1.2566;
      c.beginPath();
      c.arc(bx + Math.cos(ang) * BR * 0.5, by + Math.sin(ang) * BR * 0.5, BR * 0.22, 0, 6.284);
      c.fill();
    }
    c.strokeStyle = 'rgba(255,255,255,.7)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(bx, by, BR, 0, 6.284); c.stroke();
  }

  function drawPitchHUD(S, c, geo, C) {
    var g = S.g;
    var W = geo.w, H = geo.h;

    /* 比分板 */
    var bw = 260, bh = 54, bx = W / 2 - bw / 2, by = 18;
    c.fillStyle = 'rgba(8,12,20,.78)';
    rr(c, bx, by, bw, bh, 14); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.16)';
    c.lineWidth = 2; c.stroke();

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ff9f9f';
    c.font = '700 24px system-ui,sans-serif';
    c.fillText(String(g.sc[0]), bx + 66, by + bh / 2);
    c.fillStyle = '#a6dcff';
    c.fillText(String(g.sc[1]), bx + bw - 66, by + bh / 2);
    c.fillStyle = 'rgba(255,255,255,.5)';
    c.font = '600 16px system-ui,sans-serif';
    c.fillText(':', bx + bw / 2, by + bh / 2);

    /* 我在哪边 */
    var myLeft = g.side === 0;
    c.fillStyle = myLeft ? '#ff9f9f' : '#a6dcff';
    c.beginPath(); c.arc(bx + (myLeft ? 40 : bw - 40), by + bh / 2, 4, 0, 6.284); c.fill();
    c.textBaseline = 'alphabetic';

    /* 重摆倒计时：开局和进球后都会停 2.4 秒，这期间按方向键是没反应的，
       必须说出来 —— 否则玩家第一反应就是「怎么按了不动，是不是坏了」。 */
    if (g.ps > 0) {
      var pulse = 0.5 + Math.sin(S.t * 8) * 0.5;
      var kickoff = !g.scoredOnce;
      var tw = kickoff ? 340 : 300, th = kickoff ? 96 : 76;
      c.fillStyle = 'rgba(8,12,20,.76)';
      rr(c, W / 2 - tw / 2, H / 2 - 128, tw, th, 18); c.fill();
      c.fillStyle = 'rgba(255,255,255,' + (0.62 + pulse * 0.38) + ')';
      c.font = '700 30px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText((kickoff ? '准备开球 ' : '重新开球 ') + g.ps.toFixed(1), W / 2, H / 2 - 82);
      if (kickoff) {
        c.fillStyle = 'rgba(255,255,255,.55)';
        c.font = '600 14px system-ui,sans-serif';
        c.fillText('倒计时结束就能动，WASD 跑位 · 空格射门', W / 2, H / 2 - 52);
      }
    }

    /* 进球闪屏 */
    if (g.flash) {
      var fa = Math.max(0, 1 - (S.t - (g.flashAt || 0)) * 1.6);
      if (fa > 0.01) {
        c.fillStyle = g.flash > 0 ? 'rgba(143,240,181,' + (fa * 0.16) + ')' : 'rgba(255,122,122,' + (fa * 0.16) + ')';
        rr(c, 0, 0, W, H, 22);
        c.fill();
      }
    }

    /* 场地名 + 提示 */
    if (g.md) {
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.font = '600 13px system-ui,sans-serif';
      c.textAlign = 'right';
      c.fillText(g.md.name || '', W - 22, H - 18);
    }
    c.fillStyle = 'rgba(255,255,255,.26)';
    c.font = '600 13px system-ui,sans-serif';
    c.textAlign = 'left';
    c.fillText('先 3 球 · 空格射门', 22, H - 18);
  }

  var DW_PIX = 2;   /* 离屏画板按 2 倍分辨率存，缩放后不糊 */

  function resetBoard(S, alsoOps) {
    var g = S.g;
    if (!g.board) return;
    var b = g.board.getContext('2d');
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, DW_W * DW_PIX, DW_H * DW_PIX);
    b.fillStyle = '#fdfaf3';
    b.fillRect(0, 0, DW_W * DW_PIX, DW_H * DW_PIX);
    g.lastX = null; g.lastY = null;
    if (alsoOps) { g.applied = 0; g.no = 0; }
  }

  function applyOps(S, ops) {
    var g = S.g;
    if (!g.board || !ops) return;
    var b = g.board.getContext('2d');
    b.setTransform(DW_PIX, 0, 0, DW_PIX, 0, 0);
    b.lineCap = 'round';
    b.lineJoin = 'round';
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op[0] === 2) {
        b.save();
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.fillStyle = '#fdfaf3';
        b.fillRect(0, 0, DW_W * DW_PIX, DW_H * DW_PIX);
        b.restore();
        g.lastX = null; g.lastY = null;
      } else if (op[0] === 1) {
        b.strokeStyle = DW_COLORS[op[1]] || DW_COLORS[0];
        b.lineWidth = DW_WIDTHS[op[2]] || DW_WIDTHS[1];
        var x = op[3], y = op[4];
        /* 起笔点也画一个圆点，单点也能看见 */
        b.fillStyle = b.strokeStyle;
        b.beginPath(); b.arc(x, y, (DW_WIDTHS[op[2]] || 6) / 2, 0, 6.284); b.fill();
        g.lastX = x; g.lastY = y;
      } else if (op[0] === 0) {
        if (g.lastX == null) { g.lastX = op[1]; g.lastY = op[2]; continue; }
        b.beginPath();
        b.moveTo(g.lastX, g.lastY);
        b.lineTo(op[1], op[2]);
        b.stroke();
        g.lastX = op[1]; g.lastY = op[2];
      }
    }
  }

  function buildDrawBoard(S) {
    var cv = document.createElement('canvas');
    cv.width = DW_W * DW_PIX;
    cv.height = DW_H * DW_PIX;
    S.g.board = cv;
    resetBoard(S, true);
    var el = S.canvasWrap ? S.canvasWrap.querySelector('canvas') : null;
    if (!el) return;
    S.g.el = el;
    var pts = [], drawing = false, lastSend = 0, ns = true;

    function loc(ev) {
      var r = el.getBoundingClientRect();
      return [
        Math.max(0, Math.min(DW_W, (ev.clientX - r.left) / r.width * DW_W)),
        Math.max(0, Math.min(DW_H, (ev.clientY - r.top) / r.height * DW_H))
      ];
    }
    function flush(force) {
      if (!pts.length) return;
      var now = performance.now();
      if (!force && now - lastSend < 55) return;
      lastSend = now;
      S.net.action('draw', { pts: pts.splice(0, pts.length), c: S.g.color, w: S.g.width, ns: ns });
      ns = false;
    }
    function down(ev) {
      if (!canDraw(S)) return;
      ev.preventDefault();
      drawing = true; ns = true; pts = [];
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      var p = loc(ev);
      pts.push(p);
      flush(true);
    }
    function move(ev) {
      if (!drawing || !canDraw(S)) return;
      ev.preventDefault();
      pts.push(loc(ev));
      if (pts.length >= 12) flush(true);
      else flush(false);
    }
    function up(ev) {
      if (!drawing) return;
      drawing = false;
      flush(true);
      try { el.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    S.g.flush = function () { flush(true); };
  }

  function canDraw(S) {
    return S.g.isDrawer && S.g.ph === 'drawing' && S.g.el;
  }

  function buildDrawUi(S) {
    var host = S.canvasWrap;
    if (!host) return;
    /* 动手画的时候不要摇杆 */
    var touch = host.querySelector('.pk-touch');
    if (touch) touch.style.display = 'none';
    host.classList.add('pk-draw');

    var hud = document.createElement('div');
    hud.className = 'dw-hud';
    hud.innerHTML =
      '<div class="dw-turn"><b class="dw-role">准备中</b><span class="dw-hint"></span></div>' +
      '<div class="dw-bar"><i></i></div>';
    host.appendChild(hud);

    var tools = document.createElement('div');
    tools.className = 'dw-tools';
    tools.innerHTML = '<div class="dw-colors"></div><div class="dw-widths"></div><div class="dw-acts"></div>';
    host.appendChild(tools);
    var colorsBox = tools.querySelector('.dw-colors');
    DW_COLORS.forEach(function (col, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dw-color' + (i === 0 ? ' on' : '') + (i === 7 ? ' dw-eraser' : '');
      b.style.background = col;
      b.title = i === 7 ? '橡皮' : '';
      b.onclick = function () {
        S.g.color = i;
        if (i === 7) S.g.width = 3;
        Array.prototype.forEach.call(colorsBox.children, function (n) { n.classList.remove('on'); });
        b.classList.add('on');
      };
      colorsBox.appendChild(b);
    });
    var widthsBox = tools.querySelector('.dw-widths');
    DW_WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dw-width' + (i === 1 ? ' on' : '');
      b.innerHTML = '<i style="width:' + (4 + w) + 'px;height:' + (4 + w) + 'px"></i>';
      b.onclick = function () {
        S.g.width = i;
        S.g.color = i === 3 ? 7 : S.g.color;      /* 最粗那档直接当橡皮 */
        Array.prototype.forEach.call(widthsBox.children, function (n) { n.classList.remove('on'); });
        b.classList.add('on');
      };
      widthsBox.appendChild(b);
    });
    var acts = tools.querySelector('.dw-acts');
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'dw-act';
    clearBtn.textContent = '清空';
    clearBtn.onclick = function () {
      if (canDraw(S)) { if (S.g.flush) S.g.flush(); S.net.action('clear', {}); }
    };
    acts.appendChild(clearBtn);
    var skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'dw-act';
    skipBtn.textContent = '跳过';
    skipBtn.onclick = function () { if (S.g.isDrawer) S.net.action('skip', {}); };
    acts.appendChild(skipBtn);
    S.g.tools = tools;

    var guess = document.createElement('div');
    guess.className = 'dw-guess';
    guess.innerHTML =
      '<div class="dw-feed"></div>' +
      '<div class="dw-input"><input maxlength="12" placeholder="在这里输入你猜的词…"><button type="button">发送</button></div>';
    host.appendChild(guess);
    var input = guess.querySelector('input');
    var sendBtn = guess.querySelector('button');
    function submit() {
      var v = input.value.trim();
      if (!v) return;
      S.net.action('guess', { text: v });
      input.value = '';
    }
    sendBtn.onclick = submit;
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
    });
    S.g.guess = guess;
    S.g.input = input;
    S.g.feed = guess.querySelector('.dw-feed');
    paintDraw(S);
  }

  function paintDraw(S) {
    var g = S.g;
    if (!g || !g.tools) return;
    /* 画者没有底部猜词框，把这块空间还给画布（换角色时重算一次） */
    var isDr = !!g.isDrawer;
    if (g._wasDr !== isDr) {
      g._wasDr = isDr;
      if (g.tools.parentNode) g.tools.parentNode.classList.toggle('dw-drawer', isDr);
      if (S.relayout) S.relayout();
    }
    var role = g.tools.parentNode.querySelector('.dw-role');
    var hint = g.tools.parentNode.querySelector('.dw-hint');
    var bar = g.tools.parentNode.querySelector('.dw-bar i');
    if (!role) return;
    var on = g.ph === 'drawing' || g.ph === 'intro';
    g.tools.style.display = g.isDrawer && on ? '' : 'none';
    if (g.guess) g.guess.style.display = g.isDrawer ? 'none' : '';

    var drawerName = '';
    for (var i = 0; i < S.players.length; i++) if (S.players[i].id === g.dr) drawerName = S.players[i].name;

    if (g.ph === 'intro') {
      role.textContent = '准备中';
      hint.textContent = drawerName ? (drawerName + ' 准备画了') : '';
    } else if (g.ph === 'drawing') {
      if (g.isDrawer) {
        role.textContent = '你来画 · ' + (g.cat ? g.cat + '：' : '') + (g.word || '…');
        hint.textContent = '别写字，画出来让他们猜';
      } else {
        role.textContent = drawerName + ' 正在画';
        hint.textContent = '提示：' + (g.mk || '＿ ＿');
      }
    } else if (g.ph === 'reveal' || g.ph === 'done') {
      role.textContent = '答案：' + (g.wd || g.word || '');
      hint.textContent = g.wd ? '' : '';
    }
    var pct = Math.max(0, Math.min(100, (g.tl / (g.tot || 70)) * 100));
    bar.style.width = pct + '%';
    bar.style.background = pct < 25 ? '#ff7a7a' : pct < 55 ? '#ffd166' : '#8ff0b5';

    if (g.feed) {
      var html = '';
      if (g.gw && g.gw.length) {
        g.gw.forEach(function (x) {
          html += '<div class="dw-line"><b>' + esc(x.name) + '</b>：' + esc(x.text) + '</div>';
        });
      }
      if (g.gd && g.gd.length) {
        html += '<div class="dw-line ok">已猜中 ' + g.gd.length + ' 人</div>';
      }
      if (html !== g._feedKey) {
        g._feedKey = html;
        g.feed.innerHTML = html;
        g.feed.scrollTop = g.feed.scrollHeight;
      }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
