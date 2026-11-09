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

  /* ---------- PWA：注册 Service Worker（仅 https / localhost） ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* 离线/不支持时静默 */ });
    });
  }
})();
