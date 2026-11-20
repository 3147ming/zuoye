/* ============================================================
 * server/room-core.js —— 房间服务核心（与运行环境无关）
 * ------------------------------------------------------------
 * 设计要点：
 *   · 每个房间一个实例，内部只持有「玩家连接 + 游戏状态」，不碰网络 API。
 *     宿主（Node ws / Cloudflare Durable Object）只需要提供 send/close 两个能力，
 *     因此同一份规则可以跑在本地、Cloudflare、或自测脚本里。
 *   · 服务端权威：60Hz 固定步长推进 games/<id>.server.js 的 step()，
 *     每 3 帧（20Hz）下发一次快照，快照里只放「变化量」由各游戏自己决定。
 *   · 房间号 1–5 位数字（不允许前导 0）、可选 4 位数字密码；
 *     房间号分配由宿主层面（RoomDirectory）负责，这里只校验格式。
 *   · 断线保留 30 分钟：玩家掉线不掉出房间，重连用同样的 playerId + token 续上。
 * ============================================================ */
'use strict';

var P = require('./protocol');
var games = require('./games');

var TICK_HZ = 60;                 /* 逻辑帧 */
var SNAP_EVERY = 2;               /* 每 2 帧发一次快照 → 30Hz（配客户端插值，画面更连续） */
var PING_EVERY = 4000;
/* 掉线宽限：断线后先保留 15 秒位置，重连回来还能接着打。
   以前 detach 里直接 alive=false，等于「WiFi 抖一下就淘汰你」——
   实测「iPad 切个后台回来，这局已经算我出局了」。 */
var GRACE_MS = 15000;
var CHAT_CD = P.CHAT_CD;

var seqRoom = 0;

function nowMs() { return Date.now(); }

