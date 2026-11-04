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
    version: '1.1.0',
    build: '2026-11-04',
    stage: '第四批优化 · 总门与区块',

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

  /* ---------------- 背景图 ---------------- */
  var BgStore = {
    all: function () {
      var raw = readObj(BG_KEY) || {};
      var out = {};
      for (var k in raw) {
        if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
      }
      return out;
    },

    get: function (id) {
      var all = this.all();
      return all[id] || '';
    },

    /* 返回 false 表示没写进盘（配额满）——调用方要提示用户 */
    set: function (id, src) {
      if (!id || typeof src !== 'string' || !src) return false;
      var all = this.all();
      all[id] = src;
      return writeObj(BG_KEY, all);
    },

    clear: function (id) {
      var all = this.all();
      if (!Object.prototype.hasOwnProperty.call(all, id)) return true;
      delete all[id];
      return writeObj(BG_KEY, all);
    },

    count: function () {
      var n = 0;
      var all = this.all();
      for (var k in all) n++;
      return n;
    },

    reset: function () {
      try { global.localStorage.removeItem(BG_KEY); } catch (e) { /* 忽略 */ }
    }
  };

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
