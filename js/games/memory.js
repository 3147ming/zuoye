/* ============================================================
 * memory.js —— 记忆翻牌（Memory）
 * ------------------------------------------------------------
 * 32 张牌 = 16 对：8 种符号 × 4 张（任意两张同符号即可配对）。
 * （指令原文写「8 种符号 × 2」，但 8×2 只有 16 张，与 4×8=32 的格位、
 *   「16 对」「凑满 16 对」都对不上；按 4 张/种 才自洽，改前先数一遍。）
 *
 * 版式（数字写死，改之前先算一遍总宽/总高）：
 *   牌 140×150，列间距 22、行间距 14
 *   总宽 8×140 + 7×22 = 1274 → 左右各留 3px
 *   总高 4×150 + 3×14 = 642 → 上下各留 39px（HUD 就在这条上边距里）
 *
 * 状态机：title（牌全扣着，底部提示「点击任意牌开始」）→ playing → settle
 * 计时：从翻开第一张牌开始，不限时；16 对全配完进结算。
 * 最佳成绩：localStorage 'worldhub.memory.best'（秒，保留 1 位小数），
 *           与 'worldhub.save.v1' 完全无关，互不干扰。
 * ============================================================ */
(function (global) {
  'use strict';

  var VIEW_W = 1280;
  var VIEW_H = 720;

  var COLS = 8;
  var ROWS = 4;
  var CARD_W = 140;
  var CARD_H = 150;
  var GAP_X = 22;
  var GAP_Y = 14;

  var GRID_W = COLS * CARD_W + (COLS - 1) * GAP_X;          /* 1274 */
  var GRID_H = ROWS * CARD_H + (ROWS - 1) * GAP_Y;          /* 642 */
  var X0 = (VIEW_W - GRID_W) / 2;
  var Y0 = (VIEW_H - GRID_H) / 2;

  var FLIP_T = 0.12;          /* 单张翻转时长 */
  var MISS_HOLD = 0.8;        /* 配对失败后停留多久再翻回 */
  var COPIES = 4;             /* 每种符号 4 张：8×4 = 32 张 */
  var PAIRS = (COLS * ROWS) / 2;   /* 16 对 */

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  var C = {
    ink: '#08060f',
    paper: '#fdf3e4',
    dim: 'rgba(253, 243, 228, 0.5)',
    faint: 'rgba(253, 243, 228, 0.3)',
    violet: '#a98ae0',
    gold: '#ffd79a'
  };

  /* 8 种符号：名字用于配对判定，颜色只影响观感 */
  var KINDS = [
    { id: 'sun',   color: '#e8a24a' },
    { id: 'hill',  color: '#8f7ac4' },
    { id: 'tree',  color: '#5fa87a' },
    { id: 'flame', color: '#e8545f' },
    { id: 'ice',   color: '#5fc3ff' },
    { id: 'fist',  color: '#e8844a' },
    { id: 'card',  color: '#e8b45a' },
    { id: 'star',  color: '#ffd79a' }
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rr(ctx, x, y, w, h, r) {
    var k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - k, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + k);
    ctx.lineTo(x + w, y + h - k);
    ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - k);
    ctx.lineTo(x, y + k);
    ctx.quadraticCurveTo(x, y, x + k, y);
    ctx.closePath();
  }

  function panel(ctx, x, y, w, h, accent) {
    ctx.save();
    ctx.shadowColor = 'rgba(4, 3, 9, 0.72)';
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 20;
    rr(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(20, 15, 34, 0.94)';
    ctx.fill();
    ctx.restore();

    rr(ctx, x, y, w, h, 18);
    ctx.strokeStyle = accent || 'rgba(169, 138, 224, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    rr(ctx, x + 6.5, y + 6.5, w - 13, h - 13, 13);
    ctx.strokeStyle = 'rgba(255, 217, 168, 0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function button(ctx, x, y, w, h, label, hot, accent) {
    rr(ctx, x, y, w, h, 12);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, hot ? 'rgba(169, 138, 224, 0.38)' : 'rgba(169, 138, 224, 0.16)');
    g.addColorStop(1, hot ? 'rgba(169, 138, 224, 0.18)' : 'rgba(169, 138, 224, 0.06)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(228, 214, 255, 0.85)' : 'rgba(169, 138, 224, 0.48)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = accent || C.paper;
    ctx.font = '600 20px ' + SERIF;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  /* ---------------- 8 种简笔符号 ---------------- */
  function drawSymbol(ctx, kind, cx, cy, s, color, alpha) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, a;

    if (kind === 'sun') {
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.fill();
      for (i = 0; i < 8; i++) {
        a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 24, Math.sin(a) * 24);
        ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
        ctx.stroke();
      }

    } else if (kind === 'hill') {
      ctx.beginPath();
      ctx.moveTo(-34, 22);
      ctx.lineTo(-7, -22);
      ctx.lineTo(20, 22);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.55;
      ctx.beginPath();
      ctx.moveTo(-2, 22);
      ctx.lineTo(17, -10);
      ctx.lineTo(36, 22);
      ctx.closePath();
      ctx.fill();

    } else if (kind === 'tree') {
      for (i = 0; i < 3; i++) {
        var wTop = 10 + i * 6;
        var yTop = -32 + i * 13;
        ctx.beginPath();
        ctx.moveTo(0, yTop);
        ctx.lineTo(wTop, yTop + 19);
        ctx.lineTo(-wTop, yTop + 19);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillRect(-3.5, 10, 7, 16);

    } else if (kind === 'flame') {
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.quadraticCurveTo(20, -8, 16, 10);
      ctx.quadraticCurveTo(12, 30, 0, 30);
      ctx.quadraticCurveTo(-12, 30, -16, 10);
      ctx.quadraticCurveTo(-20, -8, 0, -34);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.5;
      ctx.fillStyle = '#fff1d8';
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.quadraticCurveTo(9, 4, 7, 13);
      ctx.quadraticCurveTo(4, 22, 0, 22);
      ctx.quadraticCurveTo(-4, 22, -7, 13);
      ctx.quadraticCurveTo(-9, 4, 0, -10);
      ctx.closePath();
      ctx.fill();

    } else if (kind === 'ice') {
      for (i = 0; i < 3; i++) {
        a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * 30, -Math.sin(a) * 30);
        ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
        ctx.stroke();
      }
      for (i = 0; i < 6; i++) {
        a = i * Math.PI / 3;
        var ex = Math.cos(a) * 21;
        var ey = Math.sin(a) * 21;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a - 0.8) * 10, ey - Math.sin(a - 0.8) * 10);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a + 0.8) * 10, ey - Math.sin(a + 0.8) * 10);
        ctx.stroke();
      }

    } else if (kind === 'fist') {
      rr(ctx, -22, -20, 44, 40, 12);
      ctx.fill();
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.45;
      ctx.strokeStyle = '#2a1a18';
      ctx.lineWidth = 2.4;
      for (i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-12 + i * 11, -14);
        ctx.lineTo(-12 + i * 11, -2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-20, 8);
      ctx.lineTo(18, 8);
      ctx.stroke();

    } else if (kind === 'card') {
      ctx.save();
      ctx.rotate(-0.16);
      rr(ctx, -26, -20, 34, 44, 4);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.rotate(0.14);
      rr(ctx, -8, -22, 34, 44, 4);
      ctx.fill();
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.6;
      ctx.fillStyle = '#2a1a2e';
      for (i = 0; i < 2; i++) {
        for (var j = 0; j < 2; j++) {
          ctx.beginPath();
          ctx.arc(1 + i * 15, -10 + j * 15, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();

    } else {
      /* star：五角星 */
      ctx.beginPath();
      for (i = 0; i < 10; i++) {
        a = -Math.PI / 2 + i * Math.PI / 5;
        var r = (i % 2 === 0) ? 32 : 13.5;
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  /* ---------------- 背景：深紫绒桌 + 木框 + 纸纹 ---------------- */
  function buildBackdrop() {
    var c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    var g = c.getContext('2d');

    var bg = g.createLinearGradient(0, 0, 0, VIEW_H);
    bg.addColorStop(0, '#171024');
    bg.addColorStop(0.5, '#1d1430');
    bg.addColorStop(1, '#120c1e');
    g.fillStyle = bg;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 桌面中央的柔光，把视线压到牌阵上 */
    var glow = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 80, VIEW_W / 2, VIEW_H / 2, 620);
    glow.addColorStop(0, 'rgba(169, 138, 224, 0.16)');
    glow.addColorStop(0.6, 'rgba(120, 90, 170, 0.06)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 远处的格窗剪影，给一点室内感 */
    g.strokeStyle = 'rgba(200, 180, 255, 0.05)';
    g.lineWidth = 2;
    for (var i = 0; i < 6; i++) {
      var x = 70 + i * 215;
      g.strokeRect(x, 96, 132, 200);
      g.beginPath();
      g.moveTo(x + 66, 96); g.lineTo(x + 66, 296);
      g.moveTo(x, 196); g.lineTo(x + 132, 196);
      g.stroke();
    }

    /* 纸纹噪点 */
    var rng = mulberry32(9241);
    for (i = 0; i < 2200; i++) {
      var px = rng() * VIEW_W;
      var py = rng() * VIEW_H;
      var a = 0.012 + rng() * 0.03;
      g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
      g.fillRect(px, py, 1.6, 1.6);
    }

    /* 四角暗角 */
    var vig = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 340, VIEW_W / 2, VIEW_H / 2, 820);
    vig.addColorStop(0, 'rgba(6, 4, 12, 0)');
    vig.addColorStop(1, 'rgba(6, 4, 12, 0.62)');
    g.fillStyle = vig;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    return c;
  }

  /* 确定性随机：保证每次开局的牌面分布不同，但同一局内可复算 */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败绝不影响玩法 */ }
  }

  /* ============================================================
   * MemoryScene
   * ============================================================ */
  function MemoryScene() {
    this.t = 0;
    this.state = 'title';
    this.cards = [];
    this.open = [];
    this.lock = 0;
    this.matched = 0;
    this.steps = 0;
    this.time = 0;
    this.best = 0;
    this.newBest = false;
    this.settleT = 0;
    this.btns = [];
    this.pending = null;
    this.bg = null;
    this.canvas = null;
    this._onKey = null;
    this._onClick = null;
    this._onBlur = null;
  }

  MemoryScene.prototype.init = function (ctx) {
    var self = this;

    this.t = 0;
    this.bg = buildBackdrop();
    this.best = readBest();
    this.canvas = (ctx && ctx.canvas) || global.SceneManager.canvas;

    this.layout();
    this.reset();

    this._onKey = function (e) { self.onKey(e); };
    this._onClick = function (e) { self.onClick(e); };
    this._onBlur = function () { self.open.length = 0; };

    global.addEventListener('keydown', this._onKey);
    global.addEventListener('blur', this._onBlur);
    if (this.canvas) this.canvas.addEventListener('click', this._onClick);

    if (global.HUD) global.HUD.toast('');
  };

  /* 32 张牌：8 种符号各 4 张，洗牌后按 8×4 摆好 */
  MemoryScene.prototype.layout = function () {
    var deck = [];
    var i, j;
    for (i = 0; i < KINDS.length; i++) {
      for (j = 0; j < COPIES; j++) deck.push({ kind: KINDS[i].id, color: KINDS[i].color });
    }

    /* Fisher-Yates，用 Math.random：每局都不一样 */
    for (i = deck.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }

    this.cards = [];
    for (i = 0; i < deck.length; i++) {
      var col = i % COLS;
      var row = Math.floor(i / COLS);
      this.cards.push({
        x: X0 + col * (CARD_W + GAP_X),
        y: Y0 + row * (CARD_H + GAP_Y),
        kind: deck[i].kind,
        color: deck[i].color,
        up: false,          /* 逻辑：是否朝上 */
        done: false,        /* 已配对（常亮） */
        k: 0,               /* 视觉开合度 0..1，供翻转动画插值 */
        hint: 0             /* 配对时的金边余晖 */
      });
    }
  };

  MemoryScene.prototype.reset = function () {
    var i;
    for (i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      c.up = false;
      c.done = false;
      c.k = 0;
      c.hint = 0;
    }
    this.state = 'title';
    this.open = [];
    this.lock = 0;
    this.matched = 0;
    this.steps = 0;
    this.time = 0;
    this.newBest = false;
    this.settleT = 0;
    this.btns = [];
  };

  MemoryScene.prototype.restart = function () {
    this.layout();
    this.reset();
    if (global.HUD) global.HUD.toast('');
  };

  /* ---------------- 输入 ---------------- */
  MemoryScene.prototype.onKey = function (e) {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.toHall();
      return;
    }
    if (this.state === 'settle' && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space')) {
      e.preventDefault();
      this.restart();
    }
  };

  MemoryScene.prototype.pointAt = function (e) {
    var c = this.canvas;
    if (!c) return null;
    var r = c.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: (e.clientX - r.left) * (VIEW_W / r.width),
      y: (e.clientY - r.top) * (VIEW_H / r.height)
    };
  };

  MemoryScene.prototype.onClick = function (e) {
    var p = this.pointAt(e);
    if (!p) return;

    if (this.state === 'settle') {
      for (var i = 0; i < this.btns.length; i++) {
        var b = this.btns[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          sfx('ui');
          if (b.id === 'again') this.restart();
          else this.toHall();
          return;
        }
      }
      return;
    }

    /* 点牌：命中取最后一张（重叠时以右下为准） */
    var hit = null;
    for (i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      if (p.x >= c.x && p.x <= c.x + CARD_W && p.y >= c.y && p.y <= c.y + CARD_H) hit = c;
    }
    if (hit) this.pick(hit);
  };

  MemoryScene.prototype.pick = function (card) {
    if (this.lock > 0) return;                 /* 结算/翻回期间锁定 */
    if (card.up || card.done) return;          /* 已翻开或已配对 */
    if (this.open.length >= 2) return;

    if (this.state === 'title') {
      this.state = 'playing';                  /* 第一张牌即开始计时 */
      this.time = 0;
    }
    if (this.state !== 'playing') return;

    card.up = true;
    this.open.push(card);
    this.steps += 1;
    sfx('ui');

    if (this.open.length === 2) {
      var a = this.open[0];
      var b = this.open[1];
      if (a.kind === b.kind) {
        /* 配对成功：等翻牌动画走完再亮金边 */
        var self = this;
        this.lock = FLIP_T + 0.02;
        this.pending = function () {
          a.done = b.done = true;
          a.hint = b.hint = 1;
          self.matched += 1;
          self.open.length = 0;
          self.lock = 0;
          sfx('match');
          if (self.matched >= PAIRS) self.finish();
        };
      } else {
        this.lock = FLIP_T + MISS_HOLD;
        var self2 = this;
        this.pending = function () {
          a.up = false;
          b.up = false;
          self2.open.length = 0;
          self2.lock = 0;
        };
        sfx('miss');
      }
    }
  };

  MemoryScene.prototype.finish = function () {
    this.state = 'settle';
    this.settleT = 0;
    this.newBest = false;

    var t = Math.round(this.time * 10) / 10;
    if (!this.best || t < this.best) {
      this.best = t;
      this.newBest = true;
      writeBest(t);
    }
    sfx('win');
  };

  /* ---------------- 更新 ---------------- */
  MemoryScene.prototype.update = function (dt) {
    this.t += dt;
    var i;

    if (this.state === 'playing') this.time += dt;
    if (this.state === 'settle') this.settleT += dt;

    if (this.lock > 0) {
      this.lock -= dt;
      if (this.lock <= 0) {
        this.lock = 0;
        var fn = this.pending;
        this.pending = null;
        if (fn) fn();
      }
    }

    /* 翻牌动画：0.12s 走完一张 */
    var rate = 1 / FLIP_T;
    for (i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      var target = (c.up || c.done) ? 1 : 0;
      if (c.k < target) c.k = Math.min(target, c.k + rate * dt);
      else if (c.k > target) c.k = Math.max(target, c.k - rate * dt);
      if (c.hint > 0) c.hint = Math.max(0, c.hint - dt * 1.2);
    }
  };

  /* ---------------- 渲染 ---------------- */
  MemoryScene.prototype.render = function (ctx) {
    ctx.drawImage(this.bg, 0, 0);

    /* 浮尘 */
    var i;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < 26; i++) {
      var seed = i * 97.31;
      var mx = ((seed * 7.13) % VIEW_W);
      var my = ((seed * 3.7 + this.t * (6 + (i % 5) * 3)) % VIEW_H);
      var ma = 0.05 + 0.10 * Math.abs(Math.sin(this.t * 0.8 + i));
      ctx.fillStyle = 'rgba(200, 180, 255, ' + ma.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(mx, my, 1.4 + (i % 3) * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.drawCards(ctx);
    this.drawHud(ctx);
    if (this.state === 'settle') this.drawSettle(ctx);
  };

  MemoryScene.prototype.drawCards = function (ctx) {
    for (var i = 0; i < this.cards.length; i++) {
      var c = this.cards[i];
      var sx = Math.abs(Math.cos(c.k * Math.PI));    /* 0→1 的横向压缩，做出翻转感 */
      var face = c.k > 0.5;

      ctx.save();
      ctx.translate(c.x + CARD_W / 2, c.y + CARD_H / 2);
      ctx.scale(Math.max(0.02, sx), 1);

      if (!face) {
        drawBack(ctx, c);
      } else {
        drawFace(ctx, c);
      }
      ctx.restore();

      /* 已配对的淡金描边（画在翻转之外，始终可见） */
      if (c.done) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 215, 154, ' + (0.5 + 0.3 * Math.sin(this.t * 2.2 + i)).toFixed(3) + ')';
        ctx.lineWidth = 2;
        rr(ctx, c.x + 1, c.y + 1, CARD_W - 2, CARD_H - 2, 12);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  function drawBack(ctx, c) {
    var w = CARD_W;
    var h = CARD_H;
    var g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    g.addColorStop(0, '#5b4685');
    g.addColorStop(0.5, '#493572');
    g.addColorStop(1, '#392a5e');

    ctx.save();
    ctx.shadowColor = 'rgba(4, 2, 10, 0.55)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    rr(ctx, -w / 2, -h / 2, w, h, 11);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    /* 内侧一圈亮边 */
    rr(ctx, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 8);
    ctx.strokeStyle = 'rgba(198, 172, 255, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* 斜纹织理 */
    ctx.save();
    rr(ctx, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 8);
    ctx.clip();
    ctx.strokeStyle = 'rgba(198, 172, 255, 0.10)';
    ctx.lineWidth = 1;
    for (var i = -h; i < w + h; i += 11) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 + i, h / 2);
      ctx.lineTo(-w / 2 + i + h, -h / 2);
      ctx.stroke();
    }
    ctx.restore();

    /* 中央小纹章：四角星 */
    ctx.save();
    ctx.fillStyle = 'rgba(198, 172, 255, 0.30)';
    ctx.beginPath();
    for (var k = 0; k < 8; k++) {
      var a = -Math.PI / 2 + k * Math.PI / 4;
      var r = (k % 2 === 0) ? 16 : 6.5;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFace(ctx, c) {
    var w = CARD_W;
    var h = CARD_H;

    ctx.save();
    ctx.shadowColor = 'rgba(4, 2, 10, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    rr(ctx, -w / 2, -h / 2, w, h, 11);
    ctx.fillStyle = '#f4e8d4';
    ctx.fill();
    ctx.restore();

    /* 纸面纹理（斜向极淡） */
    ctx.save();
    rr(ctx, -w / 2, -h / 2, w, h, 11);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(-w / 2, -h / 2, w, 3);
    ctx.fillStyle = 'rgba(120, 96, 70, 0.05)';
    for (var i = 0; i < 18; i++) {
      ctx.fillRect(-w / 2 + (i * 37) % w, -h / 2 + (i * 53) % h, 2, 2);
    }
    ctx.restore();

    rr(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 11);
    ctx.strokeStyle = 'rgba(120, 96, 70, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    drawSymbol(ctx, c.kind, 0, 2, 1, c.color, 0.94);

    /* 四角小点：方便数牌，也压住卡片重心 */
    ctx.fillStyle = c.color;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(-w / 2 + 13, -h / 2 + 13, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2 - 13, h / 2 - 13, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  MemoryScene.prototype.drawHud = function (ctx) {
    ctx.save();
    ctx.textBaseline = 'middle';

    /* 顶部一条淡色压边，让 HUD 与牌阵分开 */
    var g = ctx.createLinearGradient(0, 0, 0, Y0);
    g.addColorStop(0, 'rgba(8, 6, 16, 0.72)');
    g.addColorStop(1, 'rgba(8, 6, 16, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, Y0);

    var y = Y0 / 2 + 2;
    ctx.textAlign = 'left';
    ctx.font = '500 15px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('已配对', 34, y);
    ctx.fillStyle = C.paper;
    ctx.font = '600 19px ' + SERIF;
    ctx.fillText(this.matched + ' / ' + PAIRS, 94, y);

    ctx.textAlign = 'center';
    ctx.font = '500 15px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('用时 ' + this.time.toFixed(1) + ' s', VIEW_W / 2 - 70, y);

    ctx.fillStyle = C.faint;
    ctx.fillText('·', VIEW_W / 2 + 4, y);

    ctx.fillStyle = C.dim;
    ctx.fillText('步数 ' + this.steps, VIEW_W / 2 + 76, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = C.faint;
    ctx.fillText('最佳 ' + (this.best ? this.best.toFixed(1) + ' s' : '—'), VIEW_W - 34, y);

    /* 底部提示 */
    ctx.textAlign = 'center';
    ctx.font = '400 14px ' + SANS;
    ctx.fillStyle = this.state === 'title' ? 'rgba(255, 215, 154, ' + (0.55 + 0.3 * Math.sin(this.t * 3)).toFixed(3) + ')' : C.faint;
    ctx.fillText(
      this.state === 'title' ? '点击任意牌开始计时 · Esc 返回大厅' : '单击翻牌 · Esc 返回大厅',
      VIEW_W / 2, VIEW_H - Y0 / 2 - 2
    );

    ctx.restore();
  };

  MemoryScene.prototype.drawSettle = function (ctx) {
    var a = clamp(this.settleT / 0.22, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8, 6, 15, 0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var w = 520;
    var h = 380;
    var x = (VIEW_W - w) / 2;
    var y = (VIEW_H - h) / 2 - 6;

    panel(ctx, x, y, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = C.gold;
    ctx.font = '600 20px ' + SANS;
    ctx.fillText('全 部 配 对', x + w / 2, y + 58);

    ctx.fillStyle = C.paper;
    ctx.font = '700 56px ' + SERIF;
    var tstr = this.time.toFixed(1);
    var nw = ctx.measureText(tstr).width;
    ctx.font = '500 22px ' + SANS;
    var uw = ctx.measureText('秒').width;
    var tx = x + w / 2 - (nw + 12 + uw) / 2;
    ctx.textAlign = 'left';
    ctx.font = '700 56px ' + SERIF;
    ctx.fillText(tstr, tx, y + 128);
    ctx.font = '500 22px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('秒', tx + nw + 12, y + 140);
    ctx.textAlign = 'center';

    ctx.font = '500 17px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.6)';
    ctx.fillText('用了 ' + this.steps + ' 步 · 16 对', x + w / 2, y + 184);

    if (this.newBest) {
      ctx.fillStyle = C.gold;
      ctx.font = '600 18px ' + SERIF;
      ctx.fillText('新纪录！', x + w / 2, y + 220);
    } else {
      ctx.fillStyle = C.faint;
      ctx.font = '500 15px ' + SANS;
      ctx.fillText('最佳 ' + this.best.toFixed(1) + ' s', x + w / 2, y + 220);
    }

    this.btns = [
      { id: 'again', x: x + 40, y: y + 258, w: 200, h: 54, label: '再来一局' },
      { id: 'hall', x: x + w - 240, y: y + 258, w: 200, h: 54, label: '回大厅' }
    ];
    button(ctx, this.btns[0].x, this.btns[0].y, 200, 54, this.btns[0].label, true);
    button(ctx, this.btns[1].x, this.btns[1].y, 200, 54, this.btns[1].label, false);

    ctx.font = '400 13px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.32)';
    ctx.fillText('Enter 再来一局 · Esc 回大厅', x + w / 2, y + 340);

    ctx.restore();
  };

  /* ---------------- 生命周期 ---------------- */
  MemoryScene.prototype.toHall = function () {
    if (global.SceneManager) global.SceneManager.change('world');
  };

  MemoryScene.prototype.destroy = function () {
    global.removeEventListener('keydown', this._onKey);
    global.removeEventListener('blur', this._onBlur);
    if (this.canvas && this._onClick) this.canvas.removeEventListener('click', this._onClick);

    this._onKey = null;
    this._onClick = null;
    this._onBlur = null;
    this.canvas = null;
    this.cards.length = 0;
    this.open.length = 0;
    this.btns.length = 0;
    this.pending = null;
    this.bg = null;
  };

  /* ---------------- 最佳成绩：file:// 下 localStorage 可能被禁 ---------------- */
  var BEST_KEY = 'worldhub.memory.best';

  function readBest() {
    try {
      var v = parseFloat(global.localStorage.getItem(BEST_KEY));
      return isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : 0;
    } catch (err) {
      return 0;
    }
  }

  function writeBest(v) {
    try {
      global.localStorage.setItem(BEST_KEY, String(v));
    } catch (err) { /* 忽略 */ }
  }

  global.MemoryScene = MemoryScene;
  if (global.SceneManager) {
    global.SceneManager.register('memory', function () { return new MemoryScene(); });
  }
})(window);
