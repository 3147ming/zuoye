/* ============================================================
 * functions/ws.js —— 同源联机入口（/ws）
 * ------------------------------------------------------------
 * 为什么需要这个文件：
 *   独立 Worker 跑在 `*.workers.dev` 上，而 workers.dev 在国内被
 *   DNS 污染（解析到 Facebook 的 face:b00c 段），手机流量也一样连不上。
 *   但 Pages 的 `*.pages.dev` 解析正常 —— 于是把同一个 Durable Object
 *   同时挂到 Pages 项目上，前端改连同源 `/ws`：
 *     · 走 pages.dev 域名，绕开 workers.dev 的污染；
 *     · 还是同一个 DO（同一个房间表），两套地址互为备份；
 *     · 不需要自有域名 —— 账号下本来就没有 zone。
 *
 * 实现：不复制房间逻辑，直接复用 functions/api/net.js 里的 Rooms 类
 *   （Pages Functions 里 DO 类必须从「处理该路由的那个文件」导出，
 *     所以这里 import 之后原样再导出）。
 * ============================================================ */
import { Rooms } from './api/net.js';

export { Rooms };

export const config = { cache: { maxAge: 0 }, runtime: { type: 'durable-object' } };

/* ---------- Pages Function 入口：把 /ws 交给 DO ---------- */
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.ROOMS) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'durable_object_not_bound',
      msg: '联机服务未绑定 ROOMS（Durable Object）。'
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
