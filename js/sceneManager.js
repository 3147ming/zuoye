/* ============================================================
 * sceneManager.js —— 场景管理器
 * ------------------------------------------------------------
 * 职责：
 *   1. 持有唯一的 canvas / 2d context，按 DPR 设定真实像素
 *   2. 维护场景注册表，负责「先 destroy 旧场景，再 init 新场景」
 *   3. 驱动统一的 requestAnimationFrame 主循环，向场景派发 dt
 *
 * 场景统一接口（缺一即抛错，避免半成品场景混进来）：
 *   init(ctx, params)   进入场景，准备资源
 *   update(dt)          推进逻辑，dt 单位为秒
 *   render(ctx)         绘制，坐标系为 1280×720 逻辑像素
 *   destroy()           离开场景，释放监听/定时器/资源
 * ============================================================ */
(function (global) {
  'use strict';

  var WIDTH = 1280;
  var HEIGHT = 720;
  var MAX_DPR = 2;          // 超过 2 倍没有肉眼收益，只会拖慢填充率
  var MAX_DT = 0.05;        // 切后台回来时 dt 会很大，钳到 50ms 防穿模

  var SceneManager = {
    width: WIDTH,
    height: HEIGHT,

    canvas: null,
    ctx: null,

    scenes: Object.create(null),
    current: null,
    currentName: '',

    time: 0,
    running: false,

    _dpr: 1,
    _raf: 0,
    _last: 0,
    _boundFrame: null,
    _boundResize: null,

    /* ---------- 注册 ---------- */
    register: function (name, factory) {
      if (typeof factory !== 'function') {
        throw new Error('[SceneManager] 场景工厂必须是函数：' + name);
      }
      this.scenes[name] = factory;
      return this;
    },

    has: function (name) {
      return typeof this.scenes[name] === 'function';
    },

    /* ---------- 切换 ---------- */
    change: function (name, params) {
      if (!this.ctx) {
        throw new Error('[SceneManager] 请先调用 start(canvas) 再切换场景');
      }

      var prev = this.current;
      if (prev) {
        this.current = null;
        try {
          if (typeof prev.destroy === 'function') prev.destroy();
        } catch (err) {
          console.error('[SceneManager] 场景 ' + this.currentName + ' 的 destroy() 抛错：', err);
        }
      }

      var factory = this.scenes[name];
      if (!factory) {
        console.warn('[SceneManager] 未注册的场景：' + name);
        return null;
      }

      var scene = factory();
      if (!scene ||
          typeof scene.init !== 'function' ||
          typeof scene.update !== 'function' ||
          typeof scene.render !== 'function' ||
          typeof scene.destroy !== 'function') {
        throw new Error('[SceneManager] 场景接口不完整（需要 init/update/render/destroy）：' + name);
      }

      scene.__sceneName = name;
      this.current = scene;
      this.currentName = name;
      /* 把当前场景名写到 body 上，CSS 据此决定哪些 HUD 该显示
         （大厅标题只在大厅出现，进了小游戏要让位给游戏自己的 HUD） */
      if (document.body) document.body.setAttribute('data-scene', name);
      scene.init(this.ctx, params || {});
      return scene;
    },

    /* ---------- 启动 ---------- */
    start: function (canvas) {
      this.canvas = canvas || document.getElementById('game');
      if (!this.canvas) throw new Error('[SceneManager] 找不到 canvas');

      var ctx = this.canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('[SceneManager] 无法获取 2d 上下文');
      ctx.imageSmoothingEnabled = true;
      this.ctx = ctx;

      this._boundFrame = this._boundFrame || this._frame.bind(this);
      this._boundResize = this._boundResize || this._resize.bind(this);

      this._resize();
      global.addEventListener('resize', this._boundResize);

      if (!this.running) {
        this.running = true;
        this._last = (global.performance && performance.now) ? performance.now() : Date.now();
        this._raf = global.requestAnimationFrame(this._boundFrame);
      }
      return this;
    },

    stop: function () {
      this.running = false;
      if (this._raf) global.cancelAnimationFrame(this._raf);
      this._raf = 0;
      if (this._boundResize) global.removeEventListener('resize', this._boundResize);
      return this;
    },

    /* ---------- 内部：按 DPR 设定后备缓冲 ---------- */
    _resize: function () {
      if (!this.canvas) return;
      var dpr = Math.min(global.devicePixelRatio || 1, MAX_DPR);
      var w = Math.round(this.width * dpr);
      var h = Math.round(this.height * dpr);
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this._dpr = dpr;
    },

    /* ---------- 主循环 ---------- */
    _frame: function (now) {
      this._raf = global.requestAnimationFrame(this._boundFrame);

      var dt = (now - this._last) / 1000;
      this._last = now;
      if (!isFinite(dt) || dt < 0) dt = 0;
      if (dt > MAX_DT) dt = MAX_DT;

      this.time += dt;

      var ctx = this.ctx;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

      var scene = this.current;
      if (!scene) return;

      scene.update(dt);

      /* update() 里可能切换了场景（例如角色走进传送门）：
         旧场景此时已被 destroy()，绝不能拿旧引用继续渲染，必须重读 current */
      scene = this.current;
      if (!scene) return;
      scene.render(ctx);
    }
  };

  global.SceneManager = SceneManager;
})(window);
