/* ============================================================
 * audio.js —— 合成音效（零素材、零依赖）
 * ------------------------------------------------------------
 * 全部用 Web Audio 现场合成：不加载任何音频文件，也不碰 <audio>。
 * 对外只有 window.Audio 一个对象（指令指定），另有 window.SFX 别名。
 *
 * 三条纪律：
 *   1) 首次用户手势（keydown / pointerdown / click）后才创建 AudioContext，
 *      浏览器自动播放策略要求如此；
 *   2) 任何一步失败都静默 —— 没有 AudioContext、上下文被挂起、参数非法，
 *      都只是「没声音」，绝不影响游戏逻辑；
 *   3) 音量克制：主增益 0.5，单音 0.03~0.10，连续触发也不会糊成一片。
 * ============================================================ */
(function (global) {
  'use strict';

  /* 名称 → 配方。step = { type, f0, f1, dur, gain, at }，at 是相对本音效起点的偏移 */
  var RECIPES = {
    ui:     [{ type: 'sine',     f0: 880,  f1: 880,  dur: 0.06, gain: 0.045 }],

    jump:   [{ type: 'triangle', f0: 430,  f1: 760,  dur: 0.12, gain: 0.055 }],

    land:   [{ type: 'sine',     f0: 190,  f1: 92,   dur: 0.10, gain: 0.070 }],

    portal: [{ type: 'sine',     f0: 300,  f1: 940,  dur: 0.30, gain: 0.055 },
             { type: 'triangle', f0: 600,  f1: 1500, dur: 0.26, gain: 0.030, at: 0.04 }],

    talk:   [{ type: 'sine',     f0: 1180, f1: 1180, dur: 0.05, gain: 0.032 },
             { type: 'sine',     f0: 1560, f1: 1560, dur: 0.04, gain: 0.018, at: 0.03 }],

    eat:    [{ type: 'square',   f0: 660,  f1: 1060, dur: 0.07, gain: 0.038 }],

    hit:    [{ type: 'triangle', f0: 230,  f1: 120,  dur: 0.10, gain: 0.075 },
             { type: 'square',   f0: 120,  f1: 70,   dur: 0.07, gain: 0.030, at: 0.01 }],

    kick:   [{ type: 'sine',     f0: 150,  f1: 58,   dur: 0.18, gain: 0.095 },
             { type: 'triangle', f0: 90,   f1: 50,   dur: 0.12, gain: 0.040, at: 0.02 }],

    ult:    [{ type: 'sawtooth', f0: 110,  f1: 1300, dur: 0.46, gain: 0.060 },
             { type: 'sine',     f0: 220,  f1: 1760, dur: 0.42, gain: 0.040, at: 0.03 },
             { type: 'square',   f0: 1400, f1: 90,   dur: 0.22, gain: 0.030, at: 0.36 }],

    match:  [{ type: 'sine',     f0: 880,  f1: 880,  dur: 0.09, gain: 0.048 },
             { type: 'sine',     f0: 1320, f1: 1320, dur: 0.11, gain: 0.042, at: 0.075 }],

    miss:   [{ type: 'triangle', f0: 320,  f1: 150,  dur: 0.22, gain: 0.052 }],

    win:    [{ type: 'sine', f0: 523, f1: 523, dur: 0.11, gain: 0.050, at: 0.00 },
             { type: 'sine', f0: 659, f1: 659, dur: 0.11, gain: 0.050, at: 0.10 },
             { type: 'sine', f0: 784, f1: 784, dur: 0.11, gain: 0.050, at: 0.20 },
             { type: 'sine', f0: 1047, f1: 1047, dur: 0.24, gain: 0.055, at: 0.30 }],

    dead:   [{ type: 'sawtooth', f0: 300, f1: 80, dur: 0.40, gain: 0.060 },
             { type: 'sine', f0: 150, f1: 60, dur: 0.36, gain: 0.040, at: 0.04 }],

    play:   [{ type: 'triangle', f0: 520, f1: 690, dur: 0.06, gain: 0.042 }],

    pass:   [{ type: 'sine',     f0: 420, f1: 280, dur: 0.09, gain: 0.038 }]
  };

  var SFX = {
    ctx: null,
    master: null,
    enabled: true,
    failed: false,

    /* 设置面板用的音量：0~1，master 增益仍按 0.5 封顶，避免叠加后爆音 */
    volume: 0.8,
    muted: false,

    /* 首次用户手势后创建 / 恢复上下文。重复调用无副作用。 */
    init: function () {
      if (this.failed || !this.enabled) return;
      try {
        if (!this.ctx) {
          var AC = global.AudioContext || global.webkitAudioContext;
          if (!AC) { this.failed = true; return; }
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.5;

          /* 音量从偏好里取：设置面板调过之后即使刷新也记得 */
          var p = (global.Prefs && global.Prefs.get) ? global.Prefs.get() : null;
          if (p) { this.volume = p.sfxVol; this.muted = p.sfxMute; }
          this.applyGain();

          this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) {
        this.failed = true;      /* 不支持就彻底静音，不再重试 */
      }
    },

    /* 单个音：波形、起止频率、时长、增益 */
    tone: function (type, f0, f1, dur, gain, at) {
      if (!this.ctx || !this.master) return;
      var t0 = this.ctx.currentTime + (at || 0);
      var osc = this.ctx.createOscillator();
      var env = this.ctx.createGain();

      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, f0), t0);
      if (f1 && f1 !== f0) {
        /* 指数滑音听感更自然；目标频率不能为 0 */
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      }

      var g = Math.max(0.0001, gain || 0.05);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(g, t0 + Math.min(0.012, dur * 0.3));
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(env);
      env.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },

    /* 播放一个具名音效。未知名字、没初始化、异常——都安静地什么都不做 */
    play: function (name) {
      if (!this.enabled || this.muted) return;
      var steps = RECIPES[name];
      if (!steps) return;
      if (!this.ctx) return;          /* 还没解锁：静默 */
      try {
        for (var i = 0; i < steps.length; i++) {
          var s = steps[i];
          this.tone(s.type, s.f0, s.f1, s.dur, s.gain, s.at || 0);
        }
      } catch (e) { /* 忽略 */ }
    },

    /* 立即把 volume / muted 落到 master 增益上 */
    applyGain: function () {
      if (!this.master) return;
      try {
        this.master.gain.value = this.muted ? 0 : 0.5 * this.volume;
      } catch (e) { /* 忽略 */ }
    },

    /* 音量（0~1）：设置面板的「音效」滑条 */
    setVolume: function (v) {
      var n = Number(v);
      if (!isFinite(n)) n = 0.8;
      this.volume = n < 0 ? 0 : (n > 1 ? 1 : n);
      this.applyGain();
      if (global.Prefs) global.Prefs.set({ sfxVol: this.volume });
    },

    setMute: function (on) {
      this.muted = !!on;
      this.applyGain();
      if (global.Prefs) global.Prefs.set({ sfxMute: this.muted });
    },

    /* 静音开关（保留老接口） */
    setEnabled: function (on) {
      this.enabled = !!on;
      this.setMute(!this.enabled);
    }
  };

  global.Audio = SFX;
  global.SFX = SFX;      /* 别名，避免和浏览器原生 Audio 构造器混淆 */

  /* 一次手势解锁：任何一个键 / 指针落下都算 */
  function arm() {
    SFX.init();
    global.removeEventListener('keydown', arm, true);
    global.removeEventListener('pointerdown', arm, true);
    global.removeEventListener('touchstart', arm, true);
  }
  try {
    global.addEventListener('keydown', arm, true);
    global.addEventListener('pointerdown', arm, true);
    global.addEventListener('touchstart', arm, true);
  } catch (e) { /* 忽略 */ }
})(window);
