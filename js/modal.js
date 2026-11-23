/* ============================================================
 * js/modal.js —— 第八批③：站内统一弹窗层 window.WHModal
 * ------------------------------------------------------------
 * 替代浏览器原生 alert/confirm/prompt，视觉与大厅剪纸风一致：
 * 深色遮罩 + 暖金描边卡片 + 圆角胶囊按钮，按钮热区 ≥44px，
 * 遮罩点击 / Esc 关闭（prompt 提交除外），焦点圈定在弹窗内，关闭后归还。
 * API 全部返回 Promise；confirm/prompt 的调用点必须 async/await。
 * ============================================================ */
(function (global) {
  'use strict';

  var CSS = [
    '.wh-modal-ov{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;',
    '  padding:24px;background:rgba(6,4,12,.78);backdrop-filter:blur(4px);}',
    '.wh-modal-card{width:min(92vw,420px);max-height:86vh;overflow:auto;box-sizing:border-box;',
    '  padding:24px 24px 20px;border-radius:18px;border:1px solid rgba(255,214,170,.42);',
    '  background:linear-gradient(160deg,#1b1430,#120d22);color:#f6ede0;',
    '  font-family:var(--sans,"Microsoft YaHei",sans-serif);box-shadow:0 30px 90px -20px rgba(0,0,0,.9);',
    '  animation:whm-in .18s ease-out;}',
    '@keyframes whm-in{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}',
    '.wh-modal-title{margin:0 0 10px;font-size:19px;font-weight:700;letter-spacing:.04em;color:#ffe3bd;}',
    '.wh-modal-msg{margin:0 0 18px;font-size:14px;line-height:1.7;color:rgba(246,237,224,.86);white-space:pre-wrap;word-break:break-word;}',
    '.wh-modal-label{display:block;margin:0 0 8px;font-size:13px;color:rgba(246,237,224,.8);}',
    '.wh-modal-input{width:100%;box-sizing:border-box;padding:11px 13px;margin:0 0 18px;',
    '  border-radius:10px;border:1px solid rgba(255,214,170,.35);background:rgba(8,6,16,.8);color:#f6ede0;',
    '  font:inherit;font-size:15px;-webkit-user-select:text;user-select:text;}',
    '.wh-modal-input:focus{outline:none;border-color:rgba(255,214,170,.85);}',
    '.wh-modal-btns{display:flex;gap:12px;justify-content:flex-end;}',
    '.wh-modal-btn{min-width:88px;min-height:44px;padding:0 20px;border-radius:999px;cursor:pointer;',
    '  font:inherit;font-size:14px;letter-spacing:.06em;border:1px solid rgba(255,214,170,.4);',
    '  background:rgba(255,214,170,.08);color:#ffe3bd;transition:transform .12s,background .16s;}',
    '.wh-modal-btn:hover{background:rgba(255,214,170,.18);}',
    '.wh-modal-btn:active{transform:scale(.97);}',
    '.wh-modal-btn:focus-visible{outline:2px solid rgba(255,214,170,.9);outline-offset:2px;}',
    '.wh-modal-btn.primary{background:linear-gradient(135deg,#f0a76e,#e07a4f);color:#241206;border-color:transparent;font-weight:700;}',
    '.wh-modal-btn.danger{background:linear-gradient(135deg,#e35b5b,#b93b3b);color:#fff;border-color:transparent;}',
    '@media (max-width:720px){.wh-modal-card{padding:20px 18px 16px;}.wh-modal-btn{flex:1;min-width:0;}}'
  ].join('\n');

  function ensureCSS(doc) {
    if (!doc || !doc.head || doc.getElementById('wh-modal-style')) return;
    var st = doc.createElement('style');
    st.id = 'wh-modal-style';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  ensureCSS(document);

  var active = null; /* 当前弹窗的关闭处理，保证同一时刻只有一个 */

  function close(overlay, resolve, value) {
    if (active && active.overlay === overlay) {
      try { active.cleanup(); } catch (_) {}
      var back = active.returnFocus;
      active = null;
      /* 焦点归还给打开弹窗前的元素（对应 P2-13「关闭后不留残影」） */
      if (back && back.focus) { try { back.focus(); } catch (_) {} }
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    resolve(value);
  }

  /* 通用构建器。opts: title/message, buttons:[{text,primary,danger,value}], input, onOpen */
  function open(opts) {
    return new Promise(function (resolve) {
      if (active) { /* 已有弹窗：先关掉旧的（返回其默认取消值） */
        try { active.cancel(); } catch (_) {}
      }
      var returnFocus = document.activeElement;
      var ov = document.createElement('div');
      ov.className = 'wh-modal-ov';
      var card = document.createElement('div');
      card.className = 'wh-modal-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      if (opts.title) {
        var h = document.createElement('h3');
        h.className = 'wh-modal-title';
        h.textContent = opts.title;
        card.appendChild(h);
      }
      if (opts.message != null) {
        var msg = document.createElement('p');
        msg.className = 'wh-modal-msg';
        msg.textContent = opts.message;
        card.appendChild(msg);
      }
      var input = null;
      if (opts.input) {
        var lab = document.createElement('label');
        lab.className = 'wh-modal-label';
        lab.textContent = opts.input.label || '';
        card.appendChild(lab);
        input = document.createElement('input');
        input.className = 'wh-modal-input';
        input.type = 'text';
        input.placeholder = opts.input.placeholder || '';
        input.value = opts.input.defaultValue || '';
        card.appendChild(input);
      }
      var btns = document.createElement('div');
      btns.className = 'wh-modal-btns';
      card.appendChild(btns);
      ov.appendChild(card);
      document.body.appendChild(ov);

      var done = false;
      function pick(btn) {
        if (done) return;
        done = true;
        var val = opts.getValue ? opts.getValue(btn, input) : (input ? input.value : btn.value);
        close(ov, resolve, val);
      }
      (opts.buttons || [{ text: '知道了', primary: true, value: undefined }]).forEach(function (b) {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'wh-modal-btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
        el.textContent = b.text;
        el.addEventListener('click', function () { pick(b); });
        btns.appendChild(el);
      });

      /* 遮罩点击关闭：prompt（有 input）不因点遮罩提交 */
      if (!opts.input) {
        ov.addEventListener('mousedown', function (e) {
          if (e.target === ov) { if (!done) { done = true; close(ov, resolve, opts.cancelValue); } }
        });
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          if (opts.input) return; /* prompt 提交除外：Esc 不误关 */
          e.preventDefault(); e.stopPropagation();
          if (!done) { done = true; close(ov, resolve, opts.cancelValue); }
        } else if (e.key === 'Tab') {
          /* 焦点圈定在弹窗内，Tab 不会跑到 iframe / 大厅按钮 */
          var list = card.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])');
          if (!list.length) return;
          var first = list[0], last = list[list.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      active = {
        overlay: ov,
        returnFocus: returnFocus,
        cleanup: function () { document.removeEventListener('keydown', onKey, true); },
        cancel: function () {
          if (!done) { done = true; close(ov, resolve, opts.cancelValue); }
        }
      };
      /* 节点被外部移除时也要摘键盘监听 */
      var mo = new MutationObserver(function () {
        if (!ov.parentNode) { document.removeEventListener('keydown', onKey, true); mo.disconnect(); }
      });
      active.cleanup = function () {
        document.removeEventListener('keydown', onKey, true);
        try { mo.disconnect(); } catch (_) {}
      };
      mo.observe(document.body, { childList: true });

      var first = input || card.querySelector('.wh-modal-btn');
      if (first) setTimeout(function () { try { first.focus(); } catch (_) {} }, 30);
    });
  }

  global.WHModal = {
    alert: function (o) {
      if (typeof o === 'string') o = { message: o };
      o = o || {};
      return open({
        title: o.title || '提示',
        message: o.message != null ? o.message : (o.text || ''),
        buttons: [{ text: o.okText || '知道了', primary: true, value: undefined }],
        cancelValue: undefined
      });
    },
    confirm: function (o) {
      if (typeof o === 'string') o = { message: o };
      o = o || {};
      return open({
        title: o.title || '确认',
        message: o.message || '',
        buttons: [
          { text: o.cancelText || '取消', value: false },
          { text: o.okText || '确定', primary: !o.danger, danger: !!o.danger, value: true }
        ],
        cancelValue: false
      });
    },
    prompt: function (o) {
      if (typeof o === 'string') o = { message: o };
      o = o || {};
      return open({
        title: o.title || '输入',
        message: o.message || '',
        input: { label: o.label || '', placeholder: o.placeholder || '', defaultValue: o.defaultValue || '' },
        buttons: [
          { text: o.cancelText || '取消', value: null },
          { text: o.okText || '确定', primary: true, value: '__ok__' }
        ],
        cancelValue: null,
        getValue: function (btn, input) {
          return btn.value === '__ok__' ? (input ? input.value : '') : null;
        }
      });
    },
    _open: open
  };
})(window);
