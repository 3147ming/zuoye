/* ============================================================
 * worker/entry.js —— 联机房间服务（Cloudflare Workers 入口）
 * ------------------------------------------------------------
 * 为什么需要这个文件：
 *   Pages 项目**不能**给 Functions 绑 Durable Objects（Cloudflare 官方限制），
 *   所以 /ws 不能挂在 zuoye-e0c.pages.dev 上。这里把同一套房间逻辑
 *   （server/protocol.js + server/room-core.js + server/games/*）
 *   包成独立 Worker 部署，Pages 静态站只负责页面，联机走这个 Worker。
 *
 * 路由：
 *   GET /ws              → WebSocket 升级，交给 DO 实例 party
 *   GET /api/net/games   → 玩法清单（自检用）
 *   GET /               → 健康检查
 *
 * 部署：
 *   node tools/build-ws.mjs                                  # 打包到 dist/ws-worker.js
 *   npx wrangler deploy --config wrangler.ws.jsonc           # 推到 Cloudflare
 * 本地：
 *   npx wrangler dev --config wrangler.ws.jsonc              # 起本地 DO，地址 ws://127.0.0.1:8787/ws
 * ============================================================ */
import { onRequest, Rooms } from '../functions/api/net.js';

/* Durable Object 必须在入口导出，wrangler 才能找到这个类 */
export { Rooms };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /* 健康检查：浏览器直接打开 Worker 地址时不报 500 */
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return new Response(JSON.stringify({
        ok: true,
        service: 'worldhub-ws',
        ws: '/ws',
        games: '/api/net/games',
        hint: '这是联机房间服务，前端连 wss://本域名/ws'
      }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    /* 其余统一复用 Pages 版入口：/ws 升级、/api/net/games、未绑定时 503 */
    return onRequest({
      request,
      env,
      params: {},
      data: {},
      functionPath: '/api/net',
      waitUntil: (p) => ctx.waitUntil(p),
      next: () => new Response('Not Found', { status: 404 })
    });
  }
};