function rid() {
  seqRoom += 1;
  return 'r' + seqRoom.toString(36) + Math.random().toString(36).slice(2, 6);
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/* ---------- 一个房间 ---------- */
function Room(opts) {
  opts = opts || {};
  this.id = opts.id || rid();
  this.code = String(opts.code || '');
  this.game = opts.game;
  this.pass = opts.pass || '';           /* 空 = 无密码房 */
  this.hostId = opts.hostId || '';
  this.seq = 0;                          /* 玩家序号，用于分座位与配色 */
  this.players = [];                     /* [{id, name, ready, conn, token, seat, score, alive}] */
  this.state = 'waiting';                /* waiting | playing | over */
  this.tick = 0;
  this.seed = 0;
  this.startedAt = 0;
  this.overAt = 0;
  this.result = null;
  this.gs = null;                        /* 游戏内部状态（由游戏模块创建） */
  this.emptySince = 0;
  this.createdAt = nowMs();
  this.timer = null;
  this.acc = 0;
  this.lastFrame = 0;
  this._loop = this._loop.bind(this);
}

Room.prototype.roomView = function () {
  return {
    code: this.code,
    game: this.game,
    pass: this.pass ? true : false,
    hostId: this.hostId,
    state: this.state,
    players: this.players.map(function (p) {
      return {
        id: p.id, name: p.name, ready: !!p.ready, seat: p.seat,
        online: !!p.conn, score: p.score || 0, alive: p.alive !== false
      };
    })
  };
};

Room.prototype.emitTo = function (pid, type, data) {
  var p = this.player(pid);
  if (!p || !p.conn) return;
  try { p.conn.send({ t: type, d: data || {} }); } catch (e) { /* 连接已断，忽略 */ }
};

Room.prototype.broadcast = function (type, data, exceptId) {
  var self = this;
  this.players.forEach(function (p) {
    if (!p.conn || p.id === exceptId) return;
    try { p.conn.send({ t: type, d: data || {} }); } catch (e) { /* ignore */ }
  });
};

Room.prototype.player = function (pid) {
  for (var i = 0; i < this.players.length; i++) if (this.players[i].id === pid) return this.players[i];
  return null;
};

Room.prototype.sync = function (toId) {
  var view = this.roomView();
  if (toId) this.emitTo(toId, P.S.ROOM, view);
  else this.broadcast(P.S.ROOM, view);
};

Room.prototype.freeSeat = function () {
  var used = this.players.map(function (p) { return p.seat; });
  for (var i = 0; i < P.MAX_PLAYERS; i++) if (used.indexOf(i) < 0) return i;
  return 0;
};

Room.prototype.add = function (pid, name, conn, token) {
  var p = this.player(pid);
  if (p) {                       /* 断线重连：续上原座位与分数 */
    p.conn = conn;
    p.name = name || p.name;
    p.token = token || p.token;
    /* 回来了就把宽限标记清掉，并把「已判死」翻回来 —— 判死是宽限到期
       才做的事，玩家在 15 秒内回来就不该受任何惩罚。 */
    p.droppedAt = 0;
    p.dropped = 0;
    p.alive = true;
    this.emptySince = 0;
    this.emitTo(pid, P.S.JOINED, { you: pid, token: p.token, room: this.roomView(), resumed: true });
    this.sync();
    if (this.state === 'playing' && this.gs) {
      this.emitTo(pid, P.S.START, this.startPayload(true));
      /* 全员掉线时循环被停过，重连必须重新拉起来，否则对局永久冻结 */
      this.startLoop();
    }
    return p;
  }
  p = {
    id: pid, name: name, ready: false, conn: conn, token: token,
    seat: this.freeSeat(), score: 0, alive: true, joinedAt: nowMs(), ack: 0
  };
  this.players.push(p);
  this.players.sort(function (a, b) { return a.seat - b.seat; });
  this.emptySince = 0;
  this.emitTo(pid, P.S.JOINED, { you: pid, token: token, room: this.roomView() });
  this.sync();
  return p;
};

Room.prototype.isFull = function () {
  return this.players.length >= P.MAX_PLAYERS;
};

/* 断线：只摘连接，玩家记录留着等重连 */
Room.prototype.detach = function (pid) {
  var p = this.player(pid);
  if (!p) return;
  p.conn = null;
  /* 先不判死，只记下掉线时刻。判死交给 _loop 按 GRACE_MS 检查：
     15 秒内回来（换 WiFi、切后台、隧道重连）就当作没断过。 */
  p.droppedAt = nowMs();
  p.dropped = 0;
  var anyOnline = this.players.some(function (x) { return !!x.conn; });
  if (!anyOnline) {
    if (!this.emptySince) this.emptySince = nowMs();
    this.stopLoop();
  }
  /* 房主掉线：把房主转给还在线的下一位，避免房间卡死 */
  if (p.id === this.hostId) {
    var next = this.players.filter(function (x) { return !!x.conn; })[0];
    if (next) {
      this.hostId = next.id;
      this.broadcast(P.S.MOVE, { from: p.id, to: next.id });
    }
  }
  this.sync();
};

Room.prototype.remove = function (pid) {
  var i = this.players.findIndex(function (x) { return x.id === pid; });
  if (i < 0) return;
  var p = this.players[i];
  if (this.gs && this.gs.onLeave) { try { this.gs.onLeave(p); } catch (e) { /* ignore */ } }
  this.players.splice(i, 1);
  if (p.id === this.hostId) {
    var next = this.players[0];
    if (next) {
      this.hostId = next.id;
      this.broadcast(P.S.MOVE, { from: p.id, to: next.id });
    }
  }
  if (!this.players.length) { this.state = 'waiting'; this.gs = null; this.stopLoop(); }
  this.sync();
};

Room.prototype.chat = function (pid, text) {
  var p = this.player(pid);
  if (!p) return;
  var t = nowMs();
  if (p.lastChat && t - p.lastChat < CHAT_CD) return;
  p.lastChat = t;
  var msg = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, P.CHAT_MAX);
  if (!msg) return;
  this.broadcast(P.S.CHAT, { from: pid, name: p.name, text: msg, ts: t });
};

/* ---------- 开局 ---------- */
Room.prototype.startPayload = function (rejoin) {
  return {
    seed: this.seed,
    game: this.game,
    at: this.startedAt,
    tick: this.tick,
    rejoin: !!rejoin,
    order: this.players.map(function (p) { return p.id; }),
    players: this.players.map(function (p) {
      return { id: p.id, name: p.name, seat: p.seat, alive: p.alive !== false, score: p.score || 0 };
    })
  };
};

