/* ============================================================
 * server/games/draw.js —— 你画我猜（服务端权威）
 * ------------------------------------------------------------
 * 玩法：轮流当画者，每轮 70 秒。画者拿到一个词（只有他自己看得到），
 *       在画板上画；其他人抢答，猜中按剩余时间给分，画者按猜中人数得分。
 *
 * 为什么笔画不发全量：
 *   一幅画几千个点，若每帧广播全量，30Hz 下就是几百 KB/s。
 *   这里做成「增量流」：客户端把点打成小包上行，服务端只广播新增点，
 *   每帧最多 80 个，客户端边收边画；晚进/重连的人主动要一次全量重绘。
 * 安全性：词只私发给画者（event），猜词判定全在服务端，抓包也看不到答案之外的东西。
 * ============================================================ */
'use strict';

var W = 1000, H = 640;
var TURN = 70;                 /* 每轮秒数 */
var INTRO = 3;                 /* 开局停留 */
var REVEAL = 6;                /* 揭晓停留 */
var MAX_PTS = 18000;           /* 单轮最多接受的点数（防刷） */

var WORDS = [
  /* 动物 */
  ['熊猫', '动物'], ['猫', '动物'], ['狗', '动物'], ['长颈鹿', '动物'], ['大象', '动物'],
  ['蝴蝶', '动物'], ['乌龟', '动物'], ['鲨鱼', '动物'], ['企鹅', '动物'], ['蜗牛', '动物'],
  ['螃蟹', '动物'], ['孔雀', '动物'], ['松鼠', '动物'], ['青蛙', '动物'], ['骆驼', '动物'],
  ['刺猬', '动物'], ['章鱼', '动物'], ['蝙蝠', '动物'], ['老虎', '动物'], ['兔子', '动物'],
  /* 食物 */
  ['西瓜', '食物'], ['汉堡', '食物'], ['冰淇淋', '食物'], ['面条', '食物'], ['火锅', '食物'],
  ['寿司', '食物'], ['蛋糕', '食物'], ['饺子', '食物'], ['菠萝', '食物'], ['薯条', '食物'],
  ['棒棒糖', '食物'], ['咖啡', '食物'], ['烤串', '食物'], ['月饼', '食物'], ['粽子', '食物'],
  ['披萨', '食物'], ['鸡蛋', '食物'], ['玉米', '食物'], ['辣椒', '食物'], ['糖葫芦', '食物'],
  /* 物品 */
  ['雨伞', '物品'], ['眼镜', '物品'], ['吉他', '物品'], ['自行车', '物品'], ['书包', '物品'],
  ['灯泡', '物品'], ['钥匙', '物品'], ['剪刀', '物品'], ['闹钟', '物品'], ['相机', '物品'],
  ['风筝', '物品'], ['沙发', '物品'], ['冰箱', '物品'], ['熨斗', '物品'], ['指南针', '物品'],
  ['望远镜', '物品'], ['口罩', '物品'], ['保温杯', '物品'], ['打火机', '物品'], ['扫帚', '物品'],
  /* 自然 */
  ['彩虹', '自然'], ['火山', '自然'], ['瀑布', '自然'], ['月亮', '自然'], ['仙人掌', '自然'],
  ['向日葵', '自然'], ['雪山', '自然'], ['沙漠', '自然'], ['闪电', '自然'], ['蘑菇', '自然'],
  ['珊瑚', '自然'], ['龙卷风', '自然'],
  /* 动作 / 场景 */
  ['跳绳', '动作'], ['滑雪', '动作'], ['游泳', '动作'], ['放风筝', '动作'], ['刷牙', '动作'],
  ['拍照', '动作'], ['捉迷藏', '动作'], ['排队', '动作'], ['理发', '动作'], ['堵车', '场景'],
  ['迟到', '场景'], ['开会', '场景'], ['搬家', '场景'], ['打伞', '动作'],
  /* 人物 */
  ['医生', '人物'], ['宇航员', '人物'], ['厨师', '人物'], ['消防员', '人物'], ['老师', '人物'],
  ['快递员', '人物'], ['魔术师', '人物'], ['摄影师', '人物'], ['侦探', '人物'], ['鼓手', '人物']
];

