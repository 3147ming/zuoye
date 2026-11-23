#!/usr/bin/env node
/* ============================================================
 * tools/predict-lag.mjs —— 「按键到画面」延迟的量化仿真
 * ------------------------------------------------------------
 * 为什么要单独写这个（而不是继续用 predict-sim.mjs）：
 *   旧脚本拿「延迟画面画的位置」vs「当前真值」比，那测的是**位置误差**，
 *   等于 RTT × 速度，所以「不开预测」永远落后几百 px，数字很好看但没有意义
 *   —— 玩家真正在意的不是「我比别人看到的世界旧了 150ms」，
 *   而是「我按下 → 我的车多久开始动」。
 *
 * 本脚本测的是**响应延迟**：
 *   在 f0 帧按下（从静止起步，或突然反向/转向），
 *   记录「画面上第一次出现可察觉位移」是在第几帧，乘 16.67ms 得延迟；
 *   同时用加速度重心算一个更稳的指标（对平滑、慢启动都更公平）。
 *
 * 三个受测玩法都用**服务端真物理**（server/games/*.js）跑，
 * 客户端侧用 js/party/predict.js + js/party/shared.js 的同一份物理函数。
 *
 * 用法：node tools/predict-lag.mjs [--json]
 * 退出码：开预测没有明显改善时非 0
 * ============================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PR = require('../js/party/predict.js');
const SH = require('../js/party/shared.js');
const games = require('../server/games/index.js');

const MS_PER_FRAME = 1000 / 60;

/* 加速度重心：把「位移曲线」看成概率分布，重心 = 平均「动起来」的时刻。
   比「首次超过阈值」稳，也不会被单帧抖动骗到。
   注意第二个峰：角色跑到墙/障碍被挡住后位移不再增长，曲线变平，
   所以重心天然落在「起效 + 半个加速段」上，不会一直往后飘。 */
function centroidFrames(arr) {
  let sw = 0, sd = 0;
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) { sw += d; sd += d * i; }
  }
  return sw > 0 ? sd / sw : NaN;
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 双向链路 ---------- */
function Link(rtt, jit, loss, rand) {
  this.rtt = rtt; this.jit = jit || 0; this.loss = loss || 0; this.rand = rand || Math.random;
  this.up = []; this.down = []; this.now = 0;
}
Link.prototype._at = function () { return this.now + this.rtt / 2 + (this.rand() - 0.5) * 2 * this.jit; };
Link.prototype.send = function (msg) {
  if (this.rand() < this.loss) return;
  this.up.push({ at: this._at(), msg });
};
Link.prototype.push = function (msg) {
  if (this.rand() < this.loss) return;
  this.down.push({ at: this._at(), msg });
};
Link.prototype._drain = function (box) {
  box.sort((a, b) => a.at - b.at);
  const out = [];
  while (box.length && box[0].at <= this.now) out.push(box.shift().msg);
  return out;
};
Link.prototype.takeUp = function () { return this._drain(this.up); };
Link.prototype.takeDown = function () { return this._drain(this.down); };

/* ============================================================
 * 一次「响应延迟」实验
 * ------------------------------------------------------------
 * 场景：f0 帧之前一直给「静止」输入（让速度收敛到 0），
 *       f0 帧突然给一个满方向输入，之后保持不动，测 60 帧。
 * 客户端在 f0 帧并没有收到任何新信息，所以：
 *   · 不开预测 → 要等 f0 的输入跑完 RTT 上行、服务端算、快照再跑 RTT 下行，
 *                画面上才开始动；
 *   · 开预测   → 本帧就动。
 * 这就是玩家说的「跟手」。
 * ============================================================ */
