/* ============================================================
 * 弹弹岛（单机）—— 抛物线弹射 / 可破坏地形 / 风力 / 关卡制
 * ------------------------------------------------------------
 * 参考 4399《弹弹岛》与 QQ 小游戏《火柴人神射手》的手感：
 * 左边是你的炮台，右边是敌人；调角度、拉力度、看风向，
 * 一发炮弹划出抛物线落下去，炸开的坑会让整座岛塌进海里。
 *
 * 纯前端无依赖，file:// 直接打开可玩。
 * ============================================================ */
(function () {
  'use strict';

  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var W = 1280, H = 720, SEA = 566;
  var CELL = 10, GW = W / CELL, GH = H / CELL;
  var GRAV = 860;                 /* 重力 px/s² */
  var DT = 1 / 120;               /* 弹道积分步长 */
  var SAVE_KEY = 'worldhub.dandandao.save';

  var el = {
    ov: document.getElementById('ov'),
    box: document.getElementById('box'),
    wind: document.getElementById('wind'),
    turn: document.getElementById('turn'),
    lvname: document.getElementById('lvname'),
    hp: document.getElementById('hpfill'),
    ang: document.getElementById('ang'),
    pow: document.getElementById('pow'),
    fire: document.getElementById('fire'),
    a1: document.getElementById('a1'),
    a2: document.getElementById('a2'),
    toast: document.getElementById('toast'),
    wps: document.querySelectorAll('.wp')
  };

  /* ---------------- 关卡 ---------------- */
  /* isles: [中心x, 顶面y, 半宽]；foes: [x, 血量] */
  var LEVELS = [
    { name: '新兵海湾', wind: 20, skill: 0.42,
      isles: [[170, 470, 150], [1070, 455, 150]],
      foes: [[1070, 60]], hint: '先打一发试试：↑↓ 调角度，←→ 调力度，空格开火。' },
    { name: '双礁伏击', wind: 34, skill: 0.52,
      isles: [[170, 480, 140], [920, 430, 112], [1170, 500, 88]],
      foes: [[920, 55], [1170, 55]], hint: '三连散一次打三个方向，打中谁算谁。' },
    { name: '高台狙击', wind: 42, skill: 0.58,
      isles: [[170, 520, 150], [640, 358, 92], [1070, 400, 160]],
      foes: [[1070, 105]], hint: '中间的高台会挡炮弹——要么绕过去，要么把它炸平。' },
    { name: '三岛混战', wind: 48, skill: 0.64,
      isles: [[150, 500, 132], [620, 452, 108], [1050, 470, 142]],
      foes: [[980, 68], [1100, 68]], hint: '炸敌人脚下的岛，比硬拼血量快得多。' },
    { name: '强风岬', wind: 72, skill: 0.72,
      isles: [[170, 500, 142], [980, 424, 122], [1190, 510, 78]],
      foes: [[980, 88], [1190, 80]], hint: '风大了就别硬瞄：顺风加力度，逆风减力度。' },
    { name: '终局 · 落日要塞', wind: 64, skill: 0.82,
      isles: [[150, 520, 130], [640, 382, 100], [640, 546, 72], [1070, 430, 152]],
      foes: [[1000, 82], [1080, 82], [1160, 82]], hint: '重弹的爆炸半径最大，一发能掀掉半座岛。' }
  ];

  var WEAPONS = [
    { name: '标准弹', dmg: 30, r: 36, speed: 1060, count: 3, spread: 0 },
    { name: '三连散', dmg: 17, r: 25, speed: 1060, count: 3, spread: 0.085 },
    { name: '重弹', dmg: 52, r: 58, speed: 940, count: 1, spread: 0 }
  ];

  /* ---------------- 存档 ---------------- */
  var save = { unlocked: 1, stars: {}, best: 0 };
  try {
    var raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      save.unlocked = Math.max(1, Math.min(LEVELS.length, Number(raw.unlocked) || 1));
      save.stars = raw.stars && typeof raw.stars === 'object' ? raw.stars : {};
      save.best = Number(raw.best) || 0;
    }
  } catch (e) {}
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  /* ---------------- 状态 ---------------- */
  var grid = new Uint8Array(GW * GH);
  var terrain = document.createElement('canvas');
  terrain.width = W; terrain.height = H;
  var tctx = terrain.getContext('2d');
  var terrainDirty = true;

  var level = 0, lv = LEVELS[0];
  var player = null, foes = [], shots = [], parts = [], floats = [], rings = [];
  var weapon = 0, ammo = [0, 3, 2];
  var angle = 45, power = 0.7;
  var wind = 0, turn = 0;
  var phase = 'menu';              /* menu | aim | fly | enemy | win | lose */
  var shake = 0, flash = 0, timer = 0, muzzle = 0;
  var pending = [];
  var keys = {};
  var drag = null;
  var showGuide = true;
  var frameNo = 0;

  function later(fn, ms) { var id = setTimeout(fn, ms); pending.push(id); return id; }
  function clearPending() { for (var i = 0; i < pending.length; i++) clearTimeout(pending[i]); pending.length = 0; }

  /* ---------------- 音效（WebAudio 合成，无素材文件） ---------------- */
  var actx = null, noiseBuf = null, muted = false;
  function audio() {
    if (muted) return null;
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        actx = new AC();
        var n = actx.sampleRate * 0.7;
        noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(f0, f1, dur, type, vol) {
    var a = audio(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), a.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.12, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + 0.02);
  }
  function boomSound(big) {
    var a = audio(); if (!a || !noiseBuf) return;
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf;
    f.type = 'lowpass'; f.frequency.setValueAtTime(big ? 900 : 1500, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(90, a.currentTime + 0.45);
    g.gain.setValueAtTime(big ? 0.32 : 0.22, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.48);
    s.connect(f); f.connect(g); g.connect(a.destination);
    s.start(); s.stop(a.currentTime + 0.5);
  }
  function sfx(kind) {
    if (kind === 'fire') { tone(340, 90, 0.16, 'sawtooth', 0.10); tone(120, 60, 0.2, 'square', 0.05); }
    else if (kind === 'hit') { tone(680, 260, 0.13, 'square', 0.09); }
    else if (kind === 'boom') { boomSound(false); }
    else if (kind === 'big') { boomSound(true); }
    else if (kind === 'win') {
      tone(523, 523, 0.14, 'triangle', 0.12);
      later(function () { tone(659, 659, 0.14, 'triangle', 0.12); }, 130);
      later(function () { tone(784, 784, 0.32, 'triangle', 0.13); }, 260);
    } else if (kind === 'lose') { tone(300, 110, 0.5, 'sawtooth', 0.1); }
  }

  /* ---------------- 地形 ---------------- */
  function gi(x, y) { return y * GW + x; }
  function idx(px, py) { return gi(Math.floor(px / CELL), Math.floor(py / CELL)); }
  function solidPx(px, py) {
    var gx = Math.floor(px / CELL), gy = Math.floor(py / CELL);
    if (gx < 0 || gx >= GW || gy < 0) return false;
    if (gy >= GH) return true;
    return grid[gi(gx, gy)] === 1;
  }
  function setCell(gx, gy, v) {
    if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return;
    grid[gi(gx, gy)] = v;
  }

  /* 岛顶面：中间平、两肩圆，边缘做一点锯齿，看起来像被海啃过 */
  function drawIsle(cx, topY, halfW) {
    for (var px = cx - halfW; px <= cx + halfW; px += CELL) {
      var t = (px - cx) / halfW;
      var dome = Math.sqrt(Math.max(0, 1 - t * t));
      var surf = topY + (1 - dome) * 30;
      surf += Math.sin(px * 0.09 + cx * 0.03) * 3 + Math.sin(px * 0.031) * 4;
      surf = Math.round(surf / CELL) * CELL;
      var gx = Math.floor(px / CELL);
      for (var py = surf; py < H; py += CELL) setCell(gx, Math.floor(py / CELL), 1);
    }
  }

  function makeTerrain() {
    grid.fill(0);
    /* 海床 */
    for (var y = SEA + 34; y < H; y += CELL) {
      for (var x = 0; x < W; x += CELL) setCell(x / CELL, y / CELL, 1);
    }
    for (var i = 0; i < lv.isles.length; i++) {
      drawIsle(lv.isles[i][0], lv.isles[i][1], lv.isles[i][2]);
    }
    terrainDirty = true;
  }

  /* 挖圆洞；返回是否挖到东西 */
  function carve(cx, cy, r) {
    var hit = false;
    var x0 = Math.max(0, Math.floor((cx - r) / CELL));
    var x1 = Math.min(GW - 1, Math.ceil((cx + r) / CELL));
    var y0 = Math.max(0, Math.floor((cy - r) / CELL));
    var y1 = Math.min(GH - 1, Math.ceil((cy + r) / CELL));
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        var dx = (gx + 0.5) * CELL - cx, dy = (gy + 0.5) * CELL - cy;
        if (dx * dx + dy * dy > r * r) continue;
        if (grid[gi(gx, gy)]) { grid[gi(gx, gy)] = 0; hit = true; }
      }
    }
    if (hit) terrainDirty = true;
    return hit;
  }

  /* 坍塌：没有连到海床的土块全部掉下去（从底部 BFS） */
  function settle() {
    var seen = new Uint8Array(GW * GH);
    var q = new Int32Array(GW * GH);
    var head = 0, tail = 0;
    for (var x = 0; x < GW; x++) {
      var k = gi(x, GH - 1);
      if (grid[k] && !seen[k]) { seen[k] = 1; q[tail++] = k; }
    }
    while (head < tail) {
      var cur = q[head++], cx = cur % GW, cy = (cur / GW) | 0;
      var nb = [cx > 0 ? cur - 1 : -1, cx < GW - 1 ? cur + 1 : -1,
                cy > 0 ? cur - GW : -1, cy < GH - 1 ? cur + GW : -1];
      for (var i = 0; i < 4; i++) {
        var n = nb[i];
        if (n >= 0 && !seen[n] && grid[n]) { seen[n] = 1; q[tail++] = n; }
      }
    }
    var fell = 0;
    for (var j = 0; j < grid.length; j++) {
      if (grid[j] && !seen[j]) {
        if (fell < 90 && fell % 2 === 0) {
          var fx = (j % GW) * CELL + CELL / 2, fy = ((j / GW) | 0) * CELL + CELL / 2;
          parts.push({ x: fx, y: fy, vx: (Math.random() - 0.5) * 40, vy: 30 + Math.random() * 60,
                       life: 0.7 + Math.random() * 0.6, max: 1.3, size: 4 + Math.random() * 5,
                       color: Math.random() < 0.35 ? '#7fbf63' : '#7a5638', g: 520 });
        }
        grid[j] = 0; fell++;
      }
    }
    if (fell) terrainDirty = true;
    return fell;
  }

  function topAt(px) {
    var gx = Math.floor(px / CELL);
    if (gx < 0 || gx >= GW) return H;
    for (var gy = 0; gy < GH; gy++) if (grid[gi(gx, gy)]) return gy * CELL;
    return H;
  }

  function paintTerrain() {
    tctx.clearRect(0, 0, W, H);
    /* 按行段合并画：越深越暗，海平面以下转成水下的冷色 */
    for (var gy = 0; gy < GH; gy++) {
      var py = gy * CELL;
      var color = py >= SEA ? '#315b71' : py >= SEA - 110 ? '#67472f' : '#7b5739';
      tctx.fillStyle = color;
      var run = -1;
      for (var gx = 0; gx <= GW; gx++) {
        var on = gx < GW && grid[gi(gx, gy)] === 1;
        if (on && run < 0) run = gx;
        if (!on && run >= 0) {
          tctx.fillRect(run * CELL, py, (gx - run) * CELL, CELL);
          run = -1;
        }
      }
    }
    /* 土里的碎石：固定散列，重绘不会闪 */
    tctx.fillStyle = 'rgba(0,0,0,.13)';
    for (var y0 = 0; y0 < GH; y0++) {
      for (var x0 = 0; x0 < GW; x0++) {
        if (!grid[gi(x0, y0)] || y0 * CELL >= SEA) continue;
        var h = (x0 * 73856093 ^ y0 * 19349663) >>> 0;
        if (h % 11 === 0) tctx.fillRect(x0 * CELL + (h % 5), y0 * CELL + (h % 6), 3, 2);
      }
    }
    /* 草皮：实心格上方是空的，就铺两格草 */
    tctx.fillStyle = '#6fb553';
    for (var y = 0; y < GH; y++) {
      for (var x = 0; x < GW; x++) {
        if (grid[gi(x, y)] && (y === 0 || !grid[gi(x, y - 1)])) {
          tctx.fillRect(x * CELL, y * CELL, CELL, CELL * 2);
        }
      }
    }
    /* 草尖高光 */
    tctx.fillStyle = 'rgba(190,240,150,.42)';
    for (var y2 = 0; y2 < GH; y2++) {
      for (var x2 = 0; x2 < GW; x2++) {
        if (grid[gi(x2, y2)] && (y2 === 0 || !grid[gi(x2, y2 - 1)])) {
          tctx.fillRect(x2 * CELL, y2 * CELL, CELL, 2);
        }
      }
    }
    terrainDirty = false;
  }

  /* ---------------- 单位 ---------------- */
  function makeUnit(x, hp, isFoe) {
    var top = topAt(x);
    return {
      x: x, y: top - 19, vy: 0, hp: hp, max: hp, foe: !!isFoe,
      alive: true, aiAng: 45, aiPow: 0.7, recoil: 0, hurt: 0, dead: 0
    };
  }

  function damage(u, d, src) {
    if (!u.alive || d <= 0) return;
    u.hp -= d; u.hurt = 0.3;
    floats.push({ x: u.x, y: u.y - 34, text: '-' + Math.round(d), life: 1.1, max: 1.1,
                  color: u.foe ? '#ffd166' : '#ff8b7a' });
    sfx('hit');
    if (u.hp <= 0) kill(u, 'hp');
  }
  function kill(u, why) {
    if (!u.alive) return;
    u.alive = false; u.dead = 1;
    for (var i = 0; i < 22; i++) {
      var a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 230;
      parts.push({ x: u.x, y: u.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 90,
                   life: 0.6 + Math.random() * 0.8, max: 1.4, size: 3 + Math.random() * 6,
                   color: u.foe ? '#ff8b7a' : '#7fc7ff', g: 480 });
    }
    if (why === 'sea') {
      floats.push({ x: u.x, y: SEA - 12, text: '落海!', life: 1.4, max: 1.4, color: '#fff' });
      boomSound(false);
    }
  }

  /* ---------------- 弹道：AI 与瞄准线共用同一套积分 ---------------- */
  function launchVec(x, y, angDeg, pow, spd) {
    var a = angDeg * Math.PI / 180;
    return { x: x + Math.cos(a) * 34, y: y - Math.sin(a) * 34,
             vx: Math.cos(a) * spd * pow, vy: -Math.sin(a) * spd * pow };
  }
  function stepShot(s, dt) {
    s.vx += wind * dt;
    s.vy += GRAV * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
  }
  /* 模拟落点：返回「炮弹最终落点到目标」的距离。
     爆炸只发生在撞地形 / 撞人 / 出界的那一刻，拿轨迹最近点当指标会选错解。 */
  function simulate(x, y, angDeg, pow, spd, target, maxSteps, avoid) {
    var s = launchVec(x, y, angDeg, pow, spd);
    var n = maxSteps || 520;
    for (var i = 0; i < n; i++) {
      stepShot(s, DT);
      if (s.y > H + 40 || s.x < -60 || s.x > W + 60) break;
      if (solidPx(s.x, s.y)) break;
    }
    /* AI 不许选「炸自己脚下」的解：落点离发射者太近就判为无效 */
    if (avoid && Math.hypot(s.x - avoid.x, s.y - avoid.y) < 130) return 1e9;
    return Math.hypot(s.x - target.x, s.y - target.y);
  }

  function aiSolve(u, target) {
    var sp = 1060;
    var best = null, bestD = 1e9;
    var a, p, d;
    /* 粗搜 */
    for (a = 18; a <= 82; a += 4) {
      for (p = 0.34; p <= 1.001; p += 0.055) {
        d = simulate(u.x, u.y - 13, a, p, sp, target, 520, u);
        if (d < bestD) { bestD = d; best = { a: a, p: p }; }
      }
    }
    /* 细搜 */
    if (best) {
      for (a = Math.max(8, best.a - 5); a <= Math.min(88, best.a + 5); a += 1) {
        for (p = Math.max(0.2, best.p - 0.07); p <= Math.min(1, best.p + 0.07); p += 0.018) {
          d = simulate(u.x, u.y - 13, a, p, sp, target, 520, u);
          if (d < bestD) { bestD = d; best = { a: a, p: p }; }
        }
      }
    }
    /* 极端风况下可能一个有效解都没有：退到高抛满力，至少别把炮弹砸自己脸上 */
    if (!best || bestD >= 1e8) best = { a: 68, p: 1 };
    /* 手抖：越后面的关越准 */
    var err = (1 - lv.skill) * 8;
    u.aiAng = Math.max(8, Math.min(88, best.a + (Math.random() * 2 - 1) * err));
    u.aiPow = Math.max(0.22, Math.min(1, best.p + (Math.random() * 2 - 1) * err * 0.018));
  }

  /* ---------------- 发射与爆炸 ---------------- */
  function shoot(angDeg, pow, wIdx, owner) {
    var u = owner || player;
    var w = WEAPONS[wIdx];
    var base = launchVec(u.x, u.y - 13, angDeg, pow, w.speed);
    var a = angDeg * Math.PI / 180;
    for (var i = 0; i < w.count; i++) {
      var off = w.count === 1 ? 0 : (i - (w.count - 1) / 2) * w.spread;
      var ca = Math.cos(off), sa = Math.sin(off);
      shots.push({
        x: base.x, y: base.y,
        vx: base.vx * ca - base.vy * sa,
        vy: base.vx * sa + base.vy * ca,
        r: w.r, dmg: w.dmg, life: 5.5, owner: u, trail: [], spin: Math.random() * 6
      });
    }
    u.recoil = 1;
    muzzle = 1;
    sfx('fire');
  }

  function explode(s, hitUnit) {
    var big = s.r >= 50;
    var carved = carve(s.x, s.y, s.r);
    var settled = settle();
    rings.push({ x: s.x, y: s.y, r: 6, max: s.r * 1.5, life: 0.42, color: big ? '#ffd166' : '#ffb36b' });
    for (var i = 0; i < (big ? 40 : 24); i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * (big ? 340 : 240);
      parts.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80,
                   life: 0.35 + Math.random() * 0.75, max: 1.1, size: 2 + Math.random() * (big ? 8 : 5),
                   color: ['#fff0b8', '#ffb35c', '#ff7f50', '#8a5c38'][i % 4], g: 520, glow: true });
    }
    var units = [player].concat(foes);
    for (var k = 0; k < units.length; k++) {
      var u = units[k];
      if (!u || !u.alive) continue;
      var d = Math.hypot(u.x - s.x, u.y - s.y);
      var reach = s.r + 20;
      if (d < reach) {
        var falloff = 1 - 0.45 * (d / reach);
        damage(u, s.dmg * falloff, s.owner);
      }
    }
    if (carved || settled) {
      /* 岛被炸塌后，站在上面的单位会自己掉下去 */
      var all = [player].concat(foes);
      for (var j = 0; j < all.length; j++) {
        var t = all[j];
        if (t && t.alive && !solidPx(t.x, t.y + 20)) t.vy = Math.max(t.vy, 40);
      }
    }
    shake = Math.max(shake, big ? 13 : 7);
    flash = Math.max(flash, big ? 0.5 : 0.26);
    sfx(big ? 'big' : 'boom');
  }

  /* ---------------- 回合流程 ---------------- */
  var foeQueue = [], foeIdx = 0, flySettle = 0, flyOwner = 'player';

  function toast(text, ms) {
    el.toast.textContent = text;
    el.toast.classList.add('on');
    clearTimeout(timer);
    timer = setTimeout(function () { el.toast.classList.remove('on'); }, ms || 1500);
  }

  function syncUI() {
    el.lvname.textContent = '第 ' + (level + 1) + ' 关 · ' + lv.name;
    var dir = wind >= 0 ? '→' : '←';
    el.wind.textContent = '风 ' + dir + ' ' + Math.abs(Math.round(wind));
    el.turn.textContent = '第 ' + turn + ' 回合';
    el.hp.style.width = Math.max(0, (player ? player.hp / player.max : 1) * 100) + '%';
    el.ang.textContent = Math.round(angle) + '°';
    el.pow.textContent = Math.round(power * 100) + '%';
    el.a1.textContent = ammo[1];
    el.a2.textContent = ammo[2];
    for (var i = 0; i < el.wps.length; i++) {
      el.wps[i].classList.toggle('sel', i === weapon);
      el.wps[i].classList.toggle('empty', i > 0 && ammo[i] <= 0);
    }
    el.fire.disabled = phase !== 'aim';
  }

  function checkEnd() {
    var foesAlive = foes.some(function (f) { return f.alive; });
    if (!player.alive) {
      phase = 'lose'; clearPending(); syncUI();
      later(function () { showLose(); }, 800);
      return true;
    }
    if (!foesAlive) {
      phase = 'win'; clearPending(); syncUI(); sfx('win');
      var ratio = player.hp / player.max;
      var stars = ratio > 0.72 ? 3 : ratio > 0.38 ? 2 : 1;
      if ((save.stars[level] || 0) < stars) save.stars[level] = stars;
      save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, level + 2));
      save.best = Math.max(save.best, stars * 100 + (LEVELS.length - level) * 10);
      persist();
      later(function () { showWin(stars); }, 900);
      return true;
    }
    return false;
  }

  /* 后几关敌人会在自己岛上挪窝，玩家得重新瞄——别让对射变成背答案 */
  function shuffleFoes() {
    if (level < 2) return;
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      if (!f.alive) continue;
      var nx = lv.foes[i][0] + (Math.random() * 2 - 1) * 72;
      nx = Math.max(70, Math.min(W - 70, nx));
      var top = topAt(nx);
      if (top > H - 40 || !solidPx(nx, top + 6)) continue;
      f.x = nx; f.y = top - 19; f.vy = 0;
      for (var k = 0; k < 7; k++) {
        parts.push({ x: nx, y: top - 2, vx: (Math.random() - 0.5) * 90,
                     vy: -20 - Math.random() * 50, life: 0.4 + Math.random() * 0.4,
                     max: 0.8, size: 3 + Math.random() * 4, color: '#c9ad86', g: 320 });
      }
    }
  }

  function beginTurn() {
    if (checkEnd()) return;
    turn++;
    shuffleFoes();
    wind = (Math.random() * 2 - 1) * lv.wind;
    if (Math.abs(wind) < 4) wind = wind < 0 ? -4 : 4;
    phase = 'aim';
    /* 特殊弹药是整关总量，不再每回合白送——什么时候用是策略 */
    toast('你的回合 · ' + (wind >= 0 ? '顺风' : '逆风') + ' ' + Math.abs(Math.round(wind)));
    syncUI();
  }

  function playerFire() {
    if (phase !== 'aim') return;
    if (weapon > 0 && ammo[weapon] <= 0) { toast('这发弹药用完了'); return; }
    audio();
    if (weapon > 0) ammo[weapon]--;
    shoot(angle, power, weapon, player);
    phase = 'fly'; flyOwner = 'player'; flySettle = 0;
    syncUI();
  }

  function enemyTurn() {
    if (checkEnd()) return;
    phase = 'enemy';
    foeQueue = foes.filter(function (f) { return f.alive; });
    foeIdx = 0;
    syncUI();
    toast('敌方回合', 1100);
    nextFoe();
  }

  function nextFoe() {
    if (foeIdx >= foeQueue.length) { later(beginTurn, 700); return; }
    var u = foeQueue[foeIdx++];
    if (!u.alive) { nextFoe(); return; }
    aiSolve(u, player);
    shoot(u.aiAng, u.aiPow, 0, u);
    phase = 'fly'; flyOwner = 'foe'; flySettle = 0;
    syncUI();
  }

  function afterFlight() {
    for (var i = 0; i < foes.length; i++) if (foes[i].alive) foes[i].vy = Math.max(foes[i].vy, 20);
    if (checkEnd()) return;
    if (flyOwner === 'player') enemyTurn();
    else if (foeIdx < foeQueue.length) nextFoe();
    else beginTurn();
  }

  /* ---------------- 输入 ---------------- */
  function pointOf(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  cv.addEventListener('pointerdown', function (e) {
    if (phase !== 'aim' || !player || !player.alive) return;
    audio();
    drag = pointOf(e);
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  cv.addEventListener('pointermove', function (e) {
    if (!drag || phase !== 'aim') return;
    var p = pointOf(e);
    var dx = p.x - player.x, dy = player.y - p.y;
    if (Math.hypot(dx, dy) < 12) return;
    var a = Math.atan2(dy, dx) * 180 / Math.PI;
    angle = Math.max(8, Math.min(88, a));
    power = Math.max(0.2, Math.min(1, Math.hypot(dx, dy) / 330));
    syncUI();
    e.preventDefault();
  });
  cv.addEventListener('pointerup', function (e) {
    if (!drag) return;
    drag = null;
    if (phase === 'aim') playerFire();
    e.preventDefault();
  });
  cv.addEventListener('pointercancel', function () { drag = null; });

  document.addEventListener('keydown', function (e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar'].indexOf(e.key) >= 0) e.preventDefault();
    keys[e.key] = true;
    if (phase !== 'aim') return;
    if (e.key >= '1' && e.key <= '3') {
      var w = Number(e.key) - 1;
      if (w === 0 || ammo[w] > 0) { weapon = w; syncUI(); }
    }
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') playerFire();
    if (e.key === 'g' || e.key === 'G') { showGuide = !showGuide; toast(showGuide ? '瞄准线：开' : '瞄准线：关', 900); }
  });
  document.addEventListener('keyup', function (e) { keys[e.key] = false; });

  el.fire.addEventListener('click', playerFire);
  for (var wi = 0; wi < el.wps.length; wi++) {
    (function (i) {
      el.wps[i].addEventListener('click', function () {
        if (i > 0 && ammo[i] <= 0) { toast('这发弹药用完了'); return; }
        weapon = i; syncUI();
      });
    })(wi);
  }
  document.getElementById('restartBtn').addEventListener('click', function () { startLevel(level); });
  document.getElementById('helpBtn').addEventListener('click', showHelp);
  document.getElementById('rotBtn').addEventListener('click', function () {
    var host = document.getElementById('app');
    var req = host.requestFullscreen || host.webkitRequestFullscreen;
    if (!req) { toast('请手动把手机横过来', 2200); return; }
    try {
      Promise.resolve(req.call(host)).then(function () {
        var so = screen.orientation || screen.mozOrientation || screen.webkitOrientation;
        if (so && so.lock) {
          var p = so.lock('landscape');
          if (p && p.catch) p.catch(function () {});
        }
      }).catch(function () { toast('请手动把手机横过来', 2200); });
    } catch (e) { toast('请手动把手机横过来', 2200); }
  });

  /* ---------------- 覆盖层 ---------------- */
  function ov(html) { el.box.innerHTML = html; el.ov.classList.add('on'); }
  function ovOff() { el.ov.classList.remove('on'); }

  function stars(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += i < n ? '<span class="lit">★</span>' : '★';
    return s;
  }
  function showMenu() {
    phase = 'menu';
    var cards = '';
    for (var i = 0; i < LEVELS.length; i++) {
      var lock = i + 1 > save.unlocked;
      var st = save.stars[i] || 0;
      cards += '<button class="lv' + (lock ? ' lock' : '') + '" data-i="' + i + '"' + (lock ? ' disabled' : '') + ' type="button">' +
               '<b>' + (i + 1) + '. ' + LEVELS[i].name + '</b>' +
               '<span class="st">' + (st ? stars(st) : (lock ? '未解锁' : '未通关')) + '</span></button>';
    }
    ov('<h1>弹 弹 岛</h1>' +
       '<p class="tip">调好角度和力度，让炮弹划过海风砸向对岸。<br>炸开的坑会让整座岛塌进海里——把敌人打下来也算赢。</p>' +
       '<div id="levels">' + cards + '</div>' +
       '<p><span class="kbd">↑↓</span> 角度　<span class="kbd">←→</span> 力度　<span class="kbd">空格</span> 开火　<span class="kbd">1/2/3</span> 换弹<br>' +
       '手机上直接在画面里往想打的方向拖，松手就开火。</p>' +
       '<button class="btn" id="goFirst" type="button">从第一关开始</button>');
    var bs = el.box.querySelectorAll('.lv:not(.lock)');
    for (var j = 0; j < bs.length; j++) {
      (function (b) { b.addEventListener('click', function () { startLevel(Number(b.dataset.i)); }); })(bs[j]);
    }
    document.getElementById('goFirst').addEventListener('click', function () { startLevel(0); });
  }
  function showWin(st) {
    var last = level >= LEVELS.length - 1;
    ov('<h2>这一关，拿下了！</h2><div class="star">' + stars(st) + '</div>' +
       '<p>剩余血量 ' + Math.max(0, Math.round(player.hp)) + ' / ' + player.max + '　·　用了 ' + turn + ' 回合</p>' +
       (last ? '<p class="tip">六座岛全部清空，你就是这片海的老大。</p>' : '') +
       '<button class="btn" id="nextLv" type="button">' + (last ? '再打一轮' : '下一关') + '</button>' +
       '<button class="btn ghost" id="backMenu" type="button">关卡选择</button>');
    document.getElementById('nextLv').addEventListener('click', function () { startLevel(last ? 0 : level + 1); });
    document.getElementById('backMenu').addEventListener('click', showMenu);
  }
  function showLose() {
    ov('<h2>诶，被打下来了</h2>' +
       '<p>' + (player.hp <= 0 ? '血量见底。' : '连人带炮掉进海里了。') + '下次记得先看风向，再算抛物线。</p>' +
       '<p class="tip">' + lv.hint + '</p>' +
       '<button class="btn" id="again" type="button">再来一次</button>' +
       '<button class="btn ghost" id="backMenu" type="button">关卡选择</button>');
    document.getElementById('again').addEventListener('click', function () { startLevel(level); });
    document.getElementById('backMenu').addEventListener('click', showMenu);
  }
  function showHelp() {
    var prev = phase;
    ov('<h2>怎么玩</h2>' +
       '<p class="tip">你从左岸开炮，敌人从右岸回击，轮流来。<br>每发炮弹都受<b>重力</b>和<b>风力</b>影响，不是直线飞的。</p>' +
       '<p><b>标准弹</b>：无限发，稳。<br><b>三连散</b>：一发三枚扇形散开，打面。<br><b>重弹</b>：炸得又大又深，专拆地形。<br>后两种是<b>整关总量</b>，用完就没了，留到关键回合。</p>' +
       '<p class="tip">把敌人血打光，或者把他脚下的岛炸塌让他落海，都算赢。<br>' +
       '<span class="kbd">G</span> 可以开关那条虚线瞄准辅助。</p>' +
       '<button class="btn" id="okHelp" type="button">知道了</button>');
    document.getElementById('okHelp').addEventListener('click', function () {
      ovOff();
      if (prev === 'menu') showMenu();
      else if (prev === 'aim' || prev === 'fly' || prev === 'enemy') syncUI();
    });
  }

  function startLevel(i) {
    clearPending();
    level = Math.max(0, Math.min(LEVELS.length - 1, i));
    lv = LEVELS[level];
    makeTerrain();
    player = makeUnit(lv.isles[0][0], 100, false);
    foes = lv.foes.map(function (f) { return makeUnit(f[0], f[1], true); });
    shots = []; parts = []; floats = []; rings = [];
    weapon = 0; ammo = [0, 3, 2];
    angle = 45; power = 0.7; turn = 0; wind = 0;
    shake = 0; flash = 0; drag = null;
    foeQueue = []; foeIdx = 0; flySettle = 0;
    ovOff();
    syncUI();
    beginTurn();
    toast(lv.name + ' · ' + lv.hint, 4500);
  }

  /* ---------------- 渲染 ---------------- */
  var clouds = [
    { x: 160, y: 96, s: 1.1 }, { x: 530, y: 66, s: 0.75 },
    { x: 880, y: 120, s: 1.25 }, { x: 1180, y: 72, s: 0.85 }
  ];
  var skyGrad = null;
  function getSky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, SEA);
      skyGrad.addColorStop(0, '#3f7fc4');
      skyGrad.addColorStop(0.45, '#78b9e6');
      skyGrad.addColorStop(0.8, '#b9dcf0');
      skyGrad.addColorStop(1, '#f2d6ad');
    }
    return skyGrad;
  }
  function cloud(c, t) {
    var x = ((c.x + t * (6 + c.s * 3)) % (W + 260)) - 130;
    ctx.fillStyle = 'rgba(255,255,255,.68)';
    ctx.beginPath();
    ctx.ellipse(x, c.y, 62 * c.s, 20 * c.s, 0, 0, 7);
    ctx.ellipse(x + 42 * c.s, c.y - 12 * c.s, 42 * c.s, 22 * c.s, 0, 0, 7);
    ctx.ellipse(x - 44 * c.s, c.y + 4 * c.s, 38 * c.s, 16 * c.s, 0, 0, 7);
    ctx.fill();
  }
  function drawBg(t) {
    ctx.fillStyle = getSky(); ctx.fillRect(0, 0, W, SEA);
    /* 太阳 */
    var sx = 1040, sy = 150;
    var sg = ctx.createRadialGradient(sx, sy, 8, sx, sy, 110);
    sg.addColorStop(0, 'rgba(255,246,205,.95)');
    sg.addColorStop(0.3, 'rgba(255,224,150,.38)');
    sg.addColorStop(1, 'rgba(255,224,150,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - 110, sy - 110, 220, 220);
    ctx.fillStyle = '#fff2c4'; ctx.beginPath(); ctx.arc(sx, sy, 30, 0, 7); ctx.fill();
    for (var i = 0; i < clouds.length; i++) cloud(clouds[i], t);
    /* 远山 */
    ctx.fillStyle = 'rgba(70,112,148,.42)';
    ctx.beginPath(); ctx.moveTo(0, SEA);
    ctx.lineTo(0, 400); ctx.lineTo(150, 300); ctx.lineTo(280, 410);
    ctx.lineTo(430, 262); ctx.lineTo(600, 424); ctx.lineTo(760, 318);
    ctx.lineTo(940, 438); ctx.lineTo(1100, 330); ctx.lineTo(1280, 430);
    ctx.lineTo(1280, SEA); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(48,88,124,.45)';
    ctx.beginPath(); ctx.moveTo(0, SEA);
    ctx.lineTo(0, 470); ctx.lineTo(220, 392); ctx.lineTo(420, 486);
    ctx.lineTo(680, 400); ctx.lineTo(900, 488); ctx.lineTo(1120, 408);
    ctx.lineTo(1280, 478); ctx.lineTo(1280, SEA); ctx.closePath(); ctx.fill();
    /* 海 */
    var sea = ctx.createLinearGradient(0, SEA, 0, H);
    sea.addColorStop(0, '#4aa8c8'); sea.addColorStop(0.4, '#2c83ad'); sea.addColorStop(1, '#144f77');
    ctx.fillStyle = sea; ctx.fillRect(0, SEA, W, H - SEA);
    ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = 2;
    for (var r = 0; r < 5; r++) {
      var yy = SEA + 16 + r * 30;
      ctx.beginPath();
      for (var x = 0; x <= W; x += 16) {
        var y = yy + Math.sin(x * 0.021 + t * 1.7 + r * 1.3) * (2 + r * 0.6);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    /* 岸线白沫 */
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillRect(0, SEA - 2, W, 3);
  }

  function drawWindFlag(t) {
    if (!player) return;
    var fx = player.x, fy = Math.max(40, player.y - 118);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + 38); ctx.stroke();
    var dir = wind >= 0 ? 1 : -1;
    var len = 16 + Math.abs(wind) * 0.5 + Math.sin(t * 5) * 3;
    ctx.fillStyle = wind >= 0 ? '#ffd166' : '#ff9f9f';
    ctx.beginPath(); ctx.moveTo(fx, fy);
    ctx.lineTo(fx + dir * len, fy + 7 + Math.sin(t * 4) * 2);
    ctx.lineTo(fx, fy + 15); ctx.closePath(); ctx.fill();
  }

  function drawUnit(u, t) {
    if (!u) return;
    var a = u.foe ? (u.aiAng || 45) : angle;
    var rad = a * Math.PI / 180;
    ctx.save();
    ctx.translate(u.x, u.y);
    if (u.dead) { ctx.globalAlpha = Math.max(0, 1 - u.dead * 1.6); ctx.translate(0, u.dead * 90); }
    if (u.hurt > 0) { ctx.globalAlpha = 0.65 + 0.35 * Math.sin(t * 60); }
    var body = u.foe ? '#e8665b' : '#4aa6e8';
    var dark = u.foe ? '#a63d3d' : '#2268aa';
    /* 影子 */
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(0, 20, 27, 7, 0, 0, 7); ctx.fill();
    /* 履带 + 车身 */
    ctx.fillStyle = '#2d3848';
    ctx.beginPath(); ctx.roundRect(-26, 6, 52, 13, 6); ctx.fill();
    ctx.fillStyle = '#151e2b';
    for (var w = -18; w <= 18; w += 9) { ctx.beginPath(); ctx.arc(w, 12, 3.4, 0, 7); ctx.fill(); }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(-20, 6); ctx.lineTo(-14, -9); ctx.lineTo(14, -9); ctx.lineTo(21, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark;
    ctx.fillRect(-11, -18, 22, 10);
    /* 炮管（后坐时缩一点） */
    var recoil = (u.recoil || 0) * 7;
    ctx.save();
    ctx.translate(0, -13);
    ctx.rotate(-rad);
    ctx.translate(-recoil, 0);
    ctx.fillStyle = '#3c4a5c';
    ctx.beginPath(); ctx.roundRect(2, -5, 34, 10, 4); ctx.fill();
    ctx.fillStyle = '#93a6b8';
    ctx.fillRect(30, -5, 5, 10);
    ctx.restore();
    /* 小旗 */
    ctx.fillStyle = u.foe ? '#ffb1a6' : '#bfe4ff';
    ctx.fillRect(-21, -30, 2, 14);
    ctx.beginPath(); ctx.moveTo(-19, -30); ctx.lineTo(-6, -26); ctx.lineTo(-19, -22); ctx.closePath(); ctx.fill();
    ctx.restore();
    /* 血条 */
    if (u.alive) {
      var bw = 52, hpw = Math.max(0, u.hp / u.max) * bw;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(u.x - bw / 2 - 1, u.y - 46, bw + 2, 8);
      ctx.fillStyle = u.foe ? '#ff8b7a' : '#7fe3b0';
      ctx.fillRect(u.x - bw / 2, u.y - 45, hpw, 6);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(u.foe ? '敌' : '我', u.x, u.y - 50);
    }
    if (muzzle > 0 && !u.foe) {
      ctx.save();
      ctx.globalAlpha = muzzle;
      ctx.fillStyle = '#fff2b0';
      var mx = u.x + Math.cos(rad) * 46, my = u.y - 13 - Math.sin(rad) * 46;
      ctx.beginPath(); ctx.arc(mx, my, 9 + muzzle * 12, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  function drawGuide() {
    if (!showGuide || phase !== 'aim' || !player || !player.alive) return;
    var s = launchVec(player.x, player.y - 13, angle, power, WEAPONS[weapon].speed);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (var i = 0; i < 150; i++) {
      stepShot(s, DT * 2);
      if (i % 7 === 0) {
        ctx.globalAlpha = Math.max(0.12, 0.75 - i / 210);
        ctx.beginPath(); ctx.arc(s.x, s.y, i < 40 ? 3 : 2, 0, 7); ctx.fill();
      }
      if (solidPx(s.x, s.y) || s.y > H) break;
    }
    ctx.restore();
  }

  function drawShots() {
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      for (var j = 0; j < s.trail.length; j++) {
        var tr = s.trail[j];
        ctx.globalAlpha = (j + 1) / s.trail.length * 0.5;
        ctx.fillStyle = s.r >= 50 ? '#ffd166' : '#ffb36b';
        ctx.beginPath(); ctx.arc(tr.x, tr.y, (j + 1) / s.trail.length * 5, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = s.r >= 50 ? '#ffd166' : '#ff9a5c';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r >= 50 ? 9 : 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff2c4';
      ctx.beginPath(); ctx.arc(s.x - 2, s.y - 2, 2.5, 0, 7); ctx.fill();
    }
  }
  function drawFx() {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      ctx.globalAlpha = Math.max(0, r.life / 0.42);
      ctx.strokeStyle = r.color; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.6));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (var k = 0; k < floats.length; k++) {
      var f = floats[k];
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / f.max * 1.6));
      ctx.font = 'bold 24px sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function render(t, dt) {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBg(t);
    if (terrainDirty) paintTerrain();
    ctx.drawImage(terrain, 0, 0);
    drawWindFlag(t);
    drawGuide();
    drawUnit(player, t);
    for (var i = 0; i < foes.length; i++) drawUnit(foes[i], t);
    drawShots();
    drawFx();
    ctx.restore();
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,240,200,' + (flash * 0.45) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------- 主循环 ---------------- */
  var lastT = 0, acc = 0;
  function loop(now) {
    var t = now / 1000;
    var dt = Math.min(0.05, lastT ? t - lastT : 0.016);
    lastT = t;
    frameNo++;

    /* 键盘连续调整 */
    if (phase === 'aim') {
      var spdA = (keys.ArrowUp || keys.w || keys.W ? 1 : 0) - (keys.ArrowDown || keys.s || keys.S ? 1 : 0);
      var spdP = (keys.ArrowRight || keys.d || keys.D ? 1 : 0) - (keys.ArrowLeft || keys.a || keys.A ? 1 : 0);
      if (spdA || spdP) {
        angle = Math.max(8, Math.min(88, angle + spdA * 46 * dt));
        power = Math.max(0.2, Math.min(1, power + spdP * 0.48 * dt));
        syncUI();
      }
    }

    /* 单位重力：地形被炸空后掉下去 */
    var all = [player].concat(foes);
    for (var i = 0; i < all.length; i++) {
      var u = all[i];
      if (!u || !u.alive) { if (u) u.dead += dt; continue; }
      if (!solidPx(u.x, u.y + 21)) {
        u.vy += GRAV * 0.72 * dt;
        u.y += u.vy * dt;
        if (u.y > SEA + 10) kill(u, 'sea');
      } else { u.vy = 0; }
      u.recoil = Math.max(0, u.recoil - dt * 5);
      u.hurt = Math.max(0, u.hurt - dt);
    }

    /* 弹道积分 */
    acc += dt;
    var guard = 0;
    while (acc >= DT && guard++ < 12) {
      acc -= DT;
      for (var s = shots.length - 1; s >= 0; s--) {
        var b = shots[s];
        stepShot(b, DT);
        if (frameNo % 3 === 0) {
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > 7) b.trail.shift();
        }
        var boom = false;
        if (b.y > H + 20 || b.x < -80 || b.x > W + 80 || b.life <= 0) {
          shots.splice(s, 1);
          boom = false;
          continue;
        }
        if (solidPx(b.x, b.y)) boom = true;
        var units = [player].concat(foes);
        for (var k = 0; k < units.length; k++) {
          var u2 = units[k];
          if (u2 && u2.alive && u2 !== b.owner && Math.hypot(u2.x - b.x, u2.y - b.y) < 20) { boom = true; break; }
        }
        if (boom) { explode(b); shots.splice(s, 1); }
      }
    }
    if ((phase === 'fly') && shots.length === 0) {
      flySettle += dt;
      if (flySettle > 0.45) { flySettle = -999; afterFlight(); }
    }

    /* 粒子 */
    for (var p = parts.length - 1; p >= 0; p--) {
      var q = parts[p];
      q.vy += (q.g || 400) * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.life -= dt;
      if (q.life <= 0 || q.y > H + 30) parts.splice(p, 1);
    }
    for (var r = rings.length - 1; r >= 0; r--) {
      var rg = rings[r];
      rg.r += (rg.max - rg.r) * Math.min(1, dt * 9);
      rg.life -= dt;
      if (rg.life <= 0) rings.splice(r, 1);
    }
    for (var f = floats.length - 1; f >= 0; f--) {
      floats[f].y -= 34 * dt; floats[f].life -= dt;
      if (floats[f].life <= 0) floats.splice(f, 1);
    }
    shake = Math.max(0, shake - dt * 26);
    flash = Math.max(0, flash - dt * 1.7);
    muzzle = Math.max(0, muzzle - dt * 4);

    render(t, dt);
    requestAnimationFrame(loop);
  }

  /* 首屏：菜单背景也要有一块地 */
  lv = LEVELS[0];
  makeTerrain();
  player = makeUnit(lv.isles[0][0], 100, false);
  foes = lv.foes.map(function (f) { return makeUnit(f[0], f[1], true); });
  syncUI();
  showMenu();
  requestAnimationFrame(loop);

  /* 给自动化测试用的只读探针 */
  window.WH_DANDADAO = {
    get phase() { return phase; },
    get level() { return level; },
    get turn() { return turn; },
    get wind() { return wind; },
    get hp() { return player ? player.hp : 0; },
    get foes() { return foes.map(function (f) { return { hp: f.hp, alive: f.alive, x: f.x, y: f.y }; }); },
    get shots() { return shots.length; },
    solid: function (x, y) { return solidPx(x, y); },
    start: startLevel,
    fire: playerFire,
    aim: function (a, p) { angle = a; power = p; syncUI(); },
    /* 用与 AI 相同的弹道推演，给自动化测试一个稳定命中解 */
    suggest: function () {
      var t = null;
      for (var i = 0; i < foes.length; i++) if (foes[i].alive) { t = foes[i]; break; }
      if (!t || !player) return null;
      var best = null, bd = 1e9;
      for (var a = 15; a <= 85; a += 2) {
        for (var p = 0.3; p <= 1.001; p += 0.025) {
          var d = simulate(player.x, player.y - 13, a, p, 1060, t);
          if (d < bd) { bd = d; best = { a: a, p: p, miss: d }; }
        }
      }
      return best;
    }
  };
})();
