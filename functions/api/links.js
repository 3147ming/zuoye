/* ============================================================
 * functions/api/links.js —— 网址推荐共享存储（Cloudflare Pages Function）
 * ------------------------------------------------------------
 * 与 /api/board 同一套模式：KV 存一个 JSON 数组，读写全量返回。
 * 需要在 Pages 项目里绑定 KV 命名空间，绑定名：LINKS_KV
 *   wrangler kv:namespace create LINKS
 *   并在项目设置里把 id 绑到 LINKS_KV。
 *
 * GET    /api/links            → { items: [...] }
 * POST   /api/links            body {name,url,desc,cat,author} → { ok:true, items:[...] }
 * DELETE /api/links?id=<id>    → { ok:true, items:[...] }
 *
 * 规则：最多 300 条（FIFO 淘汰）；单条 name ≤ 20 字、url ≤ 200 字、desc ≤ 60 字、cat ≤ 20 字、author ≤ 10 字；
 *       按 IP 限速（KV 计数，每分钟 6 条）；违禁词过滤沿用大厅黑名单。
 * ============================================================ */
export const config = { cache: { maxAge: 30 } };

const KEY = 'links.items.v1';
const MAX_ITEMS = 300;
const RATE_KEY = (ip) => 'links.rate.' + ip;
const RATE_LIMIT = 6;          /* 每分钟条数 */
const RATE_WINDOW = 60;        /* 秒 */

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
  if (!env.LINKS_KV) return [];
  const raw = await env.LINKS_KV.get(KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function writeItems(env, items) {
  if (!env.LINKS_KV) return false;
  await env.LINKS_KV.put(KEY, JSON.stringify(items));
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

  if (!env.LINKS_KV) {
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
  const cnt = Number(await env.LINKS_KV.get(rk)) || 0;
  if (cnt >= RATE_LIMIT) {
    return json({ ok: false, error: 'rate_limited' }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }

  const name = clean(body.name, 20) || '匿名链接';
  const url = clean(body.url, 200);
  const desc = clean(body.desc, 60);
  const cat = clean(body.cat, 20);
  const author = clean(body.author, 10);
  if (!url) return json({ ok: false, error: 'empty_url' }, 400);

  const low = (name + desc + cat + author).toLowerCase();
  if (BLACK.some(w => low.includes(w))) {
    return json({ ok: false, error: 'blacklisted' }, 403);
  }

  const items = await readItems(env);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  items.unshift({ id, name, url, desc, cat, author, ts: Date.now() });
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;

  await writeItems(env, items);
  return json({ ok: true, items });
}

export async function onRequestDelete(context) {
  const { request, env, cf } = context;

  if (!env.LINKS_KV) {
    return json({ ok: false, error: 'storage_not_configured' }, 503);
  }

  const origin = request.headers.get('Origin');
  const host = new URL(request.url).origin;
  if (origin && origin !== host) {
    return json({ ok: false, error: 'origin_not_allowed' }, 403);
  }

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ ok: false, error: 'missing_id' }, 400);

  const items = await readItems(env);
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return json({ ok: false, error: 'not_found' }, 404);
  items.splice(idx, 1);

  await writeItems(env, items);
  return json({ ok: true, items });
}
