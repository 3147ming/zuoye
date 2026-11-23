/* ============================================================
 * games/snake/js/snake.js —— 贪吃蛇
 * ------------------------------------------------------------
 * 自研实现。机制：吃果实变长、撞墙/撞自己结束、方向键操控、
 * 计分与最高分、暂停、穿墙模式开关、触摸方向键。
 *
 * 网格 24×18，格子 26px。
 * ============================================================ */
(function () {
  'use strict';

  var COLS = 24, ROWS = 18, CELL = 26;
  var W = COLS * CELL, H = ROWS * CELL;

  var snake = [];      /* [{x,y}] 头在第一个 */
  var dir = { x: 1, y: 0 };
  var nextDir = { x: 1, y: 0 };
  var food = { x: 0, y: 0 };
  var score = 0, best = 0;
  var dead = false, paused = false, started = false;
  var wrap = false;    /* 穿墙模式 */
  var stepAcc = 0;
  var SPEED = 130;     /* 每步毫秒，随分数加快 */
  var grow = 0;        /* 待消化的增长量 */

  var cv, ctx, elScore, elBest, elMsg, elState;

  /* ---------- 初始化 ---------- */
  function reset() {
    snake = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }, { x: 3, y: 9 }];
    dir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    score = 0; dead = false; paused = false; started = false;
    grow = 0; stepAcc = 0;
    placeFood();
    updateHud();
    draw();
  }

  function placeFood() {
    var free = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!snake.some(function (s) { return s.x === x && s.y === y; })) free.push({ x: x, y: y });
      }
    }
    if (!free.length) return;
    food = free[Math.floor(Math.random() * free.length)];
  }

  /* ---------- 步进 ---------- */
  function step() {
    dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    /* 撞墙 */
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      if (wrap) {
        head.x = (head.x + COLS) % COLS;
        head.y = (head.y + ROWS) % ROWS;
      } else { die(); return; }
    }

    /* 撞自己（尾巴会挪走，所以不检查最后一节） */
    for (var i = 0; i < snake.length - 1; i++) {
      if (snake[i].x === head.x && snake[i].y === head.y) { die(); return; }
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      grow += 2;                 /* 吃到就长两节 */
      placeFood();
    } else if (grow > 0) {
      grow -= 1;
    } else {
      snake.pop();
    }
    updateHud();
  }

  function die() {
    dead = true;
    updateHud();
    showMsg('撞到了！', '再来一局');
  }

  /* ---------- 绘制 ---------- */
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    /* 背景 */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b2438');
    g.addColorStop(1, '#101622');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* 网格 */
    ctx.strokeStyle = 'rgba(255,255,255,.035)';
    ctx.lineWidth = 1;
    for (var x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, H); ctx.stroke(); }
    for (var y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(W, y * CELL + .5); ctx.stroke(); }

    /* 果实 */
    var fcx = food.x * CELL + CELL / 2, fcy = food.y * CELL + CELL / 2;
    var pulse = 1 + Math.sin(performance.now() / 220) * 0.12;
    ctx.save();
    ctx.shadowColor = '#ff8fb1';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ff8fb1';
    ctx.beginPath();
    ctx.arc(fcx, fcy, (CELL * 0.32) * pulse, 0, 6.284);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7ee0a0';
    ctx.beginPath();
    ctx.ellipse(fcx + 5, fcy - 6, 3.5, 2, -0.5, 0, 6.284);
    ctx.fill();

    /* 蛇身 */
    for (var i = snake.length - 1; i >= 0; i--) {
      var s = snake[i];
      var t = i === 0 ? 1 : 1 - (i / snake.length) * 0.55;
      var cx = s.x * CELL + CELL / 2, cy = s.y * CELL + CELL / 2;
      ctx.fillStyle = i === 0 ? '#8ff0b5' : 'rgba(126, 232, 160,' + t.toFixed(2) + ')';
      rr(ctx, s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4, 7);
      ctx.fill();
      if (i === 0) {
        /* 眼睛：按朝向 */
        ctx.fillStyle = '#12202e';
        var ex = dir.x * 4, ey = dir.y * 4;
        ctx.beginPath(); ctx.arc(cx - 4 + ex, cy - 4 + ey, 2, 0, 6.284); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 4 + ex, cy + 4 + ey, 2, 0, 6.284); ctx.fill();
      }
    }
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    elScore.textContent = String(score);
    var b = parseInt(localStorage.getItem('snake.best') || '0', 10);
    if (score > b) { b = score; localStorage.setItem('snake.best', String(b)); }
    elBest.textContent = String(b);
    elState.textContent = dead ? '结束' : paused ? '暂停' : started ? '进行中' : '准备';
    elState.style.color = dead ? '#ff8fb1' : paused ? '#ffd166' : '#8ff0b5';
  }

  function showMsg(title, btn) {
    elMsg.style.display = 'flex';
    elMsg.querySelector('.m-title').textContent = title;
    elMsg.querySelector('button').textContent = btn;
  }
  function hideMsg() { elMsg.style.display = 'none'; }

  /* ---------- 主循环 ---------- */
  var last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!dead && !paused) {
      if (!started) { started = true; updateHud(); }
      stepAcc += dt * 1000;
      var speed = Math.max(60, SPEED - score * 0.6);
      while (stepAcc >= speed) {
        stepAcc -= speed;
        step();
        if (dead) break;
      }
    }
    draw();
  }

  /* ---------- 输入 ---------- */
  function setDir(x, y) {
    /* 不能直接反向 */
    if (dir.x === -x && dir.y === -y) return;
    nextDir = { x: x, y: y };
    if (!started) { started = true; updateHud(); }
  }

  document.addEventListener('keydown', function (e) {
    var k = String(e.key).toLowerCase();
    if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') e.preventDefault();
    if (k === 'arrowup' || k === 'w') setDir(0, -1);
    else if (k === 'arrowdown' || k === 's') setDir(0, 1);
    else if (k === 'arrowleft' || k === 'a') setDir(-1, 0);
    else if (k === 'arrowright' || k === 'd') setDir(1, 0);
    else if (k === 'p' || k === ' ') { if (!dead) { paused = !paused; updateHud(); } }
    else if (k === 'r') { reset(); hideMsg(); }
    else if (k === 'w' && false) { /* noop */ }
  });

  /* 触摸方向键 */
  function bindBtn(id, fn) {
    var b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); fn(); });
  }
  bindBtn('b-up', function () { setDir(0, -1); });
  bindBtn('b-down', function () { setDir(0, 1); });
  bindBtn('b-left', function () { setDir(-1, 0); });
  bindBtn('b-right', function () { setDir(1, 0); });
  bindBtn('b-pause', function () { if (!dead) { paused = !paused; updateHud(); } });

  document.getElementById('btn-new').addEventListener('click', function () { reset(); hideMsg(); blurFocus(); });
  document.getElementById('btn-wrap').addEventListener('click', function () {
    wrap = !wrap;
    this.textContent = wrap ? '穿墙：开' : '穿墙：关';
    blurFocus();
  });
  document.getElementById('msg').querySelector('button').addEventListener('click', function () { reset(); hideMsg(); blurFocus(); });

  /* 点过按钮后焦点会留在按钮上，此时按空格会被当成「激活按钮」，
     结果是刚按暂停就变成重开。把焦点挪走，键盘才归游戏管。 */
  function blurFocus() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d');
    cv.width = W; cv.height = H;
    elScore = document.getElementById('score');
    elBest = document.getElementById('best');
    elMsg = document.getElementById('msg');
    elState = document.getElementById('state');
    reset();
    last = performance.now();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.SNAKE = {
    state: function () { return { score: score, dead: dead, paused: paused, len: snake.length, wrap: wrap }; },
    reset: reset, setDir: setDir,
    snake: function () { return snake.map(function (s) { return { x: s.x, y: s.y }; }); },
    food: function () { return { x: food.x, y: food.y }; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
