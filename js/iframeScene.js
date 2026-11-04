/* ============================================================
 * iframeScene.js —— 开源游戏 / 工具的 iframe 场景壳
 * ------------------------------------------------------------
 * 为什么要有这一层：
 *   第四批接入的七个游戏和两个工具都是**独立页面**（各自带 css/js/图片），
 *   不改造它们的玩法代码，最干净的方式就是 iframe 直接加载。
 *   大厅只负责「按 E → 换到这个壳 → 壳把页面铺满舞台」。
 *
 * 约定：
 *   · params = { title, src }，src 是相对主页面的路径（如 games/snake/index.html）
 *   · 壳自己挂一个「← 返回大厅」按钮，并监听 Esc 兜底（iframe 抢焦点时外层收不到键）
 *   · destroy 必须把 iframe / 按钮 / 监听 / dataset 全部摘干净，反复进出不能有残留
 * ============================================================ */
(function (global) {
  'use strict';

  var RETURN_TEXT = '← 返回大厅';

  function IFrameScene() {
    this.stage = null;
    this.frame = null;
    this.btn = null;
    this.title = '';
    this._onKey = null;
  }

  IFrameScene.prototype.init = function (ctx, params) {
    var self = this;
    params = params || {};
    this.title = params.title || '游戏';

    /* 舞台：优先 #stage（16:9 装裱盒），退化成 body */
    this.stage = document.getElementById('stage') || document.body;

    /* ---- iframe ----
       不加 sandbox：file:// 下 sandbox 会把本地脚本一起挡掉。
       allow 里给全屏与自动播放留口，指针锁定给需要鼠标的玩法。 */
    var f = document.createElement('iframe');
    f.className = 'iframe-scene';
    f.title = this.title;
    f.setAttribute('allow', 'autoplay; fullscreen; gamepad; microphone; camera');
    f.setAttribute('allowfullscreen', '');
    f.src = params.src || 'about:blank';
    this.stage.appendChild(f);
    this.frame = f;

    /* ---- 返回按钮 ---- */
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'iframe-back';
    b.textContent = RETURN_TEXT;
    b.title = '返回大厅（Esc）';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      self.toHall();
    });
    this.stage.appendChild(b);
    this.btn = b;

    /* ---- Esc 兜底 ---- */
    this._onKey = function (e) {
      if (e.code === 'Escape' || e.key === 'Escape') {
        e.preventDefault();
        self.toHall();
      }
    };
    global.addEventListener('keydown', this._onKey);

    /* 让 CSS 收起大厅的标题与按键提示 */
    if (document.body && document.body.dataset) {
      document.body.dataset.scene = 'iframe-' + this.title;
    }

    /* 大厅音乐压到 0.18：游戏自己的声音（如果有）才听得清，回来也不会从头开始 */
    if (global.BGM) global.BGM.suspend();
  };

  IFrameScene.prototype.update = function () { /* 游戏自己跑主循环，外层不需要推进 */ };
  IFrameScene.prototype.render = function () { /* iframe 是 DOM，不在 canvas 上画 */ };

  IFrameScene.prototype.toHall = function () {
    if (global.SceneManager && global.SceneManager.has('world')) {
      global.SceneManager.change('world');
    }
  };

  IFrameScene.prototype.destroy = function () {
    if (this._onKey) global.removeEventListener('keydown', this._onKey);
    this._onKey = null;

    if (this.frame && this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
    if (this.btn && this.btn.parentNode) this.btn.parentNode.removeChild(this.btn);
    this.frame = null;
    this.btn = null;
    this.stage = null;

    /* 复位：data-scene 交回大厅，CSS 才会把标题与按键提示放出来 */
    if (document.body && document.body.dataset) {
      document.body.dataset.scene = 'world';
    }

    /* 回大厅：音乐恢复原音量 */
    if (global.BGM) global.BGM.resume();
  };

  global.SceneManager.register('iframe', function () { return new IFrameScene(); });
  global.IFrameScene = IFrameScene;
})(window);
