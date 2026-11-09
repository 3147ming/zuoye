/* ============================================================
 * stats.js —— 大厅统计（第八批·新玩法⑨）
 * ------------------------------------------------------------
 * 本机维度：到访次数、累计游玩时长、进过哪些区块、每块进几次、
 * 跳跃 / 传送 / 进门次数。存 worldhub.stats.v1，纯本地不上云。
 * 对外：
 *   Stats.hit(zoneId)   记一次进入某区块（world.js 调）
 *   Stats.count(name)   记一个动作次数（jump / teleport / door）
 *   Stats.seeTime(sec)  主循环累计可见时长（sceneManager 调）
 *   Stats.report()      汇总，供设置面板「关于」区展示
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'worldhub.stats.v1';
  var SAVE_EVERY = 20;   /* 秒 */

  function defaults() {
    return {
      v: 1,
      visits: 1,
      seconds: 0,
      actions: { jump: 0, teleport: 0, door: 0, edge: 0, talk: 0, riddle: 0, portrait: 0, landscape: 0, iframeFail: 0 },
      metrics: { fcp: 0, dcl: 0 },
      zones: {},
      first: Date.now(),
      last: Date.now()
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (!raw) return defaults();
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object') return defaults();
      if (typeof s.visits !== 'number') s.visits = 1;
      if (typeof s.seconds !== 'number') s.seconds = 0;
      if (!s.actions || typeof s.actions !== 'object') s.actions = defaults().actions;
      if (!s.metrics || typeof s.metrics !== 'object') s.metrics = defaults().metrics;
      if (!s.zones || typeof s.zones !== 'object') s.zones = {};
      return s;
    } catch (e) { return defaults(); }
  }

  var data = load();

  function persist() {
    data.last = Date.now();
    try { global.localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* 每次开页 +1 到访（同一小时重开不重复计） */
  try {
    if (!data.last || Date.now() - data.last > 3600 * 1000) data.visits++;
  } catch (e) {}
  persist();

  var acc = 0;

  var Stats = {
    hit: function (zoneId) {
      if (!zoneId) return;
      data.zones[zoneId] = (data.zones[zoneId] || 0) + 1;
      persist();
    },
    count: function (name) {
      if (data.actions[name] == null) data.actions[name] = 0;
      data.actions[name]++;
    },
    /* 性能/环境指标：记最近值与滑动平均（首屏耗时、DCL 等） */
    metric: function (name, val) {
      if (typeof val !== 'number' || !isFinite(val) || val < 0) return;
      var m = data.metrics[name] || { last: 0, n: 0, avg: 0 };
      m.last = Math.round(val);
      m.n++;
      m.avg = Math.round(m.avg + (val - m.avg) / Math.min(m.n, 20));
      data.metrics[name] = m;
      persist();
    },
    /* 由主循环按帧调用，自己攒够 SAVE_EVERY 秒落盘一次 */
    seeTime: function (sec) {
      data.seconds += sec;
      acc += sec;
      if (acc >= SAVE_EVERY) { acc = 0; persist(); }
    },
    flush: function () { persist(); },
    zoneIds: function () { return data.zones; },

    /* 简短一行，供设置面板「足迹」区展示 */
    summary: function () {
      var r = this.report();
      var t = r.minutes < 1 ? '不到 1 分钟' : r.minutes + ' 分钟';
      return {
        visits: r.visits, time: t, zones: r.zones,
        teleports: r.actions.teleport || 0, doors: r.actions.door || 0,
        jumps: r.actions.jump || 0
      };
    },

    report: function () {
      var zoneCount = 0;
      for (var k in data.zones) zoneCount++;
      var fav = null, favN = 0;
      for (var z in data.zones) {
        if (data.zones[z] > favN) { favN = data.zones[z]; fav = z; }
      }
      var mins = Math.round(data.seconds / 60);
      return {
        visits: data.visits,
        minutes: mins,
        zones: zoneCount,
        favorite: fav,
        favoriteCount: favN,
        actions: data.actions,
        metrics: data.metrics,
        days: Math.max(1, Math.round((Date.now() - (data.first || Date.now())) / 86400000))
      };
    }
  };

  global.Stats = Stats;
})(window);