function measure(ctx) {
  const { link, pred, makeInput, holdFrames, watchFrames, applyInput, stepAll, snapOf, posOf } = ctx;
  let ack = 0;
  let f0 = -1;
  const series = [];             /* 相对 f0 的每帧「画面上看到的位置」 */
  const truthSeries = [];
  const startPos = posOf();
  let acc = 0, firstMove = -1, worstVis = 0, visSum = 0, visN = 0;

  const total = holdFrames + watchFrames;
  for (let f = 0; f < total; f++) {
    link.now = f * MS_PER_FRAME;
    const active = f >= holdFrames;
    if (f === holdFrames) f0 = f;

    const inp = active ? makeInput(f - holdFrames) : ctx.idleInput();

    /* 本地预测照常推进（每帧都推进，跟真实客户端一样） */
    if (ctx.serverSideSeq !== false) {
      const seq = pred.send(inp);
      /* 20Hz 上报 */
      if (f % 3 === 0) link.send({ seq, inp });
    }

    applyInput(inp);

    for (const u of link.takeUp()) { ctx.onServerInput(u.inp); ack = Math.max(ack, u.seq); }
    stepAll();

    if (f % 2 === 0) link.push(snapOf());
    for (const m of link.takeDown()) pred.onSnap(m.ack != null ? m.ack : ack, m.st);

    pred.correct(1 / 60);
    pred.tick(1 / 60);
    const vis = Math.hypot(pred.ex, pred.ey);
    if (vis > worstVis) worstVis = vis;
    visSum += vis; visN += 1;

    const drawn = { x: pred.drawX(), y: pred.drawY() };
    if (active) {
      const k = f - holdFrames;
      const d = Math.hypot(drawn.x - startPos.x, drawn.y - startPos.y);
      series[k] = d;
      truthSeries[k] = ctx.truthDisp(startPos);
      if (firstMove < 0 && d > 2) firstMove = k;
    }
  }

  return {
    firstFrame: firstMove,
    firstMs: firstMove * MS_PER_FRAME,
    centFrame: centroidFrames(series),
    centMs: centroidFrames(series) * MS_PER_FRAME,
    visAvg: visSum / Math.max(1, visN), visWorst: worstVis, hard: pred.hardHits
  };
}

/* ============================================================
 * 三套受测场景
 * ============================================================ */
const ME = { id: 'me', name: '我', seat: 0 };
const BOT = { id: 'p2', name: '路人', seat: 1 };

/* ---------- 1. 坦克：原地，突然往前开 ---------- */
function tankCase(rtt, jit, loss, seed) {
  const gs = games.get('tank').create({ seed, random: mulberry(seed), players: [ME, BOT], send: () => {} });
  const s0 = gs.snapshot(0);
  const walls = s0.wl || [], bricks = s0.br || [];
  const m0 = s0.k.find((x) => x[0] === 'me');
  let tanksNow = s0.k;
  const link = new Link(rtt, jit, loss, mulberry(seed + 3));

  /* 让机器人待着别动（它一动就会挡路，测的就不是响应了） */
  gs.onInput(BOT, { thr: 0, turn: 0 });

  const pred = new PR.Pred({
    key: 'me', x: m0[1], y: m0[2], a: m0[3],
    idle: () => ({ thr: 0, turn: 0 }),
    step: (b, inp) => SH.stepTank(b, inp, walls, bricks, tanksNow, 'me'),
    snap: (s) => ({ x: s[1], y: s[2], a: s[3] }),
    apply: (b, s) => { b.x = s.x; b.y = s.y; b.a = s.a; }
  });

  function posNow() {
    const m = gs.snapshot(0).k.find((x) => x[0] === 'me');
    return { x: m[1], y: m[2] };
  }

  const r = measure({
    link, pred,
    holdFrames: 90, watchFrames: 60,
    idleInput: () => ({ thr: 0, turn: 0 }),
    makeInput: () => ({ thr: 1, turn: 0 }),
    applyInput: () => {},
    onServerInput: (inp) => gs.onInput(ME, inp),
    stepAll: () => {
      gs.onInput(BOT, { thr: 0, turn: 0 });
      gs.step(1 / 60, 0);
      tanksNow = gs.snapshot(0).k;
    },
    snapOf: () => {
      const st = gs.snapshot(0);
      const m = st.k.find((x) => x[0] === 'me');
      return { st: [0, m[1], m[2], m[3]], x: m[1], y: m[2] };
    },
    posOf: posNow,
    truthDisp: (s0p) => { const p = posNow(); return Math.hypot(p.x - s0p.x, p.y - s0p.y); }
  });
  return r;
}

