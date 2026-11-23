/* ============================================================
 * games/fight/src/main.js —— 招式格斗：主控
 * ------------------------------------------------------------
 * 自研实现。流程：选角 → 选技能 → 对战 → 结算 → 下一回合
 * 键位：1P W/A/S/D 移动跳跃 · J 直拳 · K 小踢 · U/I/O 三个技能 · Shift 防御
 *       2P ←/→/↑/↓ 移动跳跃 · Numpad1/2/3 或 , . / 拳踢技能
 * ============================================================ */
(function (global) {
  'use strict';

  var A = global.FightArena, R = global.FightRender;
  if (!A || !R) return;

  var cv, ctx, W = A.W, H = A.H;

  var state = 'pick';        /* pick | fight | over */
  var p1roll = 0, p2roll = 1;
  var p1skill = 0, p2skill = 0;   /* 选中的技能序号 */
  var f1 = null, f2 = null;
  var fx = [];
  var round = 1, roundTime = 0, overAt = 0;
  var best = 0;
  var keys = Object.create(null);
  var raf = 0, last = 0;
  var canvasScale = 1;

  /* ---------- DOM ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* ---------- 选角界面 ---------- */
  function buildPick() {
    var wrap = $('pick');
    wrap.innerHTML = '';
    var head = el('div', 'pk-head');
    head.appendChild(el('h2', null, '选角色'));
    head.appendChild(el('p', 'pk-tip', '左右各选一位：点卡片切换。技能在开打后按 U / I / O 释放。'));
    wrap.appendChild(head);

    var grid = el('div', 'pk-grid');
    A.ROLLS.forEach(function (r, i) {
      var card = el('div', 'pk-card');
      card.style.setProperty('--c', r.col);
      card.style.setProperty('--a', r.accent);
      /* 角标：明确标出 1P / 2P，别只靠边框颜色猜 */
      card.appendChild(el('span', 'pk-tag p1t', '1P'));
      card.appendChild(el('span', 'pk-tag p2t', '2P'));
      card.appendChild(el('div', 'pk-name', r.name));
      card.appendChild(el('div', 'pk-title', r.title));
      var stats = el('div', 'pk-stats');
      [['速度', r.spd], ['跳跃', r.jump / 700], ['力量', r.power], ['体力', r.hp / 126]].forEach(function (s) {
        var row = el('div', 'pk-stat');
        row.appendChild(el('span', 'pk-stat-k', s[0]));
        var bar = el('div', 'pk-bar');
        var fill = el('i');
        fill.style.width = Math.round(Math.min(1, s[1]) * 100) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        stats.appendChild(row);
      });
      card.appendChild(stats);
      card.addEventListener('click', function () {
        if (sel === 1) { p1roll = i; sel = 2; p2roll = (i + 1) % A.ROLLS.length; }
        else { p2roll = i; sel = 1; }
        refreshPick();
      });
      card.dataset.idx = i;
      grid.appendChild(card);
    });
    wrap.appendChild(grid);

    var go = el('button', 'pk-go', '开始对战');
    go.addEventListener('click', startFight);
    wrap.appendChild(go);

    /* 联机入口：同一套角色与技能，这里改成跟真人打 */
    var online = el('a', 'pk-online', '联机对战 · 跟朋友打');
    online.href = '/games/party/index.html?game=fist';
    wrap.appendChild(online);
  }
  var sel = 1;

  function refreshPick() {
    var cards = $('pick').querySelectorAll('.pk-card');
    for (var i = 0; i < cards.length; i++) {
      var idx = +cards[i].dataset.idx;
      var isP1 = idx === p1roll, isP2 = idx === p2roll;
      cards[i].classList.toggle('p1', isP1);
      cards[i].classList.toggle('p2', isP2);
      cards[i].classList.toggle('both', isP1 && isP2);
      cards[i].querySelector('.p1t').style.opacity = isP1 ? '1' : '0';
      cards[i].querySelector('.p2t').style.opacity = isP2 ? '1' : '0';
    }
    var hint = $('pick').querySelector('.pk-tip');
    if (hint) {
      hint.textContent = '1P：' + A.ROLLS[p1roll].name + '　2P：' + A.ROLLS[p2roll].name
        + '　—　点卡片换人（技能在开打后按 U / I / O 释放）';
    }
  }

  /* ---------- 开战 ---------- */
  function startFight() {
    state = 'fight';
    round = 1; roundTime = 0;
    f1 = A.makeFighter(A.ROLLS[p1roll].id, -1, 240);
    f2 = A.makeFighter(A.ROLLS[p2roll].id, 1, W - 240);
    fx = [];
    $('pick').style.display = 'none';
    $('stage').style.display = 'block';
    $('hudinfo').style.display = 'flex';
    /* 关键：舞台刚从 display:none 变回来，此时才量得到真实尺寸。
       之前在 init 时量一次拿到的是 0（隐藏容器），画布被缩成 0 像素 —— 
       页面看着「有背景但没人」，其实整张画布不可见。 */
    fit();
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function nextRound(winner) {
    /* 胜者加一胜，2 胜拿下这一场 */
    if (winner === 1) f1.wins++; else if (winner === 2) f2.wins++;
    if (f1.wins >= 2 || f2.wins >= 2) {
      endMatch(f1.wins >= 2 ? 1 : 2);
      return;
    }
    round++;
    /* 保留胜场，重置位置与血量 */
    var w1 = f1.wins, w2 = f2.wins;
    f1 = A.makeFighter(A.ROLLS[p1roll].id, -1, 240);
    f2 = A.makeFighter(A.ROLLS[p2roll].id, 1, W - 240);
    f1.wins = w1; f2.wins = w2;
    fx = [];
    roundTime = 0;
  }

  function endMatch(winner) {
    state = 'over';
    var box = $('over');
    box.style.display = 'flex';
    box.innerHTML = '';
    var win = winner === 1 ? f1 : f2;
    var card = el('div', 'pk-over-card');
    card.appendChild(el('div', 'pk-over-title', (winner === 1 ? '1P ' : '2P ') + win.name + ' 获胜'));
    card.appendChild(el('div', 'pk-over-sub', '比分 ' + f1.wins + ' : ' + f2.wins));
    var again = el('button', 'pk-go', '再来一场');
    again.addEventListener('click', function () {
      box.style.display = 'none';
      state = 'pick';
      $('stage').style.display = 'none';
      $('hudinfo').style.display = 'none';
      $('pick').style.display = 'block';
      sel = 1;
      refreshPick();
    });
    card.appendChild(again);
    box.appendChild(card);
  }

  /* ---------- 输入 ---------- */
  var MAP_P1 = {
    left: ['a', 'A'], right: ['d', 'D'], jump: ['w', 'W'],
    punch: ['j', 'J'], kick: ['k', 'K'],
    s1: ['u', 'U'], s2: ['i', 'I'], s3: ['o', 'O'],
    guard: ['shift', 'Shift']
  };
  var MAP_P2 = {
    left: ['arrowleft', 'ArrowLeft'], right: ['arrowright', 'ArrowRight'],
    jump: ['arrowup', 'ArrowUp'],
    punch: [',', '<'], kick: ['.', '>'],
    s1: ['1', 'Numpad1'], s2: ['2', 'Numpad2'], s3: ['3', 'Numpad3'],
    guard: ['control', 'Control']
  };

  function pressed(map, name) {
    var ks = map[name];
    for (var i = 0; i < ks.length; i++) if (keys[ks[i]]) return true;
    return false;
  }

  /* 技能冷却中不能重复触发：用边沿检测 */
  var edge = Object.create(null);
  function tapped(map, name) {
    var ks = map[name];
    var now = false;
    for (var i = 0; i < ks.length; i++) if (keys[ks[i]]) { now = true; break; }
    var id = name + ':' + ks[0];
    var was = edge[id];
    edge[id] = now;
    return now && !was;
  }

  function readInput(map, fighter, skillIdx) {
    var mx = 0;
    if (pressed(map, 'left')) mx -= 1;
    if (pressed(map, 'right')) mx += 1;
    var inp = {
      mx: mx,
      jump: tapped(map, 'jump'),
      atk: null,
      skill: null
    };
    if (tapped(map, 'punch')) inp.atk = 'punch';
    else if (tapped(map, 'kick')) inp.atk = 'kick';
    /* 技能：按 U/I/O 选择第 1/2/3 个 */
    var names = ['s1', 's2', 's3'];
    for (var i = 0; i < 3; i++) {
      if (tapped(map, names[i])) {
        var sk = fighter.roll ? A.rollOf(fighter.roll).skills[i] : null;
        if (sk) inp.skill = sk;
      }
    }
    /* 防御按住生效 */
    if (pressed(map, 'guard')) {
      if (!fighter.guard) fighter.guard = 0.25;
    }
    return inp;
  }

  /* ---------- 主循环 ---------- */
  function loop(now) {
    raf = requestAnimationFrame(loop);
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state !== 'fight') { renderIdle(now); return; }

    var t = now / 1000;
    var i1 = readInput(MAP_P1, f1, p1skill);
    var i2 = readInput(MAP_P2, f2, p2skill);

    /* 防御：按住持续 */
    if (pressed(MAP_P1, 'guard')) f1.guard = Math.max(f1.guard, 0.2);
    if (pressed(MAP_P2, 'guard')) f2.guard = Math.max(f2.guard, 0.2);

    roundTime += dt;
    var res = A.step(f1, f2, i1, i2, dt, fx);
    /* 技能道具 */
    for (var i = fx.length - 1; i >= 0; i--) {
      if (fx[i].t === 'proj') {
        fx[i].x += fx[i].dir * 420 * dt;
        fx[i].t2 = (fx[i].t2 || 0) + dt * 14;
        /* 命中判定 */
        var owner = fx[i].dir < 0 ? f1 : f2;
        var target = fx[i].dir < 0 ? f2 : f1;
        if (Math.abs(fx[i].x - target.x) < 24 && Math.abs(fx[i].y - (target.y - 26)) < 34) {
          A.damage(owner, target, A.SKILLS.leaf, fx);
          fx[i].dead = true;
        }
        if (fx[i].x < -30 || fx[i].x > W + 30) fx[i].dead = true;
      }
    }
    fx = fx.filter(function (e) {
      if (e.dead) return false;
      if (e.t === 'hit') e.life -= dt;
      else if (e.t === 'ko') e.life -= dt;
      else if (e.t === 'cast') e.life -= dt;
      else if (e.t === 'land') e.life -= dt;
      else e.life = 0.5;
      return !(e.life !== undefined && e.life <= 0);
    });

    if (res.over) {
      overAt = t;
      setTimeout(function () { if (state === 'fight') nextRound(res.over === -1 ? 0 : res.over); }, 1100);
      state = 'fightend';
    }

    render(t);
  }

  function renderIdle(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    R.drawBg(ctx, now / 1000);
  }

  function render(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    R.drawBg(ctx, t);
    R.drawFighter(ctx, f1, t, false);
    R.drawFighter(ctx, f2, t, true);
    fx.forEach(function (e) { R.drawFx(ctx, e); });
    R.drawHud(ctx, f1, f2, t, '第 ' + round + ' 回合 · ' + Math.max(0, 99 - Math.floor(roundTime)) + 's');
    R.drawCombo(ctx, f1, 24, false);
    R.drawCombo(ctx, f2, W - 24, true);

    /* 技能冷却提示 */
    drawSkillBar(ctx, f1, 40, 92, false);
    drawSkillBar(ctx, f2, W - 40, 92, true);

    if (state === 'fightend') {
      ctx.fillStyle = 'rgba(20,14,32,.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '800 56px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('K.O.', W / 2, H / 2);
    }
  }

  function drawSkillBar(c, f, x, y, right) {
    var r = A.rollOf(f.roll);
    for (var i = 0; i < 3; i++) {
      var sid = r.skills[i];
      var s = A.SKILLS[sid];
      if (!s) continue;                     /* 技能名对不上就跳过，别让整个 HUD 崩 */
      var cd = f.cd[sid] || 0;
      var ready = cd <= 0 && f.energy >= s.cost;
      var cx = right ? x - i * 66 - 46 : x + i * 66;
      c.save();
      c.fillStyle = ready ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.28)';
      c.beginPath(); c.arc(cx, y, 25, 0, 6.284); c.fill();
      if (!ready && cd > 0) {
        /* 冷却扇形 */
        c.fillStyle = 'rgba(30,24,44,.6)';
        c.beginPath();
        c.moveTo(cx, y);
        c.arc(cx, y, 25, -Math.PI / 2, -Math.PI / 2 + (cd / s.cd) * 6.284);
        c.closePath(); c.fill();
      }
      c.fillStyle = ready ? '#3a3340' : 'rgba(60,50,70,.7)';
      c.font = '700 11px system-ui,sans-serif';
      c.textAlign = 'center';
      c.fillText(s.name.slice(0, 3), cx, y + 4);
      c.restore();
    }
  }

  /* ---------- 画布自适应 ----------
     放在模块作用域：startFight 也要用（舞台显示后才有真实尺寸）。 */
  function fit() {
    var wrap = $('stage');
    if (!wrap || !cv) return;
    var aw = wrap.clientWidth, ah = wrap.clientHeight;
    if (!aw || !ah) return;                 /* 隐藏时量到 0，直接跳过，别把画布缩没 */
    var s = Math.min(aw / W, ah / H);
    canvasScale = s;
    cv.style.width = Math.round(W * s) + 'px';
    cv.style.height = Math.round(H * s) + 'px';
  }

  /* ---------- 初始化 ---------- */
  function init() {
    cv = $('cv');
    ctx = cv.getContext('2d');
    cv.width = W; cv.height = H;
    buildPick();
    refreshPick();

    document.addEventListener('keydown', function (e) {
      keys[e.key] = true;
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
      if (k === 'enter' && state === 'pick') startFight();
    });
    document.addEventListener('keyup', function (e) { keys[e.key] = false; });

    /* 触屏按钮 */
    function bindBtn(id, fn) {
      var b = $(id);
      if (!b) return;
      var on = function (e) { e.preventDefault(); fn(); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('mousedown', on);
    }
    bindBtn('b-left', function () { keys['a'] = true; });
    bindBtn('b-right', function () { keys['d'] = true; });
    bindBtn('b-jump', function () { keys['w'] = true; setTimeout(function () { keys['w'] = false; }, 60); });
    bindBtn('b-punch', function () { keys['j'] = true; setTimeout(function () { keys['j'] = false; }, 60); });
    bindBtn('b-kick', function () { keys['k'] = true; setTimeout(function () { keys['k'] = false; }, 60); });
    bindBtn('b-s1', function () { keys['u'] = true; setTimeout(function () { keys['u'] = false; }, 60); });
    bindBtn('b-s2', function () { keys['i'] = true; setTimeout(function () { keys['i'] = false; }, 60); });
    bindBtn('b-s3', function () { keys['o'] = true; setTimeout(function () { keys['o'] = false; }, 60); });

    /* 画布自适应 */
    window.addEventListener('resize', fit);
    fit();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  global.FightMain = { start: startFight, state: function () { return state; } };
})(typeof window !== 'undefined' ? window : globalThis);
