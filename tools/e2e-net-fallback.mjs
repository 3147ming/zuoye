/* tools/e2e-net-fallback.mjs —— 联机地址故障转移验收
 * ------------------------------------------------------------
 * 验证 net.js 的候选地址机制（线上静态站没有 /ws，联机跑在独立 Worker 上，
 * 而 Worker 域名在部分网络下会被 DNS 污染，所以必须能自动换地址）：
 *   1. 地址解析顺序（?ws= → meta → 同源）与去重
 *   2. 第一个候选不通时自动换下一个，最终连上可用的那个
 *   3. 全部候选不通时进 offline 且 code=ALLFAILED（UI 能给出准确文案）
 *   4. meta 多地址写法（空格 / 逗号分隔）都能解析
 *
 * 起两个真实 WebSocket 服务：一个故意指向不通的端口，一个正常回 hello。
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(import.meta.dirname, '..');
const WS_PORT = 8791;
const WEB_PORT = 8792;
const BASE = 'http://127.0.0.1:' + WEB_PORT;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' → ' + extra : '')); }
};

/* ---------- 正常联机服务：握手后回一条 hello，ping 回 pong ---------- */
const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'joined', d: { you: 'u_test', room: null, hello: true } }));
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', d: { t: m.d && m.d.t } }));
  });
});
const GOOD = 'ws://127.0.0.1:' + WS_PORT + '/ws';
const DEAD = 'ws://127.0.0.1:9/ws';        /* 9 号端口基本没人监听 */

/* ---------- 静态服务器（顺带提供探针页） ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json' };
const probeHtml = `<!doctype html><html><head><meta charset="utf-8">
<meta name="wh-net" content="__META__">
</head><body><script src="/js/party/net.js"></script></body></html>`;

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, BASE);
  if (u.pathname === '/__probe.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(probeHtml.replace('__META__', u.searchParams.get('meta') || ''));
  }
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const abs = path.join(ROOT, p);
  if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
  res.end(fs.readFileSync(abs));
});
await new Promise((r) => srv.listen(WEB_PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-gpu']
});
const ctx = await browser.newContext({ serviceWorkers: 'block' });

/* ---------- 一、地址解析顺序与去重 ---------- */
console.log('=== 一、地址解析顺序与去重 ===');
{
  const page = await ctx.newPage();
  /* 同源只有一处，不重复 */
  await page.goto(BASE + '/__probe.html', { waitUntil: 'domcontentloaded' });
  let list = await page.evaluate(() => window.WH_WS_RESOLVE_LIST());
  ok(list.length === 1 && /^ws:\/\/127\.0\.0\.1:8792\/ws$/.test(list[0]),
    '无配置时只有同源 /ws 一个候选', JSON.stringify(list));

  /* 同源重复写入时去重保序 */
  await page.goto(BASE + '/__probe.html?meta=' + encodeURIComponent('ws://127.0.0.1:8792/ws ws://a.test/ws ws://a.test/ws'),
    { waitUntil: 'domcontentloaded' });
  list = await page.evaluate(() => window.WH_WS_RESOLVE_LIST());
  ok(list.length === 2 && list[0] === 'ws://127.0.0.1:8792/ws' && list[1] === 'ws://a.test/ws',
    'meta 地址在前、同源在后，且去重', JSON.stringify(list));

  /* ?ws= 参数优先级最高 */
  await page.goto(BASE + '/__probe.html?ws=' + encodeURIComponent('ws://param.test/ws') +
    '&meta=' + encodeURIComponent('ws://meta.test/ws'), { waitUntil: 'domcontentloaded' });
  list = await page.evaluate(() => window.WH_WS_RESOLVE_LIST());
  ok(list[0] === 'ws://param.test/ws', '?ws= 参数排第一', JSON.stringify(list));
  ok(list.includes('ws://meta.test/ws'), 'meta 地址保留为后续候选', JSON.stringify(list));
  ok(list[list.length - 1].endsWith('/ws') && list[list.length - 1].includes('8792'),
    '同源始终兜底在最后', list[list.length - 1]);
  await page.close();
}

