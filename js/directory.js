/* ============================================================
 * js/directory.js —— 区块目录（直达、场景分类、收藏与周期精选）
 * ------------------------------------------------------------
 * 竖屏触屏自动进入目录；桌面 / 横屏由 HUD「目录」按钮呼出。
 * 最近、收藏、继续上次均只存本机；不含任务、成长或奖励机制。
 * 跑酷入口复用 WorldScene.openRunner()，按需加载现有每日挑战与纪录。
 * ============================================================ */
(function (global) {
  'use strict';

  var RECENT_KEY = 'worldhub.recent.v1';
  var FAVORITE_KEY = 'worldhub.favorites.v1';
  var LAST_KEY = 'worldhub.last.v1';
  var RECENT_MAX = 8;
  var DISMISS_KEY = 'wh.dirDismiss';

  /* 内容元信息只服务于展示与筛选；离线指页面本身可离线，不含共享数据。 */
  var META = {
    noise:    { tags: ['专注效率', '1分钟解压'], time: '1–50 分钟', level: '轻松', players: '单人', offline: true,  control: '点击 / 滑条' },
    pomodoro: { tags: ['专注效率'],             time: '25 分钟起 · 可调', level: '轻松', players: '单人', offline: true,  control: '点击 / 触屏' },
    focus:    { tags: ['专注效率'],             time: '25 分钟起', level: '轻松', players: '单人', offline: true,  control: '一键开始' },
    links:    { tags: ['实用工具'],             time: '1–5 分钟', level: '轻松', players: '单人', offline: false, control: '点击 / 搜索' },
    board:    { tags: ['实用工具', '1分钟解压'], time: '1–3 分钟', level: '轻松', players: '单人', offline: false, control: '键盘输入' },
    timer:    { tags: ['实用工具', '专注效率'], time: '按需', level: '轻松', players: '单人', offline: true,  control: '点击 / 触屏' },
    unit:     { tags: ['实用工具'],             time: '1–3 分钟', level: '轻松', players: '单人', offline: true,  control: '键盘输入' },
    color:    { tags: ['实用工具'],             time: '1–5 分钟', level: '轻松', players: '单人', offline: true,  control: '点击复制' },
    snake:    { tags: ['1分钟解压', '动脑挑战'], time: '1–5 分钟', level: '简单', players: '单人', offline: true, control: '方向键 / 触屏' },
    flappy:   { tags: ['1分钟解压', '闯关反应'], time: '1–3 分钟', level: '适中', players: '单人', offline: true, control: '点击 / 空格' },
    tiles:    { tags: ['1分钟解压', '闯关反应'], time: '1–3 分钟', level: '适中', players: '单人', offline: true, control: '点击 / 触屏' },
    plane:    { tags: ['闯关反应'],             time: '2–8 分钟', level: '适中', players: '单人', offline: true, control: '方向键 / 触屏' },
    bubble:   { tags: ['动脑挑战', '1分钟解压'], time: '2–8 分钟', level: '简单', players: '单人', offline: true, control: '鼠标 / 触屏' },
    pong:     { tags: ['1分钟解压', '闯关反应'], time: '1–5 分钟', level: '简单', players: '单人', offline: true, control: '鼠标 / 触屏' },
    game2048: { tags: ['动脑挑战'],             time: '3–15 分钟', level: '适中', players: '单人', offline: true, control: '方向键 / 滑动' },
    tetris:   { tags: ['动脑挑战', '闯关反应'], time: '3–15 分钟', level: '适中', players: '单人', offline: true, control: '方向键' },
    fight:    { tags: ['双人同玩'],             time: '2–10 分钟', level: '挑战', players: '双人', offline: true, control: '电脑键盘' },
    mine:     { tags: ['动脑挑战'],             time: '3–12 分钟', level: '适中', players: '单人', offline: true, control: '鼠标 / 触屏' },
    gomoku:   { tags: ['动脑挑战'],             time: '3–15 分钟', level: '适中', players: '单人', offline: true, control: '鼠标 / 触屏' },
    breakout: { tags: ['闯关反应'],             time: '2–10 分钟', level: '适中', players: '单人', offline: true, control: '方向键 / 滑动' },
    warehouse:{ tags: ['闯关反应'],             time: '5–15 分钟', level: '挑战', players: '单人', offline: false, control: '键鼠 / 触屏' },
    memory:   { tags: ['动脑挑战', '1分钟解压'], time: '1–6 分钟', level: '简单', players: '单人', offline: true, control: '鼠标 / 触屏' },
    reaction: { tags: ['闯关反应', '1分钟解压'], time: '1–2 分钟', level: '简单', players: '单人', offline: true, control: '点击 / 触屏' },
    mathdash: { tags: ['动脑挑战', '1分钟解压'], time: '1 分钟', level: '适中', players: '单人', offline: true, control: '键盘输入' },
    dandandao: { tags: ['闯关反应', '动脑挑战'], time: '3–10 分钟', level: '适中', players: '单人', offline: true, control: '方向键 / 触屏' },
    /* 联机对战：必须联网（联网指连上房间服务），2–4 人 */
    'p-bounce':      { tags: ['联机对战', '闯关反应'], time: '2–5 分钟', level: '适中', players: '2–4 人', offline: false, control: 'WASD / 摇杆' },
    'p-balloon':     { tags: ['联机对战', '动脑挑战'], time: '3–8 分钟', level: '适中', players: '2–4 人', offline: false, control: '方向键 / 空格' },
    'p-tank':        { tags: ['联机对战', '闯关反应'], time: '3–10 分钟', level: '挑战', players: '2–4 人', offline: false, control: '方向键 / 空格' },
    'p-snakebattle': { tags: ['联机对战', '1分钟解压'], time: '2–6 分钟', level: '适中', players: '2–4 人', offline: false, control: '←→ / 触屏' },
    'p-quiz':        { tags: ['联机对战', '动脑挑战'], time: '3–6 分钟', level: '适中', players: '2–4 人', offline: false, control: '点击 / 数字键' },
    party:           { tags: ['联机对战'], time: '按需', level: '轻松', players: '2–4 人', offline: false, control: '点击 / 键盘' }
  };
  var SCENES = ['1分钟解压', '动脑挑战', '双人同玩', '联机对战', '闯关反应', '专注效率', '实用工具'];

  var built = false, root = null, listEl = null, subEl = null, searchEl = null, chipsEl = null;
  var chip = 'all', query = '';
  var open_ = false;

  function items() { return (global.WorldScene && global.WorldScene.ITEMS) || []; }
  function metaOf(it) { return META[it.id] || { tags: [it.cat === 'tools' ? '实用工具' : '1分钟解压'], time: '按需', level: '适中', players: '单人', offline: !it.cross, control: '键盘 / 触屏' }; }
  function groupOf(it) { return it.cat === 'tools' ? '🧰 工具' : (it.group || '🎮 脑力街机'); }
  function readList(key) {
    try { var a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function writeList(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }
  function loadRecent() { return readList(RECENT_KEY); }
  function favorites() { return readList(FAVORITE_KEY); }
  function lastId() { try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; } }
  function byId(id) { var all = items(); for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  function pushRecent(id) {
    var arr = loadRecent().filter(function (x) { return x !== id; });
    arr.unshift(id);
    writeList(RECENT_KEY, arr.slice(0, RECENT_MAX));
    try { localStorage.setItem(LAST_KEY, id); } catch (e) {}
    /* 大厅里「最近来过」快捷区若正开着，立即反映最新一条 */
    if (global.QuickRecent) global.QuickRecent.refresh();
  }
  function toggleFavorite(id) {
    var arr = favorites().filter(function (x) { return x !== id; });
    if (favorites().indexOf(id) < 0) arr.unshift(id);
    writeList(FAVORITE_KEY, arr);
    render();
  }

  function enter(it) {
    if (!it || !it.src) return;
    var SM = global.SceneManager;
    if (!SM) return;
    var sc = SM.current;
    if (SM.currentName !== 'world' || !sc || !sc.enterDoor) {
      try { SM.change('world'); } catch (e) {}
      sc = SM.current;
    }
    if (sc && sc.teleportTo && sc.enterDoor) {
      sc.teleportTo(it);
      sc.enterDoor(it);
      pushRecent(it.id);
      close(true);
    }
  }

  function openRunner() {
    var SM = global.SceneManager;
    if (!SM) return;
    var sc = SM.current;
    if (SM.currentName !== 'world' || !sc || !sc.openRunner) {
      try { SM.change('world'); } catch (e) {}
      sc = SM.current;
    }
    close(true);
    if (sc && sc.openRunner) sc.openRunner();
  }

  function secHead(text) {
    var h = document.createElement('div');
    h.className = 'dir-sec-h';
    h.textContent = text;
    return h;
  }

  /* ---------------- 预热：把「点了才下载」提前到「碰了就下载」 ----------------
     实测首次进脑力街机要拉 500KB 级聚合页，点击后才发起请求，用户只能看着
     加载骨架。这里在鼠标悬停 250ms / 键盘聚焦 / 手指按下时先发一个低优先级
     fetch：命中 SW 的区块页策略后写进缓存，真正点开时直接命中。
     外链（warehouse / 脑力街机远端）不预热——那是别人的服务器。 */
  var warmed = {};
  function warmAllowed() {
    var c = global.navigator && global.navigator.connection;
    if (!c) return true;
    if (c.saveData === true) return false;                       /* 省流模式：一个字节都不预取 */
    if (/(^|-)2g$/.test(c.effectiveType || '')) return false;     /* 2G：预取只会让当前更慢 */
    return true;
  }
  function warm(it) {
    if (!it || !it.src || it.cross) return;
    if (!warmAllowed()) return;
    var u;
    try { u = new URL(it.src, global.location.href).href; } catch (e) { return; }
    if (warmed[u]) return;
    warmed[u] = 1;
    try {
      /* priority 只有 Chromium 认，其他浏览器忽略；失败静默，别影响点击。
         点击时同一 URL 的请求会与这次合并，不会重复下载。 */
      fetch(u, { priority: 'low', credentials: 'same-origin' }).catch(function () {});
    } catch (e) {}
  }
  function bindWarm(el, it) {
    var t = 0;
    el.addEventListener('pointerenter', function () {
      clearTimeout(t); t = setTimeout(function () { warm(it); }, 250);
    });
    el.addEventListener('pointerleave', function () { clearTimeout(t); });
    el.addEventListener('pointercancel', function () { clearTimeout(t); });
    el.addEventListener('focus', function () { warm(it); });
    /* 触屏没有 hover：按下即开始取，抬起时通常已经走了一段 */
    el.addEventListener('pointerdown', function () { warm(it); }, { passive: true });
  }

  function card(it, label) {
    var m = metaOf(it), fav = favorites().indexOf(it.id) >= 0;
    var wrap = document.createElement('div');
    wrap.className = 'dir-item-wrap' + (label === '继续' ? ' dir-wide' : '');
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dir-item' + (label ? ' dir-continue' : '');
    b.style.setProperty('--c', it.color || '#f0a76e');
    b.setAttribute('aria-label', (label || '进入') + '：' + it.name);

    var dot = document.createElement('span'); dot.className = 'dir-dot';
    var txt = document.createElement('span'); txt.className = 'dir-txt';
    var name = document.createElement('b'); name.textContent = it.name;
    var desc = document.createElement('i'); desc.textContent = it.desc || '';
    var detail = document.createElement('small'); detail.className = 'dir-meta';
    detail.textContent = m.time + ' · ' + m.level + ' · ' + m.players + ' · ' + (m.offline ? '可离线' : '需联网') + ' · ' + m.control;
    txt.appendChild(name); txt.appendChild(desc); txt.appendChild(detail);
    var tag = document.createElement('span'); tag.className = 'dir-tag';
    tag.textContent = label || (it.cross ? '外链' : groupOf(it).replace(/^..\s*/, ''));
    b.appendChild(dot); b.appendChild(txt); b.appendChild(tag);
    b.addEventListener('click', function () { enter(it); });
    bindWarm(b, it);

    var star = document.createElement('button');
    star.type = 'button'; star.className = 'dir-fav' + (fav ? ' on' : '');
    star.textContent = fav ? '★' : '☆';
    star.setAttribute('aria-label', (fav ? '取消收藏 ' : '收藏 ') + it.name);
    star.setAttribute('aria-pressed', fav ? 'true' : 'false');
    star.addEventListener('click', function () { toggleFavorite(it.id); });
    wrap.appendChild(b); wrap.appendChild(star);
    return wrap;
  }

  function runnerCard() {
    var wrap = document.createElement('div'); wrap.className = 'dir-item-wrap dir-wide';
    var b = document.createElement('button'); b.type = 'button'; b.className = 'dir-item dir-runner';
    var txt = document.createElement('span'); txt.className = 'dir-txt';
    var name = document.createElement('b'); name.textContent = '跑酷 · 今日挑战';
    var desc = document.createElement('i');
    var extra = global.RunnerMeta ? global.RunnerMeta.goal('side').label : '每日目标 · 本机最佳 · 本周纪录';
    desc.textContent = '横版 / 神庙双模式 · ' + extra;
    /* 跑酷在懒加载包里：目录一打开就顺手取，取到再把当天目标补上 */
    if (!global.RunnerMeta && global.WorldHub && global.WorldHub.loadExtra) {
      global.WorldHub.loadExtra(function () {
        if (desc.isConnected && global.RunnerMeta) {
          desc.textContent = '横版 / 神庙双模式 · ' + global.RunnerMeta.goal('side').label;
        }
      });
    }
    var detail = document.createElement('small'); detail.className = 'dir-meta';
    detail.textContent = '1–10 分钟 · 适中 · 单人 · 可离线 · 方向键 / 空格';
    txt.appendChild(name); txt.appendChild(desc); txt.appendChild(detail);
    var tag = document.createElement('span'); tag.className = 'dir-tag'; tag.textContent = '按 P 也可进入';
    b.appendChild(txt); b.appendChild(tag); b.addEventListener('click', openRunner);
    wrap.appendChild(b);
    return wrap;
  }

  function weeklyPick(all) {
    var d = new Date(), first = new Date(d.getFullYear(), 0, 1);
    var week = Math.floor((d - first) / 604800000);
    var picked = [], used = {};
    for (var i = 0; i < all.length && picked.length < 4; i++) {
      var it = all[(week * 7 + i * 5 + 2) % all.length];
      if (it && !used[it.id]) { used[it.id] = true; picked.push(it); }
    }
    return picked;
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    var all = items(), q = query.trim().toLowerCase(), recent = loadRecent();
    var shown = all.filter(function (it) {
      var m = metaOf(it);
      if (chip === 'fav' && favorites().indexOf(it.id) < 0) return false;
      if (chip !== 'all' && chip !== 'fav' && m.tags.indexOf(chip) < 0) return false;
      if (!q) return true;
      return (it.name + ' ' + (it.desc || '') + ' ' + groupOf(it) + ' ' + m.tags.join(' ') + ' ' + m.control).toLowerCase().indexOf(q) >= 0;
    });
    subEl.textContent = '共 ' + all.length + ' 个区块 · 已列出 ' + shown.length + ' 个 · 点 ☆ 收藏常用内容';

    if (!q && chip === 'all') {
      var last = byId(lastId());
      if (last) { listEl.appendChild(secHead('继续上次')); listEl.appendChild(card(last, '继续')); }
      listEl.appendChild(secHead('跑酷挑战'));
      listEl.appendChild(runnerCard());
      listEl.appendChild(secHead('本周精选 · 每周一更新'));
      weeklyPick(all).forEach(function (it) { listEl.appendChild(card(it, '精选')); });
      var recItems = recent.slice(0, 4).map(byId).filter(Boolean);
      if (recItems.length) {
        listEl.appendChild(secHead('最近来过'));
        recItems.forEach(function (it) { listEl.appendChild(card(it)); });
      }
      listEl.appendChild(secHead('全部区块'));
    }

    if (!shown.length) {
      var empty = document.createElement('div'); empty.className = 'dir-empty';
      empty.textContent = chip === 'fav' ? '还没有收藏，点任意卡片右侧的 ☆ 即可。' : '没有匹配的区块，换个关键词或分类试试。';
      listEl.appendChild(empty); return;
    }
    shown.forEach(function (it) { listEl.appendChild(card(it)); });
  }

  function build() {
    if (built) return;
    built = true;
    root = document.createElement('div'); root.className = 'dir'; root.id = 'dir';
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '区块目录'); root.setAttribute('aria-hidden', 'true');
    var wrap = document.createElement('div'); wrap.className = 'dir-card';
    var head = document.createElement('header'); head.className = 'dir-head';
    var h2 = document.createElement('h2'); h2.textContent = '今天想玩什么？';
    subEl = document.createElement('p'); subEl.className = 'dir-sub';
    var x = document.createElement('button'); x.type = 'button'; x.className = 'dir-x'; x.textContent = '×';
    x.setAttribute('aria-label', '关闭目录'); x.addEventListener('click', function () { close(false); });
    head.appendChild(h2); head.appendChild(subEl); head.appendChild(x);

    var search = document.createElement('div'); search.className = 'dir-search';
    searchEl = document.createElement('input'); searchEl.type = 'search';
    searchEl.placeholder = '搜名称、玩法、分类或操作方式…';
    searchEl.setAttribute('aria-label', '搜索区块');
    searchEl.addEventListener('input', function () { query = searchEl.value || ''; render(); });
    search.appendChild(searchEl);

    chipsEl = document.createElement('div'); chipsEl.className = 'dir-chips';
    ['all', 'fav'].concat(SCENES).forEach(function (g) {
      var c = document.createElement('button'); c.type = 'button';
      c.className = 'dir-chip' + (g === chip ? ' on' : '');
      c.textContent = g === 'all' ? '全部' : (g === 'fav' ? '★ 收藏' : g);
      c.addEventListener('click', function () {
        chip = g;
        var cs = chipsEl.querySelectorAll('.dir-chip');
        for (var i = 0; i < cs.length; i++) cs[i].classList.remove('on');
        c.classList.add('on'); render();
      });
      chipsEl.appendChild(c);
    });

    listEl = document.createElement('div'); listEl.className = 'dir-list';
    var foot = document.createElement('footer'); foot.className = 'dir-foot';
    var hall = document.createElement('button'); hall.type = 'button'; hall.className = 'dir-hall'; hall.textContent = '回到探索大厅';
    hall.addEventListener('click', function () { close(false); });
    var tip = document.createElement('span'); tip.className = 'dir-foot-tip'; tip.textContent = '收藏与纪录仅保存在本机';
    foot.appendChild(hall); foot.appendChild(tip);
    wrap.appendChild(head); wrap.appendChild(search); wrap.appendChild(chipsEl); wrap.appendChild(listEl); wrap.appendChild(foot);
    root.appendChild(wrap); document.body.appendChild(root); render();
  }

  function open() {
    build(); if (open_) return;
    open_ = true; root.classList.add('on'); root.setAttribute('aria-hidden', 'false');
    try { sessionStorage.removeItem(DISMISS_KEY); } catch (e) {}
    render();
    if (global.QuickRecent) global.QuickRecent.sync();
  }
  function close(fromEnter) {
    if (!open_) return;
    open_ = false;
    if (root) { root.classList.remove('on'); root.setAttribute('aria-hidden', 'true'); }
    if (!fromEnter) { try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) {} }
    if (searchEl) { searchEl.value = ''; query = ''; }
    render();
    /* 目录关掉后，竖屏触屏可以把画布下方空白还给「最近来过」 */
    if (global.QuickRecent) global.QuickRecent.sync();
  }
  function isOpen() { return open_; }
  function toggle() { open_ ? close(false) : open(); }

  document.addEventListener('keydown', function (e) {
    if (!open_) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
    else if (e.code !== 'Tab') { e.stopPropagation(); }
  }, true);

  function portraitTouch() {
    var portrait = global.matchMedia && global.matchMedia('(orientation: portrait)').matches;
    var touch = ('ontouchstart' in global) || navigator.maxTouchPoints > 0 ||
                (global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
    return !!(portrait && touch);
  }
  function autoByScene() {
    var sc = (document.body && document.body.dataset && document.body.dataset.scene) || '';
    if (sc === 'world' && portraitTouch()) {
      var dismissed = false;
      try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (e) {}
      if (!dismissed) open();
    } else if (sc.indexOf('iframe-') === 0 || sc === 'runner') {
      if (open_) close(true);
    }
  }
  if (global.MutationObserver) new MutationObserver(autoByScene).observe(document.body, { attributes: true, attributeFilter: ['data-scene'] });
  if (global.matchMedia) {
    var mq = global.matchMedia('(orientation: portrait)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () { if (portraitTouch()) autoByScene(); });
  }

  global.Directory = { open: open, close: close, toggle: toggle, isOpen: isOpen, enter: enter, autoByScene: autoByScene };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoByScene);
  else autoByScene();
})(window);
