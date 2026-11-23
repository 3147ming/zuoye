/* 联机大厅按需加载核验：
   1) 进大厅时不应下载任何玩法脚本
   2) 进对局时只下载对应那一个
   3) 切换玩法会补下新的、且不重复下旧的 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror:' + e.message.slice(0, 160)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 160)); });

const got = [];
p.on('request', (r) => {
  const u = r.url();
  if (/\/js\/party\/games\.[a-z]+\.js/.test(u)) got.push(u.split('/').pop());
});

await p.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(900);

console.log('\nA. 进大厅不该拉玩法脚本');
ok('一个玩法脚本都没下', got.length === 0, got.join(','));
const reg = await p.evaluate(() => Object.keys((window.PartyKit && window.PartyKit.games) || {}));
ok('PartyKit 里还没有任何玩法', reg.length === 0, JSON.stringify(reg));

console.log('\nB. 直接调 loadGame 拉一个');
const r1 = await p.evaluate(() => window.PartyLobby.loadGame('balloon').then(() => 'ok').catch((e) => 'err:' + e.message));
ok('balloon 加载成功', r1 === 'ok', r1);
await p.waitForTimeout(300);
ok('只下了 balloon 一个', got.length === 1 && got[0] === 'games.balloon.js', got.join(','));

console.log('\nC. 重复调用不重复下载');
await p.evaluate(() => window.PartyLobby.loadGame('balloon'));
await p.waitForTimeout(200);
ok('仍是 1 个请求', got.length === 1, got.join(','));

console.log('\nD. 再拉第二个');
const r2 = await p.evaluate(() => window.PartyLobby.loadGame('fist').then(() => 'ok').catch((e) => 'err:' + e.message));
ok('fist 加载成功', r2 === 'ok', r2);
await p.waitForTimeout(300);
ok('共 2 个请求', got.length === 2, got.join(','));
const reg2 = await p.evaluate(() => Object.keys((window.PartyKit && window.PartyKit.games) || {}).sort());
ok('注册表里有 balloon + fist', reg2.join(',') === 'balloon,fist', JSON.stringify(reg2));

console.log('\nE. 失败路径');
const errsBeforeFail = errs.length;
const r3 = await p.evaluate(() => window.PartyLobby.loadGame('nope').then(() => 'ok').catch((e) => 'err:' + e.message));
ok('不存在的玩法报错而不是卡死', r3.indexOf('err:') === 0, r3);

console.log('\nF. 零报错');
/* E 段故意请求了一个不存在的玩法，必然产生一条 404 资源报错，
   那是我们主动制造并已断言过的失败路径，不算缺陷。
   所以这里只比较「E 段之前」的错误数有没有增加。 */
const newErrs = errs.slice(errsBeforeFail);
ok('E 段之外无报错', errsBeforeFail === 0 && newErrs.every((e) => e.indexOf('404') !== -1),
  errsBeforeFail + ' | ' + newErrs.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
