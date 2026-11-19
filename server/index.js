#!/usr/bin/env node
/* ============================================================
 * server/index.js —— 联机房间服务（本地 / 自建服务器）
 * ------------------------------------------------------------
 * 用法：
 *   node server/index.js                 # 默认 0.0.0.0:8787
 *   PORT=9000 node server/index.js       # 换端口
 *   node server/index.js --port 9000
 *
 * 前端接法：在大厅「联机大厅」里填 ws://<host>:8787，或在 index.html 里
 *   设 <meta name="wh-net" content="ws://192.168.1.5:8787">
 * 部署到 Cloudflare 时不用这个文件，改用 functions/api/net.js（Durable Object）。
 *
 * 依赖：ws（npm i ws）。若未安装，会尝试用内置的极简 WebSocket 实现兜底，
 *       保证「开箱即能本地联机」——不装依赖也能跑。
 * ============================================================ */
'use strict';

var http = require('http');
var path = require('path');
var fs = require('fs');

var P = require('./protocol');
var core = require('./room-core');
var games = require('./games');

var PORT = Number(process.env.PORT || 0) || 8787;
var HOST = process.env.HOST || '0.0.0.0';
/* 静态根目录：默认是 server/ 的上一级（项目根）。
   单文件版（开服.mjs）内嵌运行时没有真实的 server/ 目录，会把 __dirname 指到别处，
   所以允许用 WH_ROOT 覆盖；覆盖值不存在时静默退回默认，避免把首页弄坏。 */
var ROOT = (function () {
  var env = process.env.WH_ROOT;
  if (env) {
    var abs = path.resolve(env);
    try { if (fs.statSync(abs).isDirectory()) return abs; } catch (e) { /* 覆盖值无效，忽略 */ }
  }
  return path.resolve(__dirname, '..');
})();

/* 有没有完整的网页可托管？判断标准：index.html 在，且 games/ 目录在。
   没有的时候不能对根路径回 404 —— 那会让「把隧道地址发给朋友」变成
   对方打开只看到 not found，百分百以为服务没起来。
   这时改成 302 送到线上大厅，并把当前域名换算成 ws 地址塞进 ?ws=，
   对方什么都不用填。WH_STATIC=off 由开服脚本在明确没有页面时设置。 */
var HAS_SITE = process.env.WH_STATIC !== 'off' &&
  fs.existsSync(path.join(ROOT, 'index.html')) &&
  fs.existsSync(path.join(ROOT, 'games'));
var PUBLIC_SITE = (process.env.WH_PUBLIC_SITE || 'https://zuoye-e0c.pages.dev').replace(/\/+$/, '');

var dir = new core.Directory();
var connSeq = 0;

/* ---------- 极简 WS 兜底（RFC6455 子集：文本帧 / ping-pong / close） ----------
 * 为什么要自己写：不装任何依赖也要能本地联机。只实现房间消息所需的最小集合：
 *   · 握手：Sec-WebSocket-Accept（SHA1 + 固定 GUID，base64），响应头一次写完
 *   · 收帧：客户端帧带 mask，解开后按 opcode 分发；支持分片（continuation）
 *   · 发帧：服务端不 mask，支持 125 / 64K / 64bit 三种长度
 *   · 控制帧：ping → pong，close → 回 close 再断
 * 关键时序：http server 的 'upgrade' 事件里 socket 已经暂停（paused），
 * 直接挂 'data' 监听会因为流未恢复而永远收不到数据；必须先 resume()。
 * ------------------------------------------------------------ */
