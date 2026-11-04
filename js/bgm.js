/* ============================================================
 * bgm.js —— 大厅背景音乐（<audio> 循环 + 淡入淡出）
 * ------------------------------------------------------------
 * 用 <audio> 而不是 Web Audio：曲子是现成的 mp3，走元素能直接流式解码，
 * 也省掉自己做缓冲与调度的代码。音量仍然受设置面板控制。
 *
 * 三条纪律：
 *   1) 曲目表为空时整体静默 —— 没有 audio 元素、没有定时器、不报错；
 *   2) 自动播放被拒（InvalidStateError / NotAllowedError）当成正常情况，
 *      等下一次用户手势再试；
 *   3) 进游戏 iframe 时压到 0.18 而不是直接停 —— 免得回来时从头开始。
 * ============================================================ */
(function (global) {
  'use strict';

  var BGM = {
    el: null,
    tracks: [],
    idx: 0,

    want: false,        /* 用户层面「应该响着」 */
    suspended: false,   /* 进了游戏 iframe，暂时压低 */
    unlocked: false,    /* 已经有过用户手势 */

    vol: 0.55,
    mute: false,

    _timer: 0,

    available: function () {
      return this.tracks.length > 0;
    },

    /* 读取清单与偏好；不创建元素（等第一次 play） */
    init: function () {
      var cfg = global.WH_CONFIG || {};
      this.tracks = (cfg.bgm || []).filter(function (t) {
        return t && typeof t.src === 'string' && t.src;
      });

      var p = (global.Prefs && global.Prefs.get) ? global.Prefs.get() : { bgmVol: 0.55, bgmMute: false };
      this.vol = p.bgmVol;
      this.mute = p.bgmMute;

      this.bindGesture();
      return this;
    },

    /* 首次手势后解锁：浏览器要求音频必须由用户操作触发 */
    bindGesture: function () {
      var self = this;
      function arm() {
        self.unlocked = true;
        self.want = true;
        self.sync();
        global.removeEventListener('keydown', arm, true);
        global.removeEventListener('pointerdown', arm, true);
        global.removeEventListener('touchstart', arm, true);
      }
      try {
        global.addEventListener('keydown', arm, true);
        global.addEventListener('pointerdown', arm, true);
        global.addEventListener('touchstart', arm, true);
      } catch (e) { /* 忽略 */ }
    },

    ensure: function () {
      if (this.el || !this.available()) return this.el;
      var t = this.tracks[this.idx] || this.tracks[0];
      var el = document.createElement('audio');
      el.src = t.src;
      el.loop = this.tracks.length === 1;
      el.preload = 'auto';
      el.volume = 0;
      el.setAttribute('aria-hidden', 'true');
      var self = this;
      el.addEventListener('ended', function () {
        if (self.tracks.length > 1) {
          self.idx = (self.idx + 1) % self.tracks.length;
          self.load(self.idx, true);
        }
      });
      this.el = el;
      return el;
    },

    load: function (i, autoplay) {
      if (!this.available()) return;
      var el = this.ensure();
      if (!el) return;
      this.idx = Math.max(0, Math.min(this.tracks.length - 1, i));
      el.src = this.tracks[this.idx].src;
      el.loop = this.tracks.length === 1;
      if (autoplay) this.play();
    },

    play: function () {
      this.want = true;
      this.sync();
      return this;
    },

    pause: function () {
      this.want = false;
      this.sync();
      return this;
    },

    /* 进 / 出游戏时调用 */
    suspend: function () {
      this.suspended = true;
      this.sync();
    },

    resume: function () {
      this.suspended = false;
      this.sync();
    },

    setVolume: function (v) {
      var n = Number(v);
      if (!isFinite(n)) n = 0.55;
      this.vol = n < 0 ? 0 : (n > 1 ? 1 : n);
      if (global.Prefs) global.Prefs.set({ bgmVol: this.vol });
      this.apply(400);
    },

    setMute: function (on) {
      this.mute = !!on;
      if (global.Prefs) global.Prefs.set({ bgmMute: this.mute });
      this.apply(260);
    },

    target: function () {
      if (!this.want || this.mute) return 0;
      return this.vol * (this.suspended ? 0.18 : 1);
    },

    /* 真正决定「播还是停」 */
    sync: function () {
      var el = this.ensure();
      if (!el) return;
      var t = this.target();

      if (t > 0.001) {
        if (el.paused) {
          var p = el.play();
          if (p && typeof p.catch === 'function') {
            p.catch(function () { /* 自动播放被拒：等下一次手势 */ });
          }
        }
      }
      this.apply(900);
    },

    /* 平滑推音量；目标为 0 且已经到底就停掉元素，省点 CPU */
    apply: function (ms) {
      var el = this.el;
      if (!el) return;
      var target = this.target();

      if (this._timer) { global.clearInterval(this._timer); this._timer = 0; }

      var from = el.volume;
      var steps = Math.max(1, Math.round((ms || 600) / 40));
      var i = 0;
      var self = this;

      if (Math.abs(target - from) < 0.004) {
        el.volume = target;
        if (target <= 0.001 && !el.paused) el.pause();
        return;
      }

      this._timer = global.setInterval(function () {
        i++;
        var k = i / steps;
        el.volume = Math.max(0, Math.min(1, from + (target - from) * k));
        if (i >= steps) {
          global.clearInterval(self._timer);
          self._timer = 0;
          el.volume = target;
          if (target <= 0.001 && !el.paused) el.pause();
        }
      }, 40);
    },

    /* 设置面板改完以后整体重读 */
    refresh: function () {
      var p = (global.Prefs && global.Prefs.get) ? global.Prefs.get() : null;
      if (p) { this.vol = p.bgmVol; this.mute = p.bgmMute; }
      this.sync();
    }
  };

  global.BGM = BGM;
})(window);
