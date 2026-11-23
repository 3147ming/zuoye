/* ============================================================
 * games/tetris/js/tetris.js —— 俄罗斯方块
 * ------------------------------------------------------------
 * 自研实现。机制：七种方块、旋转、移动、软降/硬降、消行、
 * 等级加速、下一块预览、最高分本地存档。
 *
 * 网格 10×20，每格 26px；用 canvas 画，比 DOM 稳。
 * ============================================================ */
(function () {
  'use strict';

  var COLS = 10, ROWS = 20, CELL = 26;
  var W = COLS * CELL, H = ROWS * CELL;

  /* 七种方块：每个是 4×4 网格里的形状表（1 = 有方块） */
  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    T: [[0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    S: [[0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    Z: [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    L: [[0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
  };
  var TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  /* 每种方块的颜色 */
  var COLORS = {
    I: '#5ad2e6', O: '#ffd166', T: '#c0a5ff', S: '#8ff0b5', Z: '#ff8fb1', J: '#7ec8ff', L: '#ffa96b'
  };

  var board = [];        /* 棋盘：[y][x] = 颜色字符串或 '' */
  var cur = null;        /* { type, x, y, rot } */
  var next = null;
  var bag = [];
  var score = 0, lines = 0, level = 1;
  var over = false, paused = false;
  var dropAcc = 0, softAcc = 0;
  var last = 0;

  var cv, ctx, elScore, elLines, elLevel, elNext, elBest, elMsg;

  /* ---------- 随机袋：七种方块一轮一轮出，避免连续同款 ---------- */
  function refill() {
    bag = TYPES.slice();
    for (var i = bag.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
  }
  function pull() {
    if (!bag.length) refill();
    return bag.pop();
  }

  /* ---------- 棋盘 ---------- */
  function reset() {
    board = [];
    for (var y = 0; y < ROWS; y++) {
      var row = [];
      for (var x = 0; x < COLS; x++) row.push('');
      board.push(row);
    }
    score = 0; lines = 0; level = 1;
    over = false; paused = false;
    dropAcc = 0; softAcc = 0;
    bag = [];
    cur = spawn(pull());
    next = pull();
    updateHud();
  }

  function spawn(type) {
    return { type: type, x: type === 'I' || type === 'O' ? 3 : 3, y: 0, rot: 0 };
  }

  /* 取当前朝向的方块矩阵 */
  function matrix(p) {
    var m = SHAPES[p.type].map(function (r) { return r.slice(); });
    for (var k = 0; k < p.rot % 4; k++) {
      var out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
          out[x][3 - y] = m[y][x];
        }
      }
      m = out;
    }
    return m;
  }

  function cells(p) {
    var m = matrix(p), out = [];
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        if (m[y][x]) out.push([p.x + x, p.y + y]);
      }
    }
    return out;
  }

  function fits(p) {
    var cs = cells(p);
    for (var i = 0; i < cs.length; i++) {
      var x = cs[i][0], y = cs[i][1];
      if (x < 0 || x >= COLS || y >= ROWS) return false;
      if (y >= 0 && board[y][x]) return false;
    }
    return true;
  }

  /* ---------- 操作 ---------- */
  function move(dx) {
    if (over || paused) return;
    var p = { type: cur.type, x: cur.x + dx, y: cur.y, rot: cur.rot };
    if (fits(p)) { cur = p; }
  }

  function rotate(dir) {
    if (over || paused) return;
    var p = { type: cur.type, x: cur.x, y: cur.y, rot: (cur.rot + (dir || 1) + 4) % 4 };
    if (fits(p)) { cur = p; return; }
    /* 贴边时尝试「踢一脚」：左右挪一格再试，这是现代俄罗斯方块的常见手感 */
    for (var k = -1; k <= 1; k += 2) {
      var q = { type: cur.type, x: cur.x + k, y: cur.y, rot: p.rot };
      if (fits(q)) { cur = q; return; }
    }
  }

  function softDrop() {
    if (over || paused) return;
    var p = { type: cur.type, x: cur.x, y: cur.y + 1, rot: cur.rot };
    if (fits(p)) { cur = p; score += 1; }
    else lock();
    updateHud();
  }

  function hardDrop() {
    if (over || paused) return;
    var d = 0;
    var p = { type: cur.type, x: cur.x, y: cur.y, rot: cur.rot };
    while (fits({ type: p.type, x: p.x, y: p.y + 1, rot: p.rot })) { p.y++; d++; }
    cur = p;
    score += d * 2;
    lock();
    updateHud();
  }

  function lock() {
    var cs = cells(cur);
    for (var i = 0; i < cs.length; i++) {
      var x = cs[i][0], y = cs[i][1];
      if (y < 0) { over = true; return; }
      board[y][x] = COLORS[cur.type];
    }
    clearLines();
    if (!over) {
      cur = spawn(next);
      next = pull();
      if (!fits(cur)) { over = true; showMsg('游戏结束'); }
    }
    updateHud();
  }

  function clearLines() {
    var cleared = 0;
    for (var y = ROWS - 1; y >= 0; y--) {
      var full = true;
      for (var x = 0; x < COLS; x++) if (!board[y][x]) { full = false; break; }
      if (!full) continue;
      board.splice(y, 1);
      var top = [];
      for (var x2 = 0; x2 < COLS; x2++) top.push('');
      board.unshift(top);
      cleared++;
      y++;
    }
    if (cleared) {
      lines += cleared;
      score += [0, 100, 300, 500, 800][cleared] * level;
      level = 1 + Math.floor(lines / 10);
    }
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

  function block(c, x, y, color, alpha) {
    var px = x * CELL, py = y * CELL;
    c.globalAlpha = alpha == null ? 1 : alpha;
    c.fillStyle = color;
    rr(c, px + 1, py + 1, CELL - 2, CELL - 2, 4); c.fill();
    c.fillStyle = 'rgba(255,255,255,.28)';
    rr(c, px + 3, py + 3, CELL - 6, 5, 2); c.fill();
    c.fillStyle = 'rgba(0,0,0,.22)';
    rr(c, px + 3, py + CELL - 8, CELL - 6, 4, 2); c.fill();
    c.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    /* 背景格子 */
    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    for (var x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, H); ctx.stroke(); }
    for (var y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL + .5); ctx.lineTo(W, y * CELL + .5); ctx.stroke(); }
    /* 已落的方块 */
    for (var yy = 0; yy < ROWS; yy++) {
      for (var xx = 0; xx < COLS; xx++) {
        if (board[yy][xx]) block(ctx, xx, yy, board[yy][xx]);
      }
    }
    /* 当前方块 + 落点提示 */
    if (cur && !over) {
      var ghost = { type: cur.type, x: cur.x, y: cur.y, rot: cur.rot };
      while (fits({ type: ghost.type, x: ghost.x, y: ghost.y + 1, rot: ghost.rot })) ghost.y++;
      cells(ghost).forEach(function (p) {
        if (p[1] >= 0) block(ctx, p[0], p[1], COLORS[cur.type], 0.22);
      });
      cells(cur).forEach(function (p) {
        if (p[1] >= 0) block(ctx, p[0], p[1], COLORS[cur.type]);
      });
    }
  }

  /* 下一块预览 */
  function drawNext() {
    var c = elNext.getContext('2d');
    c.clearRect(0, 0, elNext.width, elNext.height);
    if (!next) return;
    var m = SHAPES[next];
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        if (!m[y][x]) continue;
        var px = x * 22 + 6, py = y * 22 + 6;
        c.fillStyle = COLORS[next];
        rr(c, px + 1, py + 1, 20, 20, 4); c.fill();
        c.fillStyle = 'rgba(255,255,255,.28)';
        rr(c, px + 3, py + 3, 16, 5, 2); c.fill();
      }
    }
  }

  function updateHud() {
    elScore.textContent = String(score);
    elLines.textContent = String(lines);
    elLevel.textContent = String(level);
    var best = parseInt(localStorage.getItem('tetris.best') || '0', 10);
    if (score > best) { best = score; localStorage.setItem('tetris.best', String(best)); }
    elBest.textContent = String(best);
    drawNext();
  }

  function showMsg(t) {
    elMsg.textContent = t || '';
    elMsg.style.display = t ? 'block' : 'none';
  }

  /* ---------- 主循环 ---------- */
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!over && !paused) {
      var interval = Math.max(0.08, 0.8 - (level - 1) * 0.07);
      dropAcc += dt;
      if (dropAcc >= interval) {
        dropAcc = 0;
        var p = { type: cur.type, x: cur.x, y: cur.y + 1, rot: cur.rot };
        if (fits(p)) cur = p;
        else lock();
      }
      /* 软降：按住时额外加速 */
      if (softAcc > 0) {
        softAcc -= dt;
        if (softAcc <= 0) softDrop();
      }
    }
    draw();
  }

  /* ---------- 输入 ---------- */
  var held = {};
  function repeat(delay, fn) {
    if (held[delay]) return;
    held[delay] = setTimeout(function () {
      held[delay] = setTimeout(function () { fn(); repeat(delay, fn); }, 60);
    }, delay);
  }
  function stopHold(k) {
    if (held[k]) { clearTimeout(held[k]); held[k] = null; }
  }

  document.addEventListener('keydown', function (e) {
    var k = String(e.key).toLowerCase();
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowdown' || k === ' ') e.preventDefault();
    if (k === 'p') { togglePause(); return; }
    if (k === 'r') { reset(); showMsg(''); return; }
    if (over) return;
    if (k === 'arrowleft') { move(-1); repeat('l', function () { move(-1); }); }
    else if (k === 'arrowright') { move(1); repeat('r', function () { move(1); }); }
    else if (k === 'arrowup') { rotate(1); }
    else if (k === ' ') { hardDrop(); }
    else if (k === 'arrowdown') { softDrop(); softAcc = 0.05; }
  });
  document.addEventListener('keyup', function (e) {
    var k = String(e.key).toLowerCase();
    if (k === 'arrowleft') stopHold('l');
    else if (k === 'arrowright') stopHold('r');
  });

  function togglePause() {
    if (over) return;
    paused = !paused;
    showMsg(paused ? '已暂停' : '');
  }

  /* 触摸按钮 */
  function bindBtn(id, fn) {
    var b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); fn(); });
  }
  bindBtn('b-left', function () { move(-1); });
  bindBtn('b-right', function () { move(1); });
  bindBtn('b-rot', function () { rotate(1); });
  bindBtn('b-down', function () { softDrop(); });
  bindBtn('b-drop', function () { hardDrop(); });

  /* ---------- 初始化 ---------- */
  function init() {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d');
    cv.width = W; cv.height = H;
    elScore = document.getElementById('score');
    elLines = document.getElementById('lines');
    elLevel = document.getElementById('level');
    elBest = document.getElementById('best');
    elNext = document.getElementById('next');
    elMsg = document.getElementById('msg');
    reset();
    last = performance.now();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.TETRIS = {
    state: function () { return { score: score, lines: lines, level: level, over: over, paused: paused }; },
    move: move, rotate: rotate, hardDrop: hardDrop, softDrop: softDrop,
    reset: reset, board: function () { return board; },
    /* 当前正在落的方块（还没进 board，所以单看 board 看不到操作结果） */
    current: function () { return cur ? { type: cur.type, x: cur.x, y: cur.y, rot: cur.rot } : null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
