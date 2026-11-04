/* ============================================================
 * player.js —— 大厅角色 + 输入 + 摄像机
 * ------------------------------------------------------------
 * Input   ：键盘状态与跳跃输入缓冲（空格按下后保留 0.14s）
 * Camera  ：横向跟随，带前视偏移与边界钳制
 * Player  ：A/D 或 ←/→ 移动、空格跳跃；重力 + 地面碰撞；不越界
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 调参 ---------------- */
  var MAX_SPEED = 330;      // px/s
  var ACCEL     = 2800;     // px/s²
  var FRICTION  = 2400;     // px/s²
  var GRAVITY   = 2400;     // px/s²
  var FALL_MUL  = 1.28;     // 下落时重力加成，落地更「实」
  var JUMP_V    = 790;      // 起跳初速 → 跳高约 130px
  var JUMP_CUT  = 300;      // 提前松手的上升速度上限
  var COYOTE    = 0.10;     // 离地后仍可起跳的宽限
  var MAX_FALL  = 1500;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ============================================================
   * Input —— 全局只绑定一次，背景音乐/场景切换都不受影响
   * ============================================================ */
  var Input = (function () {
    var state = { left: false, right: false, jump: false };
    var buffer = 0;

    var MAP = {
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      Space: 'jump', KeyW: 'jump', ArrowUp: 'jump'
    };

    function onDown(e) {
      var k = MAP[e.code];
      if (!k) return;
      if (k === 'jump') {
        if (!state.jump) buffer = 0.14;   // 只认「刚按下」这一帧
        state.jump = true;
      } else {
        state[k] = true;
      }
      e.preventDefault();
    }

    function onUp(e) {
      var k = MAP[e.code];
      if (!k) return;
      state[k] = false;
      e.preventDefault();
    }

    function onBlur() {
      state.left = state.right = state.jump = false;
    }

    global.addEventListener('keydown', onDown, { passive: false });
    global.addEventListener('keyup', onUp, { passive: false });
    global.addEventListener('blur', onBlur);

    return {
      state: state,
      peek: function () { return buffer; },
      take: function () { var b = buffer; buffer = 0; return b; },
      decay: function (dt) { if (buffer > 0) buffer = Math.max(0, buffer - dt); },
      /* 打开面板时调用：把按住的键与跳跃缓冲一起清掉，免得关掉面板瞬间角色窜出去 */
      reset: function () {
        state.left = state.right = state.jump = false;
        buffer = 0;
      }
    };
  })();

  /* ============================================================
   * Camera —— 只做横向跟随（地图高度等于视口高度，不需要纵向滚动）
   * ============================================================ */
  function Camera(viewW, viewH, mapW, mapH) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.mapW = mapW;
    this.mapH = mapH;
    this.x = 0;
    this.y = 0;
  }

  Camera.prototype.limit = function () {
    return Math.max(0, this.mapW - this.viewW);
  };

  Camera.prototype.targetX = function (px, facing) {
    // 角色略微偏左，面朝方向多给一点点前方视野
    return clamp(px - this.viewW * 0.5 + facing * 64, 0, this.limit());
  };

  Camera.prototype.snap = function (p) {
    this.x = this.targetX(p.x, p.facing);
  };

  Camera.prototype.follow = function (p, dt) {
    var tx = this.targetX(p.x, p.facing);
    var k = 1 - Math.exp(-6.5 * dt);      // 帧率无关的指数平滑
    this.x += (tx - this.x) * k;
    if (Math.abs(tx - this.x) < 0.15) this.x = tx;
    this.x = clamp(this.x, 0, this.limit());
  };

  Camera.prototype.begin = function (ctx) {
    ctx.save();
    /* 横向跟随；纵向由使用方给定（大厅里 y 固定为 206，窗口下沿正好压在地面线上） */
    ctx.translate(
      -Math.round(this.x * 100) / 100,
      -Math.round((this.y || 0) * 100) / 100
    );
  };

  Camera.prototype.end = function (ctx) {
    ctx.restore();
  };

  /* ============================================================
   * Player —— 剪纸风小人：(x, y) 取「脚底中心」
   * ============================================================ */
  function Player(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;

    this.w = 38;
    this.h = 76;

    this.groundY = y;
    this.bounds = { min: 0, max: 1280 };

    this.onGround = true;
    this.facing = 1;
    this.walk = 0;
    this.speedRatio = 0;
    this.coyote = 0;
    this.squash = 0;
  }

  Player.prototype.update = function (dt, world) {
    var st = Input.state;
    var groundY = (world && world.groundY) || this.groundY;

    Input.decay(dt);

    /* --- 水平输入 --- */
    var dir = (st.right ? 1 : 0) - (st.left ? 1 : 0);
    if (dir !== 0) {
      this.vx += dir * ACCEL * dt;
      this.facing = dir;
    } else {
      var f = FRICTION * dt;
      if (Math.abs(this.vx) <= f) this.vx = 0;
      else this.vx -= (this.vx > 0 ? 1 : -1) * f;
    }
    this.vx = clamp(this.vx, -MAX_SPEED, MAX_SPEED);

    /* --- 土狼时间 --- */
    if (this.onGround) this.coyote = COYOTE;
    else this.coyote = Math.max(0, this.coyote - dt);

    /* --- 起跳 --- */
    if (Input.peek() > 0 && this.coyote > 0) {
      this.vy = -JUMP_V;
      this.onGround = false;
      this.coyote = 0;
      this.squash = -0.38;           // 负值 = 纵向拉长
      Input.take();
    }

    /* --- 松手切断跳跃（可变跳跃高度）--- */
    if (!st.jump && this.vy < -JUMP_CUT) {
      this.vy = -JUMP_CUT;
    }

    /* --- 重力 --- */
    this.vy += GRAVITY * (this.vy > 0 ? FALL_MUL : 1) * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    /* --- 积分 --- */
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    /* --- 地面碰撞 --- */
    var wasAirborne = !this.onGround;
    if (this.y >= groundY) {
      if (wasAirborne && this.vy > 240) {
        this.squash = Math.min(1, this.vy / 1250);
      }
      this.y = groundY;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    /* --- 地图边界：角色不能跑出去 --- */
    if (this.x < this.bounds.min) { this.x = this.bounds.min; this.vx = 0; }
    if (this.x > this.bounds.max) { this.x = this.bounds.max; this.vx = 0; }

    /* --- 动画状态 --- */
    var sp = Math.abs(this.vx);
    this.speedRatio = Math.min(1, sp / MAX_SPEED);
    this.walk += (this.onGround ? sp : 240) * dt * 0.042;
    this.squash += (0 - this.squash) * Math.min(1, dt * 11);
  };

  /* ---------------- 绘制 ---------------- */
  Player.prototype.render = function (ctx) {
    var x = this.x;
    var y = this.y;
    var air = Math.max(0, this.groundY - y);

    /* 影子：离地越高越淡越小 */
    var sh = clamp(1 - air / 210, 0.12, 1);
    ctx.save();
    ctx.globalAlpha = 0.34 * sh;
    ctx.fillStyle = '#07050d';
    ctx.beginPath();
    ctx.ellipse(x, this.groundY - 2, 24 * (0.66 + sh * 0.34), 7 * (0.55 + sh * 0.45), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    var squash = this.squash;
    var sx = 1 + squash * 0.14;
    var sy = 1 - squash * 0.18;
    var swing = Math.sin(this.walk * 2) * (this.onGround ? 1 : 0.3) * this.speedRatio;
    var bob = this.onGround ? Math.abs(Math.sin(this.walk * 2)) * 1.6 * this.speedRatio : 0;

    ctx.save();
    ctx.translate(x, y - bob);
    ctx.scale(this.facing, 1);
    ctx.scale(sx, sy);
    /* 跑动时身体略微前倾，静止时回正 */
    ctx.transform(1, 0, -0.16 * this.speedRatio, 1, 0, 0);

    var hem = this.onGround ? -12 : -17;

    /* 腿 */
    ctx.strokeStyle = '#1a1429';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (this.onGround) {
      ctx.moveTo(-3.5, -15); ctx.lineTo(-4.5 + swing * 9, -1);
      ctx.moveTo(3.5, -15);  ctx.lineTo(4.5 - swing * 9, -1);
    } else {
      ctx.moveTo(-3.5, -15); ctx.lineTo(-9, -4);
      ctx.moveTo(3.5, -15);  ctx.lineTo(8, -2);
    }
    ctx.stroke();

    /* 斗篷：肩窄摆宽，下摆带一点波纹 */
    var body = ctx.createLinearGradient(0, -54, 0, hem + 6);
    body.addColorStop(0, '#372d53');
    body.addColorStop(1, '#211a35');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-12, -52);
    ctx.lineTo(12, -52);
    ctx.bezierCurveTo(15, -36, 18, -22, 19.5, hem + 2);
    ctx.quadraticCurveTo(9, hem + 7, 0, hem + 2);
    ctx.quadraticCurveTo(-9, hem + 7, -19.5, hem + 2);
    ctx.bezierCurveTo(-18, -22, -15, -36, -12, -52);
    ctx.closePath();
    ctx.fill();

    /* 围巾：颈圈 + 一条甩向左下的尾巴 */
    var wob = Math.sin(this.walk * 2.4) * 2;
    var drag = 3 + this.speedRatio * 9;
    ctx.fillStyle = '#c9532f';
    ctx.beginPath();
    ctx.moveTo(-10.5, -56);
    ctx.quadraticCurveTo(0, -52, 10.5, -56);
    ctx.quadraticCurveTo(9.5, -48.5, 0, -48);
    ctx.quadraticCurveTo(-9.5, -48.5, -10.5, -56);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-7, -54);
    ctx.quadraticCurveTo(-15, -50 + wob, -22 - drag, -43 + wob * 1.2);
    ctx.quadraticCurveTo(-19, -41 + wob, -12, -46);
    ctx.quadraticCurveTo(-8, -49, -5, -50);
    ctx.closePath();
    ctx.fill();

    /* 兜帽 */
    ctx.fillStyle = '#3b3058';
    ctx.beginPath();
    ctx.arc(0, -64, 13, 0, Math.PI * 2);
    ctx.fill();

    /* 帽口里的脸 */
    ctx.fillStyle = '#ecc7a4';
    ctx.beginPath();
    ctx.ellipse(2.6, -62.6, 6.8, 7.6, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 帽檐阴影压住脸上沿，脸才像嵌在帽子里 */
    ctx.strokeStyle = '#2a2142';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(2.6, -62.6, 6.8, 7.6, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();

    /* 眼 */
    ctx.fillStyle = '#2a2140';
    ctx.beginPath();
    ctx.arc(6, -62.6, 1.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  /* ---------------- 导出 ---------------- */
  global.Input = Input;
  global.Camera = Camera;
  global.Player = Player;
})(window);
