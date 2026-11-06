/* ============================================================
 * gamepad.js —— 手柄支持（第八批·新玩法⑧）
 * ------------------------------------------------------------
 * 轮询标准 Gamepad API：
 *   左摇杆 / 十字键 左右 → 大厅移动；A(0) / X(2) → 跳跃；
 *   Start(9) → 设置；Back(8)/B(1) → 关闭浮层；
 *   RB(5)/RT 未用。
 * 有震动器的控制器在传送 / 落锤音效时轻震一下。
 * 手柄完全不存在时本模块零开销（找不到即停止轮询）。
 * ============================================================ */
(function (global) {
  'use strict';

  var DPAD_LEFT = 14, DPAD_RIGHT = 15, DPAD_UP = 12, DPAD_DOWN = 13;
  var BTN_A = 0, BTN_B = 1, BTN_X = 2, BTN_START = 9, BTN_BACK = 8;
  var AX_STICK = 0, AX_TRIGGER_R = 2;

  var seen = 0;                 /* 连续找不到手柄的帧数，太久就停轮询 */
  var prevPressed = {};         /* 边缘检测：记录上一帧按住的按钮 */
  var lastAxis = 0;

  function press(pad, index, ms, weak, strong) {
    try {
      var act = pad.vibrationActuator;
      if (act && act.playEffect) {
        act.playEffect('dual-rumble', {
          duration: ms, strongMagnitude: strong || 0, weakMagnitude: weak || 0
        });
      } else if (pad.hapticActuators && pad.hapticActuators[0]) {
        pad.hapticActuators[0].pulse(strong || 0.5, ms);
      }
    } catch (e) { /* 不支持震动就安静 */ }
  }

  /* 音效触发轻震：传送重、跳跃轻 */
  function armRumble() {
    if (!global.Audio || typeof global.Audio.play !== 'function') return;
    var orig = global.Audio.play;
    global.Audio.play = function (name) {
      orig.apply(this, arguments);
      if (name === 'portal' || name === 'ult' || name === 'kick') {
        rumbleActive(90, 0.7, 0.4);
      }
    };
  }
  function rumbleActive(ms, strong, weak) {
    var pads = getPads();
    for (var i = 0; i < pads.length; i++) if (pads[i]) { press(pads[i], 0, ms, weak, strong); return; }
  }

  function getPads() {
    try {
      var f = navigator.getGamepads ? navigator.getGamepads() : [];
      return Array.prototype.slice.call(f || []);
    } catch (e) { return []; }
  }

  function edge(pads, i) {
    var p = pads[i];
    return p && p.pressed && !prevPressed[i];
  }

  var frame = function () {
    global.requestAnimationFrame(frame);

    var pads = getPads();
    var pad = null;
    for (var i = 0; i < pads.length; i++) if (pads[i]) { pad = pads[i]; break; }

    if (!pad) {
      if (++seen > 120) return;        /* 两秒没手柄：停轮询省资源 */
      lastAxis = 0;
      return;
    }
    seen = 0;

    var buttons = pad.buttons || [];
    var axes = pad.axes || [];
    var ax = Math.abs(axes[AX_STICK]) > 0.25 ? axes[AX_STICK] : 0;

    var left = ax < -0.25 || (buttons[DPAD_LEFT] && buttons[DPAD_LEFT].pressed);
    var right = ax > 0.25 || (buttons[DPAD_RIGHT] && buttons[DPAD_RIGHT].pressed);

    /* 跳跃：A 或 X 刚按下 */
    var jumpEdge = edge(buttons, BTN_A) || edge(buttons, BTN_X);
    var jumpDown = (buttons[BTN_A] && buttons[BTN_A].pressed) || (buttons[BTN_X] && buttons[BTN_X].pressed);

    /* 交互：RT 半按下当 E（跳跃优先用 A，E 留给触发键，避免误跳） */
    var trigger = Math.abs(axes[AX_TRIGGER_R]) > 0.3;
    var interactEdge = trigger && !prevPressed.rt;

    var sEdge = edge(buttons, BTN_START);
    var backEdge = edge(buttons, BTN_BACK) || edge(buttons, BTN_B);

    /* 写回大厅 Input（模块没加载就什么都不做） */
    var In = global.Input;
    if (In && In.state) {
      if (typeof In.setDir === 'function') In.setDir(left, right);
      if (jumpEdge && typeof In.pressJump === 'function') In.pressJump();
      if (!jumpDown && In.state.jump) In.state.jump = false;
    }

    /* E / 开设置 / Esc：派发合成键盘事件，复用全部现有监听
       目标用 document：GatePanel / Settings 挂在 document 捕获阶段（同 touch.js） */
    function fire(code, key) {
      var ev = new global.KeyboardEvent('keydown', { bubbles: true, code: code, key: key });
      document.dispatchEvent(ev);
      var up = new global.KeyboardEvent('keyup', { bubbles: true, code: code, key: key });
      document.dispatchEvent(up);
    }
    if (interactEdge) fire('KeyE', 'e');
    if (sEdge) fire('KeyO', 'o');
    if (backEdge) fire('Escape', 'Escape');

    /* 记录边缘状态 */
    prevPressed.rt = trigger;
    for (var j = 0; j < buttons.length; j++) prevPressed[j] = buttons[j] && buttons[j].pressed;
  };

  if (navigator.getGamepads) {
    global.addEventListener('gamepadconnected', function () { seen = 0; });
    global.addEventListener('gamepaddisconnected', function () { lastAxis = 0; });
    armRumble();
    global.requestAnimationFrame(frame);
  }
})(window);
