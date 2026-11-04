/* ============================================================
 * iframeScene.js —— 开源游戏 / 工具 / 脑力街机 的 iframe 场景壳
 * ------------------------------------------------------------
 * 约定：
 *   · params = { title, src, from, px, pf, cross }
 *     from/px/pf：进入本壳之前的世界场景与位置，供「回上一级」原路返回；
 *     cross：脑力街机（跨域 https 直达）标记，此时 WorldHub 不派发按键。
 *   · 壳挂两个返回入口：「← 回上一级」回到 from 场景、「← 回大厅」回广场；
 *     Esc 回大厅，Backspace 回上一级（iframe 抢焦点时外层收不到键时用按钮）。
 *   · destroy 必须把 iframe / 两按钮 / 监听 / 离线提示全部摘干净，反复进出不能有残留。
 * ============================================================ */
(function (global) {
  'use strict';

  var BACK_TEXT = '← 回上一级';
  var HALL_TEXT = '← 回大厅';

  function IFrameScene() {
    this.stage = null;
    this.frame = null;
    this.btnBack = null;
    this.btnHall = null;
    this.title = '';
    this.from = null;
    this.px = 0;
    this.pf = 1;
    this.cross = false;
    this._onKey = null;
    this._offline = null;
    this._offlineOv = null;
  }

  IFrameScene.prototype.init = function (ctx, params) {
    var self = this;
    params = params || {};
    this.title = params.title || '游戏';
    this.from = params.from || null;
    this.px = params.px || 0;
    this.pf = params.pf === -1 ? -1 : 1;
    this.cross = params.cross === true;

    /* 舞台：优先 #stage（16:9 装裱盒），退化成 body */
    this.stage = document.getElementById('stage') || document.body;

    /* ---- iframe ----
       不加 sandbox：file:// 下 sandbox 会把本地脚本一起挡掉。
       allow 里给全屏与自动播放留口，指针锁定给需要鼠标的玩法。 */
    var f = document.createElement('iframe');
    f.className = 'iframe-scene';
    f.title = this.title;
    f.setAttribute('allow', 'autoplay; fullscreen; gamepad; microphone; camera; popups');
    f.setAttribute('allowfullscreen', '');
    f.src = params.src || 'about:blank';
    this.stage.appendChild(f);
    this.frame = f;

    /* 断网 / 加载失败：iframe 导航失败时给轻量提示，返回按钮仍可用 */
    this._offline = function () { self.showOffline(); };
    f.addEventListener('error', this._offline);

    /* ---- 返回按钮：回上一级（左）+ 回大厅（右） ---- */
    var bb = document.createElement('button');
    bb.type = 'button';
    bb.className = 'iframe-back iframe-back-prev';
    bb.textContent = BACK_TEXT;
    bb.title = '回到进入游戏前的场景（Backspace）';
    bb.addEventListener('click', function (e) {
      e.preventDefault();
      self.toPrev();
    });
    this.stage.appendChild(bb);
    this.btnBack = bb;

    var bh = document.createElement('button');
    bh.type = 'button';
    bh.className = 'iframe-back';
    bh.textContent = HALL_TEXT;
    bh.title = '返回大厅（Esc）';
    bh.addEventListener('click', function (e) {
      e.preventDefault();
      self.toHall();
    });
    this.stage.appendChild(bh);
    this.btnHall = bh;

    /* ---- Esc 回大厅 / Backspace 回上一级 ---- */
    this._onKey = function (e) {
      if (e.code === 'Escape' || e.key === 'Escape') {
        e.preventDefault();
        self.toHall();
      } else if (e.code === 'Backspace' || e.key === 'Backspace') {
        e.preventDefault();
        self.toPrev();
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

  IFrameScene.prototype.showOffline = function () {
    if (this._offlineOv) return;
    var ov = document.createElement('div');
    ov.className = 'iframe-offline';
    ov.textContent = '需要网络连接 · 该游戏加载失败';
    this.stage.appendChild(ov);
    this._offlineOv = ov;
  };

  IFrameScene.prototype.update = function () { /* 游戏自己跑主循环，外层不需要推进 */ };
  IFrameScene.prototype.render = function () { /* iframe 是 DOM，不在 canvas 上画 */ };

  IFrameScene.prototype.toPrev = function () {
    if (this.from) {
      global.SceneManager.change('world', { sceneId: this.from, px: this.px, pf: this.pf });
    } else {
      this.toHall();
    }
  };

  IFrameScene.prototype.toHall = function () {
    if (global.SceneManager && global.SceneManager.has('world')) {
      global.SceneManager.change('world');
    }
  };

  IFrameScene.prototype.destroy = function () {
    if (this._onKey) global.removeEventListener('keydown', this._onKey);
    this._onKey = null;

    if (this.frame) {
      if (this._offline) this.frame.removeEventListener('error', this._offline);
      if (this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
    }
    if (this.btnBack && this.btnBack.parentNode) this.btnBack.parentNode.removeChild(this.btnBack);
    if (this.btnHall && this.btnHall.parentNode) this.btnHall.parentNode.removeChild(this.btnHall);
    if (this._offlineOv && this._offlineOv.parentNode) this._offlineOv.parentNode.removeChild(this._offlineOv);
    this.frame = null;
    this.btnBack = null;
    this.btnHall = null;
    this._offlineOv = null;
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
