/* ============================================================
 * world.js —— 世界大厅（区块化横版地图）
 * ------------------------------------------------------------
 * 场景接口：init(ctx) / update(dt) / render(ctx) / destroy()
 *
 * 第四批改造：
 *   1) 不再是单张 2800 像素的卷轴，而是「一屏一个区块」（1280×720 本地坐标）。
 *      走 A/D 到屏幕左右边缘会自动切到相邻区块，摄像机固定、不再滚动。
 *   2) 区块表 ZONES 全数据化：加一个区块 = 往数组里加一段配置。
 *      顺序：noise → pomodoro → plaza → snake → game2048 → tetris → fight
 *            → mine → gomoku → breakout
 *   3) 门不再是「走近就切」，改成「站到门前提示，按 E 进入」；
 *      进入后由 js/iframeScene.js 用 iframe 加载 games/ 或 tools/ 下的开源页面。
 *   4) 画面语言不变：剪纸黄昏 —— 分层剪影 + 背光暖边 + 纸纹 + mulberry32 确定性生成。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var VIEW_W = 1280;
  var VIEW_H = 720;
  var GROUND_Y = 566;

  /* 走到这个范围外就切区块；回来时从另一侧 40 / 1240 进入 */
  var EDGE_L = 40;
  var EDGE_R = 1240;
  var DOOR_HIT = 62;

  var NPC_X = 470;
  var NPC_RANGE = 80;

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  /* ---------------- 工具 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* k < 1 压暗、k > 1 提亮，用来按 themeSeed 做「同主题不同区块」的轻微色偏 */
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp(Math.round(((n >> 16) & 255) * k), 0, 255);
    var g = clamp(Math.round(((n >> 8) & 255) * k), 0, 255);
    var b = clamp(Math.round((n & 255) * k), 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* 拱门：直边 + 顶部半圆 */
  function archPath(ctx, x, y, w, h) {
    var r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  /* 白色径向光斑，按需着色后作为 sprite 复用（比逐帧建渐变便宜得多） */
  function makeGlow(color, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var r = size / 2;
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, rgba(color, 0.90));
    grd.addColorStop(0.32, rgba(color, 0.38));
    grd.addColorStop(0.66, rgba(color, 0.11));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /* ============================================================
   * 1. 区块配置表
   * ------------------------------------------------------------
   * side: left（工具区）/ center（出生广场）/ right（游戏区）
   * themeSeed: 决定这一屏的山脊、树、路灯、天色偏移，同 seed 永远同一张图
   * doors: 目前每区块一门；要加门就往 doors 里多写一个对象（x 会自动按 side 排）
   * ============================================================ */
  var ZONES = [
    {
      id: 'noise', side: 'left', title: '白噪音', themeSeed: 1103,
      doors: [{
        id: 'noise', name: '白噪音', src: 'tools/noise/index.html',
        color: '#7fd8c8', glyph: 'noise', desc: '棕噪音 · 计时 · 便签'
      }]
    },
    {
      id: 'pomodoro', side: 'left', title: '番茄钟', themeSeed: 1104,
      doors: [{
        id: 'pomodoro', name: '番茄钟', src: 'tools/pomodoro/index.html',
        color: '#f07167', glyph: 'pomodoro', desc: '专注计时 · 陪伴小猫'
      }]
    },
    {
      id: 'plaza', side: 'center', title: '中心广场', themeSeed: 0, doors: []
    },
    {
      id: 'snake', side: 'right', title: '贪吃蛇', themeSeed: 1105,
      doors: [{
        id: 'snake', name: '贪吃蛇', src: 'games/snake/index.html',
        color: '#5fd39a', glyph: 'snake', desc: '经典蛇 · 越吃越快'
      }]
    },
    {
      id: 'game2048', side: 'right', title: '2048', themeSeed: 1106,
      doors: [{
        id: 'game2048', name: '2048', src: 'games/game2048/index.html',
        color: '#f2cc60', glyph: 'n2048', desc: '数字合璧'
      }]
    },
    {
      id: 'tetris', side: 'right', title: '俄罗斯方块', themeSeed: 1107,
      doors: [{
        id: 'tetris', name: '俄罗斯方块', src: 'games/tetris/index.html',
        color: '#9b8afb', glyph: 'tetris', desc: '方块下落 · 消行'
      }]
    },
    {
      id: 'fight', side: 'right', title: '格斗', themeSeed: 1108,
      doors: [{
        id: 'fight', name: '格斗', src: 'games/fight/index.html',
        color: '#e8545f', glyph: 'fight', desc: '本地双人 · 出招掉血'
      }]
    },
    {
      id: 'mine', side: 'right', title: '扫雷', themeSeed: 1109,
      doors: [{
        id: 'mine', name: '扫雷', src: 'games/mine/index.html',
        color: '#6fc2ef', glyph: 'mine', desc: '翻格子 · 插旗'
      }]
    },
    {
      id: 'gomoku', side: 'right', title: '五子棋', themeSeed: 1110,
      doors: [{
        id: 'gomoku', name: '五子棋', src: 'games/gomoku/index.html',
        color: '#e8b45a', glyph: 'gomoku', desc: '人机对弈 · 五连'
      }]
    },
    {
      id: 'breakout', side: 'right', title: '打砖块', themeSeed: 1111,
      doors: [{
        id: 'breakout', name: '打砖块', src: 'games/breakout/index.html',
        color: '#f2a0c0', glyph: 'breakout', desc: '反弹消砖 · 逐关'
      }]
    }
  ];

  var PLAZA_IDX = 2;
  var SIDE_NAME = { left: '工具区', right: '游戏区', center: '中心广场' };

  /* 门在区块里的横向位置：右侧区块放 960（留出往回走的空间），左侧放 320 */
  (function layoutZones() {
    for (var i = 0; i < ZONES.length; i++) {
      var z = ZONES[i];
      z.doors.forEach(function (d) {
        d.x = z.side === 'left' ? 320 : (z.side === 'right' ? 960 : 640);
        d.w = 104;
        d.h = 190;
      });
    }
  }());

  /* 三套配色：广场黄昏橙、工具区偏青绿、游戏区偏紫蓝 */
  var THEME = {
    left: {
      sky: ['#03121a', '#082530', '#0f3a42', '#1c5750', '#3b7d6b', '#7cb79b'],
      ridge: [
        { c: '#1b3a3c', rim: 'rgba(122, 186, 166, 0.50)' },
        { c: '#15302f', rim: 'rgba(96, 154, 138, 0.40)' },
        { c: '#0f2624', rim: 'rgba(76, 128, 114, 0.34)' },
        { c: '#081715', rim: 'rgba(58, 102, 90, 0.30)' }
      ],
      tree: ['#0c201f', '#061312'],
      grass: '#04100f',
      road: '#12211f',
      roadDark: '#07100f',
      edge: 'rgba(150, 220, 190, 0.58)',
      mist: 'rgba(96, 168, 148, 0.10)'
    },
    center: {
      sky: ['#0a0c1e', '#1a1634', '#372244', '#65334a', '#a05940', '#dd9a5f'],
      ridge: [
        { c: '#3b3059', rim: 'rgba(122, 100, 158, 0.55)' },
        { c: '#2f2749', rim: 'rgba(96, 80, 130, 0.45)' },
        { c: '#241d3b', rim: 'rgba(74, 62, 105, 0.40)' },
        { c: '#171325', rim: 'rgba(58, 49, 80, 0.40)' }
      ],
      tree: ['#1d1733', '#120f1e'],
      grass: '#0a0713',
      road: '#1a1527',
      roadDark: '#0c0916',
      edge: 'rgba(240, 167, 110, 0.62)',
      mist: 'rgba(146, 112, 114, 0.11)'
    },
    right: {
      sky: ['#06081d', '#141140', '#28205a', '#44296a', '#6d4278', '#a2668e'],
      ridge: [
        { c: '#2b2454', rim: 'rgba(150, 118, 190, 0.52)' },
        { c: '#221c46', rim: 'rgba(126, 98, 164, 0.44)' },
        { c: '#191436', rim: 'rgba(100, 78, 136, 0.40)' },
        { c: '#100e26', rim: 'rgba(78, 60, 110, 0.36)' }
      ],
      tree: ['#191335', '#0e0b1f'],
      grass: '#080613',
      road: '#1b1630',
      roadDark: '#0b0918',
      edge: 'rgba(196, 150, 220, 0.55)',
      mist: 'rgba(130, 100, 156, 0.12)'
    }
  };

  /* 帮助面板内容：必须和真实键位逐字一致，改键位请同步改这里 */
  var HELP_ROWS = [
    ['大厅', 'A / D 移动 · 空格 跳跃 · E 进门 / 对话 · H 帮助'],
    ['换区块', '走到画面最左 / 最右边缘自动换区块'],
    ['进门', '站到门前，提示条出现「按 E 进入」时按 E'],
    ['游戏 / 工具', '右上角「← 返回大厅」按钮，或按 Esc 回大厅'],
    ['工具区', '左侧两屏：白噪音（最左）· 番茄钟'],
    ['游戏区', '右侧七屏：贪吃蛇 / 2048 / 俄罗斯方块 / 格斗 / 扫雷 / 五子棋 / 打砖块'],
    ['通用', 'Esc 回大厅 · H 关掉这块面板']
  ];

  /* ---------------- 静态图层：纸纹 / 暗角 ---------------- */
  function buildGrain() {
    var s = 128;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var img = g.createImageData(s, s);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 8 + ((Math.random() * 16) | 0);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function buildVignette() {
    var c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(VIEW_W * 0.5, VIEW_H * 0.48, VIEW_H * 0.32,
                                     VIEW_W * 0.5, VIEW_H * 0.5, VIEW_H * 0.95);
    grd.addColorStop(0, 'rgba(6, 4, 12, 0)');
    grd.addColorStop(0.72, 'rgba(6, 4, 12, 0.20)');
    grd.addColorStop(1, 'rgba(4, 3, 8, 0.64)');
    g.fillStyle = grd;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    return c;
  }

  /* ---------------- 山脊 / 装饰件 ---------------- */
  function makeRidge(rng, width, baseY, amp, minStep, maxStep) {
    var pts = [{ x: -260, y: baseY }];
    var x = -200;
    var y = baseY;
    while (x < width + 260) {
      x += minStep + rng() * (maxStep - minStep);
      var t = rng();
      if (t < 0.22) y = baseY - amp * (0.02 + rng() * 0.1);
      else y = baseY - amp * (0.28 + rng() * 0.72);
      pts.push({ x: x, y: y });
    }
    pts.push({ x: width + 300, y: baseY });
    return pts;
  }

  function traceTop(ctx, pts, smooth) {
    var i, last;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (smooth) {
      for (i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(
          pts[i].x, pts[i].y,
          (pts[i].x + pts[i + 1].x) / 2,
          (pts[i].y + pts[i + 1].y) / 2
        );
      }
      last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    } else {
      for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }
  }

  function drawRidge(ctx, pts, color, rim, bottom, smooth) {
    ctx.beginPath();
    traceTop(ctx, pts, smooth);
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    traceTop(ctx, pts, smooth);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function drawPine(ctx, x, baseY, h, w, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 3; i++) {
      var by = baseY - h * i * 0.22;
      var ww = w * (1 - i * 0.22);
      var top = by - h * 0.46;
      ctx.moveTo(x, top);
      ctx.lineTo(x + ww / 2, by);
      ctx.lineTo(x - ww / 2, by);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillRect(x - 1.6, baseY - h * 0.2, 3.2, h * 0.2 + 3);
  }

  function drawGrass(ctx, x, y, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 2, y - h * 0.6, x - 5, y - h);
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 1, y - h * 0.7, x + 3, y - h * 1.08);
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y - h * 0.5, x + 8, y - h * 0.78);
    ctx.stroke();
  }

  function drawLamp(ctx, x, baseY, h) {
    ctx.fillStyle = '#0c0916';
    ctx.fillRect(x - 2, baseY - h, 4, h);
    ctx.beginPath();
    ctx.moveTo(x - 13, baseY - h + 2);
    ctx.lineTo(x + 13, baseY - h + 2);
    ctx.lineTo(x + 8, baseY - h - 20);
    ctx.lineTo(x - 8, baseY - h - 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 158, 0.95)';
    ctx.beginPath();
    ctx.moveTo(x - 8, baseY - h + 1);
    ctx.lineTo(x + 8, baseY - h + 1);
    ctx.lineTo(x + 5, baseY - h - 15);
    ctx.lineTo(x - 5, baseY - h - 15);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- 门里的图腾（九种） ---------------- */
  function drawGlyph(ctx, kind, cx, cy, t) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, a, x, y;

    if (kind === 'snake') {
      var px = [], py = [];
      for (i = 0; i < 7; i++) {
        a = i * 0.85 + t * 0.9;
        px.push(cx + Math.sin(a) * 15);
        py.push(cy - 30 + i * 9.5);
      }
      ctx.beginPath();
      ctx.moveTo(px[0], py[0]);
      for (i = 1; i < px.length; i++) ctx.lineTo(px[i], py[i]);
      ctx.stroke();
      for (i = 0; i < px.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(px[i], py[i], 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(px[6], py[6], 5.2, 0, Math.PI * 2);
      ctx.fill();

    } else if (kind === 'n2048') {
      /* 四块数字砖：2 0 4 8 */
      var nums = ['2', '0', '4', '8'];
      ctx.font = '600 17px ' + SANS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (i = 0; i < 4; i++) {
        x = cx + (i % 2 ? 13 : -13);
        y = cy + (i < 2 ? -13 : 13);
        roundRect(ctx, x - 11, y - 11, 22, 22, 5);
        ctx.stroke();
        ctx.fillText(nums[i], x, y + 1);
      }

    } else if (kind === 'tetris') {
      /* 一个 S 形 + 一个方块，凑成「下落」的感觉 */
      var blocks = [[-18, -18], [-18, 0], [0, 0], [0, 18], [18, 18], [18, 36],
                    [18, -12], [36, -12], [36, 6], [54, 6]];
      for (i = 0; i < blocks.length; i++) {
        roundRect(ctx, cx - 26 + blocks[i][0], cy - 26 + blocks[i][1], 15, 15, 2.5);
        ctx.stroke();
      }

    } else if (kind === 'fight') {
      for (i = 0; i < 2; i++) {
        var s = i === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx - s * 20, cy + 22);
        ctx.lineTo(cx + s * 16, cy - 24);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + s * 10, cy - 14);
        ctx.lineTo(cx + s * 20, cy - 4 + s * 4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();

    } else if (kind === 'mine') {
      /* 8×8 小网格 + 一颗雷 */
      ctx.lineWidth = 1.1;
      for (i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy - 24 + i * 12);
        ctx.lineTo(cx + 6, cy - 24 + i * 12);
        ctx.moveTo(cx - 30 + i * 9, cy - 24);
        ctx.lineTo(cx - 30 + i * 9, cy + 24);
        ctx.stroke();
      }
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx + 22, cy + 4, 9, 0, Math.PI * 2);
      ctx.stroke();
      for (i = 0; i < 8; i++) {
        a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx + 22 + Math.cos(a) * 9, cy + 4 + Math.sin(a) * 9);
        ctx.lineTo(cx + 22 + Math.cos(a) * 14, cy + 4 + Math.sin(a) * 14);
        ctx.stroke();
      }

    } else if (kind === 'gomoku') {
      /* 斜着五连 */
      ctx.lineWidth = 1;
      for (i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 30 + i * 20, cy - 30);
        ctx.lineTo(cx - 30 + i * 20, cy + 30);
        ctx.moveTo(cx - 30, cy - 30 + i * 20);
        ctx.lineTo(cx + 30, cy - 30 + i * 20);
        ctx.stroke();
      }
      ctx.lineWidth = 1.8;
      for (i = 0; i < 5; i++) {
        x = cx - 20 + i * 10;
        y = cy + 20 - i * 10;
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        if (i % 2 === 0) ctx.fill(); else ctx.stroke();
      }

    } else if (kind === 'breakout') {
      /* 三块砖 + 挡板 + 球 */
      for (i = 0; i < 3; i++) {
        roundRect(ctx, cx - 28 + i * 20, cy - 26, 17, 10, 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx + 8, cy + 0, 5, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, cx - 22, cy + 22, 40, 8, 4);
      ctx.stroke();

    } else if (kind === 'noise') {
      /* 一段振幅渐变的波形 */
      ctx.beginPath();
      for (i = 0; i <= 40; i++) {
        x = cx - 30 + i * 1.5;
        var amp = 6 + Math.sin(i * 0.42 + t * 1.6) * 4 + Math.sin(i * 0.13) * 3;
        y = cy + Math.sin(i * 0.62 + t * 2.2) * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 30, cy);
      ctx.lineTo(cx + 30, cy);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
      ctx.stroke();

    } else {
      /* pomodoro：番茄 + 指针 */
      ctx.beginPath();
      ctx.arc(cx, cy + 4, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 18);
      ctx.quadraticCurveTo(cx, cy - 28, cx + 8, cy - 19);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx, cy - 8);
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx + 9, cy + 7);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ============================================================
   * WorldScene
   * ============================================================ */
  function WorldScene() {
    this.t = 0;
    this.ctx = null;

    this.zoneIdx = PLAZA_IDX;
    this.zone = ZONES[PLAZA_IDX];

    this.player = null;
    this.npc = null;
    this.near = null;
    this.npcNear = false;

    this._onKey = null;
    this._onClick = null;

    /* 开场标题卡（2.5s，可跳过）与帮助面板 */
    this.intro = 0;
    this.help = false;
    this.veil = 0;        /* 切区块时的一层快速淡光 */
    this.zoneT = 0;       /* 区块标题在提示条上停留的时间 */
    this.edgeT = 0;       /* 「已到尽头」提示保持时间 */
    this.edgeLockL = false;
    this.edgeLockR = false;

    /* 用来判断「起跳 / 落地」这一对事件，player 自己不出声 */
    this.prevGround = true;
    this.prevVy = 0;

    this.stars = [];
    this.motes = [];
    this.lamps = [];
    this.trees = [];

    this.bg = null;              /* 当前区块预渲染的整张背景 */
    this.bgZone = '';            /* 已经烘焙的是哪个区块 */
    this.grain = null;
    this.vignette = null;
    this.grainPattern = null;
    this.lampGlow = null;

    this.groundY = GROUND_Y;
    this.fgPhase = 0;
    this.hueK = 1;
  }

  /* ---------------- 区块 ---------------- */
  WorldScene.prototype.setZone = function (idx, opts) {
    opts = opts || {};
    this.zoneIdx = clamp(idx, 0, ZONES.length - 1);
    this.zone = ZONES[this.zoneIdx];

    var seed = this.zone.themeSeed || 1;
    /* 同主题（左/中/右）之间再按 seed 做 ±6% 的明度偏移，让每一屏都不完全一样 */
    this.hueK = 1 + (((seed % 7) - 3) * 0.02);

    if (!opts.keepBg) this.bakeBg();
  };

  /* 预渲染整张背景：天色 / 星 / 山脊 / 林 / 雾 / 地面 —— 逐帧只做一次 drawImage */
  WorldScene.prototype.bakeBg = function () {
    var z = this.zone;
    var theme = THEME[z.side] || THEME.center;
    var rng = mulberry32(z.themeSeed || 1);
    var k = this.hueK;
    var i;

    if (!this.bg) {
      this.bg = document.createElement('canvas');
      this.bg.width = VIEW_W;
      this.bg.height = VIEW_H;
    }
    var g = this.bg.getContext('2d');
    g.clearRect(0, 0, VIEW_W, VIEW_H);

    /* --- 天空 --- */
    var sky = g.createLinearGradient(0, 0, 0, GROUND_Y);
    var stops = [0, 0.24, 0.46, 0.66, 0.83, 1];
    for (i = 0; i < stops.length; i++) {
      sky.addColorStop(stops[i], shade(theme.sky[i], k));
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, GROUND_Y);

    /* --- 太阳（位置随区块确定性偏移） --- */
    var sx = z.side === 'left' ? 240 + rng() * 160 : (z.side === 'right' ? 940 + rng() * 140 : 940 + rng() * 100);
    var sy = 300 + rng() * 80;
    var sr = 58 + rng() * 18;
    var halo = g.createRadialGradient(sx, sy, sr * 0.7, sx, sy, sr * 5.2);
    halo.addColorStop(0, 'rgba(255, 205, 145, 0.30)');
    halo.addColorStop(0.42, 'rgba(255, 165, 100, 0.11)');
    halo.addColorStop(1, 'rgba(255, 140, 80, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, VIEW_W, GROUND_Y);

    g.beginPath();
    g.arc(sx, sy, sr, 0, Math.PI * 2);
    var disc = g.createLinearGradient(0, sy - sr, 0, sy + sr);
    disc.addColorStop(0, '#ffefd0');
    disc.addColorStop(0.55, '#ffd09a');
    disc.addColorStop(1, '#f0a066');
    g.fillStyle = disc;
    g.fill();

    /* --- 剪纸云带 --- */
    if ('filter' in g) g.filter = 'blur(5px)';
    for (i = 0; i < 5; i++) {
      var bw = 180 + rng() * 300;
      var bx = rng() * (VIEW_W - bw);
      var by = 150 + rng() * 240;
      g.fillStyle = 'rgba(255, 222, 180, ' + (0.05 + rng() * 0.045).toFixed(3) + ')';
      roundRect(g, bx, by, bw, 6 + rng() * 5, 5);
      g.fill();
    }
    if ('filter' in g) g.filter = 'none';

    /* --- 星 --- */
    this.stars.length = 0;
    for (i = 0; i < 56; i++) {
      this.stars.push({
        x: rng() * VIEW_W,
        y: 20 + rng() * 200,
        r: 0.6 + rng() * 1.5,
        p: rng() * Math.PI * 2,
        s: 0.5 + rng() * 1.4
      });
    }

    /* --- 山脊：远景到近景 --- */
    var ridgeBase = [470, 508, 540, 560];
    var ridgeAmp = [176, 140, 92, 58];
    for (i = 0; i < 4; i++) {
      var pts = makeRidge(rng, VIEW_W, ridgeBase[i], ridgeAmp[i], 110 + i * 4, 190 + i * 20);
      drawRidge(g, pts, shade(theme.ridge[i].c, k), theme.ridge[i].rim, VIEW_H, i > 0);
    }

    /* --- 林：挂在后两层山脊上 --- */
    this.trees.length = 0;
    for (i = 0; i < 62; i++) {
      var layer = i < 44 ? 2 : 3;
      var th = layer === 2 ? 30 + rng() * 24 : 52 + rng() * 44;
      this.trees.push({
        layer: layer,
        x: -80 + rng() * (VIEW_W + 220),
        y: layer === 2 ? 534 + rng() * 8 : 556 + rng() * 5,
        h: th,
        w: th * (0.52 + rng() * 0.16),
        color: shade(theme.tree[layer - 2], k)
      });
    }
    for (i = 0; i < this.trees.length; i++) {
      var tr = this.trees[i];
      drawPine(g, tr.x, tr.y, tr.h, tr.w, tr.color);
    }

    /* --- 层间雾 --- */
    var mist = g.createLinearGradient(0, 400, 0, 600);
    mist.addColorStop(0, 'rgba(128, 100, 112, 0)');
    mist.addColorStop(0.45, theme.mist);
    mist.addColorStop(1, 'rgba(120, 90, 96, 0)');
    g.fillStyle = mist;
    g.fillRect(0, 400, VIEW_W, 200);

    /* --- 地面 --- */
    var PATH_H = 40;
    g.fillStyle = shade(theme.road, k);
    g.fillRect(0, GROUND_Y, VIEW_W, PATH_H);
    g.fillStyle = shade(theme.roadDark, k);
    g.fillRect(0, GROUND_Y + PATH_H, VIEW_W, VIEW_H - GROUND_Y - PATH_H);

    g.fillStyle = theme.edge;
    g.fillRect(0, GROUND_Y, VIEW_W, 2.5);
    g.fillStyle = 'rgba(255, 217, 168, 0.18)';
    g.fillRect(0, GROUND_Y + 2.5, VIEW_W, 1);
    g.fillStyle = 'rgba(255, 217, 168, 0.07)';
    g.fillRect(0, GROUND_Y + PATH_H, VIEW_W, 1);

    /* 路面碎石 */
    for (i = 0; i < 64; i++) {
      var rx = rng() * VIEW_W;
      var ry = GROUND_Y + 10 + rng() * 25;
      var rr = 2.5 + rng() * 7;
      g.fillStyle = shade(theme.road, k * 1.25);
      g.beginPath();
      g.ellipse(rx, ry, rr, rr * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255, 214, 170, 0.10)';
      g.beginPath();
      g.ellipse(rx, ry - rr * 0.18, rr * 0.74, rr * 0.28, 0, Math.PI, Math.PI * 2);
      g.fill();
    }

    /* 草丛 */
    for (i = 0; i < 120; i++) {
      drawGrass(g, rng() * VIEW_W, GROUND_Y + 1, 9 + rng() * 15, shade(theme.grass, k));
    }

    /* --- 路灯：每屏两盏，位置由 seed 决定 --- */
    this.lamps = [
      { x: 140 + rng() * 130, h: 158 + rng() * 20 },
      { x: 1010 + rng() * 130, h: 158 + rng() * 20 }
    ];

    /* 前景草的相位：同区块每次刷新一致 */
    this.fgPhase = Math.floor(rng() * 2048);

    this.bgZone = z.id;
  };

  /* ---------------- init ---------------- */
  WorldScene.prototype.init = function (ctx) {
    var self = this;
    this.ctx = ctx;
    this.t = 0;

    this.grain = buildGrain();
    this.vignette = buildVignette();
    this.grainPattern = ctx.createPattern(this.grain, 'repeat');
    this.lampGlow = makeGlow('#ffca8a', 256);

    var saved = (global.Save && global.Save.get) ? global.Save.get() : null;
    var zoneIdx = PLAZA_IDX;
    if (saved && saved.zone) {
      for (var i = 0; i < ZONES.length; i++) {
        if (ZONES[i].id === saved.zone) { zoneIdx = i; break; }
      }
    }

    this.setZone(zoneIdx);

    this.player = new global.Player(300, GROUND_Y);
    this.player.groundY = GROUND_Y;
    /* 允许走出 [40,1240]：越界那一帧会被 update 抓去做区块切换 */
    this.player.bounds = { min: 0, max: VIEW_W };

    this.npc = new global.NPC(NPC_X, GROUND_Y, {
      name: '守灯人',
      line1: '……又一位旅行者。',
      line2: '按 E 与我说话',
      lines: [
        '……又一位旅行者。欢迎来到中心广场。',
        '我是守灯人。这里不再是一条直路，而是十个区块。',
        '往左走，是工具区：白噪音、番茄钟——写字和专注的地方。',
        '往右走，是游戏区：贪吃蛇、2048、俄罗斯方块、格斗、扫雷、五子棋、打砖块。',
        '走到画面边缘就会换到相邻区块，别怕走丢，路只有一条。',
        '看到门就站过去，提示条会告诉你「按 E 进入」。',
        '进了游戏想回来，按 Esc，或者点右上角的「返回大厅」。',
        '灯会一直为你亮着。'
      ]
    });

    /* 尘埃：只在本屏里飘 */
    this.motes.length = 0;
    var rng = mulberry32((this.zone.themeSeed || 1) + 77);
    for (i = 0; i < 46; i++) {
      this.motes.push({
        x: rng() * VIEW_W,
        y: 150 + rng() * 420,
        r: 1 + rng() * 2.1,
        v: 6 + rng() * 20,
        p: rng() * Math.PI * 2,
        amp: 12 + rng() * 34,
        s: 0.4 + rng() * 0.9
      });
    }

    /* ---- 读档：回到上次的区块与位置 ---- */
    if (saved && saved.player) {
      this.player.x = clamp(saved.player.x, EDGE_L, EDGE_R);
      this.player.facing = saved.player.facing;
      this.player.y = GROUND_Y;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.onGround = true;
    }

    /* 进门要按 E，所以这里不再需要「读档后预置 near」那套防死循环的处理：
       站在门口只会看到提示，不会自动被吸走。 */
    this.near = null;
    this.npcNear = false;

    this._onKey = function (e) { self.onKey(e); };
    this._onClick = function () {
      if (self.intro > 0) self.intro = 0;
    };
    global.addEventListener('keydown', this._onKey);
    if (global.SceneManager && global.SceneManager.canvas) {
      global.SceneManager.canvas.addEventListener('pointerdown', this._onClick);
    }

    this.intro = 2.5;
    this.help = false;
    this.veil = 0;
    this.zoneT = 1.6;
    this.edgeT = 0;
    this.edgeLockL = false;
    this.edgeLockR = false;
    this.prevGround = this.player.onGround;
    this.prevVy = this.player.vy;

    if (global.HUD) global.HUD.toast('');
  };

  /* ---------------- 键盘 ---------------- */
  WorldScene.prototype.onKey = function (e) {
    var npc = this.npc;

    if (e.code === 'KeyH') {
      e.preventDefault();
      this.help = !this.help;
      sfx('ui');
      return;
    }

    if (e.code === 'Escape') {
      if (this.help) { e.preventDefault(); this.help = false; sfx('ui'); return; }
      if (npc && npc.state === 'talking') { e.preventDefault(); npc.closeDialog(); sfx('ui'); }
      return;
    }

    /* 开场还没走完：E / 空格 / 回车 先把它跳掉（不 return，空格该跳还是得跳） */
    if (this.intro > 0 &&
        (e.code === 'KeyE' || e.code === 'Space' ||
         e.code === 'Enter' || e.code === 'NumpadEnter')) {
      this.intro = 0;
      sfx('ui');
    }

    if (e.code !== 'KeyE') return;
    e.preventDefault();

    /* E 的优先级写死：对话 > 进门 */
    if (npc && npc.state === 'talking') {
      npc.advance();
      sfx('talk');
      return;
    }
    if (npc && this.zone.side === 'center' &&
        Math.abs(this.player.x - npc.x) <= NPC_RANGE && this.player.onGround) {
      npc.openDialog();
      sfx('talk');
      return;
    }
    if (this.near) this.enterDoor(this.near);
  };

  /* ---------------- 进门 ---------------- */
  WorldScene.prototype.enterDoor = function (d) {
    if (!d) return;
    if (global.Save && global.Save.setPlayer) {
      global.Save.setPlayer(this.player.x, this.player.facing, this.zone.id);
    }
    sfx('portal');
    if (global.HUD) global.HUD.toast('');
    if (global.SceneManager && global.SceneManager.has('iframe')) {
      global.SceneManager.change('iframe', { title: d.name, src: d.src });
    } else if (global.HUD) {
      global.HUD.toast('场景壳（iframeScene.js）没加载，进不去');
    }
  };

  /* ---------------- 换区块 ----------------
   * 走到最左/最右再往外走：不切换，夹住位置并提示「已到尽头」。
   * 这里用一个方向锁防止「按着方向键 → 每帧都触发一次」的提示与音效风暴：
   * 锁在玩家往回走 60px 之后自动解开。
   */
  WorldScene.prototype.trySwitch = function (dir) {
    var next = this.zoneIdx + dir;

    if (next < 0 || next >= ZONES.length) {
      this.player.x = dir < 0 ? EDGE_L : EDGE_R;
      this.player.vx = 0;
      this.edgeT = 0.6;
      if (dir < 0) this.edgeLockL = true; else this.edgeLockR = true;
      sfx('miss');
      return;
    }

    if (this.npc && this.npc.state === 'talking') this.npc.closeDialog();

    this.setZone(next);

    this.player.x = dir < 0 ? EDGE_R : EDGE_L;
    this.player.y = GROUND_Y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = true;

    this.near = null;
    this.npcNear = false;
    this.edgeT = 0;
    this.zoneT = 1.8;
    this.veil = 1;
    this.edgeLockL = false;
    this.edgeLockR = false;

    sfx('portal');
  };

  /* ---------------- update ---------------- */
  WorldScene.prototype.update = function (dt) {
    this.t += dt;

    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt);
    if (this.veil > 0) this.veil = Math.max(0, this.veil - dt * 2.6);
    if (this.zoneT > 0) this.zoneT = Math.max(0, this.zoneT - dt);
    if (this.edgeT > 0) this.edgeT = Math.max(0, this.edgeT - dt);

    var prevGround = this.prevGround;

    this.player.update(dt, this);

    if (prevGround && this.player.vy < -60) sfx('jump');
    if (!prevGround && this.player.onGround) sfx('land');
    this.prevGround = this.player.onGround;
    this.prevVy = this.player.vy;

    /* ---- 区块边界 ---- */
    if (this.edgeLockL && this.player.x > EDGE_L + 60) this.edgeLockL = false;
    if (this.edgeLockR && this.player.x < EDGE_R - 60) this.edgeLockR = false;

    if (!this.edgeLockL && this.player.x <= EDGE_L && this.player.facing < 0) {
      this.trySwitch(-1);
    } else if (!this.edgeLockR && this.player.x >= EDGE_R && this.player.facing > 0) {
      this.trySwitch(1);
    }

    /* 尘埃漂浮 */
    var m, i;
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * m.s + m.p) * m.amp * dt;
      if (m.y < 120) { m.y = 600; m.x = Math.random() * VIEW_W; }
      if (m.x < -20) m.x = VIEW_W + 20;
      if (m.x > VIEW_W + 20) m.x = -20;
    }

    /* ---- NPC：只有中心广场有 ---- */
    var npc = this.npc;
    var npcNear = false;
    if (npc) {
      if (this.zone.side !== 'center') {
        if (npc.state === 'talking') npc.closeDialog();
        npc.state = 'idle';
      } else {
        npc.update(dt);
        npcNear = Math.abs(this.player.x - npc.x) <= NPC_RANGE && this.player.onGround;
        if (npc.state === 'talking') {
          if (Math.abs(this.player.x - npc.x) > 120) npc.closeDialog();
        } else if (npcNear) {
          npc.state = 'prompt';
        } else if (npc.state === 'prompt') {
          npc.state = 'idle';
        }
      }
      this.npcNear = npcNear;
    }

    /* ---- 门：只标记 near，不再自动切场景 ---- */
    var hit = null;
    var doors = this.zone.doors;
    for (i = 0; i < doors.length; i++) {
      if (Math.abs(this.player.x - doors[i].x) < DOOR_HIT) { hit = doors[i]; break; }
    }
    this.near = hit;

    /* ---- 底部提示条 ---- */
    if (global.HUD) {
      var msg = '';
      if (npc && npc.state === 'talking') {
        msg = '';
      } else if (npcNear) {
        msg = '按 E 与守灯人对话';
      } else if (hit) {
        msg = '按 E 进入《' + hit.name + '》';
      } else if (this.edgeT > 0) {
        msg = this.zoneIdx === 0 ? '已到尽头 · 左边没有路了' : '已到尽头 · 右边没有路了';
      } else if (this.zoneT > 0) {
        msg = this.zone.side === 'center'
          ? '中心广场 · 左工具 · 右游戏'
          : SIDE_NAME[this.zone.side] + ' · ' + this.zone.title;
      } else if (this.zone.side !== 'center') {
        msg = '走回画面边缘可离开本区块';
      }
      global.HUD.toast(msg);
    }
  };

  /* ---------------- render ---------------- */
  WorldScene.prototype.render = function (ctx) {
    /* 1. 本区块背景（预渲染） */
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    else {
      ctx.fillStyle = '#0a0814';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    var i;

    /* 2. 星（会呼吸） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      var a = 0.18 + 0.5 * Math.abs(Math.sin(this.t * s.s + s.p));
      ctx.fillStyle = 'rgba(255, 236, 210, ' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 3. 路灯 + 光晕 */
    for (i = 0; i < this.lamps.length; i++) {
      drawLamp(ctx, this.lamps[i].x, GROUND_Y + 4, this.lamps[i].h);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.lamps.length; i++) {
      var lq = this.lamps[i];
      var flicker = 0.82 + Math.sin(this.t * 2.3 + lq.x) * 0.06;
      ctx.globalAlpha = 0.5 * flicker;
      ctx.drawImage(this.lampGlow, lq.x - 130, GROUND_Y + 4 - lq.h - 132, 260, 260);
    }
    ctx.restore();

    /* 4. 路标牌 */
    this.drawSign(ctx);

    /* 5. 门 */
    for (i = 0; i < this.zone.doors.length; i++) {
      this.drawPortal(ctx, this.zone.doors[i]);
    }

    /* 6. NPC（仅中心广场） */
    if (this.npc && this.zone.side === 'center') this.npc.render(ctx);
    if (this.player) this.player.render(ctx);

    /* 7. 尘埃 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.motes.length; i++) {
      var mo = this.motes[i];
      var ma = 0.10 + 0.30 * Math.abs(Math.sin(this.t * mo.s + mo.p));
      ctx.fillStyle = 'rgba(255, 206, 140, ' + ma.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(mo.x, mo.y, mo.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 8. 前景草叶：两层，视差基准是本区块的固定相位（不滚动） */
    this.drawForeground(ctx);

    /* 9. 暗角 + 纸纹 */
    ctx.drawImage(this.vignette, 0, 0);
    if (this.grainPattern) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    /* 10. 切换区块时的一层暖光 */
    if (this.veil > 0) {
      ctx.save();
      ctx.globalAlpha = 0.34 * this.veil;
      ctx.fillStyle = '#f6dcc0';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    /* 11. 覆盖层 */
    if (this.intro > 0) this.drawIntro(ctx);
    if (this.help) this.drawHelp(ctx);
  };

  /* ---------------- 路标牌 ---------------- */
  WorldScene.prototype.drawSign = function (ctx) {
    var z = this.zone;
    var text;
    var align;

    if (z.side === 'right') {
      text = '→ ' + SIDE_NAME.right + ' · ' + z.title;
      align = 'left';
    } else if (z.side === 'left') {
      text = SIDE_NAME.left + ' · ' + z.title + ' ←';
      align = 'right';
    } else {
      text = '中心广场 · 左工具 · 右游戏';
      align = 'center';
    }

    var anchorX = z.side === 'right' ? 62 : (z.side === 'left' ? VIEW_W - 62 : VIEW_W / 2);
    var theme = THEME[z.side] || THEME.center;

    ctx.save();
    ctx.font = '600 17px ' + SERIF;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var tw = ctx.measureText(text).width;
    var w = tw + 40;
    var h = 40;
    var bx = align === 'left' ? anchorX : (align === 'right' ? anchorX - w : anchorX - w / 2);
    /* 广场的路标挂高一点：守灯人的对话气泡正好占着中段 */
    var by = GROUND_Y - (z.side === 'center' ? 300 : 206);

    /* 立柱 */
    ctx.fillStyle = 'rgba(10, 8, 18, 0.92)';
    ctx.fillRect(anchorX - 2.5, by + h, 5, GROUND_Y - by - h + 4);

    /* 板面 */
    roundRect(ctx, bx, by, w, h, 7);
    ctx.fillStyle = 'rgba(14, 11, 24, 0.9)';
    ctx.fill();
    ctx.strokeStyle = rgba(this.zone.doors.length ? this.zone.doors[0].color : '#e8b45a', 0.45);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* 钉子 */
    ctx.fillStyle = 'rgba(255, 226, 190, 0.35)';
    ctx.beginPath();
    ctx.arc(bx + 9, by + h / 2, 2, 0, Math.PI * 2);
    ctx.arc(bx + w - 9, by + h / 2, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(253, 243, 228, 0.92)';
    ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
    ctx.restore();
  };

  /* ---------------- 门 ---------------- */
  WorldScene.prototype.drawPortal = function (ctx, p) {
    var cx = p.x;
    var top = GROUND_Y - p.h;
    var left = cx - p.w / 2;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 1.6 + (p.x % 7));
    var near = this.near === p;

    if (!p.glow) p.glow = makeGlow(p.color, 256);

    /* 光晕 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.40 + pulse * 0.24 + (near ? 0.26 : 0);
    var gs = 300 + pulse * 24;
    ctx.drawImage(p.glow, cx - gs / 2, GROUND_Y - p.h * 0.5 - gs / 2, gs, gs);
    ctx.restore();

    /* 底座 */
    ctx.fillStyle = '#171226';
    roundRect(ctx, left - 16, GROUND_Y - 12, p.w + 32, 16, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 210, 160, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 门框石 */
    archPath(ctx, left, top, p.w, p.h);
    ctx.fillStyle = '#100c1c';
    ctx.fill();

    /* 能量腔 */
    var vx = left + 8;
    var vy = top + 8;
    var vw = p.w - 16;
    var vh = p.h - 8;

    ctx.save();
    archPath(ctx, vx, vy, vw, vh);
    ctx.clip();

    var grd = ctx.createLinearGradient(0, vy, 0, vy + vh);
    grd.addColorStop(0, rgba(p.color, 0.10));
    grd.addColorStop(0.5, rgba(p.color, 0.40));
    grd.addColorStop(1, rgba(p.color, 0.14));
    ctx.fillStyle = grd;
    ctx.fillRect(vx, vy, vw, vh);

    /* 上升流光 */
    for (var k = 0; k < 6; k++) {
      var yy = vy + vh - ((this.t * 30 + k * 40 + p.x * 0.3) % (vh + 60));
      ctx.fillStyle = rgba(p.color, 0.13);
      ctx.fillRect(vx, yy, vw, 5);
    }

    /* 中心一抹亮 */
    var core = ctx.createRadialGradient(cx, vy + vh * 0.55, 0, cx, vy + vh * 0.55, vw * 0.8);
    core.addColorStop(0, 'rgba(255, 255, 255, ' + (0.10 + pulse * 0.10).toFixed(3) + ')');
    core.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(vx, vy, vw, vh);

    ctx.restore();

    /* 图腾 */
    drawGlyph(ctx, p.glyph, cx, top + 104, this.t);

    /* 边框 */
    archPath(ctx, left, top, p.w, p.h);
    ctx.strokeStyle = 'rgba(255, 226, 190, 0.18)';
    ctx.lineWidth = 3;
    ctx.stroke();

    archPath(ctx, vx, vy, vw, vh);
    ctx.strokeStyle = rgba(p.color, near ? 0.95 : 0.5 + pulse * 0.28);
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 名牌：名字 + 说明合成一块卡片，免得小字悬在日光上看不清 */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '600 21px ' + SERIF;
    var nw = ctx.measureText(p.name).width;
    ctx.font = '400 12px ' + SANS;
    var dw = ctx.measureText(p.desc).width;
    var cw = Math.max(nw, dw) + 36;
    var ch = 56;
    var cy0 = top - 30 - ch;

    roundRect(ctx, cx - cw / 2, cy0, cw, ch, 12);
    ctx.fillStyle = 'rgba(10, 8, 18, 0.78)';
    ctx.fill();
    ctx.strokeStyle = rgba(p.color, 0.40);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#fdf3e4';
    ctx.font = '600 21px ' + SERIF;
    ctx.fillText(p.name, cx, cy0 + 20);

    ctx.font = '400 12px ' + SANS;
    ctx.fillStyle = rgba(p.color, 0.92);
    ctx.fillText(p.desc, cx, cy0 + 42);
    ctx.restore();

    /* 站在门前：地面提示环 + 一枚 E 键帽 */
    if (near) {
      ctx.save();
      ctx.strokeStyle = rgba(p.color, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, GROUND_Y + 2, 52 + Math.sin(this.t * 4) * 3, 11, 0, 0, Math.PI * 2);
      ctx.stroke();

      var capY = top - 30 - 56 - 14 - 15;
      roundRect(ctx, cx - 15, capY - 15, 30, 30, 8);
      ctx.fillStyle = 'rgba(9, 7, 16, 0.86)';
      ctx.fill();
      ctx.strokeStyle = rgba(p.color, 0.85);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 16px ' + SANS;
      ctx.fillStyle = p.color;
      ctx.fillText('E', cx, capY + 1);
      ctx.restore();
    }
  };

  /* ---------------- 前景草叶 ---------------- */
  WorldScene.prototype.drawForeground = function (ctx) {
    var layers = [
      { f: 1.12, base: 724, h0: 22, h1: 62, step: 47, skip: 6 },
      { f: 1.34, base: 734, h0: 56, h1: 122, step: 133, skip: 9 }
    ];
    var span = 2048;
    var theme = THEME[this.zone.side] || THEME.center;

    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var off = -((this.fgPhase * L.f) % span);
      ctx.fillStyle = li === 0 ? shade(theme.grass, 0.9) : '#050309';
      ctx.beginPath();
      for (var i = 0; i < 52; i++) {
        if ((i * 7 + li * 3) % L.skip === 0) continue;
        var jitter = ((i * 29) % 41) - 20;
        var bx = ((i * L.step + jitter + off) % span + span) % span - 300;
        if (bx < -70 || bx > VIEW_W + 70) continue;
        var h = L.h0 + ((i * 37 + li * 23) % Math.max(1, L.h1 - L.h0));
        var lean = ((i * 13) % 9) - 4;
        ctx.moveTo(bx - 10, L.base);
        ctx.quadraticCurveTo(bx - 3 + lean * 0.5, L.base - h * 0.6, bx + lean, L.base - h);
        ctx.quadraticCurveTo(bx + 6 + lean * 0.4, L.base - h * 0.45, bx + 11, L.base);
        ctx.closePath();
        if (i % 4 === 0) {
          ctx.moveTo(bx + 8, L.base);
          ctx.quadraticCurveTo(bx + 5, L.base - h * 0.3, bx - 2, L.base - h * 0.5);
          ctx.quadraticCurveTo(bx + 2, L.base - h * 0.28, bx + 1, L.base);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
  };

  /* ---------------- 开场标题卡 ---------------- */
  WorldScene.prototype.drawIntro = function (ctx) {
    var k = this.intro;
    var p = 1 - k / 2.5;
    var a = Math.min(1, p / 0.2) * Math.min(1, k / 0.6);
    if (a <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = a;

    var veil = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 40, VIEW_W / 2, VIEW_H / 2, 760);
    veil.addColorStop(0, 'rgba(5, 4, 11, 0.94)');
    veil.addColorStop(0.62, 'rgba(5, 4, 11, 0.86)');
    veil.addColorStop(1, 'rgba(5, 4, 11, 0.52)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var cx = VIEW_W / 2;
    var cy = VIEW_H / 2 - 10;

    ctx.strokeStyle = 'rgba(240, 167, 110, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 210, cy - 74);
    ctx.lineTo(cx + 210, cy - 74);
    ctx.moveTo(cx - 210, cy + 74);
    ctx.lineTo(cx + 210, cy + 74);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(255, 217, 168, 0.62)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('W O R L D   H U B', cx, cy - 100);

    ctx.fillStyle = '#fdf3e4';
    ctx.font = '600 62px ' + SERIF;
    ctx.shadowColor = 'rgba(240, 167, 110, 0.30)';
    ctx.shadowBlur = 42;
    ctx.fillText('世界大厅', cx, cy - 24);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(253, 243, 228, 0.62)';
    ctx.font = '400 17px ' + SANS;
    ctx.fillText('左工具 · 右游戏 · 十个区块', cx, cy + 30);

    ctx.globalAlpha = a * Math.min(1, k / 0.6);
    ctx.fillStyle = 'rgba(255, 217, 168, 0.72)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('按 E / 空格 / 回车 跳过', cx, VIEW_H - 74);

    ctx.restore();
  };

  /* ---------------- 帮助面板 ---------------- */
  WorldScene.prototype.drawHelp = function (ctx) {
    var w = 820;
    var rowH = 44;
    var h = 116 + HELP_ROWS.length * rowH + 44;
    var x = (VIEW_W - w) / 2;
    var y = (VIEW_H - h) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 4, 11, 0.74)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.shadowColor = 'rgba(3, 2, 7, 0.72)';
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 20;
    roundRect(ctx, x, y, w, h, 20);
    ctx.fillStyle = 'rgba(19, 14, 32, 0.96)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    roundRect(ctx, x, y, w, h, 20);
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.46)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    var cx = VIEW_W / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fdf3e4';
    ctx.font = '600 32px ' + SERIF;
    ctx.fillText('操作说明', cx, y + 48);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('HELP · 全部按键一览', cx, y + 78);

    ctx.strokeStyle = 'rgba(240, 167, 110, 0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 56, y + 98);
    ctx.lineTo(x + w - 56, y + 98);
    ctx.stroke();

    var top = y + 98 + rowH * 0.5 + 8;
    for (var i = 0; i < HELP_ROWS.length; i++) {
      var ry = top + i * rowH;
      var label = HELP_ROWS[i][0];

      ctx.textAlign = 'right';
      ctx.font = '600 16px ' + SANS;
      ctx.fillStyle = label ? 'rgba(255, 217, 168, 0.92)' : 'rgba(255, 217, 168, 0.28)';
      ctx.fillText(label || '·', x + 176, ry);

      ctx.textAlign = 'left';
      ctx.font = '400 15px ' + SANS;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.78)';
      ctx.fillText(HELP_ROWS[i][1], x + 200, ry);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('H 或 Esc 关闭', cx, y + h - 30);

    ctx.restore();
  };

  /* ---------------- destroy ---------------- */
  WorldScene.prototype.destroy = function () {
    if (this._onKey) global.removeEventListener('keydown', this._onKey);
    if (this._onClick && global.SceneManager && global.SceneManager.canvas) {
      global.SceneManager.canvas.removeEventListener('pointerdown', this._onClick);
    }
    this._onKey = null;
    this._onClick = null;
    this.intro = 0;
    this.help = false;

    if (this.npc) this.npc.reset();

    this.stars.length = 0;
    this.motes.length = 0;
    this.trees.length = 0;
    this.lamps.length = 0;
    this.player = null;
    this.npc = null;
    this.near = null;
    this.bg = null;
    this.bgZone = '';
    if (global.HUD) global.HUD.toast('');
  };

  /* 供外部（探针 / README）读取的配置入口 */
  WorldScene.ZONES = ZONES;
  WorldScene.PLAZA_IDX = PLAZA_IDX;
  WorldScene.EDGE_L = EDGE_L;
  WorldScene.EDGE_R = EDGE_R;

  global.WorldScene = WorldScene;
})(window);