/* ---------- 2. 碰碰：静止，突然朝右冲 ---------- */
function bounceCase(rtt, jit, loss, seed) {
  const gs = games.get('bounce').create({ seed, random: mulberry(seed), players: [ME, BOT], send: () => {} });
  const s0 = gs.snapshot(0);
  const obs = s0.mp ? s0.mp.o : [];
  const m0 = s0.b.find((x) => x[0] === 'me');
  const link = new Link(rtt, jit, loss, mulberry(seed + 5));

  /* 机器人塞到很远的角落原地待着（避免被撞，不然测的是撞飞不是响应） */
  gs.onInput(BOT, { x: 0, y: 0 });

  const pred = new PR.Pred({
    key: 'me', x: m0[1], y: m0[2],
    conv: 12, hard: 320,
    idle: () => ({ x: 0, y: 0 }),
    step: (b, inp) => SH.stepBody(b, { x: (inp && inp.x) || 0, y: (inp && inp.y) || 0, sp: 1 }, obs),
    snap: (s) => ({ x: s[1], y: s[2] }),
    apply: (b, s) => { b.x = s.x; b.y = s.y; }
  });

  function posNow() {
    const m = gs.snapshot(0).b.find((x) => x[0] === 'me');
    return { x: m[1], y: m[2] };
  }

  return measure({
    link, pred,
    holdFrames: 90, watchFrames: 60,
    idleInput: () => ({ x: 0, y: 0 }),
    /* 朝场地中心推：大多数出生点朝中心走都不会立刻撞挡 */
    makeInput: () => {
      const p = posNow();
      const dx = 500 - p.x, dy = 320 - p.y, mm = Math.hypot(dx, dy) || 1;
      return { x: dx / mm, y: dy / mm };
    },
    applyInput: () => {},
    onServerInput: (inp) => gs.onInput(ME, inp),
    stepAll: () => {
      gs.onInput(BOT, { x: 0, y: 0 });
      gs.step(1 / 60, 0);
    },
    snapOf: () => {
      const st = gs.snapshot(0);
      const m = st.b.find((x) => x[0] === 'me');
      return { st: [0, m[1], m[2]], x: m[1], y: m[2] };
    },
    posOf: posNow,
    truthDisp: (s0p) => { const p = posNow(); return Math.hypot(p.x - s0p.x, p.y - s0p.y); }
  });
}

