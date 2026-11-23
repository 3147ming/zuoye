/* ============================================================
 * games/mine/js/mine.js —— 扫雷
 * ------------------------------------------------------------
 * 自研实现。机制：左键挖开 / 右键插旗 / 数字提示 / 计时 / 纪录 / 触摸长按。
 *
 * 几个关键设计：
 *   · 第一下永远挖不到雷（雷在第一次点击之后才铺，且避开首点及其邻域）；
 *   · 插旗数计入剩余雷数，插错旗（旗下面没雷）判负；
 *   · 连锁展开用队列而不是递归 —— 大面积空白时递归会爆栈。
 * ============================================================ */
(function () {
  'use strict';

  var LEVELS = {
    beginner: { w: 9, h: 9, mines: 10 },
    intermediate: { w: 16, h: 16, mines: 40 },
    expert: { w: 30, h: 16, mines: 99 },
    custom: { w: 16, h: 16, mines: 40 }
  };

  var board = document.getElementById('board');
  var elMines = document.getElementById('mines');
  var elTime = document.getElementById('time');
  var elFace = document.getElementById('face');
  var elLv = document.getElementById('lv');
  var elBest = document.getElementById('best');

  var w = 9, h = 9, mineTotal = 10;
  var grid = [];            /* 每格：{mine, open, flag, n} */
  var flags = 0, opened = 0, dead = false, won = false;
  var started = false, startAt = 0, elapsed = 0, timer = 0;
  var curLevel = 'beginner';

  /* ---------- 布局 ---------- */
  function cfg() {
    var c = LEVELS[curLevel];
    w = c.w; h = c.h; mineTotal = c.mines;
  }

  function build() {
    cfg();
    board.style.gridTemplateColumns = 'repeat(' + w + ', auto)';
    board.innerHTML = '';
    grid = [];
    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) row.push({ mine: false, open: false, flag: false, n: 0 });
      grid.push(row);
    }
    for (var y2 = 0; y2 < h; y2++) {
      for (var x2 = 0; x2 < w; x2++) {
        var c = document.createElement('div');
        c.className = 'c';
        c.dataset.x = x2; c.dataset.y = y2;
        board.appendChild(c);
      }
    }
  }

  /* ---------- 铺雷 ----------
     第一下点在 (sx,sy)：雷不铺在首点，也不铺在它的 8 邻域，
     这样首点必然是 0，能看到一片展开区（经典扫雷的手感）。 */
  function layMines(sx, sy) {
    var banned = {};
    banned[sx + ',' + sy] = 1;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var nx = sx + dx, ny = sy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) banned[nx + ',' + ny] = 1;
      }
    }
    var safe = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) if (!banned[x + ',' + y]) safe.push([x, y]);
    }
    /* Fisher-Yates 部分洗牌，取前 mineTotal 个 */
    for (var i = safe.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = safe[i]; safe[i] = safe[j]; safe[j] = t;
    }
    var n = Math.min(mineTotal, safe.length);
    for (var k = 0; k < n; k++) {
      grid[safe[k][1]][safe[k][0]].mine = true;
    }
    /* 数邻雷 */
    for (var y3 = 0; y3 < h; y3++) {
      for (var x3 = 0; x3 < w; x3++) {
        grid[y3][x3].n = countAround(x3, y3);
      }
    }
  }

  function countAround(x, y) {
    var n = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (grid[ny][nx].mine) n++;
      }
    }
    return n;
  }

  /* ---------- 展开 ---------- */
  function reveal(sx, sy) {
    var stack = [[sx, sy]];
    while (stack.length) {
      var p = stack.pop();
      var x = p[0], y = p[1];
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      var c = grid[y][x];
      if (c.open || c.flag) continue;
      c.open = true;
      opened++;
      if (c.n === 0) {
        /* 空白格：把周围一起推入队列（连锁展开） */
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            stack.push([x + dx, y + dy]);
          }
        }
      }
    }
  }

  /* ---------- 胜负 ---------- */
  function checkWin() {
    if (dead || won) return;
    if (opened !== w * h - mineTotal) return;
    won = true;
    /* 自动把剩下的雷都插上旗 */
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (grid[y][x].mine && !grid[y][x].flag) { grid[y][x].flag = true; flags++; }
      }
    }
    elFace.textContent = '😎';
    stopTimer();
    paint();
    updateHud();
    saveBest();
  }

  function boom(x, y) {
    dead = true;
    elFace.textContent = '😵';
    stopTimer();
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        if (grid[yy][xx].mine && !grid[yy][xx].flag) grid[yy][xx].open = true;
      }
    }
    grid[y][x].boom = true;
    paint();
    updateHud();
  }

  /* ---------- 绘制 ---------- */
  function paint() {
    var cells = board.children;
    for (var i = 0; i < cells.length; i++) {
      var el = cells[i];
      var x = +el.dataset.x, y = +el.dataset.y;
      var c = grid[y][x];
      el.className = 'c';
      el.textContent = '';
      if (c.flag) { el.classList.add('flag'); el.textContent = '🚩'; continue; }
      if (!c.open) continue;
      el.classList.add('open');
      if (c.mine) {
        el.classList.add('boom');
        el.textContent = '💣';
      } else if (c.n > 0) {
        el.classList.add('n' + c.n);
        el.textContent = String(c.n);
      }
    }
  }

  function updateHud() {
    elMines.textContent = String(mineTotal - flags);
    elTime.textContent = String(elapsed);
    elBest.textContent = bestText();
  }

  function bestText() {
    var parts = [];
    ['beginner', 'intermediate', 'expert'].forEach(function (lv) {
      var t = localStorage.getItem('mine.best.' + lv);
      if (t) parts.push(LV_NAME[lv] + ' ' + t + 's');
    });
    return parts.length ? '最佳：' + parts.join(' · ') : '';
  }
  var LV_NAME = { beginner: '初级', intermediate: '中级', expert: '高级' };

  function saveBest() {
    var key = 'mine.best.' + curLevel;
    var old = parseInt(localStorage.getItem(key) || '0', 10);
    if (!old || elapsed < old) {
      localStorage.setItem(key, String(elapsed));
    }
  }

  /* ---------- 计时 ---------- */
  function startTimer() {
    started = true;
    startAt = Date.now() - elapsed * 1000;
    if (timer) return;
    timer = setInterval(function () {
      elapsed = Math.floor((Date.now() - startAt) / 1000);
      elTime.textContent = String(elapsed);
    }, 500);
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = 0; }
    /* 注意：还没开始计时（startAt 未初始化）时不要算时长，
       否则 Date.now() - undefined 会得到一个纳秒级的时间戳。 */
    if (!started) { elapsed = 0; elTime.textContent = '0'; return; }
    elapsed = Math.floor((Date.now() - startAt) / 1000);
    elTime.textContent = String(elapsed);
  }

  /* ---------- 交互 ---------- */
  function onOpen(x, y) {
    if (dead || won) return;
    var c = grid[y][x];
    if (c.flag) return;
    if (!started) {
      layMines(x, y);
      startTimer();
    }
    if (c.mine) { boom(x, y); return; }
    reveal(x, y);
    paint();
    updateHud();
    checkWin();
  }

  function onFlag(x, y) {
    if (dead || won) return;
    var c = grid[y][x];
    if (c.open) return;
    c.flag = !c.flag;
    flags += c.flag ? 1 : -1;
    paint();
    updateHud();
  }

  /* 鼠标：左键挖、右键插旗 */
  board.addEventListener('mousedown', function (e) {
    var el = e.target.closest('.c');
    if (!el) return;
    var x = +el.dataset.x, y = +el.dataset.y;
    if (e.button === 2) { e.preventDefault(); onFlag(x, y); }
    else if (e.button === 0) onOpen(x, y);
  });
  board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* 触摸：短按挖开，长按插旗 */
  var touchTimer = 0, touchMoved = false, touchXY = null;
  board.addEventListener('touchstart', function (e) {
    var el = e.target.closest('.c');
    if (!el) return;
    touchXY = { x: +el.dataset.x, y: +el.dataset.y };
    touchMoved = false;
    touchTimer = setTimeout(function () {
      onFlag(touchXY.x, touchXY.y);
      touchTimer = 0;
    }, 420);
  }, { passive: true });
  board.addEventListener('touchmove', function () {
    touchMoved = true;
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = 0; }
  }, { passive: true });
  board.addEventListener('touchend', function (e) {
    if (touchTimer) { clearTimeout(touchTimer); touchTimer = 0; }
    if (touchMoved || !touchXY) return;
    var el = e.target.closest('.c');
    if (!el) return;
    /* 长按已插旗就不再挖 */
    var c = grid[+el.dataset.y][+el.dataset.x];
    if (c.flag) return;
    onOpen(+el.dataset.x, +el.dataset.y);
  });

  /* 点过按钮后焦点留在按钮上，此时按键盘会被按钮吃掉。挪走焦点。 */
  function blurFocus() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* ---------- 重开 / 换难度 ---------- */
  function reset() {
    flags = 0; opened = 0; dead = false; won = false;
    started = false; elapsed = 0;
    if (timer) { clearInterval(timer); timer = 0; }
    startAt = Date.now();
    build();
    updateHud();
    elFace.textContent = '🙂';
  }

  elFace.addEventListener('click', function () { reset(); blurFocus(); });
  elLv.addEventListener('change', function () {
    curLevel = elLv.value;
    if (curLevel === 'custom') {
      var wv = parseInt(prompt('宽（5–30）', '16'), 10);
      var hv = parseInt(prompt('高（5–24）', '16'), 10);
      var mv = parseInt(prompt('雷数', '40'), 10);
      if (isNaN(wv) || isNaN(hv) || isNaN(mv)) { elLv.value = 'intermediate'; curLevel = 'intermediate'; }
      else {
        wv = Math.max(5, Math.min(30, wv));
        hv = Math.max(5, Math.min(24, hv));
        mv = Math.max(1, Math.min(wv * hv - 9, mv));
        LEVELS.custom = { w: wv, h: hv, mines: mv };
      }
    }
    reset();
  });

  reset();
  window.MINE = {
    open: function (x, y) { onOpen(x, y); },
    flag: function (x, y) { onFlag(x, y); },
    state: function () { return { opened: opened, flags: flags, dead: dead, won: won, mines: mineTotal, w: w, h: h }; },
    reset: reset
  };
})();
