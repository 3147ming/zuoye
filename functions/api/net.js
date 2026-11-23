/* ============================================================
 * functions/api/net.js —— 联机房间服务（Cloudflare Pages Functions + Durable Objects）
 * ------------------------------------------------------------
 * 与本地 server/index.js 跑同一套规则（server/room-core.js、server/games/*），
 * 区别只在宿主：本地是 ws 包，这里是 Durable Object 的 WebSocket Hibernation API。
 *
 * 部署步骤（wrangler.jsonc 见工程根目录）：
 *   1) wrangler pages deploy .            # 普通部署
 *   2) 若要用联机：需要一个 DO 绑定（绑定名 ROOMS）
 *      Cloudflare Pages 目前对 DO 的支持有两种方式：
 *        a. Workers + Durable Objects（推荐）：把 functions 迁到 worker 入口
 *        b. Pages Functions 的 DO 绑定（需在 Pages 项目设置里开启）
 *   3) /ws 由本函数接管，前端默认就连同源 /ws，无需改配置
 *
 * 设计取舍：
 *   · 一个 DO 实例 = 一张房间表（不按房间分实例），房间号在 DO 内分配；
 *     联机房间数量级小（几万），单实例完全够用，也省掉「跨房间找号」的协调。
 *   · 用 WebSocket Hibernation：玩家都掉线时 DO 可以休眠，不烧 CPU 时长。
 *   · 游戏主循环用 DO 的 alarm（30ms 一档），不依赖 setInterval（DO 不允许长期定时器）。
 * ============================================================ */
import P from '../../server/protocol.js';
import core from '../../server/room-core.js';
import games from '../../server/games/index.js';

export const config = { cache: { maxAge: 0 }, runtime: { type: 'durable-object' } };

/* 兼容 CJS 模块（room-core / games 是 module.exports） */
const { Room, Directory } = core.default || core;
const GAMES = games.default || games;

