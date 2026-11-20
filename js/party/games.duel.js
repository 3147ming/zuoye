/* ============================================================
 * games.duel.js —— 弹弹岛对战（客户端绘制 + 输入）
 * 公共件在 games.js（WH_PARTY_GAMES），必须在它之后加载。
 * 服务端权威：本文件只画快照 + 上报角度/力度/走位/开火。
 * ============================================================ */
(function (global) {
  'use strict';

  var K = global.PartyKit;
  var G = global.WH_PARTY_GAMES;
  if (!K || !G) return;

  var COLORS = G.COLORS, rr = G.rr, seatColor = G.seatColor, nameOf = G.nameOf;
  var fit = G.fit, float = G.float, drawFloats = G.drawFloats;

  var W = 1200, H = 675, SEA = 520, GRAV = 860;

  K.register('duel', {
    aspect: W / H,
    howTo: '<b>↑↓ 调角度、←→ 调力度</b>，轮到你时按<b>空格</b>或「开火」开炮<br>'
      + '<b>A / D</b>（手机用 ◀ ▶）在岛上左右走位，不消耗回合<br>'
      + '炮弹受<b>重力 + 横风</b>影响，不是直线；<b>满力会打过头</b>，开局 50°/78% 已接近能命中<br>'
      + '撞人会扣血，撞岛或气球会炸；把对手打落海或血打光就赢；每回合限时 22 秒',
    keys: ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' '],
    buttons: [
      { label: '◀ 走', onPress: function (S) { S.net.input({ move: -1 }); } },
      { label: '开火', cls: 'pk-btn-primary', onPress: function (S) { S.net.action('fire'); } },
      { label: '走 ▶', onPress: function (S) { S.net.input({ move: 1 }); } }
    ],
    init: function (S) {
      S.g = { p: [], s: [], bl: [], is: null, ev: [], angle: 50, power: 78, shake: 0, name: '', lastSent: '', wasMyTurn: false };
    },
    onSnap: function (S, d) {
      var g = S.g;
      g.ph = d.ph; g.tl = d.tl; g.act = d.act; g.w = d.w || 0;
      g.p = d.p || [];
      g.s = K.slide(g.s, d.s || [], 2, 3, 0);
      g.bl = d.bl || [];
      if (d.is) g.is = d.is;
      if (d.mn) g.name = d.mn;
      /* 只在「轮到我」的那一刻同步一次角度/力度；之后本地累计，
         不被 30Hz 快照反复覆盖（否则按住方向键会被拽回去，角度调不动）。 */
      var myNow = g.act === S.you && g.ph === 'aim';
      if (myNow && !g.wasMyTurn) {
        for (var i = 0; i < g.p.length; i++) {
          if (g.p[i][0] === S.you) { g.angle = g.p[i][6]; g.power = g.p[i][7]; break; }
        }
      }
      g.wasMyTurn = myNow;
      (d.ev || []).forEach(function (e) {
        if (e.e === 'boom') g.shake = 6;
        else if (e.e === 'hit') float(S, e.x, H * 0.3, '-' + '命中', '#ff9f9f', 18);
        else if (e.e === 'out') float(S, e.x, H * 0.28, nameOf(S, e.id) + ' 落海', '#fff', 18);
      });
    },
    sendInput: function (S, net) {
      var g = S.g;
      var myTurn = g.act === S.you && g.ph === 'aim';
      var a = S.keys.arrowup || S.keys.w ? 1 : 0;
      var b = S.keys.arrowdown || S.keys.s ? 1 : 0;
      var l = S.keys.arrowleft ? 1 : 0;
      var r = S.keys.arrowright ? 1 : 0;
      var mv = (S.keys.d ? 1 : 0) - (S.keys.a ? 1 : 0);
      var changed = false;
      if (myTurn && (a || b || l || r)) {
        /* 用真实帧长累计，手感与单机一致 */
        var dt = S.dt || 0.016;
        g.angle = Math.max(8, Math.min(88, g.angle + (a - b) * 46 * dt));
        g.power = Math.max(20, Math.min(100, g.power + (r - l) * 48 * dt));
        changed = true;
      }
      var sig = [Math.round(g.angle), Math.round(g.power), mv].join('');
      if (changed || mv !== 0 || sig !== g.lastSent) {
        g.lastSent = sig;
        net.input({ angle: Math.round(g.angle), power: Math.round(g.power) / 100, move: mv });
      }
    },
    onKey: function (S, k) {
      if (k === ' ') S.net.action('fire');
    },
    draw: function (S) {
      var c = S.draw;
      fit(S, W, H);
      var g = S.g;

      /* 天空 */
      var sky = c.createLinearGradient(0, 0, 0, SEA);
      sky.addColorStop(0, '#3f7fc4'); sky.addColorStop(0.55, '#83c2ea'); sky.addColorStop(1, '#c2e1f2');
      c.fillStyle = sky; c.fillRect(0, 0, W, SEA);
      /* 太阳 */
      c.fillStyle = 'rgba(255,240,190,.85)';
      c.beginPath(); c.arc(W - 120, 90, 42, 0, 7); c.fill();
      /* 远山 */
      c.fillStyle = 'rgba(90,130,170,.35)';
      c.beginPath(); c.moveTo(0, SEA);
      for (var mx = 0; mx <= W; mx += 120) c.lineTo(mx, SEA - 90 - (mx % 240) * 0.3);
      c.lineTo(W, SEA); c.closePath(); c.fill();
      /* 海 */
      var sea = c.createLinearGradient(0, SEA, 0, H);
      sea.addColorStop(0, '#2f8fc0'); sea.addColorStop(1, '#164e73');
      c.fillStyle = sea; c.fillRect(0, SEA, W, H - SEA);
      c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 2;
      for (var wy = SEA + 12; wy < H; wy += 16) {
        c.beginPath();
        for (var wx = 0; wx < W; wx += 12) c.lineTo(wx, wy + Math.sin(S.t * 2 + wx * 0.03) * 2);
        c.stroke();
      }

      var shk = g.shake || 0;
      if (shk > 0.2) { c.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk); g.shake *= 0.86; }

      /* 岛 */
      if (g.is) for (var i = 0; i < g.is.length; i++) {
        var s = g.is[i];
        c.fillStyle = '#6b4a2f';
        c.beginPath();
        c.moveTo(s[0] - s[2], H);
        c.lineTo(s[0] - s[2], s[1] + 16);
        c.quadraticCurveTo(s[0], s[1] - 6, s[0] + s[2], s[1] + 16);
        c.lineTo(s[0] + s[2], H);
        c.closePath(); c.fill();
        /* 草皮 */
        c.fillStyle = '#6fb553';
        c.beginPath();
        c.moveTo(s[0] - s[2], s[1] + 16);
        c.quadraticCurveTo(s[0], s[1] - 6, s[0] + s[2], s[1] + 16);
        c.lineTo(s[0] + s[2], s[1] + 24);
        c.quadraticCurveTo(s[0], s[1] + 2, s[0] - s[2], s[1] + 24);
        c.closePath(); c.fill();
      }

      /* 气球 */
      for (var bi = 0; bi < g.bl.length; bi++) {
        var b = g.bl[bi], br = b[2];
        c.fillStyle = '#e8665b';
        c.beginPath(); c.ellipse(b[0], b[1], br, br * 1.12, 0, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,.5)';
        c.beginPath(); c.ellipse(b[0] - br * 0.35, b[1] - br * 0.4, br * 0.16, br * 0.3, -0.5, 0, 7); c.fill();
      }

      /* 玩家炮台 */
      var myTurn = g.act === S.you && g.ph === 'aim';
      for (var pi = 0; pi < g.p.length; pi++) {
        var u = g.p[pi];
        var ux = u[1], uy = u[2], dir = u[5], alive = u[3] > 0;
        if (!alive) continue;
        var isMe = u[0] === S.you;
        var ang = isMe ? g.angle : 45;
        var rad = ang * Math.PI / 180;
        c.save(); c.translate(ux, uy);
        c.fillStyle = 'rgba(0,0,0,.2)';
        c.beginPath(); c.ellipse(0, 20, 24, 6, 0, 0, 7); c.fill();
        c.fillStyle = isMe ? '#4aa6e8' : '#e8665b';
        c.beginPath(); c.moveTo(-18, 8); c.lineTo(-12, -8); c.lineTo(12, -8); c.lineTo(18, 8); c.closePath(); c.fill();
        c.save(); c.scale(dir, 1); c.rotate(-rad);
        c.fillStyle = '#3c4a5c'; rr(c, 2, -4, 30, 8, 3); c.fill();
        c.restore();
        c.restore();
        /* 血条 */
        var bw = 44;
        c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(ux - bw / 2 - 1, uy - 42, bw + 2, 7);
        c.fillStyle = isMe ? '#7fe3b0' : '#ff8b7a'; c.fillRect(ux - bw / 2, uy - 41, Math.max(0, u[3] / 100) * bw, 5);
        c.fillStyle = '#fff'; c.font = 'bold 11px system-ui,sans-serif'; c.textAlign = 'center';
        c.fillText(isMe ? '我' : nameOf(S, u[0]), ux, uy - 46);
      }

      /* 炮弹 */
      for (var si = 0; si < g.s.length; si++) {
        var sh = g.s[si];
        c.fillStyle = '#ffb36b';
        c.beginPath(); c.arc(sh[2], sh[3], 6, 0, 7); c.fill();
        c.fillStyle = '#fff2c4';
        c.beginPath(); c.arc(sh[2] - 2, sh[3] - 2, 2, 0, 7); c.fill();
      }

      /* 瞄准线：只在自己回合，炮口附近一小段 */
      if (myTurn) {
        var me = null;
        for (var mi = 0; mi < g.p.length; mi++) if (g.p[mi][0] === S.you) { me = g.p[mi]; break; }
        if (me) {
          var a2 = g.angle * Math.PI / 180, sp = 1060 * g.power;
          var gx = me[1] + me[5] * Math.cos(a2) * 34, gy = me[2] - Math.sin(a2) * 34;
          var vx = me[5] * Math.cos(a2) * sp, vy = -Math.sin(a2) * sp, dt = 1 / 120;
          c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = 2; c.setLineDash([5, 8]);
          c.beginPath(); c.moveTo(gx, gy);
          for (var st = 0; st < 25; st++) {
            vx += (g.w || 0) * dt; vy += GRAV * dt; gx += vx * dt; gy += vy * dt;
            if (st % 2 === 0) c.lineTo(gx, gy);
          }
          c.stroke(); c.setLineDash([]);
        }
      }

      /* 顶部提示：轮到谁 / 倒计时 / 风 */
      c.fillStyle = 'rgba(9,18,33,.55)'; rr(c, W / 2 - 150, 8, 300, 40, 10); c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 17px system-ui,sans-serif'; c.textAlign = 'center';
      var who = g.act === S.you ? '你的回合' : (nameOf(S, g.act) + ' 的回合');
      c.fillText(who + ' · ' + (g.tl || 0) + 's　' + (g.w >= 0 ? '风→' : '风←') + Math.abs(g.w || 0), W / 2, 35);

      drawFloats(S);
    },
    scoreRows: function (S) {
      return (S.g.p || []).map(function (u) {
        return {
          id: u[0], name: nameOf(S, u[0]), color: seatColor(S, u[0]),
          text: u[3] > 0 ? u[3] + ' HP' : '出局'
        };
      });
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
