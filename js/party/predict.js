/* ============================================================
 * js/party/predict.js —— 客户端预测（Client-side Prediction & Reconciliation）
 * ------------------------------------------------------------
 * 解决什么问题：
 *   服务端权威 + 快照同步时，玩家按键要「上行 → 服务端算 → 下行快照 → 画面」，
 *   一个来回就是手上感到的延迟。同城 30ms 能忍，跨省/跨网 150~300ms 时，
 *   碰碰车 / 坦克这类连续移动会明显「拖一下才动」，松手还会继续滑。
 *
 * 做法（业界标准三件套）：
 *   1. 本地预测：每帧把「自己」用同一份物理往前推一小步，画面立刻跟手；
 *   2. 快照校正：服务端快照到达后，把自己摆回权威状态，再把服务端还没处理到的
 *      输入逐帧重放一遍——这样「校正」不会把玩家的操作吃掉；
 *   3. 平滑：重放后的位置与画面上看到的位置之间有一段差值（视觉误差），
 *      每帧按比例收敛掉，既不会瞬移也不会一直错位。
 *
 * 三条硬约定（改玩法时必须守住）：
 *   · 玩法要和客户端共用同一份「一帧物理」函数，两边算出来得一模一样；
 *   · 快照要带 ack（服务端已处理到的最大输入序号）；
 *   · 输入是「当前状态」，服务端按到达顺序覆盖，客户端重放时逐帧覆盖，能完全还原。
 *
 * 本文件是纯逻辑：不碰 DOM、不依赖 PartyKit。
 * 浏览器挂 window.WH_PREDICT，Node 里可 require 出来跑离线仿真（tools/predict-sim.mjs）。
 * ============================================================ */
