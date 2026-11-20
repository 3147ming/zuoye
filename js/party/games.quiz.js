/* ============================================================
 * games.quiz.js —— 抢答赛
 * 公共件在 games.js（WH_PARTY_GAMES），本文件必须先于它之后加载。
 * ============================================================ */
(function (global) {
  'use strict';

  var K = global.PartyKit;
  var G = global.WH_PARTY_GAMES;
  if (!K || !G) return;

  var COLORS, rr, seatColor, nameOf, PRED, PHYS, ackOf, bodyOf, fit, dirOf, float, drawFloats;
  if (G) { COLORS = G.COLORS; rr = G.rr; seatColor = G.seatColor; nameOf = G.nameOf;
    PRED = G.PRED; PHYS = G.PHYS; ackOf = G.ackOf; bodyOf = G.bodyOf;
    fit = G.fit; dirOf = G.dirOf; float = G.float; drawFloats = G.drawFloats; }

  K.register('quiz', {
    aspect: 16 / 10,
    howTo: '<b>鼠标点选项</b>，或按 <b>1 / 2 / 3 / 4</b> 选第几个答案<br>'
      + '答对 <b>+100 分</b>，抢得越早分越高；<b>连续答对</b>每题再加 15（最多 +45）<br>'
      + '<b>答错扣 20 分</b>且这题不能再答；一局 10 题，总分最高者赢',
    keys: ['1', '2', '3', '4'],
    init: function (S) {
      S.g = { q: null, a: [], ph: 'intro', i: 0, n: 10, left: 0, sc: [], ans: [], k: -1, chosen: -1, cat: '', cb: {}, hit: {}, fb: null };
      buildQuizDom(S);
    },
    onKey: function (S, k) {
      var idx = ['1', '2', '3', '4'].indexOf(k);
      if (idx >= 0) answer(S, idx);
    },
    sendInput: function () { /* 抢答没有持续输入 */ },
    onSnap: function (S, d) {
      var g = S.g;
      if (d.ph === 'question' && g.ph !== 'question') { g.chosen = -1; g.fb = null; }
      g.ph = d.ph; g.i = d.i; g.n = d.n; g.left = d.left; g.sc = d.sc || []; g.ans = d.ans || [];
      g.cat = d.cat || '';
      if (d.cb) { g.cb = {}; d.cb.forEach(function (x) { g.cb[x[0]] = x[1]; }); }
      if (d.q) { g.q = d.q.q || ''; g.a = d.q.a || []; }
      if (typeof d.k === 'number') g.k = d.k;
      /* 自己已答则锁定按钮 */
      var mine = g.ans.filter(function (x) { return x[0] === S.you; })[0];
      g.chosen = mine ? mine[1] : -1;
      paintQuiz(S);
      /* 顺序要紧：paintQuiz 会把反馈条重写成「已选 X · 等其他人作答…」，
         事件必须放在它之后处理，否则「答对了 +100」立刻被盖掉 —— 
         实测现象就是答对了、分数也涨到 100，但反馈条还写着「等其他人」。 */
      (d.ev || []).forEach(function (e) { quizEvent(S, e); });
    },
    draw: function () { /* 抢答用 DOM，不画 canvas */ },
    scoreRows: function (S) {
      return (S.g.sc || []).map(function (x) {
        var streak = (S.g.cb || {})[x[0]] || 0;
        return {
          id: x[0], name: nameOf(S, x[0]), color: seatColor(S, x[0]),
          text: x[1] + ' 分' + (streak > 1 ? ' · 连对 ' + streak : '')
        };
      }).sort(function (a, b) { return parseInt(b.text) - parseInt(a.text); });
    }
  });

  function answer(S, idx) {
    var g = S.g;
    if (g.ph !== 'question' || g.chosen >= 0) return;
    if (idx >= (g.a || []).length) return;
    g.chosen = idx;
    S.net.action('answer', { k: idx });
    paintQuiz(S);
  }

  /* 服务端判定结果即时回话，不用等 7 秒揭晓。
     注意：抢答赛的事件是塞在快照的 ev 里下发的（server/games/quiz.js 只往
     events 里 push，没有单独发 event 包），所以只能从 onSnap 里消费 ——
     挂在 onEvent 上永远收不到，玩家就只能看着「已选 A」干等。 */
  function quizEvent(S, d) {
    if (!d || !S.g) return;
    var g = S.g;
    if (d.e === 'right') {
      if (d.id === S.you) {
        g.fb = { k: 'ok', t: '答对了 +' + d.gain + (d.bonus ? ' 分 · 连对 ' + d.streak + ' 题再 +' + d.bonus : ' 分') };
      } else {
        g.fb = { k: 'wait', t: nameOf(S, d.id) + ' 抢先答对了（答案 ' + String.fromCharCode(65 + d.k) + '）' };
      }
    } else if (d.e === 'wrong' && d.id === S.you) {
      g.fb = { k: 'bad', t: '答错了 -20 分，这题不能再答' };
    }
  }

  function buildQuizDom(S) {
    var host = S.canvasWrap || document.querySelector('.pk-canvas-wrap');
    if (!host) return;
    var box = document.createElement('div');
    box.className = 'qz';
    box.innerHTML =
      '<div class="qz-top"><span class="qz-idx">准备中</span><span class="qz-cat"></span><span class="qz-timer"><i></i></span></div>' +
      '<div class="qz-q">等房主开局…</div>' +
      '<div class="qz-opts"></div>' +
      '<div class="qz-fb"></div>' +
      '<div class="qz-tip">按 1 / 2 / 3 / 4 或直接点选项</div>';
    host.insertBefore(box, host.firstChild);
    S.g.dom = box;
    var opts = box.querySelector('.qz-opts');
    for (var i = 0; i < 4; i++) {
      (function (idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'qz-opt';
        b.onclick = function () { answer(S, idx); };
        opts.appendChild(b);
      })(i);
    }
    /* 抢答不需要 canvas：连容器一起收起来，让 DOM 面板吃掉整块高度 */
    var canvas = host.querySelector('canvas');
    if (canvas) canvas.style.display = 'none';
    host.classList.add('pk-quiz');
    box.style.position = 'static';
    box.style.inset = 'auto';
    box.querySelector('.qz-tip').textContent = '按 1 / 2 / 3 / 4 或直接点选项 · 答得越快分越高 · 连对再加分';
    /* 抢答不需要摇杆 */
    var touch = host.querySelector('.pk-touch');
    if (touch) touch.style.display = 'none';
  }

  function paintQuiz(S) {
    var g = S.g, box = g.dom;
    if (!box) return;
    var idxEl = box.querySelector('.qz-idx');
    var catEl = box.querySelector('.qz-cat');
    var qEl = box.querySelector('.qz-q');
    var opts = box.querySelectorAll('.qz-opt');
    var timer = box.querySelector('.qz-timer i');
    idxEl.textContent = g.i >= 0 ? ('第 ' + (g.i + 1) + ' / ' + g.n + ' 题') : '准备中';
    catEl.textContent = g.cat || '';
    catEl.style.display = g.cat ? '' : 'none';
    timer.style.width = Math.max(0, Math.min(100, (g.left / 7) * 100)) + '%';
    box.classList.toggle('reveal', g.ph === 'reveal');
    if (!g.q) { qEl.textContent = '等下一题…'; return; }
    qEl.textContent = g.q;
    var count = (g.a || []).length || 4;
    for (var i = 0; i < 4; i++) {
      var b = opts[i];
      if (!b) continue;
      if (i >= count) { b.style.display = 'none'; continue; }
      b.style.display = '';
      b.textContent = String.fromCharCode(65 + i) + '. ' + (g.a[i] || '');
      b.className = 'qz-opt';
      if (g.ph === 'reveal') {
        if (i === g.k) b.classList.add('right');
        else if (i === g.chosen) b.classList.add('wrong');
      } else if (i === g.chosen) {
        b.classList.add('picked');
      }
    }
    /* 即时反馈条完全由 S.g.fb 驱动。
       为什么不能只在事件里写一次：paintQuiz 每收到一帧快照（30Hz）就会重跑，
       事件写进去的那句「答对了 +100」会在 33ms 内被重绘覆盖掉，玩家根本看不到。
       所以把「要说什么」存进 S.g.fb，由这里每帧照它渲染。 */
    var fb = box.querySelector('.qz-fb');
    if (fb) {
      var mine = null;
      for (var j = 0; j < (g.ans || []).length; j++) if (g.ans[j][0] === S.you) { mine = g.ans[j]; break; }
      if (g.ph === 'reveal' && g.k >= 0) {
        if (mine && mine[1] === g.k) { fb.className = 'qz-fb ok'; fb.textContent = '答对了！正确答案就是 ' + String.fromCharCode(65 + g.k); }
        else if (mine) { fb.className = 'qz-fb bad'; fb.textContent = '答错了，正确答案是 ' + String.fromCharCode(65 + g.k); }
        else { fb.className = 'qz-fb'; fb.textContent = '这题没作答 · 正确答案是 ' + String.fromCharCode(65 + g.k); }
      } else if (g.fb && g.fb.t) {
        fb.className = 'qz-fb ' + (g.fb.k || '');
        fb.textContent = g.fb.t;
      } else if (mine) {
        fb.className = 'qz-fb wait';
        fb.textContent = '已选 ' + String.fromCharCode(65 + mine[1]) + ' · 等其他人作答…';
      } else {
        fb.className = 'qz-fb';
        fb.textContent = '';
      }
    }
  }

  /* ============================================================
   * 你画我猜
   * ------------------------------------------------------------
   * 画板用一张离屏 canvas 累积笔画（服务端只发增量点），
   * 主 canvas 每帧把离屏图贴上去，60fps 画几千个点也不掉帧。
   * ============================================================ */
})(typeof window !== 'undefined' ? window : globalThis);
