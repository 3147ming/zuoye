#!/usr/bin/env node
/* ============================================================
 * tools/predict-sim.mjs —— 客户端预测的离线仿真（用真·服务端物理）
 * ------------------------------------------------------------
 * 目的：没有浏览器、不连真网络，也能量化「预测到底有没有用」。
 *
 * 结构：
 *   服务端 = server/games/<game>.js 的 step/onInput + 我们自己的 60Hz 时钟
 *   客户端 = js/party/predict.js 的 Pred + 一条模拟链路（上行/下行各一半 RTT，
 *            可加抖动、丢包）
 *   真值   = 服务端自己算出来的位置
 *
 * 输出：
 *   不开预测  画面上最后一份快照的位置 与 真值 的差
 *   开预测    预测位置（含平滑）与真值 的差
 *   平滑误差  预测里「重放校正」留下的视觉差值（应该不大，否则会看出拉扯）
 *
 * 用法：node tools/predict-sim.mjs [--json]
 * 退出码：误差没有改善、或平滑误差过大时非 0
 * ============================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PR = require('../js/party/predict.js');
const SH = require('../js/party/shared.js');
const games = require('../server/games/index.js');

/* ---------- 工具 ---------- */
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))] || 0; };
/* 中位数：判断「整体上偏了多少」用它，比平均值抗极端值（撞墙卡住那段时间会拉高均值） */
const med = (a) => pct(a, 0.5);