/* ---------- Durable Object 主体 ---------- */
export class Rooms {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.dir = new Directory();
    this.conns = new Map();        /* pid -> WebSocket */
    this.tickTimer = null;
    /* 休眠唤醒后恢复房间（只存元数据，对局状态不跨休眠保留） */
    this.state.blockConcurrencyWhile(async () => {
      const saved = (await this.state.storage.get('rooms')) || [];
      saved.forEach((r) => {
        const room = this.dir.create(r.game, r.pass);
        if (!room) return;
        room.stopLoop();               /* DO 里不用 setInterval */
        room.code = r.code;
        this.dir.rooms[r.code] = room;
      });
    });
  }

  async persist() {
    const list = Object.keys(this.dir.rooms).map((code) => {
      const r = this.dir.rooms[code];
      return { code: r.code, game: r.game, pass: r.pass };
    });
    await this.state.storage.put('rooms', list);
  }

  /* ---------- WebSocket 入口 ---------- */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ ok: true, rooms: Object.keys(this.dir.rooms).length, games: GAMES.ids }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const pid = 'u' + Math.random().toString(36).slice(2, 9);
    this.conns.set(pid, server);
    this.bindSocket(server, pid);
    this.send(server, P.S.JOINED, { you: pid, room: null, hello: true });
    this.ensureTicker();
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, type, data) {
    try { ws.send(JSON.stringify({ t: type, d: data || {} })); } catch (e) { /* ignore */ }
  }

  bindSocket(ws, pid) {
    let roomCode = '';
    const sender = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch (e) { /* ignore */ } } };

    const current = () => (roomCode ? this.dir.get(roomCode) : null);

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return this.send(ws, P.S.ERROR, { code: 'BAD_MSG' }); }
      if (!msg || typeof msg.t !== 'string') return this.send(ws, P.S.ERROR, { code: 'BAD_MSG' });
      const d = msg.d || {};
      const err = (code) => this.send(ws, P.S.ERROR, { code, msg: P.ERR[code] || code });

      switch (msg.t) {
        case P.C.PING:
          return this.send(ws, P.S.PONG, { t: d.t || Date.now() });

        case P.C.CREATE: {
          if (!GAMES.get(String(d.game || ''))) return err('UNKNOWN_GAME');
          const pass = d.pass ? String(d.pass) : '';
          if (pass && !P.PASS_RE.test(pass)) return err('BAD_PASS');
          const old = current();
          if (old) old.remove(pid);
          const room = this.dir.create(d.game, pass);
          if (!room) return err('NO_ROOM');
          room.stopLoop();
          roomCode = room.code;
          room.hostId = pid;
          room.add(pid, clean(d.name), sender, 'tok' + Math.random().toString(36).slice(2, 10));
          this.dir.bind(pid, room.code);
          this.persist();
          this.ensureTicker();
          return;
        }

        case P.C.JOIN: {
          const code = String(d.code || '');
          if (!P.CODE_RE.test(code)) return err('BAD_CODE');
          const target = this.dir.get(code);
          if (!target) return err('NO_ROOM');
          if (target.pass && String(d.pass || '') !== target.pass) return err('PASS_WRONG');
          if (!target.player(pid) && target.isFull()) return err('ROOM_FULL');
          const prev = current();
          if (prev && prev !== target) prev.remove(pid);
          target.stopLoop();
          roomCode = target.code;
          target.add(pid, clean(d.name), sender, 'tok' + Math.random().toString(36).slice(2, 10));
          this.dir.bind(pid, target.code);
          this.ensureTicker();
          return;
        }

        case P.C.READY: {
          const r = current(); if (!r) return err('NO_ROOM');
          const p = r.player(pid); if (p) p.ready = !!d.ready;
          return r.sync();
        }

        case P.C.START: {
          const r = current(); if (!r) return err('NO_ROOM');
          const res = r.start(pid);
          if (res.error) return err(res.error);
          this.persist();
          return;
        }

        case P.C.RESTART: {
          const r = current(); if (!r) return err('NO_ROOM');
          const res = r.restart(pid);
          if (res.error) return err(res.error);
          return;
        }

        case P.C.INPUT: { const r = current(); if (r) r.input(pid, d); return; }
        case P.C.ACTION: { const r = current(); if (r) r.action(pid, d); return; }
        case P.C.CHAT: { const r = current(); if (r) r.chat(pid, d.text); return; }

        case P.C.LEAVE: {
          const r = current();
          if (r) { r.remove(pid); this.dir.unbind(pid, r.code); }
          roomCode = '';
          return this.send(ws, P.S.LEFT, { reason: 'self' });
        }
        default:
          return err('BAD_MSG');
      }
    });

    const bye = () => {
      this.conns.delete(pid);
      const r = current();
      if (r) { r.detach(pid); this.dir.unbind(pid, r.code); }
    };
    ws.addEventListener('close', bye);
    ws.addEventListener('error', bye);
  }

  /* ---------- 主循环：用 setInterval 在 DO 里也可以，但必须能被清理 ----------
     这里选择 setInterval 而不是 alarm：DO 的 alarm 最小粒度约 1ms 但会被
     平台合并调度，60Hz 逻辑放在 alarm 里误差较大；房间有活跃连接时 DO 是常驻的，
     setInterval 足够稳。所有房间都没连接时立刻停表，DO 才能休眠。 */
  ensureTicker() {
    if (this.ticker) return;
    const self = this;
    this.ticker = setInterval(() => {
      let active = 0;
      Object.keys(self.dir.rooms).forEach((code) => {
        const room = self.dir.rooms[code];
        if (room.state !== 'playing') { room.stopLoop(); return; }
        const live = room.players.some((p) => !!p.conn);
        if (!live) return;
        active += 1;
        room._loop();
      });
      if (!active) {
        clearInterval(self.ticker);
        self.ticker = null;
      }
    }, 1000 / 60);
  }
}

function clean(s) {
  const n = String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, P.MAX_NAME);
  return n || '玩家';
}

/* ---------- Pages Function 入口：把 /ws 交给 DO ---------- */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  /* 玩法目录（前端不依赖，方便自检/调试） */
  if (url.pathname === '/api/net/games') {
    return new Response(JSON.stringify({ games: GAMES.list() }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (!env.ROOMS) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'durable_object_not_bound',
      msg: '联机服务未绑定 ROOMS（Durable Object）。可直接用自建 Node 服务，见 server/index.js'
    }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response(JSON.stringify({ ok: true, hint: 'ws 升级端点，用 WebSocket 连接' }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const id = env.ROOMS.idFromName('party');
  const stub = env.ROOMS.get(id);
  return stub.fetch(request);
}
