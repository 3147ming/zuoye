/* ============================================================
 * games/breakout/js/breakout.js —— 打砖块
 * ------------------------------------------------------------
 * 自研实现。机制：挡板接球、砖块消���、多球、关卡、道具、命数。
 *
 * 核心是「圆与矩形求交 + 反射」：每帧把球的运动线段与
 * 挡板/砖块/墙做相交测试，按命中的是哪一面决定反射方向。
 * ============================================================ */
(function () {
  'use strict';

  var W = 720, H = 560;
  var PAD_W = 96, PAD_H = 16;
  var BRICK_W = 60, BRICK_H = 24, BRICK_GAP = 4;
  var COLS = 10, ROWS = 6;

  /* 砖块颜色（按行） */
  var ROW_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa'];

  /* 道具类型 */
  var POWER = {
    expand: { name: '加长', color: '#8ff0b5', dur: 12 },
    shrink: { name: '缩短', color: '#ff8fb1', dur: 8 },
    slow: { name: '减速', color: '#7ec8ff', dur: 10 },
    fast: { name: '加速', color: '#ffd166', dur: 8 },
    multi: { name: '多球', color: '#c0a5ff', dur: 0 },
    life: { name: '加命', color: '#ff9f9f', dur: 0 },
    laser: { name: '激光', color: '#6ee7d7', dur: 10 }
  };

  var cv, ctx;
  var pad, balls = [], bricks = [], powers = [], particles = [], lasers = [];
  var lives = 3, score = 0, level = 1, levelData = null;
  var state = 'ready';     /* ready | play | dead | clear | over */
  var keys = Object.create(null);
  var combo = 0, comboT = 0;
  var last = 0;

  var elScore, elLives, elLevel, elMsg, elState;

  /* ---------- 关卡 ----------
     每关给出砖块布局：{rows: 布局数组, speed: 球速, powerRate: 道具概率}
     布局用字符串：'.' 空，'#' 普通，'*' 硬砖（要两下），'R' 再生砖 */
  var LEVELS = [
    { name: '第一关 · 开局', speed: 300, powerRate: 0.12,
      rows: [
        '##########',
        '##########',
        '..........',
        '..........',
        '..........',
        '..........'
      ] },
    { name: '第二关 · 硬砖', speed: 330, powerRate: 0.14,
      rows: [
        '##########',
        '##########',
        '**######**',
        '**######**',
        '..........',
        '..........'
      ] },
    { name: '第三关 · 菱形', speed: 355, powerRate: 0.16,
      rows: [
        '....##....',
        '...####...',
        '..######..',
        '.########.',
        '##########',
        '..........'
      ] },
    { name: '第四关 · 蜂窝', speed: 380, powerRate: 0.18,
      rows: [
        '#.#.#.#.#.',
        '.#.#.#.#.#',
        '#.#.#.#.#.',
        '.#.#.#.#.#',
        '#.#.#.#.#.',
        '..........'
      ] },
    { name: '第五关 · 城墙', speed: 405, powerRate: 0.2,
      rows: [
        '##########',
        '#*#*#*#*#*',
        '#*#*#*#*#*',
        '#*#*#*#*#*',
        '#*#*#*#*#*',
        '##########'
      ] },
    { name: '第六关 · 残垣', speed: 430, powerRate: 0.22,
      rows: [
        '###...###.',
        '.###.###..',
        '..###.###.',
        '...#.###..',
        '....#.....',
        '..........'
      ] },
    { name: '第七关 · 铁幕', speed: 455, powerRate: 0.24,
      rows: [
        '##########',
        '##########',
        '**######**',
        '**######**',
        '##########',
        '##########'
      ] },
    { name: '终关 · 天罗', speed: 490, powerRate: 0.28,
      rows: [
        '##########',
        '.########.',
        '..######..',
        '...####...',
        '....##....',
        '.....#....'
      ] }
  ];

  /* ---------- 初始化 ---------- */
  function loadLevel(i) {
    levelData = LEVELS[Math.min(i, LEVELS.length - 1)];
    level = Math.min(i + 1, LEVELS.length);
    bricks = [];
    for (var y = 0; y < levelData.rows.length; y++) {
      var row = levelData.rows[y];
      var offX = (W - (COLS * BRICK_W + (COLS - 1) * BRICK_GAP)) / 2;
      for (var x = 0; x < COLS && x < row.length; x++) {
        var ch = row[x];
        if (ch === '.') continue;
        bricks.push({
          x: offX + x * (BRICK_W + BRICK_GAP), y: 60 + y * (BRICK_H + BRICK_GAP),
          w: BRICK_W, h: BRICK_H,
          hp: ch === '*' ? 2 : 1, max: ch === '*' ? 2 : 1,
          kind: ch === '*' ? 'hard' : 'normal',
          color: ROW_COLORS[y % ROW_COLORS.length]
        });
      }
    }
    powers = [];
    particles = [];
    lasers = [];
    combo = 0; comboT = 0;
    state = 'ready';
    updateHud();
    draw();
  }

  function resetBall() {
    balls = [{
      x: pad.x + pad.w / 2, y: pad.y - 12, vx: 0, vy: 0,
      r: 8, speed: levelData ? levelData.speed : 300, attached: true
    }];
    pad.x = W / 2 - PAD_W / 2;
    pad.w = PAD_W;
    pad.powerT = {};
  }

  function newGame() {
    lives = 3; score = 0;
    pad = { x: W / 2 - PAD_W / 2, y: H - 46, w: PAD_W, h: PAD_H, powerT: {} };
    loadLevel(0);
    resetBall();
  }

  /* ---------- 物理 ---------- */
  function update(dt) {
    /* 挡板跟随 */
    var spd = 460;
    if (keys.left) pad.x -= spd * dt;
    if (keys.right) pad.x += spd * dt;
    if (pad.x < 0) pad.x = 0;
    if (pad.x + pad.w > W) pad.x = W - pad.w;

    /* 道具效果倒计时 */
    for (var k in pad.powerT) {
      pad.powerT[k] -= dt;
      if (pad.powerT[k] <= 0) {
        delete pad.powerT[k];
        if (k === 'expand') pad.w = PAD_W;
        if (k === 'shrink') pad.w = PAD_W;
        if (k === 'slow') balls.forEach(function (b) { b.speed = levelData.speed; });
        if (k === 'fast') balls.forEach(function (b) { b.speed = levelData.speed; });
        if (k === 'laser') lasers = [];
      }
    }

    comboT = Math.max(0, comboT - dt);
    if (comboT === 0) combo = 0;

    /* 发射 */
    if (state === 'ready') {
      balls.forEach(function (b) {
        b.x = pad.x + pad.w / 2;
        b.y = pad.y - 12;
      });
      if (keys.fire || keys.space) launch();
      return;
    }
    if (state !== 'play') return;

    /* 球 */
    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      if (b.attached) {
        b.x = pad.x + pad.w / 2;
        b.y = pad.y - 12;
        continue;
      }
      /* 速度修正（快/慢道具） */
      var target = levelData.speed;
      if (pad.powerT.slow) target *= 0.68;
      if (pad.powerT.fast) target *= 1.42;
      var sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) { b.vx = b.vx / sp * target; b.vy = b.vy / sp * target; }
      b.speed = target;

      /* 移动 + 分段碰撞（高速时一帧可能穿砖） */
      var steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 6));
      var sdt = dt / steps;
      for (var s = 0; s < steps; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        if (hitWalls(b)) continue;
        if (hitPad(b)) continue;
        if (hitBricks(b)) continue;
      }

      /* 出界 */
      if (b.y > H + 20) {
        balls.splice(i, 1);
        if (!balls.length) {
          lives--;
          combo = 0;
          updateHud();
          if (lives <= 0) { state = 'over'; showMsg('游戏结束', '再来一局'); }
          else { resetBall(); state = 'ready'; }
        }
      }
    }

    /* 激光 */
    for (var li = lasers.length - 1; li >= 0; li--) {
      lasers[li].y -= 620 * dt;
      if (lasers[li].y < 40) { lasers.splice(li, 1); continue; }
      for (var bi = bricks.length - 1; bi >= 0; bi--) {
        var br = bricks[bi];
        if (lasers[li].x > br.x && lasers[li].x < br.x + br.w &&
            lasers[li].y < br.y + br.h && lasers[li].y > br.y) {
          damageBrick(br, 1);
          lasers.splice(li, 1);
          break;
        }
      }
    }

    /* 道具生成 */
    if (bricks.length && Math.random() < levelData.powerRate * dt * 3) {
      spawnPower();
    }

    /* 道具下落 */
    for (var pi = powers.length - 1; pi >= 0; pi--) {
      var pw = powers[pi];
      pw.y += 190 * dt;
      pw.rot += dt * 2;
      if (pw.y > H + 20) { powers.splice(pi, 1); continue; }
      if (pw.y + 12 > pad.y && pw.y - 12 < pad.y + pad.h &&
          pw.x > pad.x - 12 && pw.x < pad.x + pad.w + 12) {
        applyPower(pw.kind);
        powers.splice(pi, 1);
      }
    }

    /* 粒子 */
    for (var q = particles.length - 1; q >= 0; q--) {
      var pa = particles[q];
      pa.life -= dt;
      pa.x += pa.vx * dt;
      pa.y += pa.vy * dt;
      pa.vy += 420 * dt;
      if (pa.life <= 0) particles.splice(q, 1);
    }

    /* 通关 */
    if (!bricks.length && state === 'play') {
      score += 200 + level * 50;
      updateHud();
      if (level >= LEVELS.length) { state = 'over'; showMsg('全部通关！', '再来一局'); }
      else { state = 'clear'; showMsg('过关！+ ' + (200 + level * 50), '下一关'); }
    }
  }

  function launch() {
    balls.forEach(function (b) {
      if (!b.attached) return;
      b.attached = false;
      var ang = (-Math.PI / 2) + (Math.random() * 0.8 - 0.4);
      b.vx = Math.cos(ang) * b.speed;
      b.vy = Math.sin(ang) * b.speed;
    });
    state = 'play';
  }

  function hitWalls(b) {
    var hit = false;
    if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); hit = true; }
    else if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx); hit = true; }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); hit = true; }
    return hit;
  }

  function hitPad(b) {
    if (b.vy <= 0) return false;
    if (b.y + b.r < pad.y || b.y - b.r > pad.y + pad.h) return false;
    if (b.x < pad.x - b.r || b.x > pad.x + pad.w + b.r) return false;
    /* 按落点位置决定反弹角度：边缘打出更斜的球 */
    var rel = (b.x - (pad.x + pad.w / 2)) / (pad.w / 2);
    rel = Math.max(-1, Math.min(1, rel));
    var ang = -Math.PI / 2 + rel * 1.05;
    var sp = Math.hypot(b.vx, b.vy) || b.speed;
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    b.y = pad.y - b.r;
    return true;
  }

  function hitBricks(b) {
    for (var i = 0; i < bricks.length; i++) {
      var br = bricks[i];
      var cx = Math.max(br.x, Math.min(b.x, br.x + br.w));
      var cy = Math.max(br.y, Math.min(b.y, br.y + br.h));
      var dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > b.r * b.r) continue;

      /* 决定从哪个方向弹开：看重叠更深的一面 */
      var overlapL = (b.x - b.r) - br.x;            /* 从左边来 */
      var overlapR = (br.x + br.w) - (b.x + b.r);   /* 从右边来 */
      var overlapT = (b.y - b.r) - br.y;            /* 从上边来 */
      var overlapB = (br.y + br.h) - (b.y + b.r);   /* 从下边来 */
      var min = Math.min(overlapL, overlapR, overlapT, overlapB);
      if (min === overlapT) { b.y = br.y - b.r; b.vy = -Math.abs(b.vy); }
      else if (min === overlapB) { b.y = br.y + br.h + b.r; b.vy = Math.abs(b.vy); }
      else if (min === overlapL) { b.x = br.x - b.r; b.vx = -Math.abs(b.vx); }
      else { b.x = br.x + br.w + b.r; b.vx = Math.abs(b.vx); }

      damageBrick(br, 1);
      return true;
    }
    return false;
  }

  function damageBrick(br, dmg) {
    br.hp -= dmg;
    combo++;
    comboT = 1.6;
    score += 10 * Math.min(combo, 8);
    burst(br.x + br.w / 2, br.y + br.h / 2, br.color, br.hp <= 0 ? 14 : 6);
    if (br.hp <= 0) {
      var i = bricks.indexOf(br);
      if (i >= 0) bricks.splice(i, 1);
    }
    updateHud();
  }

  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      particles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.5) * 260 - 60,
        life: 0.4 + Math.random() * 0.4, max: 0.8,
        size: 2 + Math.random() * 3, color: color
      });
    }
  }

  function spawnPower() {
    var keys2 = Object.keys(POWER);
    var kind = keys2[Math.floor(Math.random() * keys2.length)];
    var br = bricks[Math.floor(Math.random() * bricks.length)];
    if (!br) return;
    powers.push({ x: br.x + br.w / 2, y: br.y, kind: kind, rot: 0 });
  }

  function applyPower(kind) {
    var p = POWER[kind];
    if (!p) return;
    if (kind === 'expand') { pad.w = Math.min(160, pad.w + 44); pad.powerT.expand = p.dur; }
    else if (kind === 'shrink') { pad.w = Math.max(52, pad.w - 30); pad.powerT.shrink = p.dur; }
    else if (kind === 'slow') pad.powerT.slow = p.dur;
    else if (kind === 'fast') pad.powerT.fast = p.dur;
    else if (kind === 'laser') pad.powerT.laser = p.dur;
    else if (kind === 'multi') {
      var src = balls[0];
      if (src) {
        for (var i = 0; i < 2; i++) {
          var a = Math.atan2(src.vy, src.vx) + (i === 0 ? 0.5 : -0.5);
          balls.push({
            x: src.x, y: src.y, r: src.r, speed: src.speed, attached: false,
            vx: Math.cos(a) * src.speed, vy: Math.sin(a) * src.speed
          });
        }
      }
    } else if (kind === 'life') { lives++; updateHud(); }
  }

  /* ---------- 绘制 ---------- */
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    /* 背景 */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#181428');
    g.addColorStop(1, '#0c0a16');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    /* 底部地面 */
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(0, H - 14, W, 14);

    /* 砖块 */
    bricks.forEach(function (br) {
      ctx.fillStyle = br.color;
      rr(ctx, br.x, br.y, br.w, br.h, 4); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      rr(ctx, br.x + 2, br.y + 2, br.w - 4, 5, 2); ctx.fill();
      if (br.kind === 'hard' && br.hp > 1) {
        ctx.strokeStyle = 'rgba(0,0,0,.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    /* 挡板 */
    ctx.fillStyle = pad.powerT.laser ? '#6ee7d7' : '#c8b6ff';
    rr(ctx, pad.x, pad.y, pad.w, pad.h, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    rr(ctx, pad.x + 3, pad.y + 2, pad.w - 6, 5, 3); ctx.fill();
    /* 挡板火力槽 */
    if (pad.powerT.laser) {
      lasers.push({ x: pad.x + 6, y: pad.y - 4 });
      lasers.push({ x: pad.x + pad.w - 6, y: pad.y - 4 });
    }

    /* 球 */
    balls.forEach(function (b) {
      ctx.save();
      ctx.shadowColor = '#ffd9a0';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffe9c4';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.284); ctx.fill();
      ctx.restore();
    });

    /* 道具 */
    powers.forEach(function (p) {
      var info = POWER[p.kind];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = info.color;
      rr(ctx, -11, -11, 22, 22, 6); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#1a1428';
      ctx.font = '700 11px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(info.name.slice(0, 2), p.x, p.y + 4);
    });

    /* 粒子 */
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    /* 激光 */
    lasers.forEach(function (l) {
      ctx.fillStyle = '#6ee7d7';
      ctx.fillRect(l.x - 2, l.y - 16, 4, 16);
    });

    /* 连击 */
    if (combo >= 3) {
      ctx.fillStyle = '#ffd166';
      ctx.font = '800 18px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(combo + ' 连击', 14, 26);
    }
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    elScore.textContent = String(score);
    elLives.textContent = '♥'.repeat(Math.max(0, lives)) || '—';
    elLevel.textContent = level + ' / ' + LEVELS.length;
    elState.textContent = state === 'play' ? '进行中' : state === 'ready' ? '按空格发球'
      : state === 'clear' ? '过关' : state === 'over' ? '结束' : '—';
  }

  function showMsg(title, btn) {
    elMsg.style.display = 'flex';
    elMsg.querySelector('.m-title').textContent = title;
    elMsg.querySelector('button').textContent = btn;
  }
  function hideMsg() { elMsg.style.display = 'none'; }

  /* ---------- 主循环 ---------- */
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    updateHud();
  }

  /* ---------- 输入 ---------- */
  document.addEventListener('keydown', function (e) {
    var k = String(e.key).toLowerCase();
    if (k === 'arrowleft' || k === 'arrowright' || k === ' ') e.preventDefault();
    if (k === 'arrowleft' || k === 'a') keys.left = true;
    else if (k === 'arrowright' || k === 'd') keys.right = true;
    else if (k === ' ' || k === 'f') {
      keys.fire = true;
      /* 按下瞬间就直接发球：靠每帧轮询 keys.fire 会漏 ——
         一次按键的 down→up 可能发生在同一帧内，轮询根本看不到。 */
      if (state === 'ready') launch();
    }
    else if (k === 'r') { newGame(); hideMsg(); blurFocus(); }
  });
  document.addEventListener('keyup', function (e) {
    var k = String(e.key).toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.left = false;
    else if (k === 'arrowright' || k === 'd') keys.right = false;
    else if (k === ' ' || k === 'f') keys.fire = false;
  });

  function bindBtn(id, fn) {
    var b = document.getElementById(id);
    if (!b) return;
    b.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
    b.addEventListener('mousedown', function (e) { e.preventDefault(); fn(); });
  }
  bindBtn('b-left', function () { keys.left = true; });
  bindBtn('b-right', function () { keys.right = true; });
  bindBtn('b-fire', function () { keys.fire = true; setTimeout(function () { keys.fire = false; }, 60); });

  document.getElementById('btn-new').addEventListener('click', function () { newGame(); hideMsg(); blurFocus(); });
  document.getElementById('msg').querySelector('button').addEventListener('click', function () {
    if (state === 'clear') { loadLevel(level); hideMsg(); }
    else { newGame(); hideMsg(); }
    blurFocus();
  });

  function blurFocus() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* ---------- 初始化 ---------- */
  function init() {
    cv = document.getElementById('cv');
    ctx = cv.getContext('2d');
    cv.width = W; cv.height = H;
    elScore = document.getElementById('score');
    elLives = document.getElementById('lives');
    elLevel = document.getElementById('level');
    elMsg = document.getElementById('msg');
    elState = document.getElementById('state');
    newGame();
    last = performance.now();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.BREAKOUT = {
    state: function () { return { score: score, lives: lives, level: level, state: state, bricks: bricks.length, balls: balls.length }; },
    newGame: newGame, loadLevel: loadLevel, launch: launch,
    pad: function () { return { x: pad.x, w: pad.w }; },
    balls: function () { return balls.map(function (b) { return { x: b.x, y: b.y, vx: b.vx, vy: b.vy }; }); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
