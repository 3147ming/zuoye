/* ============================================================
 * js/keyboardFit.js —— 第八批④：移动端虚拟键盘遮挡适配
 * ------------------------------------------------------------
 * 一套逻辑两处安装：
 *   1) 顶层大厅（每日一题、设置面板输入等）：install(document)
 *   2) 同源工具 iframe：gestureGuard.guardDocument() 里 install(iframeDoc)
 * 两个 document 各自只处理自己的聚焦元素，不会双重上推。
 *
 * 流程：focusin 记录输入元素 → 延时等键盘动画 → visualViewport 算出键盘高度 →
 *       body 补等量 padding-bottom（让底部按钮能滚上来）→ 输入框居中偏上 →
 *       相邻提交/翻类按钮抬进可视区；键盘收起后 padding 与滚动位置全部复位。
 * 无 visualViewport（或桌面无键盘）时退化为 focus 时 scrollIntoView(center)。
 * ============================================================ */
(function (global) {
  'use strict';

  var TYPING_SEL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  var SKIP_TYPE = { hidden: 1, checkbox: 1, radio: 1, range: 1, button: 1, submit: 1, reset: 1, image: 1 };
  var OPS_SEL = 'button, input[type="submit"], .pager, .row2, .actions, .toolbar';

  function isTyping(el) {
    if (!el || el.nodeType !== 1 || !el.matches) return false;
    if (!el.matches(TYPING_SEL)) return false;
    if (el.type && SKIP_TYPE[el.type]) return false;
    return true;
  }

  /* 找「相邻操作区」：同一 form / 同一工具卡片里的提交、翻类、开始按钮 */
  function findOps(el) {
    var roots = [];
    function add(r) { if (r && roots.indexOf(r) < 0) roots.push(r); }
    add(el.closest && el.closest('form'));
    add(el.closest && el.closest('.wrap, .panel, .card, .form, .search, .box'));
    add(el.parentElement);
    var ops = [];
    roots.forEach(function (r) {
      var list = r.querySelectorAll(OPS_SEL);
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (n.offsetWidth || n.offsetHeight) ops.push(n);
      }
    });
    return ops;
  }

  function install(doc) {
    if (!doc || !doc.documentElement || doc.__whKeyboardFit) return;
    doc.__whKeyboardFit = true;

    var win = doc.defaultView;
    if (!win) return;
    var vv = win.visualViewport || null;
    var active = null;
    var padSaved = null;
    var scrollSaved = 0;
    var applied = false;
    var timer = 0;
    var aligning = false;

    function reset() {
      if (!applied) return;
      applied = false;
      if (doc.body) {
        if (padSaved === null) doc.body.style.removeProperty('padding-bottom');
        else doc.body.style.paddingBottom = padSaved;
      }
      padSaved = null;
      try { win.scrollTo(0, scrollSaved); } catch (_) {}
    }

    function centerEl(el) {
      try { el.scrollIntoView({ block: 'center' }); }
      catch (_) { try { el.scrollIntoView(); } catch (_2) {} }
    }

    function align() {
      if (!active || !active.isConnected) { reset(); return; }
      var kb = vv ? (win.innerHeight - vv.height) : 0;

      /* 无键盘：若刚才抬过页面就完整复位（含滚动位置），不再额外滚动；
         只有从未进入键盘态时才走退化路径做一次居中。 */
      if (!vv || kb < 80) {
        if (applied) { reset(); return; }
        centerEl(active);
        return;
      }

      if (!applied) {
        applied = true;
        padSaved = doc.body ? doc.body.style.paddingBottom : null;
        scrollSaved = win.scrollY || doc.documentElement.scrollTop || 0;
      }
      /* 补底部空间：否则被键盘盖住的按钮根本滚不上来 */
      if (doc.body) doc.body.style.paddingBottom = Math.ceil(kb) + 'px';

      /* 输入框落在可视区中上部，留出下方按钮的空间 */
      centerEl(active);
      var top = active.getBoundingClientRect().top;
      var want = top - vv.height * 0.28;
      if (Math.abs(want) > 2) win.scrollBy(0, want);

      /* 相邻按钮若仍在键盘后方，再上抬；但不把输入框顶出可视区顶部 */
      var maxBottom = 0;
      findOps(active).forEach(function (o) {
        var b = o.getBoundingClientRect();
        if (b.height > 0 && b.width > 0 && b.bottom > maxBottom) maxBottom = b.bottom;
      });
      if (maxBottom > vv.height - 10) {
        var delta = maxBottom - (vv.height - 10);
        var allowed = Math.max(0, active.getBoundingClientRect().top - 8);
        win.scrollBy(0, Math.min(delta, allowed));
      }
    }

    function run() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (aligning) return;
      aligning = true;
      try { align(); } finally { aligning = false; }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      /* 等键盘动画 / 视口稳定；太早量到的 kb 还是 0 */
      timer = setTimeout(function () { timer = 0; run(); }, 120);
    }

    doc.addEventListener('focusin', function (e) {
      if (!isTyping(e.target)) return;
      active = e.target;
      schedule();
      /* iOS 键盘常分两帧收尾，补一次对齐 */
      var el = e.target;
      setTimeout(function () { if (active === el) schedule(); }, 320);
    }, true);

    doc.addEventListener('focusout', function () {
      setTimeout(function () {
        var a = doc.activeElement;
        if (!a || !isTyping(a)) { active = null; if (vv) reset(); }
      }, 180);
    }, true);

    if (vv) {
      vv.addEventListener('resize', function () {
        if (aligning) return;
        if (active) schedule(); else reset();
      });
      vv.addEventListener('scroll', function () {
        if (!aligning && !active) reset();
      }, { passive: true });
    }

    /* iframe 里的输入框可能在我们安装监听之前就已 autofocus，补一次登记，
       否则键盘弹出时 active 为空，上推不会触发（块④ unit 页实测踩到）。 */
    if (isTyping(doc.activeElement)) active = doc.activeElement;
  }

  install(document);
  global.KeyboardFit = { install: install, isTyping: isTyping };
})(window);
