/* ============================================================
 * games.draw.js —— 你画我猜
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

  var DW_W = 1000, DW_H = 640;
  var DW_COLORS = ['#2b2440', '#ff5d5d', '#2f7cf6', '#f5b301', '#2fbf71', '#a259ff', '#8b5a2b', '#fdfaf3'];
  var DW_WIDTHS = [3, 6, 11, 18];

  K.register('draw', {
    aspect: DW_W / DW_H,
    howTo: '轮到你画：屏幕下方是调色板和笔宽，<b>按住拖动</b> 画，把词画出来<br>'
      + '轮到别人画：在底部输入框 <b>打字猜</b>，回车提交，猜对得分<br>'
      + '谁先猜对谁分高，画的人也会按猜中人数加分；<b>词本身不能写出来</b>',
    reserve: 130,          /* 顶部提示条 + 底部猜词框，画布要让开 */
    reserveFor: function (S) { return S.g && S.g.isDrawer ? 128 : 130; },
    keys: [],
    init: function (S) {
      S.g = {
        ph: 'intro', dr: '', tl: 0, tot: 70, mk: '', wd: '', no: 0,
        sc: [], gd: [], gw: [], word: '', cat: '', isDrawer: false,
        color: 0, width: 1, applied: 0, needAt: 0, dash: null, fl: []
      };
      buildDrawBoard(S);
      buildDrawUi(S);
    },
    onStart: function (S) {
      /* 新一局：清板并重新要一次全量 */
      resetBoard(S, true);
    },
    onEvent: function (S, d) {
      if (!d) return;
      if (d.e === 'word') {
        S.g.word = d.w || '';
        S.g.cat = d.c || '';
        paintDraw(S);
      } else if (d.e === 'turn') {
        S.g.word = '';
        S.g.isDrawer = (d.dr === S.you);
        S.g.applied = 0;
        S.g.no = 0;
        resetBoard(S, false);
        if (S.g.isDrawer) S.net.action('needword', {});
        paintDraw(S);
      }
    },
    onSnap: function (S, d) {
      var g = S.g;
      if (d.full) {
        resetBoard(S, false);
        applyOps(S, d.ds || []);
        /* 全量之后把计数顶到很高，避免因为服务端裁剪旧增量而反复要全量 */
        g.applied = 1e9;
        return;
      }
      g.ph = d.ph || g.ph;
      /* 换画者：把上一轮的词清掉，避免下一个画者看到别人的答案 */
      if (d.dr && d.dr !== g.dr) { g.dr = d.dr; g.word = ''; }
      g.dr = d.dr || g.dr;
      g.tl = d.tl || 0;
      g.tot = d.tot || 70;
      g.sc = d.sc || [];
      g.gd = d.gd || [];
      g.gw = d.gw || [];
      if (typeof d.mk === 'string') g.mk = d.mk;
      if (d.wd) g.wd = d.wd;
      g.isDrawer = (g.dr === S.you);
      if (d.ti) g.ti = d.ti;
      if (d.tn) g.tn = d.tn;
      /* 开局那一下 START 先到、词事件可能比渲染早，落到这里补一次 */
      if (g.isDrawer && !g.word && g.ph === 'drawing' && S.t > (g.wordAt || 0)) {
        g.wordAt = S.t + 1.2;
        S.net.action('needword', {});
      }
      if (d.ds) { applyOps(S, d.ds); g.applied += d.ds.length; }
      /* 增量对不上（中途进来 / 丢过包）：要一次全量 */
      if (typeof d.no === 'number' && d.no > g.applied && S.t > g.needAt) {
        g.needAt = S.t + 2;
        S.net.action('redraw', {});
      }
      paintDraw(S);
    },
    sendInput: function () { /* 画板用一次性动作，不用持续输入 */ },
    draw: function (S) {
      var c = S.draw;
      fit(S, DW_W, DW_H);
      var g = S.g;
      /* 纸面 */
      c.fillStyle = '#fdfaf3';
      rr(c, 0, 0, DW_W, DW_H, 18);
      c.fill();
      /* 淡网格，方便构图 */
      c.strokeStyle = 'rgba(43,36,64,.05)';
      c.lineWidth = 1;
      for (var x = 50; x < DW_W; x += 50) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, DW_H); c.stroke(); }
      for (var y = 50; y < DW_H; y += 50) { c.beginPath(); c.moveTo(0, y); c.lineTo(DW_W, y); c.stroke(); }
      if (g.board) {
        c.drawImage(g.board, 0, 0, DW_W * DW_PIX, DW_H * DW_PIX, 0, 0, DW_W, DW_H);
      }
      c.strokeStyle = 'rgba(43,36,64,.16)';
      c.lineWidth = 2;
      rr(c, 1, 1, DW_W - 2, DW_H - 2, 18);
      c.stroke();
      /* 低头提示 */
      if (g.ph === 'intro') {
        c.fillStyle = 'rgba(43,36,64,.35)';
        c.font = '600 26px system-ui,sans-serif';
        c.textAlign = 'center';
        c.fillText('准备开始 · 第 ' + (g.ti || 1) + ' / ' + (g.tn || 1) + ' 轮', DW_W / 2, DW_H / 2);
      }
      drawFloats(S);
    },
    scoreRows: function (S) {
      return (S.g.sc || []).map(function (x) {
        var solved = (S.g.gd || []).indexOf(x[0]) >= 0;
        return { id: x[0], name: nameOf(S, x[0]), color: seatColor(S, x[0]), text: x[1] + ' 分' + (solved ? ' ✓' : '') };
      }).sort(function (a, b) { return parseInt(b.text) - parseInt(a.text); });
    }
  });
  /* ============================================================
   * 球场 2v2（第七个联机玩法）
   * ------------------------------------------------------------
   * 这是第一个「全流程客户端预测」的玩法：
   *   · 跑动：本地每帧预测（Pred），快照到达后摆回 + 重放；
   *   · 球：也用 Pred 组件预测，但它的「输入」是本帧所有球员的位置——
   *     球在物理上就是被人的位置推着走的，所以它的可预测性和人一样好；
   *   · 射门：本地立即生效（球飞出去 + 脚上冒火光），服务端回头确认。
   * 唯一「等服务端」的是进球与比分——因为那需要知道全场所有人的位置，
   * 而进球后本来就有 2.4 秒的重摆停顿，等一趟 RTT 根本看不出来。
   * ============================================================ */
  var DW_PIX = 2;   /* 离屏画板按 2 倍分辨率存，缩放后不糊 */

  function resetBoard(S, alsoOps) {
    var g = S.g;
    if (!g.board) return;
    var b = g.board.getContext('2d');
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, DW_W * DW_PIX, DW_H * DW_PIX);
    b.fillStyle = '#fdfaf3';
    b.fillRect(0, 0, DW_W * DW_PIX, DW_H * DW_PIX);
    g.lastX = null; g.lastY = null;
    if (alsoOps) { g.applied = 0; g.no = 0; }
  }

  function applyOps(S, ops) {
    var g = S.g;
    if (!g.board || !ops) return;
    var b = g.board.getContext('2d');
    b.setTransform(DW_PIX, 0, 0, DW_PIX, 0, 0);
    b.lineCap = 'round';
    b.lineJoin = 'round';
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op[0] === 2) {
        b.save();
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.fillStyle = '#fdfaf3';
        b.fillRect(0, 0, DW_W * DW_PIX, DW_H * DW_PIX);
        b.restore();
        g.lastX = null; g.lastY = null;
      } else if (op[0] === 1) {
        b.strokeStyle = DW_COLORS[op[1]] || DW_COLORS[0];
        b.lineWidth = DW_WIDTHS[op[2]] || DW_WIDTHS[1];
        var x = op[3], y = op[4];
        /* 起笔点也画一个圆点，单点也能看见 */
        b.fillStyle = b.strokeStyle;
        b.beginPath(); b.arc(x, y, (DW_WIDTHS[op[2]] || 6) / 2, 0, 6.284); b.fill();
        g.lastX = x; g.lastY = y;
      } else if (op[0] === 0) {
        if (g.lastX == null) { g.lastX = op[1]; g.lastY = op[2]; continue; }
        b.beginPath();
        b.moveTo(g.lastX, g.lastY);
        b.lineTo(op[1], op[2]);
        b.stroke();
        g.lastX = op[1]; g.lastY = op[2];
      }
    }
  }

  function buildDrawBoard(S) {
    var cv = document.createElement('canvas');
    cv.width = DW_W * DW_PIX;
    cv.height = DW_H * DW_PIX;
    S.g.board = cv;
    resetBoard(S, true);
    var el = S.canvasWrap ? S.canvasWrap.querySelector('canvas') : null;
    if (!el) return;
    S.g.el = el;
    var pts = [], drawing = false, lastSend = 0, ns = true;

    function loc(ev) {
      var r = el.getBoundingClientRect();
      return [
        Math.max(0, Math.min(DW_W, (ev.clientX - r.left) / r.width * DW_W)),
        Math.max(0, Math.min(DW_H, (ev.clientY - r.top) / r.height * DW_H))
      ];
    }
    function flush(force) {
      if (!pts.length) return;
      var now = performance.now();
      if (!force && now - lastSend < 55) return;
      lastSend = now;
      S.net.action('draw', { pts: pts.splice(0, pts.length), c: S.g.color, w: S.g.width, ns: ns });
      ns = false;
    }
    function down(ev) {
      if (!canDraw(S)) return;
      ev.preventDefault();
      drawing = true; ns = true; pts = [];
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      var p = loc(ev);
      pts.push(p);
      flush(true);
    }
    function move(ev) {
      if (!drawing || !canDraw(S)) return;
      ev.preventDefault();
      pts.push(loc(ev));
      if (pts.length >= 12) flush(true);
      else flush(false);
    }
    function up(ev) {
      if (!drawing) return;
      drawing = false;
      flush(true);
      try { el.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    S.g.flush = function () { flush(true); };
  }

  function canDraw(S) {
    return S.g.isDrawer && S.g.ph === 'drawing' && S.g.el;
  }

  function buildDrawUi(S) {
    var host = S.canvasWrap;
    if (!host) return;
    /* 动手画的时候不要摇杆 */
    var touch = host.querySelector('.pk-touch');
    if (touch) touch.style.display = 'none';
    host.classList.add('pk-draw');

    var hud = document.createElement('div');
    hud.className = 'dw-hud';
    hud.innerHTML =
      '<div class="dw-turn"><b class="dw-role">准备中</b><span class="dw-hint"></span></div>' +
      '<div class="dw-bar"><i></i></div>';
    host.appendChild(hud);

    var tools = document.createElement('div');
    tools.className = 'dw-tools';
    tools.innerHTML = '<div class="dw-colors"></div><div class="dw-widths"></div><div class="dw-acts"></div>';
    host.appendChild(tools);
    var colorsBox = tools.querySelector('.dw-colors');
    DW_COLORS.forEach(function (col, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dw-color' + (i === 0 ? ' on' : '') + (i === 7 ? ' dw-eraser' : '');
      b.style.background = col;
      b.title = i === 7 ? '橡皮' : '';
      b.onclick = function () {
        S.g.color = i;
        if (i === 7) S.g.width = 3;
        Array.prototype.forEach.call(colorsBox.children, function (n) { n.classList.remove('on'); });
        b.classList.add('on');
      };
      colorsBox.appendChild(b);
    });
    var widthsBox = tools.querySelector('.dw-widths');
    DW_WIDTHS.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dw-width' + (i === 1 ? ' on' : '');
      b.innerHTML = '<i style="width:' + (4 + w) + 'px;height:' + (4 + w) + 'px"></i>';
      b.onclick = function () {
        S.g.width = i;
        S.g.color = i === 3 ? 7 : S.g.color;      /* 最粗那档直接当橡皮 */
        Array.prototype.forEach.call(widthsBox.children, function (n) { n.classList.remove('on'); });
        b.classList.add('on');
      };
      widthsBox.appendChild(b);
    });
    var acts = tools.querySelector('.dw-acts');
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'dw-act';
    clearBtn.textContent = '清空';
    clearBtn.onclick = function () {
      if (canDraw(S)) { if (S.g.flush) S.g.flush(); S.net.action('clear', {}); }
    };
    acts.appendChild(clearBtn);
    var skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'dw-act';
    skipBtn.textContent = '跳过';
    skipBtn.onclick = function () { if (S.g.isDrawer) S.net.action('skip', {}); };
    acts.appendChild(skipBtn);
    S.g.tools = tools;

    var guess = document.createElement('div');
    guess.className = 'dw-guess';
    guess.innerHTML =
      '<div class="dw-feed"></div>' +
      '<div class="dw-input"><input maxlength="12" placeholder="在这里输入你猜的词…"><button type="button">发送</button></div>';
    host.appendChild(guess);
    var input = guess.querySelector('input');
    var sendBtn = guess.querySelector('button');
    function submit() {
      var v = input.value.trim();
      if (!v) return;
      S.net.action('guess', { text: v });
      input.value = '';
    }
    sendBtn.onclick = submit;
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
    });
    S.g.guess = guess;
    S.g.input = input;
    S.g.feed = guess.querySelector('.dw-feed');
    paintDraw(S);
  }

  function paintDraw(S) {
    var g = S.g;
    if (!g || !g.tools) return;
    /* 画者没有底部猜词框，把这块空间还给画布（换角色时重算一次） */
    var isDr = !!g.isDrawer;
    if (g._wasDr !== isDr) {
      g._wasDr = isDr;
      if (g.tools.parentNode) g.tools.parentNode.classList.toggle('dw-drawer', isDr);
      if (S.relayout) S.relayout();
    }
    var role = g.tools.parentNode.querySelector('.dw-role');
    var hint = g.tools.parentNode.querySelector('.dw-hint');
    var bar = g.tools.parentNode.querySelector('.dw-bar i');
    if (!role) return;
    var on = g.ph === 'drawing' || g.ph === 'intro';
    g.tools.style.display = g.isDrawer && on ? '' : 'none';
    if (g.guess) g.guess.style.display = g.isDrawer ? 'none' : '';

    var drawerName = '';
    for (var i = 0; i < S.players.length; i++) if (S.players[i].id === g.dr) drawerName = S.players[i].name;

    if (g.ph === 'intro') {
      role.textContent = '准备中';
      hint.textContent = drawerName ? (drawerName + ' 准备画了') : '';
    } else if (g.ph === 'drawing') {
      if (g.isDrawer) {
        role.textContent = '你来画 · ' + (g.cat ? g.cat + '：' : '') + (g.word || '…');
        hint.textContent = '别写字，画出来让他们猜';
      } else {
        role.textContent = drawerName + ' 正在画';
        hint.textContent = '提示：' + (g.mk || '＿ ＿');
      }
    } else if (g.ph === 'reveal' || g.ph === 'done') {
      role.textContent = '答案：' + (g.wd || g.word || '');
      hint.textContent = g.wd ? '' : '';
    }
    var pct = Math.max(0, Math.min(100, (g.tl / (g.tot || 70)) * 100));
    bar.style.width = pct + '%';
    bar.style.background = pct < 25 ? '#ff7a7a' : pct < 55 ? '#ffd166' : '#8ff0b5';

    if (g.feed) {
      var html = '';
      if (g.gw && g.gw.length) {
        g.gw.forEach(function (x) {
          html += '<div class="dw-line"><b>' + esc(x.name) + '</b>：' + esc(x.text) + '</div>';
        });
      }
      if (g.gd && g.gd.length) {
        html += '<div class="dw-line ok">已猜中 ' + g.gd.length + ' 人</div>';
      }
      if (html !== g._feedKey) {
        g._feedKey = html;
        g.feed.innerHTML = html;
        g.feed.scrollTop = g.feed.scrollHeight;
      }
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
