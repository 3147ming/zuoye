/* ============================================================
 * js/party/kit.js —— 联机对局内核（客户端）
 * ------------------------------------------------------------
 * 职责：
 *   · 接管一块 DOM，画 canvas，跑 60fps 渲染循环
 *   · 采集输入（键盘 / 触屏摇杆 / 按钮）→ 节流后发给服务端
 *   · 收到 snapshot 只做「插值 + 绘制」，不做判定（服务端权威）
 *   · 顶部条：房间号 / 延迟 / 分列比分 / 退出
 * 每个游戏只需要提供：init(ctx) / draw(ctx) / input() / hud()
 * ============================================================ */
(function (global) {
  'use strict';

  var KIT = {};

  /* ---------- 游戏注册表（各游戏文件往里塞） ---------- */
  KIT.games = KIT.games || {};
  KIT.register = function (id, def) { KIT.games[id] = def; };

  /* ---------- 快照插值 ----------
   * 服务端 20~30Hz 发快照，画面跑 60fps。以前直接把快照值画上去，
   * 等于每秒只动 20 次，看着就是一跳一跳（尤其网络有抖动时更明显）。
   * 这里让每个实体记住「上一份快照里的显示位置」和「这一份的目标位置」，
   * 每帧按时间把显示位置推过去，视觉上变成连续运动。
   *
   * 实体是紧凑数组（[pid, x, y, ...]），所以按索引读写，不给对象加负担。
   */
  KIT.slide = function (oldList, newList, ix, iy, keyIdx) {
    if (!newList) return [];
    var map = null;
    if (oldList && oldList.length) {
      map = Object.create(null);
      for (var i = 0; i < oldList.length; i++) {
        var o = oldList[i];
        map[String(o[keyIdx])] = [o[ix], o[iy]];
      }
    }
    for (var j = 0; j < newList.length; j++) {
      var n = newList[j];
      var from = map && map[String(n[keyIdx])];
      /* 权威值另存一份：客户端预测必须读服务端真值，
         不能读下面被改写成插值起点的 n[ix]/n[iy]。
         少了这一步，自己那辆坦克的快照校正会拿着「上一帧的显示位置」
         当权威位置，重放后又把画布拉回去 —— 表现就是一直回弹。 */
      n._ax = n[ix];
      n._ay = n[iy];
      n._sx = from ? from[0] : n[ix];
      n._sy = from ? from[1] : n[iy];
      n._tx = n[ix];
      n._ty = n[iy];
      n._it = 0;
      n[ix] = n._sx;
      n[iy] = n._sy;
    }
    newList._ix = ix;
    newList._iy = iy;
    return newList;
  };

  KIT.tick = function (list, dt) {
    if (!list || list._ix == null) return;
    var ix = list._ix, iy = list._iy;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o._tx == null || o._it >= 1) continue;
      o._it = Math.min(1, o._it + dt / 0.034);  /* 33ms 走完 ≈ 一个快照间隔（30Hz） */
      var e = o._it * o._it * (3 - 2 * o._it);  /* smoothstep：起止都不生硬 */
      o[ix] = o._sx + (o._tx - o._sx) * e;
      o[iy] = o._sy + (o._ty - o._sy) * e;
    }
  };

  /* 把 S.g 里所有做了 slide 的数组推进一帧 */
  KIT.tickAll = function (S, dt) {
    if (!S || !S.g) return;
    for (var k in S.g) {
      var arr = S.g[k];
      if (arr && arr.length && arr._ix != null) KIT.tick(arr, dt);
    }
  };


  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  KIT.open = function (host, net, opts) {
    opts = opts || {};
    var gameId = net.room && net.room.game;
    var def = KIT.games[gameId];
    if (!def) {
      host.appendChild(el('div', 'pp-err', '这个玩法的客户端还没加载'));
      return;
    }
    if (host.__kitTeardown) { try { host.__kitTeardown(); } catch (e) { /* ignore */ } }

    host.innerHTML = '';
    document.body.classList.add('playing');
    var wrap = el('div', 'pk-wrap');
    var top = el('div', 'pk-top');
    var exitBtn = el('button', 'pk-exit', '← 退出对局');
    exitBtn.type = 'button';
    exitBtn.onclick = function () { if (opts.onExit) opts.onExit(); };

    /* ---------- 操作说明 ----------
       以前舞台里只有一个「开炮」按钮，玩家根本不知道 W/S 是前进后退、
       更不知道坦克是「往前开」而不是「往屏幕上方开」。这里按玩法给一句人话，
       默认展开一次、点一下收起，收起状态记在 localStorage 里。 */
    var howBtn = el('button', 'pk-how-btn', '怎么玩');
    howBtn.type = 'button';
    top.appendChild(exitBtn);
    top.appendChild(howBtn);

    var info = el('div', 'pk-info');
    var codeTag = el('span', 'pk-code', '房间 ' + (net.room ? net.room.code : ''));
    var pingTag = el('span', 'pk-ping', '—');
    info.appendChild(codeTag);
    info.appendChild(pingTag);
    top.appendChild(info);
    wrap.appendChild(top);

    var how = el('div', 'pk-how');
    how.innerHTML = String(def.howTo || '').split('\n').map(function (ln) {
      return '<p>' + ln + '</p>';
    }).join('');
    wrap.appendChild(how);
    var howKey = 'pk-how-open';
    var howOpen = true;
    try { howOpen = global.localStorage.getItem(howKey) !== '0'; } catch (e) { /* 隐私模式 */ }
    function applyHow() {
      wrap.classList.toggle('how-on', howOpen);
      howBtn.classList.toggle('on', howOpen);
    }
    applyHow();
    howBtn.onclick = function () {
      howOpen = !howOpen;
      applyHow();
      try { global.localStorage.setItem(howKey, howOpen ? '1' : '0'); } catch (e) { /* ignore */ }
      resize();
    };

    var scoreBar = el('div', 'pk-scores');
    wrap.appendChild(scoreBar);

    var canvasWrap = el('div', 'pk-canvas-wrap');
    var canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);

    /* 触屏：左下摇杆 + 右下动作键（桌面端自动隐藏） */
    var touch = el('div', 'pk-touch');
    var stick = el('div', 'pk-stick');
    stick.innerHTML = '<i></i>';
    var knob = stick.querySelector('i');
    var btns = el('div', 'pk-btns');
    touch.appendChild(stick);
    touch.appendChild(btns);
    canvasWrap.appendChild(touch);

    var overlay = el('div', 'pk-overlay');
    canvasWrap.appendChild(overlay);

    /* 竖屏提示：横版竞技在竖屏里上下空太多，给一句可关闭的提示 */
    if (global.matchMedia && global.matchMedia('(max-width: 520px) and (orientation: portrait)').matches) {
      var rot = el('div', 'pk-rotate', '横过来玩更顺 · 竖屏也能操作');
      var rotX = el('button', 'pk-rotate-x', '知道了');
      rotX.type = 'button';
      rotX.onclick = function () { rot.remove(); };
      rot.appendChild(rotX);
      wrap.appendChild(rot);
    }

    host.appendChild(wrap);

    var ctx2d = canvas.getContext('2d');
    var view = { w: 960, h: 600, dpr: 1 };

    /* ---------- 画布随容器自适应（保住逻辑宽高比） ---------- */
    var aspect = def.aspect || (16 / 10);
    /* getBoundingClientRect 依赖布局完成：首帧可能拿到 0，用 0 会算出极小画布。
       所以 resize 里先兜住容器尺寸，再在下一帧补一次（等字体/布局稳定）。 */
    function resize() {
      /* 不用 canvasWrap 的 rect：它靠 flex:1 撑开，而 flex 的高度又取决于画布尺寸，
         会形成「画布小 → 容器小 → 画布更小」的循环。改按舞台/视口算，单向下行不受影响。 */
      /* 直接量 canvasWrap 的「可用框」，但给它一个下限：
         竖屏手机上它可能因为 flex 还没算好而偏小，用视口宽兜底。
         只要算出来的画布不超过这个框，就不会反向把框挤小，不构成循环。 */
      var box = canvasWrap.getBoundingClientRect();
      /* 可用高度只能从「视口」推，不能用 box.height：
         flex 布局下 box.height 由画布撑出来，用它会把画布越撑越高，
         最后整块舞台溢出视口（手机上表现为底部被切掉、页面还能往下滚）。 */
      var top = Math.max(0, box.top);
      var reserve = (S && def.reserveFor) ? def.reserveFor(S) : (def.reserve || 0);  /* 玩法自留的上下覆盖条高度 */
      var availW = Math.max(280, Math.min(box.width || global.innerWidth - 32, global.innerWidth - 16));
      var availH = Math.max(240, global.innerHeight - top - 22 - reserve);
      var w = availW, h = w / aspect;
      if (h > availH) { h = availH; w = h * aspect; }
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      canvas.style.width = Math.round(w) + 'px';
      canvas.style.height = Math.round(h) + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      view.w = w; view.h = h; view.dpr = dpr;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    global.requestAnimationFrame(resize);
    /* 首帧量到的 top 可能还没算上记分条，再补几次，避免底部被切掉 */
    [60, 220, 600].forEach(function (ms) { global.setTimeout(resize, ms); });
    global.addEventListener('resize', resize);

    /* ---------- 状态容器 ---------- */
    var S = {
      net: net,
      canvasWrap: canvasWrap,
      you: net.you,
      room: net.room,
      players: (net.room && net.room.players) || [],
      tick: 0,
      serverTick: 0,
      rx: 0,                 /* 收到快照次数，用于判断卡顿 */
      lastSnapAt: performance.now(),
      over: null,
      startAt: 0,
      keys: Object.create(null),
      axis: { x: 0, y: 0 },
      pressed: [],           /* 本帧按下的一次性按键 */
      actions: [],           /* 本帧要发的动作 */
      t: 0,
      draw: ctx2d,
      view: view
    };

    def.init(S, net.room);
    S.relayout = resize;       /* 玩法切换覆盖条时可以主动重算画布 */
    host.__S = S;              /* 调试用：控制台可直接看当前状态 */
    /* 自动化测试（tools/e2e-*.mjs）从这里读内部状态：
       没有它就只能靠截图猜，验收会退化成「看起来对」。 */
    global.PARTY_KIT_STATE = S;

    /* ---------- 输入 ---------- */
    function onKey(e, down) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      var handled = def.keys ? def.keys.indexOf(k) >= 0 : false;
      if (handled) e.preventDefault();
      if (down && !S.keys[k]) S.pressed.push(k);
      S.keys[k] = down;
      S.axis.x = (S.keys.arrowright || S.keys.d || S.keys['ArrowRight'] ? 1 : 0) - (S.keys.arrowleft || S.keys.a || S.keys['ArrowLeft'] ? 1 : 0);
      S.axis.y = (S.keys.arrowdown || S.keys.s || S.keys['ArrowDown'] ? 1 : 0) - (S.keys.arrowup || S.keys.w || S.keys['ArrowUp'] ? 1 : 0);
      if (down && def.onKey) def.onKey(S, k, e);
    }
    var kd = function (e) { onKey(e, true); };
    var ku = function (e) { onKey(e, false); };
    global.addEventListener('keydown', kd);
    global.addEventListener('keyup', ku);

    /* ---------- 摇杆 ---------- */
    var stickActive = false, stickId = null, sx = 0, sy = 0;
    function stickPos(ev) {
      var r = stick.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = ev.clientX - cx, dy = ev.clientY - cy;
      var max = r.width / 2 - 8;
      var m = Math.hypot(dx, dy);
      if (m > max) { dx = dx / m * max; dy = dy / m * max; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      var ax = dx / max, ay = dy / max;
      if (Math.hypot(ax, ay) < 0.18) { ax = 0; ay = 0; }
      S.axis.x = ax; S.axis.y = ay;
    }
    stick.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      stickActive = true; stickId = t.identifier;
      stickPos(t);
    }, { passive: false });
    stick.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!stickActive) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === stickId) stickPos(e.changedTouches[i]);
      }
    }, { passive: false });
    stick.addEventListener('touchend', function () {
      stickActive = false; stickId = null;
      knob.style.transform = '';
      S.axis.x = 0; S.axis.y = 0;
    });


    /* ---------- 动作键 ---------- */
    function addBtn(label, fn, cls) {
      var b = el('button', 'pk-btn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      var fire = function (e) { e.preventDefault(); fn(); };
      b.addEventListener('touchstart', fire, { passive: false });
      b.addEventListener('mousedown', fire);
      btns.appendChild(b);
      return b;
    }
    if (def.buttons) def.buttons.forEach(function (b) { addBtn(b.label, function () { b.onPress(S); }, b.cls); });

    /* ---------- 网络事件 ---------- */
    var onSnap = function (d) { S.rx += 1; S.lastSnapAt = performance.now(); S.serverTick = d.t || 0; if (def.onSnap) def.onSnap(S, d); };
    var onOver = function (d) { S.over = d; showOver(d); };
    var onEv = function (d) { if (def.onEvent) def.onEvent(S, d); };
    var onChat = function (d) { toast(d.name + '：' + d.text); };
    var onRoom = function (d) { if (d && d.players) S.players = d.players; };
    net.on('snap', onSnap);
    net.on('over', onOver);
    net.on('event', onEv);
    net.on('chat', onChat);
    net.on('room', onRoom);
    net.on('start', function (d) {
      S.over = null;
      overlay.innerHTML = '';
      if (def.onStart) def.onStart(S, d);
    });

    /* ---------- 提示条 ---------- */
    var toastEl = null, toastTimer = null;
    function toast(text) {
      if (!toastEl) { toastEl = el('div', 'pk-toast'); canvasWrap.appendChild(toastEl); }
      toastEl.textContent = text;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
    }

    /* ---------- 结算面板 ---------- */
    function showOver(res) {
      overlay.innerHTML = '';
      var box = el('div', 'pk-over');
      var winner = res.winner === net.you;
      var title = res.draw ? '同归于尽 · 平局'
        : (winner ? '你赢了！' : (res.winner ? net.nameOf(res.winner) + ' 赢了' : '本局结束'));
      box.appendChild(el('h2', '', title));
      var ul = el('ol', 'pk-rank');
      (res.scores || []).forEach(function (s) {
        var li = el('li', s.id === net.you ? 'me' : '');
        li.innerHTML = '<b>' + escapeHtml(s.name) + '</b><span>' + s.score + ' 分</span>';
        ul.appendChild(li);
      });
      box.appendChild(ul);
      var row = el('div', 'pk-over-row');
      if (net.isHost()) {
        var again = el('button', 'pp-btn pp-btn-primary', '再来一局');
        again.type = 'button';
        again.onclick = function () { net.send('restart', {}); net.send('start', {}); overlay.innerHTML = ''; };
        row.appendChild(again);
      } else {
        row.appendChild(el('span', 'pp-wait', '等房主开下一局…'));
      }
      var exit = el('button', 'pp-btn pp-btn-ghost', '退出房间');
      exit.type = 'button';
      exit.onclick = function () { if (opts.onExit) opts.onExit(); };
      row.appendChild(exit);
      box.appendChild(row);
      overlay.appendChild(box);
    }

    /* ---------- 主循环 ---------- */
    host.__kitTeardown = KIT._teardown;
    var raf = 0, last = performance.now();
    function frame(now) {
      raf = global.requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      S.t += dt;
      S.dt = dt;             /* 暴露给客户端预测：它要按真实帧长切 1/60 整步 */
      /* 快照插值：把显示位置朝最新快照推一帧（在输入之前，保证本帧画的是最新进度） */
      KIT.tickAll(S, dt);
      /* 输入上行 */
      if (def.sendInput) def.sendInput(S, net);
      S.pressed.length = 0;
      S.actions.length = 0;
      /* 渲染 */
      ctx2d.save();
      ctx2d.clearRect(0, 0, view.w, view.h);
      try { def.draw(S); } catch (e) { /* 绘制异常不要拖垮循环 */ }
      ctx2d.restore();
      /* 记分条（每 250ms 刷一次，避免每帧重排 DOM） */
      if (now - (frame._hudAt || 0) > 250) {
        frame._hudAt = now;
        renderScores();
        pingTag.textContent = net.latency + 'ms';
      }
    }

    var lastScoreKey = '';
    function renderScores() {
      var rows = def.scoreRows ? def.scoreRows(S) : null;
      var key = JSON.stringify(rows);
      if (key === lastScoreKey) return;
      lastScoreKey = key;
      scoreBar.innerHTML = '';
      (rows || []).forEach(function (r) {
        var d = el('div', 'pk-score' + (r.id === net.you ? ' me' : ''));
        d.innerHTML = '<i style="background:' + r.color + '"></i><b>' + escapeHtml(r.name) + '</b><span>' + r.text + '</span>';
        scoreBar.appendChild(d);
      });
    }

    raf = global.requestAnimationFrame(frame);

    /* ---------- 清理 ---------- */
    KIT._teardown = function () {
      document.body.classList.remove('playing');
      global.cancelAnimationFrame(raf);
      global.removeEventListener('keydown', kd);
      global.removeEventListener('keyup', ku);
      global.removeEventListener('resize', resize);
      net.off('snap', onSnap);
      net.off('over', onOver);
      net.off('event', onEv);
      net.off('chat', onChat);
      net.off('room', onRoom);
      if (def.destroy) def.destroy(S);
    };
  };

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.PartyKit = KIT;
})(typeof window !== 'undefined' ? window : globalThis);