(function (root, factory) {
  var API = factory();
  if (typeof module === 'object' && module.exports) module.exports = API;
  root.WH_PREDICT = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DT = 1 / 60;             /* 逻辑帧长（秒），与服务端 60Hz 对齐 */
  var GOLD = 1000 / 60;        /* 同上，毫秒 */

  var HARD = 260;              /* 视觉误差超过它就不慢慢抹了，直接贴合（撞墙 / 被撞飞） */
  var TELE = 26;               /* 偏差超过这个就当「定位不对」：和普通校正分开统计 */
  var CONV = 18;               /* 每秒收敛速度（越大贴合越快，也越容易被看出拉扯） */
  var CONV_MAX = 0.4;          /* 单帧最多补正比例 */
  var RING_LEN = 120;          /* 只留最近 2 秒的输入，足够覆盖常见 RTT */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* 朝向、血量这类「绝对值」字段不进历史：
     历史只需要能重放出位置，把绝对值也存一份再重放，
     就会把「转了多少」累加两遍（坦克转得比服务端快一倍就是这个原因）。 */
  var VOLATILE = { a: 1, hp: 1 };

  function cloneInput(inp) {
    if (!inp || typeof inp !== 'object') return inp;
    var o = {}, any = false, k;
    for (k in inp) {
      if (!Object.prototype.hasOwnProperty.call(inp, k)) continue;
      if (VOLATILE[k]) continue;
      o[k] = inp[k]; any = true;
    }
    return any ? o : inp;      /* 全是瞬时字段就保留原样（它们对位置没影响） */
  }

  /* 输入历史（环形） */
  function History() { this.items = []; }
  History.prototype.empty = function () { return this.items.length === 0; };
  History.prototype.len = function () { return this.items.length; };

  History.prototype.push = function (item) {
    this.items.push(item);
    if (this.items.length > RING_LEN) this.items.splice(0, this.items.length - RING_LEN);
  };

  /* 记录「这一帧的输入」：抓现行/前后对比测试要能直接喂历史，不走网络 */
  History.prototype.record = function (seq, input) {
    this.push({ seq: seq, input: input });
  };

  /* 丢掉服务端已处理过的输入 */
  History.prototype.dropBefore = function (seq) {
    var arr = this.items, k = 0;
    while (k < arr.length && arr[k].seq <= seq) k++;
    if (k) this.items = arr.slice(k);
    return k;
  };

  History.prototype.clear = function () { this.items.length = 0; };

  History.prototype.last = function () {
    return this.items.length ? this.items[this.items.length - 1].input : null;
  };

  /* ============================================================
   * 预测主体
   * ------------------------------------------------------------
   * opts = {
   *   key           自己实体的 id
   *   x, y, vx, vy  起点（服务端初始位置）
   *   idle()        没有按键时补的输入（例如 {x:0,y:0}），保证本地与远端用同一份输入
   *   step(b, in)   推进一帧，必须与服务端 stepBody 一致
   *   snap(st)      服务端状态 → {x,y,vx,vy}
   *   apply(b, s)   把 {x,y,vx,vy} 写回 b
   * }
   * ============================================================ */
  function Pred(opts) {
    this.key = opts.key;
    this.step = opts.step;
    this.snap = opts.snap;
    this.apply = opts.apply;
    this.idle = opts.idle || function () { return null; };
    /* 视觉误差的收敛速度与「直接贴合」阈值可以按玩法调：
       碰碰车会被别人撞飞，权威位移天生比预测大，硬贴合会一跳一跳的，
       所以它放宽阈值、放缓收敛；坦克/球场保持默认。 */
    this.conv = opts.conv || CONV;
    this.hard = opts.hard || HARD;
    this.body = { x: opts.x || 0, y: opts.y || 0, vx: opts.vx || 0, vy: opts.vy || 0 };
    /* 附加字段：玩法自己的 step 会读（坦克要朝向、碰碰要血量），
       缺了就会算出 NaN —— 所以起点状态必须和快照里的一致 */
    if (opts.a != null) this.body.a = opts.a;
    if (opts.hp != null) this.body.hp = opts.hp;
    if (opts.extra) {
      for (var k in opts.extra) {
        if (Object.prototype.hasOwnProperty.call(opts.extra, k)) this.body[k] = opts.extra[k];
      }
    }
    this.hist = new History();
    this.ready = false;
    this.seq = 0;
    this.acc = 0;
    this.ex = 0;                 /* 视觉误差（画面上还差多少） */
    this.ey = 0;
    this.worst = 0;              /* 历史最大视觉误差（诊断 / 自测用） */
    this.tele = 0;               /* 最近一次「定位修正」的偏移（预测位置与服务端不符） */
    this.steps = 0;
    this.replays = 0;
    this.hardHits = 0;
  }

  /* 强制以服务端为准（自己的位置被外力改过：被撞飞、被炸飞、复活…） */
  Pred.prototype.resync = function (st) {
    if (!st) return;
    var before = { x: this.body.x + this.ex, y: this.body.y + this.ey };
    this.apply(this.body, this.snap(st));
    this.hist.clear();
    this.acc = 0;
    this.ready = true;
    this.ex = before.x - this.body.x;
    this.ey = before.y - this.body.y;
    if (Math.hypot(this.ex, this.ey) > this.hard) { this.ex = 0; this.ey = 0; this.hardHits += 1; }
  };

  /* 服务端快照到达：摆回权威状态 + 重放未确认输入 */
  Pred.prototype.onSnap = function (ack, st) {
    if (!st) return false;
    if (!this.ready) {
      this.apply(this.body, this.snap(st));
      if (st.a != null) this.body.a = st.a;
      if (st.hp != null) this.body.hp = st.hp;
      this.hist.dropBefore(ack || 0);
      this.ex = 0; this.ey = 0;
      this.ready = true;
      return true;
    }
    /* 预测位置与服务端权威位置的偏差（未重放的「预测底」） */
    var snapState = this.snap(st);
    var dev = Math.hypot(snapState.x - this.body.x, snapState.y - this.body.y);
    if (dev > TELE) this.tele = dev;
    /* 画面上现在的位置 → 记成视觉误差的一部分 */
    var seenX = this.body.x + this.ex, seenY = this.body.y + this.ey;
    /* 朝向不重放：直接拿权威值。角度是「绝对量」，重放会把它累加两遍，
       而朝向的跟手感靠本地 tick 推进已经够了。 */
    if (st.a != null) this.body.a = st.a;
    this.hist.dropBefore(ack || 0);
    var s = snapState;
    if (st.a != null) this.body.a = st.a;             /* 朝向不重放，直接跟权威 */
    if (st.hp != null) this.body.hp = st.hp;
    this.apply(this.body, s);
    var n = this.hist.len(), i;
    for (i = 0; i < n; i++) this.step(this.body, this.hist.items[i].input);
    this.replays += n;
    this.ex = seenX - this.body.x;
    this.ey = seenY - this.body.y;
    var err = Math.hypot(this.ex, this.ey);
    if (err > this.worst) this.worst = err;
    if (err > this.hard) {         /* 真分歧（撞墙/被撞飞/长时间断线），直接贴合 */
      this.ex = 0; this.ey = 0;
      this.hardHits += 1;
    }
    return true;
  };

  /* 发送输入：先记进历史（重放靠它），tick 时也会用它推进本地预测 */
  Pred.prototype.send = function (input) {
    this.seq += 1;
    this.hist.push({ seq: this.seq, input: cloneInput(input), raw: input });
    return this.seq;
  };

  /* 每帧推进：累计时间按 1/60 切整步，避免 144Hz 屏「跑得更快」 */
  Pred.prototype.tick = function (dt) {
    this.acc += dt;
    var n = 0;
    while (this.acc >= DT && n < 6) {
      this.acc -= DT;
      n += 1;
      var item = this.hist.items[this.hist.items.length - 1];
      this.step(this.body, (item && item.raw) || this.idle());   /* 本地推进用原始输入（含瞬时字段） */
      this.steps += 1;
    }
    if (n >= 6) this.acc = 0;      /* 切回前台会有巨大 dt，别一次补几百帧 */
    return n;
  };

  /* 视觉误差按比例衰减 */
  Pred.prototype.correct = function (dt) {
    var k = clamp(dt * this.conv, 0, CONV_MAX);
    this.ex -= this.ex * k;
    this.ey -= this.ey * k;
    if (Math.abs(this.ex) < 0.05) this.ex = 0;
    if (Math.abs(this.ey) < 0.05) this.ey = 0;
  };

  /* 画面上应该显示的位置 */
  Pred.prototype.drawX = function () { return this.body.x + this.ex; };
  Pred.prototype.drawY = function () { return this.body.y + this.ey; };

  /* ---------- 网络状况（HUD + 自适应） ---------- */
  function NetStats() {
    this.ping = 0;
    this.jit = 0;
    this.loss = 0;
    this._last = 0;
    this._lastGap = 0;
  }

  NetStats.prototype.onPong = function (ms) {
    if (!(ms >= 0)) return;
    var prev = this.ping;
    this.ping = ms;
    if (prev > 0) this.jit = this.jit * 0.8 + Math.abs(ms - prev) * 0.2;
  };

  NetStats.prototype.onSnap = function (now) {
    if (this._last) {
      var gap = now - this._last;
      var late = gap > GOLD * 2.6;                 /* 该到没到：算一次丢包 */
      var jump = this._lastGap && Math.abs(gap - this._lastGap) > GOLD * 1.5;
      this.loss = this.loss * 0.94 + ((late || jump) ? 0.06 : 0);
      this._lastGap = gap;
    }
    this._last = now;
  };

  NetStats.prototype.bad = function () {
    return this.ping > 240 || this.loss > 0.15 || this.jit > 80;
  };

  return {
    GOLD: GOLD,
    DT: DT,
    History: History,
    Pred: Pred,
    NetStats: NetStats,
    HARD: HARD,
    CONV: CONV
  };
});
