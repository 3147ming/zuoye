/* ============================================================
 * tools/pomodoro/js/pomodoro.js —— 番茄钟 · 专注台
 * ------------------------------------------------------------
 * 自研实现。机制：
 *   · 番茄循环：专注 → 短休 → 专注 → 短休 …… 第 4 轮后长休
 *   · 三段时长可设置（专注 / 短休 / 长休），目标轮数可设
 *   · 任务清单：可增删、勾选完成、可置顶为「本轮任务」
 *   · 周统计：最近 7 天的完成轮数柱状图 + 本周总数
 *   · 专注时屏幕会有呼吸光晕，状态一目了然
 *   · 猫用 SVG 自绘，随状态换表情（不依赖任何图片素材）
 *   · 背景音用 WebAudio 合成（不依赖任何音频文件）
 *   · 结束提示用 WebAudio 的双音（不依赖外部音频）
 * ============================================================ */
(function () {
  'use strict';

  var KEY = 'worldhub.pomodoro.v2';
  var ROUNDS_DEFAULT = 4;

  /* ---------- 状态 ---------- */
  var cfg = {
    focus: 25, brk: 5, longBrk: 15, goal: 8
  };
  var mode = 'focus';       /* focus | short | long */
  var round = 1;            /* 当前是第几轮专注（1..goal） */
  var remain = cfg.focus * 60;
  var running = false;
  var total = remain;       /* 本段总秒数，用于进度条 */
  var task = '';            /* 本轮专注的任务名 */
  var tasks = [];           /* 任务清单 */
  var nextId = 1;
  var history = {};         /* { 'YYYY-MM-DD': 完成轮数 } */
  var showCat = true;

  var elTimer, elMode, elBar, elRound, elTask, elStats, elGoal;
  var elTasks, elCat, elRing, elAudio;
  var tick = null;
  var lastTick = 0;

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function mmss(s) {
    s = Math.max(0, Math.round(s));
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        cfg: cfg, history: history, tasks: tasks, nextId: nextId, goal: cfg.goal
      }));
    } catch (e) { /* ignore */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.cfg) {
        cfg.focus = +d.cfg.focus || 25;
        cfg.brk = +d.cfg.brk || 5;
        cfg.longBrk = +d.cfg.longBrk || 15;
      }
      if (d.goal) cfg.goal = +d.goal || 8;
      history = d.history || {};
      tasks = d.tasks || [];
      nextId = d.nextId || 1;
    } catch (e) { /* ignore */ }
  }

  /* ---------- 猫（SVG 自绘） ---------- */
  function drawCat(state) {
    /* 状态：idle / focus / short / long / paused / done */
    var colors = {
      idle: { body: '#f4a261', dark: '#e07a4f', face: '#3a2c25' },
      focus: { body: '#7ee0a0', dark: '#4fb87a', face: '#23321f' },
      short: { body: '#8ecae6', dark: '#4f9dc0', face: '#1d2b33' },
      long: { body: '#c0a5ff', dark: '#9077d6', face: '#2a2340' },
      paused: { body: '#b0b0bd', dark: '#8a8a99', face: '#33333d' },
      done: { body: '#ffd166', dark: '#e0ab3f', face: '#3a2f18' }
    };
    var c = colors[state] || colors.idle;
    var eyes = state === 'done' ? 'happy' : (state === 'paused' ? 'sleep' : 'open');
    var svg = '<svg viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg" class="cat-svg">';
    /* 耳朵 */
    svg += '<path d="M28 42 L30 16 L52 32 Z" fill="' + c.dark + '"/>';
    svg += '<path d="M92 42 L90 16 L68 32 Z" fill="' + c.dark + '"/>';
    svg += '<path d="M32 36 L33 24 L44 33 Z" fill="#f7c9b0"/>';
    svg += '<path d="M88 36 L87 24 L76 33 Z" fill="#f7c9b0"/>';
    /* 头 */
    svg += '<ellipse cx="60" cy="58" rx="36" ry="31" fill="' + c.body + '"/>';
    /* 眼睛 */
    if (eyes === 'happy') {
      svg += '<path d="M42 54 q7 -8 14 0" stroke="' + c.face + '" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
      svg += '<path d="M64 54 q7 -8 14 0" stroke="' + c.face + '" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
    } else if (eyes === 'sleep') {
      svg += '<path d="M43 55 h12" stroke="' + c.face + '" stroke-width="3.4" stroke-linecap="round"/>';
      svg += '<path d="M65 55 h12" stroke="' + c.face + '" stroke-width="3.4" stroke-linecap="round"/>';
    } else {
      svg += '<ellipse cx="49" cy="55" rx="5" ry="6" fill="' + c.face + '"/>';
      svg += '<ellipse cx="71" cy="55" rx="5" ry="6" fill="' + c.face + '"/>';
      svg += '<circle cx="50.6" cy="53" r="1.8" fill="#fff"/>';
      svg += '<circle cx="72.6" cy="53" r="1.8" fill="#fff"/>';
    }
    /* 鼻子嘴 */
    svg += '<path d="M60 64 l-4 4 h8 Z" fill="#e07a7a"/>';
    svg += '<path d="M60 68 q-6 6 -11 1 M60 68 q6 6 11 1" stroke="' + c.face + '" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
    /* 胡须 */
    svg += '<path d="M20 58 h12 M20 65 h12 M100 58 h-12 M100 65 h-12" stroke="' + c.face + '" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>';
    /* 身体 */
    svg += '<path d="M34 84 q26 -12 52 0 l0 22 q-26 8 -52 0 Z" fill="' + c.body + '"/>';
    /* 前爪 */
    svg += '<ellipse cx="46" cy="100" rx="9" ry="6" fill="' + c.dark + '"/>';
    svg += '<ellipse cx="74" cy="100" rx="9" ry="6" fill="' + c.dark + '"/>';
    /* 尾巴 */
    svg += '<path d="M86 92 q16 -2 12 -18" stroke="' + c.dark + '" stroke-width="7" fill="none" stroke-linecap="round"/>';
    svg += '</svg>';
    return svg;
  }

  function catState() {
    if (!running && remain === cfg.focus * 60 && round === 1 && mode === 'focus') return 'idle';
    if (mode === 'short') return 'short';
    if (mode === 'long') return 'long';
    if (!running) return 'paused';
    return 'focus';
  }

  /* ---------- 声音（WebAudio 合成，不用音频文件） ---------- */
  var actx = null;
  function audio() {
    if (!actx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      actx = new C();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  /* 结束双音 */
  function chime() {
    var a = audio();
    if (!a) return;
    var now = a.currentTime;
    [523.25, 783.99].forEach(function (f, i) {
      var o = a.createOscillator();
      var g = a.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.22, now + i * 0.18 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.5);
      o.connect(g); g.connect(a.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.55);
    });
  }

  /* 背景音：棕噪音（滤波白噪声） */
  var noiseNode = null, noiseGain = null;
  function toggleNoise() {
    var a = audio();
    if (!a) return;
    if (noiseNode) {
      try { noiseNode.stop(); } catch (e) { /* ignore */ }
      noiseNode = null; noiseGain = null;
      return false;
    }
    var len = a.sampleRate * 3;
    var buf = a.createBuffer(1, len, a.sampleRate);
    var data = buf.getChannelData(0);
    var lastOut = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    var src = a.createBufferSource();
    src.buffer = buf; src.loop = true;
    var filt = a.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 900;
    var g = a.createGain();
    g.gain.value = 0.16;
    src.connect(filt); filt.connect(g); g.connect(a.destination);
    src.start();
    noiseNode = src; noiseGain = g;
    return true;
  }

  /* ---------- 计时 ---------- */
  function start() {
    if (running) return;
    running = true;
    lastTick = performance.now();
    if (tick) clearInterval(tick);
    tick = setInterval(onTick, 200);
    render();
  }

  function pause() {
    running = false;
    if (tick) { clearInterval(tick); tick = null; }
    render();
  }

  function onTick() {
    var now = performance.now();
    var dt = (now - lastTick) / 1000;
    lastTick = now;
    remain -= dt;
    if (remain <= 0) {
      remain = 0;
      finishPhase();
    }
    render();
  }

  function finishPhase() {
    chime();
    if (mode === 'focus') {
      /* 完成一轮专注 */
      var d = today();
      history[d] = (history[d] || 0) + 1;
      /* 本轮任务自动勾掉 */
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i].id === task) { tasks[i].done = true; break; }
      }
      task = '';
      save();
      if (round >= cfg.goal) {
        mode = 'long';
      } else {
        mode = 'short';
      }
    } else {
      mode = 'focus';
      if (mode === 'focus' && round < cfg.goal) round++;
    }
    if (mode === 'long') {
      round = 1;
    } else if (mode === 'focus') {
      round = Math.min(round + 1, cfg.goal);
    }
    total = (mode === 'focus' ? cfg.focus : mode === 'short' ? cfg.brk : cfg.longBrk) * 60;
    remain = total;
    running = false;
    if (tick) { clearInterval(tick); tick = null; }
    render();
    if (stateChanged) render();
  }

  var stateChanged = false;

  /* ---------- 渲染 ---------- */
  function render() {
    elTimer.textContent = mmss(remain);
    elMode.textContent = mode === 'focus' ? '专注中' : mode === 'short' ? '短休息' : '长休息';
    elRound.textContent = '第 ' + Math.min(round, cfg.goal) + ' / ' + cfg.goal + ' 轮';
    /* 显示任务名，不是内部 id */
    var taskName = '';
    for (var i = 0; i < tasks.length; i++) {
      if (String(tasks[i].id) === String(task)) { taskName = tasks[i].name; break; }
    }
    elTask.textContent = taskName || (mode === 'focus' ? '未设置本轮任务' : '休息一下');

    var p = total > 0 ? 1 - remain / total : 0;
    elBar.style.width = (p * 100).toFixed(1) + '%';

    $('btnStart').textContent = running ? '运行中' : (remain === total ? '开始' : '继续');
    $('btnPause').disabled = !running;

    if (elCat) elCat.innerHTML = drawCat(catState());
    renderTasks();
    renderStats();
  }

  function renderTasks() {
    elTasks.innerHTML = '';
    tasks.forEach(function (t) {
      var row = document.createElement('div');
      row.className = 'task' + (t.done ? ' done' : '') + (t.id === task ? ' pinned' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!t.done;
      cb.addEventListener('change', function () { t.done = cb.checked; save(); render(); });
      var name = document.createElement('span');
      name.className = 'task-name';
      name.textContent = t.name;
      name.addEventListener('click', function () {
        task = (task === t.id) ? '' : String(t.id);
        save(); render();
      });
      var del = document.createElement('button');
      del.className = 'task-del';
      del.textContent = '×';
      del.addEventListener('click', function () {
        tasks = tasks.filter(function (x) { return x.id !== t.id; });
        if (task === String(t.id)) task = '';
        save(); render();
      });
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(del);
      elTasks.appendChild(row);
    });
  }

  function renderStats() {
    var days = [];
    var base = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(base.getTime() - i * 86400000);
      var key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      days.push({ key: key, label: '日一二三四五六'.charAt(d.getDay()), n: history[key] || 0 });
    }
    var max = 1;
    days.forEach(function (d) { if (d.n > max) max = d.n; });
    var html = '<div class="chart">';
    days.forEach(function (d) {
      var h = Math.round((d.n / max) * 100);
      html += '<div class="col" title="' + d.key + '：' + d.n + ' 轮">'
        + '<div class="barwrap"><i style="height:' + Math.max(d.n ? 8 : 2, h) + '%"></i></div>'
        + '<span>' + d.label + '</span><b>' + d.n + '</b></div>';
    });
    html += '</div>';
    var weekTotal = days.reduce(function (s, d) { return s + d.n; }, 0);
    elStats.innerHTML = html;
    elGoal.textContent = weekTotal + ' 轮';
  }

  /* ---------- 交互 ---------- */
  function bind() {
    $('btnStart').addEventListener('click', function () {
      if (running) return;
      if (remain === total) { /* 全新一段 */ }
      start();
    });
    $('btnPause').addEventListener('click', pause);
    $('btnReset').addEventListener('click', function () {
      pause();
      total = (mode === 'focus' ? cfg.focus : mode === 'short' ? cfg.brk : cfg.longBrk) * 60;
      remain = total;
      render();
    });
    $('btnSkip').addEventListener('click', function () {
      pause();
      finishPhase();
    });
    $('btnAddTask').addEventListener('click', addTask);
    $('taskInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addTask();
    });
    $('btnSettings').addEventListener('click', function () {
      var p = $('settingsPanel');
      p.style.display = p.style.display === 'flex' ? 'none' : 'flex';
    });
    $('btnApply').addEventListener('click', applySettings);
    $('btnCat').addEventListener('click', function () {
      showCat = !showCat;
      elCat.style.display = showCat ? 'block' : 'none';
      this.textContent = showCat ? '🙈' : '🙉';
    });
    $('btnNoise').addEventListener('click', function () {
      this.textContent = toggleNoise() ? '🔊 噪音开' : '🔇 噪音关';
    });
    $('btnFull').addEventListener('click', function () {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) document.exitFullscreen();
    });
  }

  function addTask() {
    var input = $('taskInput');
    var name = (input.value || '').trim();
    if (!name) return;
    tasks.unshift({ id: nextId++, name: name, done: false });
    input.value = '';
    save();
    render();
  }

  function applySettings() {
    var f = parseInt($('inFocus').value, 10);
    var b = parseInt($('inBreak').value, 10);
    var l = parseInt($('inLong').value, 10);
    var g = parseInt($('inGoal').value, 10);
    var err = $('settingsError');
    if (!f || f < 1 || f > 180) { err.textContent = '专注时长要在 1–180 分钟之间'; return; }
    if (!b || b < 1 || b > 60) { err.textContent = '短休息时长要在 1–60 分钟之间'; return; }
    if (!l || l < 1 || l > 120) { err.textContent = '长休息时长要在 1–120 分钟之间'; return; }
    if (!g || g < 1 || g > 12) { err.textContent = '目标轮数要在 1–12 之间'; return; }
    err.textContent = '';
    cfg.focus = f; cfg.brk = b; cfg.longBrk = l; cfg.goal = g;
    round = 1;
    pause();
    mode = 'focus';
    total = cfg.focus * 60;
    remain = total;
    save();
    render();
    $('settingsPanel').style.display = 'none';
  }

  /* ---------- 初始化 ---------- */
  function init() {
    elTimer = $('timerDisplay');
    elMode = $('modeLabel');
    elBar = $('progressBar');
    elRound = $('roundInfo');
    elTask = $('activeTaskText');
    elStats = $('weeklyChart');
    elGoal = $('goalCount');
    elTasks = $('taskList');
    elCat = $('catBox');

    load();
    $('inFocus').value = cfg.focus;
    $('inBreak').value = cfg.brk;
    $('inLong').value = cfg.longBrk;
    $('inGoal').value = cfg.goal;

    total = cfg.focus * 60;
    remain = total;

    bind();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.POMODORO = {
    state: function () {
      return { mode: mode, round: round, remain: remain, running: running, cfg: cfg,
               tasks: tasks.map(function (t) { return { id: t.id, name: t.name, done: !!t.done }; }),
               task: task, history: history };
    },
    start: start, pause: pause,
    setMode: function (m) {
      mode = m;
      total = (m === 'focus' ? cfg.focus : m === 'short' ? cfg.brk : cfg.longBrk) * 60;
      remain = total;
      pause(); render();
    },
    addTask: function (n) { tasks.unshift({ id: nextId++, name: n, done: false }); save(); render(); },
    pin: function (id) { task = (task === String(id)) ? '' : String(id); save(); render(); },
    /* 测试用：把剩余时间压到指定秒数，方便验证「一段结束」的转场 */
    setRemain: function (s) { remain = s; render(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
