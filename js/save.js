/* ============================================================
 * save.js —— 本地存档模块
 *
 * 独立于任何场景对象：谁需要谁调用 window.Save，场景销毁不影响存档。
 * 只做三件事：
 *   1) 记住角色在大厅里的位置（进传送门时写，回大厅时读）；
 *   2) 记住哪几扇门通过关（三门：fireice / fight / cards）；
 *   3) 读写全程 try/catch —— file:// 下 localStorage 可能被浏览器策略禁用，
 *      隐私模式下 setItem 也可能抛 QuotaExceeded，任何一种都不能把游戏搞崩。
 *
 * 贪吃蛇是无尽模式，不写入 doors，最高分仍由 snake.js 自己的 readBest 管。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 角色合法的横向范围，与 world.js 里 player.bounds 保持一致（地图 2800 - 44） */
  var X_MIN = 44;
  var X_MAX = 2756;

  /* 只有这三扇门参与「已通关」标记 */
  var DOORS = { fireice: 1, fight: 1, cards: 1 };

  function defaults() {
    return { v: 1, player: null, doors: {} };
  }

  var Save = {
    KEY: 'worldhub.save.v1',

    /* 读存档：JSON 解析失败、结构不对、字段越界，一律回落到默认值，绝不抛错 */
    get: function () {
      var def = defaults();
      try {
        var raw = global.localStorage.getItem(this.KEY);
        if (!raw) return def;

        var s = JSON.parse(raw);
        if (!s || typeof s !== 'object' || Object.prototype.toString.call(s) === '[object Array]') return def;

        /* 旧存档缺字段时补齐，而不是整份丢掉 */
        if (typeof s.v !== 'number') s.v = 1;

        if (s.player && typeof s.player === 'object' && typeof s.player.x === 'number' && isFinite(s.player.x)) {
          if (s.player.x < X_MIN || s.player.x > X_MAX) s.player = null;   /* 越界位置直接作废 */
          else if (s.player.facing !== 1 && s.player.facing !== -1) s.player.facing = 1;
        } else {
          s.player = null;
        }

        if (!s.doors || typeof s.doors !== 'object' || Object.prototype.toString.call(s.doors) === '[object Array]') {
          s.doors = {};
        }
        /* doors 里只保留三门，且只认 true */
        var clean = {};
        for (var k in s.doors) {
          if (DOORS[k] && s.doors[k] === true) clean[k] = true;
        }
        s.doors = clean;

        return s;
      } catch (e) {
        return def;
      }
    },

    /* 写存档：写失败（隐私模式 / 配额满）静默忽略，游戏继续 */
    set: function (s) {
      try {
        global.localStorage.setItem(this.KEY, JSON.stringify(s));
        return true;
      } catch (e) {
        return false;
      }
    },

    /* 记录角色位置：进传送门前调用 */
    setPlayer: function (x, facing) {
      var s = this.get();
      var px = Number(x);
      if (!isFinite(px)) return;
      px = Math.max(X_MIN, Math.min(X_MAX, px));
      s.player = { x: px, facing: (facing === 1 || facing === -1) ? facing : 1 };
      this.set(s);
    },

    /* 清空位置：下次回大厅回到默认出生点 */
    clearPlayer: function () {
      var s = this.get();
      s.player = null;
      this.set(s);
    },

    /* 标记某门已通关（只接受三门，其它名字直接忽略） */
    complete: function (name) {
      if (!DOORS[name]) return;
      var s = this.get();
      if (s.doors[name] === true) return;    /* 已记过就不重复写盘 */
      s.doors[name] = true;
      this.set(s);
    },

    isCleared: function (name) {
      if (!DOORS[name]) return false;
      var s = this.get();
      return !!(s.doors && s.doors[name] === true);
    },

    /* 全部清空（调试 / 验收用，不影响正常流程） */
    reset: function () {
      try { global.localStorage.removeItem(this.KEY); return true; } catch (e) { return false; }
    }
  };

  global.Save = Save;

  /* 也挂一份到模块作用域，方便 IIFE 场景直接引用 */
  if (typeof module !== 'undefined' && module.exports) module.exports = Save;
})(typeof window !== 'undefined' ? window : this);