/* ---------- 3. 球场：静止，突然朝右跑 ---------- */
function pitchCase(rtt, jit, loss, seed) {
  const gs = games.get('pitch').create({ seed, random: mulberry(seed), players: [ME, BOT], send: () => {} });
  /* 跳过开局 2.4 秒的摆位停顿。注意：md（场地几何 + 物理参数）
     只会在**第一条**快照里下发一次，所以必须先把第一条留下 */
  const first = gs.snapshot(0);
  const geo = first.md.geo, C = first.md.C;
  for (let i = 0; i < 150; i++) gs.step(1 / 60, i);
  const s0 = gs.snapshot(0);
  const m0 = s0.pl.find((x) => x[0] === 'me');
  const link = new Link(rtt, jit, loss, mulberry(seed + 11));

  const pred = new PR.Pred({
    key: 'me', x: m0[1], y: m0[2], a: m0[3],
    idle: () => ({ x: 0, y: 0 }),
    step: (b, inp) => {
      const ba = gs.snapshot(0).ba;
      SH.stepPlayer(b, { x: (inp && inp.x) || 0, y: (inp && inp.y) || 0, sp: 1 },
        { x: ba[0], y: ba[1], vx: 0, vy: 0 }, 1 / 60, C);
    },
    snap: (s) => ({ x: s[1], y: s[2], a: s[3] }),
    apply: (b, s) => { b.x = s.x; b.y = s.y; b.a = s.a; }
  });

  function posNow() {
    const m = gs.snapshot(0).pl.find((x) => x[0] === 'me');
    return { x: m[1], y: m[2] };
  }

  return measure({
    link, pred,
    holdFrames: 60, watchFrames: 60,
    idleInput: () => ({ x: 0, y: 0 }),
    /* 朝球跑（球在中间，队伍在两侧） */
    makeInput: () => {
      const ba = gs.snapshot(0).ba, p = posNow();
      const dx = ba[0] - p.x, dy = ba[1] - p.y, mm = Math.hypot(dx, dy) || 1;
      return { x: dx / mm, y: dy / mm };
    },
    applyInput: () => {},
    onServerInput: (inp) => gs.onInput(ME, inp),
    stepAll: () => {
      gs.onInput(BOT, { x: 0, y: 0 });
      gs.step(1 / 60, 0);
    },
    snapOf: () => {
      const st = gs.snapshot(0);
      const m = st.pl.find((x) => x[0] === 'me');
      return { st: [0, m[1], m[2], m[3]], x: m[1], y: m[2] };
    },
    posOf: posNow,
    truthDisp: (s0p) => { const p = posNow(); return Math.hypot(p.x - s0p.x, p.y - s0p.y); }
  });
}

/* ============================================================
 * 「不开预测」的对照：完全相同的链路，但客户端只画最后一份快照
 * ============================================================ */
function baseline(kind, rtt, jit, loss, seed) {
  const ctx = kind === 'tank' ? tankBaseline(rtt, jit, loss, seed)
    : kind === 'bounce' ? bounceBaseline(rtt, jit, loss, seed)
      : pitchBaseline(rtt, jit, loss, seed);
  return ctx;
}

/* 三个基线共用一个骨架：链路 + 服务端，客户端只画「最后收到的快照」 */
function baselineSkeleton(pump, rtt, jit, loss, seed, holdFrames, watchFrames) {
  const link = new Link(rtt, jit, loss, mulberry(seed + 17));
  /* 起点必须在「任何输入到达服务端之前」记下来：否则等第一个包把角色推动之后
     再取起点，位移曲线会从负值起步，重心算出来是 NaN */
  const origin = pump.pos0();
  /* 「画面上现在是哪一帧的快照」——第一帧无论链路多快都还没有快照到手 */
  let shown = pump.snap().st;
  let f0 = -1;
  const series = [];
  for (let f = 0; f < holdFrames + watchFrames; f++) {
    link.now = f * MS_PER_FRAME;
    const active = f >= holdFrames;
    if (f === holdFrames) f0 = f;
    const inp = active ? pump.activeInput() : pump.idleInput();
    if (f % 3 === 0) link.send({ seq: f, inp });
    for (const u of link.takeUp()) pump.onServerInput(u.inp);
    pump.step();
    if (f % 2 === 0) link.push(pump.snap());
    for (const m of link.takeDown()) shown = m.st;
    if (active) {
      if (!shown) throw new Error('baseline: shown undefined at f=' + f);
      const d = Math.hypot(shown[1] - origin.x, shown[2] - origin.y);
      series[f - holdFrames] = d;
    }
  }
  let firstMove = -1;
  for (let i = 0; i < series.length; i++) if (series[i] > 2) { firstMove = i; break; }
  return {
    firstFrame: firstMove,
    firstMs: firstMove * MS_PER_FRAME,
    centFrame: centroidFrames(series),
    centMs: centroidFrames(series) * MS_PER_FRAME
  };
}