function shuffle(arr, rand) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function norm(s) {
  return String(s || '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[，。！？、,.!?~～`'"“”‘’()（）]/g, '')
    .toLowerCase();
}

exports.meta = { name: '你画我猜', min: 2, max: 4, colors: ['#ffd166', '#7ec8ff', '#8ff0b5', '#ff9f9f'], words: WORDS.length, w: W, h: H };

exports.create = function (ctx) {
  var rand = ctx.random;
  var pool = shuffle(WORDS, rand);
  var order = ctx.players.map(function (p) { return p.id; });
  var names = {};
  ctx.players.forEach(function (p) { names[p.id] = p.name; });

  var turn = 0;                 /* order 下标 */
  var phase = 'intro';          /* intro | drawing | reveal | done */
  var left = INTRO;
  var word = '';
  var cat = '';
  var mask = '';
  var hidden = [];              /* 还没公开的字的下标 */
  var strokes = [];             /* {c, w, pts:[[x,y],...]} */
  var ops = [];                 /* 待下发增量：[1,c,w,x,y] 起笔 / [0,x,y] 续笔 / [2] 清屏 */
  var opTotal = 0;              /* 累计产出过多少条增量，用于客户端判断是否漏包 */
  var ptTotal = 0;
  var solved = [];
  var guesses = [];             /* {name, text} 最近几条猜错 */
  var scores = {};
  var streak = {};
  var events = [];
  var over = null;
  var gone = {};
  var turnCount = order.length;
  var h1 = false, h2 = false;

  ctx.players.forEach(function (p) { scores[p.id] = 0; streak[p.id] = 0; });

  function scoreList() {
    return ctx.players.map(function (p) {
      return { id: p.id, name: p.name, score: scores[p.id] || 0 };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  function push(op) {
    ops.push(op);
    opTotal += 1;
    if (ops.length > 400) ops.splice(0, ops.length - 400);   /* 极端情况下防内存膨胀 */
  }

  function beginTurn() {
    while (turn < turnCount && gone[order[turn]]) turn += 1;
    if (turn >= turnCount) {
      phase = 'done';
      var rank = scoreList();
      rank.forEach(function (r, i) { r.rank = i + 1; });
      over = { game: 'draw', winner: rank[0] ? rank[0].id : null, scores: rank, reason: 'finished' };
      events.push({ e: 'finish' });
      return;
    }
    var pick = pool[turn % pool.length];
    word = pick[0];
    cat = pick[1];
    hidden = [];
    /* 一个字都不预露：否则单字词（猫 / 狗）等于把答案直接发出去 */
    for (var i = 0; i < word.length; i++) hidden.push(i);
    mask = word.split('').map(function () { return '＿'; }).join('');
    strokes = [];
    ops = [];
    opTotal = 0;
    /* 清屏也走增量，保证中途进来的人顺序正确 */
    push([2]);
    ptTotal = 0;
    h1 = false; h2 = false;
    solved = [];
    guesses = [];
    phase = 'intro';
    left = INTRO;
    /* 私发词给画者 */
    ctx.send('event', { e: 'word', w: word, c: cat, dr: order[turn], n: word.length }, order[turn]);
    events.push({ e: 'turn', dr: order[turn], n: word.length, ti: turn + 1, tn: turnCount });
  }

  function revealOne() {
    if (!hidden.length) return;
    var k = Math.floor(rand() * hidden.length);
    var pos = hidden.splice(k, 1)[0];
    var arr = mask.split('');
    arr[pos] = word[pos];
    mask = arr.join('');
  }

  function endTurn(reason) {
    if (phase === 'done') return;
    phase = 'reveal';
    left = REVEAL;
    events.push({ e: 'show', w: word, reason: reason || 'timeout' });
  }

  function fullPayload() {
    var all = [];
    strokes.forEach(function (s) {
      var p = s.pts;
      if (!p.length) return;
      all.push([1, s.c, s.w, p[0][0], p[0][1]]);
      for (var i = 1; i < p.length; i++) all.push([0, p[i][0], p[i][1]]);
    });
    return { t: 0, full: true, ds: all, no: opTotal };
  }

  beginTurn();

  var api = {
    onAction: function (p, d) {
      if (!d || phase === 'done') return;
      var drawer = order[turn];

      if (d.a === 'redraw') {
        ctx.send('snap', fullPayload(), p.id);
        return;
      }
      if (d.a === 'needword') {
        if (p.id === drawer) ctx.send('event', { e: 'word', w: word, c: cat, dr: drawer, n: word.length }, p.id);
        return;
      }
      if (d.a === 'draw') {
        if (p.id !== drawer || phase !== 'drawing') return;
        var pts = d.pts;
        if (!pts || !pts.length || ptTotal > MAX_PTS) return;
        var c = Math.max(0, Math.min(8, d.c | 0));
        var w = Math.max(0, Math.min(4, d.w | 0));
        var cur = strokes[strokes.length - 1];
        if (d.ns || !cur) {
          cur = { c: c, w: w, pts: [] };
          strokes.push(cur);
          var x0 = clampX(pts[0][0]), y0 = clampY(pts[0][1]);
          cur.pts.push([x0, y0]);
          ptTotal += 1;
          push([1, c, w, x0, y0]);
          pts = pts.slice(1);
        }
        for (var i = 0; i < pts.length; i++) {
          var x = clampX(pts[i][0]), y = clampY(pts[i][1]);
          var last = cur.pts[cur.pts.length - 1];
          if (last && Math.abs(last[0] - x) < 2 && Math.abs(last[1] - y) < 2) continue;
          cur.pts.push([x, y]);
          ptTotal += 1;
          push([0, x, y]);
          if (ptTotal > MAX_PTS) break;
        }
        return;
      }
      if (d.a === 'clear') {
        if (p.id !== drawer || phase !== 'drawing') return;
        strokes = [];
        ptTotal = 0;
        push([2]);
        events.push({ e: 'clear' });
        return;
      }
      if (d.a === 'skip') {
        if (p.id !== drawer || phase !== 'drawing') return;
        endTurn('skip');
        return;
      }
      if (d.a === 'guess') {
        if (p.id === drawer || phase !== 'drawing' || solved.indexOf(p.id) >= 0) return;
        var text = norm(d.text).slice(0, 20);
        if (!text) return;
        if (text === norm(word)) {
          solved.push(p.id);
          var gain = 30 + Math.round(70 * Math.max(0, left) / TURN);
          if (solved.length === 1) gain += 15;
          scores[p.id] = (scores[p.id] || 0) + gain;
          events.push({ e: 'right', id: p.id, name: p.name, gain: gain });
          /* 画者：每有一人猜中 +40，全中再 +30 */
          scores[drawer] = (scores[drawer] || 0) + 40;
          if (solved.length >= ctx.players.filter(function (x) { return x.id !== drawer && !gone[x.id]; }).length) {
            scores[drawer] = (scores[drawer] || 0) + 30;
            endTurn('all');
          }
        } else {
          guesses.push({ name: p.name, text: String(d.text).slice(0, 12) });
          if (guesses.length > 6) guesses.shift();
          events.push({ e: 'wrong', name: p.name, text: String(d.text).slice(0, 12) });
        }
      }
    },
    step: function (dt) {
      if (phase === 'done' || phase === 'reveal') {
        left -= dt;
        if (left <= 0) { turn += 1; beginTurn(); }
        return;
      }
      if (phase === 'intro') {
        left -= dt;
        if (left <= 0) { phase = 'drawing'; left = TURN; events.push({ e: 'go' }); }
        return;
      }
      /* drawing：剩一半时间露一个字，剩三成再露一个 */
      left -= dt;
      if (!h1 && left <= TURN * 0.5 && hidden.length > 1) {
        h1 = true; revealOne();
        events.push({ e: 'hint', mk: mask });
      }
      if (!h2 && left <= TURN * 0.28 && hidden.length > 1) {
        h2 = true; revealOne();
        events.push({ e: 'hint', mk: mask });
      }
      if (left <= 0) endTurn('timeout');
    },
    snapshot: function (tick) {
      var ds = ops.length ? ops.slice(0, 90) : null;
      if (ds) ops.splice(0, ds.length);
      var out = {
        t: tick,
        ph: phase,
        dr: order[turn] || '',
        ti: Math.min(turn + 1, turnCount),
        tn: turnCount,
        tl: Math.max(0, Math.round(left * 10) / 10),
        tot: TURN,
        mk: phase === 'drawing' ? mask : '',
        sc: Object.keys(scores).map(function (id) { return [id, scores[id]]; }),
        gd: solved.slice(),
        no: opTotal
      };
      if (phase === 'reveal' || phase === 'done') out.wd = word;
      if (guesses.length) out.gw = guesses.slice(-4);
      if (ds) out.ds = ds;
      if (events.length) { out.ev = events.slice(0, 12); events.length = 0; }
      return out;
    },
    result: function () { return over; },
    onLeave: function (p) {
      gone[p.id] = true;
      if (order[turn] === p.id && phase !== 'done') { endTurn('left'); left = 0.6; }
    }
  };
  return api;
};

function clampX(v) { return Math.max(0, Math.min(W, Math.round(Number(v) || 0))); }
function clampY(v) { return Math.max(0, Math.min(H, Math.round(Number(v) || 0))); }

exports.WORDS = WORDS.length;
