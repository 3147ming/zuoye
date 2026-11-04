/* ============================================================
 * gatePanel.js —— 总门选单（DOM 浮层）
 * ------------------------------------------------------------
 * 为什么是 DOM：7 条带图标的列表，画在 canvas 里要自己做命中测试、
 * 键盘高亮、滚动；DOM 这些全是现成的，而且任意缩放下文字都清晰。
 * 样式在 css/main.css 的「总门选单」一节，尺寸全用 cqw 跟随舞台缩放。
 *
 * 用法：
 *   GatePanel.open({ cat:'games', items:ITEMS, onPick:fn, onClose:fn });
 * ============================================================ */
(function (global) {
  'use strict';

  /* 记录当前是否有手指/鼠标按键按在屏幕上——用来区分「触屏按 E 开门」与「桌面键盘按 E 开门」。
     触屏按 E 开门时手指还按着（pointerDown=true），松手那一下会先被整屏浮层接到并合成 click，
     误点到首行直接传送；桌面键盘按 E 没有按键按住，开门后的第一次点击是用户真实操作，不能吞。 */
  var pointerDown = false;
  if (global.addEventListener) {
    global.addEventListener('pointerdown', function () { pointerDown = true; }, true);
    global.addEventListener('pointerup', function () { pointerDown = false; }, true);
    global.addEventListener('pointercancel', function () { pointerDown = false; }, true);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var CAT_LABEL = { tools: '工具区', games: '游戏区' };

  var Panel = {
    root: null,
    listEl: null,
    titleEl: null,
    kickEl: null,

    items: [],
    idx: 0,
    onPick: null,
    onClose: null,
    open_: false,

    _key: null,
    _lastFocus: null,

    mount: function () {
      if (this.root) return true;
      this.root = document.getElementById('gater');
      this.listEl = document.getElementById('gaterList');
      this.titleEl = document.getElementById('gaterTitle');
      this.kickEl = document.getElementById('gaterKicker');
      if (!this.root || !this.listEl) return false;

      var self = this;

      /* 只在浮层开着的时候接管键盘，关着的时候一个监听都不留 */
      this._key = function (e) { self.onKey(e); };

      this.root.addEventListener('click', function (e) {
        /* 触屏开门口：面板是整屏浮层，弹出瞬间覆盖住开门的 E 按钮，松手那一下会被浮层接到
           并合成 click → 误点到首行直接传送。只在「开门时手指还按着」(触屏) 才吞掉这第一击，
           桌面键盘开门没有按键按住，第一次点击是用户真实操作，照常生效。 */
        if (self._swallowTap) { self._swallowTap = false; return; }
        if (e.target === self.root) { self.close(true); return; }
        var row = e.target.closest ? e.target.closest('.gater-row') : null;
        if (row) {
          var i = parseInt(row.getAttribute('data-i'), 10);
          if (isFinite(i)) { self.idx = i; self.pick(); }
        }
      });

      this.root.addEventListener('mousemove', function (e) {
        var row = e.target.closest ? e.target.closest('.gater-row') : null;
        if (!row) return;
        var i = parseInt(row.getAttribute('data-i'), 10);
        if (isFinite(i) && i !== self.idx) { self.idx = i; self.mark(); }
      });

      var x = document.getElementById('gaterClose');
      if (x) x.addEventListener('click', function () { self.close(true); });

      return true;
    },

    open: function (opt) {
      if (!this.mount()) return false;
      opt = opt || {};

      this.items = (opt.items || []).slice();
      this.onPick = opt.onPick || null;
      this.onClose = opt.onClose || null;
      this.idx = 0;

      if (this.kickEl) this.kickEl.textContent = CAT_LABEL[opt.cat] || '区块';
      if (this.titleEl) this.titleEl.textContent = '选一个' + (opt.cat === 'tools' ? '工具' : '区块') + '传送过去';

      var html = '';
      var lastGroup = null;
      for (var i = 0; i < this.items.length; i++) {
        var it = this.items[i];
        /* 分组表头：只在同门内 item 带 group 且变化时插入（工具区无 group，不插） */
        if (it.group && it.group !== lastGroup) {
          html += '<li class="gater-group" role="presentation">' + esc(it.group) + '</li>';
          lastGroup = it.group;
        }
        html += '<li class="gater-row" role="option" id="gaterOpt' + i + '" data-i="' + i + '"' +
                ' aria-selected="' + (i === 0 ? 'true' : 'false') + '">' +
                  '<span class="gater-num">' + (i + 1) + '</span>' +
                  '<span class="gater-dot" style="background:' + esc(it.color || '#9b8afb') + '"></span>' +
                  '<span class="gater-txt"><b>' + esc(it.name) + '</b><i>' + esc(it.desc) + '</i></span>' +
                  '<span class="gater-go">传送 →</span>' +
                '</li>';
      }
      this.listEl.innerHTML = html;

      this._lastFocus = document.activeElement;
      this.root.classList.add('on');
      this.root.setAttribute('aria-hidden', 'false');
      /* 仅当开门瞬间有手指/按键按住（触屏按 E），才吞掉随后那一下误触 click */
      this._swallowTap = pointerDown;
      this.open_ = true;

      global.document.addEventListener('keydown', this._key, true);
      this.mark();
      return true;
    },

    mark: function () {
      if (!this.listEl) return;
      /* 只看 .gater-row，分组表头不参与高亮/序号 */
      var rows = this.listEl.querySelectorAll('.gater-row');
      for (var i = 0; i < rows.length; i++) {
        var on = i === this.idx;
        rows[i].classList.toggle('sel', on);
        rows[i].setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && rows[i].scrollIntoView) {
          try { rows[i].scrollIntoView({ block: 'nearest' }); } catch (e) { /* 忽略 */ }
        }
      }
      this.root.setAttribute('aria-activedescendant', 'gaterOpt' + this.idx);
    },

    move: function (d) {
      if (!this.items.length) return;
      this.idx = (this.idx + d + this.items.length) % this.items.length;
      this.mark();
    },

    pick: function () {
      var it = this.items[this.idx];
      var cb = this.onPick;
      this.close(false);
      if (it && cb) cb(it);
    },

    close: function (notify) {
      if (!this.open_) return;
      this.open_ = false;
      global.document.removeEventListener('keydown', this._key, true);
      this.root.classList.remove('on');
      this.root.setAttribute('aria-hidden', 'true');
      /* 清掉列表，免得关掉之后还留着上一次的可聚焦/可查询残影 */
      if (this.listEl) this.listEl.innerHTML = '';
      if (this._lastFocus && this._lastFocus.focus) {
        try { this._lastFocus.focus(); } catch (e) { /* 忽略 */ }
      }
      if (notify && this.onClose) this.onClose();
      this.onPick = null;
      this.onClose = null;
    },

    isOpen: function () {
      return this.open_;
    },

    onKey: function (e) {
      if (!this.open_) return;
      var c = e.code;

      if (c === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(true);
        return;
      }
      if (c === 'ArrowDown' || c === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this.move(1);
        return;
      }
      if (c === 'ArrowUp' || c === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        this.move(-1);
        return;
      }
      if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        this.pick();
        return;
      }
      /* 数字键直选 */
      var m = /^(Digit|Numpad)([1-9])$/.exec(c);
      if (m) {
        var i = parseInt(m[2], 10) - 1;
        if (i < this.items.length) {
          e.preventDefault();
          e.stopPropagation();
          this.idx = i;
          this.pick();
        }
        return;
      }
      /* 其余按键一律拦住，别让角色在浮层后面乱跑 */
      if (c !== 'Tab' && c !== 'KeyH' && c !== 'KeyO') {
        e.stopPropagation();
      }
    }
  };

  global.GatePanel = Panel;
})(window);
