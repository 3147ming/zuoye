/* ============================================================
 * weather.js —— 大厅天气（晴 / 雨 / 雾 / 雪）
 * ------------------------------------------------------------
 * 纯视觉，不改玩法与碰撞。默认「跟随季节」：
 *   12/1/2 月多雪，3–5 月多雨，9–11 月多雾，其余晴天。
 * 用户可在设置里固定：跟随季节 / 晴 / 雨 / 雾 / 雪 / 关。
 * 存档 key: worldhub.weather.mode.v1
 * 渲染由 world.js 在昼夜色调之后调用 Weather.render(ctx, t, w, h)。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'worldhub.weather.mode.v1';
  var KINDS = { sunny: 1, rain: 1, snow: 1, fog: 1, off: 1 };
  var NAMES = { sunny: '晴', rain: '雨', snow: '雪', fog: '雾', off: '关' };

  function mode() {
    try {
      var v = global.localStorage.getItem(KEY);
      return KINDS[v] ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  function setMode(m) {
    try { global.localStorage.setItem(KEY, (KINDS[m] || m === 'auto') ? m : 'auto'); } catch (e) {}
  }

  /* 季节权重（确定性，不随机以免每次刷新跳变） */
  function autoKind() {
    var m = new Date().getMonth() + 1;
    if (m === 12 || m === 1 || m === 2) return 'snow';
    if (m >= 3 && m <= 5) return 'rain';
    if (m >= 9 && m <= 11) return 'fog';
    return 'sunny';
  }

  function kind() {
    var m = mode();
    return m === 'auto' ? autoKind() : m;
  }

  function hash(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  var Weather = {
    KINDS: KINDS,
    mode: mode,
    setMode: setMode,
    kind: kind,
    name: function (k) { return NAMES[k || kind()] || ''; },
    describe: function () {
      var m = mode();
      return '天气：' + NAMES[kind()] + (m === 'auto' ? '（跟随季节）' : '（固定）');
    },

    /* 在 world 坐标系里画天气粒子；t 为秒，w/h 为世界宽高 */
    render: function (ctx, t, w, h) {
      var k = kind();
      if (k === 'off' || k === 'sunny') return;

      ctx.save();
      if (k === 'rain') {
        ctx.strokeStyle = 'rgba(190, 210, 235, 0.34)';
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        var n = 90;
        for (var i = 0; i < n; i++) {
          var bx = hash(i) * (w + 200) - 100;
          var by = hash(i + 77) * h;
          var sp = 620 + hash(i + 31) * 260;
          var y = (by + t * sp) % (h + 80) - 40;
          var x = (bx + y * 0.28) % (w + 200) - 100;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 4, y + 22);
          ctx.stroke();
        }
      } else if (k === 'snow') {
        ctx.fillStyle = 'rgba(245, 248, 255, 0.78)';
        var m2 = 74;
        for (var j = 0; j < m2; j++) {
          var sx = hash(j) * w;
          var sy = hash(j + 99) * h;
          var spd = 18 + hash(j + 41) * 34;
          var yy = (sy + t * spd) % (h + 20);
          var xx = sx + Math.sin(t * 0.8 + j) * 14;
          var r = 1.2 + hash(j + 5) * 1.8;
          ctx.beginPath();
          ctx.arc(((xx % w) + w) % w, yy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (k === 'fog') {
        var g1 = ctx.createLinearGradient(0, h * 0.35, 0, h);
        g1.addColorStop(0, 'rgba(200, 205, 215, 0)');
        g1.addColorStop(0.55, 'rgba(200, 205, 215, 0.16)');
        g1.addColorStop(1, 'rgba(200, 205, 215, 0.30)');
        ctx.fillStyle = g1;
        ctx.fillRect(0, 0, w, h);

        for (var b = 0; b < 3; b++) {
          var off = ((t * (6 + b * 4) + b * 300) % (w + 700)) - 350;
          var g2 = ctx.createLinearGradient(off, 0, off + 700, 0);
          g2.addColorStop(0, 'rgba(225, 228, 235, 0)');
          g2.addColorStop(0.5, 'rgba(225, 228, 235, ' + (0.10 + b * 0.03).toFixed(2) + ')');
          g2.addColorStop(1, 'rgba(225, 228, 235, 0)');
          ctx.fillStyle = g2;
          ctx.fillRect(0, h * 0.45 + b * 70, w, 90);
        }
      }
      ctx.restore();
    }
  };

  global.Weather = Weather;
})(window);
