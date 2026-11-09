/* ============================================================
 * js/directory.js —— 区块目录（P0：竖屏目录模式 + 各端「目录」直达入口）
 * ------------------------------------------------------------
 * 竖屏触屏：探索大厅不可用 → 自动进入本目录（可滚动卡片 + 分类筛选 + 搜索），
 * 点卡片直接进入对应区块（跳过走路 / 总门 / 选单）。
 * 桌面 / 横屏：HUD「目录」按钮一键呼出，作为直达入口。
 * 最近访问记录在 localStorage（worldhub.recent.v1），最多 8 条。
 * ============================================================ */
(function (global) {
  'use strict';

  var RECENT_KEY = 'worldhub.recent.v1';
  var RECENT_MAX = 8;
  var DISMISS_KEY = 'wh.dirDismiss';   /* sessionStorage：本会话手动关闭过就不再自动弹 */

  var built = false, root = null, listEl = null, subEl = null, searchEl = null, chipsEl = null;
  var chip = 'all', query = '';
  var open_ = false;

  function items() {
    return (global.WorldScene && global.WorldScene.ITEMS) || [];
  }

  function groupOf(it) {
    return it.cat === 'tools' ? '🧰 工具' : (it.group || '🎮 脑力街机');
  }

  function loadRecent() {
    try {
      var raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }

  function pushRecent(id) {
    var arr = loadRecent().filter(function (x) { return x !== id; });
    arr.unshift(id);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, RECENT_MAX))); } catch (e) {}
  }

  /* ---------- 进入区块：直接传送到门口并推门进去（跳过探索） ---------- */
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

  /* ---------- DOM 构建 ---------- */
  function card(it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dir-item';
    b.style.setProperty('--c', it.color || '#f0a76e');

    var dot = document.createElement('span'); dot.className = 'dir-dot';
    var txt = document.createElement('span'); txt.className = 'dir-txt';
    var name = document.createElement('b'); name.textContent = it.name;
    var desc = document.createElement('i'); desc.textContent = it.desc || '';
    txt.appendChild(name); txt.appendChild(desc);

    var tag = document.createElement('span'); tag.className = 'dir-tag';
    tag.textContent = it.cross ? '联网' : groupOf(it).replace(/^..\s*/, '');

    b.appendChild(dot); b.appendChild(txt); b.appendChild(tag);
    b.addEventListener('click', function () { enter(it); });
    return b;
  }

  function secHead(text) {
    var h = document.createElement('div');
    h.className = 'dir-sec-h';
    h.textContent = text;
    return h;
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';
    var all = items();
    var q = query.trim().toLowerCase();
    var recent = loadRecent();

    var shown = all.filter(function (it) {
      if (chip !== 'all' && groupOf(it) !== chip) return false;
      if (!q) return true;
      return (it.name + ' ' + (it.desc || '') + ' ' + groupOf(it)).toLowerCase().indexOf(q) >= 0;
    });

    subEl.textContent = '共 ' + all.length + ' 个区块 · 已列出 ' + shown.length + ' 个';

    if (!shown.length) {
      var empty = document.createElement('div');
      empty.className = 'dir-sec-h';
      empty.textContent = '没有匹配的区块';
      listEl.appendChild(empty);
      return;
    }

    /* 无搜索、看全部时，先给一排「最近来过」 */
    if (!q && chip === 'all' && recent.length) {
      var recItems = recent.map(function (id) {
        for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
        return null;
      }).filter(Boolean);
      if (recItems.length) {
        listEl.appendChild(secHead('最近来过'));
        recItems.forEach(function (it) { listEl.appendChild(card(it)); });
        listEl.appendChild(secHead('全部区块'));
      }
    }

    shown.forEach(function (it) { listEl.appendChild(card(it)); });
  }

  function build() {
    if (built) return;
    built = true;

    root = document.createElement('div');
    root.className = 'dir';
    root.id = 'dir';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '区块目录');
    root.setAttribute('aria-hidden', 'true');

    var wrap = document.createElement('div');
    wrap.className = 'dir-card';

    var head = document.createElement('header');
    head.className = 'dir-head';
    var h2 = document.createElement('h2'); h2.textContent = '区块目录';
    subEl = document.createElement('p'); subEl.className = 'dir-sub';
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'dir-x'; x.textContent = '×';
    x.setAttribute('aria-label', '关闭目录');
    x.addEventListener('click', function () { close(false); });
    head.appendChild(h2); head.appendChild(subEl); head.appendChild(x);

    var search = document.createElement('div');
    search.className = 'dir-search';
    searchEl = document.createElement('input');
    searchEl.type = 'search';
    searchEl.placeholder = '搜名称 / 简介…';
    searchEl.setAttribute('aria-label', '搜索区块');
    searchEl.addEventListener('input', function () { query = searchEl.value || ''; render(); });
    search.appendChild(searchEl);

    chipsEl = document.createElement('div');
    chipsEl.className = 'dir-chips';
    var groups = ['all'];
    items().forEach(function (it) {
      var g = groupOf(it);
      if (groups.indexOf(g) < 0) groups.push(g);
    });
    groups.forEach(function (g) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'dir-chip' + (g === chip ? ' on' : '');
      c.textContent = g === 'all' ? '全部' : g;
      c.addEventListener('click', function () {
        chip = g;
        var cs = chipsEl.querySelectorAll('.dir-chip');
        for (var i = 0; i < cs.length; i++) cs[i].classList.remove('on');
        c.classList.add('on');
        render();
      });
      chipsEl.appendChild(c);
    });

    listEl = document.createElement('div');
    listEl.className = 'dir-list';

    var foot = document.createElement('footer');
    foot.className = 'dir-foot';
    var hall = document.createElement('button');
    hall.type = 'button'; hall.className = 'dir-hall'; hall.textContent = '回到探索大厅';
    hall.addEventListener('click', function () { close(false); });
    var tip = document.createElement('span');
    tip.className = 'dir-foot-tip';
    tip.textContent = '竖屏时探索大厅太小，这里直接进游戏';
    foot.appendChild(hall); foot.appendChild(tip);

    wrap.appendChild(head); wrap.appendChild(search); wrap.appendChild(chipsEl);
    wrap.appendChild(listEl); wrap.appendChild(foot);
    root.appendChild(wrap);
    document.body.appendChild(root);

    render();
  }

  /* ---------- 开 / 关 ---------- */
  function open() {
    build();
    if (open_) return;
    open_ = true;
    root.classList.add('on');
    root.setAttribute('aria-hidden', 'false');
    try { sessionStorage.removeItem(DISMISS_KEY); } catch (e) {}
  }

  function close(fromEnter) {
    if (!open_) return;
    open_ = false;
    if (root) {
      root.classList.remove('on');
      root.setAttribute('aria-hidden', 'true');
    }
    /* 手动关闭（非进入游戏）：本会话不再自动弹出，把大厅让给用户 */
    if (!fromEnter) {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
    }
    if (searchEl) { searchEl.value = ''; query = ''; }
    render();
  }

  function isOpen() { return open_; }
  function toggle() { open_ ? close(false) : open(); }

  /* Esc 关闭（与其它浮层同键，捕获阶段抢在前面） */
  document.addEventListener('keydown', function (e) {
    if (!open_) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(false);
    } else if (e.code !== 'Tab') {
      e.stopPropagation();   /* 开着目录时别让角色乱动 */
    }
  }, true);

  /* 竖屏触屏：回到大厅场景时自动弹出（手动关闭过则不再弹） */
  function portraitTouch() {
    var portrait = global.matchMedia && global.matchMedia('(orientation: portrait)').matches;
    /* 触屏判定与 touch.js 同口径（maxTouchPoints / pointer:coarse 任一命中即可） */
    var touch = ('ontouchstart' in global) ||
                (navigator.maxTouchPoints > 0) ||
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
      /* 进了游戏 / 跑酷：目录让位 */
      if (open_) close(true);
    }
  }

  if (global.MutationObserver) {
    new MutationObserver(autoByScene).observe(document.body, { attributes: true, attributeFilter: ['data-scene'] });
  }
  if (global.matchMedia) {
    var mq = global.matchMedia('(orientation: portrait)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(function () {
      if (portraitTouch()) autoByScene();
    });
  }

  global.Directory = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: isOpen,
    enter: enter,
    autoByScene: autoByScene
  };

  /* 场景已就绪（boot.js 先于本脚本末尾执行？不——defer 顺序：本文件在 boot.js 之前）
     直接跑一次：boot.js 随后会 change('world')，MutationObserver 再补一次。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoByScene);
  } else {
    autoByScene();
  }
})(window);