/* ---------- 二、故障转移：坏地址在前 ---------- */
console.log('=== 二、故障转移：坏地址在前，好地址在后 ===');
{
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  await page.goto(BASE + '/__probe.html?meta=' + encodeURIComponent(DEAD + ' ' + GOOD),
    { waitUntil: 'domcontentloaded' });
  const res = await page.evaluate(() => new Promise((resolve) => {
    const seen = [];
    const net = new window.WH_PARTY_NET();
    net.on('status', (s) => {
      seen.push(s.state + (s.code ? ':' + s.code : ''));
      if (s.state === 'online') resolve({ ok: true, url: net.url, seen });
      if (s.code === 'ALLFAILED') resolve({ ok: false, seen });
    });
    net.connect();
    setTimeout(() => resolve({ ok: false, timeout: true, seen }), 15000);
  }));
  ok(res.ok === true, '坏地址被跳过，最终连上可用地址', JSON.stringify(res.seen));
  ok(res.url === GOOD, '连接落在第二个候选地址上', res.url);
  ok(!res.seen.includes('offline:ALLFAILED'), '中途没有误报「全部失败」', res.seen.join(','));
  ok(res.seen.filter((s) => s === 'connecting').length === 2, '确实尝试了两次连接', res.seen.join(','));
  ok(errs.length === 0, '无页面异常', errs.join('|'));
  await page.close();
}

/* ---------- 三、全部候选不通 → ALLFAILED ---------- */
console.log('=== 三、全部不通 → ALLFAILED ===');
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/__probe.html', { waitUntil: 'domcontentloaded' });
  const res = await page.evaluate((dead) => new Promise((resolve) => {
    const net = new window.WH_PARTY_NET();
    const seen = [];
    net.on('status', (s) => {
      seen.push(s.state + (s.code ? ':' + s.code : ''));
      if (s.code === 'ALLFAILED') resolve({ allFailed: true, seen, state: net.state });
    });
    net.connect(dead);
    setTimeout(() => resolve({ allFailed: false, seen }), 20000);
  }), DEAD);
  ok(res.allFailed === true, '全部候选失败时给 ALLFAILED', JSON.stringify(res.seen));
  ok(res.state === 'offline', '失败后状态是 offline', res.state);
  await page.close();
}

/* ---------- 四、meta 逗号分隔 ---------- */
console.log('=== 四、meta 逗号分隔写法 ===');
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/__probe.html?meta=' + encodeURIComponent(GOOD + ',' + DEAD),
    { waitUntil: 'domcontentloaded' });
  const res = await page.evaluate(() => new Promise((resolve) => {
    const net = new window.WH_PARTY_NET();
    net.on('status', (s) => { if (s.state === 'online') resolve({ url: net.url }); });
    net.connect();
    setTimeout(() => resolve({ url: '' }), 10000);
  }));
  ok(res.url === GOOD, '逗号分隔时第一个地址优先并连通', res.url);
  await page.close();
}

/* ---------- 五、坏地址重连时排到最后 ---------- */
console.log('=== 五、坏地址记忆：重连不再干等 ===');
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/__probe.html', { waitUntil: 'domcontentloaded' });
  const res = await page.evaluate(({ dead, good }) => new Promise((resolve) => {
    const net = new window.WH_PARTY_NET();
    net.on('status', (s) => {
      if (s.code === 'ALLFAILED') {
        net._urls = [dead, good];     /* 模拟换网络后又有了好地址 */
        net.connect();
        setTimeout(() => resolve({ order: net._urls.slice(), url: net.url }), 3500);
      }
    });
    net.connect(dead);
    setTimeout(() => resolve({ order: [], url: '' }), 18000);
  }), { dead: DEAD, good: GOOD });
  ok(res.order[0] === GOOD && res.order[1] === DEAD,
    '已确认不通的地址排到最后，好地址优先', JSON.stringify(res.order));
  ok(res.url === GOOD, '重连直接落在可用地址上', res.url);
  await page.close();
}

/* ---------- 六、连上后能正常收发 ---------- */
console.log('=== 六、连上后握手与心跳 ===');
{
  const page = await ctx.newPage();
  await page.goto(BASE + '/__probe.html?meta=' + encodeURIComponent(GOOD), { waitUntil: 'domcontentloaded' });
  const res = await page.evaluate((good) => new Promise((resolve) => {
    const net = new window.WH_PARTY_NET();
    let gotJoined = false;
    net.on('joined', (d) => { if (d && d.hello) gotJoined = true; });
    net.on('latency', (ms) => resolve({ gotJoined, latency: ms }));
    net.on('status', (s) => { if (s.state === 'online') net.connect(); });
    net.connect(good);
    setTimeout(() => resolve({ gotJoined, latency: -1 }), 12000);
  }), GOOD);
  ok(res.gotJoined === true, '收到服务端 hello', String(res.gotJoined));
  ok(res.latency >= 0, 'ping/pong 心跳可测延迟', String(res.latency));
  await page.close();
}

await browser.close();
await new Promise((r) => srv.close(r));
await new Promise((r) => wss.close(r));

console.log('');
console.log('========================================');
console.log('联机故障转移验收：' + pass + '/' + (pass + fail) + ' 通过' + (fail ? ' · ✗ ' + fail : ' · 全绿'));
console.log('========================================');
process.exit(fail ? 1 : 0);
