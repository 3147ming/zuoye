/* ============================================================
 * config.js —— 版本信息 / 静态清单 / 偏好与背景存储
 * ------------------------------------------------------------
 * 三块内容：
 *   1) WH_CONFIG：版本、构建日期、背景图清单、BGM 清单（手写，不联网）；
 *   2) Prefs    ：音量等小配置，存 worldhub.prefs.v1；
 *   3) BgStore  ：每个场景的自定义背景，存 worldhub.bg.v1。
 *
 * 为什么清单要手写：file:// 下 fetch 被同源策略挡住，浏览器也列不了目录，
 * 所以「有哪些文件」只能写在代码里。加图/加曲之后同步改这里即可。
 * ============================================================ */
(function (global) {
  'use strict';

  var CONFIG = {
    version: '1.6.0',
    build: '2026-11-14',
    stage: '第六批·汉化：全部界面中文；昼夜循环与三套皮肤；广场每日一题；留言板；三款自研小游戏；手柄支持；足迹统计',

    /* assets/bg/ 下的图片文件名。留空则设置里的下拉只有「默认」。
       例：['plaza.jpg', 'forest.png'] */
    bgFiles: [],

    /* BGM 清单。文件放 audio/bgm/ 下；数组为空时播放器整体静默，不会报错。
       例：[{ id: 'lobby', name: '大厅 · 黄昏', src: 'audio/bgm/01-lobby.mp3' }] */
    bgm: []
  };

  var PREF_KEY = 'worldhub.prefs.v1';
  var BG_KEY = 'worldhub.bg.v1';

  var PREF_DEF = { bgmVol: 0.55, bgmMute: false, sfxVol: 0.80, sfxMute: false };

  function readObj(key) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || Object.prototype.toString.call(v) === '[object Array]') return null;
      return v;
    } catch (e) { return null; }
  }

  function writeObj(key, val) {
    try {
      global.localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      return false;      /* 配额满 / 隐私模式：静默失败，调用方自己决定怎么提示 */
    }
  }

  function num(v, def) {
    var n = Number(v);
    if (!isFinite(n)) return def;
    return n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  /* ---------------- 偏好 ---------------- */
  var Prefs = {
    get: function () {
      var raw = readObj(PREF_KEY) || {};
      return {
        bgmVol: num(raw.bgmVol, PREF_DEF.bgmVol),
        bgmMute: raw.bgmMute === true,
        sfxVol: num(raw.sfxVol, PREF_DEF.sfxVol),
        sfxMute: raw.sfxMute === true
      };
    },

    set: function (patch) {
      var cur = this.get();
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
      }
      var ok = writeObj(PREF_KEY, cur);
      if (ok) emit('wh:prefs', cur);
      return ok;
    },

    reset: function () {
      try { global.localStorage.removeItem(PREF_KEY); } catch (e) { /* 忽略 */ }
      emit('wh:prefs', this.get());
    }
  };

  /* ---------------- 背景图（IndexedDB 持久化 + 内存同步缓存） ----------------
   * bakeBg() 是同步调用 BgStore.get() 的，而 IDB 是异步的。
   * 所以：get / all / count 一律读内存 cache（同步、立即返回）；
   *       set / clear 立刻改 cache，再异步写 IDB（配额数百 MB，摆脱 5MB 上限）；
   *       启动时先同步迁移 localStorage 旧值，再异步从 IDB 载入并广播 wh:bg 重新烘焙。 */
  var BG_DB = 'worldhub';
  var BG_STORE = 'bg';

  var BgStore = (function () {
    var cache = {};
    var db = null;

    /* 1) 同步迁移旧 localStorage 数据，保证首帧即可读到 */
    var legacy = readObj(BG_KEY) || {};
    for (var lk in legacy) {
      if (typeof legacy[lk] === 'string' && legacy[lk]) cache[lk] = legacy[lk];
    }

    function idbPut(id, src) {
      if (!db) return;
      try { db.transaction(BG_STORE, 'readwrite').objectStore(BG_STORE).put(src, id); } catch (e) {}
    }
    function idbDel(id) {
      if (!db) return;
      try { db.transaction(BG_STORE, 'readwrite').objectStore(BG_STORE).delete(id); } catch (e) {}
    }
    function idbClear() {
      if (!db) return;
      try { db.transaction(BG_STORE, 'readwrite').objectStore(BG_STORE).clear(); } catch (e) {}
    }

    function onLoaded() {
      Object.keys(cache).forEach(function (k) { idbPut(k, cache[k]); });   // 旧值迁入 IDB
      try { global.localStorage.removeItem(BG_KEY); } catch (e) {}
      emit('wh:bg', { detail: {} });                                       // 让 world 重烘焙当前场景
    }

    function open() {
      if (!global.indexedDB) return;             // 不支持：退化为内存 + localStorage 旧值
      var req;
      try { req = global.indexedDB.open(BG_DB, 1); } catch (e) { return; }
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(BG_STORE)) req.result.createObjectStore(BG_STORE);
      };
      req.onsuccess = function () {
        db = req.result;
        try {
          var r = db.transaction(BG_STORE, 'readonly').objectStore(BG_STORE).openCursor();
          r.onsuccess = function () {
            var cur = r.result;
            if (cur) {
              if (typeof cur.value === 'string' && cur.value) cache[cur.key] = cur.value;
              cur.continue();
            } else { onLoaded(); }
          };
          r.onerror = function () { onLoaded(); };
        } catch (e) { onLoaded(); }
      };
      req.onerror = function () { /* IDB 不可用：内存 + localStorage 旧值即可 */ };
    }
    open();

    return {
      all: function () {
        var out = {};
        for (var k in cache) {
          if (typeof cache[k] === 'string' && cache[k]) out[k] = cache[k];
        }
        return out;
      },

      get: function (id) { return cache[id] || ''; },

      /* 返回 false 仅表示连 localStorage 兜底都写不进（IDB 正常时恒 true） */
      set: function (id, src) {
        if (!id || typeof src !== 'string' || !src) return false;
        cache[id] = src;
        if (db) { idbPut(id, src); return true; }
        try { return writeObj(BG_KEY, this.all()); } catch (e) { return false; }
      },

      clear: function (id) {
        if (!Object.prototype.hasOwnProperty.call(cache, id)) return true;
        delete cache[id];
        if (db) { idbDel(id); return true; }
        try { return writeObj(BG_KEY, this.all()); } catch (e) { return false; }
      },

      count: function () {
        var n = 0;
        for (var k in cache) n++;
        return n;
      },

      reset: function () {
        cache = {};
        if (db) idbClear();
        try { global.localStorage.removeItem(BG_KEY); } catch (e) { /* 忽略 */ }
      }
    };
  })();

  function emit(name, detail) {
    try {
      global.dispatchEvent(new global.CustomEvent(name, { detail: detail }));
    } catch (e) { /* 老浏览器没有 CustomEvent 构造器，忽略 */ }
  }

  global.WH_CONFIG = CONFIG;
  global.Prefs = Prefs;
  global.BgStore = BgStore;
  global.WH_EMIT = emit;
})(window);
