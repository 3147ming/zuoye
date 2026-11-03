/* ============================================================
 * save.js —— 本地存档模块
 *
 * 独立于任何场景对象：谁需要谁调用 window.Save，场景销毁不影响存档。
 * 只做三件事：
 *   1) 记住角色在哪个区块、区块内的哪个位置（进门前写，回大厅时读）；
 *   2) 兼容历史：记下三款内置小游戏的「已通关」标记（第四批起大厅不再画吊牌）；
 *   3) 读写全程 try/catch —— file:// 下 localStorage 可能被浏览器策略禁用，
 *      隐私模式下 setItem 也可能抛 QuotaExceeded，任何一种都不能把游戏搞崩。
 *
 * 第四批新增 zone 字段：值必须是 ZONES（world.js）里存在的区块 id，否则回落 plaza。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 角色合法的横向范围。第四批改成「每区块一屏 1280」，
     所以 x 是区块内本地坐标，范围就是 [40, 1240]（与 world.js 的 EDGE_L / EDGE_R 一致）。 */
  var X_MIN = 40;
  var X_MAX = 1240;

  /* 只有这三扇门参与「已通关」标记（历史三款内置小游戏；开源 iframe 版不参与） */
  var DOORS = { fireice: 1, fight: 1, cards: 1 };

  /* 场景 id 白名单：必须和 world.js 的 SCENES 一一对应。
     自建内容（contrib）的 id 由 world.js 在 init 时用 Save.allow() 补进来。 */
  var ZONES = {
    'gate-tools': 1, 'plaza': 1, 'gate-games': 1,
    noise: 1, pomodoro: 1,
    snake: 1, game2048: 1, tetris: 1, fight: 1, mine: 1, gomoku: 1, breakout: 1
  };

  function defaults() {
    return { v: 1, player: null, doors: {}, zone: 'plaza' };
  }

  var Save = {
    KEY: 'worldhub.save.v1',

    /* 把额外的场景 id 补进白名单（自建内容用）。可以重复调用，幂等 */
    allow: function (ids) {
      if (!ids) return false;
      if (typeof ids === 'string') ids = [ids];
      for (var i = 0; i < ids.length; i++) {
        if (typeof ids[i] === 'string' && ids[i]) ZONES[ids[i]] = 1;
      }
      return true;
    },

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

        /* 第四批：区块 id。旧存档没有这个字段 → 回中心广场；
           写了不存在的 id 也回中心广场（白名单外一律不认） */
        if (typeof s.zone !== 'string' || !ZONES[s.zone]) s.zone = 'plaza';

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

    /* 记录角色位置：进门前调用。zoneId 可选，旧调用方式（只传 x/facing）保持可用 */
    setPlayer: function (x, facing, zoneId) {
      var s = this.get();
      var px = Number(x);
      if (!isFinite(px)) return;
      px = Math.max(X_MIN, Math.min(X_MAX, px));
      s.player = { x: px, facing: (facing === 1 || facing === -1) ? facing : 1 };
      if (typeof zoneId === 'string' && ZONES[zoneId]) s.zone = zoneId;
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
