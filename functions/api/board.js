/* ============================================================
 * functions/api/board.js —— 留言板共享存储（Cloudflare Pages Function）
 * ------------------------------------------------------------
 * 与 /api/links 同一套模式：KV 存一个 JSON 数组，读写全量返回。
 * 需要在 Pages 项目里绑定 KV 命名空间，绑定名：BOARD_KV
 *   wrangler kv:namespace create BOARD
 *   并在项目设置里把 id 绑到 BOARD_KV。
 *
 * GET    /api/board            → { items: [...] }
 * POST   /api/board            body {alias,text} → { ok:true, items:[...] }
 * DELETE /api/board?id=<id>    → { ok:true, items:[...] }
 *
 * 规则：最多 300 条（FIFO 淘汰）；单条 text ≤ 120 字、alias ≤ 10 字；
 *       按 IP 限速（KV 计数，每分钟 6 条）；违禁词过滤沿用大厅黑名单。
 * ============================================================ */
export const config = { cache: { maxAge: 30 } };

const KEY = 'board.items.v1';
const MAX_ITEMS = 300;
const RATE_KEY = (ip) => 'board.rate.' + ip;
const RATE_LIMIT = 6;          /* 每分钟条数 */
const RATE_WINDOW = 60;        /* 秒 */

/* 软删除与审计：删除只挪进 tomb（可追溯），增删各留一条审计（最近 100 条） */
const TOMB_KEY = 'board.tomb.v1';
const AUDIT_KEY = 'board.audit.v1';

async function readArr(env, key) {
  const raw = await env.BOARD_KV.get(key);
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function appendCapped(env, key, entry, cap) {
  const list = await readArr(env, key);
  list.push(entry);
  while (list.length > cap) list.shift();
  await env.BOARD_KV.put(key, JSON.stringify(list));
}

const BLACK = ['赌博', '博彩', '赌场', '彩票', '时时彩', '六合彩', '色情', '成人', '淫秽',
  '黄色', '嫖娼', '诈骗', '刷单', '外挂', '私服', '恶意软件', '钓鱼', '毒品', '枪支',
  '传销', '高利贷', '裸聊', 'http://', 'https://', 'www.'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

async function readItems(env) {
  if (!env.BOARD_KV) return [];
  const raw = await env.BOARD_KV.get(KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function writeItems(env, items) {
  if (!env.BOARD_KV) return false;
  await env.BOARD_KV.put(KEY, JSON.stringify(items));
  return true;
}

function clean(s, n) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { env } = context;
  const items = await readItems(env);
  return json({ items });
}

export async function onRequestPost(context) {
  const { request, env, cf } = context;

  if (!env.BOARD_KV) {
    return json({ ok: false, error: 'storage_not_configured' }, 503);
  }

  /* Origin 校验：只允许本站写入（有 Origin 且不匹配则拒） */
  const origin = request.headers.get('Origin');
  const host = new URL(request.url).origin;
  if (origin && origin !== host) {
    return json({ ok: false, error: 'origin_not_allowed' }, 403);
  }

  /* IP 限速 */
  const ip = (request.headers.get('cf-connecting-ip') || (cf && cf.clientIp) || 'unknown');
  const rk = RATE_KEY(ip);
  const cnt = Number(await env.BOARD_KV.get(rk)) || 0;
  if (cnt >= RATE_LIMIT) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const alias = clean(body.alias, 10) || '匿名旅客';
  const text = clean(body.text, 120);
  if (!text) return json({ ok: false, error: 'empty' }, 400);

  const low = text.toLowerCase();
  for (const w of BLACK) if (low.includes(w.toLowerCase())) {
    return json({ ok: false, error: 'blocked_word' }, 422);
  }

  const items = await readItems(env);
  items.push({
    id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    alias, text, ts: Date.now(),
  });
  while (items.length > MAX_ITEMS) items.shift();

  await writeItems(env, items);
  await env.BOARD_KV.put(rk, String(cnt + 1), { expirationTtl: RATE_WINDOW });
  await appendCapped(env, AUDIT_KEY, { op: 'add', id: items[items.length - 1].id, ts: Date.now() }, 100);

  return json({ ok: true, items });
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  if (!env.BOARD_KV) return json({ ok: false, error: 'storage_not_configured' }, 503);

  const origin = request.headers.get('Origin');
  const host = new URL(request.url).origin;
  if (origin && origin !== host) return json({ ok: false, error: 'origin_not_allowed' }, 403);

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ ok: false, error: 'no_id' }, 400);

  const items = await readItems(env);
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return json({ ok: false, error: 'not_found' }, 404);
  const rm = items.splice(idx, 1)[0];

  await writeItems(env, items);
  /* 软删除：整条挪进 tomb 留痕，不做物理抹除 */
  await appendCapped(env, TOMB_KEY,
    { id: rm.id, alias: rm.alias, text: rm.text, deletedAt: Date.now() }, 200);
  await appendCapped(env, AUDIT_KEY, { op: 'del', id: rm.id, ts: Date.now() }, 100);
  return json({ ok: true, items });
}
