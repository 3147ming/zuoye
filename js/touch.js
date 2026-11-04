/* touch.js —— 手机端触屏适配（第五批②）
 * 原则：桌面零改动、开源游戏文件零改动；一切通过「派发合成键盘事件」复用现有监听。
 * 仅当检测到触屏设备才建 DOM、绑事件；桌面浏览器整模块直接 return。
 * 键位表中的 keyCode 为逐款游戏源码实测（见交付报告「探测结论」）。
 */
(function (global) {
  'use strict';

  var TOUCH = ('ontouchstart' in global) ||
              (navigator.maxTouchPoints > 0) ||
              (global.matchMedia && global.matchMedia('(pointer: coarse)').matches);
  if (!TOUCH) return;   // 桌面零影响

  /* 一个按键的描述：label 显示文字，code/key 给 KeyboardEvent，keyCode 是游戏真正读的值 */
  function K(label, code, key, keyCode, side) {
    return { label: label, code: code, key: key, keyCode: keyCode, side: side || 'L' };
  }

  /* 各游戏按 data-scene（= 'iframe-' + ITEMS.name）反查配置。
     side: 'L' 落在左下方向组，'R' 落在右下动作组。 */
  var GAMES = {
    /* 脑力街机（跨域 https 直达）：游戏自带触屏控制，WorldHub 不派发任何按键 */
    'iframe-贪吃蛇': { cross: true },
    'iframe-飞扬的小鸟': { cross: true },
    'iframe-别踩白块儿': { cross: true },
    'iframe-飞机大战': { cross: true },
    'iframe-泡泡龙': { cross: true },
    'iframe-乒乓': { cross: true },
    /* 本地开源门（同源）：派发合成键盘事件 */
    'iframe-俄罗斯方块': { keys: [
      K('←', 'ArrowLeft', 'ArrowLeft', 37, 'L'), K('→', 'ArrowRight', 'ArrowRight', 39, 'L'),
      K('↻', 'ArrowUp', 'ArrowUp', 38, 'R'), K('▼', 'ArrowDown', 'ArrowDown', 40, 'R')
    ] },
    'iframe-格斗': { keys: [
      /* 左组：移动 + 跳跃/下蹲（标签 A/D/W/S，映射到本体 P1 的 G/J/Y/H）
         P1 = Sub-Zero，其移动键是 G(71)/J(74)/Y(89)/H(72)；箭头键是 P2(Kano) 的，别派发错。 */
      K('A', 'KeyG', 'g', 71, 'L'), K('D', 'KeyJ', 'j', 74, 'L'),
      K('W', 'KeyY', 'y', 89, 'L'), K('S', 'KeyH', 'h', 72, 'L'),
      /* 右组：攻击 + 防御（标签 J/K/L/SHIFT，映射到本体 P1 的 A/D/F/Shift） */
      K('J', 'KeyA', 'a', 65, 'R'), K('K', 'KeyD', 'd', 68, 'R'),
      K('L', 'KeyF', 'f', 70, 'R'), K('SHIFT', 'ShiftLeft', 'Shift', 16, 'R')
    ], note: '双人对战建议电脑端' },
    'iframe-打砖块': { swipe: true, keys: [ K('开球', 'Space', ' ', 32, 'R') ] }
    /* 其余（2048 / 五子棋 / 扫雷 / 白噪音 / 番茄钟）：原生触摸即可，只保留返回键 */
  };

  /* 大厅：左下双方向 + 右下 跳 / E */
  var HALL = [
    K('◀', 'ArrowLeft', 'ArrowLeft', 37, 'L'), K('▶', 'ArrowRight', 'ArrowRight', 39, 'L'),
    K('跳', 'Space', ' ', 32, 'R'), K('E', 'KeyE', 'e', 69, 'R')
  ];

  function sceneName() { return (document.body && document.body.dataset && document.body.dataset.scene) || ''; }
  function iframeDoc() {
    /* iframeScene.js 给 <iframe> 本身挂了 class="iframe-scene"，没有外层容器 */
    var f = document.querySelector('iframe.iframe-scene');
    return (f && f.contentDocument) ? f.contentDocument : null;
  }

  /* 派发一个合成键。keyCode 在部分浏览器是只读的，用 defineProperty 强制覆盖，确保游戏读到正确值。 */
  function fire(target, code, key, keyCode, type) {
    if (!target) return;
    var ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, code: code, key: key, keyCode: keyCode, which: keyCode });
    try { Object.defineProperty(ev, 'keyCode', { get: function () { return keyCode; } }); } catch (_) {}
    try { Object.defineProperty(ev, 'which', { get: function () { return keyCode; } }); } catch (_) {}
    target.dispatchEvent(ev);
  }

  /* ---- DOM 骨架 ---- */
  var stage = document.querySelector('.stage') || document.body;
  var root = document.createElement('div');
  root.className = 'touch-ui';
  stage.appendChild(root);

  var btnBack = document.createElement('button');
  btnBack.type = 'button'; btnBack.className = 'tbtn t-back';
  btnBack.textContent = '⤾'; btnBack.setAttribute('aria-label', '返回');
  root.appendChild(btnBack);

  var grpL = document.createElement('div'); grpL.className = 't-grp t-grp-l';
  var grpR = document.createElement('div'); grpR.className = 't-grp t-grp-r';
  var pad = document.createElement('div'); pad.className = 't-pad';
  pad.appendChild(grpL); pad.appendChild(grpR);
  root.appendChild(pad);

  var swipe = document.createElement('div'); swipe.className = 't-swipe';   // 仅打砖块挂载
  var hint = document.createElement('div'); hint.className = 'rotate-hint';
  hint.textContent = '建议横屏获得最佳体验';
  root.appendChild(hint);

  var crossHint = document.createElement('div'); crossHint.className = 't-cross-hint';
  crossHint.textContent = '本游戏支持触屏直接操作';
  crossHint.style.display = 'none';
  root.appendChild(crossHint);

  /* 按住态：每项是 { btn, code, key, keyCode, target } */
  var held = [];
  function releaseAll() {
    for (var i = held.length - 1; i >= 0; i--) {
      var h = held[i];
      fire(h.target, h.code, h.key, h.keyCode, 'keyup');
      held.splice(i, 1);
    }
  }

  function bindHold(btn, k, getTarget) {
    var h = { btn: btn, code: k.code, key: k.key, keyCode: k.keyCode, target: null };
    var down = function (e) {
      e.preventDefault();
      if (held.indexOf(h) >= 0) return;
      h.target = getTarget();
      held.push(h);
      fire(h.target, k.code, k.key, k.keyCode, 'keydown');
      btn.classList.add('pressed');
    };
    var up = function (e) {
      e.preventDefault();
      var idx = held.indexOf(h);
      if (idx >= 0) { held.splice(idx, 1); fire(h.target, k.code, k.key, k.keyCode, 'keyup'); }
      btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  function buildKeys(list, getTarget) {
    grpL.innerHTML = ''; grpR.innerHTML = '';
    grpL.classList.remove('t-grid'); grpR.classList.remove('t-grid');
    for (var i = 0; i < list.length; i++) {
      var k = list[i];
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tbtn';
      b.textContent = k.label; b.setAttribute('aria-label', k.label);
      (k.side === 'R' ? grpR : grpL).appendChild(b);
      bindHold(b, k, getTarget);
    }
    /* 单侧 4 键（如格斗 A/D/W/S 与 J/K/L/SHIFT）→ 2×2 网格，避免竖屏一排互相重叠 */
    if (grpL.children.length === 4) grpL.classList.add('t-grid');
    if (grpR.children.length === 4) grpR.classList.add('t-grid');
  }

  /* 打砖块：手指在场上左右半屏 → 按住对应方向键；开球按钮单独发 Space */
  var swipeDir = 0;
  function setSwipe(dir) {
    if (dir === swipeDir) return;
    var doc = iframeDoc();
    if (swipeDir === 37) fire(doc, 'ArrowLeft', 'ArrowLeft', 37, 'keyup');
    if (swipeDir === 39) fire(doc, 'ArrowRight', 'ArrowRight', 39, 'keyup');
    swipeDir = dir;
    if (dir === 37) fire(doc, 'ArrowLeft', 'ArrowLeft', 37, 'keydown');
    if (dir === 39) fire(doc, 'ArrowRight', 'ArrowRight', 39, 'keydown');
  }
  function bindSwipe() {
    var down = function (e) { e.preventDefault(); setSwipe(e.clientX < global.innerWidth / 2 ? 37 : 39); };
    var move = function (e) { setSwipe(e.clientX < global.innerWidth / 2 ? 37 : 39); };
    var up = function () { setSwipe(0); };
    swipe.addEventListener('pointerdown', down);
    swipe.addEventListener('pointermove', move);
    swipe.addEventListener('pointerup', up);
    swipe.addEventListener('pointercancel', up);
  }

  /* 场景切换：重建按键集 + 释放旧场景残留键 */
  var curScene = '__init__';
  function rebuild() {
    var sc = sceneName();
    if (swipe.parentNode) swipe.parentNode.removeChild(swipe);
    if (sc === curScene) return;
    curScene = sc;
    releaseAll();
    swipeDir = 0;
    crossHint.style.display = 'none';

    if (sc.indexOf('iframe-') !== 0) {
      buildKeys(HALL, function () { return global; });
      pad.style.display = '';
      return;
    }
    var cfg = GAMES[sc];
    if (cfg && cfg.cross) {
      /* 跨域脑力街机：游戏自带触屏，只保留返回键，提示直接操作 */
      grpL.innerHTML = ''; grpR.innerHTML = '';
      pad.style.display = 'none';
      crossHint.style.display = '';
    } else if (cfg && cfg.swipe) {
      buildKeys(cfg.keys, iframeDoc);
      root.appendChild(swipe);
      bindSwipe();
      pad.style.display = '';
    } else if (cfg) {
      buildKeys(cfg.keys, iframeDoc);
      pad.style.display = '';
    } else {
      grpL.innerHTML = ''; grpR.innerHTML = '';   // 原生触摸游戏：仅返回
      pad.style.display = 'none';
    }
  }

  /* 返回键：发 Escape（大厅关面板 / iframe 回大厅，iframeScene 已监听） */
  btnBack.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    fire(global, 'Escape', 'Escape', 27, 'keydown');
    fire(global, 'Escape', 'Escape', 27, 'keyup');
  });

  /* 监听场景名变化；MutationObserver 不可用时退化为轮询 */
  if (global.MutationObserver) {
    new MutationObserver(rebuild).observe(document.body, { attributes: true, attributeFilter: ['data-scene'] });
  } else {
    setInterval(rebuild, 250);
  }
  rebuild();

  /* 横屏提示：竖屏 + 触屏才显示 */
  function updateRotate() {
    var portrait = global.matchMedia && global.matchMedia('(orientation: portrait)').matches;
    hint.style.display = portrait ? 'block' : 'none';
  }
  if (global.matchMedia) {
    var mq = global.matchMedia('(orientation: portrait)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(updateRotate);
  }
  updateRotate();

  global.WorldTouch = { rebuild: rebuild, releaseAll: releaseAll };
})(window);