Room.prototype.start = function (byId) {
  var self = this;
  var host = this.player(byId);
  if (!host) return { error: 'NOT_HOST' };
  if (this.hostId !== byId) return { error: 'NOT_HOST' };
  if (this.state === 'playing') return { error: 'IN_GAME' };
  var online = this.players.filter(function (p) { return !!p.conn; });
  if (online.length < P.MIN_PLAYERS) return { error: 'FEW_PLAYERS' };

  this.seed = (Math.random() * 0x7fffffff) | 0;
  this.tick = 0;
  this.acc = 0;
  this.startedAt = nowMs();
  this.state = 'playing';
  this.result = null;
  this.players.forEach(function (p) { p.alive = !!p.conn; p.score = 0; p.ack = 0; });

  var def = games.get(this.game);
  this.gs = def.create({
    seed: this.seed,
    room: this,
    players: this.players.map(function (p) {
      return { id: p.id, name: p.name, seat: p.seat };
    }),
    send: function (type, data, to) {
      if (to) self.emitTo(to, type, data); else self.broadcast(type, data);
    },
    random: mulberry32(this.seed)
  });

  this.broadcast(P.S.START, this.startPayload(false));
  this.sync();
  this.startLoop();
  return { ok: true };
};

Room.prototype.restart = function (byId) {
  if (this.hostId !== byId) return { error: 'NOT_HOST' };
  if (this.state === 'playing') return { error: 'IN_GAME' };
  this.state = 'waiting';
  this.gs = null;
  this.result = null;
  this.players.forEach(function (p) { p.ready = false; p.score = 0; p.alive = true; });
  this.sync();
  return { ok: true };
};

/* ---------- 输入 ---------- */
Room.prototype.input = function (pid, data) {
  if (this.state !== 'playing' || !this.gs || !this.gs.onInput) return;
  var p = this.player(pid);
  if (!p) return;
  /* 客户端预测要回显 ack：把「已处理到的输入序号」记下来，
     下一帧快照带上，客户端据此丢掉旧输入并重放剩下的。
     序号可能乱序（UDP 式抖动），只允许往前走，防止旧包把 ack 拉回去。 */
  if (data && typeof data.seq === 'number') {
    if (!(p.ack >= data.seq)) p.ack = data.seq;
  }
  try { this.gs.onInput(p, data || {}); } catch (e) { /* 游戏侧异常不拖垮房间 */ }
};

Room.prototype.action = function (pid, data) {
  if (this.state !== 'playing' || !this.gs || !this.gs.onAction) return;
  var p = this.player(pid);
  if (!p) return;
  try { this.gs.onAction(p, data || {}); } catch (e) { /* ignore */ }
};

/* ---------- 主循环 ---------- */
Room.prototype.startLoop = function () {
  if (this.timer) return;
  this.lastFrame = nowMs();
  this.timer = setInterval(this._loop, 1000 / TICK_HZ);
  if (this.timer.unref) this.timer.unref();
};

Room.prototype.stopLoop = function () {
  if (this.timer) { clearInterval(this.timer); this.timer = null; }
};

