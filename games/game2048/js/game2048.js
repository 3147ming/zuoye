/* ============================================================
 * games/game2048/js/game2048.js —— 数字合并
 * ------------------------------------------------------------
 * 自研实现。机制：4×4 网格、四向滑动合并、随机出 2/4、
 * 目标 2048、撤销一步、最高分本地存档、触屏滑动。
 *
 * 核心是 slideLine()：一行往左滑的完整语义（合并后空格右补、
 * 同一数字只合并一次、连着的四个只能配成两对）。
 * ============================================================ */
(function () {
  'use strict';

  var SIZE = 4;
  var TARGET = 2048;
  var KEY = 'game2048.best';

  var grid = [];        /* [row][col] = 数字或 0 */
  var score = 0;
  var best = 0;
  var over = false, won = false;
  var history = null;  /* 撤销：{grid, score} */

  var elScore, elBest, elGrid, elMsg, elSub;

  /* ---------- 核心：滑动一行 ----------
     line: [a,b,c,d]，方向 dir = -1(左) 或 +1(右)
     返回 {line: 结果数组, gained: 本次得分} */
  function slideLine(line, dir) {
    var vals = line.filter(function (v) { return v !== 0; });
    var res = [];
    var gained = 0;
    for (var i = 0; i < vals.length; i++) {
      if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
        var merged = vals[i] * 2;
        res.push(merged);
        gained += merged;
        i++;                       /* 这一对用掉了，不能再跟下一个配 */
      } else {
        res.push(vals[i]);
      }
    }
    while (res.length < SIZE) {
      if (dir === -1) res.push(0);           /* 左滑：空格拉右边 */
      else res.unshift(0);                   /* 右滑：空格拉左边 */
    }
    return { line: res, gained: gained };
  }

  function move(dir) {       /* dir: 'up' 'down' 'left' 'right' */
    if (over) return false;
    var before = JSON.stringify(grid);
    var beforeScore = score;
    var gained = 0;

    for (var k = 0; k < SIZE; k++) {
      var line = [];
      for (var i = 0; i < SIZE; i++) {
        if (dir === 'left') line.push(grid[k][i]);
        else if (dir === 'right') line.push(grid[k][SIZE - 1 - i]);
        else if (dir === 'up') line.push(grid[i][k]);
        else line.push(grid[SIZE - 1 - i][k]);
      }
      var d = (dir === 'left' || dir === 'up') ? -1 : 1;
      var r = slideLine(line, d);
      gained += r.gained;
      for (var j = 0; j < SIZE; j++) {
        var v = r.line[j];
        if (dir === 'left') grid[k][j] = v;
        else if (dir === 'right') grid[k][SIZE - 1 - j] = v;
        else if (dir === 'up') grid[j][k] = v;
        else grid[SIZE - 1 - j][k] = v;
      }
    }

    if (JSON.stringify(grid) === before) return false;   /* 没动就不算一步 */

    /* 撤销点：记录移动前的样子（只在真正移动时记） */
    history = { grid: JSON.parse(before), score: beforeScore };
    score += gained;
    if (score > best) { best = score; localStorage.setItem(KEY, String(best)); }
    addTile();
    checkEnd();
    paint();
    return true;
  }

  function addTile() {
    var spots = [];
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) if (!grid[y][x]) spots.push([x, y]);
    }
    if (!spots.length) return;
    var p = spots[Math.floor(Math.random() * spots.length)];
    /* 90% 出 2，10% 出 4 —— 和同类游戏一致的手感 */
    grid[p[1]][p[0]] = Math.random() < 0.9 ? 2 : 4;
  }

  function canMove() {
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        if (!grid[y][x]) return true;
        if (x + 1 < SIZE && grid[y][x] === grid[y][x + 1]) return true;
        if (y + 1 < SIZE && grid[y][x] === grid[y + 1][x]) return true;
      }
    }
    return false;
  }

  function checkEnd() {
    if (!won) {
      for (var y = 0; y < SIZE; y++) {
        for (var x = 0; x < SIZE; x++) {
          if (grid[y][x] >= TARGET) { won = true; break; }
        }
      }
    }
    if (won && !canMove()) { over = true; show('游戏结束', '再试一次'); return; }
    if (won) { show('拼出 2048 啦！', '继续'); return; }
    if (!canMove()) { over = true; show('游戏结束', '再试一次'); }
  }

  function show(title, btn) {
    elMsg.style.display = 'flex';
    elMsg.querySelector('.m-title').textContent = title;
    elMsg.querySelector('button').textContent = btn;
  }
  function hideMsg() { elMsg.style.display = 'none'; }

  /* ---------- 绘制 ---------- */
  var TILE_COLORS = {
    2: ['#eee4da', '#776e65'], 4: ['#ede0c8', '#776e65'], 8: ['#f2b179', '#ffffff'],
    16: ['#f59563', '#ffffff'], 32: ['#f67c5f', '#ffffff'], 64: ['#f65e3b', '#ffffff'],
    128: ['#edcf72', '#ffffff'], 256: ['#edcc61', '#ffffff'], 512: ['#edc850', '#ffffff'],
    1024: ['#edc53f', '#ffffff'], 2048: ['#edc22e', '#ffffff']
  };
  function tileStyle(v) {
    var c = TILE_COLORS[v] || ['#3c3a32', '#ffffff'];
    return { bg: c[0], fg: c[1], size: v >= 1000 ? 26 : v >= 100 ? 30 : v >= 10 ? 34 : 40 };
  }

  function paint() {
    elGrid.innerHTML = '';
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        var v = grid[y][x];
        if (v) {
          var t = document.createElement('div');
          t.className = 'tile';
          var st = tileStyle(v);
          t.style.background = st.bg;
          t.style.color = st.fg;
          t.style.fontSize = st.size + 'px';
          t.textContent = String(v);
          cell.appendChild(t);
        }
        elGrid.appendChild(cell);
      }
    }
    elScore.textContent = String(score);
    elBest.textContent = String(best);
    elSub.textContent = won ? '已达成目标' : '目标 ' + TARGET;
  }

  /* ---------- 流程 ---------- */
  function reset() {
    grid = [];
    for (var y = 0; y < SIZE; y++) {
      var row = [];
      for (var x = 0; x < SIZE; x++) row.push(0);
      grid.push(row);
    }
    score = 0; over = false; won = false; history = null;
    hideMsg();
    addTile(); addTile();
    paint();
  }

  function undo() {
    if (!history || over) return;
    grid = history.grid;
    score = history.score;
    history = null;
    hideMsg();
    paint();
  }

  /* ---------- 输入 ---------- */
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    var map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
    if (map[k]) { e.preventDefault(); move(map[k]); }
    else if (k === 'u' || k === 'U') undo();
    else if (k === 'n' || k === 'N') { reset(); }
  });

  /* 触屏滑动 */
  var sx = 0, sy = 0, swiping = false;
  var elBoard = document.getElementById('board');
  elBoard.addEventListener('touchstart', function (e) {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
  }, { passive: true });
  elBoard.addEventListener('touchend', function (e) {
    if (!swiping) return;
    swiping = false;
    var dx = e.changedTouches[0].clientX - sx;
    var dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else move(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  document.getElementById('btn-new').addEventListener('click', function () { reset(); blurFocus(); });
  document.getElementById('btn-undo').addEventListener('click', function () { undo(); blurFocus(); });
  document.getElementById('msg').querySelector('button').addEventListener('click', function () {
    if (won && !over) { hideMsg(); blurFocus(); return; }
    reset(); blurFocus();
  });


  /* 点过按钮后焦点会留在按钮上，此时按空格会被当成「激活按钮」，
     键盘就归按钮管而不是归游戏管。把焦点挪走。 */
  function blurFocus() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    elScore = document.getElementById('score');
    elBest = document.getElementById('best');
    elGrid = document.getElementById('grid');
    elMsg = document.getElementById('msg');
    elSub = document.getElementById('sub');
    best = parseInt(localStorage.getItem(KEY) || '0', 10);
    reset();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.G2048 = {
    state: function () { return { score: score, best: best, over: over, won: won, grid: grid.map(function (r) { return r.slice(); }) }; },
    move: move, reset: reset, undo: undo,
    /* 测试/调试用：直接摆盘（自动化测试要构造「塞满且无法合并」这种
       随机滑动几乎碰不到的终局，靠 move 没法稳定复现） */
    setGrid: function (rows) {
      grid = rows.map(function (r) { return r.slice(); });
      score = 0; over = false; won = false; history = null;
      checkEnd(); paint();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
