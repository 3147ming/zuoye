/* ============================================================
 * fireice.js —— 森林冰火人（单人切换双角色，6 关）
 * ------------------------------------------------------------
 * 一个玩家用 Tab 切换火人 / 冰人，合作走到各自的门口。
 *   火人：踩岩浆安全，进水池死
 *   冰人：踩水池安全，进岩浆死
 *   毒液：两人都会死
 *
 * 版式：地面顶面 = 第 13 行（y=520），上层长廊 = 第 9 行（y=360）
 * 角色 66px 高 → 站在地面占第 11~12 行，站在长廊占第 7~8 行
 * ============================================================ */
(function (global) {
  'use strict';

  var VIEW_W = 1280;
  var VIEW_H = 720;
  var COLS = 32;
  var ROWS = 18;
  var TILE = 40;

  /* 与大厅同一套手感口径 */
  var MAX_SPEED = 330;
  var ACCEL = 2800;
  var FRICTION = 2400;
  var GRAVITY = 2400;
  var FALL_MUL = 1.28;
  var JUMP_V = 790;
  var JUMP_CUT = 300;
  var COYOTE = 0.10;
  var MAX_FALL = 1500;
  var BODY_W = 34;
  var BODY_H = 66;

  /* ---- 第四~六关的新机关 ---- */
  var PLAT_H = 22;          /* 升降平台厚度 */
  var LOCK_HOLD = 3.0;      /* 松开压力板后锁门还开多久 */
  var TP_DELAY = 0.25;      /* 站在传送阵上多久生效 */
  var TP_CD = 0.5;          /* 单个阵的传送冷却 */
  var TP_INV = 0.3;         /* 传送后的无敌（不参与伤害计算，只防连传） */
  var TP_FX = 0.35;         /* 粒子动画时长 */

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  var C = {
    paper: '#fdf3e4',
    dim: 'rgba(253, 243, 228, 0.46)',
    fire: '#e8545f',
    fireWarm: '#f0a066',
    ice: '#5fc3ff',
    iceDeep: '#2a6fb8',
    poison: '#8cc96a',
    wall: '#171226',
    wallTop: 'rgba(240, 167, 110, 0.40)'
  };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* 站立判定：脚底判定用的是 y-1，落地后每帧会在 y 与 y+ε 之间弹 0.6px，
     onGround 于是隔一帧闪一次。压力板 / 传送阵这种「站满多久」的计时必须容忍它，
     否则计时会被反复清零。updateChar 末尾维护一个 0.08s 宽限。 */
  function isGrounded(c) { return c.onGround || c.groundT > 0; }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  function rr(ctx, x, y, w, h, r) {
    var k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - k, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + k);
    ctx.lineTo(x + w, y + h - k);
    ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - k);
    ctx.lineTo(x, y + k);
    ctx.quadraticCurveTo(x, y, x + k, y);
    ctx.closePath();
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function panel(ctx, x, y, w, h, accent) {
    ctx.save();
    ctx.shadowColor = 'rgba(4, 3, 9, 0.7)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    rr(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(20, 15, 34, 0.93)';
    ctx.fill();
    ctx.restore();

    rr(ctx, x, y, w, h, 18);
    ctx.strokeStyle = accent || 'rgba(240, 167, 110, 0.52)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    rr(ctx, x + 6.5, y + 6.5, w - 13, h - 13, 13);
    ctx.strokeStyle = 'rgba(255, 217, 168, 0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ============================================================
   * 关卡数据（32 列 × 18 行，逐格令牌）
 *   # 墙  . 空  L 岩浆  W 水池  P 毒液
 *   1 火人出生  2 冰人出生  G1/G2 火/冰之门
 *   S1/S2 火/冰踏板 → 打开本关所有 D1/D2 机关门
 *   G3 锁门（4 格高，跳不过去） + S3 解锁压力板（松开后保持 3 秒）
 *   T1/T2 传送阵（成对，站满 0.25s 传送）
 * ============================================================ */
  var LEVELS = [
    {
      name: '第一关 · 各走各路',
      hint: '火人走上面，冰人走下面 —— 别踩错颜色',
      rows: [
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..1.2....................G1....#',
        '#.#####..#####LLLLLLL#########.#',
        '#..............................#',
        '#..............................#',
        '#...........................G2..#',
        '##############WWWWWWW###########',
        '################################',
        '################################',
        '################################',
        '################################'
      ]
    },
    {
      name: '第二关 · 你替我开门',
      hint: '火踏板开冰人的门，冰踏板开火人的门 —— 得来回切',
      rows: [
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#....................D1.........#',
        '#..1.2...S2...........D1....G1....#',
        '#.####..####LLLLLL############.#',
        '#..............................#',
        '#....................D2.........#',
        '#........S1...........D2......G2..#',
        '############WWWWWW##############',
        '################################',
        '################################',
        '################################',
        '################################'
      ]
    },
    {
      name: '第三关 · 断桥与毒液',
      hint: '断口是路，不是坑 —— 毒液两个人都碰不得',
      rows: [
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#.12...........................#',
        '#.##..LLLLL..###........PP####.#',
        '#..............................#',
        '#..............................#',
        '#.........................G1..G2.#',
        '######WWWWW#########PP##########',
        '################################',
        '################################',
        '################################',
        '################################'
      ]
    },
    {
      name: '第四关 · 会动的桥',
      hint: '踩上浮台，等它升过台沿再往右走',
      /* 平台顶面 y = yBase + amp·sin(phase + t·omega)
         omega = π rad/s ⇔ 0.5Hz（周期 2s），amp = 120px，行程 280 ~ 520
         两块相位相反：一块在顶时另一块在底，只能先后踩 */
      platforms: [
        { col: 10, w: 3, yBase: 400, amp: 120, omega: Math.PI, phase: Math.PI / 2 },
        { col: 20, w: 3, yBase: 400, amp: 120, omega: Math.PI, phase: -Math.PI / 2 }
      ],
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#...............G1.........G2....#',
        '#............######....######..#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..1.2.........................#',
        '################################',
        '################################',
        '################################',
        '################################',
        '################################'
      ]
    },
    {
      name: '第五关 · 替我守住门',
      hint: '一个人踩住压力板，另一个人先过；松脚后门只开 3 秒',
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#...........G3..................#',
        '#...........G3..................#',
        '#...........G3..................#',
        '#..1.2...S3..G3...G1...G2..........#',
        '################################',
        '################################',
        '################################',
        '################################',
        '################################'
      ]
    },
    {
      name: '第六关 · 两座传送阵',
      hint: '毒液湖过不去 —— 站上法阵，等它把你送到对岸',
      rows: [
        '################################',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#..............................#',
        '#........................G3.....#',
        '#........................G3.....#',
        '#........................G3.....#',
        '#..1.2T1...............T2.S3G3.G1..G2#',
        '########PPPPPPPPPPPPP###########',
        '################################',
        '################################',
        '################################',
        '################################'
      ]
    }
  ];

  var TOKEN_RE = /G1|G2|G3|S1|S2|S3|D1|D2|T1|T2|./g;

  function parseRow(str) {
    return str.match(TOKEN_RE) || [];
  }

  /* ============================================================
   * 背景：黄昏森林，一次预渲染
   * ============================================================ */
  function buildBackdrop() {
    var c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    var g = c.getContext('2d');
    var rng = mulberry32(20261102);

    var sky = g.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, '#07070f');
    sky.addColorStop(0.30, '#131029');
    sky.addColorStop(0.55, '#291b39');
    sky.addColorStop(0.76, '#412640');
    sky.addColorStop(0.90, '#2a1a2e');
    sky.addColorStop(1, '#120d1d');
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 月轮 */
    var mx = 1010, my = 132, mr = 52;
    var halo = g.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5.5);
    halo.addColorStop(0, 'rgba(255, 220, 175, 0.30)');
    halo.addColorStop(0.35, 'rgba(255, 176, 132, 0.11)');
    halo.addColorStop(1, 'rgba(255, 150, 110, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, VIEW_W, 520);

    g.fillStyle = 'rgba(255, 236, 210, 0.95)';
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(120, 92, 110, 0.16)';
    g.beginPath();
    g.arc(mx - 15, my - 13, 11, 0, Math.PI * 2);
    g.arc(mx + 13, my + 9, 17, 0, Math.PI * 2);
    g.fill();

    /* 远山：两层剪影 */
    function ridge(baseY, amp, color, step) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(-40, VIEW_H);
      var x = -40;
      g.lineTo(x, baseY);
      while (x < VIEW_W + 60) {
        x += step;
        g.lineTo(x, baseY - amp * (0.32 + rng() * 0.68));
      }
      g.lineTo(x, VIEW_H);
      g.closePath();
      g.fill();
    }
    ridge(420, 150, '#221838', 150);
    ridge(474, 110, '#191227', 118);

    /* 森林：三层针叶剪影，越近越暗，顶缘留一点月光 */
    function forest(baseY, h0, h1, color, rim, count) {
      for (var i = 0; i < count; i++) {
        var x = rng() * (VIEW_W + 120) - 60;
        var h = h0 + rng() * (h1 - h0);
        var w = h * (0.28 + rng() * 0.12);
        g.fillStyle = color;
        for (var k = 0; k < 3; k++) {
          var by = baseY - h * k * 0.25;
          var ww = w * (1 - k * 0.24);
          g.beginPath();
          g.moveTo(x, by - h * 0.5);
          g.lineTo(x + ww, by);
          g.lineTo(x - ww, by);
          g.closePath();
          g.fill();
          if (rim && k === 2) {
            g.strokeStyle = rim;
            g.lineWidth = 1.2;
            g.stroke();
          }
        }
        g.fillRect(x - 2, baseY - h * 0.25, 4, h * 0.25);
      }
    }
    forest(516, 130, 240, '#181128', 'rgba(120, 96, 150, 0.22)', 16);
    forest(552, 200, 330, '#0f0a1b', 'rgba(90, 70, 120, 0.16)', 11);
    forest(584, 250, 400, '#080511', null, 7);

    /* 悬灯：几粒暖光，把大片空天填出层次 */
    var lamps = [[168, 168], [392, 96], [612, 210], [826, 126], [1096, 232], [1226, 158]];
    for (var li = 0; li < lamps.length; li++) {
      var lx = lamps[li][0], ly = lamps[li][1];
      var lg = g.createRadialGradient(lx, ly, 0, lx, ly, 60);
      lg.addColorStop(0, 'rgba(255, 206, 148, 0.30)');
      lg.addColorStop(0.35, 'rgba(255, 176, 110, 0.10)');
      lg.addColorStop(1, 'rgba(255, 160, 100, 0)');
      g.fillStyle = lg;
      g.fillRect(lx - 60, ly - 60, 120, 120);
      g.fillStyle = 'rgba(255, 226, 180, 0.85)';
      g.beginPath();
      g.arc(lx, ly, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    /* 雾带 */
    var fog = g.createLinearGradient(0, 360, 0, 560);
    fog.addColorStop(0, 'rgba(150, 116, 124, 0)');
    fog.addColorStop(0.5, 'rgba(160, 122, 124, 0.12)');
    fog.addColorStop(1, 'rgba(120, 90, 100, 0)');
    g.fillStyle = fog;
    g.fillRect(0, 360, VIEW_W, 200);

    /* 暗角 */
    var vig = g.createRadialGradient(VIEW_W * 0.5, VIEW_H * 0.46, VIEW_H * 0.3,
                                     VIEW_W * 0.5, VIEW_H * 0.5, VIEW_H * 1.02);
    vig.addColorStop(0, 'rgba(4, 3, 10, 0)');
    vig.addColorStop(0.7, 'rgba(4, 3, 10, 0.24)');
    vig.addColorStop(1, 'rgba(3, 2, 7, 0.76)');
    g.fillStyle = vig;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    return c;
  }

  /* 光斑贴图：比逐帧建渐变便宜得多 */
  function makeGlow(color, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var r = size / 2;
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color);
    grd.addColorStop(0.4, color.replace(/[\d.]+\)$/, '0.16)'));
    grd.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /* ============================================================
   * 静态地形：整张离屏画布，loadLevel 时烘焙一次
   * ============================================================ */
  function hash2(x, y) {
    var n = (x * 374761393 + y * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function buildTerrain(grid) {
    var c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    var g = c.getContext('2d');
    var i, k, x, y;

    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        if (grid[y][x] !== '#') continue;

        var px = x * TILE;
        var py = y * TILE;
        var up = y > 0 ? grid[y - 1][x] : '.';
        var exposed = (up !== '#' && up !== 'L' && up !== 'W' && up !== 'P' && up !== 'D1' && up !== 'D2');

        var grd = g.createLinearGradient(0, py, 0, py + TILE);
        grd.addColorStop(0, exposed ? '#3d3060' : '#2b2246');
        grd.addColorStop(0.45, exposed ? '#312651' : '#221a38');
        grd.addColorStop(1, '#191330');
        g.fillStyle = grd;
        g.fillRect(px, py, TILE, TILE);

        if (exposed) {
          /* 顶面暖边 + 向内的柔光，让地面有厚度 */
          g.fillStyle = 'rgba(255, 218, 176, 0.66)';
          g.fillRect(px, py, TILE, 3);
          var soft = g.createLinearGradient(0, py + 3, 0, py + 18);
          soft.addColorStop(0, 'rgba(255, 200, 150, 0.18)');
          soft.addColorStop(1, 'rgba(255, 200, 150, 0)');
          g.fillStyle = soft;
          g.fillRect(px, py + 3, TILE, 15);

          /* 草叶：稀疏几簇，别做成栅栏 */
          if (hash2(x, y) > 0.55) {
            g.strokeStyle = 'rgba(150, 120, 96, 0.55)';
            g.lineWidth = 1.6;
            g.lineCap = 'round';
            var bx = px + 6 + hash2(y, x) * 26;
            var bh = 5 + hash2(x + 3, y) * 6;
            g.beginPath();
            g.moveTo(bx, py + 2);
            g.quadraticCurveTo(bx - 2, py - bh * 0.6, bx - 4, py - bh);
            g.moveTo(bx + 3, py + 2);
            g.quadraticCurveTo(bx + 3, py - bh * 0.7, bx + 6, py - bh * 0.9);
            g.stroke();
          }
        } else {
          /* 深部：横缝 + 一层更暗的底，避免整块死板 */
          g.fillStyle = 'rgba(0, 0, 0, 0.22)';
          g.fillRect(px, py + TILE - 1, TILE, 1);
          if (hash2(x, y) > 0.45) {
            g.fillStyle = 'rgba(255, 226, 190, 0.045)';
            g.fillRect(px + 5, py + 14 + ((hash2(y, x) * 12) | 0), TILE - 10, 2);
          }
        }

        /* 侧边暗线：只在真正临空的一侧画 */
        if (x > 0 && grid[y][x - 1] !== '#') {
          g.fillStyle = 'rgba(0, 0, 0, 0.30)';
          g.fillRect(px, py, 2, TILE);
        }
        if (x < COLS - 1 && grid[y][x + 1] !== '#') {
          g.fillStyle = 'rgba(0, 0, 0, 0.24)';
          g.fillRect(px + TILE - 2, py, 2, TILE);
        }
      }
    }

    /* 平台下方压一层投影，把「悬空的长廊」和背景分开 */
    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        if (grid[y][x] !== '#') continue;
        var below = y < ROWS - 1 ? grid[y + 1][x] : '#';
        if (below === '#') continue;
        var sx = x * TILE;
        var sy = (y + 1) * TILE;
        var sh = g.createLinearGradient(0, sy, 0, sy + 26);
        sh.addColorStop(0, 'rgba(4, 3, 10, 0.42)');
        sh.addColorStop(1, 'rgba(4, 3, 10, 0)');
        g.fillStyle = sh;
        g.fillRect(sx, sy, TILE, 26);
      }
    }

    /* 全局纸纹，和剪纸语言对齐 */
    for (i = 0; i < 2; i++) {
      g.globalAlpha = 0.5;
      g.globalCompositeOperation = 'overlay';
      for (k = 0; k < 400; k++) {
        g.fillStyle = 'rgba(255, 240, 210, ' + (0.02 + hash2(k, i) * 0.03).toFixed(3) + ')';
        g.fillRect(hash2(k, i + 9) * VIEW_W, hash2(i + 3, k) * VIEW_H, 2, 2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    return c;
  }

  /* ============================================================
   * 场景
   * ============================================================ */
  function FireIceScene() {
    this.t = 0;
    this.level = 0;
    this.state = 'title';       // title | playing | dead | clear | win
    this.timer = 0;
    this.active = 'fire';

    this.grid = null;
    this.chars = null;
    this.plates = { S1: false, S2: false };
    this.doors = { G1: null, G2: null };
    this.spawn = { 1: null, 2: null };

    /* 新机关 */
    this.lt = 0;                       /* 本关时间：平台的相位靠它算，重开关卡归零 */
    this.platforms = [];
    this.pads = { T1: null, T2: null };
    this.lock = { pressed: false, t: 0 };
    this.fx = [];

    this.keys = { left: false, right: false, jumpBuf: 0, jumpHeld: false };
    this.bg = null;
    this.canvas = null;
    this.btn = null;
    this.motes = [];

    this._onKey = null;
    this._onKeyUp = null;
    this._onClick = null;
    this._onBlur = null;
  }

  /* ---------------- 关卡装载 ---------------- */
  FireIceScene.prototype.loadLevel = function (index) {
    var lv = LEVELS[index];
    var rows = lv.rows;
    var grid = [];
    var y, x;

    this.level = index;
    this.plates = { S1: false, S2: false };
    this.doors = { G1: null, G2: null };
    this.spawn = { 1: null, 2: null };

    this.lt = 0;
    this.lock = { pressed: false, t: 0 };
    this.fx = [];
    this.pads = { T1: null, T2: null };
    this.platforms = [];

    var plats = lv.platforms || [];
    for (var k = 0; k < plats.length; k++) {
      var src = plats[k];
      this.platforms.push({
        x: src.col * TILE,
        w: src.w * TILE,
        yBase: src.yBase,
        amp: src.amp,
        omega: src.omega,
        phase: src.phase,
        y: src.yBase
      });
    }

    for (y = 0; y < ROWS; y++) {
      var row = parseRow(rows[y]);
      var line = [];
      for (x = 0; x < COLS; x++) {
        var t = row[x] || '.';
        line.push(t);
        if (t === '1') this.spawn[1] = { x: x, y: y };
        else if (t === '2') this.spawn[2] = { x: x, y: y };
        else if (t === 'G1' || t === 'G2') this.doors[t] = { x: x, y: y };
        else if (t === 'T1' || t === 'T2') this.pads[t] = { x: x, y: y };
      }
      grid.push(line);
    }
    this.grid = grid;
    this.terrain = buildTerrain(grid);

    this.chars = {
      fire: this.makeChar('fire', this.spawn[1] || { x: 3, y: 8 }),
      ice: this.makeChar('ice', this.spawn[2] || { x: 5, y: 8 })
    };
    this.active = 'fire';

    this.state = index === 0 && this.state === 'title' ? 'title' : 'playing';
    this.timer = 0;
    this.keys.left = this.keys.right = false;
    this.keys.jumpBuf = 0;
  };

  FireIceScene.prototype.makeChar = function (kind, cell) {
    return {
      kind: kind,
      x: (cell.x + 0.5) * TILE,
      y: (cell.y + 1) * TILE,
      vx: 0,
      vy: 0,
      w: BODY_W,
      h: BODY_H,
      onGround: true,
      facing: 1,
      walk: 0,
      speedRatio: 0,
      squash: 0,
      coyote: COYOTE,
      dead: false,
      platform: null,                                   /* 正踩着的升降平台 */
      groundT: 0,                                       /* 站立宽限，见 isGrounded */
      tp: { t: 0, cd: 0, inv: 0, mustLeave: false }     /* 传送阵计时 */
    };
  };

  /* ---------------- 碰撞 ---------------- */
  FireIceScene.prototype.solidCell = function (cx, cy) {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return true;
    var t = this.grid[cy][cx];
    if (t === '#' || t === 'L' || t === 'W' || t === 'P') return true;
    if (t === 'D1') return !this.plates.S1;
    if (t === 'D2') return !this.plates.S2;
    if (t === 'G3') return !this.lockOpen();     /* 锁门：开锁期间可穿过 */
    return false;
  };

  /* 锁门是否开着：踩着板子时一直开，松开后按计时再撑 3 秒 */
  FireIceScene.prototype.lockOpen = function () {
    return this.lock.pressed || this.lock.t > 0;
  };

  FireIceScene.prototype.hits = function (c) {
    var l = c.x - c.w / 2;
    var r = c.x + c.w / 2;
    var top = c.y - c.h;
    var bot = c.y - 1;
    var x0 = Math.floor(l / TILE);
    var x1 = Math.floor(r / TILE);
    var y0 = Math.floor(top / TILE);
    var y1 = Math.floor(bot / TILE);
    for (var yy = y0; yy <= y1; yy++) {
      for (var xx = x0; xx <= x1; xx++) {
        if (this.solidCell(xx, yy)) return true;
      }
    }
    return false;
  };

  /* 脚底所在格：站地面时是地面方块上方那一格，正好是角色的身体格 */
  FireIceScene.prototype.footCell = function (c) {
    return {
      x: clamp(Math.floor(c.x / TILE), 0, COLS - 1),
      y: clamp(Math.floor((c.y - 1) / TILE), 0, ROWS - 1)
    };
  };

  FireIceScene.prototype.standCell = function (c) {
    var fy = clamp(Math.round(c.y / TILE), 0, ROWS - 1);
    return {
      x: clamp(Math.floor(c.x / TILE), 0, COLS - 1),
      y: fy,
      tile: this.grid[fy][clamp(Math.floor(c.x / TILE), 0, COLS - 1)]
    };
  };

  /* ---------------- 单角色物理 ---------------- */
  FireIceScene.prototype.updateChar = function (c, dt, control) {
    var k = this.keys;
    var dir = 0;

    if (control) {
      dir = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    }

    if (dir !== 0) {
      c.vx += dir * ACCEL * dt;
      c.facing = dir;
    } else {
      var f = FRICTION * dt;
      if (Math.abs(c.vx) <= f) c.vx = 0;
      else c.vx -= (c.vx > 0 ? 1 : -1) * f;
    }
    c.vx = clamp(c.vx, -MAX_SPEED, MAX_SPEED);

    if (c.onGround) c.coyote = COYOTE;
    else c.coyote = Math.max(0, c.coyote - dt);

    if (control && k.jumpBuf > 0 && c.coyote > 0) {
      c.vy = -JUMP_V;
      c.onGround = false;
      c.coyote = 0;
      c.squash = -0.36;
      c.platform = null;
      c.groundT = 0;
      k.jumpBuf = 0;
    }

    if (!k.jumpHeld && c.vy < -JUMP_CUT) c.vy = -JUMP_CUT;

    c.vy += GRAVITY * (c.vy > 0 ? FALL_MUL : 1) * dt;
    if (c.vy > MAX_FALL) c.vy = MAX_FALL;

    c.x += c.vx * dt;
    if (this.hits(c)) {
      c.x -= c.vx * dt;
      c.vx = 0;
    }

    var wasAir = !c.onGround;
    var prevY = c.y;
    c.y += c.vy * dt;
    c.onGround = false;
    if (this.hits(c)) {
      c.y -= c.vy * dt;
      if (c.vy > 0) {
        c.y = Math.round(c.y / TILE) * TILE;
        c.onGround = true;
        if (wasAir && c.vy > 240) c.squash = Math.min(1, c.vy / 1300);
      }
      c.vy = 0;
    }

    /* ---- 升降平台：先判「从上方落到平台」，再判「已经站在平台上」 ---- */
    var pi, pl, landed = null;
    for (pi = 0; pi < this.platforms.length; pi++) {
      pl = this.platforms[pi];
      if (c.x < pl.x - 4 || c.x > pl.x + pl.w + 4) continue;
      /* ① 从上往下踩住顶面 */
      if (c.vy >= 0 && prevY <= pl.y + 3 && c.y >= pl.y) { landed = pl; break; }
      /* ② 浮台自己升上来顶到脚底（也顺带接住往上跳的人） */
      if (pl.y < prevY - 1 && pl.y >= c.y - c.h) { landed = pl; break; }
    }
    if (landed) {
      c.y = landed.y;
      c.vy = 0;
      c.onGround = true;
      c.platform = landed;
    } else if (c.platform) {
      /* 平台在动：脚底直接钉在平台顶面，上升下降都跟住 */
      pl = c.platform;
      if (c.x >= pl.x - 4 && c.x <= pl.x + pl.w + 4) {
        c.y = pl.y;
        c.vy = 0;
        c.onGround = true;
      } else {
        c.platform = null;      /* 走出平台边缘，交给重力 */
      }
    }

    c.x = clamp(c.x, TILE * 0.5 + 2, VIEW_W - TILE * 0.5 - 2);

    var sp = Math.abs(c.vx);
    c.speedRatio = Math.min(1, sp / MAX_SPEED);
    c.walk += (c.onGround ? sp : 200) * dt * 0.045;
    c.squash += (0 - c.squash) * Math.min(1, dt * 11);
    c.groundT = c.onGround ? 0.08 : Math.max(0, c.groundT - dt);
  };

  /* ---------------- 属性克制 ---------------- */
  FireIceScene.prototype.hazardKills = function (kind, tile) {
    if (tile === 'P') return true;
    if (tile === 'L') return kind !== 'fire';
    if (tile === 'W') return kind !== 'ice';
    return false;
  };

  FireIceScene.prototype.checkChar = function (c) {
    /* 掉出画面（理论上地面是实心的，兜底用） */
    if (c.y > VIEW_H + 80) {
      this.kill(c);
      return;
    }
    /* 刚传完的 0.3 秒不判死：落点附近就算有液体也不该被瞬杀 */
    if (c.tp.inv > 0) return;
    if (!c.onGround) return;

    /* 站在升降平台上时脚底悬空，脚下的格子不作数 */
    if (c.platform) return;

    var st = this.standCell(c);
    if (this.hazardKills(c.kind, st.tile)) {
      this.kill(c);
      return;
    }

    var fc = this.footCell(c);

    /* 踏板：踩下即锁定，本关一直开着 */
    if (this.grid[fc.y][fc.x] === 'S1' && !this.plates.S1) {
      this.plates.S1 = true;
      this.plateFlash = 1;
    }
    if (this.grid[fc.y][fc.x] === 'S2' && !this.plates.S2) {
      this.plates.S2 = true;
      this.plateFlash = 1;
    }
  };

  FireIceScene.prototype.kill = function (c) {
    c.dead = true;
    this.state = 'dead';
    this.timer = 0;
    this.deadKind = c.kind;
    sfx('dead');
  };

  /* ---------------- 新机关：升降平台 ---------------- */
  /* 平台顶面：y = yBase + amp·sin(phase + lt·omega)（omega=π 即 0.5Hz，周期 2s） */
  FireIceScene.prototype.updatePlatforms = function () {
    for (var i = 0; i < this.platforms.length; i++) {
      var p = this.platforms[i];
      p.y = p.yBase + p.amp * Math.sin(p.phase + this.lt * p.omega);
    }
  };

  /* ---------------- 新机关：S3 压力板 + G3 锁门 ---------------- */
  /* 两个角色任意一个站上去就算踩住 */
  FireIceScene.prototype.onPlate = function (id) {
    var list = [this.chars.fire, this.chars.ice];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.dead || !isGrounded(c) || c.platform) continue;
      var fc = this.footCell(c);
      if (this.grid[fc.y][fc.x] === id) return c;
    }
    return null;
  };

  FireIceScene.prototype.updateLock = function (dt) {
    if (this.lock.t > 0) this.lock.t = Math.max(0, this.lock.t - dt);

    var holder = this.onPlate('S3');
    if (holder) {
      if (!this.lock.pressed) {
        this.plateFlash = 1;
        sfx('ui');
      }
      this.lock.pressed = true;
      this.lock.t = LOCK_HOLD;      /* 踩着就一直满格，松脚才开始倒数 */
    } else {
      this.lock.pressed = false;
    }
  };

  /* ---------------- 新机关：T1 / T2 传送阵 ---------------- */
  FireIceScene.prototype.padUnder = function (c) {
    if (!c || c.dead || !isGrounded(c) || c.platform) return null;
    var fc = this.footCell(c);
    var t = this.grid[fc.y][fc.x];
    return (t === 'T1' || t === 'T2') ? t : null;
  };

  FireIceScene.prototype.updatePortals = function (dt) {
    var list = [this.chars.fire, this.chars.ice];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var tp = c.tp;
      if (tp.cd > 0) tp.cd = Math.max(0, tp.cd - dt);
      if (tp.inv > 0) tp.inv = Math.max(0, tp.inv - dt);

      var id = this.padUnder(c);
      if (!id) { tp.t = 0; tp.mustLeave = false; continue; }
      /* 刚落地的那座阵要等人走开才能再用，避免原地来回抖 */
      if (tp.mustLeave || tp.cd > 0) { tp.t = 0; continue; }

      tp.t += dt;
      if (tp.t >= TP_DELAY) this.teleport(c, id);
    }
  };

  FireIceScene.prototype.teleport = function (c, from) {
    var destId = from === 'T1' ? 'T2' : 'T1';
    var to = this.pads[destId];
    if (!to) return;

    var x0 = c.x;
    var y0 = c.y;

    c.x = (to.x + 0.5) * TILE;
    c.y = (to.y + 1) * TILE;
    c.vx = 0;
    c.vy = 0;
    c.platform = null;
    c.onGround = true;
    c.tp.t = 0;
    c.tp.cd = TP_CD;
    c.tp.inv = TP_INV;
    c.tp.mustLeave = true;

    this.spawnFx(x0, y0 - 34, from, 14);
    this.spawnFx(c.x, c.y - 34, destId, 20);
    sfx('portal');
  };

  FireIceScene.prototype.spawnFx = function (x, y, kind, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 50 + Math.random() * 150;
      var life = TP_FX * (0.55 + Math.random() * 0.55);
      this.fx.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 70,
        life: life, max: life,
        r: 1.3 + Math.random() * 2.4,
        kind: kind
      });
    }
  };

  FireIceScene.prototype.updateFx = function (dt) {
    for (var i = this.fx.length - 1; i >= 0; i--) {
      var f = this.fx[i];
      f.life -= dt;
      if (f.life <= 0) { this.fx.splice(i, 1); continue; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 220 * dt;
      f.vx *= 0.985;
    }
    if (this.fx.length > 240) this.fx.splice(0, this.fx.length - 240);
  };

  FireIceScene.prototype.findTile = function (id) {
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (this.grid[y][x] === id) return { x: x, y: y };
      }
    }
    return null;
  };

  /* ---------------- 输入 ---------------- */
  FireIceScene.prototype.onKey = function (e) {
    var k = this.keys;

    if (e.code === 'Escape') {
      e.preventDefault();
      this.toHall();
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
      if (this.state === 'title') this.state = 'playing';
      else if (this.state === 'playing') {
        this.active = this.active === 'fire' ? 'ice' : 'fire';
        sfx('ui');
      }
      return;
    }

    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.state === 'title') { e.preventDefault(); this.state = 'playing'; }
      else if (this.state === 'win') { e.preventDefault(); this.toHall(); }
      return;
    }

    if (e.code === 'KeyR') {
      e.preventDefault();
      if (this.state === 'playing' || this.state === 'dead' || this.state === 'clear') {
        var lv = this.level;
        this.state = 'playing';
        this.loadLevel(lv);
        this.state = 'playing';
      }
      return;
    }

    if (e.code === 'KeyA' || e.code === 'ArrowLeft') { k.left = true; e.preventDefault(); }
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') { k.right = true; e.preventDefault(); }
    else if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') {
      if (!k.jumpHeld) k.jumpBuf = 0.14;
      k.jumpHeld = true;
      if (this.state === 'title') this.state = 'playing';
      e.preventDefault();
    }
  };

  FireIceScene.prototype.onKeyUp = function (e) {
    var k = this.keys;
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') k.left = false;
    else if (e.code === 'KeyD' || e.code === 'ArrowRight') k.right = false;
    else if (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') k.jumpHeld = false;
  };

  FireIceScene.prototype.onClick = function (e) {
    if (this.state !== 'win' || !this.btn) return;
    var c = this.canvas;
    var r = c.getBoundingClientRect();
    var x = (e.clientX - r.left) * VIEW_W / r.width;
    var y = (e.clientY - r.top) * VIEW_H / r.height;
    var b = this.btn;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) this.toHall();
  };

  FireIceScene.prototype.toHall = function () {
    if (global.SceneManager) global.SceneManager.change('world');
  };

  /* ---------------- 生命周期 ---------------- */
  FireIceScene.prototype.init = function (ctx) {
    var self = this;
    this.canvas = (ctx && ctx.canvas) || global.SceneManager.canvas;
    this.bg = buildBackdrop();
    this.glows = {
      L: makeGlow('rgba(232, 84, 95, 0.55)', 160),
      W: makeGlow('rgba(95, 195, 255, 0.50)', 160),
      P: makeGlow('rgba(140, 201, 106, 0.50)', 160)
    };
    this.t = 0;
    this.state = 'title';
    this.deadKind = null;
    this.plateFlash = 0;
    this.btn = null;

    this.motes = [];
    var rng = mulberry32(778899);
    for (var i = 0; i < 46; i++) {
      this.motes.push({
        x: rng() * VIEW_W,
        y: 120 + rng() * 420,
        r: 0.9 + rng() * 2,
        v: 5 + rng() * 16,
        p: rng() * Math.PI * 2,
        s: 0.4 + rng() * 0.9
      });
    }

    this.loadLevel(0);

    this._onKey = function (e) { self.onKey(e); };
    this._onKeyUp = function (e) { self.onKeyUp(e); };
    this._onClick = function (e) { self.onClick(e); };
    this._onBlur = function () {
      self.keys.left = false;
      self.keys.right = false;
      self.keys.jumpHeld = false;
      self.keys.jumpBuf = 0;
    };

    global.addEventListener('keydown', this._onKey);
    global.addEventListener('keyup', this._onKeyUp);
    global.addEventListener('blur', this._onBlur);
    if (this.canvas) this.canvas.addEventListener('click', this._onClick);

    if (global.HUD) global.HUD.toast('');
  };

  FireIceScene.prototype.update = function (dt) {
    this.t += dt;
    this.lt += dt;
    this.updatePlatforms();
    this.updateFx(dt);
    if (this.plateFlash > 0) this.plateFlash = Math.max(0, this.plateFlash - dt * 1.6);
    this.keys.jumpBuf = Math.max(0, this.keys.jumpBuf - dt);

    /* 尘埃 */
    for (var i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * m.s + m.p) * 8 * dt;
      if (m.y < 90) { m.y = 560; m.x = Math.random() * VIEW_W; }
    }

    if (this.state === 'title' || this.state === 'win') return;

    if (this.state === 'dead') {
      this.timer += dt;
      if (this.timer > 0.85) {
        var lv = this.level;
        this.state = 'playing';
        this.loadLevel(lv);
        this.state = 'playing';
      }
      return;
    }

    if (this.state === 'clear') {
      this.timer += dt;
      if (this.timer > 1.35) {
        if (this.level < LEVELS.length - 1) {
          this.loadLevel(this.level + 1);
          this.state = 'playing';
        } else {
          this.state = 'win';
          this.timer = 0;
          sfx('win');
          /* 六关全通：点亮大厅里的冰火人门 */
          if (global.Save && global.Save.complete && !global.Save.isCleared('fireice')) {
            global.Save.complete('fireice');
          }
        }
      }
      return;
    }

    /* playing */
    this.updateChar(this.chars.fire, dt, this.active === 'fire');
    this.updateChar(this.chars.ice, dt, this.active === 'ice');

    this.updateLock(dt);
    this.updatePortals(dt);

    this.checkChar(this.chars.fire);
    if (this.state !== 'playing') return;
    this.checkChar(this.chars.ice);
    if (this.state !== 'playing') return;

    /* 两扇门同时踩住 → 过关 */
    var f = this.footCell(this.chars.fire);
    var ic = this.footCell(this.chars.ice);
    var g1 = this.doors.G1;
    var g2 = this.doors.G2;

    if (g1 && g2 &&
        f.x === g1.x && f.y === g1.y &&
        ic.x === g2.x && ic.y === g2.y) {
      this.state = 'clear';
      this.timer = 0;
    }
  };

  /* ---------------- 绘制 ---------------- */
  FireIceScene.prototype.render = function (ctx) {
    var i, y, x;

    ctx.drawImage(this.bg, 0, 0);

    /* 尘埃 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      var a = 0.12 + 0.26 * Math.abs(Math.sin(this.t * m.s + m.p));
      ctx.fillStyle = 'rgba(255, 200, 150, ' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 静态地形：整张烘焙好的图一次贴上 */
    if (this.terrain) ctx.drawImage(this.terrain, 0, 0);

    /* 升降平台：在地形之上、液体之下 */
    this.drawPlatforms(ctx);

    /* 液体：只有几十格，逐帧画波面 */
    for (y = 0; y < ROWS; y++) {
      for (x = 0; x < COLS; x++) {
        var t = this.grid[y][x];
        if (t === 'L' || t === 'W' || t === 'P') this.drawHazard(ctx, t, x, y);
      }
    }

    /* 传送阵：贴地，压在角色下面 */
    this.drawPads(ctx);

    /* 机关门 */
    this.drawGates(ctx);

    /* 门 */
    if (this.doors.G1) this.drawDoor(ctx, this.doors.G1, 'fire');
    if (this.doors.G2) this.drawDoor(ctx, this.doors.G2, 'ice');

    /* 踏板 */
    this.drawPlate(ctx, 'S1', 'fire');
    this.drawPlate(ctx, 'S2', 'ice');
    this.drawLockPlate(ctx);

    /* 角色：非当前角色先画，避免盖住当前角色 */
    var order = this.active === 'fire' ? ['ice', 'fire'] : ['fire', 'ice'];
    for (i = 0; i < order.length; i++) {
      this.drawChar(ctx, this.chars[order[i]], order[i] === this.active);
    }

    /* 传送粒子压在角色前面，才有「从身上冒出来」的感觉 */
    this.drawFx(ctx);

    this.drawHud(ctx);

    if (this.state === 'title') this.drawTitle(ctx);
    if (this.state === 'dead') this.drawDead(ctx);
    if (this.state === 'clear') this.drawClear(ctx);
    if (this.state === 'win') this.drawWin(ctx);
  };

  /* 液体：墙体和地面已经在静态地形里烘焙好了，这里只画会动的液体 */
  FireIceScene.prototype.drawHazard = function (ctx, t, x, y) {
    var px = x * TILE;
    var py = y * TILE;
    var above = y > 0 ? this.grid[y - 1][x] : '.';
    var surface = above !== 'L' && above !== 'W' && above !== 'P';

    var pal = t === 'L'
      ? { a: '#f0a066', b: '#a8253c', glow: this.glows.L, rim: 'rgba(255, 180, 130, 0.85)' }
      : t === 'W'
        ? { a: '#79c8ff', b: '#1d3a6b', glow: this.glows.W, rim: 'rgba(190, 235, 255, 0.8)' }
        : { a: '#a8d97a', b: '#33562c', glow: this.glows.P, rim: 'rgba(200, 240, 150, 0.8)' };

    var g = ctx.createLinearGradient(0, py, 0, py + TILE);
    g.addColorStop(0, pal.a);
    g.addColorStop(1, pal.b);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, TILE, TILE);

    if (surface) {
      /* 液面：一格一相位，接缝处自然连成一道波 */
      var amp = t === 'L' ? 2.4 : 1.8;
      ctx.beginPath();
      ctx.moveTo(px, py + 4);
      for (var i = 0; i <= 4; i++) {
        ctx.lineTo(px + (TILE / 4) * i, py + 4 + Math.sin(this.t * 2.1 + x * 0.85 + i * 0.8) * amp);
      }
      ctx.lineTo(px + TILE, py + 1);
      ctx.lineTo(px, py + 1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fill();

      /* 液面高光 */
      ctx.fillStyle = pal.rim;
      ctx.fillRect(px, py, TILE, 1.6);

      /* 上方光斑 */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(pal.glow, px - 50, py - 70, 140, 140);
      ctx.restore();
    }

    /* 气泡：水与毒液才有，岩浆换成暗色浮渣 */
    var b, bp;
    if (t === 'L') {
      for (b = 0; b < 2; b++) {
        bp = (this.t * 0.35 + x * 0.27 + b * 0.5) % 1;
        ctx.fillStyle = 'rgba(60, 16, 30, ' + (0.35 * (1 - bp)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px + 9 + ((x * 17 + b * 23) % 22), py + TILE - bp * TILE, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (b = 0; b < 2; b++) {
        bp = (this.t * 0.5 + x * 0.31 + y * 0.17 + b * 0.5) % 1;
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.22 * (1 - bp)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px + 10 + ((x * 13 + b * 19) % 20), py + TILE - bp * TILE, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* 底部压暗，和墙体的深紫接得上 */
    ctx.fillStyle = 'rgba(10, 7, 18, 0.30)';
    ctx.fillRect(px, py + TILE - 2, TILE, 2);
  };

  FireIceScene.prototype.drawGates = function (ctx) {
    var states = { D1: this.plates.S1, D2: this.plates.S2, G3: this.lockOpen() };

    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var t = this.grid[y][x];
        if (t !== 'D1' && t !== 'D2' && t !== 'G3') continue;

        var open = states[t];
        if (t === 'G3') { this.drawLockCell(ctx, x, y, open); continue; }
        var alpha = open ? 0.14 : 1;
        var kind = t === 'D1' ? 'fire' : 'ice';
        var col = kind === 'fire' ? C.fire : C.ice;
        var px = x * TILE;
        var py = y * TILE;

        ctx.save();
        ctx.globalAlpha = alpha;

        /* 门框 */
        ctx.fillStyle = 'rgba(12, 9, 22, 0.9)';
        ctx.fillRect(px + 3, py, TILE - 6, TILE);
        ctx.strokeStyle = 'rgba(255, 226, 190, 0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 3.5, py + 0.5, TILE - 7, TILE - 1);

        /* 竖栅 */
        for (var b = 0; b < 3; b++) {
          var bx = px + 8 + b * 12;
          ctx.fillStyle = col;
          ctx.globalAlpha = alpha * 0.72;
          ctx.fillRect(bx, py + 2, 4, TILE - 4);
        }
        ctx.globalAlpha = alpha;

        /* 顶部横梁 */
        ctx.fillStyle = 'rgba(255, 226, 190, 0.22)';
        ctx.fillRect(px + 4, py + 1, TILE - 8, 3);

        ctx.restore();
      }
    }
  };

  FireIceScene.prototype.drawDoor = function (ctx, cell, kind) {
    var cx = (cell.x + 0.5) * TILE;
    var cy = cell.y * TILE + TILE;           /* 门立在角色所站的格底 */
    var col = kind === 'fire' ? C.fire : C.ice;
    var other = kind === 'fire' ? C.fireWarm : '#bfe9ff';
    var isFire = kind === 'fire';
    var standing = false;

    var c = isFire ? this.chars.fire : this.chars.ice;
    if (c) {
      var fc = this.footCell(c);
      standing = fc.x === cell.x && fc.y === cell.y;
    }

    var pulse = 0.5 + 0.5 * Math.sin(this.t * 2.6 + (isFire ? 0 : 1.7));
    var h = 96;
    var w = 52;
    var left = cx - w / 2;
    var top = cy - h;

    /* 门柱柔光 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var glow = ctx.createRadialGradient(cx, cy - h * 0.45, 4, cx, cy - h * 0.45, 76);
    glow.addColorStop(0, 'rgba(255, 255, 255, ' + (standing ? 0.20 : 0.10) + ')');
    glow.addColorStop(0.42, (isFire ? 'rgba(232, 84, 95, ' : 'rgba(95, 195, 255, ') + (standing ? 0.24 : 0.13) + ')');
    glow.addColorStop(1, (isFire ? 'rgba(232, 84, 95, 0)' : 'rgba(95, 195, 255, 0)'));
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 80, cy - h - 60, 160, h + 80);
    ctx.restore();

    /* 拱形门框：直边 + 半圆顶 */
    ctx.beginPath();
    ctx.moveTo(left, cy);
    ctx.lineTo(left, top + w / 2);
    ctx.arc(cx, top + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(left + w, cy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(14, 10, 24, 0.82)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = standing ? 1 : 0.62 + pulse * 0.2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* 门里的光 */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left + 5, cy);
    ctx.lineTo(left + 5, top + w / 2);
    ctx.arc(cx, top + w / 2, w / 2 - 5, Math.PI, 0);
    ctx.lineTo(left + w - 5, cy);
    ctx.closePath();
    ctx.clip();
    var fill = ctx.createLinearGradient(0, top, 0, cy);
    fill.addColorStop(0, other);
    fill.addColorStop(1, col);
    ctx.globalAlpha = standing ? 0.42 : 0.2 + pulse * 0.08;
    ctx.fillStyle = fill;
    ctx.fillRect(left, top, w, h);
    ctx.restore();

    /* 图腾：火苗 / 冰晶 */
    ctx.save();
    ctx.translate(cx, cy - 52);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    if (isFire) {
      ctx.beginPath();
      ctx.moveTo(-8, 14);
      ctx.quadraticCurveTo(-14, 0, -3, -16);
      ctx.quadraticCurveTo(-2, -4, 5, 2);
      ctx.quadraticCurveTo(11, 8, 5, 14);
      ctx.quadraticCurveTo(-1, 18, -8, 14);
      ctx.stroke();
    } else {
      for (var i = 0; i < 3; i++) {
        var a = i * Math.PI / 3;
        ctx.beginPath();
        ctx.moveTo(-Math.cos(a) * 12, -Math.sin(a) * 12);
        ctx.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
        ctx.stroke();
      }
    }
    ctx.restore();

    /* 站上去以后的落点环 */
    if (standing) {
      ctx.save();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 1, 26 + Math.sin(this.t * 4) * 3, 8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* 门口小字 */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 12px ' + SANS;
    ctx.fillStyle = standing ? col : 'rgba(253, 243, 228, 0.42)';
    ctx.fillText(isFire ? '火之门' : '冰之门', cx, top - 12);
    ctx.restore();
  };

  FireIceScene.prototype.drawPlate = function (ctx, id, kind) {
    var pos = null;
    for (var y = 0; y < ROWS && !pos; y++) {
      for (var x = 0; x < COLS; x++) {
        if (this.grid[y][x] === id) { pos = { x: x, y: y }; break; }
      }
    }
    if (!pos) return;

    var pressed = id === 'S1' ? this.plates.S1 : this.plates.S2;
    var col = kind === 'fire' ? C.fire : C.ice;
    var cx = (pos.x + 0.5) * TILE;
    var base = (pos.y + 1) * TILE;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 3 + (kind === 'fire' ? 0 : 2));

    ctx.save();
    /* 底板 */
    rr(ctx, cx - 17, base - 9, 34, 9, 3);
    ctx.fillStyle = '#251d3a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 226, 190, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 亮条 */
    ctx.fillStyle = pressed ? col : 'rgba(255, 226, 190, 0.22)';
    ctx.globalAlpha = pressed ? 0.95 : 0.5 + pulse * 0.2;
    rr(ctx, cx - 12, base - 8.5, 24, 4, 2);
    ctx.fill();
    ctx.restore();

    if (pressed) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(cx, base - 4, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  /* ---------------- 升降平台 ---------------- */
  FireIceScene.prototype.drawPlatforms = function (ctx) {
    for (var i = 0; i < this.platforms.length; i++) {
      var p = this.platforms[i];
      var x = p.x;
      var y = p.y;
      var w = p.w;
      var h = PLAT_H;

      ctx.save();

      /* 落影：贴着石板上沿往下散，别投到地面上去 */
      var sh = ctx.createLinearGradient(0, y + h, 0, y + h + 22);
      sh.addColorStop(0, 'rgba(4, 3, 10, 0.34)');
      sh.addColorStop(1, 'rgba(4, 3, 10, 0)');
      ctx.fillStyle = sh;
      ctx.fillRect(x + 2, y + h, w - 4, 22);

      /* 板身 */
      var g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#4b3b6a');
      g.addColorStop(0.42, '#332850');
      g.addColorStop(1, '#1e1730');
      rr(ctx, x, y, w, h, 5);
      ctx.fillStyle = g;
      ctx.fill();

      /* 顶面暖边：和大厅地砖用同一句话 */
      ctx.fillStyle = 'rgba(255, 218, 176, 0.78)';
      ctx.fillRect(x + 5, y, w - 10, 2.4);

      /* 侧面铆钉 */
      ctx.fillStyle = 'rgba(255, 226, 190, 0.22)';
      for (var b = 0; b < 3; b++) {
        ctx.beginPath();
        ctx.arc(x + 14 + b * (w - 28) / 2, y + h - 7, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      /* 板底的符文光：让「浮着」这件事有解释 */
      ctx.globalCompositeOperation = 'lighter';
      var glow = ctx.createLinearGradient(0, y + h - 2, 0, y + h + 14);
      glow.addColorStop(0, 'rgba(240, 167, 110, 0.30)');
      glow.addColorStop(1, 'rgba(240, 167, 110, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x + 8, y + h - 2, w - 16, 16);

      ctx.restore();
    }
  };

  /* ---------------- G3 锁门：一格一格画，锁链在格与格之间连起来 ---------------- */
  FireIceScene.prototype.drawLockCell = function (ctx, x, y, open) {
    var px = x * TILE;
    var py = y * TILE;
    var top = y === 0 || this.grid[y - 1][x] !== 'G3';

    ctx.save();
    ctx.globalAlpha = open ? 0.18 : 1;

    /* 门板 */
    ctx.fillStyle = 'rgba(10, 8, 18, 0.94)';
    ctx.fillRect(px + 2, py, TILE - 4, TILE);

    /* 竖向锁链：两股椭圆环左右交错，跨格也接得上 */
    ctx.strokeStyle = open ? 'rgba(240, 200, 140, 0.55)' : 'rgba(200, 180, 218, 0.72)';
    ctx.lineWidth = 2;
    for (var k = 0; k < 5; k++) {
      var ly = py + 4 + k * 8;
      var lx = px + TILE / 2 + (k % 2 ? 5 : -5);
      ctx.beginPath();
      ctx.ellipse(lx, ly, 4.2, 5.4, (k % 2 ? 0.55 : -0.55), 0, Math.PI * 2);
      ctx.stroke();
    }

    /* 横箍 */
    ctx.fillStyle = open ? 'rgba(240, 200, 140, 0.30)' : 'rgba(118, 102, 138, 0.55)';
    ctx.fillRect(px + 3, py + 15, TILE - 6, 4);

    ctx.restore();

    /* 开锁时透出一线暖光 */
    if (open) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var gg = ctx.createLinearGradient(0, py, 0, py + TILE);
      gg.addColorStop(0, 'rgba(255, 214, 150, 0.16)');
      gg.addColorStop(1, 'rgba(255, 176, 110, 0)');
      ctx.fillStyle = gg;
      ctx.fillRect(px + 4, py, TILE - 8, TILE);
      ctx.restore();
    }

    /* 最上面一格挂把锁 */
    if (top) {
      var cx = px + TILE / 2;
      var cy = py + 20;
      ctx.save();
      ctx.strokeStyle = open ? 'rgba(240, 200, 140, 0.5)' : 'rgba(240, 196, 130, 0.85)';
      ctx.fillStyle = open ? 'rgba(240, 200, 140, 0.14)' : 'rgba(40, 30, 58, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy - 5, 5.4, Math.PI, 0);
      ctx.stroke();
      rr(ctx, cx - 8, cy - 5, 16, 13, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = open ? 'rgba(240, 200, 140, 0.6)' : 'rgba(240, 196, 130, 0.8)';
      ctx.beginPath();
      ctx.arc(cx, cy + 1.5, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };

  /* ---------------- S3 压力板：踩着常亮，松脚后读秒 ---------------- */
  FireIceScene.prototype.drawLockPlate = function (ctx) {
    var pos = this.findTile('S3');
    if (!pos) return;

    var cx = (pos.x + 0.5) * TILE;
    var base = (pos.y + 1) * TILE;
    var on = this.lock.pressed;
    var hold = this.lock.t > 0;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 3.2);

    /* 底板 */
    rr(ctx, cx - 19, base - 10, 38, 10, 3);
    ctx.fillStyle = '#251d3a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 226, 190, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 亮条 */
    ctx.fillStyle = on ? '#f0c078' : (hold ? 'rgba(240, 192, 120, 0.62)' : 'rgba(255, 226, 190, 0.20)');
    ctx.globalAlpha = on ? 0.95 : 0.5 + pulse * 0.22;
    rr(ctx, cx - 13, base - 9.5, 26, 5, 2.5);
    ctx.fill();
    ctx.globalAlpha = 1;

    /* 踩住时的地面辉光 */
    if (on) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.26;
      ctx.fillStyle = '#f0c078';
      ctx.beginPath();
      ctx.ellipse(cx, base - 4, 32, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* 松脚后：一圈逐渐走完的金环 + 剩余秒数 */
    if (hold && !on) {
      var k = Math.max(0, Math.min(1, this.lock.t / LOCK_HOLD));
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 192, 120, 0.30)';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(cx, base - 40, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240, 200, 140, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, base - 40, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 226, 180, 0.95)';
      ctx.font = '600 12px ' + SANS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.lock.t.toFixed(1), cx, base - 40);
      ctx.restore();
    }
  };

  /* ---------------- 传送阵：地面法阵 ---------------- */
  FireIceScene.prototype.drawPads = function (ctx) {
    var ids = ['T1', 'T2'];
    var list = [this.chars.fire, this.chars.ice];

    for (var i = 0; i < ids.length; i++) {
      var pos = this.pads[ids[i]];
      if (!pos) continue;

      var cx = (pos.x + 0.5) * TILE;
      var base = (pos.y + 1) * TILE;
      var col = ids[i] === 'T1' ? 'rgba(240, 192, 120, ' : 'rgba(150, 208, 255, ';
      var pulse = 0.5 + 0.5 * Math.sin(this.t * 2.4 + (i ? 1.9 : 0));

      ctx.save();
      /* 外圈 */
      ctx.strokeStyle = col + (0.32 + pulse * 0.26).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, base - 1, 26, 8.6, 0, 0, Math.PI * 2);
      ctx.stroke();

      /* 内圈 */
      ctx.strokeStyle = col + '0.16)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(cx, base - 1, 17, 5.6, 0, 0, Math.PI * 2);
      ctx.stroke();

      /* 三个绕圈刻点 */
      for (var k = 0; k < 3; k++) {
        var a = this.t * 1.1 + k * Math.PI * 2 / 3;
        ctx.fillStyle = col + '0.8)';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 26, base - 1 + Math.sin(a) * 8.6, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      /* 有人站着：蓄力进度环（0.25s 走完） */
      for (var j = 0; j < list.length; j++) {
        var c = list[j];
        if (!c || !c.onGround || c.dead) continue;
        var fc = this.footCell(c);
        if (fc.x !== pos.x || fc.y !== pos.y) continue;
        var p = Math.min(1, c.tp.t / TP_DELAY);
        if (p <= 0) continue;

        ctx.save();
        ctx.strokeStyle = col + '0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, base - 1, 26, 8.6, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  FireIceScene.prototype.drawFx = function (ctx) {
    if (!this.fx.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.fx.length; i++) {
      var f = this.fx[i];
      var a = Math.max(0, f.life / f.max);
      ctx.fillStyle = (f.kind === 'T2' ? 'rgba(150, 208, 255, ' : 'rgba(255, 206, 140, ')
        + (a * 0.9).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (0.5 + a * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  /* ---------------- 角色 ---------------- */
  FireIceScene.prototype.drawChar = function (ctx, c, active) {
    var isFire = c.kind === 'fire';
    var col = isFire ? C.fire : C.ice;
    var dark = isFire ? '#4a1d22' : '#153a5e';

    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.45;

    /* 影子：跳起来就淡下去 */
    var air = c.onGround ? 0 : 40;
    ctx.save();
    ctx.globalAlpha = (active ? 0.34 : 0.2) * clamp(1 - air / 200, 0.2, 1);
    ctx.fillStyle = '#07050d';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - 2, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* 脚下的属性光：给一点存在感就够了，太亮会变成一支蜡烛 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = active ? 0.22 : 0.10;
    var fg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 40);
    fg.addColorStop(0, col);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(c.x - 40, c.y - 20, 80, 40);
    ctx.restore();

    var squash = c.squash;
    var sx = 1 + squash * 0.14;
    var sy = 1 - squash * 0.18;
    var swing = Math.sin(c.walk * 2) * (c.onGround ? 1 : 0.3) * c.speedRatio;
    var bob = c.onGround ? Math.abs(Math.sin(c.walk * 2)) * 1.4 * c.speedRatio : 0;

    ctx.save();
    ctx.translate(c.x, c.y - bob);
    ctx.scale(c.facing, 1);
    ctx.scale(sx, sy);

    /* 腿 */
    ctx.strokeStyle = '#120d1f';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (c.onGround) {
      ctx.moveTo(-3, -14); ctx.lineTo(-4 + swing * 8, -1);
      ctx.moveTo(3, -14); ctx.lineTo(4 - swing * 8, -1);
    } else {
      ctx.moveTo(-3, -14); ctx.lineTo(-8, -4);
      ctx.moveTo(3, -14); ctx.lineTo(7, -2);
    }
    ctx.stroke();

    /* 斗篷：肩窄摆宽，下摆留一点起伏 */
    var body = ctx.createLinearGradient(0, -44, 0, -2);
    body.addColorStop(0, col);
    body.addColorStop(1, dark);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-9, -44);
    ctx.lineTo(9, -44);
    ctx.bezierCurveTo(12, -32, 14, -18, 15.5, -4);
    ctx.quadraticCurveTo(7, 1, 0, -3);
    ctx.quadraticCurveTo(-7, 1, -15.5, -4);
    ctx.bezierCurveTo(-14, -18, -12, -32, -9, -44);
    ctx.closePath();
    ctx.fill();

    /* 迎光边：贴着轮廓的一小段，别拉成一根棍 */
    var rim = ctx.createLinearGradient(0, -44, 0, -8);
    rim.addColorStop(0, isFire ? 'rgba(255, 200, 140, 0)' : 'rgba(200, 240, 255, 0)');
    rim.addColorStop(0.5, isFire ? 'rgba(255, 200, 140, 0.5)' : 'rgba(200, 240, 255, 0.45)');
    rim.addColorStop(1, isFire ? 'rgba(255, 200, 140, 0)' : 'rgba(200, 240, 255, 0)');
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8.6, -43);
    ctx.bezierCurveTo(11.6, -32, 13.6, -18, 14.8, -6);
    ctx.stroke();

    /* 肩线：一条短横，让剪影有「人」的肩宽 */
    ctx.strokeStyle = 'rgba(12, 8, 20, 0.35)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-8.6, -43.4);
    ctx.lineTo(8.6, -43.4);
    ctx.stroke();

    /* 兜帽 + 帽口里的脸（脸要小于帽子，否则会看成两个球） */
    ctx.fillStyle = isFire ? '#8e3238' : '#2f5c8a';
    ctx.beginPath();
    ctx.arc(0, -52, 8.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isFire ? '#f6c9a0' : '#d5ebfa';
    ctx.beginPath();
    ctx.ellipse(1.8, -51.4, 4.6, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 帽檐压住脸上沿，脸才像嵌在帽子里 */
    ctx.strokeStyle = isFire ? 'rgba(96, 32, 38, 0.9)' : 'rgba(26, 54, 84, 0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(1.8, -51.4, 4.6, 5.2, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();

    ctx.fillStyle = '#1c1730';
    ctx.beginPath();
    ctx.arc(3.9, -51.8, 1.15, 0, Math.PI * 2);
    ctx.fill();

    /* 火苗 / 冰晶：比帽子小一号，别抢头 */
    if (isFire) {
      var fw = Math.sin(this.t * 9 + c.x) * 1.4;
      ctx.fillStyle = '#ffb066';
      ctx.beginPath();
      ctx.moveTo(-4.6, -58);
      ctx.quadraticCurveTo(-6 + fw, -66, 0, -70);
      ctx.quadraticCurveTo(5.4 + fw, -65, 4.6, -58);
      ctx.quadraticCurveTo(0, -55, -4.6, -58);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 240, 200, 0.9)';
      ctx.beginPath();
      ctx.moveTo(-1.8, -59);
      ctx.quadraticCurveTo(-1.4 + fw, -64, 1.2, -66);
      ctx.quadraticCurveTo(3 + fw, -63, 2, -59);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = '#cdefff';
      ctx.fillStyle = 'rgba(176, 226, 255, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -70);
      ctx.lineTo(5.4, -62);
      ctx.lineTo(0, -56);
      ctx.lineTo(-5.4, -62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();

    /* 当前角色的头顶箭头 */
    if (active) {
      var bobA = Math.sin(this.t * 3.4) * 3;
      ctx.save();
      ctx.fillStyle = isFire ? 'rgba(255, 200, 150, 0.95)' : 'rgba(190, 234, 255, 0.95)';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - 96 + bobA);
      ctx.lineTo(c.x - 7, c.y - 106 + bobA);
      ctx.lineTo(c.x + 7, c.y - 106 + bobA);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  };

  /* ---------------- HUD ---------------- */
  FireIceScene.prototype.drawHud = function (ctx) {
    var lv = LEVELS[this.level];

    ctx.save();
    ctx.textBaseline = 'middle';

    /* 左上：关卡与进度 */
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
    ctx.font = '500 12px ' + SANS;
    ctx.fillText('第 ' + (this.level + 1) + ' / ' + LEVELS.length + ' 关', 26, 28);

    ctx.fillStyle = C.paper;
    ctx.font = '600 22px ' + SERIF;
    ctx.fillText(lv.name, 26, 54);

    /* 进度点 */
    for (var i = 0; i < LEVELS.length; i++) {
      ctx.beginPath();
      ctx.arc(30 + i * 16, 76, 4, 0, Math.PI * 2);
      ctx.fillStyle = i < this.level ? 'rgba(240, 167, 110, 0.85)'
        : i === this.level ? C.paper : 'rgba(253, 243, 228, 0.18)';
      ctx.fill();
    }

    /* 右上：谁在动 */
    var act = this.active;
    var label = act === 'fire' ? '火人' : '冰人';
    var acol = act === 'fire' ? C.fire : C.ice;

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.4)';
    ctx.font = '500 12px ' + SANS;
    ctx.fillText('Tab 切换', VIEW_W - 26, 28);

    var chipW = 92;
    var chipX = VIEW_W - 26 - chipW;
    rr(ctx, chipX, 40, chipW, 30, 15);
    ctx.fillStyle = 'rgba(20, 15, 34, 0.8)';
    ctx.fill();
    ctx.strokeStyle = acol;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = acol;
    ctx.font = '600 15px ' + SANS;
    ctx.textAlign = 'center';
    ctx.fillText('当前 · ' + label, chipX + chipW / 2, 56);

    /* 底部操作提示 */
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.30)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('A / D 移动 · 空格跳跃 · Tab 换人 · R 重开本关 · Esc 回大厅', VIEW_W / 2, VIEW_H - 22);

    /* 关卡小贴士 */
    if (this.state === 'playing' || this.state === 'dead') {
      ctx.fillStyle = 'rgba(255, 217, 168, 0.34)';
      ctx.font = '400 13px ' + SANS;
      ctx.fillText(lv.hint, VIEW_W / 2, 30);
    }

    ctx.restore();
  };

  FireIceScene.prototype.drawTitle = function (ctx) {
    /* 中间压一团暗场：既压住背后的地形，又让文字有干净的底 */
    var veil = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 60, VIEW_W / 2, VIEW_H / 2, 620);
    veil.addColorStop(0, 'rgba(6, 4, 12, 0.90)');
    veil.addColorStop(0.55, 'rgba(6, 4, 12, 0.76)');
    veil.addColorStop(1, 'rgba(6, 4, 12, 0.34)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var cx = VIEW_W / 2;
    var cy = VIEW_H / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(255, 217, 168, 0.55)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('F I R E   &   I C E', cx, cy - 132);

    ctx.fillStyle = C.paper;
    ctx.font = '600 54px ' + SERIF;
    ctx.shadowColor = 'rgba(240, 167, 110, 0.30)';
    ctx.shadowBlur = 36;
    ctx.fillText('森林冰火人', cx, cy - 84);
    ctx.shadowBlur = 0;

    /* 分隔线 */
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 150, cy - 44);
    ctx.lineTo(cx + 150, cy - 44);
    ctx.stroke();

    ctx.fillStyle = C.paper;
    ctx.font = '500 20px ' + SANS;
    ctx.fillText('一个人操作两个角色：Tab 切换', cx, cy - 8);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.54)';
    ctx.font = '400 15px ' + SANS;
    ctx.fillText('火人踩岩浆不会死，冰人踩水池不会死 —— 换过来就是死', cx, cy + 30);
    ctx.fillText('毒液两个人都碰不得；两个人同时站上各自的门才算过关', cx, cy + 56);

    ctx.fillStyle = 'rgba(255, 217, 168, 0.88)';
    ctx.font = '500 16px ' + SANS;
    ctx.fillText('按 Enter 或 Tab 开始', cx, cy + 112);
  };

  FireIceScene.prototype.drawDead = function (ctx) {
    ctx.save();
    var a = Math.min(1, this.timer / 0.2);
    ctx.globalAlpha = a * 0.5;
    ctx.fillStyle = this.deadKind === 'fire' ? '#7a1f28' : '#123a5c';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = a;

    var cx = VIEW_W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.paper;
    ctx.font = '600 32px ' + SERIF;
    ctx.fillText(this.deadKind === 'fire' ? '火人倒下了' : '冰人倒下了', cx, VIEW_H / 2 - 16);
    ctx.fillStyle = 'rgba(253, 243, 228, 0.5)';
    ctx.font = '400 15px ' + SANS;
    ctx.fillText('本关重开……', cx, VIEW_H / 2 + 26);
    ctx.restore();
  };

  FireIceScene.prototype.drawClear = function (ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var a = Math.min(1, this.timer / 0.25);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(6, 4, 12, 0.5)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.fillStyle = C.paper;
    ctx.font = '600 36px ' + SERIF;
    ctx.fillText('第 ' + (this.level + 1) + ' 关 通过', VIEW_W / 2, VIEW_H / 2 - 10);

    ctx.fillStyle = 'rgba(255, 217, 168, 0.7)';
    ctx.font = '400 15px ' + SANS;
    ctx.fillText(this.level < LEVELS.length - 1 ? '下一关……' : '正在收尾……', VIEW_W / 2, VIEW_H / 2 + 34);
    ctx.restore();
  };

  FireIceScene.prototype.drawWin = function (ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(6, 4, 12, 0.66)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var w = 480;
    var h = 320;
    var x = (VIEW_W - w) / 2;
    var y = (VIEW_H - h) / 2 - 12;
    panel(ctx, x, y, w, h);

    var cx = x + w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(253, 243, 228, 0.45)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('F I R E   &   I C E', cx, y + 46);

    ctx.fillStyle = C.paper;
    ctx.font = '600 40px ' + SERIF;
    ctx.fillText('六关全通', cx, y + 96);

    ctx.fillStyle = 'rgba(255, 217, 168, 0.65)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('火人与冰人都走到了自己的门', cx, y + 136);

    var bw = 200;
    var bh = 50;
    this.btn = { x: cx - bw / 2, y: y + 176, w: bw, h: bh };

    rr(ctx, this.btn.x, this.btn.y, bw, bh, 12);
    var g = ctx.createLinearGradient(0, this.btn.y, 0, this.btn.y + bh);
    g.addColorStop(0, 'rgba(240, 167, 110, 0.26)');
    g.addColorStop(1, 'rgba(240, 167, 110, 0.10)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 217, 168, 0.72)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    ctx.fillStyle = C.paper;
    ctx.font = '600 19px ' + SERIF;
    ctx.fillText('回到大厅', cx, this.btn.y + bh / 2 + 1);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.36)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('Esc / 点击按钮 回大厅', cx, y + 272);

    ctx.restore();
  };

  FireIceScene.prototype.destroy = function () {
    global.removeEventListener('keydown', this._onKey);
    global.removeEventListener('keyup', this._onKeyUp);
    global.removeEventListener('blur', this._onBlur);
    if (this.canvas && this._onClick) this.canvas.removeEventListener('click', this._onClick);

    this._onKey = null;
    this._onKeyUp = null;
    this._onClick = null;
    this._onBlur = null;
    this.canvas = null;
    this.grid = null;
    this.chars = null;
    this.bg = null;
    this.btn = null;
  };

  global.FireIceScene = FireIceScene;
  if (global.SceneManager) {
    global.SceneManager.register('fireice', function () { return new FireIceScene(); });
  }
})(window);
