/* ============================================================
 * js/party/net.js —— 联机内核（浏览器侧）
 * ------------------------------------------------------------
 * 只管一件事：把 WebSocket 包成「有状态、可重连、能自动建房进房」的小 API。
 *  · 协议常量从 server/protocol.js 抄一份（ES5，与 Node 端逐字一致，测试脚本比对）
 *  · 断线自动重连（1s / 2s / 4s 退避，最多 5 次），重连后用 token 续回原房
 *  · 上行输入做 50ms 节流（输入是「当前状态」而非「事件」，丢了不补）
 *  · 服务地址解析顺序：?ws= 参数 → <meta name="wh-net"> → 同源 /ws
 * ============================================================ */
(function (global) {
  'use strict';

  var P = {
    ROOM_MIN: 1, ROOM_MAX: 99999, CODE_RE: /^[1-9]\d{0,4}$/, PASS_RE: /^\d{4}$/,
    MAX_PLAYERS: 4, MIN_PLAYERS: 2, MAX_NAME: 10, CHAT_MAX: 60, CHAT_CD: 1200,
    C: {
      HELLO: 'hello', CREATE: 'create', JOIN: 'join', READY: 'ready', START: 'start',
      INPUT: 'input', ACTION: 'action', CHAT: 'chat', PING: 'ping', LEAVE: 'leave', RESTART: 'restart'
    },
    S: {
      ROOM: 'room', JOINED: 'joined', LEFT: 'left', ERROR: 'error', START: 'start',
      SNAP: 'snap', EVENT: 'event', OVER: 'over', CHAT: 'chat', PONG: 'pong', MOVE: 'move'
    },
    ERR: {
      BAD_CODE: '房间号必须是 1–5 位数字', BAD_PASS: '房间密码必须是 4 位数字',
      NO_ROOM: '没有这个房间，检查一下房间号', ROOM_FULL: '房间满了（最多 4 人）',
      PASS_WRONG: '房间密码不对', IN_GAME: '这一局已经开始了，等它结束',
      NOT_HOST: '只有房主能开局', NOT_READY: '还有玩家没准备', FEW_PLAYERS: '至少要 2 个人才能开局',
      TOO_FAST: '发得太快了，歇一下', BAD_MSG: '数据格式不对', UNKNOWN_GAME: '没有这个联机玩法',
      KICKED: '你已被房主请出房间', CLOSED: '房间已关闭'
    }
  };

  /* ---------- 服务地址 ----------
     返回「候选地址列表」，按优先级排列。connect() 会依次尝试，
     第一个能握手的就留下。这样线上换个部署形态（同源 / 独立 Worker）
     不用改前端，也不会因为某一个域名被 DNS 污染就整个联机不可用。
     顺序：?ws= 参数（开发调试）→ meta wh-net（可写多个，逗号/空格分隔）→ 同源 /ws */
  function parseList(raw) {
    if (!raw) return [];
    return String(raw).split(/[\s,]+/).filter(function (s) { return /^wss?:\/\//.test(s); });
  }

  function resolveWsUrls() {
    var list = [];
    try {
      list = list.concat(parseList(new URLSearchParams(location.search).get('ws')));
    } catch (e) { /* ignore */ }
    var meta = document.querySelector('meta[name="wh-net"]');
    if (meta && meta.content) list = list.concat(parseList(meta.content));
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    list.push(proto + '//' + location.host + '/ws');
    /* 去重但保序 */
    var seen = {};
    return list.filter(function (u) {
      if (seen[u]) return false;
      seen[u] = 1;
      return true;
    });
  }

  /* 兼容旧调用：只取第一个候选 */
  function resolveWsUrl() {
    return resolveWsUrls()[0] || '';
  }

  function Net() {
    this.ws = null;
    this.url = '';
    this.state = 'idle';      /* idle | connecting | online | offline */
    this.you = '';
    this.token = '';
    this.room = null;
    this.code = '';
    this.latency = 0;
    this.autoRejoin = null;   /* {kind:'create'|'join', game, pass, code} */
    this._handlers = {};
    this._retry = 0;
    this._timer = null;
    this._pingTimer = null;
    this._inputBuf = null;
    this._inputTimer = null;
    /* 这一局有没有「真的连上过」。断线重连看它：
       连上过的 → 值得一直试（服务端重启一会儿就回来）；
       从没连上过的 → 地址/网络根本不通，转圈没用，直接报给 UI。 */
    this._everOnline = false;
    this._resetTimer = null;
  }

  Net.prototype.on = function (type, fn) {
    (this._handlers[type] || (this._handlers[type] = [])).push(fn);
    return this;
  };

  Net.prototype.off = function (type, fn) {
    var arr = this._handlers[type];
    if (!arr) return;
    var i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };

  Net.prototype._emit = function (type, data) {
    var arr = this._handlers[type];
    if (arr) for (var i = 0; i < arr.length; i++) {
      try { arr[i](data); } catch (e) { if (global.console) console.warn('[net] handler error', e); }
    }
    var all = this._handlers['*'];
    if (all) for (var j = 0; j < all.length; j++) {
      try { all[j](type, data); } catch (e2) { /* ignore */ }
    }
  };

  Net.prototype.connect = function (url) {
    var self = this;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return this;
    /* 显式传入地址时只试这一个；否则用候选列表 */
    this._urls = url ? [url] : (this._urls && this._urls.length ? this._urls : resolveWsUrls());
    this._urlIdx = 0;
    /* 上次已经确认「握手不通」的地址，重连时排到最后：
       否则用户每点一次「重试连接」都要再干等一次超时，体验很差。
       但不清除它们——换个网络后同一个地址可能又能用。 */
    var bad = this._dead || {};
    var ordered = this._urls.filter(function (u) { return !bad[u]; })
      .concat(this._urls.filter(function (u) { return bad[u]; }));
    this._urls = ordered;
    return this._tryNext(0);
  };

  /* 依次尝试候选地址。全部失败才算真失败，并把失败原因累积给 UI。 */
  Net.prototype._tryNext = function (idx) {
    var self = this;
    var urls = this._urls || [];
    if (idx >= urls.length) {
      this.state = 'offline';
      this._emit('status', {
        state: 'offline', code: 'ALLFAILED',
        reason: 'all endpoints failed', reconnect: this._retry > 0, failed: !this._everOnline
      });
      /* 关键：这里以前直接 return，重连链就断在这一帧。
         服务端刚被杀掉时 TCP 是「拒绝」而不是「超时」，握手永远不成功，
         于是每次重连都走到这个分支；不安排下一次重试，客户端就永久停在
         offline —— 实测表现为「只重试 1 次，服务恢复 22 秒后仍连不回去」。 */
      this._scheduleReconnect('all endpoints failed');
      return this;
    }
    this._urlIdx = idx;
    this.url = urls[idx];
    this.state = 'connecting';
    this._emit('status', { state: 'connecting', reconnect: this._retry > 0 });
    var ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this._markDead(this.url);
      return this._tryNext(idx + 1);
    }
    this.ws = ws;

    /* 握手超时：网络被墙/域名被污染时浏览器可能既不 open 也不 close，
       界面会一直卡在「连接中…」。这里 4 秒自己收摊，换下一个候选。
       4 秒是权衡：跨境 RTT 一般 200~400ms，4 秒足够完成握手；
       再长就是域名根本不通，继续等没有意义，只会让用户干等。 */
    var answered = false;
    this._connTimer = setTimeout(function () {
      if (answered || self.state !== 'connecting') return;
      answered = true;
      try { ws.close(); } catch (e) { /* ignore */ }
      if (self.ws === ws) self.ws = null;
      self._markDead(self.url);
      self._tryNext(idx + 1);
    }, 4000);

    ws.onopen = function () {
      if (answered) return;
      answered = true;
      clearTimeout(self._connTimer);
      self._everOnline = true;
      /* 退避计数不在这里清零：服务端刚挂时会出现「握手成功 → 立刻被关」的
         抖动，在 onopen 清零等于计数永远回到 0，退避形同虚设。
         改成「稳定 3 秒后才清零」：真断线才累积，一闪而过的不算。 */
      if (self._resetTimer) { clearTimeout(self._resetTimer); self._resetTimer = null; }
      self._resetTimer = setTimeout(function () {
        self._resetTimer = null;
        self._retry = 0;
      }, 3000);
      if (self._dead) delete self._dead[self.url];
      self.state = 'online';
      self._emit('status', { state: 'online', url: self.url });
      self._startPing();
      /* 重连后自动续房 */
      if (self.autoRejoin) self._rejoin();
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.t) return;
      var d = msg.d || {};
      if (msg.t === P.S.PONG) {
        if (d && d.t) self.latency = Math.max(0, Date.now() - d.t);
        if (!d || !d.hb) self._emit('latency', self.latency);
        return;
      }
      if (msg.t === P.S.JOINED && d.you) { self.you = d.you; if (d.token) self.token = d.token; }
      if (msg.t === P.S.ROOM && d && d.code) {
        self.room = d;
        self.code = d.code;
        /* 房间号一拿到就把「重建」改成「回房」：
           断线重连时应当回到原房间，而不是又建一个新房间 */
        if (self.autoRejoin && self.autoRejoin.kind === 'create') {
          self.autoRejoin = { kind: 'join', code: d.code, pass: self.autoRejoin.pass, name: self.autoRejoin.name };
        }
      }
      if (msg.t === P.S.LEFT) { self.room = null; self.code = ''; }
      self._emit(msg.t, d);
    };

    ws.onclose = function (ev) {
      if (self.ws === ws) self.ws = null;
      self._stopPing();
      if (self.state === 'idle') return;
      /* 还没握手成功就关了 = 这个地址不通，直接换下一个候选 */
      if (!answered) {
        answered = true;
        clearTimeout(self._connTimer);
        self._markDead(self.url);
        return self._tryNext(idx + 1);
      }
      self.state = 'offline';
      /* 把关闭原因带上；地址只在内部日志，不往 UI 传 */
      self._emit('status', {
        state: 'offline', code: ev && ev.code, reason: ev && ev.reason,
        reconnect: self._retry > 0, failed: !self._everOnline
      });
      self._scheduleReconnect('socket closed');
    };

    ws.onerror = function () {
      /* onclose 会接手；这里只记一笔，避免控制台噪音 */
    };
    return this;
  };

  /* ---------- 退避重连 ----------
     统一出口：onclose 和「候选全失败」都走这里，避免两条路径各写一套。
     退避：0.8s → 1.6 → 3.2 → 6.4 → 8s（之后一直 8 秒一次）。
     上限给到 60 次（≈8 分钟）：WiFi 切换、服务端重启、笔记本休眠都能等到；
     再久不如让玩家自己发现（页面早就在显示「重连中」了）。 */
  Net.prototype._scheduleReconnect = function (reason) {
    var self = this;
    if (!this.autoRejoin) return this;      /* 主动退出/没房间，别自作多情 */
    if (!this._everOnline) return this;     /* 从没连上过 = 地址错了，转圈没用 */
    if (this._timer) return this;           /* 已经排过，别叠加 */
    if (this._retry >= 60) {
      this.state = 'offline';
      this._emit('status', {
        state: 'offline', code: 'GIVEUP', reason: reason || 'retry exhausted',
        reconnect: true, failed: true
      });
      return this;
    }
    var wait = Math.min(8000, 800 * Math.pow(2, Math.min(this._retry, 4)));
    this._retry += 1;
    this._timer = setTimeout(function () {
      self._timer = null;
      self.connect();
    }, wait);
    return this;
  };

  /* 记下「握手不通」的地址：只影响重连顺序，不清除候选，
     换网络后同一个地址仍会被重新尝试（排最后）。 */
  Net.prototype._markDead = function (url) {
    if (!url) return;
    if (!this._dead) this._dead = {};
    this._dead[url] = 1;
  };

  Net.prototype._startPing = function () {
    var self = this;
    this._stopPing();
    this._pingTimer = setInterval(function () { self.send(P.C.PING, { t: Date.now() }); }, 4000);
  };

  Net.prototype._stopPing = function () {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  };

  Net.prototype._rejoin = function () {
    var a = this.autoRejoin;
    if (!a) return;
    if (a.kind === 'create') {
      this.send(P.C.CREATE, { game: a.game, name: a.name, pass: a.pass });
    } else {
      /* 必须带 pid + token：服务端靠这两个值认出「你是刚才掉的那个」，
         复用原座位与游戏内状态。不带就会变成新玩家加入，自己的坦克留在原地。 */
      this.send(P.C.JOIN, {
        code: a.code, pass: a.pass, name: a.name,
        pid: this.you || '', token: this.token || ''
      });
    }
  };

  /* 发消息。连不上就直接失败（返回 false），不排队：
     「先 connect 再立刻 create」这种写法在真实 UI 里会触发两次建房/进房
     （一次是点击时的直发、一次是排队补发），两个页面反而落进不同房间，
     排查起来极其费时。让调用方自己等 status=online 再发，语义更清楚。 */
  Net.prototype.send = function (type, data) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify({ t: type, d: data || {} })); return true; }
    catch (e) { return false; }
  };

  /* 输入节流：同一帧里多次调用只发最后一次（输入是状态不是事件） */
  Net.prototype.input = function (data) {
    var self = this;
    this._inputBuf = data;
    if (this._inputTimer) return;
    this._inputTimer = setTimeout(function () {
      self._inputTimer = null;
      var d = self._inputBuf;
      self._inputBuf = null;
      if (d) self.send(P.C.INPUT, d);
    }, 50);
  };

  Net.prototype.action = function (a, extra) {
    var d = { a: a };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) d[k] = extra[k];
    return this.send(P.C.ACTION, d);
  };

  Net.prototype.createRoom = function (game, pass, name) {
    this.autoRejoin = { kind: 'create', game: game, pass: pass || '', name: name };
    return this.send(P.C.CREATE, { game: game, pass: pass || '', name: name });
  };

  Net.prototype.joinRoom = function (code, pass, name) {
    this.autoRejoin = { kind: 'join', code: String(code), pass: pass || '', name: name };
    return this.send(P.C.JOIN, { code: String(code), pass: pass || '', name: name });
  };

  Net.prototype.leave = function () {
    this.autoRejoin = null;
    this.send(P.C.LEAVE, {});
    this.room = null;
    this.code = '';
  };

  Net.prototype.disconnect = function () {
    this.autoRejoin = null;
    this.state = 'idle';
    this._everOnline = false;
    this._retry = 0;
    this._stopPing();
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._resetTimer) { clearTimeout(this._resetTimer); this._resetTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
    this.ws = null;
  };

  /* ---------- 小工具 ---------- */
  Net.prototype.isHost = function () {
    return !!(this.room && this.room.hostId === this.you);
  };

  Net.prototype.me = function () {
    if (!this.room) return null;
    for (var i = 0; i < this.room.players.length; i++) {
      if (this.room.players[i].id === this.you) return this.room.players[i];
    }
    return null;
  };

  Net.prototype.nameOf = function (id) {
    if (!this.room) return '玩家';
    for (var i = 0; i < this.room.players.length; i++) {
      if (this.room.players[i].id === id) return this.room.players[i].name;
    }
    return '玩家';
  };

  Net.prototype.seatOf = function (id) {
    if (this.gs && this.gs.seats && this.gs.seats[id] != null) return this.gs.seats[id];
    if (!this.room) return 0;
    for (var i = 0; i < this.room.players.length; i++) {
      if (this.room.players[i].id === id) return this.room.players[i].seat || 0;
    }
    return 0;
  };

  Net.prototype.errText = function (code) {
    return P.ERR[code] || ('出错了：' + code);
  };

  Net.prototype.clearRoom = function () {
    this.room = null;
    this.code = '';
  };

  global.WH_PARTY_NET = Net;
  global.WH_PROTO = P;
  global.WH_WS_RESOLVE = resolveWsUrl;
  global.WH_WS_RESOLVE_LIST = resolveWsUrls;
})(typeof window !== 'undefined' ? window : globalThis);
