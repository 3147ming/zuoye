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
    _ro: null,

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
      /* 舞台宽度是 min() 算出来的，窗口变化由 ResizeObserver 统一回调；
         老浏览器退回 window.resize */
      if (global.ResizeObserver) {
        try {
          this._ro = new global.ResizeObserver(this._boundResize);
          this._ro.observe(this.canvas.parentElement || this.canvas);
        } catch (e) { global.addEventListener('resize', this._boundResize); }
      } else {
        global.addEventListener('resize', this._boundResize);
      }

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
      if (this._ro) { try { this._ro.disconnect(); } catch (e) {} this._ro = null; }
      if (this._boundResize) global.removeEventListener('resize', this._boundResize);
      return this;
    },

    /* ---------- 内部：后备缓冲对齐「舞台实际像素」----------
     * 旧做法固定 1280*DPR（手机 2560×1440），与显示尺寸脱钩 → 手机 5–12 倍像素空转。
     * 新做法：_dpr = 舞台CSS宽/逻辑宽 × DPR，夹在 [0.4, 2]，让 canvas 像素 ≈ 屏幕像素。
     * 视觉大小不变，只是不再先画 10 倍再缩回来。 */
    _resize: function () {
      if (!this.canvas) return;
      var stage = this.canvas.parentElement;
      var cssW = (stage && stage.clientWidth) || this.width;
      var dpr = Math.min(global.devicePixelRatio || 1, MAX_DPR);
      this._dpr = Math.max(0.4, Math.min(2, (cssW / this.width) * dpr));
      var w = Math.round(this.width * this._dpr);
      var h = Math.round(this.height * this._dpr);
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
    },

    /* ---------- 主循环 ---------- */
    _frame: function (now) {
      this._raf = global.requestAnimationFrame(this._boundFrame);

      var dt = (now - this._last) / 1000;
      this._last = now;
      if (!isFinite(dt) || dt < 0) dt = 0;
      if (dt > MAX_DT) dt = MAX_DT;

      this.time += dt;

      var scene = this.current;
      if (!scene) return;

      /* 浮层（设置 / 总门选单）打开时冻结：不 update 也不重绘，保留上一帧。
         canvas 是 alpha:false，不会回黑；关面板后下一帧自动恢复。 */
      if (scene._frozen === true) return;

      var ctx = this.ctx;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

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
