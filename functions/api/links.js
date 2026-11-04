/* ============================================================
 * functions/api/links.js —— 网址推荐 · 共享存储
 * ------------------------------------------------------------
 * Cloudflare Pages Function（路由 /api/links）
 * · 主案：KV 共享（namespace 变量名 LINKS，需在 Pages 后台绑定一次）
 * · KV 未绑定时返回 503，前端自动降级 localStorage（本地模式）
 * · GET 返回列表；POST 校验后追加；DELETE 按 id 删除（开放，课程演示，README 注明风险）
 * ============================================================ */

const PRESET = { id: 'preset-ming-games', name: '我的游戏合集 · ming-games', url: 'https://ming-games.pages.dev/', preset: true };

const BLACKLIST = ['赌博', '博彩', '赌场', '彩票', '时时彩', '六合彩', '色情', '成人', '淫秽', '黄色', '嫖娼',
  '诈骗', '刷单', '外挂', '代练', '私服', '恶意软件', '钓鱼', '毒品', '枪支', '传销', '高利贷', '裸聊'];

const KEY = 'items';
const MAX_ITEMS = 500;

const clone = (o) => JSON.parse(JSON.stringify(o));
const hasKV = (env) => !!(env && env.LINKS);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

async function readList(env) {
  const raw = await env.LINKS.get(KEY);
  if (!raw) return [clone(PRESET)];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.length ? arr : [clone(PRESET)];
    return [clone(PRESET)];
  } catch (e) {
    return [clone(PRESET)];
  }
}

async function writeList(env, list) {
  await env.LINKS.put(KEY, JSON.stringify(list));
}

function validate(name, url, list) {
  if (!name || typeof name !== 'string' || !name.trim()) return '请填写名称';
  if (name.trim().length > 30) return '名称最多 30 字';
  if (!url || typeof url !== 'string' || !url.trim()) return '请填写网址';
  let u;
  try { u = new URL(url); } catch (e) { return '网址格式不正确'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '只支持 http / https 链接';
  for (const w of BLACKLIST) {
    if (name.includes(w) || url.includes(w)) return '内容包含违禁词：' + w;
  }
  for (const x of list) {
    if (x.url === url) return '该网址已在列表中';
  }
  return null;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

export async function onRequestGet(context) {
  if (!hasKV(context.env)) return json({ items: [clone(PRESET)], error: 'KV 未绑定（LINKS），本地模式' }, 200);
  const list = await readList(context.env);
  return json({ items: list });
}

export async function onRequestPost(context) {
  if (!hasKV(context.env)) return json({ error: 'KV 未绑定（LINKS）' }, 503);
  let body = {};
  try { body = await context.request.json(); } catch (e) { /* ignore */ }
  const name = String((body && body.name) || '').trim();
  const url = String((body && body.url) || '').trim();
  const list = await readList(context.env);
  const err = validate(name, url, list);
  if (err) return json({ error: err }, 422);
  if (list.length >= MAX_ITEMS) return json({ error: '列表已满' }, 422);
  list.push({ id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, url, ts: Date.now() });
  await writeList(context.env, list);
  return json({ ok: true, items: list });
}

export async function onRequestDelete(context) {
  if (!hasKV(context.env)) return json({ error: 'KV 未绑定（LINKS）' }, 503);
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) return json({ error: '缺少 id' }, 400);
  if (id === PRESET.id) return json({ error: '预置条目不可删' }, 403);
  const list = await readList(context.env);
  const next = list.filter((x) => x.id !== id);
  await writeList(context.env, next.length ? next : [clone(PRESET)]);
  return json({ ok: true, items: next.length ? next : [clone(PRESET)] });
}
