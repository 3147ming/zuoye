/* ============================================================
 * settings.js —— 设置面板（背景 / 声音 / 自建内容 / 版本）
 * ------------------------------------------------------------
 * 面板本体是 DOM（在 index.html 里），这里只管行为：
 *   · 场景背景：本地上传（压到 1440×810 JPEG）或从 assets/bg/ 清单里选
 *   · 声音：BGM 与音效各一条滑条 + 各自静音，音效可试听
 *   · 其它：操作说明、全屏、重置存档
 *   · 自建内容：列出世界注册进来的条目，可逐条开关
 *   · 版本：显示当前版本；http(s) 下读 version.json 比对，file:// 下如实说明
 *
 * 对外只暴露 Settings.open(sceneId, sceneTitle) / close() / isOpen()。
 * 改了背景就派发 wh:bg，world.js 收到后重新烘焙那一屏。
 * ============================================================ */
(function (global) {
  'use strict';

  var MAX_W = 1440;
  var MAX_H = 810;
  /* 背景存 IndexedDB（数百 MB 配额），单张上限放宽到约 2.2MB 二进制，
     1440×810 JPEG 一般 q≈0.8 就够，不会被反复压糊。 */
  var MAX_CHARS = 3000000;

  function el(id) { return document.getElementById(id); }

  function pct(v) { return Math.round(v * 100) + '%'; }

  var Panel = {
    root: null,
    open_: false,
    sceneId: '',
    sceneTitle: '',

    _key: null,

    mount: function () {
      if (this.root) return true;
      this.root = el('settings');
      if (!this.root) return false;
      var self = this;

      this._key = function (e) {
        if (!self.open_) return;
        if (e.code === 'Escape' || e.code === 'KeyO') {
          e.preventDefault();
          e.stopPropagation();
          self.close();
          return;
        }
        if (e.code === 'Tab') { self._trapTab(e); return; }
        e.stopPropagation();         /* 面板开着时别让角色动 */
      };

      el('setClose').addEventListener('click', function () { self.close(); });
      this.root.addEventListener('click', function (e) {
        if (e.target === self.root) self.close();
      });

      this.bindBg();
      this.bindSound();
      this.bindMisc();
      this.bindVersion();

      return true;
    },

    /* ---------------- 背景 ---------------- */
    bindBg: function () {
      var self = this;
      var pick = el('bgPick');
      var file = el('bgFile');
      var list = el('bgList');
      var reset = el('bgReset');

      pick.addEventListener('click', function () { file.click(); });

      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        if (!/^image\//.test(f.type)) { self.hint('这个文件不是图片'); return; }
        self.hint('正在处理图片…');
        compress(f, function (url) {
          if (!url) { self.hint('这张图读不出来，换一张试试'); return; }
          if (!BgStore.set(self.sceneId, url)) {
            self.hint('存不下了（浏览器配额已满）——先删掉几屏的背景，或改用 assets/bg/ 里的图');
            return;
          }
          self.hint('已应用到「' + self.sceneTitle + '」');
          global.dispatchEvent(new global.CustomEvent('wh:bg', { detail: { sceneId: self.sceneId } }));
        });
      });

      list.addEventListener('change', function () {
        var v = list.value;
        if (!v) {
          BgStore.clear(self.sceneId);
          self.hint('已恢复默认背景');
        } else {
          if (!BgStore.set(self.sceneId, 'assets/bg/' + v)) {
            self.hint('写不进本地存储');
            return;
          }
          self.hint('已应用 assets/bg/' + v);
        }
        global.dispatchEvent(new global.CustomEvent('wh:bg', { detail: { sceneId: self.sceneId } }));
      });

      reset.addEventListener('click', function () {
        BgStore.clear(self.sceneId);
        list.value = '';
        self.hint('已恢复默认剪纸背景');
        global.dispatchEvent(new global.CustomEvent('wh:bg', { detail: { sceneId: self.sceneId } }));
      });
    },

    /* 上传的图压一压：1440×810、JPEG、逐步降质直到进入字符上限 */
    compressOnce: function (file, cb) {
      var fr = new FileReader();
      fr.onerror = function () { cb(''); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { cb(''); };
        img.onload = function () {
          var s = Math.min(1, MAX_W / img.width, MAX_H / img.height);
          var w = Math.max(1, Math.round(img.width * s));
          var h = Math.max(1, Math.round(img.height * s));
          var c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0, w, h);

          var q = 0.80;
          var url = c.toDataURL('image/jpeg', q);
          while (url.length > MAX_CHARS && q > 0.34) {
            q -= 0.08;
            url = c.toDataURL('image/jpeg', q);
          }
          cb(url);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    },

    /* ---------------- 声音 ---------------- */
    bindSound: function () {
      var p = Prefs.get();

      var bgmVol = el('bgmVol');
      var bgmVolV = el('bgmVolV');
      var bgmMute = el('bgmMute');
      var sfxVol = el('sfxVol');
      var sfxVolV = el('sfxVolV');
      var sfxMute = el('sfxMute');

      bgmVol.value = String(Math.round(p.bgmVol * 100));
      bgmVolV.textContent = pct(p.bgmVol);
      bgmMute.textContent = p.bgmMute ? '已静音' : '静音';
      bgmMute.classList.toggle('on', p.bgmMute);

      sfxVol.value = String(Math.round(p.sfxVol * 100));
      sfxVolV.textContent = pct(p.sfxVol);
      sfxMute.textContent = p.sfxMute ? '已静音' : '静音';
      sfxMute.classList.toggle('on', p.sfxMute);

      bgmVol.addEventListener('input', function () {
        var v = Number(bgmVol.value) / 100;
        bgmVolV.textContent = pct(v);
        if (global.BGM) global.BGM.setVolume(v);
        else Prefs.set({ bgmVol: v });
      });

      bgmMute.addEventListener('click', function () {
        var on = !bgmMute.classList.contains('on');
        bgmMute.classList.toggle('on', on);
        bgmMute.textContent = on ? '已静音' : '静音';
        if (global.BGM) global.BGM.setMute(on);
        else Prefs.set({ bgmMute: on });
      });

      sfxVol.addEventListener('input', function () {
        var v = Number(sfxVol.value) / 100;
        sfxVolV.textContent = pct(v);
        if (global.Audio && global.Audio.setVolume) global.Audio.setVolume(v);
        else Prefs.set({ sfxVol: v });
      });

      sfxMute.addEventListener('click', function () {
        var on = !sfxMute.classList.contains('on');
        sfxMute.classList.toggle('on', on);
        sfxMute.textContent = on ? '已静音' : '静音';
        if (global.Audio && global.Audio.setMute) global.Audio.setMute(on);
        else Prefs.set({ sfxMute: on });
      });

      var tipEl = el('tryTip');
      function tip(t) { if (tipEl) tipEl.textContent = t; }

      /* 音效试听：按当前音量依次放三声，用户据此判断滑条合不合适 */
      el('sfxTry').addEventListener('click', function () {
        if (global.Audio && global.Audio.init) global.Audio.init();   /* 首帧手势里解锁上下文 */
        if (!global.Audio || !global.Audio.play) { tip('这台设备放不出合成音效'); return; }
        if (global.Audio.muted) { tip('当前静音，先取消静音'); return; }
        var seq = ['play', 'match', 'win'];
        for (var i = 0; i < seq.length; i++) {
          (function (name, delay) {
            setTimeout(function () { global.Audio.play(name); }, delay);
          })(seq[i], i * 280);
        }
        tip('试听中：轻点 · 命中 · 胜利');
      });

      /* 音乐试听：曲目表还空着的时候如实说明，不假装有声音 */
      el('bgmTry').addEventListener('click', function () {
        if (!global.BGM || !global.BGM.available || !global.BGM.available()) {
          tip('曲目表还是空的');
          return;
        }
        if (global.BGM.mute) { tip('背景音乐当前是静音状态'); return; }
        global.BGM.play();
        tip('正在播放当前曲目');
      });
    },

    /* ---------------- 其它 ---------------- */
    bindMisc: function () {
      var self = this;

      el('openHelp').addEventListener('click', function () {
        self.close();
        try { global.dispatchEvent(new global.CustomEvent('wh:help')); } catch (e) { /* 忽略 */ }
      });

      el('toggleFull').addEventListener('click', function () {
        var d = document;
        try {
          if (!d.fullscreenElement && !d.webkitFullscreenElement) {
            var req = d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen;
            if (req) req.call(d.documentElement);
          } else {
            var exit = d.exitFullscreen || d.webkitExitFullscreen;
            if (exit) exit.call(d);
          }
        } catch (e) { /* 浏览器不让就算了 */ }
      });

      el('resetSave').addEventListener('click', function () {
        if (!global.confirm('会清空：所在区块、所有自定义背景、音量设置、自建内容开关。\n确定要重置吗？')) return;
        try {
          /* 只清本应用（worldhub.*）的键，别误伤同源其它页面（如 tools/*）的存储 */
          Object.keys(global.localStorage)
            .filter(function (k) { return /^worldhub\./.test(k); })
            .forEach(function (k) { global.localStorage.removeItem(k); });
        } catch (e) { /* 忽略 */ }
        try { global.location.reload(); } catch (e) { /* 忽略 */ }
      });
    },

    /* ---------------- 版本 ---------------- */
    bindVersion: function () {
      var self = this;
      var ver = el('setVer');
      var btn = el('checkUpd');
      var out = el('setUpd');

      var cfg = global.WH_CONFIG || { version: '0.0.0', build: '' };
      if (ver) ver.textContent = '大厅 v' + cfg.version + (cfg.build ? ' · ' + cfg.build : '');

      btn.addEventListener('click', function () {
        out.textContent = '检查中…';
        btn.disabled = true;
        checkUpdate(cfg, function (msg) {
          out.textContent = msg;
          btn.disabled = false;
        });
      });
    },

    /* ---------------- 自建内容 ---------------- */
    renderContrib: function () {
      var box = el('contribList');
      var empty = el('contribEmpty');
      if (!box) return;

      var all = (global.Contrib && global.Contrib.list) ? global.Contrib.list() : [];
      if (!all.length) {
        box.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
      }
      if (empty) empty.style.display = 'none';

      var html = '';
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        var on = global.Contrib.enabled(e.id);
        html += '<li class="set-contrib">' +
                  '<span class="set-dot" style="background:' + e.color + '"></span>' +
                  '<span class="set-contrib-txt"><b>' + e.name + '</b><i>' +
                    (e.cat === 'games' ? '游戏区' : '工具区') + (e.author ? ' · ' + e.author : '') +
                  '</i></span>' +
                  '<button class="set-toggle' + (on ? ' on' : '') + '" data-id="' + e.id + '">' +
                    (on ? '已启用' : '已停用') + '</button>' +
                '</li>';
      }
      box.innerHTML = html;

      box.onclick = function (ev) {
        var b = ev.target.closest ? ev.target.closest('.set-toggle') : null;
        if (!b) return;
        var id = b.getAttribute('data-id');
        var now = !global.Contrib.enabled(id);
        global.Contrib.setEnabled(id, now);
        Panel.renderContrib();
        try {
          global.dispatchEvent(new global.CustomEvent('wh:contrib', { detail: { id: id } }));
        } catch (e) { /* 忽略 */ }
      };
    },

    /* ---------------- 开关 ---------------- */
    /* 焦点陷阱：Tab / Shift+Tab 只在面板内循环，不跑到背后的 canvas */
    _trapTab: function (e) {
      var nodes = this.root.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      var list = [];
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].offsetParent !== null) list.push(nodes[i]);
      }
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (list.indexOf(document.activeElement) < 0) { e.preventDefault(); first.focus(); }
    },

    open: function (sceneId, sceneTitle) {
      if (!this.mount()) return false;
      this._lastFocus = document.activeElement;
      this.sceneId = sceneId || 'plaza';
      this.sceneTitle = sceneTitle || '当前场景';
      this.open_ = true;

      var cur = el('setScene');
      if (cur) cur.textContent = '当前场景：' + this.sceneTitle;

      /* 下拉：默认 + assets/bg 清单 */
      var list = el('bgList');
      var files = (global.WH_CONFIG && global.WH_CONFIG.bgFiles) || [];
      var html = '<option value="">默认（剪纸）</option>';
      for (var i = 0; i < files.length; i++) {
        html += '<option value="' + files[i] + '">' + files[i] + '</option>';
      }
      list.innerHTML = html;

      var stored = BgStore.get(this.sceneId);
      if (stored && stored.indexOf('assets/bg/') === 0) {
        list.value = stored.slice('assets/bg/'.length);
      } else {
        list.value = '';
      }

      this.hint(stored ? '这一屏已经有自定义背景' : '这一屏用的是默认剪纸背景');
      this.renderContrib();

      this.root.classList.add('on');
      this.root.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', this._key, true);

      var bgmVol = el('bgmVol');
      if (bgmVol) bgmVol.focus();
      return true;
    },

    close: function () {
      if (!this.open_) return;
      this.open_ = false;
      this.root.classList.remove('on');
      this.root.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', this._key, true);
      if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
        try { this._lastFocus.focus(); } catch (e) { /* 忽略 */ }
      }
      this._lastFocus = null;
    },

    isOpen: function () {
      return this.open_;
    },

    hint: function (text) {
      var h = el('bgHint');
      if (h) h.textContent = text;
    }
  };

  /* ---------------- 图片压缩（异步外壳，便于以后换成 createImageBitmap） ---------------- */
  function compress(file, cb) {
    Panel.compressOnce(file, cb);
  }

  /* ---------------- 版本检查 ---------------- */
  function checkUpdate(cfg, done) {
    if (global.location.protocol === 'file:') {
      done('本地文件模式：没有服务器可查，先按 v' + cfg.version + ' 用着');
      return;
    }
    var doneOnce = false;
    function fin(msg) { if (!doneOnce) { doneOnce = true; done(msg); } }

    var t = global.setTimeout(function () { fin('超时：没拿到 version.json'); }, 6000);

    try {
      global.fetch('version.json', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (v) {
        global.clearTimeout(t);
        if (!v || !v.version) { fin('version.json 里没有 version 字段'); return; }
        if (v.version === cfg.version) fin('已是最新（v' + cfg.version + '）');
        else fin('有新版本 v' + v.version + '（当前 v' + cfg.version + '）');
      }).catch(function () {
        global.clearTimeout(t);
        fin('检查失败：读不到 version.json');
      });
    } catch (e) {
      global.clearTimeout(t);
      fin('检查失败：' + e.message);
    }
  }

  /* 启动后静默查一次版本：有新版本才 toast，且每天最多提示一次 */
  function silentVersionCheck() {
    if (global.location.protocol === 'file:') return;
    var cfg = global.WH_CONFIG || {};
    if (!cfg.version) return;

    var today = new Date().toISOString().slice(0, 10);
    var KEY = 'worldhub.updcheck';
    try { if (global.localStorage.getItem(KEY) === today) return; } catch (e) {}
    try { global.localStorage.setItem(KEY, today); } catch (e) {}

    try {
      global.fetch('version.json', { cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (v) {
        if (v && v.version && v.version !== cfg.version && global.HUD) {
          global.HUD.toast('发现新版本 v' + v.version + '，刷新页面即可更新');
        }
      }).catch(function () {});
    } catch (e) {}
  }
  if (global.addEventListener) global.addEventListener('load', silentVersionCheck);

  global.Settings = Panel;
})(window);
