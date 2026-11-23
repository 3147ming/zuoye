/* ============================================================
 * js/quickRecent.js —— 竖屏触屏下的「最近来过」区块快捷区
 * ------------------------------------------------------------
 * 由 assets/fix.js 合并回源工程而来，差异：
 *   1. 不用 setInterval 轮询目录开关，改为场景切换 / 目录开关时
 *      显式调用 sync()（由 world.js 与 directory.js 两处驱动）。
 *   2. 依赖通过参数注入，不直接读 window.WorldScene / window.Directory；
 *      源工程以后重构这两个全局，这里不会静默失效。
 *   3. 提供 dispose()，可彻底解绑监听与 DOM。
 *
 * 接入（world.js 末尾）：
 *   QuickRecent.init({
 *     getItems: function () { return ITEMS; },
 *     isDirOpen: function () { return !!(global.Directory && global.Directory.isOpen()); },
 *     enter: function (it) { global.Directory.enter(it); }
 *   });
 *   场景切换处 → QuickRecent.sync(name)
 *   目录开关处 → QuickRecent.sync()
 * ============================================================ */
(function (global) {
  'use strict';

  var RECENT_KEY = 'worldhub.recent.v1';
  var MAX = 4;

  var doc = global.document;
  var opts = { getItems: null, isDirOpen: null, enter: null };
  var root = null, listEl = null;
  var mounted = false;
  var mq = null, onMq = null;
  var initialized = false;

  function isPortraitTouch() {
    var portrait = global.matchMedia && global.matchMedia('(orientation: portrait)').matches;
    var touch = ('ontouchstart' in global) || navigator.maxTouchPoints > 0 ||
                (global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
    return !!(portrait && touch);
  }

  function recentIds() {
    try {
      var a = JSON.parse(global.localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function pick() {
    var items = (opts.getItems && opts.getItems()) || [];
    var ids = recentIds(), out = [];
    for (var i = 0; i < ids.length && out.length < MAX; i++) {
      for (var j = 0; j < items.length; j++) {
        if (items[j] && items[j].id === ids[i]) { out.push(items[j]); break; }
      }
    }
    return out;
  }

  function ensureRoot() {
    if (root && root.isConnected) return true;
    var frame = doc.querySelector('.frame');
    if (!frame) return false;

    root = doc.createElement('div');
    root.className = 'qrec';
    root.setAttribute('aria-label', '最近来过');

    var title = doc.createElement('p');
    title.className = 'qrec-title';
    title.textContent = '最近来过';

    listEl = doc.createElement('div');
    listEl.className = 'qrec-list';

    root.appendChild(title);
    root.appendChild(listEl);
    frame.appendChild(root);
    return true;
  }

  function render() {
    if (!root || !root.isConnected || !listEl) return;
    listEl.innerHTML = '';

    var picked = pick();
    if (!picked.length) { root.classList.remove('on'); return; }

    for (var i = 0; i < picked.length; i++) {
      (function (item) {
        var btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'qrec-item';
        btn.style.setProperty('--c', item.color || '#f0a76e');

        var dot = doc.createElement('span');
        dot.className = 'qrec-dot';

        var txt = doc.createElement('span');
        txt.className = 'qrec-txt';
        var name = doc.createElement('b');
        name.textContent = item.name || item.id;      /* 一律 textContent，防注入 */
        var desc = doc.createElement('i');
        desc.textContent = item.desc || '';
        txt.appendChild(name); txt.appendChild(desc);

        btn.appendChild(dot); btn.appendChild(txt);
        btn.addEventListener('click', function () {
          if (opts.enter) opts.enter(item);
        });
        listEl.appendChild(btn);
      })(picked[i]);
    }

    root.classList.add('on');
  }

  /* 场景 / 目录状态变了就调一次；name 缺省时读 body.dataset.scene */
  function sync(name) {
    if (!mounted) return;
    var scene = name || (doc.body && doc.body.dataset ? doc.body.dataset.scene : '');
    var dirOpen = !!(opts.isDirOpen && opts.isDirOpen());
    if (isPortraitTouch() && scene === 'world' && !dirOpen) {
      if (ensureRoot()) render();
    } else if (root) {
      root.classList.remove('on');
    }
  }

  function init(o) {
    if (o) {
      opts.getItems = o.getItems || opts.getItems;
      opts.isDirOpen = o.isDirOpen || opts.isDirOpen;
      opts.enter = o.enter || opts.enter;
    }
    if (initialized) { sync(); return; }
    initialized = true;
    mounted = true;
    ensureRoot();

    /* 横竖屏旋转要重算；场景与目录状态由调用方 sync() 驱动 */
    if (global.matchMedia) {
      mq = global.matchMedia('(orientation: portrait)');
      onMq = function () { sync(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
    sync();
  }

  function dispose() {
    if (mq && onMq) {
      if (mq.removeEventListener) mq.removeEventListener('change', onMq);
      else if (mq.removeListener) mq.removeListener(onMq);
    }
    mq = null; onMq = null;
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; listEl = null;
    mounted = false; initialized = false;
  }

  global.QuickRecent = { init: init, sync: sync, refresh: render, dispose: dispose };
})(window);