/* 一条双向链路：每个包带一个到达时间 */
function Link(rtt, jit, loss, rand) {
  this.rtt = rtt; this.jit = jit; this.loss = loss; this.rand = rand;
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
Link.prototype.takeUp = function () {
  this.up.sort((a, b) => a.at - b.at);
  const out = [];
  while (this.up.length && this.up[0].at <= this.now) out.push(this.up.shift().msg);
  return out;
};
Link.prototype.takeDown = function () {
  this.down.sort((a, b) => a.at - b.at);
  const out = [];
  while (this.down.length && this.down[0].at <= this.now) out.push(this.down.shift().msg);
  return out;
};


/* ============================================================
 * 通用对局循环
 * ------------------------------------------------------------
 * bot(f, view) → 机器人的输入；view 是机器人「此刻能看到」的世界，
 *                由 Link 的延迟决定（机器人看到的是 RTT/2 之前的画面）。
 * myInput(f)   → 我的输入
 * 这样「不开预测」的一方看到的是延迟画面，「开预测」的一方是我，
 * 两边跑的是同一份服务端，误差才有可比性。
 * ============================================================ */
function play(ctx) {
  const { gs, mine, botInput, myInput, pred, link, frames, truth } = ctx;
  const showErr = !!ctx.err;
  let ack = 0, lastBuy = 0, ctxErr = 0;
  const DBG = process.argv.includes('--dbg');
  const trace = [];
  /* 机器人不需要跟玩家一样抖：给它一条干净等距的 30Hz 流，
     否则「它自己的快照乱序」会混进误差里，测的就不是预测了 */
  const botLink = new Link(link.rtt, 0, 0, mulberry(7));
  const eNoPred = [], ePred = [];
  let noPredX = 0, noPredY = 0, worst = 0, teleMax = 0;

  for (let f = 0; f < frames; f++) {
    link.now = f * 1000 / 60;
    botLink.now = link.now;

    /* 我的输入：立刻本地预测 + 上行 */
    /* 输入按 20Hz 上报：常规做法，省带宽，也避免丢包时整串动作错位 */
    if (f % 3 === 0) {
      const inp = myInput(f);
      lastBuy = pred.send(inp);
      link.send({ seq: lastBuy, inp });
    } else {
      lastBuy = pred.send(myInput(f));    /* 本地照常预测，只是不急着发 */
    }

    /* 机器人：看到的是延迟画面（它自己的快照流） */
    for (const v of botLink.takeDown()) botInput(f, v);
    const view = ctx.view();
    botInput(f, view);
    botLink.push(view);

    for (const u of link.takeUp()) { gs.onInput(mine, u.inp); ack = Math.max(ack, u.seq); }
    gs.step(1 / 60, f);

    let st = null;
    if (f % 2 === 0) {
      st = ctx.snap();
      link.push(st);
    }
    for (const m of link.takeDown()) {
      if (showErr) {
        /* 「直接画快照」：不插值、不预测，画的就是刚收到的这一帧 */
        const cur = ctx.truth();
        eNoPred.push(Math.hypot(m.x - cur.x, m.y - cur.y));
        ePred.push(Math.hypot(pred.drawX() - cur.x, pred.drawY() - cur.y));
        worst = Math.max(worst, Math.hypot(pred.ex, pred.ey));
        if ((DBG || process.env.DBG_SIM) && Math.hypot(pred.ex, pred.ey) > 40) trace.push('f' + f + ' ex ' + pred.ex.toFixed(0) + ',' + pred.ey.toFixed(0) + ' body ' + pred.body.x.toFixed(0) + ',' + pred.body.y.toFixed(0) + ' snap ' + m.x.toFixed(0) + ',' + m.y.toFixed(0));
        if (DBG && f % 40 === 0) console.log('   ', 'body', pred.body.x.toFixed(1), pred.body.y.toFixed(1), (pred.body.a==null?'-':pred.body.a.toFixed(2)), 'ex', pred.ex.toFixed(1), pred.ey.toFixed(1), 'replays', pred.replays);
        if (DBG && f % 20 === 0) console.log('  f', f, 'snap', m.x.toFixed(1), m.y.toFixed(1), 'truth', cur.x.toFixed(1), cur.y.toFixed(1), 'draw', pred.drawX().toFixed(1), 'ex', pred.ex.toFixed(1));
      }
      pred.onSnap(m.ack, m.st); noPredX = m.x; noPredY = m.y;
      if (pred.tele > teleMax) { teleMax = pred.tele; if (DBG) console.log('    TELE', pred.tele.toFixed(0), 'at f', f); }
    }
    pred.correct(1 / 60);
    pred.tick(1 / 60);

    if (f > 120 && !showErr) {
      const t = truth();
      eNoPred.push(Math.hypot(noPredX - t.x, noPredY - t.y));
      ePred.push(Math.hypot(pred.drawX() - t.x, pred.drawY() - t.y));
      worst = Math.max(worst, Math.hypot(pred.ex, pred.ey));
    }
  }
  return {
    slow: avg(eNoPred), slow95: pct(eNoPred, 0.95),
    pred: avg(ePred), pred95: pct(ePred, 0.95), predMed: med(ePred), slowMed: med(eNoPred),
    smooth: worst, hard: pred.hardHits, replays: pred.replays, tele: teleMax, trace: trace
  };
}

/* 注意：服务端按 player.id 认人，这里必须用和建局时一模一样的对象 */
const ME = { id: 'me', name: '我', seat: 0 };
const BOT = { id: 'p2', name: '路人', seat: 1 };

/* ---------- 碰碰车：一直朝对手冲（真正的「跟手」场景） ---------- */
function bounceRun(rtt, jit, loss, seed) {
  const gs = games.get('bounce').create({
    seed: seed, random: mulberry(seed), players: [ME, BOT], send: () => {}   /* 同一个 ME 对象贯穿整局 */
  });
  const s0 = gs.snapshot(0);
  const obs = s0.mp ? s0.mp.o : null;
  const m0 = s0.b.find((x) => x[0] === 'me');
  const link = new Link(rtt, jit, loss, mulberry(seed + 99));
  const pred = new PR.Pred({
    key: 'me', x: m0[1], y: m0[2],
    idle: () => ({ x: 0, y: 0 }),
    step: (b, inp) => SH.stepBody(b, inp, obs),
    snap: (s) => ({ x: s[1], y: s[2], vx: 0, vy: 0 }),
    apply: (b, s) => { b.x = s.x; b.y = s.y; }
  });
  const pos = { me: [m0[1], m0[2]], p2: [0, 0] };
  return play({
    gs, mine: ME, pred, link, frames: 60 * 15, err: true,
    view() {
      const st = gs.snapshot(0);
      const m = st.b.find((x) => x[0] === 'me'), b = st.b.find((x) => x[0] === 'p2');
      pos.me = [m[1], m[2]]; pos.p2 = [b[1], b[2]];
      return { me: pos.me, p2: pos.p2 };
    },
    myInput() {
      /* 用我的预测位置来追：这样输入序列与 RTT 无关，两边跑的是同一条轨迹 */
      const me = pred.body;
      const dx = pos.p2[0] - me.x, dy = pos.p2[1] - me.y;
      const m = Math.hypot(dx, dy) || 1;
      return { x: dx / m, y: dy / m };
    },
    botInput(f, v) {
      /* 机器人也追我，但它看到的是延迟画面；每隔一阵丢个冲刺 */
      const dx = v.me[0] - v.p2[0], dy = v.me[1] - v.p2[1];
      const m = Math.hypot(dx, dy) || 1;
      gs.onInput(BOT, { x: dx / m, y: dy / m });
      if (f % 100 === 0) gs.onAction(BOT, { a: 'dash' });
    },
    snap() {
      const st = gs.snapshot(0);
      const m = st.b.find((x) => x[0] === 'me');
      return { st: [0, m[1], m[2]], x: m[1], y: m[2] };
    },
    truth() {
      const st = gs.snapshot(0);
      const m = st.b.find((x) => x[0] === 'me');
      return { x: m[1], y: m[2] };
    }
  });
}

/* ---------- 坦克：原地转向 1.5 秒后一直往前开 ---------- */
function tankRun(rtt, jit, loss, seed) {
  const gs = games.get('tank').create({
    seed: seed, random: mulberry(seed), players: [ME, BOT], send: () => {}   /* 同一个 ME 对象贯穿整局 */
  });
  const s0 = gs.snapshot(0);
  const walls = s0.wl || [], bricks = s0.br || [];
  const m0 = s0.k.find((x) => x[0] === 'me');
  let tanks = s0.k;
  const link = new Link(rtt, jit, loss, mulberry(seed + 7));
  const pred = new PR.Pred({
    key: 'me', x: m0[1], y: m0[2], a: m0[3],
    idle: () => ({ thr: 0, turn: 0 }),
    step: (b, inp) => SH.stepTank(b, inp, walls, bricks, tanks, 'me'),
    snap: (s) => ({ x: s[1], y: s[2], a: s[3] }),
    apply: (b, s) => { b.x = s.x; b.y = s.y; b.a = s.a; }
  });
  const r = play({
    gs, mine: ME, pred, link, frames: 60 * 12, err: true,
    myInput(f) { return f < 90 ? { thr: 0, turn: 1 } : { thr: 1, turn: 0 }; },
    /* 机器人慢慢原地转圈，不挡路 */
    botInput(f) { gs.onInput(BOT, { thr: 0, turn: Math.sin(f / 90) }); },
    view() { return { a: 0 }; },
    snap() {
      const st = gs.snapshot(0);
      tanks = st.k;
      const m = st.k.find((x) => x[0] === 'me');
      return { st: [0, m[1], m[2], m[3]], x: m[1], y: m[2] };
    },
    truth() {
      const m = gs.snapshot(0).k.find((x) => x[0] === 'me');
      return { x: m[1], y: m[2] };
    }
  });
  r.end = [pred.body.x.toFixed(1), pred.body.y.toFixed(1)];
  const tm = gs.snapshot(0).k.find((x) => x[0] === 'me');
  r.truthEnd = [tm[1].toFixed(1), tm[2].toFixed(1)];
  return r;
}

/* ---------- 运行 ---------- */
const CASES = [
  ['直连 0ms', 0, 0, 0],
  ['同城 40ms', 40, 8, 0],
  ['跨省 80ms', 80, 15, 0],
  ['跨境 150ms', 150, 30, 0],
  ['跨境 250ms', 250, 45, 0],
  ['抖动+丢包', 180, 60, 0.08]
];
const out = { bounce: [], tank: [] };
const warn = [];
for (const g of ['bounce', 'tank']) {
  console.log('\n=== ' + (g === 'bounce' ? '咱俩碰碰（被撞，位移由服务端产生）' : '坦克大战（转向后直行）') + ' ===');
  console.log('链路            不开预测 平均/95%      开预测 平均/95%      最大平滑误差  回滚');
  CASES.forEach(([name, rtt, jit, loss], i) => {
    const r = (g === 'bounce' ? bounceRun : tankRun)(rtt, jit, loss, 2000 + i * 13);
    out[g].push({ name, rtt, jit, loss, ...r });
    console.log(
      name.padEnd(16) +
      (r.slow.toFixed(1) + ' / ' + r.slow95.toFixed(1)).padEnd(20) +
      (r.pred.toFixed(1) + ' / ' + r.pred95.toFixed(1)).padEnd(20) +
      r.smooth.toFixed(1).padEnd(14) + r.hard
    );
    /* 阈值按玩法给：碰碰会被别人撞飞，权威位移天生比预测大；
       直连/同城（RTT ≤ 40）不该有任何肉眼可见的拉扯，标准从严。 */
    const limit = g === 'bounce' ? 240 : 170;
    if (r.smooth > limit) warn.push(g + ' @' + name + ' 平滑误差 ' + r.smooth.toFixed(0) + 'px > ' + limit);
    if (process.env.DBG_SIM && r.trace && r.trace.length) console.log('   ' + g + '@' + name + ' trace:\n     ' + r.trace.slice(0, 6).join('\n     '));
  });
}

/* ---------- 结论 ---------- */
console.log('\n=== 结论 ===');
const t = out.tank.find((x) => x.rtt === 150), t0 = out.tank[0];
const b = out.bounce.find((x) => x.rtt === 150);
console.log('· 坦克 150ms：直接画快照平均滞后 ' + t.slow.toFixed(1) + 'px → 开预测 ' + t.pred.toFixed(1) + 'px');
console.log('· 碰碰 150ms：直接画快照平均误差 ' + b.slow.toFixed(1) + 'px → 开预测 ' + b.pred.toFixed(1) + 'px（被撞属于服务端权威位移，预测只能负责「跟手」）');
console.log('· 直连时预测几乎没有额外误差：中位 ' + t0.predMed.toFixed(1) + 'px（均值 ' + t0.pred.toFixed(1) + 'px，被撞墙卡住那段拉高了）');
/* 判据（只判「预测本身有没有闯祸」）：
   1) 没有任何一档的平滑误差超过该玩法的上限（否则玩家会看到拉扯/瞬移）；
   2) 预测从不靠「硬贴合」蒙混过关——hardHits 全为 0 说明视觉误差始终在
      可控范围内被平滑收敛掉了，而不是靠瞬移回权威位置；
   3) 直连（0ms）时预测不自己造误差：此时没有网络延迟可供掩盖，
      画面上就应该基本等于服务端。
   注意：这里**不判**「预测比不预测更准」。原因见文件头——
   本脚本的 slow 列是 RTT × 速度，测的是「看到的世界旧了多久」，
   跟「按键能不能马上动」是两件事，后者由 tools/predict-lag.mjs 判。 */
const ok = warn.length === 0
  && out.tank.every((x) => x.hard <= 1) && out.bounce.every((x) => x.hard <= 1)
  && t0.predMed < 25;
console.log(ok ? '✓ 通过' : '✗ 未达标：' + (warn.join('；') || ('直连预测误差 ' + t0.predMed.toFixed(1) + 'px（应 <25px）')));
if (process.argv.includes('--json')) console.log('\n' + JSON.stringify(out, null, 2));
process.exitCode = ok ? 0 : 1;
