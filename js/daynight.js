/* ============================================================
 * daynight.js —— 大厅昼夜循环（第八批·新玩法①）
 * ------------------------------------------------------------
 * 按真实时间给出「时段」与世界色调，world.js 烘焙背景与渲染时取用。
 *   dawn  黎明 05:00–07:00   day 白昼 07:00–17:00
 *   dusk  黄昏 17:00–19:00   night 夜 19:00–05:00
 * 用户可在设置里切换：跟随时间（默认）/ 固定白昼 / 固定夜。
 * 存档 key: worldhub.daynight.mode.v1 → 'auto' | 'day' | 'night'
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'worldhub.daynight.mode.v1';

  var PALETTE = {
    /* tint: 叠在烘焙背景上的整屏色罩；lamp: 灯笼点亮强度 0~1；star: 星星可见 0~1 */
    dawn:  { name: '黎明', tint: 'rgba(255, 170, 120, 0.10)', lamp: 0.55, star: 0.10, sky: 0.35 },
    day:   { name: '白昼', tint: 'rgba(255, 235, 190, 0.06)', lamp: 0.00, star: 0.00, sky: 0.00 },
    dusk:  { name: '黄昏', tint: 'rgba(210, 110, 90, 0.12)',  lamp: 0.70, star: 0.20, sky: 0.20 },
    night: { name: '夜',   tint: 'rgba(20, 24, 70, 0.30)',    lamp: 1.00, star: 1.00, sky: 1.00 }
  };

  function mode() {
    try {
      var v = global.localStorage.getItem(KEY);
      if (v === 'day' || v === 'night') return v;
      return 'auto';
    } catch (e) { return 'auto'; }
  }

  function setMode(m) {
    try { global.localStorage.setItem(KEY, m === 'day' || m === 'night' ? m : 'auto'); } catch (e) {}
  }

  function phaseByHour(h) {
    if (h >= 5 && h < 7) return 'dawn';
    if (h >= 7 && h < 17) return 'day';
    if (h >= 17 && h < 19) return 'dusk';
    return 'night';
  }

  var DayNight = {
    /* 当前时段名：auto 按小时，手动固定时把 night 折成 day（跟随用户选择） */
    phase: function () {
      var m = mode();
      if (m === 'day') return 'day';
      if (m === 'night') return 'night';
      return phaseByHour(new Date().getHours());
    },
    data: function () {
      var p = this.phase();
      return PALETTE[p];
    },
    /* 是否自动模式在夜间（供 BGM 等做氛围差异） */
    isNight: function () { return this.phase() === 'night'; },
    /* 渲染参数：星星可见度 / 灯亮强度 / 整屏色罩（world.render 取用） */
    state: function () {
      var p = this.phase();
      var pal = PALETTE[p];
      var tint = /^rgba/.test(pal.tint) ? pal.tint : '';
      var am = /rgba\([^)]*,\s*([\d.]+)\)/.exec(tint);
      return { star: pal.star, lamp: pal.lamp, tint: tint, alpha: am ? parseFloat(am[1]) : 0 };
    },
    describe: function () {
      var m = mode();
      return (PALETTE[this.phase()].name) + ' · ' + (m === 'auto' ? '跟随时间' : m === 'day' ? '固定白昼' : '固定夜');
    },
    modeName: function () {
      var m = mode();
      return m === 'auto' ? '跟随时间' : m === 'day' ? '白昼' : '夜';
    },
    mode: mode,
    setMode: setMode,
    PALETTE: PALETTE
  };

  global.DayNight = DayNight;
})(window);
