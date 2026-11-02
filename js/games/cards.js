/* ============================================================
 * cards.js —— 与 AI 打牌（简化斗地主）
 * ------------------------------------------------------------
 * 1 个人类 + 2 个 AI，54 张牌，每人 17 张 + 3 张底牌，
 * 开局随机一人当地主，地主先出，逆时针轮转。
 *
 * 简化声明（相对标准斗地主，这里刻意不做）：
 *   · 无叫分、无抢地主、无加倍、无春天
 *   · 人类与 AI 都不拆炸弹去凑顺子（AI 只做「最小可压」与「要不起」）
 *   · 三带一只带单张，飞机只带等量单张
 *
 * 点数映射：3..10 → 3..10，J/Q/K/A → 11..14，
 *           2 → 17，小王 18，大王 19
 *   （15、16 留空不用，这样「大小王 = 18/19」与指令一致，
 *     同时保证 2 一定大于 A、一定不能进顺子/连对）
 * ============================================================ */
(function (global) {
  'use strict';

  var VIEW_W = 1280;
  var VIEW_H = 720;

  var CARD_W = 68;
  var CARD_H = 96;
  var HAND_Y = 574;            /* 手牌顶边 */
  var PLAY_W = 46;             /* 出牌区小牌 */
  var PLAY_H = 64;
  var BOTTOM_W = 40;           /* 底牌 */
  var BOTTOM_H = 56;

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  var C = {
    paper: '#fdf3e4',
    dim: 'rgba(253, 243, 228, 0.46)',
    faint: 'rgba(253, 243, 228, 0.20)',
    warm: '#f0a066',
    gold: '#ffd79a',
    panel: 'rgba(20, 15, 34, 0.92)',
    cardFace: '#fbf4e8',
    cardRed: '#c0392b',
    cardBlack: '#2b2440',
    backA: '#3a2a5e',
    backB: '#221838'
  };

  var RANK_TXT = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 17: '2'
  };
  var SUITS = ['♠', '♥', '♣', '♦'];

  var TYPE_NAME = {
    single: '单张', pair: '对子', triple: '三张', triple1: '三带一',
    straight: '顺子', pairs: '连对', plane: '飞机', bomb: '炸弹', rocket: '火箭'
  };

  /* ---------------- 小工具 ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  function rr(ctx, x, y, w, h, r) {
    var k = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
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

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /* ---------------- 牌 ---------------- */

  function buildDeck() {
    var deck = [];
    var ranks = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17];
    for (var i = 0; i < ranks.length; i++) {
      for (var s = 0; s < 4; s++) {
        deck.push({ id: 'r' + ranks[i] + 's' + s, r: ranks[i], s: s });
      }
    }
    deck.push({ id: 'joker18', r: 18, s: -1 });
    deck.push({ id: 'joker19', r: 19, s: -1 });
    return deck;
  }

  /* Fisher-Yates */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* 手牌从大到小排，花色只是稳定次序 */
  function sortHand(hand) {
    hand.sort(function (a, b) {
      if (b.r !== a.r) return b.r - a.r;
      return b.s - a.s;
    });
    return hand;
  }

  function groupRanks(cards) {
    var map = Object.create(null);
    var order = [];
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].r;
      if (!map[r]) { map[r] = []; order.push(r); }
      map[r].push(cards[i]);
    }
    order.sort(function (a, b) { return a - b; });
    return { order: order, map: map };
  }

  function isSeq(arr) {
    for (var i = 1; i < arr.length; i++) {
      if (arr[i] !== arr[i - 1] + 1) return false;
    }
    return true;
  }

  /* ---------------- 牌型解析 ---------------- */

  /*
   * 入参是牌对象数组，返回 { type, rank, len, wing } 或 null。
   * len 是总张数，所以「飞机不带」与「飞机带单」的 len 不同，
   * 比较时天然不会串型。
   */
  function parseCombo(cards) {
    var n = cards.length;
    if (!n) return null;

    var g = groupRanks(cards);
    var order = g.order;
    var map = g.map;
    var counts = [];
    var i;
    for (i = 0; i < order.length; i++) counts.push({ r: order[i], c: map[order[i]].length });
    var top = order[order.length - 1];

    /* 火箭 */
    if (n === 2 && order.length === 2 && order[0] === 18 && order[1] === 19) {
      return { type: 'rocket', rank: 19, len: 2, wing: 0 };
    }
    if (n === 1) return { type: 'single', rank: top, len: 1, wing: 0 };
    if (n === 2 && counts.length === 1) return { type: 'pair', rank: top, len: 2, wing: 0 };
    if (n === 3 && counts.length === 1) return { type: 'triple', rank: top, len: 3, wing: 0 };
    if (n === 4 && counts.length === 1) return { type: 'bomb', rank: top, len: 4, wing: 0 };
    if (n === 4 && counts.length === 2) {
      for (i = 0; i < 2; i++) {
        if (counts[i].c === 3) return { type: 'triple1', rank: counts[i].r, len: 4, wing: 0 };
      }
      return null;
    }

    var allOne = true, allTwo = true;
    for (i = 0; i < counts.length; i++) {
      if (counts[i].c !== 1) allOne = false;
      if (counts[i].c !== 2) allTwo = false;
    }
    var seq = isSeq(order);

    /* 顺子：≥5 连，不含 2 与王 */
    if (n >= 5 && allOne && seq && top <= 14) {
      return { type: 'straight', rank: top, len: n, wing: 0 };
    }
    /* 连对：≥3 连对，不含 2 与王 */
    if (n >= 6 && n % 2 === 0 && allTwo && counts.length === n / 2 && seq && top <= 14) {
      return { type: 'pairs', rank: top, len: n, wing: 0 };
    }

    /* 飞机 */
    var tri = [];
    for (i = 0; i < counts.length; i++) if (counts[i].c === 3) tri.push(counts[i].r);
    if (tri.length >= 2 && isSeq(tri) && tri[tri.length - 1] <= 14) {
      var triTop = tri[tri.length - 1];
      if (counts.length === tri.length && n === tri.length * 3) {
        return { type: 'plane', rank: triTop, len: n, wing: 0 };
      }
      var onlyTriOrSingle = true;
      for (i = 0; i < counts.length; i++) {
        if (counts[i].c !== 3 && counts[i].c !== 1) { onlyTriOrSingle = false; break; }
      }
      if (onlyTriOrSingle && (n - tri.length * 3) === tri.length) {
        return { type: 'plane', rank: triTop, len: n, wing: 1 };
      }
    }

    return null;
  }

  /* a 能不能压过 b */
  function beats(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.type === 'rocket') return true;
    if (b.type === 'rocket') return false;
    if (a.type === 'bomb') return b.type === 'bomb' ? a.rank > b.rank : true;
    if (b.type === 'bomb') return false;
    if (a.type !== b.type || a.len !== b.len) return false;
    return a.rank > b.rank;
  }

  /* ---------------- 找牌（AI 与提示共用） ---------------- */

  function takeRank(g, r, k) {
    return g.map[r].slice(0, k);
  }

  /* 找 count 组、每组 per 张、连号且最大点 > minTop 的牌组 */
  function findRun(hand, count, minTop, per) {
    var g = groupRanks(hand);
    var usable = [];
    for (var i = 0; i < g.order.length; i++) {
      var r = g.order[i];
      if (r <= 14 && g.map[r].length >= per) usable.push(r);
    }
    for (i = 0; i + count - 1 < usable.length; i++) {
      var ok = true;
      for (var j = 1; j < count; j++) {
        if (usable[i + j] !== usable[i] + j) { ok = false; break; }
      }
      if (!ok) continue;
      var top = usable[i + count - 1];
      if (top <= minTop) continue;
      var out = [];
      for (j = 0; j < count; j++) out = out.concat(g.map[usable[i + j]].slice(0, per));
      return out;
    }
    return null;
  }

  /* 挑 k 张最不心疼的散牌；先拆孤张，再拆对子/三张 */
  function pickKicker(hand, used, k) {
    var usedIds = Object.create(null);
    for (var i = 0; i < used.length; i++) usedIds[used[i].id] = 1;
    var rest = [];
    for (i = 0; i < hand.length; i++) if (!usedIds[hand[i].id]) rest.push(hand[i]);
    var g = groupRanks(rest);
    var singles = [], multi = [];
    for (i = 0; i < g.order.length; i++) {
      (g.map[g.order[i]].length === 1 ? singles : multi).push(g.order[i]);
    }
    var pool = singles.concat(multi);
    var out = [];
    for (i = 0; i < pool.length && out.length < k; i++) out.push(g.map[pool[i]][0]);
    return out.length === k ? out : null;
  }

  /* 最小的能压过上家的组合；没有就 null（要不起） */
  function findBeat(hand, last) {
    if (!last) return null;
    if (last.type === 'rocket') return null;

    var g = groupRanks(hand);
    var order = g.order;
    var i, r, res = null;

    function firstAtLeast(minCount, minRank) {
      for (var k = 0; k < order.length; k++) {
        var rr2 = order[k];
        if (rr2 > minRank && g.map[rr2].length >= minCount) return rr2;
      }
      return -1;
    }

    if (last.type === 'single') {
      r = firstAtLeast(1, last.rank);
      if (r > 0) res = takeRank(g, r, 1);
    } else if (last.type === 'pair') {
      r = firstAtLeast(2, last.rank);
      if (r > 0) res = takeRank(g, r, 2);
    } else if (last.type === 'triple') {
      r = firstAtLeast(3, last.rank);
      if (r > 0) res = takeRank(g, r, 3);
    } else if (last.type === 'triple1') {
      for (i = 0; i < order.length; i++) {
        r = order[i];
        if (r <= last.rank || g.map[r].length < 3) continue;
        var tri = takeRank(g, r, 3);
        var kick = pickKicker(hand, tri, 1);
        if (kick) { res = tri.concat(kick); break; }
      }
    } else if (last.type === 'straight') {
      res = findRun(hand, last.len, last.rank, 1);
    } else if (last.type === 'pairs') {
      res = findRun(hand, last.len / 2, last.rank, 2);
    } else if (last.type === 'plane') {
      var groups = last.wing ? last.len / 4 : last.len / 3;
      var run = findRun(hand, groups, last.rank, 3);
      if (run) {
        if (last.wing) {
          var wings = pickKicker(hand, run, groups);
          res = wings ? run.concat(wings) : null;
        } else {
          res = run;
        }
      }
    }

    if (res) return res;

    /* 炸弹：同型出不了就上炸 */
    if (last.type !== 'bomb') {
      for (i = 0; i < order.length; i++) {
        if (g.map[order[i]].length === 4) return takeRank(g, order[i], 4);
      }
    } else {
      for (i = 0; i < order.length; i++) {
        r = order[i];
        if (r > last.rank && g.map[r].length === 4) return takeRank(g, r, 4);
      }
    }
    /* 火箭 */
    if (g.map[18] && g.map[19]) return [g.map[18][0], g.map[19][0]];

    return null;
  }

  /* 手牌里最长的一条顺子（≥5 才返回） */
  function longestStraight(hand) {
    var g = groupRanks(hand);
    var usable = [];
    for (var i = 0; i < g.order.length; i++) {
      if (g.order[i] <= 14) usable.push(g.order[i]);
    }
    var best = null, run = [];
    for (i = 0; i < usable.length; i++) {
      if (i > 0 && usable[i] === usable[i - 1] + 1) run.push(usable[i]);
      else run = [usable[i]];
      if (run.length >= 5 && (!best || run.length > best.length)) best = run.slice();
    }
    if (!best) return null;
    var out = [];
    for (i = 0; i < best.length; i++) out.push(g.map[best[i]][0]);
    return out;
  }

  /* 自由出牌（没人管你 / AI 当地主先手） */
  function pickLead(hand) {
    if (hand.length >= 8) {
      var st = longestStraight(hand);
      if (st) return st;
    }
    var g = groupRanks(hand);
    for (var i = 0; i < g.order.length; i++) {
      if (g.map[g.order[i]].length === 1) return [g.map[g.order[i]][0]];
    }
    return [g.map[g.order[0]][0]];
  }

  /* 人类领出时的默认选牌：就是最小的一张，别一上来就替他甩一条顺子 */
  function pickDefault(hand) {
    if (!hand.length) return null;
    var min = hand[0];
    for (var i = 1; i < hand.length; i++) if (hand[i].r < min.r) min = hand[i];
    return [min];
  }

  /* AI 出牌：纯函数（hand, lastPlay）→ 牌数组 或 null(=要不起) */
  function aiTurn(hand, last) {
    if (last) return findBeat(hand, last);
    return pickLead(hand);
  }

  /* ---------------- 画牌 ---------------- */

  function drawBack(ctx, x, y, w, h) {
    ctx.save();
    rr(ctx, x, y, w, h, Math.max(4, w * 0.11));
    var g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, C.backA);
    g.addColorStop(1, C.backB);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.44)';
    ctx.lineWidth = Math.max(1, w * 0.02);
    ctx.stroke();

    /* 菱形暗纹 */
    ctx.save();
    rr(ctx, x, y, w, h, Math.max(4, w * 0.11));
    ctx.clip();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.18)';
    ctx.lineWidth = 1.2;
    var step = Math.max(9, w * 0.22);
    for (var i = -h; i < w + h; i += step) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i + h, y + h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
      ctx.stroke();
    }
    ctx.restore();

    /* 中央小徽记 */
    ctx.fillStyle = 'rgba(240, 167, 110, 0.30)';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, w * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFace(ctx, x, y, w, h, card, dim) {
    var isJoker = card.r >= 18;
    var red = card.s === 1 || card.s === 3 || card.r === 19;

    ctx.save();
    if (dim) ctx.globalAlpha = 0.55;
    rr(ctx, x, y, w, h, Math.max(4, w * 0.11));
    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(1, C.cardFace);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(24, 16, 36, 0.28)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    var pad = Math.max(3, w * 0.07);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    if (isJoker) {
      ctx.fillStyle = red ? C.cardRed : C.cardBlack;
      ctx.font = '700 ' + Math.round(w * 0.32) + 'px ' + SERIF;
      ctx.fillText(card.r === 19 ? '大' : '小', x + pad, y + pad);
      ctx.fillText('王', x + pad, y + pad + w * 0.38);
      /* 中间放个星 */
      ctx.fillStyle = red ? 'rgba(192, 57, 43, 0.22)' : 'rgba(43, 36, 64, 0.18)';
      ctx.beginPath();
      var cx = x + w * 0.66, cy = y + h * 0.68, R = w * 0.20;
      for (var k = 0; k < 10; k++) {
        var ang = -Math.PI / 2 + k * Math.PI / 5;
        var rad = k % 2 === 0 ? R : R * 0.44;
        ctx[k ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = red ? C.cardRed : C.cardBlack;
      ctx.font = '700 ' + Math.round(w * 0.40) + 'px ' + SANS;
      ctx.fillText(RANK_TXT[card.r], x + pad, y + pad);
      ctx.font = '400 ' + Math.round(w * 0.30) + 'px ' + SANS;
      ctx.fillText(SUITS[card.s], x + pad, y + pad + w * 0.42);

      /* 右下角的大花色 */
      ctx.save();
      ctx.globalAlpha = dim ? 0.16 : 0.20;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.font = '400 ' + Math.round(w * 0.62) + 'px ' + SANS;
      ctx.fillText(SUITS[card.s], x + w - pad * 0.6, y + h - pad * 0.4);
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---------------- 场景 ---------------- */

  function CardsScene() {
    this.state = 'title';        /* title | dealing | playing | settle */
    this.t = 0;
    this.dealT = 0;
    this.turn = 0;
    this.landlord = 0;
    this.bottom = [];
    this.lastPlay = null;        /* { who, combo, cards } */
    this.passCount = 0;
    this.table = [null, null, null];
    this.sel = Object.create(null);
    this.msg = { text: '', t: 0 };
    this.thinking = 0;
    this.winner = null;          /* 'landlord' | 'farmer' */
    this.btn = null;
    this.btns = [];
    this.cardRects = [];
    this.lastClickId = null;
    this.lastClickAt = 0;
    this.players = [
      { name: '你', hand: [] },
      { name: 'AI-下家', hand: [] },
      { name: 'AI-上家', hand: [] }
    ];
  }

  /* ---------- 生命周期 ---------- */

  CardsScene.prototype.init = function (ctx) {
    var self = this;
    this.canvas = (ctx && ctx.canvas) || (global.SceneManager && global.SceneManager.canvas);
    this.bg = buildBackdrop();

    this.t = 0;
    this.state = 'title';
    this.msg = { text: '', t: 0 };
    this.sel = Object.create(null);
    this.winner = null;
    this.btn = null;

    this.motes = [];
    var rng = mulberry32(31337);
    for (var i = 0; i < 30; i++) {
      this.motes.push({
        x: rng() * VIEW_W,
        y: 80 + rng() * 560,
        r: 0.8 + rng() * 2,
        v: 4 + rng() * 12,
        p: rng() * Math.PI * 2,
        s: 0.3 + rng() * 0.8
      });
    }

    this._onKey = function (e) { self.onKey(e); };
    this._onClick = function (e) { self.onClick(e); };
    global.addEventListener('keydown', this._onKey);
    if (this.canvas) this.canvas.addEventListener('click', this._onClick);

    if (global.HUD) global.HUD.toast('');
  };

  CardsScene.prototype.destroy = function () {
    global.removeEventListener('keydown', this._onKey);
    if (this.canvas) this.canvas.removeEventListener('click', this._onClick);
    this._onKey = this._onClick = null;
    this.bg = null;
    this.motes.length = 0;
  };

  CardsScene.prototype.toHall = function () {
    if (global.SceneManager) global.SceneManager.change('world');
  };

  /* ---------- 开局 ---------- */

  CardsScene.prototype.startMatch = function () {
    var deck = shuffle(buildDeck());
    var i;

    this.players[0].hand = deck.slice(0, 17);
    this.players[1].hand = deck.slice(17, 34);
    this.players[2].hand = deck.slice(34, 51);
    this.bottom = deck.slice(51, 54);

    /* 开局随机定地主 */
    this.landlord = Math.floor(Math.random() * 3);
    var ll = this.players[this.landlord];
    ll.hand = ll.hand.concat(this.bottom);

    for (i = 0; i < 3; i++) sortHand(this.players[i].hand);

    this.state = 'dealing';
    this.dealT = 0;
    this.turn = this.landlord;
    this.lastPlay = null;
    this.passCount = 0;
    this.table = [null, null, null];
    this.sel = Object.create(null);
    this.msg = { text: '', t: 0 };
    this.thinking = 0;
    this.winner = null;
    this.btn = null;
    this.btns = [];
  };

  CardsScene.prototype.feedback = function (text) {
    this.msg = { text: text, t: 1.2 };
  };

  /* ---------- 回合 ---------- */

  CardsScene.prototype.beginTurn = function () {
    /* 转到自己身上而上一手也是自己的 → 两家都要不起，自由出 */
    if (this.lastPlay && this.lastPlay.who === this.turn) {
      this.lastPlay = null;
      this.passCount = 0;
      this.table = [null, null, null];
    }
    if (this.turn === 0) {
      this.thinking = 0;
      this.autoSelect();
    } else {
      this.thinking = 0.4;    /* AI 假装想一下 */
    }
  };

  CardsScene.prototype.playCards = function (who, cards) {
    var hand = this.players[who].hand;
    var ids = Object.create(null);
    var i;
    for (i = 0; i < cards.length; i++) ids[cards[i].id] = 1;

    var next = [];
    for (i = 0; i < hand.length; i++) if (!ids[hand[i].id]) next.push(hand[i]);
    this.players[who].hand = next;

    var combo = parseCombo(cards);
    this.lastPlay = { who: who, combo: combo, cards: cards };
    this.passCount = 0;
    this.table[who] = { cards: cards, combo: combo };

    if (who === 0) this.sel = Object.create(null);

    if (next.length === 0) {
      this.endMatch(who);
      return;
    }
    this.turn = (who + 1) % 3;
    this.beginTurn();
  };

  CardsScene.prototype.passTurn = function (who) {
    this.passCount += 1;
    this.table[who] = { pass: true };
    this.turn = (who + 1) % 3;
    this.beginTurn();
  };

  CardsScene.prototype.endMatch = function (who) {
    this.winner = (who === this.landlord) ? 'landlord' : 'farmer';
    this.state = 'settle';
    this.btn = null;

    /* 玩家阵营（地主是 0 时玩家是地主，否则是农民）赢下这一局才算通关 */
    var playerSide = (this.landlord === 0) ? 'landlord' : 'farmer';
    if (this.winner === playerSide &&
        global.Save && global.Save.complete && !global.Save.isCleared('cards')) {
      global.Save.complete('cards');
    }
    if (this.winner === playerSide) sfx('win');
  };

  /* ---------- AI 行动 ---------- */

  CardsScene.prototype.aiAct = function () {
    var who = this.turn;
    var hand = this.players[who].hand;
    var last = this.lastPlay ? this.lastPlay.combo : null;
    var cards = aiTurn(hand, last);

    if (cards && cards.length) {
      this.playCards(who, cards);
    } else {
      this.passTurn(who);
    }
  };

  /* ---------- 人类操作 ---------- */

  CardsScene.prototype.selectedCards = function () {
    var hand = this.players[0].hand;
    var out = [];
    for (var i = 0; i < hand.length; i++) if (this.sel[hand[i].id]) out.push(hand[i]);
    return out;
  };

  CardsScene.prototype.applySelect = function (cards) {
    this.sel = Object.create(null);
    if (!cards) return;
    for (var i = 0; i < cards.length; i++) this.sel[cards[i].id] = 1;
  };

  /* 默认选中最小合法组合：能压就选最小可压，领出就是最小的一张 */
  CardsScene.prototype.autoSelect = function () {
    var hand = this.players[0].hand;
    if (!hand.length) return;
    var need = (this.lastPlay && this.lastPlay.who !== 0) ? this.lastPlay.combo : null;
    var pick = need ? findBeat(hand, need) : pickDefault(hand);
    this.applySelect(pick);
  };

  CardsScene.prototype.doPlay = function () {
    if (this.state !== 'playing' || this.turn !== 0) return;
    var cards = this.selectedCards();
    if (!cards.length) { this.feedback('请先选牌'); return; }

    var combo = parseCombo(cards);
    if (!combo) { this.feedback('牌型不合法'); return; }

    if (this.lastPlay && this.lastPlay.who !== 0 && !beats(combo, this.lastPlay.combo)) {
      this.feedback('要不起');
      return;
    }
    this.playCards(0, cards);
    sfx('play');
  };

  CardsScene.prototype.doPass = function () {
    if (this.state !== 'playing' || this.turn !== 0) return;
    if (!this.lastPlay || this.lastPlay.who === 0) {
      this.feedback('没人管你，得出牌');
      return;
    }
    this.sel = Object.create(null);
    this.passTurn(0);
    sfx('pass');
  };

  CardsScene.prototype.doHint = function () {
    if (this.state !== 'playing' || this.turn !== 0) return;
    var hand = this.players[0].hand;
    var need = (this.lastPlay && this.lastPlay.who !== 0) ? this.lastPlay.combo : null;
    var pick = need ? findBeat(hand, need) : pickDefault(hand);
    if (!pick) { this.feedback('要不起'); return; }
    this.applySelect(pick);
  };

  /* ---------- 输入 ---------- */

  CardsScene.prototype.onKey = function (e) {
    if (e.code === 'Escape') {
      e.preventDefault();
      this.toHall();
      return;
    }
    if (e.code === 'KeyF') {
      e.preventDefault();
      if (this.state === 'playing' && this.turn === 0) this.doHint();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      e.preventDefault();
      if (this.state === 'title') { this.startMatch(); return; }
      if (this.state === 'settle') { this.toHall(); return; }
      if (this.state === 'playing' && this.turn === 0) this.doPlay();
    }
  };

  CardsScene.prototype.onClick = function (e) {
    var c = this.canvas;
    if (!c) return;
    var r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var x = (e.clientX - r.left) * VIEW_W / r.width;
    var y = (e.clientY - r.top) * VIEW_H / r.height;

    if (this.state === 'title') { this.startMatch(); return; }

    if (this.state === 'settle') {
      for (var b = 0; b < this.btns.length; b++) {
        var bb = this.btns[b];
        if (x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h) {
          if (bb.id === 'again') this.startMatch();
          else this.toHall();
          return;
        }
      }
      return;
    }

    if (this.state !== 'playing') return;

    /* 按钮 */
    for (var i = 0; i < this.btns.length; i++) {
      var btn = this.btns[i];
      if (btn.disabled) continue;
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        if (btn.id === 'play') this.doPlay();
        else if (btn.id === 'pass') this.doPass();
        else if (btn.id === 'hint') this.doHint();
        return;
      }
    }

    /* 手牌：从右往左命中（右边的盖住左边） */
    if (this.turn !== 0) return;
    var rects = this.cardRects;
    for (i = rects.length - 1; i >= 0; i--) {
      var rc = rects[i];
      if (x >= rc.x && x <= rc.x + rc.hw && y >= rc.y && y <= rc.y + CARD_H) {
        this.toggleCard(rc.card);
        return;
      }
    }
  };

  CardsScene.prototype.toggleCard = function (card) {
    var now = (global.performance && performance.now) ? performance.now() : Date.now();
    var isSel = !!this.sel[card.id];

    /* 双击同一张 → 直接出牌 */
    if (this.lastClickId === card.id && now - this.lastClickAt < 360) {
      this.lastClickId = null;
      this.sel[card.id] = 1;
      this.doPlay();
      return;
    }
    this.lastClickId = card.id;
    this.lastClickAt = now;

    if (isSel) delete this.sel[card.id];
    else this.sel[card.id] = 1;
  };

  /* ---------- 更新 ---------- */

  CardsScene.prototype.update = function (dt) {
    this.t += dt;

    if (this.msg.t > 0) this.msg.t = Math.max(0, this.msg.t - dt);

    var i, m;
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * m.s + m.p) * 6 * dt;
      if (m.y < 60) { m.y = 660; m.x = Math.random() * VIEW_W; }
    }

    if (this.state === 'dealing') {
      this.dealT += dt;
      if (this.dealT >= 0.5) {
        this.dealT = 0.5;
        this.state = 'playing';
        this.beginTurn();
      }
      return;
    }

    if (this.state !== 'playing') return;

    if (this.turn !== 0) {
      this.thinking -= dt;
      if (this.thinking <= 0) {
        this.thinking = 0.4;
        this.aiAct();
      }
    }
  };

  /* ---------- 渲染 ---------- */

  CardsScene.prototype.render = function (ctx) {
    ctx.drawImage(this.bg, 0, 0, VIEW_W, VIEW_H);

    /* 飘尘 */
    ctx.save();
    for (var i = 0; i < this.motes.length; i++) {
      var m = this.motes[i];
      ctx.globalAlpha = 0.08 + 0.22 * (0.5 + 0.5 * Math.sin(this.t * m.s * 2 + m.p));
      ctx.fillStyle = '#ffd9a8';
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (this.state === 'title') {
      this.drawTitle(ctx);
      return;
    }

    this.drawSeats(ctx);
    this.drawBottomCards(ctx);
    this.drawTable(ctx);
    this.drawHand(ctx);
    this.drawButtons(ctx);
    this.drawFeedback(ctx);

    if (this.state === 'settle') this.drawSettle(ctx);
  };

  /* ---------- 背景 ---------- */

  function buildBackdrop() {
    var S = 2;
    var cv = makeCanvas(VIEW_W * S, VIEW_H * S);
    var g = cv.getContext('2d');
    g.setTransform(S, 0, 0, S, 0, 0);

    var sky = g.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, '#150e21');
    sky.addColorStop(0.42, '#241634');
    sky.addColorStop(0.78, '#3d1f33');
    sky.addColorStop(1, '#5c2c30');
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 中间一团暖光，像牌桌上方的灯 */
    var lamp = g.createRadialGradient(640, 250, 20, 640, 250, 640);
    lamp.addColorStop(0, 'rgba(255, 206, 150, 0.20)');
    lamp.addColorStop(0.45, 'rgba(240, 167, 110, 0.08)');
    lamp.addColorStop(1, 'rgba(120, 54, 52, 0)');
    g.fillStyle = lamp;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    /* 牌桌台面：一圈很淡的椭圆，把三个出牌区框在一起 */
    g.save();
    g.beginPath();
    g.ellipse(640, 292, 546, 252, 0, 0, Math.PI * 2);
    var felt = g.createRadialGradient(640, 286, 40, 640, 286, 546);
    felt.addColorStop(0, 'rgba(104, 58, 66, 0.34)');
    felt.addColorStop(0.68, 'rgba(66, 34, 52, 0.24)');
    felt.addColorStop(1, 'rgba(30, 16, 30, 0)');
    g.fillStyle = felt;
    g.fill();
    g.strokeStyle = 'rgba(240, 167, 110, 0.16)';
    g.lineWidth = 1.8;
    g.stroke();
    g.restore();

    /* 桌沿的一道暖边，跟大厅的剪纸边一个口径 */
    g.strokeStyle = 'rgba(240, 167, 110, 0.10)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(640, 292, 520, 230, 0, 0, Math.PI * 2);
    g.stroke();

    /* 桌面：底部的暗色台面 */
    var desk = g.createLinearGradient(0, 480, 0, VIEW_H);
    desk.addColorStop(0, 'rgba(16, 11, 26, 0)');
    desk.addColorStop(0.28, 'rgba(16, 11, 26, 0.72)');
    desk.addColorStop(1, 'rgba(8, 5, 14, 0.96)');
    g.fillStyle = desk;
    g.fillRect(0, 470, VIEW_W, VIEW_H - 470);

    g.fillStyle = 'rgba(240, 167, 110, 0.18)';
    g.fillRect(0, 470, VIEW_W, 1.6);

    /* 纸纹 */
    var grng = mulberry32(7788);
    var i;
    for (i = 0; i < 760; i++) {
      g.fillStyle = 'rgba(255, 240, 216, ' + (grng() * 0.045).toFixed(3) + ')';
      g.fillRect(grng() * VIEW_W, grng() * VIEW_H, 2, 2);
    }

    var vg = g.createRadialGradient(640, 340, 240, 640, 340, 860);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(6, 4, 12, 0.62)');
    g.fillStyle = vg;
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    return cv;
  }

  /* ---------- 座位与出牌区 ---------- */

  var SEAT = [
    { plate: { x: 30, y: 452, w: 208, h: 54 }, zone: { x: 640, y: 372 } },
    { plate: { x: 1042, y: 28, w: 208, h: 54 }, zone: { x: 984, y: 232 } },
    { plate: { x: 30, y: 28, w: 208, h: 54 }, zone: { x: 296, y: 232 } }
  ];

  CardsScene.prototype.drawSeats = function (ctx) {
    for (var i = 0; i < 3; i++) {
      var s = SEAT[i];
      var p = this.players[i];
      var isTurn = (this.turn === i) && (this.state === 'playing');
      var isLL = (this.landlord === i);

      /* 座位牌 */
      rr(ctx, s.plate.x, s.plate.y, s.plate.w, s.plate.h, 12);
      ctx.fillStyle = isTurn ? 'rgba(52, 34, 66, 0.92)' : 'rgba(20, 15, 34, 0.74)';
      ctx.fill();
      ctx.strokeStyle = isTurn ? 'rgba(240, 167, 110, 0.85)' : 'rgba(240, 167, 110, 0.26)';
      ctx.lineWidth = isTurn ? 2 : 1.2;
      ctx.stroke();

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = '600 20px ' + SERIF;
      ctx.fillStyle = isTurn ? C.gold : C.paper;
      ctx.fillText(p.name, s.plate.x + 16, s.plate.y + 20);

      /* 地主标签 */
      if (isLL) {
        var bw = 46, bx = s.plate.x + s.plate.w - bw - 14, by = s.plate.y + 10;
        rr(ctx, bx, by, bw, 22, 6);
        ctx.fillStyle = 'rgba(240, 167, 110, 0.92)';
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.font = '700 13px ' + SANS;
        ctx.fillStyle = '#231631';
        ctx.fillText('地主', bx + bw / 2, by + 11);
      }

      /* 张数 */
      ctx.textAlign = 'left';
      ctx.font = '500 14px ' + SANS;
      ctx.fillStyle = C.dim;
      if (i === 0) {
        ctx.fillText('手牌 ' + p.hand.length + ' 张', s.plate.x + 16, s.plate.y + 41);
      } else {
        /* 两张背面小牌 + 张数 */
        drawBack(ctx, s.plate.x + 16, s.plate.y + 30, 20, 18);
        drawBack(ctx, s.plate.x + 24, s.plate.y + 30, 20, 18);
        ctx.fillStyle = C.paper;
        ctx.font = '600 15px ' + SANS;
        ctx.fillText(String(p.hand.length), s.plate.x + 54, s.plate.y + 39);
      }

      /* 当前出牌区高亮 */
      if (isTurn) {
        var z = s.zone;
        ctx.save();
        var pulse = 0.16 + 0.08 * Math.sin(this.t * 3.2);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.ellipse(z.x, z.y + 30, 168, 84, 0, 0, Math.PI * 2);
        var gr = ctx.createRadialGradient(z.x, z.y + 30, 20, z.x, z.y + 30, 168);
        gr.addColorStop(0, 'rgba(240, 167, 110, ' + pulse.toFixed(2) + ')');
        gr.addColorStop(1, 'rgba(240, 167, 110, 0)');
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
      }
    }
  };

  /* 某座位的出牌区画一组小牌 */
  CardsScene.prototype.drawPlayed = function (ctx, who) {
    var item = this.table[who];
    if (!item) return;
    var z = SEAT[who].zone;

    if (item.pass) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 22px ' + SERIF;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.40)';
      ctx.fillText('不出', z.x, z.y + 26);
      ctx.restore();
      return;
    }

    var cards = item.cards;
    var n = cards.length;
    var step = Math.min(PLAY_W + 4, n > 1 ? (520 - PLAY_W) / (n - 1) : 0);
    var total = PLAY_W + step * (n - 1);
    var x0 = z.x - total / 2;
    for (var i = 0; i < n; i++) {
      drawFace(ctx, x0 + i * step, z.y, PLAY_W, PLAY_H, cards[i], false);
    }
  };

  CardsScene.prototype.drawTable = function (ctx) {
    this.drawPlayed(ctx, 2);
    this.drawPlayed(ctx, 1);
    this.drawPlayed(ctx, 0);
  };

  /* 底牌：AI 当地主时亮在桌面顶端 */
  CardsScene.prototype.drawBottomCards = function (ctx) {
    if (this.landlord === 0) return;
    /* 底牌只有发牌之后才存在；没有就什么都不画，别让渲染把整局搞崩 */
    if (!this.bottom || this.bottom.length < 3) return;
    var gap = 6;
    var total = BOTTOM_W * 3 + gap * 2;
    var x0 = VIEW_W / 2 - total / 2;
    for (var i = 0; i < 3; i++) {
      var card = this.bottom[i];
      if (this.state === 'dealing') drawBack(ctx, x0 + i * (BOTTOM_W + gap), 12, BOTTOM_W, BOTTOM_H);
      else drawFace(ctx, x0 + i * (BOTTOM_W + gap), 12, BOTTOM_W, BOTTOM_H, card, false);
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 12px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    ctx.fillText('底牌', VIEW_W / 2, 12 + BOTTOM_H + 12);
    ctx.restore();
  };

  /* ---------- 手牌 ---------- */

  CardsScene.prototype.handLayout = function () {
    var hand = this.players[0].hand;
    var n = hand.length;
    var maxW = 1120;
    var step = n > 1 ? Math.min(CARD_W + 6, (maxW - CARD_W) / (n - 1)) : 0;
    var total = CARD_W + step * (n - 1);
    var x0 = VIEW_W / 2 - total / 2;
    return { x0: x0, step: step, n: n, total: total };
  };

  CardsScene.prototype.drawHand = function (ctx) {
    var hand = this.players[0].hand;
    var lay = this.handLayout();
    var reveal = hand.length;
    if (this.state === 'dealing') {
      reveal = Math.min(hand.length, Math.floor(this.dealT / 0.5 * hand.length));
    }

    /* 手牌底座 */
    ctx.save();
    rr(ctx, 40, HAND_Y - 18, VIEW_W - 80, CARD_H + 40, 18);
    ctx.fillStyle = 'rgba(12, 8, 20, 0.42)';
    ctx.fill();
    ctx.restore();

    this.cardRects = [];
    for (var i = 0; i < reveal; i++) {
      var card = hand[i];
      var sel = !!this.sel[card.id];
      var x = lay.x0 + i * lay.step;
      var y = HAND_Y - (sel ? 8 : 0);
      drawFace(ctx, x, y, CARD_W, CARD_H, card, false);
      this.cardRects.push({
        x: x,
        y: y,
        hw: (i === lay.n - 1) ? CARD_W : lay.step,
        card: card
      });
    }

    /* 选中张数的提示 */
    var picked = this.selectedCards().length;
    if (picked > 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '500 14px ' + SANS;
      ctx.fillStyle = C.gold;
      ctx.fillText('已选 ' + picked + ' 张', VIEW_W / 2, HAND_Y - 36);
      ctx.restore();
    }
  };

  /* ---------- 按钮 ---------- */

  CardsScene.prototype.drawButtons = function (ctx) {
    var canAct = (this.state === 'playing' && this.turn === 0);
    var canPass = canAct && !!(this.lastPlay && this.lastPlay.who !== 0);

    this.btns = [
      { id: 'hint', x: 838, y: 484, w: 118, h: 50, label: '提示', disabled: !canAct },
      { id: 'pass', x: 966, y: 484, w: 118, h: 50, label: '不出', disabled: !canPass },
      { id: 'play', x: 1094, y: 484, w: 148, h: 50, label: '出牌', disabled: !canAct, primary: true }
    ];

    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      ctx.save();
      rr(ctx, b.x, b.y, b.w, b.h, 10);
      ctx.fillStyle = b.disabled
        ? 'rgba(253, 243, 228, 0.04)'
        : (b.primary ? 'rgba(240, 167, 110, 0.18)' : 'rgba(253, 243, 228, 0.08)');
      ctx.fill();
      ctx.strokeStyle = b.disabled
        ? 'rgba(253, 243, 228, 0.12)'
        : (b.primary ? 'rgba(240, 167, 110, 0.85)' : 'rgba(253, 243, 228, 0.34)');
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 21px ' + SERIF;
      ctx.fillStyle = b.disabled ? 'rgba(253, 243, 228, 0.22)' : (b.primary ? C.gold : C.paper);
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.restore();
    }

    /* 轮次提示 */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '500 14px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    var tip = canAct
      ? '点牌选中 · 双击直接出 · 空格 出牌 · F 提示 · Esc 返回大厅'
      : (this.state === 'playing' ? '等待 ' + this.players[this.turn].name + ' 出牌…' : '');
    ctx.fillText(tip, 838, 552);
    ctx.restore();
  };

  /* ---------- 反馈条 ---------- */

  CardsScene.prototype.drawFeedback = function (ctx) {
    if (this.msg.t <= 0 || !this.msg.text) return;
    var a = clamp(this.msg.t / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 26px ' + SERIF;

    var w = ctx.measureText(this.msg.text).width + 64;
    rr(ctx, VIEW_W / 2 - w / 2, 448, w, 52, 26);
    ctx.fillStyle = 'rgba(20, 15, 34, 0.90)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = C.gold;
    ctx.fillText(this.msg.text, VIEW_W / 2, 475);
    ctx.restore();
  };

  /* ---------- 标题 ---------- */

  CardsScene.prototype.drawTitle = function (ctx) {
    ctx.save();
    var v = ctx.createRadialGradient(640, 300, 60, 640, 360, 720);
    v.addColorStop(0, 'rgba(8, 5, 14, 0.86)');
    v.addColorStop(0.6, 'rgba(8, 5, 14, 0.72)');
    v.addColorStop(1, 'rgba(8, 5, 14, 0.44)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();

    /* 摆三张牌当装饰 */
    var deco = [
      { r: 14, s: 1, x: 470, y: 372, rot: -0.16 },
      { r: 19, s: -1, x: 600, y: 360, rot: 0 },
      { r: 13, s: 0, x: 730, y: 372, rot: 0.16 }
    ];
    for (var i = 0; i < deco.length; i++) {
      ctx.save();
      ctx.translate(deco[i].x + 40, deco[i].y + 45);
      ctx.rotate(deco[i].rot);
      ctx.globalAlpha = 0.92;
      drawFace(ctx, -40, -45, 80, 112, deco[i], false);
      ctx.restore();
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 60px ' + SERIF;
    ctx.fillStyle = 'rgba(8, 5, 14, 0.5)';
    ctx.fillText('与 AI 打牌', 643, 165);
    var tg = ctx.createLinearGradient(0, 132, 0, 198);
    tg.addColorStop(0, '#fff3e0');
    tg.addColorStop(1, '#f0a066');
    ctx.fillStyle = tg;
    ctx.fillText('与 AI 打牌', 640, 162);

    ctx.font = '600 22px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.44)';
    ctx.fillText('简 化 斗 地 主', 640, 226);

    ctx.font = '500 16px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    ctx.fillText('54 张牌 · 每人 17 张 + 3 张底牌 · 随机地主 · 一局定胜负', 640, 520);

    /* 呼吸的「点击开始」 */
    var a = 0.55 + 0.45 * Math.sin(this.t * 2.4);
    ctx.font = '600 26px ' + SERIF;
    ctx.fillStyle = 'rgba(255, 215, 154, ' + a.toFixed(2) + ')';
    ctx.fillText('点 击 开 始', 640, 578);

    ctx.font = '500 14px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.28)';
    ctx.fillText('点击画面 / Enter 开始 · Esc 返回大厅', 640, 622);
    ctx.restore();
  };

  /* ---------- 结算 ---------- */

  CardsScene.prototype.drawSettle = function (ctx) {
    var W = VIEW_W;
    var isLL = this.winner === 'landlord';
    var iWon = (this.landlord === 0) === isLL;

    ctx.save();
    ctx.fillStyle = 'rgba(6, 4, 12, 0.68)';
    ctx.fillRect(0, 0, W, VIEW_H);

    /* 面板 */
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 14;
    rr(ctx, W / 2 - 320, 190, 640, 392, 18);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.restore();

    rr(ctx, W / 2 - 320, 190, 640, 392, 18);
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '600 18px ' + SANS;
    ctx.fillStyle = C.dim;
    ctx.fillText('本 局 结 束', W / 2, 240);

    ctx.font = '700 50px ' + SERIF;
    ctx.fillStyle = isLL ? '#ffb98a' : '#9ad8ff';
    ctx.fillText(isLL ? '地主获胜' : '农民获胜', W / 2, 300);

    ctx.font = '600 22px ' + SERIF;
    ctx.fillStyle = iWon ? C.gold : 'rgba(253, 243, 228, 0.55)';
    ctx.fillText(iWon ? '你 赢 了' : '你 输 了', W / 2, 360);

    ctx.font = '500 16px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.45)';
    ctx.fillText(
      '你 ' + this.players[0].hand.length + ' 张 · ' +
      this.players[1].name + ' ' + this.players[1].hand.length + ' 张 · ' +
      this.players[2].name + ' ' + this.players[2].hand.length + ' 张',
      W / 2, 400
    );

    this.btns = [
      { id: 'again', x: W / 2 - 226, y: 438, w: 210, h: 56, label: '再来一局', primary: true },
      { id: 'hall', x: W / 2 + 16, y: 438, w: 210, h: 56, label: '回大厅' }
    ];
    for (var i = 0; i < this.btns.length; i++) {
      var b = this.btns[i];
      rr(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = b.primary ? 'rgba(240, 167, 110, 0.16)' : 'rgba(253, 243, 228, 0.06)';
      ctx.fill();
      ctx.strokeStyle = b.primary ? 'rgba(240, 167, 110, 0.85)' : 'rgba(253, 243, 228, 0.30)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.font = '600 24px ' + SERIF;
      ctx.fillStyle = b.primary ? C.gold : C.paper;
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    }

    ctx.font = '500 14px ' + SANS;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.32)';
    ctx.fillText('Enter / Esc 返回大厅', W / 2, 528);

    ctx.restore();
  };

  /* 对外暴露一份用于自测的纯函数 */
  CardsScene._api = {
    buildDeck: buildDeck,
    parseCombo: parseCombo,
    beats: beats,
    findBeat: findBeat,
    pickLead: pickLead,
    aiTurn: aiTurn,
    groupRanks: groupRanks,
    RANK_TXT: RANK_TXT
  };

  global.CardsScene = CardsScene;
  global.SceneManager.register('cards', function () {
    return new CardsScene();
  });
})(window);
