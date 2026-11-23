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
    this._loading = null;
    this._loadingText = null;
    this._loadingHint = null;
    this._loadTimer = null;
    this._loadTick = null;
    this._loadStart = 0;
    this._onMsg = null;
    /* 第八批①：等比装裱 */
    this._fit = null;
    this._ratio = null;
    this._onLayout = null;
    /* 第八批③：加载状态机 */
    this._state = 'idle';       /* idle/loading/loaded/timeout/error/notfound */
    this._src = '';
    this._isCross = false;
    this._timeoutTimer = null;  /* 12s 超时 */
    this._deadline = 0;
    this._resultOv = null;      /* 超时/失败/不存在的结果层（含重试按钮） */
    this._resultBtns = null;
    this._retryCount = 0;
    this._precheckToken = 0;
  }

  /* 把 '16/9' / '9/16' / '1/1' / '4/3' / 'auto' 解析成宽高比数值；非法值当 auto */
  function parseRatio(r) {
    if (!r || r === 'auto') return 0;
    if (typeof r === 'number') return r > 0 ? r : 0;
    r = String(r);
    var m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(r);
    if (m) {
      var w = parseFloat(m[1]), h = parseFloat(m[2]);
      return (w > 0 && h > 0) ? w / h : 0;
    }
    /* 也接受小数字符串（如 '0.5625'） */
    if (/^\d+(\.\d+)?$/.test(r)) { var v = parseFloat(r); return v > 0 ? v : 0; }
    return 0;
  }

  IFrameScene.prototype.init = function (ctx, params) {
    var self = this;
    params = params || {};
    this.title = params.title || '游戏';
    this.from = params.from || null;
    this.px = params.px || 0;
    this.pf = params.pf === -1 ? -1 : 1;
    this.cross = params.cross === true;
    this._ratio = parseRatio(params.ratio);

    /* 舞台：优先 #stage（16:9 装裱盒），退化成 body */
    this.stage = document.getElementById('stage') || document.body;

    /* 第八批①：iframe 场景让舞台脱离大厅的 16:9，撑满可用区；
       真正的内容比例由 .iframe-fit 在 _layout() 里按本门 ratio 算最大内接矩形。 */
    if (this.stage.classList) this.stage.classList.add('stage--iframe');

    /* 装裱容器：绝对居中，尺寸由 JS 写入；iframe 只填这个盒子，四周留深色边 */
    var fit = document.createElement('div');
    fit.className = 'iframe-fit' + (this._ratio ? '' : ' iframe-fit--auto');
    this.stage.appendChild(fit);
    this._fit = fit;

    /* ---- iframe ---- 由 _createFrame() 创建；重试时只重建它，其它装裱/按钮不动。
       第八批③：加载状态机，文案随状态切换，不再反复横跳；12s 超时给重试。 */
    this._src = params.src || 'about:blank';
    this._isCross = /^https?:/i.test(this._src);
    this._notfound = false;
    this._retryCount = 0;
    this._setState('loading');
    this._createFrame();
    this._precheck();

    /* 同源游戏可通过 postMessage({type:'exit'}) 通知外层回大厅（焦点在 iframe 内时 Esc 收不到） */
    this._onMsg = function (e) {
      if (!self.frame || e.source !== self.frame.contentWindow) return;
      var d = e.data;
      if (d === 'exit' || (d && d.type === 'exit')) self.toHall();
    };
    global.addEventListener('message', this._onMsg);

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

    /* 装裱尺寸在窗口/朝向/可视视口变化时重算（键盘弹起也会触发 visualViewport.resize） */
    this._onLayout = function () { self._layout(); };
    global.addEventListener('resize', this._onLayout);
    global.addEventListener('orientationchange', this._onLayout);
    if (global.visualViewport) global.visualViewport.addEventListener('resize', this._onLayout);
    this._layout();
  };

  /* 第八批①：在舞台可用区内，按本门 ratio 求最大不溢出矩形并居中。
     auto（工具页）不套比例，撑满舞台由内部流式滚动；
     有 ratio 时等比内接：w/h 超限则以另一维为准，绝不强拉。 */
  IFrameScene.prototype._layout = function () {
    var fit = this._fit, stage = this.stage;
    if (!fit || !stage) return;
    var availW = stage.clientWidth, availH = stage.clientHeight;
    if (!availW || !availH) return;
    var ratio = this._ratio;
    if (!ratio) {
      fit.style.width = '100%';
      fit.style.height = '100%';
      fit.style.left = '0';
      fit.style.top = '0';
      fit.style.transform = 'none';
      return;
    }
    var w = availW, h = availH;
    if (availW / availH > ratio) { w = Math.round(availH * ratio); }
    else { h = Math.round(availW / ratio); }
    fit.style.width = w + 'px';
    fit.style.height = h + 'px';
    fit.style.left = '50%';
    fit.style.top = '50%';
    fit.style.transform = 'translate(-50%, -50%)';
  };

  /* 第八批③：加载状态机。idle → loading → loaded / timeout / error / notfound。
     状态切换只做一次 DOM 变更，骨架 / 结果层互不叠加，文案不反复横跳。 */
  IFrameScene.prototype._setState = function (state) {
    if (this._state === state && state !== 'loading') return;
    this._state = state;
    if (state === 'loading') {
      this._clearResult();
      this._armTimeout();
      this._showLoading();
      return;
    }
    this._clearLoading();
    this._disarmTimeout();
    if (state === 'loaded') { this._clearResult(); return; }
    this._showResult(state);
  };

  IFrameScene.prototype._armTimeout = function () {
    this._disarmTimeout();
    var self = this;
    this._deadline = Date.now() + 12000;
    this._timeoutTimer = setTimeout(function () {
      self._timeoutTimer = null;
      if (self._state === 'loading') self._setState('timeout');
    }, 12000);
  };

  IFrameScene.prototype._disarmTimeout = function () {
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
    this._deadline = 0;
  };

  IFrameScene.prototype._showLoading = function () {
    this._clearLoading();
    var ov = document.createElement('div');
    ov.className = 'iframe-loading';
    var txt = document.createElement('span');
    txt.className = 'iframe-loading-txt';
    txt.textContent = this._isCross ? '正在连接游戏…' : '正在进入游戏…';
    ov.appendChild(txt);
    this.stage.appendChild(ov);
    this._loading = ov;
    this._loadingText = txt;
  };

  /* 创建（或重建）iframe。重试只走这里：摘旧节点、加 cachebuster、重新计时都集中在一处。 */
  IFrameScene.prototype._createFrame = function () {
    var self = this;
    if (this.frame && this.frame.parentNode) this.frame.parentNode.removeChild(this.frame);
    this.frame = null;

    /* 同源（games/*、tools/*）不加 sandbox：file:// 下 sandbox 会挡本地脚本。
       跨域 https 加 sandbox + no-referrer，收敛权限；allow 不含摄像头/麦克风。 */
    var f = document.createElement('iframe');
    f.className = 'iframe-scene';
    f.title = this.title;
    f.setAttribute('allow', 'autoplay; fullscreen; gamepad; pointer-lock');
    f.setAttribute('allowfullscreen', '');
    if (this._isCross) {
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox');
      f.setAttribute('referrerpolicy', 'no-referrer');
    }
    var src = this._src;
    /* 重试绕开失败文档的缓存，确保重新请求一次 */
    if (this._retryCount > 0 && src && src !== 'about:blank') {
      src += (src.indexOf('?') >= 0 ? '&' : '?') + '__whr=' + Date.now();
    }
    f.src = src;
    if (this._fit) this._fit.appendChild(f);
    this.frame = f;

    f.addEventListener('load', function () {
      if (self.frame !== f) return;        /* 重试中途旧 iframe 的迟到事件，忽略 */
      /* 终态是单向的：已判 timeout / error / notfound 后，迟到的 load 不再翻回 loaded，
         只能由用户点「重试」重新进入 loading。404 的 load 同理。 */
      if (self._state !== 'loading') return;
      self._setState('loaded');
    });
    f.addEventListener('error', function () {
      if (self.frame !== f || self._state !== 'loading') return;
      self._setState(self._notfound ? 'notfound' : 'error');
    });
  };

  /* 同源门：HEAD 预检，404 直接判 notfound，不套网络失败文案。
     fetch 不可用时（file://）跳过，交给 error/timeout 兜底。重试时也会重跑。 */
  IFrameScene.prototype._precheck = function () {
    var self = this;
    var token = ++this._precheckToken;
    this._notfound = false;
    if (!this._isCross && global.fetch && /^(games|tools)\//.test(this._src)) {
      global.fetch(this._src, { method: 'HEAD' }).then(function (resp) {
        if (token !== self._precheckToken || !resp || resp.status !== 404) return;
        /* HEAD 可能比 iframe load 晚到；只要还在本门的加载流程里就判 notfound */
        self._notfound = true;
        if (self._state === 'loading' || self._state === 'loaded') self._setState('notfound');
      }).catch(function () {
        /* 同源门连 HEAD 都发不出去 = 网络层失败。iframe 导航失败时浏览器常触发
           load（错误页）而不是 error，必须靠预检兜住，否则会误判 loaded。 */
        if (token !== self._precheckToken) return;
        if (self._state === 'loading') self._setState('error');
      });
    }
  };

  IFrameScene.prototype._showResult = function (state) {
    this._clearResult();
    var conf = {
      timeout:  { title: '加载时间较长', msg: '可能是网络较慢或资源较大，可以再试一次。', retry: true },
      error:    { title: '没能加载出来', msg: '网络不太顺畅，该内容没能加载。', retry: true },
      notfound: { title: '这里没有内容', msg: '这个页面不存在或已经搬走了。', retry: true }
    }[state] || { title: '加载失败', msg: '请稍后再试。', retry: true };

    if (this._retryCount >= 2 && state !== 'notfound') {
      conf.msg += '\n如果多次失败，可以稍后再试或换一个网络。';
    }
    if (global.Stats && global.Stats.count) global.Stats.count('iframeFail');

    var ov = document.createElement('div');
    ov.className = 'iframe-result';
    var card = document.createElement('div');
    card.className = 'iframe-result-card';
    var h = document.createElement('div');
    h.className = 'iframe-result-title';
    h.textContent = conf.title;
    var p = document.createElement('p');
    p.className = 'iframe-result-msg';
    p.textContent = conf.msg;
    var box = document.createElement('div');
    box.className = 'iframe-result-btns';
    card.appendChild(h); card.appendChild(p); card.appendChild(box);
    ov.appendChild(card);
    this.stage.appendChild(ov);

    var self = this;
    if (conf.retry) {
      var br = document.createElement('button');
      br.type = 'button';
      br.className = 'iframe-result-btn primary';
      br.textContent = '重试';
      br.addEventListener('click', function (e) { e.preventDefault(); self._retry(); });
      box.appendChild(br);
    }
    var bh = document.createElement('button');
    bh.type = 'button';
    bh.className = 'iframe-result-btn' + (conf.retry ? '' : ' primary');
    bh.textContent = '回大厅';
    bh.addEventListener('click', function (e) { e.preventDefault(); self.toHall(); });
    box.appendChild(bh);

    this._resultOv = ov;
    this._resultBtns = box;
  };

  IFrameScene.prototype._clearResult = function () {
    if (this._resultOv && this._resultOv.parentNode) this._resultOv.parentNode.removeChild(this._resultOv);
    this._resultOv = null;
    this._resultBtns = null;
  };

  IFrameScene.prototype._retry = function () {
    this._retryCount += 1;
    this._setState('loading');
    this._createFrame();
    this._precheck();
  };

  IFrameScene.prototype._clearLoading = function () {
    if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = null; }
    if (this._loadTick) { clearInterval(this._loadTick); this._loadTick = null; }
    if (this._loading && this._loading.parentNode) this._loading.parentNode.removeChild(this._loading);
    this._loading = null;
    this._loadingText = null;
  };

  /* 兼容旧调用（如外部手动标记断网）；统一并入状态机，不再另起一层提示 */
  IFrameScene.prototype.showOffline = function () { this._setState('error'); };

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
    this._precheckToken += 1;   /* 在途 HEAD 响应作废，退出后不得再改状态 */
    if (this._onKey) global.removeEventListener('keydown', this._onKey);
    this._onKey = null;
    if (this._onMsg) global.removeEventListener('message', this._onMsg);
    this._onMsg = null;
    if (this._onLayout) {
      global.removeEventListener('resize', this._onLayout);
      global.removeEventListener('orientationchange', this._onLayout);
      if (global.visualViewport) global.visualViewport.removeEventListener('resize', this._onLayout);
      this._onLayout = null;
    }
    this._clearLoading();
    this._disarmTimeout();
    this._clearResult();
    this._state = 'idle';

    if (this._fit && this._fit.parentNode) this._fit.parentNode.removeChild(this._fit);
    this._fit = null;
    if (this.stage && this.stage.classList) this.stage.classList.remove('stage--iframe');

    /* iframe 随 _fit 一起摘除；load/error 监听随节点回收，不再逐个解绑 */
    this.frame = null;
    if (this.btnBack && this.btnBack.parentNode) this.btnBack.parentNode.removeChild(this.btnBack);
    if (this.btnHall && this.btnHall.parentNode) this.btnHall.parentNode.removeChild(this.btnHall);
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
