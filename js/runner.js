/* ============================================================
 * runner.js —— 两种可爱版跑酷（横版 / 神庙逃亡式）
 * ------------------------------------------------------------
 * 独立场景 'runner'，通过 SceneManager.change('runner', { mode }) 进入。
 *   mode = 'side'    横版跑酷：自动向右跑，跳 / 二段跳 / 下滑躲障碍
 *   mode = 'temple'  神庙逃亡式：三车道向前跑，左右换道 / 跳 / 滑铲
 * 画风：马卡龙配色 + 圆润的角色与方块，尽量可爱。
 * 操作：← → 换道（神庙）· 空格/↑ 跳 · ↓ 滑铲/下滑 · Esc / P 回大厅
 * 记录：worldhub.runner.side.best.v1 / worldhub.runner.temple.best.v1
 * ============================================================ */
(function (global) {
  'use strict';

  var W = 1280, H = 720;
  var SANS = '"Microsoft YaHei","PingFang SC","Hiragino Sans GB",system-ui,sans-serif';
  var GROUND = 566;
  var HORIZON = 250, BOTTOM = 706, MAXZ = 1000;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function bestKey(mode) { return 'worldhub.runner.' + mode + '.best.v1'; }
  function loadBest(mode) {
    try { return Math.round(parseFloat(global.localStorage.getItem(bestKey(mode))) || 0); } catch (e) { return 0; }
  }
  function saveBest(mode, v) {
    try { global.localStorage.setItem(bestKey(mode), String(v)); } catch (e) {}
  }

  /* ---------------- 可爱的角色：圆团子 + 大眼 + 腮红 ---------------- */
  function drawBlob(ctx, x, y, s, body, squash) {
    var sq = squash || 0;
    var bw = s * (1 + sq * 0.12), bh = s * (1 - sq * 0.14);
    ctx.save();
    ctx.translate(x, y - bh / 2);
    /* 影子 */
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#3a2a4a';
    ctx.beginPath();
    ctx.ellipse(0, bh / 2 + 4, bw * 0.62, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    /* 身体 */
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    /* 高光 */
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.16, -bh * 0.2, bw * 0.16, bh * 0.12, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    /* 眼睛 */
    var ex = bw * 0.17, ey = -bh * 0.06;
    ctx.fillStyle = '#3d3350';
    ctx.beginPath(); ctx.arc(-ex, ey, bw * 0.085, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, bw * 0.085, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-ex + bw * 0.03, ey - bh * 0.03, bw * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + bw * 0.03, ey - bh * 0.03, bw * 0.03, 0, Math.PI * 2); ctx.fill();
    /* 腮红 */
    ctx.fillStyle = 'rgba(255, 140, 170, 0.55)';
    ctx.beginPath(); ctx.ellipse(-bw * 0.26, ey + bh * 0.12, bw * 0.09, bh * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bw * 0.26, ey + bh * 0.12, bw * 0.09, bh * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    /* 嘴 */
    ctx.strokeStyle = '#3d3350';
    ctx.lineWidth = Math.max(1.4, bw * 0.03);
    ctx.beginPath();
    ctx.arc(0, ey + bh * 0.10, bw * 0.07, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  function drawCoin(ctx, x, y, r, t) {
    ctx.save();
    ctx.translate(x, y);
    var ph = Math.abs(Math.sin(t * 3.2 + x * 0.02));
    ctx.scale(0.45 + 0.55 * ph, 1);
    ctx.fillStyle = '#ffd45e';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e6a92e';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.25, r * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function Runner() {
    this.mode = 'side';
    this.t = 0;
    this._onKey = null;
  }

  Runner.prototype.init = function (ctx, opts) {
    this.ctx = ctx;
    this.mode = (opts && opts.mode === 'temple') ? 'temple' : 'side';
    this.best = loadBest(this.mode);
    this.firstTouch = true;
    var self = this;
    this._onKey = function (e) { self.onKey(e); };
    global.addEventListener('keydown', this._onKey, { passive: false });
    this.reset();
  };

  Runner.prototype.reset = function () {
    this.t = 0;
    this.dist = 0;
    this.coins = 0;
    this.over = false;
    this.newBest = false;
    this.objects = [];
    this.spawnT = 1.0;
    this.speed = this.mode === 'side' ? 340 : 520;
    if (this.mode === 'side') {
      this.p = { x: 300, y: GROUND, vy: 0, onGround: true, jumps: 0, slide: 0 };
    } else {
      this.p = { lane: 0, laneX: 0, y: 0, vy: 0, onGround: true, slide: 0 };
    }
  };

  Runner.prototype.score = function () {
    return Math.round(this.dist / 10) + this.coins * 10;
  };

  /* ---------------- 输入 ---------------- */
  Runner.prototype.onKey = function (e) {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      this.exit();
      return;
    }
    if (this.over) {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.reset(); }
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp') {
      e.preventDefault();
      this.jump();
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      this.slideNow();
      return;
    }
    if (this.mode === 'temple') {
      if (e.code === 'ArrowLeft') { e.preventDefault(); this.p.lane = clamp(this.p.lane - 1, -1, 1); }
      if (e.code === 'ArrowRight') { e.preventDefault(); this.p.lane = clamp(this.p.lane + 1, -1, 1); }
    }
  };

  Runner.prototype.jump = function () {
    var p = this.p;
    if (this.mode === 'side') {
      if (p.jumps >= 2) return;
      p.vy = -820;
      p.jumps++;
      p.onGround = false;
    } else {
      if (!p.onGround) return;
      p.vy = -860;
      p.onGround = false;
    }
    this.play('jump');
  };

  Runner.prototype.slideNow = function () {
    this.p.slide = 0.55;
  };

  Runner.prototype.play = function (name) {
    if (global.Audio && global.Audio.play) { try { global.Audio.play(name); } catch (e) {} }
  };

  Runner.prototype.die = function () {
    if (this.over) return;
    this.over = true;
    var sc = this.score();
    if (sc > this.best) { this.best = sc; this.newBest = true; saveBest(this.mode, sc); }
    this.play('miss');
  };

  Runner.prototype.exit = function () {
    if (global.Input && global.Input.reset) global.Input.reset();
    if (global.SceneManager) global.SceneManager.change('world', {});
  };

  /* ---------------- update ---------------- */
  Runner.prototype.update = function (dt) {
    this.t += dt;
    if (this.over) return;
    if (this.mode === 'side') this.updateSide(dt);
    else this.updateTemple(dt);
  };

  Runner.prototype.updateSide = function (dt) {
    var p = this.p;
    this.speed = 340 + Math.min(430, this.dist * 0.018);
    this.dist += this.speed * dt;

    /* 物理 */
    p.vy += 2400 * dt;
    p.y += p.vy * dt;
    if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; p.onGround = true; p.jumps = 0; }
    else p.onGround = false;
    if (p.slide > 0) p.slide = Math.max(0, p.slide - dt);

    /* 生成 */
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnSide();
      this.spawnT = Math.max(0.44, 0.98 - this.dist * 0.00002) + Math.random() * 0.34;
    }

    /* 移动与判定 */
    var ph = p.slide > 0 ? 28 : 56;
    var px = p.x - 22, py = p.y - ph;
    var i, o;
    for (i = 0; i < this.objects.length; i++) {
      o = this.objects[i];
      if (o.dead) continue;
      o.x -= this.speed * dt;
      if (o.x < -160) { o.dead = true; continue; }
      var ox = o.x - o.w / 2, oy = o.y - o.h;
      if (o.kind === 'coin') {
        if (px < ox + o.w && px + 44 > ox && py < oy + o.h && py + ph > oy) {
          o.dead = true;
          this.coins++;
          this.play('ui');
        }
      } else if (px < ox + o.w && px + 44 > ox && py < oy + o.h && py + ph > oy) {
        this.die();
      }
    }
  };

  Runner.prototype.spawnSide = function () {
    var r = Math.random();
    var kind = r < 0.55 ? 'box' : (r < 0.78 ? 'tall' : 'bar');
    if (kind === 'box') this.objects.push({ kind: 'box', x: W + 90, y: GROUND, w: 50, h: 54 });
    else if (kind === 'tall') this.objects.push({ kind: 'tall', x: W + 90, y: GROUND, w: 42, h: 98 });
    else this.objects.push({ kind: 'bar', x: W + 90, y: GROUND - 34, w: 76, h: 20 });
    /* 金币：跳过障碍的奖励；偶尔单独一串 */
    if (Math.random() < 0.55) {
      var base = kind === 'bar' ? GROUND - 66 : GROUND - 120;
      var n = 1 + Math.floor(Math.random() * 3);
      for (var i = 0; i < n; i++) {
        this.objects.push({ kind: 'coin', x: W + 90 + i * 46, y: base - Math.abs(i - 1) * 8, w: 26, h: 26 });
      }
    }
  };

  Runner.prototype.updateTemple = function (dt) {
    var p = this.p;
    p.laneX += (p.lane - p.laneX) * Math.min(1, dt * 11);
    this.speed = 520 + Math.min(500, this.dist * 0.02);
    this.dist += this.speed * dt;

    p.vy += 2400 * dt;
    p.y += p.vy * dt;
    if (p.y >= 0) { p.y = 0; p.vy = 0; p.onGround = true; }
    else p.onGround = false;
    if (p.slide > 0) p.slide = Math.max(0, p.slide - dt);

    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnTemple();
      this.spawnT = Math.max(0.34, 0.86 - this.dist * 0.000035) + Math.random() * 0.3;
    }

    var i, o;
    for (i = 0; i < this.objects.length; i++) {
      o = this.objects[i];
      if (o.dead) continue;
      o.z -= this.speed * dt;
      if (o.z < -120) { o.dead = true; continue; }
      var k = 1 - o.z / MAXZ;             /* 0 远 → 1 近 */
      if (k > 0.88 && k < 1.06) {
        var sameLane = Math.abs(o.lane - p.laneX) < 0.5;
        if (o.kind === 'coin') {
          if (sameLane) { o.dead = true; this.coins++; this.play('ui'); }
        } else if (sameLane) {
          if (o.kind === 'barrel') {
            if (p.y > -36) this.die();      /* 没跳到足够高 */
          } else if (o.kind === 'beam') {
            if (p.slide <= 0) this.die();   /* 没滑铲 */
          }
        }
      }
    }
  };

  Runner.prototype.spawnTemple = function () {
    var lanes = [-1, 0, 1];
    var lane = lanes[Math.floor(Math.random() * 3)];
    var r = Math.random();
    if (r < 0.46) this.objects.push({ kind: 'barrel', lane: lane, z: MAXZ });
    else if (r < 0.76) this.objects.push({ kind: 'beam', lane: lane, z: MAXZ });
    else this.objects.push({ kind: 'coin', lane: lane, z: MAXZ });
    if (Math.random() < 0.35) {
      var l2 = lanes[Math.floor(Math.random() * 3)];
      if (l2 !== lane) this.objects.push({ kind: 'coin', lane: l2, z: MAXZ + 90 });
    }
  };

  /* ---------------- render ---------------- */
  Runner.prototype.render = function (ctx) {
    if (this.mode === 'side') this.renderSide(ctx);
    else this.renderTemple(ctx);
    this.renderHUD(ctx);
    if (this.over) this.renderOver(ctx);
  };

  /* ============ 横版：天空 / 云 / 山丘 / 草地 ============ */
  Runner.prototype.renderSide = function (ctx) {
    var t = this.t, i;

    /* 天空 */
    var sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#fde9f4');
    sky.addColorStop(0.45, '#e8ecff');
    sky.addColorStop(1, '#d3f2ff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* 太阳 */
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#ffd9a0';
    ctx.beginPath(); ctx.arc(1010, 150, 74, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(1010, 150, 120, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    /* 云（视差） */
    var clouds = [[0.16, 160, 130, 1.0], [0.3, 420, 90, 0.7], [0.22, 760, 150, 0.9], [0.12, 1080, 100, 0.6]];
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var cx = ((c[2] - t * this.speed * c[0]) % (W + 320) + W + 320) % (W + 320) - 160;
      ctx.save();
      ctx.globalAlpha = 0.6 * c[3];
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(cx, c[1], 78, 26, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 52, c[1] + 6, 54, 20, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 48, c[1] + 8, 46, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 远山（三层视差） */
    var hills = [
      { k: 0.12, y: 430, amp: 54, col: '#cfe8d8' },
      { k: 0.22, y: 486, amp: 44, col: '#b7ddc4' },
      { k: 0.34, y: 524, amp: 34, col: '#a2d3b2' }
    ];
    for (i = 0; i < hills.length; i++) {
      var h = hills[i];
      var off = (t * this.speed * h.k) % 220;
      ctx.fillStyle = h.col;
      ctx.beginPath();
      ctx.moveTo(-220, GROUND);
      for (var x = -220; x <= W + 220; x += 220) {
        ctx.quadraticCurveTo(x + 110 - off, h.y - h.amp, x + 220 - off, h.y);
      }
      ctx.lineTo(W + 220, GROUND);
      ctx.closePath();
      ctx.fill();
    }

    /* 草地 */
    ctx.fillStyle = '#f6d9a8';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#ecc389';
    for (i = 0; i < 40; i++) {
      var gx = ((i * 71 - t * this.speed * 0.9) % (W + 80) + W + 80) % (W + 80) - 40;
      ctx.fillRect(gx, GROUND + 30 + (i % 3) * 26, 26, 5);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, GROUND, W, 5);

    /* 障碍与金币 */
    for (i = 0; i < this.objects.length; i++) {
      var o = this.objects[i];
      if (o.dead) continue;
      if (o.kind === 'coin') { drawCoin(ctx, o.x, o.y - 13, 15, this.t); continue; }
      if (o.kind === 'bar') {
        ctx.fillStyle = '#c79cff';
        rr(ctx, o.x - o.w / 2, o.y - o.h, o.w, o.h, 9);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        rr(ctx, o.x - o.w / 2 + 6, o.y - o.h + 4, o.w - 12, 4, 2);
        ctx.fill();
      } else {
        var col = o.kind === 'tall' ? '#ff9aa8' : '#8fd0ff';
        ctx.fillStyle = col;
        rr(ctx, o.x - o.w / 2, o.y - o.h, o.w, o.h, 12);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        rr(ctx, o.x - o.w / 2 + 7, o.y - o.h + 6, o.w - 14, 6, 3);
        ctx.fill();
        /* 小眼睛，让它也可爱 */
        ctx.fillStyle = '#3d3350';
        ctx.beginPath(); ctx.arc(o.x - 7, o.y - o.h / 2, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(o.x + 7, o.y - o.h / 2, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* 角色 */
    var p = this.p;
    var squash = p.onGround ? 0 : clamp(-p.vy / 3000, -0.3, 0.3);
    if (p.slide > 0) {
      ctx.save();
      ctx.translate(p.x, p.y - 14);
      ctx.scale(1.28, 0.62);
      drawBlob(ctx, 0, 0, 52, '#ffb3c7', 0);
      ctx.restore();
    } else {
      drawBlob(ctx, p.x, p.y, 56, '#ffb3c7', squash);
    }
  };

  /* ============ 神庙：透视路 / 灯笼 / 障碍 ============ */
  Runner.prototype.renderTemple = function (ctx) {
    var t = this.t, i;

    /* 天空 */
    var sky = ctx.createLinearGradient(0, 0, 0, HORIZON + 120);
    sky.addColorStop(0, '#d9d4ff');
    sky.addColorStop(0.55, '#ffdfe9');
    sky.addColorStop(1, '#ffe9d2');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* 月亮 + 星 */
    ctx.fillStyle = 'rgba(255, 248, 220, 0.9)';
    ctx.beginPath(); ctx.arc(1040, 120, 52, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (i = 0; i < 26; i++) {
      var sx = (i * 137 + 40) % W, sy = 40 + ((i * 71) % 170);
      ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(t * 1.3 + i));
      ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* 远景庙宇剪影 */
    ctx.fillStyle = 'rgba(150, 120, 190, 0.28)';
    for (i = 0; i < 7; i++) {
      var bx = i * 200 - 60;
      ctx.beginPath();
      ctx.moveTo(bx, HORIZON);
      ctx.lineTo(bx + 70, HORIZON - 110 - (i % 3) * 30);
      ctx.lineTo(bx + 140, HORIZON);
      ctx.closePath();
      ctx.fill();
    }

    /* 路面梯形 */
    var roadTopW = 190, roadBotW = 960;
    var g1 = ctx.createLinearGradient(0, HORIZON, 0, H);
    g1.addColorStop(0, '#f6dcc0');
    g1.addColorStop(1, '#eec79c');
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - roadTopW / 2, HORIZON);
    ctx.lineTo(W / 2 + roadTopW / 2, HORIZON);
    ctx.lineTo(W / 2 + roadBotW / 2, BOTTOM);
    ctx.lineTo(W / 2 - roadBotW / 2, BOTTOM);
    ctx.closePath();
    ctx.fill();

    /* 车道线 */
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 3;
    var lineOff = (t * this.speed * 0.5) % 120;
    for (var lane = -1; lane <= 1; lane += 2) {
      for (var s = 0; s < 12; s++) {
        var k1 = ((s * 120 + lineOff) % 1440) / 1440;
        var k2 = ((s * 120 + lineOff + 40) % 1440) / 1440;
        if (k1 > k2) continue;
        var y1 = HORIZON + (BOTTOM - HORIZON) * k1, y2 = HORIZON + (BOTTOM - HORIZON) * k2;
        var w1 = lerp(roadTopW, roadBotW, k1) / 3, w2 = lerp(roadTopW, roadBotW, k2) / 3;
        var cx1 = W / 2 + lane * w1, cx2 = W / 2 + lane * w2;
        ctx.beginPath();
        ctx.moveTo(cx1, y1);
        ctx.lineTo(cx2, y2);
        ctx.stroke();
      }
    }

    /* 两侧灯柱 */
    for (i = 0; i < 8; i++) {
      var kk = ((i * 0.34 + t * 0.30) % 1.2) - 0.1;
      if (kk < 0 || kk > 1) continue;
      var yy = HORIZON + (BOTTOM - HORIZON) * kk;
      var ww = lerp(roadTopW, roadBotW, kk);
      var lx = W / 2 - ww / 2 - lerp(10, 60, kk);
      var sc = lerp(0.25, 1.15, kk);
      ctx.fillStyle = '#c9a2e0';
      ctx.fillRect(lx - 3 * sc, yy - 70 * sc, 6 * sc, 70 * sc);
      ctx.fillStyle = '#ffd9a0';
      ctx.beginPath(); ctx.arc(lx, yy - 74 * sc, 9 * sc, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255, 217, 160, 0.25)';
      ctx.beginPath(); ctx.arc(lx, yy - 74 * sc, 22 * sc, 0, Math.PI * 2); ctx.fill();
    }

    /* 物体：远的先画 */
    var objs = this.objects.slice().sort(function (a, b) { return b.z - a.z; });
    for (i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (o.dead) continue;
      var k = 1 - clamp(o.z / MAXZ, 0, 1);
      if (k <= 0) continue;
      var y = HORIZON + (BOTTOM - HORIZON) * k;
      var laneW = lerp(roadTopW, roadBotW, k) / 3;
      var x = W / 2 + o.lane * laneW;
      var scale = lerp(0.18, 1.15, k);
      if (o.kind === 'coin') {
        drawCoin(ctx, x, y - 46 * scale, 15 * scale, this.t);
      } else if (o.kind === 'barrel') {
        ctx.fillStyle = '#ff9aa8';
        rr(ctx, x - 32 * scale, y - 64 * scale, 64 * scale, 64 * scale, 12 * scale);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        rr(ctx, x - 24 * scale, y - 56 * scale, 48 * scale, 7 * scale, 4 * scale);
        ctx.fill();
        ctx.fillStyle = '#3d3350';
        ctx.beginPath(); ctx.arc(x - 10 * scale, y - 34 * scale, 3.4 * scale, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 10 * scale, y - 34 * scale, 3.4 * scale, 0, Math.PI * 2); ctx.fill();
      } else {
        /* 横梁：需滑铲 */
        ctx.fillStyle = '#b48cff';
        rr(ctx, x - 84 * scale, y - 118 * scale, 168 * scale, 26 * scale, 10 * scale);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        rr(ctx, x - 74 * scale, y - 112 * scale, 148 * scale, 6 * scale, 3 * scale);
        ctx.fill();
      }
    }

    /* 角色 */
    var p = this.p;
    var cx = W / 2 + p.laneX * lerp(roadTopW, roadBotW, 1) / 3;
    var cy = BOTTOM - 40 + p.y;
    if (p.slide > 0) {
      ctx.save();
      ctx.translate(cx, cy + 14);
      ctx.scale(1.3, 0.6);
      drawBlob(ctx, 0, 0, 66, '#ffb3c7', 0);
      ctx.restore();
    } else {
      drawBlob(ctx, cx, cy, 66, '#ffb3c7', p.onGround ? 0 : clamp(-p.vy / 3200, -0.28, 0.28));
    }
  };

  /* ---------------- HUD / 结束面板 ---------------- */
  Runner.prototype.renderHUD = function (ctx) {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 26px ' + SANS;
    ctx.fillStyle = 'rgba(60, 46, 74, 0.85)';
    var title = this.mode === 'side' ? '横版跑酷' : '神庙逃亡';
    ctx.fillText(title, 40, 54);

    ctx.font = '600 20px ' + SANS;
    ctx.fillStyle = 'rgba(60, 46, 74, 0.7)';
    ctx.fillText('距离 ' + Math.round(this.dist / 10) + '  ·  金币 ' + this.coins + '  ·  分数 ' + this.score(), 40, 90);

    ctx.textAlign = 'right';
    ctx.font = '500 16px ' + SANS;
    ctx.fillStyle = 'rgba(60, 46, 74, 0.55)';
    ctx.fillText('最佳 ' + this.best + '  ·  Esc / P 回大厅', W - 40, 54);

    ctx.textAlign = 'center';
    ctx.font = '500 16px ' + SANS;
    ctx.fillStyle = 'rgba(60, 46, 74, 0.45)';
    var hint = this.mode === 'side'
      ? '空格 跳（可二段跳）· ↓ 下滑 · 躲开方块与横梁'
      : '← → 换道 · 空格 跳 · ↓ 滑铲 · 躲开木桶与横梁';
    ctx.fillText(hint, W / 2, H - 34);
    ctx.restore();
  };

  Runner.prototype.renderOver = function (ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(40, 30, 56, 0.55)';
    ctx.fillRect(0, 0, W, H);

    var cardW = 520, cardH = 300;
    var cx = W / 2 - cardW / 2, cy = H / 2 - cardH / 2;
    ctx.fillStyle = 'rgba(255, 250, 244, 0.97)';
    rr(ctx, cx, cy, cardW, cardH, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230, 190, 150, 0.8)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a4568';
    ctx.font = '700 30px ' + SANS;
    ctx.fillText('这趟跑到头啦', W / 2, cy + 68);

    ctx.font = '600 22px ' + SANS;
    ctx.fillStyle = '#7a5f8a';
    ctx.fillText('分数 ' + this.score() + '  ·  金币 ' + this.coins + '  ·  距离 ' + Math.round(this.dist / 10), W / 2, cy + 118);

    if (this.newBest) {
      ctx.fillStyle = '#e0803c';
      ctx.font = '700 20px ' + SANS;
      ctx.fillText('★ 新纪录！', W / 2, cy + 160);
    } else {
      ctx.fillStyle = '#9a8aa8';
      ctx.font = '500 18px ' + SANS;
      ctx.fillText('最佳 ' + this.best, W / 2, cy + 160);
    }

    ctx.fillStyle = '#5a4568';
    ctx.font = '600 20px ' + SANS;
    ctx.fillText('空格 再来一次', W / 2, cy + 218);
    ctx.font = '400 16px ' + SANS;
    ctx.fillStyle = '#9a8aa8';
    ctx.fillText('Esc / P 回大厅', W / 2, cy + 254);
    ctx.restore();
  };

  Runner.prototype.destroy = function () {
    if (this._onKey) global.removeEventListener('keydown', this._onKey);
    this._onKey = null;
    if (global.Input && global.Input.reset) global.Input.reset();
  };

  global.SceneManager.register('runner', function () { return new Runner(); });
})(window);
