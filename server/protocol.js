/* ============================================================
 * server/protocol.js —— 联机协议常量（前后端共用，零依赖）
 * ------------------------------------------------------------
 * 这个文件同时被三处引用：
 *   1. 服务端：server/room-core.js（Node 本地服务 / Durable Object）
 *   2. 前端：assets/net.js 打包时内联同一份常量
 *   3. 自测：test/net-selftest.mjs
 * 所以只允许 ES5 语法 + 无 import/export，靠「最后一行挂到 globalThis」兼容两端。
 * ============================================================ */
(function (root) {
  'use strict';

  var P = {
    /* 房间号：1–5 位纯数字（< 6 位），且不允许前导 0，避免 007 与 7 撞号 */
    ROOM_MIN: 1,
    ROOM_MAX: 99999,
    CODE_RE: /^[1-9]\d{0,4}$/,

    /* 密码：可选，4 位数字；为空表示无密码房 */
    PASS_RE: /^\d{4}$/,

    MAX_PLAYERS: 4,
    MIN_PLAYERS: 2,          /* 建议开局人数；房主可以 2 人直接开 */
    ROOM_TTL: 30 * 60 * 1000, /* 最后一个玩家掉线后保留 30 分钟，方便重连 */
    MAX_NAME: 10,
    CHAT_CD: 1200,           /* 聊天冷却 ms */
    CHAT_MAX: 60,

    /* 客户端 → 服务端 */
    C: {
      HELLO: 'hello',        /* {game, name}                    建房后第一句 */
      CREATE: 'create',      /* {game, name, pass}              建房 */
      JOIN: 'join',          /* {code, pass, name}              进房 */
      READY: 'ready',        /* {ready}                         准备 / 取消 */
      START: 'start',        /* {}                              房主开局 */
      INPUT: 'input',        /* {k, v}                          输入帧（键值语义由游戏定义） */
      ACTION: 'action',      /* {a, d}                          一次性动作，如开炮 / 出牌 */
      CHAT: 'chat',          /* {text}                          房内快捷聊天 */
      PING: 'ping',          /* {t}                             测延迟 */
      LEAVE: 'leave',        /* {}                              离开房间 */
      RESTART: 'restart'     /* {}                              房主重开一局 */
    },

    /* 服务端 → 客户端 */
    S: {
      ROOM: 'room',          /* {code, game, hostId, pass, players[], state} 房间快照 */
      JOINED: 'joined',      /* {you, room}                     进房成功 */
      LEFT: 'left',          /* {reason}                        被踢 / 房间关闭 */
      ERROR: 'error',        /* {code, msg}                     错误 */
      START: 'start',        /* {seed, at, order}               开局 */
      SNAP: 'snap',          /* {t, ...}                        权威快照（按 tick 合并） */
      EVENT: 'event',        /* {e, ...}                        一次性事件广播 */
      OVER: 'over',          /* {result}                        结算 */
      CHAT: 'chat',          /* {from, name, text, ts}          聊天 */
      PONG: 'pong',          /* {t}                             延迟回包 */
      MOVE: 'move'           /* {from, to}                      房主迁移 */
    },

    /* 错误码 → 中文提示（前端直接展示，避免各处硬编码文案） */
    ERR: {
      BAD_CODE: '房间号必须是 1–5 位数字',
      BAD_PASS: '房间密码必须是 4 位数字',
      NO_ROOM: '没有这个房间，检查一下房间号',
      ROOM_FULL: '房间满了（最多 4 人）',
      PASS_WRONG: '房间密码不对',
      IN_GAME: '这一局已经开始了，等它结束',
      NOT_HOST: '只有房主能开局',
      NOT_READY: '还有玩家没准备',
      FEW_PLAYERS: '至少要 2 个人才能开局',
      TOO_FAST: '发得太快了，歇一下',
      BAD_MSG: '数据格式不对',
      UNKNOWN_GAME: '没有这个联机玩法',
      KICKED: '你已被房主请出房间',
      CLOSED: '房间已关闭'
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = P;
  root.WH_PROTO = P;
})(typeof globalThis !== 'undefined' ? globalThis : this);
