/* ============================================================
 * world.js —— 横版世界大厅（大厅场景）
 * ------------------------------------------------------------
 * 场景接口：init(ctx) / update(dt) / render(ctx) / destroy()
 * 地图 2800×720，摄像机只能左右移动。
 * 画面语言：剪纸黄昏 —— 分层剪影 + 背光暖边 + 纸纹
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var VIEW_W = 1280;
  var VIEW_H = 720;
  var MAP_W = 2800;
  var MAP_H = 720;
  var GROUND_Y = 566;
  var SEED = 20261102;

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  /* ---------------- 工具 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  /* 帮助面板内容：必须和真实键位逐字一致，改键位请同步改这里 */
  var HELP_ROWS = [
    ['大厅', 'A / D 移动 · 空格 跳跃 · E 与守灯人对话 · H 帮助'],
    ['贪吃蛇', '方向键 转向 · R 重开 · Esc 回大厅'],
    ['森林冰火人', '方向键 移动 · 空格 跳跃 · Tab 换人 · R 重开 · Esc 回大厅'],
    ['二人格斗', 'P1  A D W 移动跳跃 · J 拳 · K 踢 · L 必杀'],
    ['', 'P2  ← → ↑ 移动跳跃 · 1 拳 · 2 踢 · 3 必杀'],
    ['与 AI 打牌', '单击选牌 · 双击直接出 · 空格 出牌 · F 提示 · Esc 回大厅'],
    ['记忆翻牌', '单击翻牌 · 再点同一张无效 · Esc 回大厅'],
    ['通用', 'Esc 回大厅 · H 关掉这块面板']
  ];

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

  /* ---------------- 静态图层：天空 ---------------- */
  function buildSky() {
    var c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = GROUND_Y;
    var g = c.getContext('2d');

    var sky = g.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0.00, '#0a0c1e');
    sky.addColorStop(0.24, '#1a1634');
    sky.addColorStop(0.46, '#372244');
    sky.addColorStop(0.66, '#65334a');
    sky.addColorStop(0.83, '#a05940');
    sky.addColorStop(1.00, '#dd9a5f');
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, GROUND_Y);

    /* 太阳与光晕 */
    var sx = 992, sy = 352, sr = 68;
    var halo = g.createRadialGradient(sx, sy, sr * 0.7, sx, sy, sr * 5.2);
    halo.addColorStop(0, 'rgba(255, 205, 145, 0.34)');
    halo.addColorStop(0.42, 'rgba(255, 165, 100, 0.13)');
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

    /* 剪纸云带 */
    var bands = [
      { x: 100, y: 206, w: 320, h: 8, a: 0.085 },
      { x: 470, y: 258, w: 200, h: 6, a: 0.06 },
      { x: 690, y: 164, w: 400, h: 9, a: 0.05 },
      { x: 250, y: 328, w: 440, h: 10, a: 0.075 },
      { x: 800, y: 392, w: 470, h: 11, a: 0.06 }
    ];
    if ('filter' in g) g.filter = 'blur(5px)';
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      g.fillStyle = 'rgba(255, 222, 180, ' + b.a + ')';
      roundRect(g, b.x, b.y, b.w, b.h, b.h / 2);
      g.fill();
    }
    if ('filter' in g) g.filter = 'none';

    return c;
  }

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

  /* ---------------- 山脊 ---------------- */
  function makeRidge(rng, width, baseY, amp, minStep, maxStep) {
    var pts = [{ x: -260, y: baseY }];
    var x = -200;
    var y = baseY;
    while (x < width + 260) {
      x += minStep + rng() * (maxStep - minStep);
      var t = rng();
      if (t < 0.22) y = baseY - amp * (0.02 + rng() * 0.1);      // 落在谷底
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

  /* ---------------- 装饰件 ---------------- */
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
    /* 杆 */
    ctx.fillStyle = '#0c0916';
    ctx.fillRect(x - 2, baseY - h, 4, h);
    /* 灯头 */
    ctx.beginPath();
    ctx.moveTo(x - 13, baseY - h + 2);
    ctx.lineTo(x + 13, baseY - h + 2);
    ctx.lineTo(x + 8, baseY - h - 20);
    ctx.lineTo(x - 8, baseY - h - 20);
    ctx.closePath();
    ctx.fill();
    /* 灯芯 */
    ctx.fillStyle = 'rgba(255, 214, 158, 0.95)';
    ctx.beginPath();
    ctx.moveTo(x - 8, baseY - h + 1);
    ctx.lineTo(x + 8, baseY - h + 1);
    ctx.lineTo(x + 5, baseY - h - 15);
    ctx.lineTo(x - 5, baseY - h - 15);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- 传送门里的图腾 ---------------- */
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

    } else if (kind === 'fireice') {
      /* 火：一簇水滴形外焰 */
      var fx = cx - 15;
      ctx.beginPath();
      ctx.moveTo(fx - 9, cy + 15);
      ctx.quadraticCurveTo(fx - 14, cy + 2, fx - 5, cy - 21);
      ctx.quadraticCurveTo(fx - 3, cy - 7, fx + 3, cy - 3);
      ctx.quadraticCurveTo(fx + 11, cy + 5, fx + 5, cy + 15);
      ctx.quadraticCurveTo(fx - 1, cy + 21, fx - 9, cy + 15);
      ctx.stroke();
      /* 冰：六芒雪晶 */
      var ix = cx + 15, iy = cy + 2;
      for (i = 0; i < 3; i++) {
        a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(ix - Math.cos(a) * 12, iy - Math.sin(a) * 12);
        ctx.lineTo(ix + Math.cos(a) * 12, iy + Math.sin(a) * 12);
        ctx.stroke();
      }
      for (i = 0; i < 6; i++) {
        a = i * Math.PI / 3;
        var ex = ix + Math.cos(a) * 9;
        var ey = iy + Math.sin(a) * 9;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a - 0.7) * 4.2, ey - Math.sin(a - 0.7) * 4.2);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a + 0.7) * 4.2, ey - Math.sin(a + 0.7) * 4.2);
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

    } else if (kind === 'memory') {
      /* 记忆翻牌：两张叠放的牌，上面一张翻出四角星 */
      for (i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(cx + (i === 0 ? -9 : 9), cy + 2);
        ctx.rotate(i === 0 ? -0.16 : 0.13);
        roundRect(ctx, -11.5, -21, 23, 41, 3.5);
        ctx.stroke();
        if (i === 1) {
          ctx.beginPath();
          for (var mk = 0; mk < 8; mk++) {
            a = -Math.PI / 2 + mk * Math.PI / 4;
            var mr = (mk % 2 === 0) ? 7.4 : 3.2;
            if (mk === 0) ctx.moveTo(Math.cos(a) * mr, Math.sin(a) * mr + 1);
            else ctx.lineTo(Math.cos(a) * mr, Math.sin(a) * mr + 1);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

    } else {
      /* cards：三张扇形展开的牌 */
      for (i = 0; i < 3; i++) {
        var off = (i - 1) * 13;
        ctx.save();
        ctx.translate(cx + off, cy + 2);
        ctx.rotate((i - 1) * 0.18);
        roundRect(ctx, -10, -20, 20, 38, 3.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, -8, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  /* ============================================================
   * WorldScene
   * ============================================================ */
  function WorldScene() {
    this.t = 0;
    this.ctx = null;
    this.rng = null;

    this.camera = null;
    this.player = null;
    this.npc = null;
    this.portals = [];
    this.near = null;
    this.npcNear = false;
    this._onKey = null;
    this._onClick = null;

    /* 开场标题卡（2.5s，可跳过）与帮助面板 */
    this.intro = 0;
    this.help = false;

    /* 用来判断「起跳 / 落地」这一对事件，player 自己不出声 */
    this.prevGround = true;
    this.prevVy = 0;

    this.hills = [];
    this.trees = [];
    this.grass = [];
    this.rocks = [];
    this.lamps = [];
    this.stars = [];
    this.motes = [];

    this.sky = null;
    this.grain = null;
    this.vignette = null;
    this.grainPattern = null;
    this.lampGlow = null;

    this.groundY = GROUND_Y;
    this.mapW = MAP_W;
    this.mapH = MAP_H;
  }

  /* ---------------- init ---------------- */
  WorldScene.prototype.init = function (ctx) {
    var self = this;
    this.ctx = ctx;
    this.t = 0;

    var rng = mulberry32(SEED);
    this.rng = rng;

    /* 预渲染的静态素材 */
    this.sky = buildSky();
    this.grain = buildGrain();
    this.vignette = buildVignette();
    this.grainPattern = ctx.createPattern(this.grain, 'repeat');
    this.lampGlow = makeGlow('#ffca8a', 256);

    /* 四层山脊：远景到近景 */
    this.hills = [
      { pts: makeRidge(rng, MAP_W * 0.14 + VIEW_W, 470, 176, 130, 260), f: 0.10, color: '#3b3059', rim: 'rgba(122,100,158,0.55)', smooth: false },
      { pts: makeRidge(rng, MAP_W * 0.24 + VIEW_W, 508, 140, 120, 220), f: 0.22, color: '#2f2749', rim: 'rgba(96,80,130,0.45)', smooth: true },
      { pts: makeRidge(rng, MAP_W * 0.42 + VIEW_W, 540, 92, 110, 200), f: 0.42, color: '#241d3b', rim: 'rgba(74,62,105,0.40)', smooth: true },
      { pts: makeRidge(rng, MAP_W * 0.68 + VIEW_W, 560, 58, 100, 190), f: 0.70, color: '#171325', rim: 'rgba(58,49,80,0.40)', smooth: true }
    ];

    /* 树：挂在后两层山脊上 */
    var i;
    for (i = 0; i < 78; i++) {
      var layer = i < 54 ? 2 : 3;
      var tx = -120 + rng() * (MAP_W * (layer === 2 ? 0.42 : 0.68) + VIEW_W + 240);
      var th = layer === 2 ? 34 + rng() * 26 : 54 + rng() * 46;
      this.trees.push({
        layer: layer,
        x: tx,
        y: layer === 2 ? 536 + rng() * 8 : 558 + rng() * 5,
        h: th,
        w: th * (0.52 + rng() * 0.16),
        color: layer === 2 ? '#1d1733' : '#120f1e'
      });
    }

    /* 地面草丛 / 碎石 */
    for (i = 0; i < 150; i++) {
      this.grass.push({
        x: rng() * (MAP_W + 200) - 100,
        h: 9 + rng() * 15
      });
    }
    for (i = 0; i < 70; i++) {
      this.rocks.push({
        x: rng() * (MAP_W + 200) - 100,
        r: 2.5 + rng() * 7,
        y: GROUND_Y + 10 + rng() * 25
      });
    }

    /* 路灯 */
    this.lamps = [
      { x: 210, h: 168 },
      { x: 900, h: 176 },
      { x: 1420, h: 162 },
      { x: 1900, h: 172 },
      { x: 2290, h: 158 },
      { x: 2700, h: 168 }
    ];

    /* 星与尘埃 */
    for (i = 0; i < 64; i++) {
      this.stars.push({
        x: rng() * VIEW_W,
        y: 24 + rng() * 210,
        r: 0.7 + rng() * 1.5,
        p: rng() * Math.PI * 2,
        s: 0.5 + rng() * 1.4
      });
    }
    for (i = 0; i < 58; i++) {
      this.motes.push({
        x: rng() * MAP_W,
        y: 150 + rng() * 420,
        r: 1 + rng() * 2.1,
        v: 6 + rng() * 20,
        p: rng() * Math.PI * 2,
        amp: 12 + rng() * 34,
        s: 0.4 + rng() * 0.9
      });
    }

    /* 角色 / NPC / 传送门 */
    this.camera = new global.Camera(VIEW_W, VIEW_H, MAP_W, MAP_H);

    this.player = new global.Player(300, GROUND_Y);
    this.player.groundY = GROUND_Y;
    this.player.bounds = { min: 44, max: MAP_W - 44 };

    this.npc = new global.NPC(470, GROUND_Y, {
      name: '守灯人',
      line1: '……又一位旅行者。',
      line2: '按 E 与我说话',
      lines: [
        '……又一位旅行者。欢迎来到黄昏世界的世界大厅。',
        '我是守灯人，看管这五道传送门。灯亮着，路就在。',
        '「贪吃蛇」——蛇会越来越快，别贪，稳着走。',
        '「森林冰火人」——水火不容：火怕水、冰怕火，小心脚下。',
        '「二人格斗」——大厅里切磋可以，可别伤了和气。',
        '「与AI打牌」——牌桌上三分靠牌，七分靠记性。',
        '好了，选一道门出发吧。',
        '灯会一直为你亮着。'
      ]
    });

    this.portals = [
      { id: 'snake',   name: '贪吃蛇',     color: '#5fd39a', glyph: 'snake',   x: 706 },
      { id: 'fireice', name: '森林冰火人', color: '#79c8ff', glyph: 'fireice', x: 1128 },
      { id: 'fight',   name: '二人格斗',   color: '#e8545f', glyph: 'fight',   x: 1612 },
      { id: 'cards',   name: '与AI打牌',   color: '#e8b45a', glyph: 'cards',   x: 2094 },
      { id: 'memory',  name: '记忆翻牌',   color: '#a98ae0', glyph: 'memory',  x: 2500 }
    ];

    this.portals.forEach(function (p) {
      p.w = 104;
      p.h = 190;
      p.phase = rng() * Math.PI * 2;
      p.glow = makeGlow(p.color, 256);
    });

    this.near = null;
    this.npcNear = false;

    /* ---- 读档：把角色放回上次离开大厅的位置 ---- */
    var saved = (global.Save && global.Save.get) ? global.Save.get() : null;
    if (saved && saved.player) {
      this.player.x = saved.player.x;
      this.player.facing = saved.player.facing;
      this.player.y = GROUND_Y;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.onGround = true;
      /* 存档点本身就在门的作用范围内。先把 near 认成这扇门，否则回大厅的
         第一帧就会被同一扇门再次吸进游戏，变成「一出来就被弹回去」的死循环。
         走出 62px 范围后 near 自然清空，再走回来即可重新进入。 */
      for (var pi = 0; pi < this.portals.length; pi++) {
        if (Math.abs(this.player.x - this.portals[pi].x) < 62) {
          this.near = this.portals[pi];
          break;
        }
      }
    }

    /* E / Esc 只在本场景存活期间监听，destroy 时摘掉 */
    this._onKey = function (e) { self.onKey(e); };
    this._onClick = function () {
      /* 点一下也算跳过开场 */
      if (self.intro > 0) self.intro = 0;
    };
    global.addEventListener('keydown', this._onKey);
    if (global.SceneManager && global.SceneManager.canvas) {
      global.SceneManager.canvas.addEventListener('pointerdown', this._onClick);
    }

    this.camera.snap(this.player);

    /* 开场：不阻塞任何逻辑，只在画面上叠一张标题卡 */
    this.intro = 2.5;
    this.help = false;
    this.prevGround = this.player.onGround;
    this.prevVy = this.player.vy;

    if (global.HUD) global.HUD.toast('');
  };

  /* ---------------- 对话键盘 ---------------- */
  WorldScene.prototype.onKey = function (e) {
    var npc = this.npc;

    /* H：帮助面板开关（任何时候都能按） */
    if (e.code === 'KeyH') {
      e.preventDefault();
      this.help = !this.help;
      sfx('ui');
      return;
    }

    /* Esc：帮助面板优先关，其次关对话 */
    if (e.code === 'Escape') {
      if (this.help) { e.preventDefault(); this.help = false; sfx('ui'); return; }
      if (npc && npc.state === 'talking') { e.preventDefault(); npc.closeDialog(); sfx('ui'); }
      return;
    }

    /* 开场还没走完：E / 空格 / 回车 先把它跳掉。
       这里故意不 return —— 空格该跳还是得跳，别把操作吞掉。 */
    if (this.intro > 0 &&
        (e.code === 'KeyE' || e.code === 'Space' ||
         e.code === 'Enter' || e.code === 'NumpadEnter')) {
      this.intro = 0;
      sfx('ui');
    }

    if (!npc) return;

    if (e.code === 'KeyE') {
      if (npc.state === 'talking') {
        e.preventDefault();
        npc.advance();
        sfx('talk');
        return;
      }
      if (Math.abs(this.player.x - npc.x) <= 80 && this.player.onGround) {
        e.preventDefault();
        npc.openDialog();
        sfx('talk');
      }
      return;
    }
  };

  /* ---------------- update ---------------- */
  WorldScene.prototype.update = function (dt) {
    this.t += dt;

    /* 开场计时：只影响那层遮罩，不拦任何逻辑 */
    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt);

    var prevGround = this.prevGround;

    this.player.update(dt, this);

    /* 起跳 / 落地：world 自己判，不往 player.js 里塞音频代码 */
    if (prevGround && this.player.vy < -60) sfx('jump');
    if (!prevGround && this.player.onGround) sfx('land');
    this.prevGround = this.player.onGround;
    this.prevVy = this.player.vy;

    this.camera.follow(this.player, dt);
    this.npc.update(dt);

    /* 尘埃漂浮 */
    var m, i;
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * m.s + m.p) * m.amp * dt;
      if (m.y < 120) {
        m.y = 600;
        m.x = this.camera.x + Math.random() * VIEW_W;
      }
    }

    /* ---- NPC：用距离驱动 idle / prompt 两态（talking 由 E 键进入） ---- */
    var npc = this.npc;
    var npcNear = false;
    if (npc) {
      npcNear = Math.abs(this.player.x - npc.x) <= 80 && this.player.onGround;
      this.npcNear = npcNear;

      if (npc.state === 'talking') {
        /* 走远了自动收起；再靠近可以重新从头讲 */
        if (Math.abs(this.player.x - npc.x) > 120) npc.closeDialog();
      } else if (npcNear) {
        npc.state = 'prompt';
      } else if (npc.state === 'prompt') {
        npc.state = 'idle';
      }
    }

    /* ---- 传送门：已注册的场景走进去就直接切 ---- */
    var hit = null;
    for (i = 0; i < this.portals.length; i++) {
      if (Math.abs(this.player.x - this.portals[i].x) < 62) {
        hit = this.portals[i];
        break;
      }
    }

    if (hit !== this.near) {
      this.near = hit;
      if (hit && global.SceneManager && global.SceneManager.has(hit.id)) {
        /* 先把位置写进存档：游戏里按 Esc 回大厅时角色就站在门口 */
        if (global.Save && global.Save.setPlayer) {
          global.Save.setPlayer(this.player.x, this.player.facing);
        }
        sfx('portal');
        global.SceneManager.change(hit.id);
        return;            // 本场景已被 destroy，update 剩下的逻辑全部作废
      }
    }

    /* ---- 提示条：对话提示优先于传送门提示 ---- */
    if (global.HUD) {
      var msg = '';
      if (npc && npc.state === 'talking') msg = '';
      else if (npcNear) msg = '按 E 与守灯人对话';
      else if (hit) {
        /* 只有站在门口且没被切走时才会走到这里：刚读档回来的那一帧，
           near 已经被认成这扇门，需要提示玩家怎么重新进去 */
        msg = (global.SceneManager && global.SceneManager.has(hit.id))
          ? '走出门口再走回来，可再次进入《' + hit.name + '》'
          : '《' + hit.name + '》该游戏后续开放，敬请期待';
      }
      global.HUD.toast(msg);
    }
  };

  /* ---------------- render ---------------- */
  WorldScene.prototype.render = function (ctx) {
    var cam = this.camera;
    var i, l;

    /* 1. 天空 */
    ctx.drawImage(this.sky, 0, 0);

    /* 2. 星 */
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

    /* 3. 山脊 + 树（带视差） */
    for (i = 0; i < this.hills.length; i++) {
      l = this.hills[i];
      ctx.save();
      ctx.translate(-cam.x * l.f, 0);
      drawRidge(ctx, l.pts, l.color, l.rim, VIEW_H, l.smooth);
      ctx.restore();
    }

    /* 4. 森林剪影：按层叠在山脊前 */
    var order = [this.trees.filter(function (t) { return t.layer === 2; }),
                 this.trees.filter(function (t) { return t.layer === 3; })];
    var factors = [this.hills[2].f, this.hills[3].f];
    for (var oi = 0; oi < order.length; oi++) {
      ctx.save();
      ctx.translate(-cam.x * factors[oi], 0);
      var arr = order[oi];
      for (i = 0; i < arr.length; i++) {
        var tr = arr[i];
        if (tr.x < cam.x * factors[oi] - 160) continue;
        if (tr.x > cam.x * factors[oi] + VIEW_W + 160) continue;
        drawPine(ctx, tr.x, tr.y, tr.h, tr.w, tr.color);
      }
      ctx.restore();
    }

    /* 层间雾：只铺一次，避免叠加出横向色阶 */
    var mist = ctx.createLinearGradient(0, 400, 0, 600);
    mist.addColorStop(0, 'rgba(128, 100, 112, 0)');
    mist.addColorStop(0.45, 'rgba(146, 112, 114, 0.11)');
    mist.addColorStop(1, 'rgba(120, 90, 96, 0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, 400, VIEW_W, 200);

    /* 5. 地面 */
    this.drawGround(ctx, cam);

    /* 6. 路灯（含光晕） */
    for (i = 0; i < this.lamps.length; i++) {
      var lp = this.lamps[i];
      if (lp.x < cam.x - 120 || lp.x > cam.x + VIEW_W + 120) continue;
      drawLamp(ctx, lp.x, GROUND_Y + 4, lp.h);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.lamps.length; i++) {
      var lq = this.lamps[i];
      if (lq.x < cam.x - 200 || lq.x > cam.x + VIEW_W + 200) continue;
      var flicker = 0.82 + Math.sin(this.t * 2.3 + lq.x) * 0.06;
      ctx.globalAlpha = 0.5 * flicker;
      ctx.drawImage(this.lampGlow, lq.x - 130, GROUND_Y + 4 - lq.h - 132, 260, 260);
    }
    ctx.restore();

    /* 7~9. 世界对象统一进摄像机坐标系：门 / NPC / 角色 / 尘埃 */
    cam.begin(ctx);

    for (i = 0; i < this.portals.length; i++) {
      var p = this.portals[i];
      if (p.x + 140 < cam.x || p.x - 140 > cam.x + VIEW_W) continue;
      this.drawPortal(ctx, p);
    }

    if (this.npc) this.npc.render(ctx);
    if (this.player) this.player.render(ctx);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.motes.length; i++) {
      var mo = this.motes[i];
      if (mo.x < cam.x - 40 || mo.x > cam.x + VIEW_W + 40) continue;
      var ma = 0.10 + 0.30 * Math.abs(Math.sin(this.t * mo.s + mo.p));
      ctx.fillStyle = 'rgba(255, 206, 140, ' + ma.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(mo.x, mo.y, mo.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    cam.end(ctx);

    /* 10. 前景草叶：两层视差 > 1，压住画面下沿并制造纵深 */
    this.drawForeground(ctx, cam);

    /* 11. 暗角 + 纸纹 */
    ctx.drawImage(this.vignette, 0, 0);
    if (this.grainPattern) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    /* 12. 覆盖层：开场标题卡 / 帮助面板 */
    if (this.intro > 0) this.drawIntro(ctx);
    if (this.help) this.drawHelp(ctx);
  };

  /* ---------------- 开场标题卡（2.5s，可跳过） ---------------- */
  WorldScene.prototype.drawIntro = function (ctx) {
    var k = this.intro;                       /* 2.5 → 0 */
    var p = 1 - k / 2.5;                      /* 0 → 1 */
    var a = Math.min(1, p / 0.2) * Math.min(1, k / 0.6);
    if (a <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = a;

    /* 黑幕：由中心向外散开，别做成生硬的整屏黑 */
    var veil = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 40, VIEW_W / 2, VIEW_H / 2, 760);
    veil.addColorStop(0, 'rgba(5, 4, 11, 0.94)');
    veil.addColorStop(0.62, 'rgba(5, 4, 11, 0.86)');
    veil.addColorStop(1, 'rgba(5, 4, 11, 0.52)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var cx = VIEW_W / 2;
    var cy = VIEW_H / 2 - 10;

    /* 上下两条细线，把标题框起来 */
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
    ctx.fillText('五道门，五个世界', cx, cy + 30);

    /* 底部跳过提示：最后 0.6 秒就淡出，别跟着一起消失得那么突然 */
    ctx.globalAlpha = a * Math.min(1, k / 0.6);
    ctx.fillStyle = 'rgba(255, 217, 168, 0.72)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('按 E / 空格 / 回车 跳过', cx, VIEW_H - 74);

    ctx.restore();
  };

  /* ---------------- 帮助面板 ---------------- */
  WorldScene.prototype.drawHelp = function (ctx) {
    var w = 780;
    var rowH = 42;
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

    /* 分隔线 */
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
      ctx.textBaseline = 'middle';
      ctx.font = '600 16px ' + SANS;
      ctx.fillStyle = label ? 'rgba(255, 217, 168, 0.92)' : 'rgba(255, 217, 168, 0.28)';
      ctx.fillText(label || '·', x + 196, ry);

      ctx.textAlign = 'left';
      ctx.font = '400 15px ' + SANS;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.78)';
      ctx.fillText(HELP_ROWS[i][1], x + 220, ry);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('H 或 Esc 关闭', cx, y + h - 30);

    ctx.restore();
  };

  /* ---------------- 地面 ---------------- */
  WorldScene.prototype.drawGround = function (ctx, cam) {
    var i;
    var PATH_H = 40;

    /* 路面 */
    ctx.fillStyle = '#1a1527';
    ctx.fillRect(0, GROUND_Y, VIEW_W, PATH_H);
    ctx.fillStyle = '#0c0916';
    ctx.fillRect(0, GROUND_Y + PATH_H, VIEW_W, VIEW_H - GROUND_Y - PATH_H);

    /* 背光暖边 */
    ctx.fillStyle = 'rgba(240, 167, 110, 0.62)';
    ctx.fillRect(0, GROUND_Y, VIEW_W, 2.5);
    ctx.fillStyle = 'rgba(255, 217, 168, 0.18)';
    ctx.fillRect(0, GROUND_Y + 2.5, VIEW_W, 1);
    /* 路沿 */
    ctx.fillStyle = 'rgba(255, 217, 168, 0.07)';
    ctx.fillRect(0, GROUND_Y + PATH_H, VIEW_W, 1);

    ctx.save();
    ctx.translate(-cam.x, 0);

    /* 路面碎石 */
    for (i = 0; i < this.rocks.length; i++) {
      var r = this.rocks[i];
      if (r.x < cam.x - 40 || r.x > cam.x + VIEW_W + 40) continue;
      ctx.fillStyle = '#241c38';
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 214, 170, 0.12)';
      ctx.beginPath();
      ctx.ellipse(r.x, r.y - r.r * 0.18, r.r * 0.74, r.r * 0.28, 0, Math.PI, Math.PI * 2);
      ctx.fill();
    }

    /* 草丛（画在地面线上，压住硬边） */
    for (i = 0; i < this.grass.length; i++) {
      var g = this.grass[i];
      if (g.x < cam.x - 30 || g.x > cam.x + VIEW_W + 30) continue;
      drawGrass(ctx, g.x, GROUND_Y + 1, g.h, '#0a0713');
    }

    ctx.restore();
  };

  /* ---------------- 前景草叶 ---------------- */
  WorldScene.prototype.drawForeground = function (ctx, cam) {
    var layers = [
      { f: 1.12, base: 724, h0: 22, h1: 62, step: 47, color: '#0b0815', skip: 6 },
      { f: 1.34, base: 734, h0: 56, h1: 122, step: 133, color: '#050309', skip: 9 }
    ];
    var span = 2048;

    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var off = -cam.x * L.f;
      ctx.fillStyle = L.color;
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
        /* 每 4 株补一丛矮草，打散节奏 */
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

  /* ---------------- 传送门 ---------------- */
  WorldScene.prototype.drawPortal = function (ctx, p) {
    var cx = p.x;
    var top = GROUND_Y - p.h;
    var left = cx - p.w / 2;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 1.6 + p.phase);
    var near = this.near === p;

    /* 光晕 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.42 + pulse * 0.26 + (near ? 0.26 : 0);
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

    /* 门框石：外深内浅 */
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
      var yy = vy + vh - ((this.t * 30 + k * 40 + p.phase * 30) % (vh + 60));
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

    /* 腔体内图腾 */
    drawGlyph(ctx, p.glyph, cx, top + 108, this.t);

    /* 边框 */
    archPath(ctx, left, top, p.w, p.h);
    ctx.strokeStyle = 'rgba(255, 226, 190, 0.18)';
    ctx.lineWidth = 3;
    ctx.stroke();

    archPath(ctx, vx, vy, vw, vh);
    ctx.strokeStyle = rgba(p.color, near ? 0.95 : 0.5 + pulse * 0.28);
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 名字牌（统一抬高 6px，给下面的「已通关」吊牌留出间隙） */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 21px ' + SERIF;
    var tw = ctx.measureText(p.name).width;

    roundRect(ctx, cx - tw / 2 - 15, top - 48, tw + 30, 30, 15);
    ctx.fillStyle = 'rgba(10, 8, 18, 0.66)';
    ctx.fill();
    ctx.strokeStyle = rgba(p.color, 0.38);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#fdf3e4';
    ctx.fillText(p.name, cx, top - 32);

    /* 名字下的小点：未开放标记 */
    ctx.fillStyle = rgba(p.color, 0.8);
    ctx.beginPath();
    ctx.arc(cx - tw / 2 - 4, top - 33, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 已通关：名字牌正下方挂一枚小吊牌（纯 canvas，不新增 DOM） */
    if (global.Save && global.Save.isCleared(p.id)) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px ' + SANS;
      var badge = '已通关 ✓';
      var bw = ctx.measureText(badge).width + 22;
      var by = top - 14;

      roundRect(ctx, cx - bw / 2, by, bw, 21, 10.5);
      ctx.fillStyle = 'rgba(9, 7, 16, 0.9)';
      ctx.fill();
      ctx.strokeStyle = rgba(p.color, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = p.color;
      ctx.fillText(badge, cx, by + 11);
      ctx.restore();
    }

    /* 站立其中时的地面提示环 */
    if (near) {
      ctx.save();
      ctx.strokeStyle = rgba(p.color, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, GROUND_Y + 2, 52 + Math.sin(this.t * 4) * 3, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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

    this.portals.length = 0;
    this.motes.length = 0;
    this.trees.length = 0;
    this.grass.length = 0;
    this.rocks.length = 0;
    this.player = null;
    this.npc = null;
    this.camera = null;
    if (global.HUD) global.HUD.toast('');
  };

  global.WorldScene = WorldScene;
})(window);