Room.prototype._loop = function () {
  var t = nowMs();
  var dt = Math.min(0.25, (t - this.lastFrame) / 1000);
  this.lastFrame = t;
  if (this.state !== 'playing' || !this.gs) return;
  this.tick += 1;
  try {
    this.gs.step(dt, this.tick);
  } catch (e) {
    this.state = 'over';
    this.broadcast(P.S.OVER, { error: 'server_error', msg: String(e && e.message || e) });
    this.stopLoop();
    return;
  }
  /* 掉线宽限到期：这才算真掉线 —— 标记出局、通知游戏模块、同步房间视图 */
  for (var gi = 0; gi < this.players.length; gi++) {
    var gp = this.players[gi];
    if (gp.conn || gp.dropped || !gp.droppedAt) continue;
    if (t - gp.droppedAt < GRACE_MS) continue;
    gp.dropped = 1;
    gp.alive = false;
    if (this.gs && this.gs.onLeave) { try { this.gs.onLeave(gp); } catch (e) { /* ignore */ } }
    this.sync();
  }
  if (this.tick % SNAP_EVERY === 0) {
    var snap = null;
    try { snap = this.gs.snapshot(this.tick); } catch (e) { snap = null; }
    if (snap) {
      /* ack 按玩家分别回显：客户端只关心自己那条，
         放进 d.ak = [[pid, seq], ...]，4 人约 40 字节，可忽略不计。 */
      var ak = [];
      for (var pi = 0; pi < this.players.length; pi++) {
        var pp = this.players[pi];
        if (pp.conn && pp.ack) ak.push([pp.id, pp.ack]);
      }
      if (ak.length) snap.ak = ak;
      this.broadcast(P.S.SNAP, snap);
    }
  }
  var res = null;
  try { res = this.gs.result(this.tick); } catch (e) { res = null; }
  if (res) {
    this.state = 'over';
    this.overAt = t;
    this.result = res;
    /* 结算：把分数写回玩家，前端房间面板直接显示 */
    var byId = {};
    (res.scores || []).forEach(function (s) { byId[s.id] = s.score; });
    this.players.forEach(function (p) { if (byId[p.id] != null) p.score = byId[p.id]; });
    /* 结算前补一帧终局快照：否则界面会停在「上一条快照」，看起来像死了又没死 */
    try {
      var last = this.gs.snapshot(this.tick);
      if (last) this.broadcast(P.S.SNAP, last);
    } catch (e) { /* 快照失败不影响结算 */ }
    this.broadcast(P.S.OVER, res);
    this.sync();
    this.stopLoop();
  }
};

/* 空房回收 */
Room.prototype.expired = function (t) {
  if (this.state === 'playing' && this.players.some(function (p) { return !!p.conn; })) return false;
  if (!this.emptySince) return false;
  return (t - this.emptySince) > P.ROOM_TTL;
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 房间表（宿主侧共享） ---------- */
function Directory() {
  this.rooms = Object.create(null);   /* code -> Room */
  this.byPid = Object.create(null);   /* playerId -> code */
}

Directory.prototype.taken = function (code) {
  return !!this.rooms[String(code)];
};

Directory.prototype.pickCode = function () {
  /* 先随机试 30 次（5 位号有 9 万个，空位极多）；
     实在撞满了再线性找第一个空位，保证一定能给出号。 */
  for (var i = 0; i < 30; i++) {
    var c = String(1 + Math.floor(Math.random() * P.ROOM_MAX));
    if (!this.taken(c)) return c;
  }
  for (var n = 1; n <= P.ROOM_MAX; n++) if (!this.taken(String(n))) return String(n);
  return null;
};

Directory.prototype.create = function (game, pass) {
  var code = this.pickCode();
  if (!code) return null;
  var room = new Room({ code: code, game: game, pass: pass || '' });
  this.rooms[code] = room;
  return room;
};

Directory.prototype.get = function (code) { return this.rooms[String(code)] || null; };

Directory.prototype.bind = function (pid, code) {
  var old = this.byPid[pid];
  if (old && old !== code) this.unbind(pid, old);
  this.byPid[pid] = code;
};

Directory.prototype.unbind = function (pid, code) {
  if (this.byPid[pid] === code) delete this.byPid[pid];
};

Directory.prototype.sweep = function () {
  var t = nowMs(), self = this, killed = [];
  Object.keys(this.rooms).forEach(function (code) {
    var r = self.rooms[code];
    if (r.expired(t)) {
      r.stopLoop();
      r.players.forEach(function (p) { self.unbind(p.id, code); });
      delete self.rooms[code];
      killed.push(code);
    }
  });
  return killed;
};

module.exports = {
  Room: Room,
  Directory: Directory,
  TICK_HZ: TICK_HZ,
  SNAP_EVERY: SNAP_EVERY,
  mulberry32: mulberry32,
  pick: pick
};
