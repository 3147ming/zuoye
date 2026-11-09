/* ============================================================
 * js/boot.js —— 启动引导（原 index.html 内联脚本外置，配合 defer 顺序加载）
 * 必须在所有 js/*.js 之后加载（defer 保证执行顺序）。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- HUD：底部提示条 ---------- */
  var toastEl = document.getElementById('toast');
  var current = '';

  window.HUD = {
    toast: function (text) {
      if (text === current) return;
      current = text;
      if (!text) {
        toastEl.classList.remove('on');
        return;
      }
      toastEl.textContent = text;
      toastEl.classList.add('on');
    }
  };

  /* ---------- 注册场景 ---------- */
  SceneManager.register('world', function () {
    return new WorldScene();
  });

  /* ---------- 背景音乐：先初始化（自动播放等第一次手势） ---------- */
  if (window.BGM) window.BGM.init();

  /* ---------- 启动 ---------- */
  SceneManager.start(document.getElementById('game'));
  SceneManager.change('world');

  /* ---------- 顶栏齿轮 ---------- */
  var gear = document.getElementById('gear');
  if (gear) {
    gear.addEventListener('click', function () {
      var s = SceneManager.current;
      if (s && s.openSettings) s.openSettings();
    });
  }

  /* ---------- 「目录」直达入口 ---------- */
  var dirBtn = document.getElementById('dirBtn');
  if (dirBtn && window.Directory) {
    dirBtn.addEventListener('click', function () { window.Directory.toggle(); });
  }

  /* 供手动调试：SceneManager.change('world') */
  window.WorldHub = window.WorldHub || {};
  window.WorldHub.SceneManager = SceneManager;

  /* ---------- 懒加载：跑酷大块（runner/parkour，构建时切出的 extra 包） ---------- */
  var extraUrl = document.documentElement.getAttribute('data-extra');
  var extraState = 0;   /* 0 未载 1 载入中 2 已载 3 失败 */
  var extraQ = [];
  /* 就绪判据看场景注册（runner.js 只导出 RunnerMeta / Parkour，没有 window.Runner） */
  function extraReady() {
    return !!(window.SceneManager && window.SceneManager.has('runner'));
  }
  window.WorldHub.loadExtra = function (cb) {
    if (extraReady() || !extraUrl) { if (cb) cb(true); return; }
    if (extraState === 2) { if (cb) cb(true); return; }
    if (extraState === 3) extraState = 0;   /* 允许失败后重试 */
    if (cb) extraQ.push(cb);
    if (extraState === 1) return;
    extraState = 1;
    var s = document.createElement('script');
    s.src = extraUrl;
    s.onload = function () {
      extraState = extraReady() ? 2 : 3;
      var q = extraQ; extraQ = [];
      for (var i = 0; i < q.length; i++) q[i](extraState === 2);
    };
    s.onerror = function () {
      extraState = 3;
      var q = extraQ; extraQ = [];
      if (window.HUD) window.HUD.toast('跑酷模块加载失败，请稍后重试');
      for (var i = 0; i < q.length; i++) q[i](false);
    };
    document.head.appendChild(s);
  };
  /* 空闲预取：等首屏稳定后再拉，不抢加载带宽 */
  (window.requestIdleCallback || function (f) { setTimeout(f, 2500); })(function () {
    if (!extraUrl || extraReady()) return;
    var l = document.createElement('link');
    l.rel = 'prefetch'; l.href = extraUrl;
    document.head.appendChild(l);
  });

  /* ---------- PWA：注册 Service Worker（仅 https / localhost） ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* 离线/不支持时静默 */ });
    });
  }
})();