function miniWsAccept(socket, preloaded) {
  var crypto = require('crypto');
  /* upgrader 只会给 socket，握手用的请求行已经被 http 解析器吃掉了。
     Node 在 detached socket 上不会再回放这段数据，所以要显式带上：
     调用方会把 req.headers 重建成一段原始文本传进来。 */
  var buf = preloaded && preloaded.length ? Buffer.from(preloaded, 'utf8') : Buffer.alloc(0);
  var handshaken = false;
  var listeners = { message: [], close: [], open: [] };
  var frag = null;
  var closed = false;

  function frame(op, payload) {
    var len = payload.length;
    var head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    return Buffer.concat([head, payload]);
  }

  function sendRaw(op, data) {
    if (closed || socket.destroyed) return;
    try {
      socket.write(frame(op, Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')));
    } catch (e) { /* 对端已断，忽略 */ }
  }

  function shutdown() {
    if (closed) return;
    closed = true;
    var arr = listeners.close.slice();
    for (var i = 0; i < arr.length; i++) { try { arr[i](); } catch (e) { /* ignore */ } }
  }

  function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    if (!handshaken) {
      var hEnd = buf.indexOf('\r\n\r\n');
      if (hEnd < 0) return;
      var head = buf.slice(0, hEnd).toString('utf8');
      buf = buf.slice(hEnd + 4);
      var key = /sec-websocket-key:\s*(\S+)/i.exec(head);
      if (!key) { socket.destroy(); return; }
      var accept = crypto.createHash('sha1')
        .update(key[1] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      if (socket.setNoDelay) socket.setNoDelay(true);
      handshaken = true;
      var od = listeners.open.slice();
      for (var k = 0; k < od.length; k++) { try { od[k](); } catch (e) { /* ignore */ } }
    }
    while (buf.length >= 2) {
      var b0 = buf[0], b1 = buf[1];
      var fin = (b0 & 0x80) !== 0;
      var op = b0 & 0x0f;
      var masked = (b1 & 0x80) !== 0;
      var len = b1 & 0x7f;
      var off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      var maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      var payload = Buffer.from(buf.slice(off + maskLen, off + maskLen + len));
      if (masked) {
        var mask = buf.slice(off, off + 4);
        for (var i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.slice(off + maskLen + len);

      if (op === 0x8) { sendRaw(0x8, Buffer.alloc(0)); try { socket.end(); } catch (e) { /* ignore */ } shutdown(); return; }
      if (op === 0x9) { sendRaw(0xA, payload); continue; }
      if (op === 0xA) continue;

      if (op === 0x0) {
        if (!frag) continue;
        frag = Buffer.concat([frag, payload]);
        if (!fin) continue;
        payload = frag; frag = null; op = 0x1;
      } else if (!fin) {
        frag = payload; continue;
      }
      if (op === 0x1 || op === 0x2) {
        var text = payload.toString('utf8');
        var md = listeners.message.slice();
        for (var j = 0; j < md.length; j++) { try { md[j](text); } catch (e) { /* ignore */ } }
      }
    }
  }

  socket.on('data', onData);
  socket.on('close', shutdown);
  socket.on('error', shutdown);
  if (socket.resume) socket.resume();      /* upgrade 后 socket 是 paused 的 */
  if (buf.length) onData(Buffer.alloc(0)); /* 先把重建出来的请求头跑一遍握手 */

  return {
    send: function (t) { sendRaw(0x1, t); },
    close: function () {
      try { socket.end(); } catch (e) { /* ignore */ }
      shutdown();
    },
    on: function (ev, fn) { if (listeners[ev]) listeners[ev].push(fn); }
  };
}

/* 优先用 ws 包（性能与协议完整度更好），没有就退到兜底 */
var WSImpl = null;
try { WSImpl = require('ws'); } catch (e) { WSImpl = null; }

/* ---------- 连接处理 ---------- */
function attach(conn) {
  connSeq += 1;
  var pid = 'u' + connSeq.toString(36) + Math.random().toString(36).slice(2, 6);
  var joinedCode = null;
  var alive = true;

  function send(type, data) {
    try { conn.send(JSON.stringify({ t: type, d: data || {} })); } catch (e) { /* ignore */ }
  }
  function err(code) {
    send(P.S.ERROR, { code: code, msg: P.ERR[code] || code });
  }
  function currentRoom() { return joinedCode ? dir.get(joinedCode) : null; }
  /* 交给房间对象的玩家发送器：整帧对象进、整帧出（见下方 return 处的注释） */
  var sender = { send: function (frame) {
    try { send(frame && frame.t, frame && frame.d); } catch (e) { /* ignore */ }
  } };
  function leave() {
    var r = currentRoom();
    if (!r) return;
    r.detach(pid);
    dir.unbind(pid, r.code);
    conn._roomLeaved = true;
  }

  var heartbeat = setInterval(function () {
    if (!alive) { cleanup(); return; }
    alive = false;
    send(P.S.PONG, { t: Date.now(), hb: 1 });
  }, 30000);
  if (heartbeat.unref) heartbeat.unref();

  function cleanup() {
    clearInterval(heartbeat);
    var r = currentRoom();
    if (r) { r.detach(pid); dir.unbind(pid, r.code); }
  }

  function handle(raw) {
    alive = true;
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return err('BAD_MSG'); }
    if (!msg || typeof msg.t !== 'string') return err('BAD_MSG');
    var d = msg.d || {};

    switch (msg.t) {
      case P.C.PING:
        return send(P.S.PONG, { t: d.t || Date.now() });

      case P.C.CREATE: {
        var game = String(d.game || '');
        if (!games.get(game)) return err('UNKNOWN_GAME');
        var pass = d.pass ? String(d.pass) : '';
        if (pass && !P.PASS_RE.test(pass)) return err('BAD_PASS');
        if (currentRoom()) { var old = currentRoom(); old.remove(pid); dir.unbind(pid, old.code); }
        var room = dir.create(game, pass);
        if (!room) return err('NO_ROOM');
        joinedCode = room.code;
        room.hostId = pid;
        room.add(pid, cleanName(d.name), sender, 'tok' + Math.random().toString(36).slice(2, 10));
        dir.bind(pid, room.code);
        return;
      }

      case P.C.JOIN: {
        var code = String(d.code || '');
        if (!P.CODE_RE.test(code)) return err('BAD_CODE');
        var target = dir.get(code);
        if (!target) return err('NO_ROOM');
        if (target.pass && String(d.pass || '') !== target.pass) return err('PASS_WRONG');
        var same = target.player(pid);
        if (!same && target.isFull()) return err('ROOM_FULL');
        if (currentRoom() && currentRoom() !== target) { currentRoom().remove(pid); }
        joinedCode = target.code;
        target.add(pid, cleanName(d.name), sender, 'tok' + Math.random().toString(36).slice(2, 10));
        dir.bind(pid, target.code);
        return;
      }

      case P.C.HELLO: {
        var r = currentRoom();
        if (!r) return err('NO_ROOM');
        r.sync(pid);
        return;
      }

      case P.C.READY: {
        var r2 = currentRoom(); if (!r2) return err('NO_ROOM');
        var p2 = r2.player(pid); if (p2) p2.ready = !!d.ready;
        return r2.sync();
      }

      case P.C.START: {
        var r3 = currentRoom(); if (!r3) return err('NO_ROOM');
        var res = r3.start(pid);
        if (res.error) return err(res.error);
        return;
      }

      case P.C.RESTART: {
        var r4 = currentRoom(); if (!r4) return err('NO_ROOM');
        var res2 = r4.restart(pid);
        if (res2.error) return err(res2.error);
        return;
      }

      case P.C.INPUT: {
        var r5 = currentRoom(); if (!r5) return;
        return r5.input(pid, d);
      }

      case P.C.ACTION: {
        var r6 = currentRoom(); if (!r6) return;
        return r6.action(pid, d);
      }

      case P.C.CHAT: {
        var r7 = currentRoom(); if (!r7) return;
        return r7.chat(pid, d.text);
      }

      case P.C.LEAVE: {
        var r8 = currentRoom();
        if (r8) { r8.remove(pid); dir.unbind(pid, r8.code); }
        joinedCode = null;
        return send(P.S.LEFT, { reason: 'self' });
      }

      default:
        return err('BAD_MSG');
    }
  }

  conn.on('message', function (raw) { handle(typeof raw === 'string' ? raw : raw.toString('utf8')); });
  conn.on('close', cleanup);
  send(P.S.JOINED, { you: pid, room: null, hello: true });
  /* 房间对外的发送器。
     约定（room-core 只认这一种）：conn.send({ t, d }) —— 整帧对象进、整帧出。
     这里必须包成对象形式，否则 JSON 里会变成 "{}"，服务端不报错、客户端却静默丢包，
     表现是「别人根本看不到你进来」，极难排查。 */
  return {
    pid: pid,
    conn: {
      send: function (frame) {
        try {
          if (typeof frame === 'string') conn.send(frame);
          else conn.send(JSON.stringify({ t: frame && frame.t, d: (frame && frame.d) || {} }));
        } catch (e) { /* 连接已断：忽略 */ }
      }
    },
    emit: function (type, data) { send(type, data); }
  };
}

/* 把 http 解析出来的 upgrade 请求重建成原始 HTTP 头文本，
   兜底实现靠它做 RFC6455 握手（拿 sec-websocket-key）。 */
function rebuildHandshake(req) {
  var lines = [req.method + ' ' + (req.url || '/ws') + ' HTTP/1.1'];
  var h = req.headers || {};
  Object.keys(h).forEach(function (k) {
    if (h[k] == null) return;
    lines.push(k + ': ' + h[k]);
  });
  return lines.join('\r\n') + '\r\n\r\n';
}

function cleanName(s) {
  var n = String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, P.MAX_NAME);
  return n || '玩家';
}

/* ---------- HTTP（静态资源 + 健康检查） ---------- */
var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json'
};

/* ---------- 没有网页时给本机 / 局域网看的说明页 ----------
 * 这里不能像隧道那样 302 到线上大厅：线上是 https，页面里再去连 ws://
 * 会被浏览器按「混合内容」直接拦掉，用户只会看到连不上。
 * 所以老实说明：服务在跑，界面请用本地那份单文件 HTML，或完整工程里的页面。 */
function hintPage(wsUrl, lanUrl) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>房间服务在运行</title><style>',
    '*{box-sizing:border-box}',
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;',
    'background:#0b0817;color:#e9e4ff;font:16px/1.7 -apple-system,"Segoe UI",system-ui,sans-serif;padding:24px}',
    '.card{width:100%;max-width:560px;background:#151025;border:1px solid #2a2140;border-radius:18px;padding:28px 26px}',
    'h1{margin:0 0 4px;font-size:20px;letter-spacing:.3px}',
    '.ok{display:inline-block;margin-bottom:14px;padding:3px 10px;border-radius:999px;',
    'background:#17351f;color:#8ff0b5;font-size:13px;border:1px solid #255c33}',
    'p{margin:10px 0;color:#b7aed4;font-size:14px}',
    'code,input{display:block;width:100%;margin:8px 0 16px;padding:10px 12px;border-radius:10px;',
    'background:#0d0a18;border:1px solid #2a2140;color:#8ff0b5;font:13px/1.5 ui-monospace,Consolas,monospace}',
    'ol{margin:8px 0 0;padding-left:20px;color:#cfc7e6;font-size:14px}',
    'li{margin:6px 0}b{color:#fff}',
    'a{color:#7ec8ff}',
    '.foot{margin-top:18px;padding-top:14px;border-top:1px solid #241c39;color:#6d6489;font-size:12px}',
    '.lbl{margin:14px 0 0;color:#6d6489;font-size:12px}',
    '</style></head><body><div class="card">',
    '<span class="ok">&#10003; 房间服务在运行</span>',
    '<h1>这里没有网页界面，只有联机服务</h1>',
    '<p>端口已经起来了，建房、进房、开局都正常。缺的只是一个页面文件——',
    '这个文件夹里没有 <b>index.html</b>，所以直接打开只看到这一页。</p>',
    '<p class="lbl">同一个 WiFi 用的联机地址：</p>',
    '<input readonly value="' + esc(lanUrl) + '" onclick="this.select()">',
    '<p class="lbl">你这个地址对应的联机地址：</p>',
    '<input readonly value="' + esc(wsUrl) + '" onclick="this.select()">',
    '<ol>',
    '<li><b>同一个 WiFi</b>：双击你那份 <b>联机-单文件版.html</b>（或完整工程里的页面），',
    '把上面这行地址粘到「联机」输入框里。</li>',
    '<li><b>异地朋友</b>：重新跑一次 <b>node 开服.mjs</b>（不要加 --local），',
    '它会给一个 https 地址，那个地址打开就直接进大厅，什么都不用填。</li>',
    '</ol>',
    '<div class="foot">服务状态：<a href="/healthz">/healthz</a>',
    ' &nbsp;·&nbsp; 联机端点：/ws</div>',
    '</div></body></html>'
  ].join('');
}

