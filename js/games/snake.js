/* ============================================================
 * snake.js —— 贪吃蛇（小游戏场景）
 * ------------------------------------------------------------
 * 场景接口：init(ctx) / update(dt) / render(ctx) / destroy()
 *
 * 网格说明：画布 1280×720，四周留 20px 装饰带 → 可用区 1240×680。
 * 1240 / 40 = 31、680 / 40 = 17，所以格数取 31×17；
 * （32×18 的 40px 格正好是 1280×720，装不下装饰带。）
 * ============================================================ */
(function (global) {
  'use strict';

  var VIEW_W = 1280;
  var VIEW_H = 720;

  var CELL = 40;
  var COLS = 31;
  var ROWS = 17;
  var OX = 20;
  var OY = 20;
  var FW = COLS * CELL;
  var FH = ROWS * CELL;

  /* 节奏：0.12s/格，每 50 分加速 0.008s，最快 0.06s */
  var BASE_STEP = 0.12;
  var MIN_STEP = 0.06;
  var STEP_DEC = 0.008;
  var SCORE_GATE = 50;

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  var COL = {
    ink: '#08060f',
    paper: '#fdf3e4',
    paperDim: 'rgba(253, 243, 228, 0.52)',
    amber: '#f0a76e',
    amberSoft: '#ffd9a8',
    seam: '#211a35',
    head: '#f0904f',
    bodyA: '#e8844a',
    bodyB: '#c9532f',
    food: '#ffd79a'
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  function pad4(n) { return ('0000' + n).slice(-4); }

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

  /* 统一的剪纸面板：深紫底 + 暖边 + 内高光 */
  function panel(ctx, x, y, w, h, accent) {
    ctx.save();
    ctx.shadowColor = 'rgba(4, 3, 9, 0.7)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    rr(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(20, 15, 34, 0.92)';
    ctx.fill();
    ctx.restore();

    rr(ctx, x, y, w, h, 18);
    ctx.strokeStyle = accent || 'rgba(240, 167, 110, 0.52)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    rr(ctx, x + 6.5, y + 6.5, w - 13, h - 13, 13);
    ctx.strokeStyle = 'rgba(255, 217, 168, 0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* 画布按钮：返回矩形供命中测试 */
  function button(ctx, x, y, w, h, label, hot) {
    rr(ctx, x, y, w, h, 12);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, hot ? 'rgba(240, 167, 110, 0.30)' : 'rgba(240, 167, 110, 0.14)');
    g.addColorStop(1, hot ? 'rgba(240, 167, 110, 0.16)' : 'rgba(240, 167, 110, 0.06)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(255, 217, 168, 0.82)' : 'rgba(240, 167, 110, 0.42)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = COL.paper;
    ctx.font = '600 20px ' + SERIF;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  }

  /* 静态场地：渐变 + 网格点，init 时画一次，之后整张贴 */
  function buildField() {
    var c = document.createElement('canvas');
    c.width = FW;
    c.height = FH;
    var g = c.getContext('2d');

    var bg = g.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#1e1730');
    bg.addColorStop(0.55, '#191326');
    bg.addColorStop(1, '#140f20');
    g.fillStyle = bg;
    g.fillRect(0, 0, FW, FH);

    /* 网格点：只做极淡的方位参考，不抢蛇的视觉 */
    g.fillStyle = 'rgba(255, 226, 190, 0.055)';
    for (var i = 1; i < COLS; i++) {
      for (var j = 1; j < ROWS; j++) {
        g.fillRect(i * CELL - 1, j * CELL - 1, 2, 2);
      }
    }

    /* 四角暗角，让视线收在中央 */
    var vig = g.createRadialGradient(FW / 2, FH / 2, FH * 0.34, FW / 2, FH / 2, FH * 0.92);
    vig.addColorStop(0, 'rgba(6, 4, 12, 0)');
    vig.addColorStop(1, 'rgba(6, 4, 12, 0.46)');
    g.fillStyle = vig;
    g.fillRect(0, 0, FW, FH);

    return c;
  }

  /* ============================================================
   * SnakeScene
   * ============================================================ */
  function SnakeScene() {
    this.t = 0;
    this.state = 'ready';
    this.score = 0;
    this.best = 0;
    this.stepT = BASE_STEP;
    this.timer = 0;
    this.flash = 0;
    this.overT = 0;
    this.diedAt = null;

    this.snake = [];
    this.food = null;
    this.dir = { x: 1, y: 0 };
    this.pending = [];

    this.field = null;
    this.btn = null;

    this.canvas = null;
    this._onKey = null;
    this._onClick = null;
    this._onBlur = null;
  }

  SnakeScene.prototype.init = function (ctx) {
    var self = this;

    this.t = 0;
    this.state = 'ready';
    this.score = 0;
    this.stepT = BASE_STEP;
    this.timer = 0;
    this.flash = 0;
    this.overT = 0;
    this.diedAt = null;
    this.dir = { x: 1, y: 0 };
    this.pending = [];
    this.snake = [{ x: 7, y: 8 }, { x: 6, y: 8 }, { x: 5, y: 8 }];
    this.food = this.pickFood();
    this.field = buildField();
    this.btn = null;
    this.best = readBest();

    this.canvas = (ctx && ctx.canvas) || global.SceneManager.canvas;

    this._onKey = function (e) { self.onKey(e); };
    this._onClick = function (e) { self.onClick(e); };
    this._onBlur = function () { self.pending.length = 0; };

    global.addEventListener('keydown', this._onKey);
    global.addEventListener('blur', this._onBlur);
    if (this.canvas) this.canvas.addEventListener('click', this._onClick);

    if (global.HUD) global.HUD.toast('');
  };

  /* ---------------- 输入 ---------------- */
  SnakeScene.prototype.onKey = function (e) {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.toHall();
      return;
    }

    if (e.code === 'KeyR') {
      e.preventDefault();
      if (this.state === 'over') { this.restart(); sfx('ui'); }
      return;
    }

    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.state === 'over') {
        e.preventDefault();
        this.toHall();
      }
      return;
    }

    var d = DIRS[e.code];
    if (!d) return;
    e.preventDefault();

    if (this.state === 'ready') {
      this.state = 'playing';
      this.timer = 0;
    }
    if (this.state === 'over') return;
    this.pushDir(d);
  };

  SnakeScene.prototype.pushDir = function (d) {
    /* 与「最后一次生效方向」比较：连按两下不会因为中间态而反向自杀 */
    var last = this.pending.length ? this.pending[this.pending.length - 1] : this.dir;
    if (d.x === -last.x && d.y === -last.y) return;
    if (d.x === last.x && d.y === last.y) return;
    if (this.pending.length >= 2) return;
    this.pending.push(d);
  };

  SnakeScene.prototype.onClick = function (e) {
    var c = this.canvas;
    if (!c) return;
    var r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var x = (e.clientX - r.left) * VIEW_W / r.width;
    var y = (e.clientY - r.top) * VIEW_H / r.height;

    if (this.state === 'ready') {
      this.state = 'playing';
      this.timer = 0;
      return;
    }
    if (this.state === 'over' && this.btn) {
      var b = this.btn;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) this.toHall();
    }
  };

  /* ---------------- 逻辑 ---------------- */
  SnakeScene.prototype.pickFood = function () {
    var free = [];
    var i, j, k, hit;
    for (i = 0; i < COLS; i++) {
      for (j = 0; j < ROWS; j++) {
        hit = false;
        for (k = 0; k < this.snake.length; k++) {
          if (this.snake[k].x === i && this.snake[k].y === j) { hit = true; break; }
        }
        if (!hit) free.push({ x: i, y: j });
      }
    }
    if (!free.length) return null;
    return free[(Math.random() * free.length) | 0];
  };

  SnakeScene.prototype.restart = function () {
    this.state = 'ready';
    this.score = 0;
    this.stepT = BASE_STEP;
    this.timer = 0;
    this.flash = 0;
    this.overT = 0;
    this.diedAt = null;
    this.dir = { x: 1, y: 0 };
    this.pending = [];
    this.snake = [{ x: 7, y: 8 }, { x: 6, y: 8 }, { x: 5, y: 8 }];
    this.food = this.pickFood();
    this.btn = null;
  };

  SnakeScene.prototype.die = function () {
    if (this.state === 'over') return;
    this.state = 'over';
    this.overT = 0;
    this.flash = 1;
    sfx('dead');
    if (this.score > this.best) {
      this.best = this.score;
      writeBest(this.best);
    }
  };

  SnakeScene.prototype.advance = function () {
    if (this.pending.length) this.dir = this.pending.shift();

    var h = this.snake[0];
    var nx = h.x + this.dir.x;
    var ny = h.y + this.dir.y;

    /* 撞墙 */
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      this.diedAt = { x: clamp(nx, 0, COLS - 1), y: clamp(ny, 0, ROWS - 1) };
      this.die();
      return;
    }

    /* 撞自己：尾巴这一格本回合会腾出来，所以最后一节不算 */
    for (var i = 0; i < this.snake.length - 1; i++) {
      if (this.snake[i].x === nx && this.snake[i].y === ny) {
        this.diedAt = { x: nx, y: ny };
        this.die();
        return;
      }
    }

    var eat = this.food && this.food.x === nx && this.food.y === ny;
    this.snake.unshift({ x: nx, y: ny });

    if (eat) {
      sfx('eat');
      this.score += 10;
      this.food = this.pickFood();
    } else {
      this.snake.pop();
    }
  };

  SnakeScene.prototype.update = function (dt) {
    this.t += dt;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);

    if (this.state === 'over') {
      this.overT += dt;
      return;
    }
    if (this.state !== 'playing') return;

    /* 每 50 分一档，逐档缩短步进 */
    this.stepT = Math.max(MIN_STEP, BASE_STEP - Math.floor(this.score / SCORE_GATE) * STEP_DEC);

    this.timer += dt;
    var guard = 0;
    while (this.timer >= this.stepT && guard++ < 4) {
      this.timer -= this.stepT;
      this.advance();
      if (this.state !== 'playing') break;
    }
  };

  /* ---------------- 绘制 ---------------- */
  SnakeScene.prototype.render = function (ctx) {
    var i;

    ctx.fillStyle = COL.ink;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 场地 */
    if (this.field) ctx.drawImage(this.field, OX, OY, FW, FH);

    /* 场地暖边 + 四角装饰 */
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.34)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(OX - 0.5, OY - 0.5, FW + 1, FH + 1);

    ctx.strokeStyle = 'rgba(255, 217, 168, 0.55)';
    ctx.lineWidth = 2;
    var C = 22;
    var corners = [[OX, OY, 1, 1], [OX + FW, OY, -1, 1], [OX, OY + FH, 1, -1], [OX + FW, OY + FH, -1, -1]];
    for (i = 0; i < corners.length; i++) {
      var c = corners[i];
      ctx.beginPath();
      ctx.moveTo(c[0] + c[2] * C, c[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(c[0], c[1] + c[3] * C);
      ctx.stroke();
    }

    /* 食物 */
    if (this.food) {
      var fx = OX + this.food.x * CELL + CELL / 2;
      var fy = OY + this.food.y * CELL + CELL / 2;
      var pulse = 0.5 + 0.5 * Math.sin(this.t * 4.2);
      var halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 30 + pulse * 8);
      halo.addColorStop(0, 'rgba(255, 215, 154, 0.42)');
      halo.addColorStop(0.45, 'rgba(255, 190, 120, 0.14)');
      halo.addColorStop(1, 'rgba(255, 170, 100, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(fx, fy, 34 + pulse * 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COL.food;
      ctx.beginPath();
      ctx.arc(fx, fy, 8.6 + pulse * 1.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(fx - 2.6, fy - 3, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 蛇身 */
    this.drawSnake(ctx);

    /* 死亡位置的红色余韵 */
    if (this.state === 'over' && this.diedAt && this.flash > 0) {
      var dx = OX + this.diedAt.x * CELL + CELL / 2;
      var dy = OY + this.diedAt.y * CELL + CELL / 2;
      ctx.save();
      ctx.globalAlpha = this.flash * 0.55;
      ctx.fillStyle = '#e8545f';
      ctx.beginPath();
      ctx.arc(dx, dy, CELL * (0.6 + (1 - this.flash) * 1.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* HUD */
    this.drawHud(ctx);

    if (this.state === 'ready') this.drawReady(ctx);
    if (this.state === 'over') this.drawOver(ctx);
  };

  SnakeScene.prototype.drawSnake = function (ctx) {
    var n = this.snake.length;
    if (!n) return;

    var pts = [];
    for (var i = 0; i < n; i++) {
      pts.push({
        x: OX + this.snake[i].x * CELL + CELL / 2,
        y: OY + this.snake[i].y * CELL + CELL / 2
      });
    }

    var head = pts[0];
    var tail = pts[n - 1];

    /* 地面上的暖色投影，把蛇从底色里托起来 */
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(6, 4, 12, 0.55)';
    ctx.lineWidth = CELL * 0.72;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(head.x + 2, head.y + 5);
    for (i = 1; i < n; i++) ctx.lineTo(pts[i].x + 2, pts[i].y + 5);
    ctx.stroke();
    ctx.restore();

    /* 主体：沿身体方向的渐变，头亮尾暗 */
    var g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
    g.addColorStop(0, COL.head);
    g.addColorStop(0.55, COL.bodyA);
    g.addColorStop(1, COL.bodyB);

    ctx.strokeStyle = g;
    ctx.lineWidth = CELL * 0.68;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    for (i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    /* 节间深色接缝：垂直于走向的短线 */
    ctx.strokeStyle = COL.seam;
    ctx.lineWidth = 3;
    for (i = 1; i < n; i++) {
      var ax = pts[i - 1].x, ay = pts[i - 1].y;
      var bx = pts[Math.min(i + 1, n - 1)].x, by = pts[Math.min(i + 1, n - 1)].y;
      var ux = bx - ax, uy = by - ay;
      var len = Math.sqrt(ux * ux + uy * uy) || 1;
      ux /= len; uy /= len;
      var px = -uy, py = ux;
      var hw = CELL * 0.27;
      ctx.beginPath();
      ctx.moveTo(pts[i].x + px * hw, pts[i].y + py * hw);
      ctx.lineTo(pts[i].x - px * hw, pts[i].y - py * hw);
      ctx.stroke();
    }

    /* 头部：略大的圆 + 眼睛 */
    var hg = ctx.createRadialGradient(head.x - 4, head.y - 5, 2, head.x, head.y, CELL * 0.6);
    hg.addColorStop(0, '#ffb87a');
    hg.addColorStop(1, COL.head);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(head.x, head.y, CELL * 0.40, 0, Math.PI * 2);
    ctx.fill();

    var d = this.dir;
    var nx = -d.y, ny = d.x;
    for (i = 0; i < 2; i++) {
      var s = i === 0 ? 1 : -1;
      var ex = head.x + d.x * 5.5 + nx * 5.6 * s;
      var ey = head.y + d.y * 5.5 + ny * 5.6 * s;
      ctx.fillStyle = '#fdf3e4';
      ctx.beginPath();
      ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#221a34';
      ctx.beginPath();
      ctx.arc(ex + d.x * 1.1, ey + d.y * 1.1, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  SnakeScene.prototype.drawHud = function (ctx) {
    /* 顶部一层极淡的暗色，保证文字在任何位置都读得出来 */
    var g = ctx.createLinearGradient(0, OY, 0, OY + 58);
    g.addColorStop(0, 'rgba(8, 6, 15, 0.62)');
    g.addColorStop(1, 'rgba(8, 6, 15, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(OX, OY, FW, 58);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COL.paperDim;
    ctx.font = '500 13px ' + SANS;
    ctx.fillText('分数', OX + 18, OY + 21);

    var s = pad4(this.score);
    ctx.font = '600 26px ' + SERIF;
    ctx.fillStyle = COL.paper;
    ctx.fillText(s, OX + 52, OY + 21);

    /* 当前档位速度，给「越来越快」一个可读反馈 */
    var lv = 1 + Math.floor(this.score / SCORE_GATE);
    ctx.font = '500 12px ' + SANS;
    ctx.fillStyle = 'rgba(255, 217, 168, ' + (0.35 + Math.min(lv, 8) * 0.06).toFixed(2) + ')';
    ctx.fillText('速度 ' + lv, OX + 152, OY + 21);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    ctx.font = '500 12px ' + SANS;
    ctx.fillText('Esc 返回大厅', OX + FW - 18, OY + 21);
  };

  SnakeScene.prototype.drawReady = function (ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(8, 6, 15, 0.55)';
    ctx.fillRect(OX, OY, FW, FH);
    ctx.restore();

    var cx = VIEW_W / 2;
    var cy = VIEW_H / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = COL.paper;
    ctx.font = '600 52px ' + SERIF;
    ctx.shadowColor = 'rgba(240, 167, 110, 0.35)';
    ctx.shadowBlur = 34;
    ctx.fillText('贪吃蛇', cx, cy - 74);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(255, 217, 168, 0.72)';
    ctx.font = '400 20px ' + SANS;
    ctx.fillText('S N A K E', cx, cy - 30);

    ctx.strokeStyle = 'rgba(240, 167, 110, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 96, cy + 2);
    ctx.lineTo(cx + 96, cy + 2);
    ctx.stroke();

    ctx.fillStyle = COL.paper;
    ctx.font = '500 22px ' + SANS;
    ctx.fillText('按任意方向键开始', cx, cy + 44);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
    ctx.font = '400 15px ' + SANS;
    ctx.fillText('WASD / 方向键 转向 · 吃到光点长大 · 别撞墙也别咬自己', cx, cy + 88);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.28)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('Esc 返回大厅', cx, cy + 138);
  };

  SnakeScene.prototype.drawOver = function (ctx) {
    var a = clamp(this.overT / 0.25, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8, 6, 15, 0.62)';
    ctx.fillRect(OX, OY, FW, FH);
    ctx.restore();

    var w = 440;
    var h = 300;
    var x = (VIEW_W - w) / 2;
    var y = (VIEW_H - h) / 2 - 10;

    ctx.save();
    ctx.globalAlpha = a;
    panel(ctx, x, y, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(253, 243, 228, 0.5)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('本 局 分 数', x + w / 2, y + 52);

    ctx.fillStyle = COL.paper;
    ctx.font = '600 66px ' + SERIF;
    ctx.fillText(String(this.score), x + w / 2, y + 104);

    ctx.fillStyle = 'rgba(255, 217, 168, 0.6)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('最高 ' + pad4(this.best) + ' · 长度 ' + this.snake.length, x + w / 2, y + 148);

    var bw = 200;
    var bh = 50;
    this.btn = { x: x + (w - bw) / 2, y: y + 182, w: bw, h: bh };
    button(ctx, this.btn.x, this.btn.y, bw, bh, '回到大厅', false);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.36)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('R 重开 · 回车 / 点击按钮 回大厅', x + w / 2, y + 262);
    ctx.restore();
  };

  /* ---------------- 生命周期 ---------------- */
  SnakeScene.prototype.toHall = function () {
    if (global.SceneManager) global.SceneManager.change('world');
  };

  SnakeScene.prototype.destroy = function () {
    global.removeEventListener('keydown', this._onKey);
    global.removeEventListener('blur', this._onBlur);
    if (this.canvas && this._onClick) this.canvas.removeEventListener('click', this._onClick);

    this._onKey = null;
    this._onClick = null;
    this._onBlur = null;
    this.canvas = null;
    this.snake.length = 0;
    this.field = null;
    this.btn = null;
  };

  /* ---------------- 最佳成绩：file:// 下 localStorage 可能被禁，一律兜底 ---------------- */
  var BEST_KEY = 'worldhub.snake.best';

  function readBest() {
    try {
      var v = parseInt(global.localStorage.getItem(BEST_KEY), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (err) {
      return 0;
    }
  }

  function writeBest(v) {
    try {
      global.localStorage.setItem(BEST_KEY, String(v));
    } catch (err) { /* 忽略：无痕模式 / file 协议限制 */ }
  }

  var DIRS = {
    KeyW: { x: 0, y: -1 }, ArrowUp: { x: 0, y: -1 },
    KeyS: { x: 0, y: 1 }, ArrowDown: { x: 0, y: 1 },
    KeyA: { x: -1, y: 0 }, ArrowLeft: { x: -1, y: 0 },
    KeyD: { x: 1, y: 0 }, ArrowRight: { x: 1, y: 0 }
  };

  global.SnakeScene = SnakeScene;
  if (global.SceneManager) {
    global.SceneManager.register('snake', function () { return new SnakeScene(); });
  }
})(window);
