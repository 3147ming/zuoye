/* ============================================================
 * games.pitch.js —— 球场 2v2
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

})(typeof window !== 'undefined' ? window : globalThis);