var server = http.createServer(function (req, res) {
  /* 自己拆 pathname，不用 url.parse：后者在 Node 22+ 会刷 DeprecationWarning，
     用户一开窗口就看到一行红字，容易被当成报错 */
  var reqUrl = String(req.url || '/');
  var qi = reqUrl.indexOf('?');
  var u = {
    pathname: qi < 0 ? reqUrl : reqUrl.slice(0, qi),
    search: qi < 0 ? '' : reqUrl.slice(qi)
  };
  if (u.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true, rooms: Object.keys(dir.rooms).length, games: games.ids,
      ts: Date.now()
    }));
  }
  if (u.pathname === '/api/party/games' || u.pathname === '/api/net/games') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ games: games.list() }));
  }
  /* 探活：Render / Koyeb 之类的平台用 GET / 判断实例是否就绪，
     用普通 200 JSON 回，别让它们因为「不是 HTML」判成失败 */
  if (u.pathname === '/' && req.headers['x-render-probe'] === '1') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'worldhub-ws', ws: '/ws' }));
  }

  /* ---------- 没有网页时：别回 not found ----------
   * 单文件开服最常见的场景：一个空文件夹里只有 开服.mjs。
   * 这时根路径如果回 404 not found，朋友打开只会以为服务坏了
   * （实际 /healthz 200、联机全通，只是没页面）。
   *
   * 分两条路：
   *   · https 访问（隧道）：302 到线上大厅，并把当前域名换算成 wss 塞进 ?ws=，
   *     于是隧道地址本身就是可分享入口，对方什么都不用填。
   *   · http 访问（本机 / 局域网）：不能跳。线上是 https，页面里连 ws:// 会被
   *     浏览器按混合内容拦掉，只会更困惑。改为给一个说明页，写清该用哪份页面。
   * /healthz、/api/* 已在上面返回，/ws 走 upgrade 事件，都不受影响。 */
  if (!HAS_SITE) {
    var host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    var proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
      (req.socket && req.socket.encrypted ? 'https' : 'http');
    if (!host) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('缺少 Host 头');
    }
    var wsUrl = (proto === 'https' ? 'wss://' : 'ws://') + host + '/ws';
    /* 只有 https 才跳。
       ssh 反向隧道（localhost.run 之类）只转 http，跳过去页面在 https 上、
       却要连 ws:// 才能回到这台机，会被浏览器按混合内容直接拦掉 —— 白跳。
       那种情况下面给说明页，并写明联机要用本机地址。 */
    if (proto === 'https') {
      var pathOut = (u.pathname === '/' ? '/games/party/' : u.pathname).replace(/\.\.+/g, '');
      res.writeHead(302, {
        Location: PUBLIC_SITE + pathOut + '?ws=' + encodeURIComponent(wsUrl),
        'Cache-Control': 'no-store'
      });
      return res.end();
    }
    /* 局域网地址：同一个 WiFi 的人填这个最稳（不经过任何隧道） */
    var lanHost = String(process.env.WH_LAN_IP || '').trim();
    var lanUrl = 'ws://' + (lanHost || host) + ':' + PORT + '/ws';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(hintPage(wsUrl, lanUrl));
  }

  /* 静态：当作本地预览服务器用，方便同机调试 */
  var rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  var file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, function (e, st) {
    /* 目录索引：/games/party/ → /games/party/index.html，
       这样给朋友的地址可以短一点，不用记 index.html */
    if (!e && st.isDirectory()) {
      rel = rel.replace(/\/?$/, '/') + 'index.html';
      file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      return fs.stat(file, function (e2, st2) {
        if (e2 || !st2.isFile()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
      });
    }
    if (e || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
});

/* ---------- WebSocket 升级 ---------- */
var wss = null;
if (WSImpl && WSImpl.WebSocketServer) {
  wss = new WSImpl.WebSocketServer({ server: server, path: '/ws' });
  wss.on('connection', function (socket) {
    var wrapped = {
      send: function (t) { if (socket.readyState === 1) socket.send(t); },
      close: function () { try { socket.close(); } catch (e) { /* ignore */ } },
      on: function (ev, fn) {
        if (ev === 'message') socket.on('message', function (data) { fn(data.toString('utf8')); });
        else socket.on(ev, fn);
      }
    };
    attach(wrapped);
  });
} else {
  server.on('upgrade', function (req, socket) {
    if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
    attach(miniWsAccept(socket, rebuildHandshake(req)));
  });
}

/* 每分钟扫一次空房 */
var sweep = setInterval(function () {
  var killed = dir.sweep();
  if (killed.length) console.log('[party] 回收空房：' + killed.join(','));
}, 60000);
if (sweep.unref) sweep.unref();

server.listen(PORT, HOST, function () {
  var impl = wss ? 'ws' : '内置兜底实现';
  console.log('[party] 联机房间服务已启动  http://' + HOST + ':' + PORT +
    '  ws://' + HOST + ':' + PORT + '/ws  (' + impl + ')');
  console.log('[party] 联机玩法：' + games.CATALOG.map(function (g) { return g.name; }).join(' / '));
});