function tankBaseline(rtt, jit, loss, seed) {
  const gs = games.get('tank').create({ seed, random: mulberry(seed), players: [ME, BOT], send: () => {} });
  const s0 = gs.snapshot(0);
  return baselineSkeleton({
    pos0: () => { const m = gs.snapshot(0).k.find((x) => x[0] === 'me'); return { x: m[1], y: m[2] }; },
    idleInput: () => ({ thr: 0, turn: 0 }),
    activeInput: () => ({ thr: 1, turn: 0 }),
    onServerInput: (inp) => gs.onInput(ME, inp),
    step: () => { gs.onInput(BOT, { thr: 0, turn: 0 }); gs.step(1 / 60, 0); },
    snap: () => { const st = gs.snapshot(0); const m = st.k.find((x) => x[0] === 'me'); return { st: [0, m[1], m[2], m[3]], x: m[1], y: m[2] }; },
  }, rtt, jit, loss, seed, 90, 60);
}

function bounceBaseline(rtt, jit, loss, seed) {
  const gs = games.get('bounce').create({ seed, random: mulberry(seed), players: [ME, BOT], send: () => {} });
  const s0 = gs.snapshot(0);
  return baselineSkeleton({
    pos0: () => { const m = gs.snapshot(0).b.find((x) => x[0] === 'me'); return { x: m[1], y: m[2] }; },
    idleInput: () => ({ x: 0, y: 0 }),
    activeInput: () => {
      const m = gs.snapshot(0).b.find((x) => x[0] === 'me');
      const dx = 500 - m[1], dy = 320 - m[2], mm = Math.hypot(dx, dy) || 1;
      return { x: dx / mm, y: dy / mm };
    },
    onServerInput: (inp) => gs.onInput(ME, inp),
    step: () => { gs.onInput(BOT, { x: 0, y: 0 }); gs.step(1 / 60, 0); },
    snap: () => { const st = gs.snapshot(0); const m = st.b.find((x) => x[0] === 'me'); return { st: [0, m[1], m[2]], x: m[1], y: m[2] }; },
  }, rtt, jit, loss, seed, 90, 60);
}

function pitchBaseline(rtt, jit, loss, seed) {
  const gs = games.get('pitch').create({ seed, random: mulberry(seed), players: [ME, BOT], send: () => {} });
  for (let i = 0; i < 150; i++) gs.step(1 / 60, i);
  return baselineSkeleton({
    pos0: () => { const m = gs.snapshot(0).pl.find((x) => x[0] === 'me'); return { x: m[1], y: m[2] }; },
    idleInput: () => ({ x: 0, y: 0 }),
    activeInput: () => {
      const ba = gs.snapshot(0).ba, m = gs.snapshot(0).pl.find((x) => x[0] === 'me');
      const dx = ba[0] - m[1], dy = ba[1] - m[2], mm = Math.hypot(dx, dy) || 1;
      return { x: dx / mm, y: dy / mm };
    },
    onServerInput: (inp) => gs.onInput(ME, inp),
    step: () => { gs.onInput(BOT, { x: 0, y: 0 }); gs.step(1 / 60, 0); },
    snap: () => { const st = gs.snapshot(0); const m = st.pl.find((x) => x[0] === 'me'); return { st: [0, m[1], m[2], m[3]], x: m[1], y: m[2] }; }
  }, rtt, jit, loss, seed, 60, 60);
}

/* ============================================================
 * 跑
 * ============================================================ */
const CASES = [
  ['直连 0ms', 0, 0, 0],
  ['同城 40ms', 40, 8, 0],
  ['跨省 80ms', 80, 15, 0],
  ['跨境 150ms', 150, 30, 0],
  ['跨境 250ms', 250, 45, 0],
  ['抖动+丢包', 180, 60, 0.08]
];
const NAMES = { tank: '坦克（静止 → 前进）', bounce: '碰碰（静止 → 冲向中心）', pitch: '球场（静止 → 扑球）' };
const RUN = { tank: tankCase, bounce: bounceCase, pitch: pitchCase };
const BASE = { tank: tankBaseline, bounce: bounceBaseline, pitch: pitchBaseline };

