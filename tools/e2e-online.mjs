/* 线上联机端到端：两个浏览器会话连 zuoye-e0c.pages.dev，建房 → 进房 → 开局
   注意：Worker 走 wss，这里的浏览器会话必须能连 workers.dev。
   若沙箱 DNS 污染（workers.dev 解析到 Facebook IP），用 --probe-meta 模式只校验配置。 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'https://zuoye-e0c.pages.dev';
const probeOnly = process.argv.includes('--probe-meta');

function log(ok, name, extra) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra !== undefined ? '  ' + extra : ''}`);
  return ok;
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (log(!!cond, name, extra)) pass++; else fail++;
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const errs = [];
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => errs.push(`${n}:pageerror:${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${n}:console:${m.text().slice(0, 200)}`); });
}

await A.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
await A.waitForTimeout(600);

console.log('\nA. 页面与配置');
const meta = await A.evaluate(() => {
  const m = document.querySelector('meta[name="wh-net"]');
  return m ? m.content : '';
});
ok('meta 指向 Worker', /^wss:\/\/worldhub-ws\.[a-z0-9]+\.workers\.dev\/ws$/.test(meta), meta);
const ver = await A.evaluate(async () => (await (await fetch('/version.json?t=' + Date.now())).json()).version);
ok('线上版本 1.28.0', ver === '1.28.0', ver);

if (probeOnly) {
  console.log('\n（只校验配置模式，跳过实际连接）');
  ok('无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

console.log('\nB. 连接 Worker 房间服务');
await A.evaluate(() => window.PARTY_NET && window.PARTY_NET.connect());
const stA = await A.waitForFunction(() => {
  const n = window.PARTY_NET;
  return n && (n.state === 'online' || n.state === 'offline') ? n.state : false;
}, null, { timeout: 25000 }).then((h) => h.jsonValue()).catch(() => 'timeout');
ok('会话A 连上 Worker', stA === 'online', stA);
const urlA = await A.evaluate(() => window.PARTY_NET.url);
ok('连的是 Worker 地址', /workers\.dev/.test(urlA || ''), urlA);

if (stA !== 'online') {
  console.log('\n⚠ 连不上 Worker（沙箱 DNS 污染时属预期），配置校验已通过');
  ok('无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

console.log('\nC. 建房与进房');
await A.evaluate(() => window.PARTY_NET.send('create', { game: 'duel', name: '甲', pass: '' }));
const room = await A.waitForFunction(() => {
  const n = window.PARTY_NET;
  return n.code ? { code: n.code, you: n.you } : false;
}, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
ok('建房拿到房号', !!room && /^[1-9]\d{0,4}$/.test(room.code), room && room.code);

await B.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
await B.waitForTimeout(400);
await B.evaluate(() => window.PARTY_NET && window.PARTY_NET.connect());
await B.waitForFunction(() => window.PARTY_NET && window.PARTY_NET.state === 'online', null, { timeout: 25000 }).catch(() => {});
await B.evaluate((c) => window.PARTY_NET.send('join', { code: c, pass: '', name: '乙' }), room.code);
await B.waitForTimeout(2500);

const snap = await B.evaluate(() => {
  const n = window.PARTY_NET;
  return n.room ? { code: n.room.code, n: (n.room.players || []).length, you: n.you } : null;
});
ok('会话B 进房成功', snap && snap.code === room.code, JSON.stringify(snap));
ok('房间里有 2 人', snap && snap.n === 2, snap && String(snap.n));

console.log('\nD. 开局与快照');
await A.evaluate(() => window.PARTY_NET.send('ready', { ready: true }));
await B.evaluate(() => window.PARTY_NET.send('ready', { ready: true }));
await A.waitForTimeout(500);
await A.evaluate(() => window.PARTY_NET.send('start', {}));
const started = await A.waitForFunction(() => {
  const S = window.PARTY_KIT_STATE;
  return S && S.g && S.g.ph ? S.g.ph : false;
}, null, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => null);
ok('对战开起来了', started === 'aim', started);
const hp = await A.evaluate(() => {
  const S = window.PARTY_KIT_STATE;
  return S.g && S.g.p ? S.g.p.map((u) => u[3]) : null;
});
ok('双方都有血量', Array.isArray(hp) && hp.length === 2 && hp.every((h) => h > 0), JSON.stringify(hp));

await A.screenshot({ path: '/workspace/WorldHub/内容加厚核验/online/online-duel.png' });
ok('无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
