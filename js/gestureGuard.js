/* ============================================================
 * js/gestureGuard.js —— 第八批②：长按 / 文本选择全局拦截
 * ------------------------------------------------------------
 * 目标：消灭手机长按的「打开/复制/全选/翻译」系统菜单与文字选中高亮，
 *       桌面上游戏区右键也不弹系统菜单；但输入框/文本域/可编辑区完全放行。
 *
 * 三层：
 *   1) CSS（见 main.css 末尾）：body 及游戏区禁用 user-select / touch-callout，
 *      输入类元素显式放行；
 *   2) 壳层 document 捕获阶段拦 contextmenu / selectstart，共用 isEditableTarget；
 *   3) 同源 iframe load 后注入同一套样式与拦截脚本；跨域 iframe 只拦外层。
 *
 * 不碰业务手势：只 preventDefault 系统级选择/菜单，不拦截 pointer/touch/click，
 * 所以扫雷长按插旗、2048 滑动、打砖块 swipe 照常工作。
 * ============================================================ */
(function (global) {
  'use strict';

  var EDITABLE_SEL = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

  function isEditableTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.closest && el.closest(EDITABLE_SEL)) return true;
    } catch (_) {}
    return false;
  }

  /* 拦截样式：注入到同源 iframe 的 <head> */
  var GUARD_CSS = [
    'html,body{ -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }',
    'input,textarea,select,[contenteditable]:not([contenteditable="false"]){',
    '  -webkit-user-select:text; user-select:text; -webkit-touch-callout:default; }'
  ].join('\n');

  /* 注入脚本：在 iframe 自己的 document 上拦菜单/选中 */
  var GUARD_JS = [
    '(function(){',
    '  var SEL="input, textarea, select, [contenteditable]:not([contenteditable=\\"false\\"])";',
    '  function edit(el){ if(!el||el.nodeType!==1)return false;',
    '    try{ if(el.closest&&el.closest(SEL))return true; }catch(_){} return false; }',
    '  document.addEventListener("contextmenu",function(e){ if(!edit(e.target))e.preventDefault(); },true);',
    '  document.addEventListener("selectstart",function(e){ if(!edit(e.target))e.preventDefault(); },true);',
    '  try{ if(parent&&parent.WHModal&&parent!==window){',
    '    window.alert=function(m){ parent.WHModal.alert({message:String(m)}); };',
    '  } }catch(_){}',
    '})();'
  ].join('\n');

  function guardDocument(doc) {
    if (!doc || doc.__whGestureGuard) return;
    try {
      if (doc.head) {
        var st = doc.createElement('style');
        st.textContent = GUARD_CSS;
        doc.head.appendChild(st);
      }
      var sc = doc.createElement('script');
      sc.textContent = GUARD_JS;
      (doc.head || doc.documentElement).appendChild(sc);
      doc.__whGestureGuard = true;
      /* 第八批④：同源工具页的虚拟键盘上推，直接装到 iframe 自己的 document */
      if (global.KeyboardFit) global.KeyboardFit.install(doc);
    } catch (_) { /* 跨域 / 特殊文档注入失败：外层拦截仍生效 */ }
  }

  /* 壳层：捕获阶段拦截，输入元素放行 */
  document.addEventListener('contextmenu', function (e) {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  }, true);
  document.addEventListener('selectstart', function (e) {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
  }, true);

  /* 同源 iframe：load 后注入（捕获阶段能收到 iframe 内 load） */
  document.addEventListener('load', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IFRAME') return;
    try { guardDocument(t.contentDocument); } catch (_) { /* 跨域不可读 */ }
  }, true);

  /* 已经存在 / 已加载的 iframe（例如脚本晚于 iframe 注入时） */
  function guardExisting() {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try { guardDocument(frames[i].contentDocument); } catch (_) {}
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guardExisting);
  } else {
    guardExisting();
  }

  global.GestureGuard = { isEditableTarget: isEditableTarget, guardDocument: guardDocument };
})(window);
