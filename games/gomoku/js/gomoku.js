/* ============================================================
 * games/gomoku/js/gomoku.js —— 五子棋
 * ------------------------------------------------------------
 * 自研实现。机制：15×15 棋盘、人机对战、悔棋、难度、落子动画。
 *
 * 胜负判定不用「预先枚举所有五连」的大表（那种表有几十万项，
 * 建表慢、占内存），改成「下完一步后从落点向四个方向数格子」：
 * 同一颗子落下去，只需看这条线上的连续同色数量，O(1) 判定。
 * ============================================================ */
(function () {
  'use strict';

  var N = 15;            /* 棋盘 15×15 */
  var CELL = 34;         /* 每格像素 */
  var PAD = 22;          /* 棋盘外边距 */
  var SIZE = N * CELL + PAD * 2;

  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var board = [];        /* [y][x] */
  var history = [];      /* [{x,y,side}] 全部落子，用于悔棋 */
  var turn = BLACK;
  var over = false;
  var winLine = [];      /* 连成五子的坐标，用来画高亮 */
  var difficulty = 'normal';
  var aiTimer = 0;
  var lastMove = null;   /* {x,y,side} 最近一步 */

  var cv, ctx, elTurn, elStatus, elBtnUndo, elBtnNew, elDiff, elScore;

  /* ---------- 初始化 ---------- */
  function reset() {
    board = [];
    for (var y = 0; y < N; y++) {
      var row = [];
      for (var x = 0; x < N; x++) row.push(EMPTY);
      board.push(row);
    }
    history = [];
    turn = BLACK;
    over = false;
    winLine = [];
    lastMove = null;
    updateHud();
    draw();
  }

  /* ---------- 胜负判定 ----------
     从 (x,y) 起，沿四个方向数连续同色；满 5 即胜。
     返回连成的坐标数组（没连成返回空数组）。 */
  var DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  function checkWin(x, y, side) {
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var line = [[x, y]];
      /* 正向 */
      var nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny][nx] === side) {
        line.push([nx, ny]);
        nx += dx; ny += dy;
      }
      /* 反向 */
      nx = x - dx; ny = y - dy;
      while (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny][nx] === side) {
        line.unshift([nx, ny]);
        nx -= dx; ny -= dy;
      }
      if (line.length >= 5) return line;
    }
    return [];
  }

  function isFull() {
    return history.length >= N * N;
  }

  /* ---------- 落子 ---------- */
  function place(x, y, side) {
    if (over || board[y][x] !== EMPTY) return false;
    board[y][x] = side;
    history.push({ x: x, y: y, side: side });
    lastMove = { x: x, y: y, side: side };
    var line = checkWin(x, y, side);
    if (line.length) {
      winLine = line;
      over = true;
      setStatus(side === BLACK ? '你赢了！' : '电脑赢了', side === BLACK ? 'win' : 'lose');
      draw();
      return true;
    }
    if (isFull()) {
      over = true;
      setStatus('平局 · 棋盘满了', 'draw');
      draw();
      return true;
    }
    turn = side === BLACK ? WHITE : BLACK;
    updateHud();
    draw();
    return true;
  }

  /* ---------- AI ----------
     难度分三档，差别在「候选点怎么选」和「要不要看两层」：
       easy   只看自己能连成的点，随机性大
       normal 给自己和对手都打分，取自己的最高分（带一点随机）
       hard   在 normal 基础上多看一层对手的威胁
  */
  function aiCandidates() {
    var cands = [];
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        /* 只考虑空点。（这里原先写成「空了就跳过」，结果候选点全是已有棋子，
           AI 落不下去 —— 表现是「点了棋盘没反应」。） */
        if (board[y][x] !== EMPTY) continue;
        /* 空点附近两格内有子才算候选，避免开局满盘乱下 */
        if (!nearStone(x, y)) continue;
        cands.push([x, y]);
      }
    }
    return cands;
  }

  function nearStone(x, y) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
        if (board[ny][nx] !== EMPTY) return true;
      }
    }
    return false;
  }

  /* 在 (x,y) 落 side 后，该点能连成的长度（用于打分） */
  function scoreAt(x, y, side) {
    var best = 0;
    for (var d = 0; d < DIRS.length; d++) {
      var dx = DIRS[d][0], dy = DIRS[d][1];
      var cnt = 1;
      var nx = x + dx, ny = y + dy;
      while (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny][nx] === side) { cnt++; nx += dx; ny += dy; }
      nx = x - dx; ny = y - dy;
      while (nx >= 0 && nx < N && ny >= 0 && ny < N && board[ny][nx] === side) { cnt++; nx -= dx; ny -= dy; }
      if (cnt > best) best = cnt;
    }
    return best;
  }

  function aiMove() {
    var cands = aiCandidates();
    if (!cands.length) {
      /* 空盘：下天元 */
      return place(7, 7, WHITE);
    }
    var scored = [];
    for (var i = 0; i < cands.length; i++) {
      var x = cands[i][0], y = cands[i][1];
      board[y][x] = WHITE;
      var mine = scoreAt(x, y, WHITE);
      var theirs = 0;
      if (difficulty !== 'easy') {
        board[y][x] = BLACK;
        theirs = scoreAt(x, y, BLACK);
        board[y][x] = WHITE;
      }
      board[y][x] = EMPTY;

      var s = mine * mine + theirs * theirs * (difficulty === 'hard' ? 1.4 : 1);
      /* 轻微随机，避免每局一模一样 */
      s += Math.random() * (difficulty === 'easy' ? 6 : 1.6);
      /* 已经能成五的，优先级拉满 */
      if (mine >= 5) s += 10000;
      if (theirs >= 5 && difficulty !== 'easy') s += 6000;
      scored.push({ x: x, y: y, s: s });
    }
    scored.sort(function (a, b) { return b.s - a.s; });
    var pick = scored[0];
    return place(pick.x, pick.y, WHITE);
  }

  function aiTurn() {
    if (over || turn !== WHITE) return;
    var delay = difficulty === 'easy' ? 320 : difficulty === 'normal' ? 420 : 620;
    aiTimer = setTimeout(function () {
      aiTimer = 0;
      if (!over && turn === WHITE) aiMove();
    }, delay);
  }

  /* ---------- 悔棋 ----------
     悔一步：把最后一颗子拿掉；如果电脑已经落子，连它那步一起撤，
     轮到玩家重新走。 */
  function undo() {
    if (over) {
      /* 已经分出胜负也允许悔棋，但结果要重算 */
      over = false; winLine = [];
    }
    if (!history.length) return;
    /* 悔一步：
       若最后一步是电脑（白），那连它一起撤，回到「玩家刚走完」的状态；
       若最后一步是玩家（黑），只撤玩家那步。
       注意顺序：先看再撤，不要先 pop 再判断——那样会少撤一步。 */
    if (history[history.length - 1].side === WHITE) history.pop();
    if (history.length) history.pop();
    /* 重算盘面 */
    board = [];
    for (var y = 0; y < N; y++) {
      var row = [];
      for (var x = 0; x < N; x++) row.push(EMPTY);
      board.push(row);
    }
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      board[h.y][h.x] = h.side;
    }
    turn = (history.length && history[history.length - 1].side === BLACK) ? WHITE : BLACK;
    lastMove = history.length ? history[history.length - 1] : null;
    setStatus('', '');
    updateHud();
    draw();
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
    ctx.clearRect(0, 0, SIZE, SIZE);
    /* 棋盘底 */
    var g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, '#f3e0bb');
    g.addColorStop(1, '#e6cd9f');
    ctx.fillStyle = g;
    rr(ctx, 0, 0, SIZE, SIZE, 12); ctx.fill();

    /* 网格 */
    ctx.strokeStyle = 'rgba(90,60,30,.55)';
    ctx.lineWidth = 1;
    for (var i = 0; i < N; i++) {
      var p = PAD + i * CELL;
      ctx.beginPath(); ctx.moveTo(PAD, p); ctx.lineTo(PAD + (N - 1) * CELL, p); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p, PAD); ctx.lineTo(p, PAD + (N - 1) * CELL); ctx.stroke();
    }
    /* 天元与星位 */
    ctx.fillStyle = 'rgba(90,60,30,.75)';
    [[7, 7], [3, 3], [11, 3], [3, 11], [11, 11]].forEach(function (s) {
      ctx.beginPath();
      ctx.arc(PAD + s[0] * CELL, PAD + s[1] * CELL, 3.5, 0, 6.284);
      ctx.fill();
    });

    /* 棋子 */
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var v = board[y][x];
        if (!v) continue;
        drawStone(x, y, v);
      }
    }
    /* 胜利高亮 */
    if (winLine.length) {
      ctx.strokeStyle = 'rgba(255,80,80,.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      var a = winLine[0], b = winLine[winLine.length - 1];
      ctx.moveTo(PAD + a[0] * CELL, PAD + a[1] * CELL);
      ctx.lineTo(PAD + b[0] * CELL, PAD + b[1] * CELL);
      ctx.stroke();
    }
    /* 最后一步标记 */
    if (lastMove && !over) {
      ctx.strokeStyle = 'rgba(255,140,60,.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(PAD + lastMove.x * CELL, PAD + lastMove.y * CELL, CELL * 0.44, 0, 6.284);
      ctx.stroke();
    }
  }

  function drawStone(x, y, side) {
    var cx = PAD + x * CELL, cy = PAD + y * CELL, r = CELL * 0.42;
    var isWin = winLine.some(function (p) { return p[0] === x && p[1] === y; });
    ctx.save();
    ctx.shadowColor = 'rgba(60,40,20,.45)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    var grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    if (side === BLACK) {
      grad.addColorStop(0, '#6b6b78');
      grad.addColorStop(1, '#17171f');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#ddd8cc');
    }
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.284); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = isWin ? 'rgba(255,70,70,.95)' : 'rgba(40,30,15,.35)';
    ctx.lineWidth = isWin ? 3 : 1;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    elTurn.textContent = over ? '—' : (turn === BLACK ? '你（黑）' : '电脑（白）');
    elTurn.style.color = over ? '#8a8a94' : (turn === BLACK ? '#3a3340' : '#a08858');
    elScore.textContent = history.filter(function (h) { return h.side === BLACK; }).length + ' : '
      + history.filter(function (h) { return h.side === WHITE; }).length;
  }

  function setStatus(text, kind) {
    elStatus.textContent = text || '';
    elStatus.className = kind || '';
  }

  /* ---------- 交互 ---------- */
  function boardPos(e) {
    var r = cv.getBoundingClientRect();
    var px = (e.clientX - r.left) * (SIZE / r.width);
    var py = (e.clientY - r.top) * (SIZE / r.height);
    var x = Math.round((px - PAD) / CELL);
    var y = Math.round((py - PAD) / CELL);
    if (x < 0 || x >= N || y < 0 || y >= N) return null;
    return [x, y];
  }


  /* 点过按钮后焦点会留在按钮上，此时按空格会被当成「激活按钮」，
     键盘就归按钮管而不是归游戏管。把焦点挪走。 */
  function blurFocus() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    cv = document.getElementById('chess');
    cv.width = SIZE; cv.height = SIZE;
    ctx = cv.getContext('2d');
    elTurn = document.getElementById('turn');
    elStatus = document.getElementById('status');
    elBtnUndo = document.getElementById('btn-undo');
    elBtnNew = document.getElementById('btn-new');
    elDiff = document.getElementById('diff');
    elScore = document.getElementById('score');

    /* 绑定要放在 init 里：cv 等变量此时才有值。
       写在模块顶层会在脚本执行瞬间就因为 cv 是 undefined 报错，
       连带 init 都不会跑。 */
    cv.addEventListener('click', function (e) {
      if (over || turn !== BLACK) return;
      var p = boardPos(e);
      if (!p) return;
      if (board[p[1]][p[0]] !== EMPTY) return;
      place(p[0], p[1], BLACK);
      if (!over) aiTurn();
    });

    elBtnUndo.addEventListener('click', function () { undo(); blurFocus(); });
    elBtnNew.addEventListener('click', function () { reset(); blurFocus(); });
    elDiff.addEventListener('change', function () { difficulty = elDiff.value; });

    reset();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.GOMOKU = {
    state: function () { return { turn: turn, over: over, moves: history.length, win: winLine.length }; },
    place: place, reset: reset, undo: undo,
    board: function () { return board.map(function (r) { return r.slice(); }); },
    aiMove: aiMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
