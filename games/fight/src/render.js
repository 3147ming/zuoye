/* ============================================================
 * games/fight/src/render.js —— 招式格斗：绘制
 * ------------------------------------------------------------
 * 轻快风格：Q 版圆头小人、柔和渐变、圆润动作、飘字伤害。
 * ============================================================ */
(function (global) {
  'use strict';

  var A = global.FightArena;
  if (!A) return;

  var W = A.W, H = A.H, GROUND = A.GROUND;

  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ---------- 背景：柔和渐变天空 + 远山 + 草地 ---------- */
  function drawBg(c, t) {
    var sky = c.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#ffe9d6');
    sky.addColorStop(0.55, '#ffd3d9');
    sky.addColorStop(1, '#cfe6ff');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);

    /* 太阳：放中间偏左的天空，避开两侧技能圈 */
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.arc(400, 96, 34, 0, 6.284); c.fill();
    c.fillStyle = 'rgba(255,244,200,.85)';
    c.beginPath(); c.arc(400, 96, 23, 0, 6.284); c.fill();

    /* 云 */
    var clouds = [[140, 70, 1], [420, 52, 0.8], [660, 96, 0.65]];
    c.fillStyle = 'rgba(255,255,255,.62)';
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      var ox = (t * 6 * cl[2]) % (W + 260) - 130;
      c.beginPath();
      c.arc(ox, cl[1], 22 * cl[2], 0, 6.284);
      c.arc(ox + 24 * cl[2], cl[1] + 5, 17 * cl[2], 0, 6.284);
      c.arc(ox - 23 * cl[2], cl[1] + 7, 15 * cl[2], 0, 6.284);
      c.fill();
    }

    /* 远山 */
    c.fillStyle = 'rgba(190,205,235,.75)';
    c.beginPath();
    c.moveTo(0, GROUND);
    c.lineTo(0, 372);
    c.quadraticCurveTo(150, 268, 300, 366);
    c.quadraticCurveTo(430, 246, 560, 358);
    c.quadraticCurveTo(700, 278, 840, 358);
    c.quadraticCurveTo(900, 316, W, 350);
    c.lineTo(W, GROUND);
    c.closePath(); c.fill();

    /* 草地 */
    var gr = c.createLinearGradient(0, GROUND, 0, H);
    gr.addColorStop(0, '#a8d98a');
    gr.addColorStop(1, '#79b866');
    c.fillStyle = gr;
    c.fillRect(0, GROUND, W, H - GROUND);

    /* 草叶 */
    c.strokeStyle = 'rgba(80,140,70,.4)';
    c.lineWidth = 2;
    for (var g = 0; g < 60; g++) {
      var gx = (g * 97) % W;
      var gy = GROUND + 12 + ((g * 37) % 74);
      c.beginPath();
      c.moveTo(gx, gy);
      c.lineTo(gx + Math.sin(t * 1.6 + g) * 4, gy - 8);
      c.stroke();
    }
    /* 地平线高光 */
    c.fillStyle = 'rgba(255,255,255,.3)';
    c.fillRect(0, GROUND, W, 3);
  }

  /* ---------- 角色 ----------
     Q 版：圆头 + 圆身子 + 小短手短腿 */
  function drawFighter(c, f, t, isP2) {
    var r = A.rollOf(f.roll);
    var hurt = f.hurt > 0;
    var bob = f.onGround ? Math.sin(t * 3 + (isP2 ? 1.6 : 0)) * 2 : 0;
    var y = f.y - bob;

    c.save();
    c.translate(f.x, y);
    c.scale(f.face, 1);

    /* 影子 */
    c.save();
    c.scale(1 / f.face, 1);
    c.fillStyle = 'rgba(60,80,50,.28)';
    var sh = Math.max(6, 22 - (GROUND - f.y) * 0.035);
    c.beginPath(); c.ellipse(0, GROUND - y + 2, sh, sh * 0.36, 0, 0, 6.284); c.fill();
    c.restore();

    /* 防御罩 */
    if (f.guard > 0) {
      c.strokeStyle = 'rgba(140,200,255,' + (0.35 + 0.25 * Math.sin(t * 14)) + ')';
      c.lineWidth = 3;
      c.beginPath(); c.ellipse(0, -r.h * 0.5, r.w * 0.95, r.h * 0.68, 0, 0, 6.284); c.stroke();
    }

    var atk = f.atk ? A.SKILLS[f.atk.id] : null;
    var punchExt = 0, kickExt = 0;
    if (atk) {
      var k = Math.min(1, f.atk.t / Math.max(0.001, f.atk.dur));
      var ext = Math.sin(k * Math.PI);
      if (atk.kind === 'punch') punchExt = ext * 16;
      else if (atk.kind === 'kick' || atk.kind === 'spin') kickExt = ext * 22;
    }

    /* 腿 */
    c.strokeStyle = r.accent;
    c.lineWidth = 8;
    c.lineCap = 'round';
    var legSwing = (f.onGround ? Math.sin(t * 8) * 3 : 4);
    c.beginPath(); c.moveTo(-6, -r.h * 0.34); c.lineTo(-8 - legSwing, 0); c.stroke();
    c.beginPath();
    c.moveTo(6, -r.h * 0.34);
    c.lineTo(8 + legSwing + kickExt, kickExt > 2 ? -r.h * 0.3 : 0);
    c.stroke();

    /* 身体 */
    c.fillStyle = hurt ? '#fff' : r.col;
    rr(c, -r.w / 2, -r.h * 0.78, r.w, r.h * 0.48, r.w * 0.42); c.fill();
    /* 肚子阴影 */
    c.fillStyle = 'rgba(0,0,0,.07)';
    rr(c, -r.w / 2 + 3, -r.h * 0.52, r.w - 6, r.h * 0.2, r.w * 0.3); c.fill();

    /* 手 */
    c.strokeStyle = hurt ? '#fff' : r.accent;
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(-r.w * 0.34, -r.h * 0.66);
    c.lineTo(-r.w * 0.34 - 8, -r.h * 0.4);
    c.stroke();
    c.beginPath();
    c.moveTo(r.w * 0.34, -r.h * 0.66);
    var hx = r.w * 0.34 + 10 + punchExt;
    var hy = -r.h * 0.6 + (atk && atk.kind === 'punch' ? -4 : 0);
    c.lineTo(hx, hy);
    c.stroke();
    /* 拳头 */
    c.fillStyle = hurt ? '#fff' : r.accent;
    c.beginPath(); c.arc(hx, hy, 5.5, 0, 6.284); c.fill();

    /* 头 */
    var hy2 = -r.h * 0.92;
    c.fillStyle = hurt ? '#fff' : r.col;
    c.beginPath(); c.arc(0, hy2, r.w * 0.42, 0, 6.284); c.fill();
    /* 头发 */
    c.fillStyle = hurt ? '#fff' : r.hair;
    c.beginPath();
    c.arc(0, hy2 - 2, r.w * 0.42, Math.PI * 1.05, Math.PI * 1.95);
    c.closePath(); c.fill();
    /* 眼睛 */
    c.fillStyle = '#3a3340';
    var blink = (Math.sin(t * 1.7 + (isP2 ? 2 : 0)) > 0.985) ? 0.15 : 1;
    c.beginPath(); c.ellipse(-r.w * 0.15, hy2 + 1, 2.4, 3 * blink, 0, 0, 6.284); c.fill();
    c.beginPath(); c.ellipse(r.w * 0.17, hy2 + 1, 2.4, 3 * blink, 0, 0, 6.284); c.fill();
    /* 腮红 */
    c.fillStyle = 'rgba(255,140,150,.3)';
    c.beginPath(); c.ellipse(-r.w * 0.28, hy2 + 7, 4, 2.6, 0, 0, 6.284); c.fill();
    c.beginPath(); c.ellipse(r.w * 0.3, hy2 + 7, 4, 2.6, 0, 0, 6.284); c.fill();

    /* 旋风踢：残影 */
    if (atk && atk.kind === 'spin') {
      c.globalAlpha = 0.45;
      c.strokeStyle = r.accent;
      c.lineWidth = 4;
      for (var i = 1; i <= 3; i++) {
        c.beginPath();
        c.arc(0, -r.h * 0.4, 30 + i * 9, -1.1, 1.1);
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    c.restore();
  }

  /* ---------- 技能特效 ---------- */
  function drawFx(c, fx) {
    if (fx.t === 'hit') {
      c.save();
      c.globalAlpha = Math.max(0, fx.life / 0.35);
      c.fillStyle = fx.block ? '#9fd8ff' : '#ffdf6b';
      c.font = '700 22px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText((fx.block ? '格挡 ' : '') + fx.dmg, fx.x, fx.y);
      c.restore();
    } else if (fx.t === 'ko') {
      c.save();
      c.globalAlpha = Math.max(0, fx.life / 0.9);
      c.fillStyle = '#fff';
      c.font = '800 30px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText('K.O.', fx.x, fx.y);
      c.restore();
    } else if (fx.t === 'cast') {
      c.save();
      c.globalAlpha = Math.max(0, fx.life / 0.5);
      c.fillStyle = '#c9b6ff';
      c.font = '700 15px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText(fx.name, fx.x, fx.y - 12);
      c.restore();
    } else if (fx.t === 'proj') {
      /* 叶刃 */
      c.save();
      c.translate(fx.x, fx.y);
      c.rotate(fx.t2 || 0);
      c.fillStyle = '#9ce07a';
      c.beginPath();
      c.ellipse(0, 0, 13, 6, 0, 0, 6.284); c.fill();
      c.restore();
    } else if (fx.t === 'land') {
      c.save();
      c.globalAlpha = Math.max(0, fx.life / 0.3);
      c.strokeStyle = 'rgba(255,255,255,.8)';
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(fx.x, GROUND, 22 * (1 - fx.life / 0.3) + 6, 6, 0, 0, 6.284);
      c.stroke();
      c.restore();
    }
  }

  /* ---------- HUD ---------- */
  function drawHud(c, f1, f2, t, roundInfo) {
    function bar(f, x, right) {
      var w = 300, h = 16;
      var bx = right ? x - w : x;
      c.fillStyle = 'rgba(20,16,30,.55)';
      rr(c, bx, 18, w, h, 8); c.fill();
      var ratio = Math.max(0, f.hp / f.max);
      c.fillStyle = ratio > 0.5 ? '#8ff0b5' : ratio > 0.22 ? '#ffd166' : '#ff7a7a';
      if (right) { rr(c, bx + w * (1 - ratio), 18, w * ratio, h, 8); c.fill(); }
      else { rr(c, bx, 18, w * ratio, h, 8); c.fill(); }
      /* 名字：画在血条下方，别贴顶边（会被裁掉） */
      c.fillStyle = 'rgba(58,51,64,.9)';
      c.font = '700 15px system-ui,sans-serif';
      c.textAlign = right ? 'right' : 'left';
      c.fillText(f.name, right ? bx + w : bx, 58);
      /* 能量 */
      c.fillStyle = 'rgba(20,16,30,.45)';
      rr(c, bx, 38, w, 7, 4); c.fill();
      c.fillStyle = '#9fd0ff';
      var er = Math.max(0, f.energy / f.maxEnergy);
      if (right) { rr(c, bx + w * (1 - er), 38, w * er, 7, 4); c.fill(); }
      else { rr(c, bx, 38, w * er, 7, 4); c.fill(); }
    }
    bar(f1, 24, false);
    bar(f2, W - 24, true);

    /* 回合信息 */
    if (roundInfo) {
      c.fillStyle = 'rgba(255,255,255,.8)';
      c.font = '600 13px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText(roundInfo, W / 2, 28);
    }
  }

  /* ---------- 连击数 ---------- */
  function drawCombo(c, f, x, isP2) {
    if (f.combo < 2) return;
    c.save();
    c.fillStyle = '#ffd166';
    c.font = '800 20px system-ui,sans-serif';
    c.textAlign = isP2 ? 'right' : 'left';
    c.fillText(f.combo + ' 连击', isP2 ? x - 10 : x + 10, 76);
    c.restore();
  }

  global.FightRender = {
    drawBg: drawBg, drawFighter: drawFighter, drawFx: drawFx,
    drawHud: drawHud, drawCombo: drawCombo, rr: rr
  };
})(typeof window !== 'undefined' ? window : globalThis);
