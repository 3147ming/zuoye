/* ============================================================
 * fight.js —— 二人格斗 Duel
 * ------------------------------------------------------------
 * 固定 1280×720 横版对打，无摄像机滚动。三局两胜。
 *   双人对战：P1 键盘左半边，P2 键盘右半边，互不干扰
 *   挑战 AI：玩家固定是 P1，P2 由状态机驱动
 *
 * 数值口径（全部可按本文件的常量复算，别信手感去改）：
 *   移动 320 px/s，跳跃 vy=-700，重力 2200
 *   拳：范围 50 / 伤害 8 / 冷却 0.35s
 *   踢：范围 75 / 伤害 14 / 冷却 0.85s
 *   HP 100，受击硬直 0.2s，击退 vx=350，无敌帧 0.5s，飘字 0.6s
 *   每局 60 秒，先拿 2 局者胜
 *
 * 能量必杀（第三批新增）：
 *   能量 0~100，拳中 +8 / 踢中 +12 / 被打 +6，自己血量 ≤30 时上述全部 ×2
 *   P1 按 L、P2 按 3 释放；满能量才成立，伤害 30、击退 550、释放瞬间 0.6s 无敌
 *   命中判定沿用拳的 hitBox（不另开判定框）
 * ============================================================ */
(function (global) {
  'use strict';

  var VIEW_W = 1280;
  var VIEW_H = 720;

  var GROUND_Y = 640;          /* 地面顶面（脚底所在的 y） */
  var MIN_X = 40;
  var MAX_X = 1240;

  var MOVE_V = 320;
  var JUMP_VY = -700;
  var GRAVITY = 2200;

  var PUNCH = { range: 50, dmg: 8, cd: 0.35, dur: 0.26, from: 0.06, to: 0.17 };
  var KICK = { range: 75, dmg: 14, cd: 0.85, dur: 0.40, from: 0.10, to: 0.24 };
  var DIVE_VY = 1050;          /* 空中攻击：改成向下砸 */
  var DIVE_DMG = 8;            /* 伤害同拳 */

  var HP_MAX = 100;
  var HITSTUN = 0.2;
  var KNOCK_V = 350;
  var INVULN = 0.5;
  var FLOAT_LIFE = 0.6;
  var ROUND_TIME = 60;
  var NEED_WIN = 2;

  /* ---- 能量必杀 ---- */
  var METER_MAX = 100;         /* 满格 */
  var METER_PUNCH = 8;         /* 拳命中 */
  var METER_KICK = 12;         /* 踢命中 */
  var METER_TAKEN = 6;         /* 被击中 */
  var METER_LOW_HP = 30;       /* 血量 ≤ 30 时获取翻倍 */
  var METER_LOW_MUL = 2;
  var ULT_DMG = 30;
  var ULT_KNOCK = 550;
  var ULT_INV = 0.6;           /* 释放瞬间的无敌 */
  var ULT_DUR = 0.5;           /* 整套动作时长 */
  var ULT_FROM = 0.08;         /* 判定开窗 */
  var ULT_TO = 0.34;
  var ULT_CD = 0.9;

  var BODY_W = 54;             /* 受击框宽 */
  var BODY_H = 118;            /* 受击框高（脚底往上） */
  var DRAW_S = 1.72;           /* 角色绘制缩放：原始画笔按 70px 高画，乘上去才够看 */

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  var C = {
    paper: '#fdf3e4',
    dim: 'rgba(253, 243, 228, 0.46)',
    faint: 'rgba(253, 243, 228, 0.22)',
    p1: '#c9532f',
    p1Dark: '#4a1d22',
    p2: '#5fc3ff',
    p2Dark: '#153a5e',
    warm: '#f0a066',
    ground: '#1a1527',
    panel: 'rgba(20, 15, 34, 0.92)'
  };

  /* ---------------- 小工具 ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  function rr(ctx, x, y, w, h, r) {
    var k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
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

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* 两个矩形是否相交 */
  function hitRect(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /* 退化色：让血条有「亮面→本色」的立体感 */
  function tint(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * k);
    g = Math.round(g + (255 - g) * k);
    b = Math.round(b + (255 - b) * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  /* ---------------- 竞技场背景（一次性烘焙） ---------------- */

  function buildArena() {
    var S = 2;
    var cv = makeCanvas(VIEW_W * S, VIEW_H * S);
    var g = cv.getContext('2d');
    g.setTransform(S, 0, 0, S, 0, 0);

    var i, x, y;

    /* 天空：黄昏从紫灰压到暖橙 */
    var sky = g.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#150e21');
    sky.addColorStop(0.30, '#281739');
    sky.addColorStop(0.55, '#4b2440');
    sky.addColorStop(0.72, '#8a4038');
    sky.addColorStop(0.88, '#c9703f');
    sky.addColorStop(1, '#e79a52');
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, GROUND_Y);

    /* 落日 + 暖背光：整场的唯一光源（放在山脊线上方，否则会被剪影吃掉） */
    var sun = g.createRadialGradient(780, 470, 10, 780, 470, 560);
    sun.addColorStop(0, 'rgba(255, 232, 190, 0.95)');
    sun.addColorStop(0.18, 'rgba(248, 186, 118, 0.52)');
    sun.addColorStop(0.52, 'rgba(214, 116, 66, 0.20)');
    sun.addColorStop(1, 'rgba(120, 54, 52, 0)');
    g.fillStyle = sun;
    g.fillRect(0, 60, VIEW_W, GROUND_Y - 60);

    g.fillStyle = 'rgba(255, 242, 214, 0.92)';
    g.beginPath();
    g.arc(780, 470, 54, 0, Math.PI * 2);
    g.fill();

    /* 远山：一条压得很低的折线山脊 */
    var rng = mulberry32(20251102);

    function ridge(baseY, amp, color, seedShift) {
      g.beginPath();
      g.moveTo(-40, baseY + 160);
      var px = -40;
      var py = baseY;
      g.lineTo(px, py);
      for (x = 0; x <= VIEW_W + 60; x += 46) {
        var n = Math.sin((x + seedShift) * 0.0062) * 0.6 +
                Math.sin((x + seedShift) * 0.017) * 0.4;
        y = baseY - amp * (0.5 + n * 0.5) - rng() * 10;
        g.lineTo(x, y);
        px = x; py = y;
      }
      g.lineTo(VIEW_W + 40, baseY + 160);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    }

    ridge(528, 76, '#2b1c38', 0);
    ridge(600, 40, '#1f1430', 900);

    /* 平台剪影：两侧的断柱，把画面框住 */
    function pillar(px, pw, ph, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(px - pw / 2, GROUND_Y);
      g.lineTo(px - pw / 2 + 3, GROUND_Y - ph);
      g.lineTo(px + pw / 2 - 4, GROUND_Y - ph - 6);
      g.lineTo(px + pw / 2, GROUND_Y);
      g.closePath();
      g.fill();
      /* 迎光的一侧留一道暖边 */
      g.strokeStyle = 'rgba(240, 167, 110, 0.20)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px - pw / 2 + 3, GROUND_Y - ph);
      g.lineTo(px - pw / 2, GROUND_Y);
      g.stroke();
    }
    pillar(96, 62, 250, '#150e22');
    pillar(1186, 70, 268, '#150e22');
    pillar(408, 34, 150, '#170f24');
    pillar(880, 38, 164, '#170f24');

    /* 地面平台 */
    var fl = g.createLinearGradient(0, GROUND_Y, 0, VIEW_H);
    fl.addColorStop(0, C.ground);
    fl.addColorStop(0.35, '#120d1e');
    fl.addColorStop(1, '#08060f');
    g.fillStyle = fl;
    g.fillRect(0, GROUND_Y, VIEW_W, VIEW_H - GROUND_Y);

    /* 地平线上的一道暖色边 —— 剪纸的「纸边」感全靠它 */
    g.fillStyle = 'rgba(240, 167, 110, 0.55)';
    g.fillRect(0, GROUND_Y - 2, VIEW_W, 2.5);
    var rim = g.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 26);
    rim.addColorStop(0, 'rgba(240, 167, 110, 0.22)');
    rim.addColorStop(1, 'rgba(240, 167, 110, 0)');
    g.fillStyle = rim;
    g.fillRect(0, GROUND_Y, VIEW_W, 26);

    /* 地面砖缝：等距的短竖线，压暗 */
    g.strokeStyle = 'rgba(0, 0, 0, 0.30)';
    g.lineWidth = 2;
    for (x = 60; x < VIEW_W; x += 80) {
      g.beginPath();
      g.moveTo(x, GROUND_Y + 6);
      g.lineTo(x - 8, VIEW_H);
      g.stroke();
    }

    /* 纸纹：稀疏的白色斑点，别太密否则像噪点 */
    var grng = mulberry32(90210);
    for (i = 0; i < 900; i++) {
      x = grng() * VIEW_W;
      y = grng() * VIEW_H;
      var a = grng() * 0.05;
      g.fillStyle = 'rgba(255, 240, 216, ' + a.toFixed(3) + ')';
      g.fillRect(x, y, 2, 2);
    }

    /* 暗角 */
    var vg = g.createRadialGradient(640, 420, 220, 640, 420, 820);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(6, 4, 12, 0.72)');
    g.fillStyle = vg;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    return cv;
  }

  /* ---------------- AI：纯决策函数 ---------------- */
  /*
   * 只吃四个量：与玩家的水平距离、自己的血量、自己的能量、三个 0~1 随机数。
   * 不读玩家输入、不读玩家血量，方便事后复算「它当时为什么这么打」。
   * 返回 { kind, t, jump, atk?, then? }
   */
  var AI_RANGE = 260;      /* 超过这个距离先靠近，进入后开始出招 */
  var AI_REACH = 84;       /* 够得着的距离：拳要 <87、踢要 <110 */
  var AI_STOP = 96;        /* 靠到这么近就不用再往前挤 */

  function aiDecide(dist, hp, meter, r1, r2, r3) {
    /* 能量满了又够得着：先放必杀，放完能量归零回到常规决策 */
    if (meter >= METER_MAX && dist <= AI_REACH) {
      return { kind: 'ult', t: 0.55, jump: false };
    }
    /* 血少时优先保命 */
    if (hp < 30 && r1 < 0.40) return { kind: 'retreat', t: 0.6, jump: false };
    if (dist > AI_RANGE) {
      return { kind: 'approach', t: 0.35, jump: r2 < 0.20 };
    }
    /* 进入出招距离：50/50 拳或踢，打完 0.5 秒随机进退 */
    return {
      kind: 'strike',
      t: 0.5,
      jump: false,
      atk: (r2 < 0.5) ? 'punch' : 'kick',
      then: (r3 < 0.5) ? 'retreat' : 'approach'
    };
  }

  /* ---------------- 角色 ---------------- */

  function mkFighter(id, label, color, dark, x) {
    return {
      id: id,
      label: label,
      color: color,
      dark: dark,
      x: x,
      y: GROUND_Y,
      vx: 0,
      vy: 0,
      facing: id === 'p1' ? 1 : -1,
      onGround: true,
      hp: HP_MAX,
      wins: 0,
      meter: 0,          /* 能量 0~100 */
      ultFlash: 0,       /* 释放后的余韵光 */
      stun: 0,
      invuln: 0,
      barFlash: 0,
      hurt: 0,
      cdP: 0,
      cdK: 0,
      attack: null,
      walk: 0,
      jumpBuf: 0
    };
  }

  /* ---------------- 场景 ---------------- */

  function FightScene() {
    this.t = 0;
    this.state = 'menu';         /* menu | playing | settle */
    this.phase = 'fight';        /* fight | over（局间） */
    this.mode = '2p';            /* 2p | ai */
    this.time = ROUND_TIME;
    this.round = 1;
    this.winner = null;
    this.roundMsg = '';
    this.shake = 0;
    this.announce = 0;
    this.floats = [];
    this.motes = [];
    this.ultFx = 0;              /* 必杀冲击波余量 1 → 0 */
    this.ultAt = null;           /* 冲击波中心 */
    this.btn = null;             /* 当前面板上的按钮矩形 */
    this.menuBtns = [];
    this.overBtns = [];
    this.keys = {
      p1: { left: false, right: false },
      p2: { left: false, right: false }
    };
    this.p1 = mkFighter('p1', 'P1', C.p1, C.p1Dark, 420);
    this.p2 = mkFighter('p2', 'P2', C.p2, C.p2Dark, 860);
    this.ai = { plan: null, next: null, cd: 0 };
    this.drawRound = false;
  }

  /* ---------- 生命周期 ---------- */

  FightScene.prototype.init = function (ctx) {
    var self = this;

    this.canvas = (ctx && ctx.canvas) || (global.SceneManager && global.SceneManager.canvas);
    this.bg = buildArena();

    this.t = 0;
    this.state = 'menu';
    this.phase = 'fight';
    this.winner = null;
    this.floats.length = 0;
    this.shake = 0;
    this.announce = 0;
    this.p1.wins = 0;
    this.p2.wins = 0;
    this.round = 1;
    this.btn = null;

    var rng = mulberry32(54321);
    this.motes.length = 0;
    for (var i = 0; i < 34; i++) {
      this.motes.push({
        x: rng() * VIEW_W,
        y: 200 + rng() * 430,
        r: 0.8 + rng() * 2.1,
        v: 4 + rng() * 14,
        p: rng() * Math.PI * 2,
        s: 0.35 + rng() * 0.8
      });
    }

    this.resetRound();

    this._onKey = function (e) { self.onKey(e); };
    this._onKeyUp = function (e) { self.onKeyUp(e); };
    this._onClick = function (e) { self.onClick(e); };
    this._onBlur = function () { self.clearKeys(); };

    global.addEventListener('keydown', this._onKey);
    global.addEventListener('keyup', this._onKeyUp);
    global.addEventListener('blur', this._onBlur);
    if (this.canvas) this.canvas.addEventListener('click', this._onClick);

    if (global.HUD) global.HUD.toast('');
  };

  FightScene.prototype.clearKeys = function () {
    var k = this.keys;
    k.p1.left = false; k.p1.right = false;
    k.p2.left = false; k.p2.right = false;
    this.p1.jumpBuf = 0;
    this.p2.jumpBuf = 0;
  };

  FightScene.prototype.destroy = function () {
    global.removeEventListener('keydown', this._onKey);
    global.removeEventListener('keyup', this._onKeyUp);
    global.removeEventListener('blur', this._onBlur);
    if (this.canvas) this.canvas.removeEventListener('click', this._onClick);
    this._onKey = this._onKeyUp = this._onClick = this._onBlur = null;
    this.floats.length = 0;
    this.motes.length = 0;
    this.bg = null;
  };

  /* ---------- 开一局 ---------- */

  FightScene.prototype.resetRound = function () {
    var a = this.p1, b = this.p2;

    a.x = 420; a.y = GROUND_Y; a.vx = 0; a.vy = 0;
    b.x = 860; b.y = GROUND_Y; b.vx = 0; b.vy = 0;
    a.facing = 1; b.facing = -1;

    for (var i = 0, list = [a, b]; i < 2; i++) {
      var f = list[i];
      f.hp = HP_MAX;
      f.meter = 0;
      f.ultFlash = 0;
      f.stun = 0;
      f.invuln = 0;
      f.barFlash = 0;
      f.hurt = 0;
      f.cdP = 0;
      f.cdK = 0;
      f.attack = null;
      f.onGround = true;
      f.walk = 0;
      f.jumpBuf = 0;
    }

    this.time = ROUND_TIME;
    this.phase = 'fight';
    this.floats.length = 0;
    this.shake = 0;
    this.ultFx = 0;
    this.ultAt = null;
    this.announce = 1.1;
    this.ai.plan = null;
    this.ai.next = null;
    this.ai.cd = 0;
    this.btn = null;
    this.drawRound = false;
    this.clearKeys();
  };

  /* ---------- 输入 ---------- */

  FightScene.prototype.onKey = function (e) {
    var code = e.code;

    if (code === 'Escape') {
      e.preventDefault();
      this.toHall();
      return;
    }

    /* 主菜单：键 1/2 也能选，省得非要点鼠标 */
    if (this.state === 'menu') {
      if (code === 'Digit1' || code === 'Numpad1') { e.preventDefault(); this.startMatch('2p'); return; }
      if (code === 'Digit2' || code === 'Numpad2') { e.preventDefault(); this.startMatch('ai'); return; }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
        e.preventDefault(); this.startMatch('ai'); return;
      }
      return;
    }

    /* 结算 / 局间：Enter、空格推进 */
    if (this.state === 'settle') {
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
        e.preventDefault();
        this.toHall();
      }
      return;
    }

    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      e.preventDefault();
      if (this.phase === 'over') this.nextRound();
      return;
    }

    if (this.phase !== 'fight') return;

    var k = this.keys;

    /* ---- P1 ---- */
    if (code === 'KeyA') { k.p1.left = true; e.preventDefault(); return; }
    if (code === 'KeyD') { k.p1.right = true; e.preventDefault(); return; }
    if (code === 'KeyW') {
      if (!e.repeat) this.p1.jumpBuf = 0.12;
      e.preventDefault();
      return;
    }
    if (code === 'KeyJ') { if (!e.repeat) this.tryAttack(this.p1, 'punch'); e.preventDefault(); return; }
    if (code === 'KeyK') { if (!e.repeat) this.tryAttack(this.p1, 'kick'); e.preventDefault(); return; }
    if (code === 'KeyL') { if (!e.repeat) this.tryUlt(this.p1); e.preventDefault(); return; }

    /* ---- P2 ---- */
    if (code === 'ArrowLeft') { k.p2.left = true; e.preventDefault(); return; }
    if (code === 'ArrowRight') { k.p2.right = true; e.preventDefault(); return; }
    if (code === 'ArrowUp') {
      if (!e.repeat) this.p2.jumpBuf = 0.12;
      e.preventDefault();
      return;
    }
    if (code === 'Digit1' || code === 'Numpad1') {
      if (!e.repeat) this.tryAttack(this.p2, 'punch');
      e.preventDefault();
      return;
    }
    if (code === 'Digit2' || code === 'Numpad2') {
      if (!e.repeat) this.tryAttack(this.p2, 'kick');
      e.preventDefault();
      return;
    }
    if (code === 'Digit3' || code === 'Numpad3') {
      if (!e.repeat) this.tryUlt(this.p2);
      e.preventDefault();
      return;
    }
  };

  FightScene.prototype.onKeyUp = function (e) {
    var k = this.keys;
    switch (e.code) {
      case 'KeyA': k.p1.left = false; break;
      case 'KeyD': k.p1.right = false; break;
      case 'ArrowLeft': k.p2.left = false; break;
      case 'ArrowRight': k.p2.right = false; break;
      default: break;
    }
  };

  FightScene.prototype.onClick = function (e) {
    var c = this.canvas;
    if (!c) return;
    var r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var x = (e.clientX - r.left) * VIEW_W / r.width;
    var y = (e.clientY - r.top) * VIEW_H / r.height;

    function inside(b) {
      return b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    }

    var i, list;
    if (this.state === 'menu') {
      list = this.menuBtns;
      for (i = 0; i < list.length; i++) {
        if (inside(list[i])) { this.startMatch(list[i].mode); return; }
      }
      return;
    }
    if (this.state === 'settle') {
      if (inside(this.btn)) this.toHall();
      return;
    }
    if (this.phase === 'over') {
      if (inside(this.btn)) this.nextRound();
    }
  };

  FightScene.prototype.toHall = function () {
    if (global.SceneManager) global.SceneManager.change('world');
  };

  /* ---------- 对局流程 ---------- */

  FightScene.prototype.startMatch = function (mode) {
    this.mode = mode === 'ai' ? 'ai' : '2p';
    this.p1.wins = 0;
    this.p2.wins = 0;
    this.round = 1;
    this.winner = null;
    this.state = 'playing';
    this.p2.label = this.mode === 'ai' ? 'AI' : 'P2';
    this.resetRound();
    if (global.HUD) global.HUD.toast('');
  };

  FightScene.prototype.nextRound = function () {
    /* 平局是「重赛本局」，局数不加 */
    if (!this.drawRound) this.round += 1;
    this.resetRound();
  };

  FightScene.prototype.endRound = function (winner) {
    this.phase = 'over';
    this.btn = null;
    this.drawRound = (winner === null);

    if (winner === 'p1') { this.p1.wins += 1; this.roundMsg = 'P1 拿下本局'; }
    else if (winner === 'p2') { this.p2.wins += 1; this.roundMsg = this.p2.label + ' 拿下本局'; }
    else { this.roundMsg = '双方血量相同 · 本局重赛'; }

    this.p1.attack = null;
    this.p2.attack = null;
    this.clearKeys();

    if (this.p1.wins >= NEED_WIN) { this.winner = 'p1'; this.state = 'settle'; }
    else if (this.p2.wins >= NEED_WIN) { this.winner = 'p2'; this.state = 'settle'; }

    /* 只有「挑战 AI」里玩家（P1）赢下整场才算通关；本地 2P 不记 */
    if (this.state === 'settle' && this.winner === 'p1' && this.mode === 'ai' &&
        global.Save && global.Save.complete && !global.Save.isCleared('fight')) {
      global.Save.complete('fight');
    }
    if (this.state === 'settle') sfx('win');
  };

  /* ---------- 攻击 ---------- */

  FightScene.prototype.tryAttack = function (f, kind) {
    if (this.phase !== 'fight') return false;
    if (f.stun > 0 || f.attack) return false;

    /* 空中：任何攻击键都变成下落攻击 */
    if (!f.onGround) {
      if (f.cdP > 0) return false;
      f.cdP = PUNCH.cd;
      f.attack = { type: 'dive', t: 0, dur: 999, from: 0, to: 999, hit: false };
      f.vy = DIVE_VY;
      return true;
    }

    var cfg = kind === 'kick' ? KICK : PUNCH;
    if (kind === 'kick' ? f.cdK > 0 : f.cdP > 0) return false;
    if (kind === 'kick') f.cdK = KICK.cd; else f.cdP = PUNCH.cd;

    f.attack = { type: kind, t: 0, dur: cfg.dur, from: cfg.from, to: cfg.to, hit: false };
    return true;
  };

  /* ---------- 能量与必杀 ---------- */

  /* 涨能量：自己血量 ≤30 时全部翻倍，封顶 100 */
  FightScene.prototype.gainMeter = function (f, base) {
    var mul = f.hp <= METER_LOW_HP ? METER_LOW_MUL : 1;
    f.meter = Math.min(METER_MAX, f.meter + base * mul);
    return f.meter;
  };

  FightScene.prototype.tryUlt = function (f) {
    if (this.phase !== 'fight') return false;
    if (f.stun > 0 || f.attack) return false;

    if (f.meter < METER_MAX) {
      /* 没满：只给一句提示，不消耗任何东西 */
      this.floats.push({
        x: f.x, y: f.y - 176, txt: '能量不足', t: 0, life: 0.7, small: true
      });
      sfx('miss');
      return false;
    }

    f.meter = 0;
    f.attack = { type: 'ult', t: 0, dur: ULT_DUR, from: ULT_FROM, to: ULT_TO, hit: false };
    f.invuln = Math.max(f.invuln, ULT_INV);
    f.ultFlash = ULT_INV + 0.2;
    f.cdP = Math.max(f.cdP, ULT_CD);
    f.vx = 0;
    this.shake = Math.max(this.shake, 5);
    sfx('ult');
    return true;
  };

  FightScene.prototype.hurtBox = function (f) {
    return { x: f.x - BODY_W / 2, y: f.y - BODY_H, w: BODY_W, h: BODY_H };
  };

  FightScene.prototype.hitBox = function (f, type) {
    var dir = f.facing;
    function span(off, range) {
      return dir > 0 ? f.x + off : f.x - off - range;
    }
    if (type === 'kick') {
      return { x: span(8, KICK.range), y: f.y - 88, w: KICK.range, h: 64 };
    }
    if (type === 'dive') {
      return { x: f.x - 38, y: f.y - 56, w: 76, h: 74 };
    }
    return { x: span(10, PUNCH.range), y: f.y - 116, w: PUNCH.range, h: 62 };
  };

  FightScene.prototype.applyHit = function (attacker, victim, type) {
    var dmg = type === 'ult' ? ULT_DMG
            : type === 'kick' ? KICK.dmg
            : (type === 'dive' ? DIVE_DMG : PUNCH.dmg);

    victim.hp = Math.max(0, victim.hp - dmg);
    victim.stun = type === 'ult' ? HITSTUN * 1.4 : HITSTUN;
    victim.invuln = type === 'ult' ? INVULN * 1.4 : INVULN;
    victim.barFlash = 0.15;
    victim.hurt = 0.3;
    victim.attack = null;
    victim.vx = attacker.facing * (type === 'ult' ? ULT_KNOCK : KNOCK_V);

    this.floats.push({
      x: victim.x,
      y: victim.y - 134,
      txt: '-' + dmg,
      t: 0,
      life: FLOAT_LIFE
    });

    if (type === 'ult') {
      this.floats.push({
        x: victim.x,
        y: victim.y - 190,
        txt: '必杀！',
        t: 0,
        life: 0.9,
        big: true
      });
      this.ultFx = 1;
      this.ultAt = { x: (attacker.x + victim.x) / 2, y: victim.y - 74 };
      this.shake = 18;
      sfx('ult');
    } else {
      this.shake = type === 'kick' ? 9 : 6;
      if (type === 'kick') sfx('kick'); else sfx('hit');
    }

    /* 能量：拳/踢命中按招式给；必杀本身不涨能量；挨打的按「被击中」给 */
    if (type !== 'ult') {
      this.gainMeter(attacker, type === 'kick' ? METER_KICK : METER_PUNCH);
    }
    this.gainMeter(victim, METER_TAKEN);
  };

  FightScene.prototype.checkHits = function () {
    var pair = [this.p1, this.p2];
    for (var i = 0; i < 2; i++) {
      var at = pair[i];
      var df = pair[1 - i];
      var a = at.attack;
      if (!a || a.hit) continue;
      if (a.t < a.from || a.t > a.to) continue;
      if (df.invuln > 0 || df.hp <= 0) continue;
      if (!hitRect(this.hitBox(at, a.type), this.hurtBox(df))) continue;
      a.hit = true;
      this.applyHit(at, df, a.type);
    }
  };

  /* ---------- 单角色推进 ---------- */

  FightScene.prototype.stepFighter = function (f, dt, ctrl) {
    if (f.cdP > 0) f.cdP = Math.max(0, f.cdP - dt);
    if (f.cdK > 0) f.cdK = Math.max(0, f.cdK - dt);
    if (f.invuln > 0) f.invuln = Math.max(0, f.invuln - dt);
    if (f.ultFlash > 0) f.ultFlash = Math.max(0, f.ultFlash - dt);
    if (f.barFlash > 0) f.barFlash = Math.max(0, f.barFlash - dt);
    if (f.hurt > 0) f.hurt = Math.max(0, f.hurt - dt);
    if (f.stun > 0) f.stun = Math.max(0, f.stun - dt);
    if (f.jumpBuf > 0) f.jumpBuf = Math.max(0, f.jumpBuf - dt);

    /* 攻击推进 */
    if (f.attack) {
      f.attack.t += dt;
      if (f.attack.type === 'dive') {
        if (f.onGround) f.attack = null;
      } else if (f.attack.t >= f.attack.dur) {
        f.attack = null;
      }
    }

    /* 水平：硬直里只吃击退，松开键盘也拉不回来；放必杀时全身锁住 */
    if (f.stun > 0) {
      f.x += f.vx * dt;
      f.vx = f.vx > 0 ? Math.max(0, f.vx - 1100 * dt) : Math.min(0, f.vx + 1100 * dt);
    } else if (f.attack && f.attack.type === 'ult') {
      f.vx = 0;
    } else {
      var move = 0;
      if (ctrl.left) move -= 1;
      if (ctrl.right) move += 1;
      f.vx = move * MOVE_V;
      f.x += f.vx * dt;
      if (move !== 0) f.walk += dt * 9;
    }
    f.x = clamp(f.x, MIN_X, MAX_X);

    /* 跳跃 */
    if (ctrl.jump && f.onGround && f.stun <= 0) {
      f.vy = JUMP_VY;
      f.onGround = false;
      f.jumpBuf = 0;
    }

    /* 垂直 */
    if (!f.onGround || f.y < GROUND_Y) {
      f.vy += GRAVITY * dt;
      f.y += f.vy * dt;
      if (f.y >= GROUND_Y) {
        f.y = GROUND_Y;
        f.vy = 0;
        f.onGround = true;
      } else {
        f.onGround = false;
      }
    }
  };

  /* ---------- AI ---------- */

  FightScene.prototype.stepAI = function (dt) {
    var ai = this.p2;
    var me = this.p1;
    var dir = me.x >= ai.x ? 1 : -1;
    var dist = Math.abs(me.x - ai.x);

    var ctrl = { left: false, right: false, jump: false };

    /* 被打断了：硬直一结束先退 0.4 秒，别贴脸送 */
    if (ai.stun > 0) {
      this.ai.plan = { kind: 'retreat', t: 0.4, jump: false };
      this.ai.next = null;
      return ctrl;
    }

    var plan = this.ai.plan;

    if (!plan || plan.t <= 0) {
      if (this.ai.next) {
        /* 上一步留的后续（打完往后撤 / 往前压） */
        plan = this.ai.next;
        this.ai.next = null;
        this.ai.plan = plan;
      } else {
        if (this.ai.cd > 0) {
          this.ai.cd -= dt;
          return ctrl;
        }
        this.ai.cd = 0.1;                 /* 每 0.1 秒才重新想一次 */
        var d = aiDecide(dist, ai.hp, ai.meter, Math.random(), Math.random(), Math.random());
        if (d.kind === 'ult') this.tryUlt(ai);
        else if (d.atk) this.tryAttack(ai, d.atk);
        plan = { kind: d.kind, t: d.t, jump: d.jump };
        if (d.then) this.ai.next = { kind: d.then, t: 0.5, jump: false };
        this.ai.plan = plan;
        if (d.jump && ai.onGround) ctrl.jump = true;
      }
    }

    plan.t -= dt;

    if (plan.kind === 'approach') {
      if (dist > AI_STOP) { if (dir > 0) ctrl.right = true; else ctrl.left = true; }
    } else if (plan.kind === 'retreat') {
      if (dir > 0) ctrl.left = true; else ctrl.right = true;
    } else if (dist > AI_REACH) {
      /* strike：够不着就先补两步，免得站在 200px 外打空气 */
      if (dir > 0) ctrl.right = true; else ctrl.left = true;
    }

    return ctrl;
  };

  /* ---------- 主更新 ---------- */

  FightScene.prototype.update = function (dt) {
    this.t += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 48);
    if (this.ultFx > 0) this.ultFx = Math.max(0, this.ultFx - dt * 1.8);
    if (this.announce > 0) this.announce = Math.max(0, this.announce - dt);

    var i, m;
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * m.s + m.p) * 9 * dt;
      if (m.y < 150) { m.y = 620; m.x = Math.random() * VIEW_W; }
    }

    for (i = this.floats.length - 1; i >= 0; i--) {
      var ft = this.floats[i];
      ft.t += dt;
      ft.y -= 46 * dt;
      if (ft.t >= ft.life) this.floats.splice(i, 1);
    }

    if (this.state !== 'playing') return;
    if (this.phase === 'over') return;

    this.time -= dt;
    if (this.time < 0) this.time = 0;

    /* 朝向：不打不硬直的时候一直看着对手。
       必须放在 stepAI / stepFighter 之前 —— AI 出手时要用「这一帧」的朝向，
       否则会朝着上一帧的方向挥空。 */
    var a = this.p1, b = this.p2;
    if (!a.attack && a.stun <= 0) a.facing = b.x >= a.x ? 1 : -1;
    if (!b.attack && b.stun <= 0) b.facing = a.x >= b.x ? 1 : -1;

    var c1 = { left: this.keys.p1.left, right: this.keys.p1.right, jump: this.p1.jumpBuf > 0 };
    this.stepFighter(a, dt, c1);

    var c2;
    if (this.mode === 'ai') {
      c2 = this.stepAI(dt);
    } else {
      c2 = { left: this.keys.p2.left, right: this.keys.p2.right, jump: this.p2.jumpBuf > 0 };
    }
    this.stepFighter(b, dt, c2);

    this.checkHits();

    /* 结束判定：KO 优先，其次超时比血 */
    if (a.hp <= 0 || b.hp <= 0) {
      if (a.hp <= 0 && b.hp <= 0) this.endRound(null);
      else this.endRound(a.hp > 0 ? 'p1' : 'p2');
      return;
    }
    if (this.time <= 0) {
      if (a.hp === b.hp) this.endRound(null);
      else this.endRound(a.hp > b.hp ? 'p1' : 'p2');
    }
  };

  /* ---------------- 渲染 ---------------- */

  FightScene.prototype.render = function (ctx) {
    ctx.save();
    if (this.shake > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * this.shake,
        (Math.random() - 0.5) * this.shake
      );
    }
    ctx.drawImage(this.bg, 0, 0, VIEW_W, VIEW_H);

    /* 飘尘 */
    ctx.save();
    for (var i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      ctx.globalAlpha = 0.10 + 0.28 * (0.5 + 0.5 * Math.sin(this.t * m.s * 2 + m.p));
      ctx.fillStyle = '#ffd9a8';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 两名角色：靠后的先画 */
    var order = [this.p1, this.p2].sort(function (x, y) { return x.y - y.y; });
    this.drawFighter(ctx, order[0]);
    this.drawFighter(ctx, order[1]);

    /* 伤害飘字 */
    this.drawFloats(ctx);

    /* 必杀冲击波：白热一闪 + 两圈扩散环 */
    if (this.ultFx > 0 && this.ultAt) this.drawShock(ctx, this.ultFx, this.ultAt);

    ctx.restore();

    /* HUD 与面板不吃震屏 */
    if (this.state === 'menu') {
      this.drawMenu(ctx);
    } else {
      this.drawHud(ctx);
      if (this.phase === 'over' && this.state === 'playing') this.drawRoundOver(ctx);
      if (this.state === 'settle') this.drawSettle(ctx);
    }
  };

  FightScene.prototype.drawFloats = function (ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < this.floats.length; i++) {
      var f = this.floats[i];
      var k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;
      if (f.big) {
        ctx.font = '700 46px ' + SERIF;
        ctx.fillStyle = 'rgba(12, 8, 20, 0.62)';
        ctx.fillText(f.txt, f.x + 2.5, f.y + 2.5);
        ctx.fillStyle = '#ffd24a';
        ctx.fillText(f.txt, f.x, f.y);
      } else if (f.small) {
        ctx.font = '500 19px ' + SANS;
        ctx.fillStyle = 'rgba(12, 8, 20, 0.55)';
        ctx.fillText(f.txt, f.x + 1.5, f.y + 1.5);
        ctx.fillStyle = 'rgba(255, 214, 170, 0.8)';
        ctx.fillText(f.txt, f.x, f.y);
      } else {
        ctx.font = '600 30px ' + SERIF;
        ctx.fillStyle = 'rgba(12, 8, 20, 0.55)';
        ctx.fillText(f.txt, f.x + 1.5, f.y + 1.5);
        ctx.fillStyle = '#ffd79a';
        ctx.fillText(f.txt, f.x, f.y);
      }
    }
    ctx.restore();
  };

  /* 必杀命中：白热 + 两圈扩散环 */
  FightScene.prototype.drawShock = function (ctx, k, at) {
    var e = 1 - k;                       /* 0 → 1 的推进 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    /* 全屏白闪，只有前 0.15 秒 */
    if (k > 0.7) {
      ctx.globalAlpha = (k - 0.7) / 0.3 * 0.5;
      ctx.fillStyle = '#fff4dd';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalAlpha = 1;
    }

    var r0 = 30 + e * 300;
    ctx.strokeStyle = 'rgba(255, 214, 120, ' + (k * 0.85).toFixed(3) + ')';
    ctx.lineWidth = 10 * k + 1;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (k * 0.6).toFixed(3) + ')';
    ctx.lineWidth = 4 * k + 0.5;
    ctx.beginPath();
    ctx.arc(at.x, at.y, r0 * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    /* 中心一团残留光 */
    var g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, 90 * k + 20);
    g.addColorStop(0, 'rgba(255, 236, 180, ' + (k * 0.55).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(255, 190, 90, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(at.x - 200, at.y - 200, 400, 400);

    ctx.restore();
  };

  /* ---------- 角色绘制 ---------- */

  FightScene.prototype.drawFighter = function (ctx, f) {
    var dead = f.hp <= 0;
    var atk = f.attack;
    var walking = Math.abs(f.vx) > 8 && f.onGround && f.stun <= 0;

    /* 影子 */
    ctx.save();
    var airK = clamp(1 - (GROUND_Y - f.y) / 300, 0.3, 1);
    ctx.globalAlpha = 0.34 * airK;
    ctx.fillStyle = '#07050d';
    ctx.beginPath();
    ctx.ellipse(f.x, GROUND_Y - 3, 30 + 10 * airK, 6.5 + 2.6 * airK, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 必杀余韵：一圈烫金的气 */
    if (f.ultFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var uk = f.ultFlash / (ULT_INV + 0.2);
      ctx.globalAlpha = 0.34 * uk;
      var ug = ctx.createRadialGradient(f.x, f.y - 62, 6, f.x, f.y - 62, 120);
      ug.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
      ug.addColorStop(0.45, 'rgba(255, 180, 70, 0.5)');
      ug.addColorStop(1, 'rgba(255, 140, 40, 0)');
      ctx.fillStyle = ug;
      ctx.fillRect(f.x - 120, f.y - 182, 240, 240);
      ctx.restore();
    }

    /* 脚下的暖光：站台上有一圈烘托 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16;
    var gl = ctx.createRadialGradient(f.x, GROUND_Y, 4, f.x, GROUND_Y, 84);
    gl.addColorStop(0, f.color);
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(f.x - 84, GROUND_Y - 40, 168, 64);
    ctx.restore();

    /* 受击白闪 */
    if (f.invuln > 0 && f.stun > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y - 58, 36, 62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    var bob = walking ? Math.abs(Math.sin(f.walk * 2)) * 1.6 : 0;
    var swing = walking ? Math.sin(f.walk * 2) : 0;

    /* 出拳/踢腿的伸展程度 0→1→0 */
    var ext = 0;
    if (atk) {
      if (atk.type === 'dive') ext = 0.85;
      else {
        var span = Math.max(0.001, atk.to - atk.from);
        var k = clamp((atk.t - atk.from) / span, 0, 1);
        ext = Math.sin(k * Math.PI);
      }
    }

    ctx.save();
    ctx.translate(f.x, f.y - bob);
    ctx.scale(f.facing * DRAW_S, DRAW_S);
    if (dead) { ctx.translate(0, 6); ctx.rotate(0.18); }

    /* ---- 腿 ---- */
    ctx.strokeStyle = '#110c1d';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (!f.onGround) {
      ctx.moveTo(-4, -16); ctx.lineTo(-11, -2);
      ctx.moveTo(4, -16); ctx.lineTo(10, -5);
    } else if (atk && atk.type === 'kick') {
      /* 前腿抬起伸直，后腿支地 */
      ctx.moveTo(3, -17); ctx.lineTo(6 + 34 * ext, -30 - 10 * ext);
      ctx.moveTo(-4, -16); ctx.lineTo(-7, -1);
    } else {
      ctx.moveTo(-4, -16); ctx.lineTo(-5 + swing * 7, -1);
      ctx.moveTo(4, -16); ctx.lineTo(5 - swing * 7, -1);
    }
    ctx.stroke();

    /* 踢出去的脚：末端加一点亮，看得见「打到了」 */
    if (atk && atk.type === 'kick' && ext > 0.15) {
      ctx.fillStyle = 'rgba(255, 222, 178, ' + (0.30 + 0.5 * ext).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(6 + 34 * ext, -30 - 10 * ext, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---- 斗篷 ---- */
    var body = ctx.createLinearGradient(0, -46, 0, -2);
    body.addColorStop(0, f.color);
    body.addColorStop(1, f.dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-10, -46);
    ctx.lineTo(10, -46);
    ctx.bezierCurveTo(13, -33, 15, -18, 17, -3);
    ctx.quadraticCurveTo(8, 2, 0, -2);
    ctx.quadraticCurveTo(-8, 2, -17, -3);
    ctx.bezierCurveTo(-15, -18, -13, -33, -10, -46);
    ctx.closePath();
    ctx.fill();

    /* 迎光边 */
    var rim = ctx.createLinearGradient(0, -46, 0, -6);
    rim.addColorStop(0, 'rgba(255, 214, 160, 0)');
    rim.addColorStop(0.5, 'rgba(255, 214, 160, 0.5)');
    rim.addColorStop(1, 'rgba(255, 214, 160, 0)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(9.6, -45);
    ctx.bezierCurveTo(12.6, -33, 14.6, -18, 16.2, -5);
    ctx.stroke();

    /* 肩线 */
    ctx.strokeStyle = 'rgba(12, 8, 20, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-9.4, -45.4);
    ctx.lineTo(9.4, -45.4);
    ctx.stroke();

    /* ---- 手臂 ---- */
    ctx.strokeStyle = f.dark;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (atk && (atk.type === 'punch' || atk.type === 'ult')) {
      ctx.moveTo(2, -44);
      ctx.lineTo(2 + 26 * ext, -44 + 2 * ext);
    } else if (atk && atk.type === 'dive') {
      ctx.moveTo(2, -44);
      ctx.lineTo(9, -26);
    } else {
      ctx.moveTo(2, -44);
      ctx.lineTo(9 - swing * 2, -30);
    }
    ctx.stroke();

    /* 拳头的亮点 */
    if (atk && (atk.type === 'punch' || atk.type === 'ult') && ext > 0.2) {
      ctx.fillStyle = 'rgba(255, 226, 186, ' + (0.35 + 0.5 * ext).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(2 + 26 * ext, -44 + 2 * ext, 5.4, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---- 兜帽与脸 ---- */
    ctx.fillStyle = f.dark;
    ctx.beginPath();
    ctx.arc(0, -54, 9.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f6c9a0';
    ctx.beginPath();
    ctx.ellipse(1.9, -53.4, 4.3, 4.9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(40, 20, 26, 0.85)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(1.9, -53.4, 4.3, 4.9, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();

    ctx.fillStyle = '#1c1730';
    ctx.beginPath();
    ctx.arc(3.7, -53.7, 1.1, 0, Math.PI * 2);
    ctx.fill();

    /* 兜帽尖：往斜后方压一点，别做成瓜皮帽 */
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(-8.4, -59.6);
    ctx.quadraticCurveTo(-2.6, -68.4, 5.4, -63.6);
    ctx.quadraticCurveTo(-1.6, -64.2, -8.4, -59.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    /* 名字牌：只在 AI 模式下给 AI 标一下，2P 靠血条区分就够了 */
    if (this.mode === 'ai' && f.id === 'p2') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = C.dim;
      ctx.font = '500 16px ' + SANS;
      ctx.textAlign = 'center';
      ctx.fillText('AI', f.x, f.y - 172);
      ctx.restore();
    }
  };

  /* ---------- HUD ---------- */

  function drawBar(ctx, x, y, w, h, ratio, color, mirrored, flash) {
    ctx.save();

    /* 外框 */
    rr(ctx, x - 4, y - 4, w + 8, h + 8, 9);
    ctx.fillStyle = 'rgba(10, 7, 18, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.34)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    /* 槽 */
    rr(ctx, x, y, w, h, 5);
    ctx.fillStyle = 'rgba(34, 25, 50, 0.92)';
    ctx.fill();

    var fw = Math.max(0, w * clamp(ratio, 0, 1));
    if (fw > 1) {
      ctx.save();
      rr(ctx, x, y, w, h, 5);
      ctx.clip();

      var fx = mirrored ? x + w - fw : x;
      var g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, tint(color, 0.42));
      g.addColorStop(0.45, color);
      g.addColorStop(1, tint(color, -0.28));
      ctx.fillStyle = g;
      ctx.fillRect(fx, y, fw, h);

      /* 高光条 */
      ctx.fillStyle = 'rgba(255, 245, 230, 0.22)';
      ctx.fillRect(fx, y + 2, fw, 4);

      if (flash > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.62 * (flash / 0.15)).toFixed(3) + ')';
        ctx.fillRect(fx, y, fw, h);
      }
      ctx.restore();
    }

    /* 边框内描边 */
    rr(ctx, x, y, w, h, 5);
    ctx.strokeStyle = 'rgba(12, 8, 20, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  /* 头顶能量条：黄 → 红渐变，满了描金边并呼吸 */
  FightScene.prototype.drawMeter = function (ctx, f) {
    var w = 76, h = 7;
    var x = f.x - w / 2;
    var y = f.y - BODY_H - 18;
    var k = clamp(f.meter / METER_MAX, 0, 1);
    var full = f.meter >= METER_MAX;

    ctx.save();

    /* 满格：先垫一层光晕 */
    if (full) {
      var pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22 + pulse * 0.2;
      ctx.fillStyle = '#ffb43c';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.62, h * 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 槽 */
    rr(ctx, x - 1.5, y - 1.5, w + 3, h + 3, 4);
    ctx.fillStyle = 'rgba(8, 6, 14, 0.75)';
    ctx.fill();
    ctx.strokeStyle = full ? 'rgba(255, 228, 156, 0.95)' : 'rgba(240, 167, 110, 0.26)';
    ctx.lineWidth = full ? 1.6 : 1;
    ctx.stroke();

    if (k > 0) {
      ctx.save();
      rr(ctx, x, y, w, h, 3);
      ctx.clip();
      var g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#ffd24a');
      g.addColorStop(0.55, '#ff9a3c');
      g.addColorStop(1, '#ef4b52');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w * k, h);
      ctx.fillStyle = 'rgba(255, 248, 226, 0.28)';
      ctx.fillRect(x, y + 1.5, w * k, 2);
      ctx.restore();
    }

    /* 满格小字：告诉玩家能按了 */
    if (full) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = '700 11px ' + SANS;
      ctx.fillStyle = 'rgba(255, 226, 156, 0.95)';
      ctx.fillText('必杀 就绪', x + w / 2, y - 5);
    }

    ctx.restore();
  };

  FightScene.prototype.drawHud = function (ctx) {
    var barW = 470, barH = 22, y = 42;

    ctx.save();
    ctx.textBaseline = 'middle';

    /* P1：左边，血从右侧掉 */
    drawBar(ctx, 60, y, barW, barH, this.p1.hp / HP_MAX, C.p1, false, this.p1.barFlash);
    /* P2：右边，血从左侧掉 */
    drawBar(ctx, VIEW_W - 60 - barW, y, barW, barH, this.p2.hp / HP_MAX, C.p2, true, this.p2.barFlash);

    ctx.font = '600 20px ' + SERIF;
    ctx.fillStyle = C.paper;
    ctx.textAlign = 'left';
    ctx.fillText(this.p1.label, 60, y - 20);
    ctx.textAlign = 'right';
    ctx.fillText(this.p2.label, VIEW_W - 60, y - 20);

    /* 胜局圆点 */
    var i;
    for (i = 0; i < NEED_WIN; i++) {
      ctx.beginPath();
      ctx.arc(60 + 86 + i * 20, y - 22, 6, 0, Math.PI * 2);
      ctx.fillStyle = i < this.p1.wins ? C.p1 : 'rgba(253, 243, 228, 0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240, 167, 110, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    for (i = 0; i < NEED_WIN; i++) {
      ctx.beginPath();
      ctx.arc(VIEW_W - 60 - 86 - i * 20, y - 22, 6, 0, Math.PI * 2);
      ctx.fillStyle = i < this.p2.wins ? C.p2 : 'rgba(253, 243, 228, 0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(240, 167, 110, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    /* 头顶能量条（跟着角色走） */
    this.drawMeter(ctx, this.p1);
    this.drawMeter(ctx, this.p2);

    /* 中央计时器 */
    var secs = Math.ceil(this.time);    var lowTime = this.time <= 10;
    ctx.textAlign = 'center';
    ctx.font = '700 52px ' + SERIF;
    ctx.fillStyle = 'rgba(10, 7, 18, 0.55)';
    ctx.fillText(String(secs), VIEW_W / 2 + 2, y + 14);
    ctx.fillStyle = lowTime ? '#ff9a6a' : C.paper;
    ctx.fillText(String(secs), VIEW_W / 2, y + 12);

    ctx.font = '500 15px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('第 ' + this.round + ' 局 · 三局两胜', VIEW_W / 2, y + 48);

    /* 开局播报 */
    if (this.announce > 0) {
      ctx.globalAlpha = this.announce < 0.35 ? this.announce / 0.35 : 1;
      ctx.font = '700 60px ' + SERIF;
      ctx.fillStyle = 'rgba(10, 7, 18, 0.6)';
      ctx.fillText('第 ' + this.round + ' 局', VIEW_W / 2 + 3, 303);
      ctx.fillStyle = C.paper;
      ctx.fillText('第 ' + this.round + ' 局', VIEW_W / 2, 300);
      ctx.globalAlpha = 1;
    }

    /* 底部操作提示 */
    ctx.font = '500 16px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.32)';
    if (this.mode === 'ai') {
      ctx.fillText('A / D 移动 · W 跳跃 · J 拳 · K 踢 · L 必杀 · Esc 返回大厅', VIEW_W / 2, VIEW_H - 22);
    } else {
      ctx.fillText('P1  A D W J K L      P2  ← → ↑ 1 2 3      Esc 返回大厅', VIEW_W / 2, VIEW_H - 22);
    }

    ctx.restore();
  };

  /* ---------- 面板 ---------- */

  function panel(ctx, x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    rr(ctx, x, y, w, h, 18);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.restore();

    rr(ctx, x, y, w, h, 18);
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    /* 顶上一道暖色渐隐，别让面板像一块纯色砖 */
    ctx.save();
    rr(ctx, x, y, w, h, 18);
    ctx.clip();
    var g = ctx.createLinearGradient(0, y, 0, y + 90);
    g.addColorStop(0, 'rgba(240, 167, 110, 0.10)');
    g.addColorStop(1, 'rgba(240, 167, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, 90);
    ctx.restore();
  }

  function drawButton(ctx, b, primary) {
    ctx.save();
    rr(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle = primary ? 'rgba(240, 167, 110, 0.16)' : 'rgba(253, 243, 228, 0.06)';
    ctx.fill();
    ctx.strokeStyle = primary ? 'rgba(240, 167, 110, 0.85)' : 'rgba(253, 243, 228, 0.30)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = primary ? '#ffd79a' : C.paper;
    ctx.font = '600 26px ' + SERIF;
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + (b.sub ? -8 : 1));
    if (b.sub) {
      ctx.font = '500 15px ' + SANS;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
      ctx.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 18);
    }
    ctx.restore();
  }

  FightScene.prototype.drawMenu = function (ctx) {
    var W = VIEW_W, H = VIEW_H;

    /* 压暗背景，让标题跳出来 */
    ctx.save();
    var v = ctx.createRadialGradient(W / 2, 300, 60, W / 2, 360, 700);
    v.addColorStop(0, 'rgba(8, 5, 14, 0.86)');
    v.addColorStop(0.55, 'rgba(8, 5, 14, 0.72)');
    v.addColorStop(1, 'rgba(8, 5, 14, 0.42)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 68px ' + SERIF;
    ctx.fillStyle = 'rgba(8, 5, 14, 0.5)';
    ctx.fillText('二人格斗', W / 2 + 3, 206 + 3);
    var tg = ctx.createLinearGradient(0, 170, 0, 240);
    tg.addColorStop(0, '#fff3e0');
    tg.addColorStop(1, '#f0a066');
    ctx.fillStyle = tg;
    ctx.fillText('二人格斗', W / 2, 206);

    ctx.font = '600 26px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
    ctx.fillText('D U E L', W / 2, 256);

    ctx.strokeStyle = 'rgba(240, 167, 110, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 130, 288);
    ctx.lineTo(W / 2 + 130, 288);
    ctx.stroke();

    ctx.restore();

    /* 两个选项 */
    this.menuBtns = [
      { mode: '2p', x: 460, y: 350, w: 360, h: 84, label: '双人对战', sub: '同一键盘 · 左右各一边' },
      { mode: 'ai', x: 460, y: 458, w: 360, h: 84, label: '挑战 AI', sub: '单人练习 · 电脑当对手', primary: true }
    ];
    for (var i = 0; i < this.menuBtns.length; i++) {
      drawButton(ctx, this.menuBtns[i], !!this.menuBtns[i].primary);
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 15px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.30)';
    ctx.fillText('点击选项，或按 1 / 2 选择 · Esc 返回大厅', W / 2, 604);
    ctx.restore();
  };

  FightScene.prototype.drawRoundOver = function (ctx) {
    var W = VIEW_W;
    ctx.save();
    ctx.fillStyle = 'rgba(6, 4, 12, 0.55)';
    ctx.fillRect(0, 0, W, VIEW_H);

    panel(ctx, W / 2 - 300, 228, 600, 326);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '600 22px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('第 ' + this.round + ' 局结束', W / 2, 282);

    ctx.font = '700 74px ' + SERIF;
    ctx.fillStyle = C.paper;
    ctx.fillText(this.p1.wins + ' : ' + this.p2.wins, W / 2, 356);

    ctx.font = '500 20px ' + SERIF;
    ctx.fillStyle = '#ffd79a';
    ctx.fillText(this.roundMsg, W / 2, 414);

    this.btn = { x: W / 2 - 110, y: 442, w: 220, h: 58, label: '下一局' };
    drawButton(ctx, this.btn, true);

    ctx.font = '500 14px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    ctx.fillText('Enter / 空格 继续 · Esc 返回大厅', W / 2, 528);

    ctx.restore();
  };

  FightScene.prototype.drawSettle = function (ctx) {
    var W = VIEW_W;
    var isP1 = this.winner === 'p1';
    var name = isP1 ? 'P1 获胜' : (this.p2.label + ' 获胜');

    ctx.save();
    ctx.fillStyle = 'rgba(6, 4, 12, 0.68)';
    ctx.fillRect(0, 0, W, VIEW_H);

    panel(ctx, W / 2 - 320, 190, 640, 392);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '600 18px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('对 局 结 束', W / 2, 240);

    ctx.font = '700 46px ' + SERIF;
    ctx.fillStyle = isP1 ? '#ffb98a' : '#9ad8ff';
    ctx.fillText(name, W / 2, 300);

    ctx.font = '700 84px ' + SERIF;
    ctx.fillStyle = C.paper;
    ctx.fillText(this.p1.wins + ' : ' + this.p2.wins, W / 2, 380);

    ctx.font = '500 17px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.45)';
    ctx.fillText(this.mode === 'ai' ? '挑战 AI · 三局两胜' : '双人对战 · 三局两胜', W / 2, 436);

    this.btn = { x: W / 2 - 120, y: 468, w: 240, h: 60, label: '回大厅' };
    drawButton(ctx, this.btn, true);

    ctx.font = '500 14px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.32)';
    ctx.fillText('点击按钮或按 Enter / Esc 返回大厅', W / 2, 556);

    ctx.restore();
  };

  global.SceneManager.register('fight', function () {
    return new FightScene();
  });
})(window);
