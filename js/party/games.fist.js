/* ============================================================
 * js/party/games.fist.js —— 招式格斗（联机）
 * ------------------------------------------------------------
 * 服务端权威：客户端只发输入、只画快照。
 * 画面复用单机版的 Q 版风格（这里独立实现一份绘制，和单机视觉一致）。
 * ============================================================ */
(function (global) {
  'use strict';

  var K = global.PartyKit;
  var G = global.WH_PARTY_GAMES;
  if (!K || !G) return;

  var COLORS, rr, seatColor, nameOf, float, drawFloats;
  if (G) { COLORS = G.COLORS; rr = G.rr; seatColor = G.seatColor; nameOf = G.nameOf;
    float = G.float; drawFloats = G.drawFloats; }

  var FW = 960, FH = 540, GROUND = 452;

  /* 角色表（与服务端 server/games/fist.js 一致） */
  var ROLLS = [
    { id: 'noodle', name: '面条', col: '#ffd8a8', ac: '#ffb27a', hair: '#8a5a3b', w: 34, h: 62 },
    { id: 'sprout', name: '豆芽', col: '#b7e58a', ac: '#7fc95f', hair: '#4f8f3a', w: 32, h: 58 },
    { id: 'pebble', name: '石子', col: '#c3c8d6', ac: '#8f97ab', hair: '#5c6376', w: 42, h: 58 },
    { id: 'ember', name: '小火星', col: '#ff9f6e', ac: '#ff6b4a', hair: '#ffd166', w: 30, h: 60 }
  ];

  /* 技能名（画技能圈用） */
  var SKILL_NAMES = {
    punch: '直拳', kick: '小踢', dash: '滑步', spin: '旋风踢', cloud: '软绵绵',
    leap: '跳豆', leaf: '叶刃', root: '扎根', charge: '滚石冲', quake: '震地',
    guard: '石壳', blaze: '火星拳', afterimage: '残影', flare: '耀斑'
  };
  /* 每个角色的技能顺序与服务端一致 */
  var ROLL_SKILLS = {
    noodle: ['dash', 'spin', 'cloud'],
    sprout: ['leap', 'leaf', 'root'],
    pebble: ['charge', 'quake', 'guard'],
    ember: ['blaze', 'afterimage', 'flare']
  };

  function rollOf(idx) { return ROLLS[idx] || ROLLS[0]; }

  /* ---------- 绘制 ---------- */
  function drawBg(c, t) {
    var sky = c.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#ffe9d6');
    sky.addColorStop(0.55, '#ffd3d9');
    sky.addColorStop(1, '#cfe6ff');
    c.fillStyle = sky;
    c.fillRect(0, 0, FW, FH);
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.arc(400, 96, 34, 0, 6.284); c.fill();
    c.fillStyle = 'rgba(255,244,200,.85)';
    c.beginPath(); c.arc(400, 96, 23, 0, 6.284); c.fill();

    var clouds = [[140, 70, 1], [420, 52, 0.8], [660, 96, 0.65]];
    c.fillStyle = 'rgba(255,255,255,.62)';
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      var ox = (t * 6 * cl[2]) % (FW + 260) - 130;
      c.beginPath();
      c.arc(ox, cl[1], 22 * cl[2], 0, 6.284);
      c.arc(ox + 24 * cl[2], cl[1] + 5, 17 * cl[2], 0, 6.284);
      c.arc(ox - 23 * cl[2], cl[1] + 7, 15 * cl[2], 0, 6.284);
      c.fill();
    }

    c.fillStyle = 'rgba(190,205,235,.75)';
    c.beginPath();
    c.moveTo(0, GROUND);
    c.lineTo(0, 372);
    c.quadraticCurveTo(150, 268, 300, 366);
    c.quadraticCurveTo(430, 246, 560, 358);
    c.quadraticCurveTo(700, 278, 840, 358);
    c.quadraticCurveTo(900, 316, FW, 350);
    c.lineTo(FW, GROUND);
    c.closePath(); c.fill();

    var gr = c.createLinearGradient(0, GROUND, 0, FH);
    gr.addColorStop(0, '#a8d98a');
    gr.addColorStop(1, '#79b866');
    c.fillStyle = gr;
    c.fillRect(0, GROUND, FW, FH - GROUND);
    c.strokeStyle = 'rgba(80,140,70,.4)';
    c.lineWidth = 2;
    for (var g = 0; g < 60; g++) {
      var gx = (g * 97) % FW;
      var gy = GROUND + 12 + ((g * 37) % 74);
      c.beginPath();
      c.moveTo(gx, gy);
      c.lineTo(gx + Math.sin(t * 1.6 + g) * 4, gy - 8);
      c.stroke();
    }
    c.fillStyle = 'rgba(255,255,255,.3)';
    c.fillRect(0, GROUND, FW, 3);
  }

  function drawFighter(c, f, t, isMe) {
    var r = rollOf(f[7]);
    var x = f[1], y = f[2], face = f[3];
    var atkId = f[8];
    var bob = 0;
    c.save();
    c.translate(x, y);
    c.scale(face, 1);

    /* 影子 */
    c.save();
    c.scale(1 / face, 1);
    c.fillStyle = 'rgba(60,80,50,.28)';
    var sh = Math.max(6, 22 - (GROUND - y) * 0.035);
    c.beginPath(); c.ellipse(0, GROUND - y + 2, sh, sh * 0.36, 0, 0, 6.284); c.fill();
    c.restore();

    if (f[9]) {
      c.strokeStyle = 'rgba(140,200,255,' + (0.35 + 0.25 * Math.sin(t * 14)) + ')';
      c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, -r.h * 0.5, r.w * 0.95, r.h * 0.68, 0, 0, 6.284); c.stroke();
    }

    var punchExt = 0;
    if (atkId === 'punch' || atkId === 'blaze' || atkId === 'leap' || atkId === 'charge') punchExt = 14;

    /* 腿 */
    c.strokeStyle = r.ac;
    c.lineWidth = 8;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(-6, -r.h * 0.34); c.lineTo(-9, 0); c.stroke();
    c.beginPath(); c.moveTo(6, -r.h * 0.34); c.lineTo(9, 0); c.stroke();

    /* 身体 */
    c.fillStyle = r.col;
    rr(c, -r.w / 2, -r.h * 0.78, r.w, r.h * 0.48, r.w * 0.42); c.fill();
    c.fillStyle = 'rgba(0,0,0,.07)';
    rr(c, -r.w / 2 + 3, -r.h * 0.52, r.w - 6, r.h * 0.2, r.w * 0.3); c.fill();

    /* 手 */
    c.strokeStyle = r.ac;
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(-r.w * 0.34, -r.h * 0.66); c.lineTo(-r.w * 0.34 - 8, -r.h * 0.4); c.stroke();
    var hx = r.w * 0.34 + 10 + punchExt, hy = -r.h * 0.6;
    c.beginPath(); c.moveTo(r.w * 0.34, -r.h * 0.66); c.lineTo(hx, hy); c.stroke();
    c.fillStyle = r.ac;
    c.beginPath(); c.arc(hx, hy, 5.5, 0, 6.284); c.fill();

    /* 头 */
    var hy2 = -r.h * 0.92;
    c.fillStyle = r.col;
    c.beginPath(); c.arc(0, hy2, r.w * 0.42, 0, 6.284); c.fill();
    c.fillStyle = r.hair;
    c.beginPath(); c.arc(0, hy2 - 2, r.w * 0.42, Math.PI * 1.05, Math.PI * 1.95); c.closePath(); c.fill();
    c.fillStyle = '#3a3340';
    c.beginPath(); c.ellipse(-r.w * 0.15, hy2 + 1, 2.4, 3, 0, 0, 6.284); c.fill();
    c.beginPath(); c.ellipse(r.w * 0.17, hy2 + 1, 2.4, 3, 0, 0, 6.284); c.fill();
    c.fillStyle = 'rgba(255,140,150,.3)';
    c.beginPath(); c.ellipse(-r.w * 0.28, hy2 + 7, 4, 2.6, 0, 0, 6.284); c.fill();
    c.beginPath(); c.ellipse(r.w * 0.3, hy2 + 7, 4, 2.6, 0, 0, 6.284); c.fill();

    if (atkId === 'spin') {
      c.globalAlpha = 0.45;
      c.strokeStyle = r.ac;
      c.lineWidth = 4;
      for (var i = 1; i <= 3; i++) {
        c.beginPath(); c.arc(0, -r.h * 0.4, 30 + i * 9, -1.1, 1.1); c.stroke();
      }
      c.globalAlpha = 1;
    }
    c.restore();

    /* 名字 + 血条 */
    c.fillStyle = 'rgba(58,51,64,.9)';
    c.font = '700 13px system-ui,sans-serif';
    c.textAlign = 'center';
    c.fillText((isMe ? '你' : '') + r.name, x, y - r.h - 12);
  }

  function drawHud(c, S) {
    var F = S.g.f || [];
    function bar(f, x, right) {
      var w = 260, h = 15;
      var bx = right ? x - w : x;
      c.fillStyle = 'rgba(20,16,30,.5)';
      rr(c, bx, 16, w, h, 8); c.fill();
      var ratio = Math.max(0, f[4] / f[5]);
      c.fillStyle = ratio > 0.5 ? '#8ff0b5' : ratio > 0.22 ? '#ffd166' : '#ff7a7a';
      if (right) { rr(c, bx + w * (1 - ratio), 16, w * ratio, h, 8); c.fill(); }
      else { rr(c, bx, 16, w * ratio, h, 8); c.fill(); }
      /* 能量 */
      c.fillStyle = 'rgba(20,16,30,.4)';
      rr(c, bx, 35, w, 6, 3); c.fill();
      c.fillStyle = '#9fd0ff';
      var er = Math.max(0, f[6] / 100);
      if (right) { rr(c, bx + w * (1 - er), 35, w * er, 6, 3); c.fill(); }
      else { rr(c, bx, 35, w * er, 6, 3); c.fill(); }
    }
    if (F[0]) bar(F[0], 22, false);
    if (F[1]) bar(F[1], FW - 22, true);

    /* 回合信息 */
    c.fillStyle = 'rgba(58,51,64,.75)';
    c.font = '600 13px system-ui,sans-serif';
    c.textAlign = 'center';
    c.fillText('第 ' + (S.g.r || 1) + ' 回合 · ' + (S.g.rt != null ? S.g.rt : 45) + 's', FW / 2, 26);

    /* 技能圈 */
    drawSkills(c, S);
  }

  function drawSkills(c, S) {
    var F = S.g.f || [];
    var sk = S.g.sk || [];
    for (var i = 0; i < F.length; i++) {
      var f = F[i];
      if (f[0] !== S.you) continue;
      var list = sk[i] || [];
      var ids = ROLL_SKILLS[rollOf(f[7]).id] || [];
      /* 服务端只发「还在冷却的」，格式 [技能序号, 剩余秒] */
      var cdMap = {};
      for (var k = 0; k < list.length; k++) cdMap[list[k][0]] = list[k][1];
      for (var j = 0; j < ids.length; j++) {
        var sid = ids[j];
        var cd = cdMap[j] || 0;
        var ready = cd <= 0;
        var cx = 40 + j * 64;
        var cy = 92;
        c.save();
        c.fillStyle = ready ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.28)';
        c.beginPath(); c.arc(cx, cy, 24, 0, 6.284); c.fill();
        if (!ready) {
          c.fillStyle = 'rgba(30,24,44,.55)';
          c.beginPath(); c.moveTo(cx, cy);
          c.arc(cx, cy, 24, -Math.PI / 2, -Math.PI / 2 + Math.min(1, cd / 3.5) * 6.284);
          c.closePath(); c.fill();
        }
        c.fillStyle = ready ? '#3a3340' : 'rgba(60,50,70,.7)';
        c.font = '700 11px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillText((SKILL_NAMES[sid] || sid).slice(0, 3), cx, cy + 4);
        c.restore();
      }
    }
  }

  /* ---------- 注册 ---------- */
  K.register('fist', {
    aspect: FW / FH,
    howTo: '<b>A D / ← →</b> 移动 · <b>W / ↑</b> 跳跃<br>'
      + '<b>J / ,</b> 直拳 · <b>K / .</b> 小踢<br>'
      + '<b>U I O</b> 三个技能（消耗能量，有冷却）<br>'
      + '把对手血打空赢下回合，<b>三局两胜</b>',
    keys: ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'j', 'k', 'u', 'i', 'o', ',', '.'],
    buttons: [
      { label: '跳', onPress: function (S) { S.net.action('jump'); } },
      { label: '拳', onPress: function (S) { S.net.action('atk', { atk: 'punch' }); } },
      { label: '踢', onPress: function (S) { S.net.action('atk', { atk: 'kick' }); } }
    ],
    init: function (S) {
      S.g = { f: [], p: [], sk: [], r: 1, rt: 45, ev: [], shake: 0, over: 0 };
    },
    onSnap: function (S, d) {
      S.g.f = d.f || [];
      S.g.p = d.p || [];
      S.g.sk = d.sk || [];
      /* 服务端可能传 null（老版本快照），兜成空数组 */
      for (var q = 0; q < S.g.sk.length; q++) if (!S.g.sk[q]) S.g.sk[q] = [];
      S.g.r = d.r || S.g.r;
      S.g.rt = d.rt != null ? d.rt : S.g.rt;
      (d.ev || []).forEach(function (e) {
        if (e.e === 'hit') {
          float(S, e.x, e.y, (e.block ? '格挡 ' : '') + e.dmg, e.block ? '#9fd8ff' : '#ffdf6b', 15);
          if (e.on === S.you) S.g.shake = 6;
        } else if (e.e === 'ko') {
          float(S, e.x, e.y, 'K.O.', '#ffffff', 18);
          S.g.shake = 10;
        } else if (e.e === 'cast') {
          float(S, e.x, e.y, e.name, '#c9b6ff', 13);
        } else if (e.e === 'round') {
          S.g.shake = 4;
        }
      });
      S.g.ev = S.g.ev.concat(d.ev || []).slice(-20);
    },
    onKey: function (S, k) {
      /* net.action(动作名, 附加字段) —— 第一个参数是动作字符串，
         不是整个对象（写错的话服务端收到 a:undefined，动作直接被忽略）。 */
      if (k === ' ' || k === 'w' || k === 'arrowup') { S.net.action('jump'); return; }
      if (k === 'j' || k === ',') { S.net.action('atk', { atk: 'punch' }); return; }
      if (k === 'k' || k === '.') { S.net.action('atk', { atk: 'kick' }); return; }
      /* 技能：U I O，对应自己角色的第 1/2/3 个技能 */
      var mi = ['u', 'i', 'o'].indexOf(k);
      if (mi >= 0) {
        var mine = null;
        var F = S.g.f || [];
        for (var i = 0; i < F.length; i++) if (F[i][0] === S.you) mine = F[i];
        if (!mine) return;
        var list = ROLL_SKILLS[rollOf(mine[7]).id] || [];
        if (list[mi]) S.net.action('skill', { skill: list[mi] });
      }
    },
    sendInput: function (S, net) {
      /* 只有「移动」是持续状态，走 input；
         跳跃 / 出拳 / 技能都是一次性动作，走 action（见 onKey）。
         之前把跳和技能塞进 input，服务端 wantJump/wantSkill 每帧都会被重置，
         结果是「按住 W 不停跳」「按住 U 冷却一好就自动放」，
         看着像 bug，其实是把「按住」当成了「按了 60 次」。 */
      var mx = 0;
      if (S.keys.a || S.keys.arrowleft) mx -= 1;
      if (S.keys.d || S.keys.arrowright) mx += 1;
      if (Math.abs(S.axis.x) > 0.3) mx = S.axis.x > 0 ? 1 : -1;
      net.input({ mx: mx });
    },
    draw: function (S) {
      var c = S.draw;
      G.fit(S, FW, FH);
      var shk = S.g.shake || 0;
      if (shk > 0.3) {
        c.translate((Math.random() - 0.5) * shk, (Math.random() - 0.5) * shk);
        S.g.shake = shk * 0.86;
      } else S.g.shake = 0;

      drawBg(c, S.t);

      /* 飞行道具 */
      (S.g.p || []).forEach(function (p) {
        c.save();
        c.translate(p[0], p[1]);
        c.fillStyle = '#9ce07a';
        c.beginPath(); c.ellipse(0, 0, 13, 6, 0, 0, 6.284); c.fill();
        c.restore();
      });

      var F = S.g.f || [];
      for (var i = 0; i < F.length; i++) drawFighter(c, F[i], S.t, F[i][0] === S.you);

      drawHud(c, S);
      drawFloats(S);
    },
    scoreRows: function (S) {
      var F = S.g.f || [];
      var rows = [];
      for (var i = 0; i < F.length; i++) {
        var f = F[i];
        rows.push({
          id: f[0], name: nameOf(S, f[0]), color: seatColor(S, f[0]),
          text: rollOf(f[7]).name + ' · ' + f[11] + ' 胜'
        });
      }
      return rows;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