const out = {};
const fails = [];

for (const kind of ['tank', 'bounce', 'pitch']) {
  console.log('\n=== ' + NAMES[kind] + ' ===');
  console.log('链路            不预测: 起效/重心      开预测: 起效/重心      改善    平滑误差 均/最大  贴合');
  out[kind] = [];
  CASES.forEach(([name, rtt, jit, loss], i) => {
    const seed = 4000 + i * 29;
    const a = BASE[kind](rtt, jit, loss, seed);
    const b = RUN[kind](rtt, jit, loss, seed);
    out[kind].push({ name, rtt, jit, loss, noPred: a, pred: b });
    const f = (v) => (isFinite(v) ? v.toFixed(1) : '—');
    console.log(
      name.padEnd(15) +
      ((f(a.firstMs) + ' / ' + f(a.centMs)) + ' ms').padEnd(22) +
      ((f(b.firstMs) + ' / ' + f(b.centMs)) + ' ms').padEnd(22) +
      (isFinite(a.centMs) && isFinite(b.centMs) ? (a.centMs - b.centMs).toFixed(0) + ' ms' : '—').padEnd(8) +
      (b.visAvg.toFixed(1) + ' / ' + b.visWorst.toFixed(0) + ' px').padEnd(18) + b.hard
    );
    /* 判据：开预测后「起效」帧必须是最快的那种（不超过 2 帧 = 33ms） */
    if (!(b.firstMs <= 2 * MS_PER_FRAME + 0.01)) {
      fails.push(kind + ' @' + name + ' 起效 ' + f(b.firstMs) + 'ms（应 ≤33ms）');
    }
    /* 判据三：视觉误差（画面上「还差多少要抹」）不能太大，否则看得出拉扯 */
    if (!(b.visAvg <= 26)) {
      fails.push(kind + ' @' + name + ' 平均视觉误差 ' + b.visAvg.toFixed(1) + 'px（应 ≤26px）');
    }
    /* 判据四（主判据）：起效时刻的改善必须跟着 RTT 走。
       「没预测」时起效 ≈ 上行 + 服务端一帧 + 下行 + 半个快照间隔 ≈ RTT + 33ms；
       「开预测」时起效恒为一帧（16.7ms），所以改善量 ≈ RTT。
       这里要求改善量至少吃到 RTT 的 80%（留出抖动/丢包/对齐误差的余量）。 */
    if (rtt >= 80) {
      const gain = a.firstMs - b.firstMs;
      if (!(gain >= rtt * 0.8)) {
        fails.push(kind + ' @' + name + ' 起效改善只有 ' + gain.toFixed(0) + 'ms（RTT ' + rtt + 'ms）');
      }
    }
  });
}

console.log('\n=== 结论 ===');
const pick = (k, rtt) => out[k].find((x) => x.rtt === rtt);
let allGood = fails.length === 0;
for (const kind of ['tank', 'bounce', 'pitch']) {
  const x = pick(kind, 150);
  console.log('· ' + NAMES[kind].split('（')[0] + ' 跨境 150ms：起效 ' +
    x.noPred.firstMs.toFixed(0) + 'ms → ' + x.pred.firstMs.toFixed(0) + 'ms（快 ' +
    (x.noPred.firstMs - x.pred.firstMs).toFixed(0) + 'ms，RTT ' + x.rtt + 'ms）；' +
    '重心 ' + x.noPred.centMs.toFixed(0) + 'ms → ' + x.pred.centMs.toFixed(0) + 'ms');
}
console.log(allGood ? '✓ 通过' : '✗ 未达标：\n  · ' + fails.join('\n  · '));
if (process.argv.includes('--json')) console.log('\n' + JSON.stringify(out, null, 2));
process.exitCode = allGood ? 0 : 1;
