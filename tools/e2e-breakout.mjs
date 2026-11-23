/* 打砖块实测：发球、挡板接球、砖块减少、得分、道具、命数、过关 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 860 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror:' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });

await page.goto(BASE + '/games/breakout/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

console.log('\nA. 页面');
ok('标题正确', (await page.title()).includes('打砖块'));
const cb = await page.locator('#cv').boundingBox();
ok('画布有尺寸', cb.width > 300, `${Math.round(cb.width)}x${Math.round(cb.height)}`);
const s0 = await page.evaluate(() => window.BREAKOUT.state());
ok('开局有砖块', s0.bricks > 15, JSON.stringify(s0));
ok('三条命', s0.lives === 3, String(s0.lives));
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/breakout/breakout-start.png' });

console.log('\nB. 挡板移动');
const p0 = await page.evaluate(() => window.BREAKOUT.pad());
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(300);
await page.keyboard.up('ArrowLeft');
const p1 = await page.evaluate(() => window.BREAKOUT.pad());
ok('挡板能左移', p1.x < p0.x, `${Math.round(p0.x)} → ${Math.round(p1.x)}`);
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(500);
await page.keyboard.up('ArrowRight');
const p2 = await page.evaluate(() => window.BREAKOUT.pad());
ok('挡板能右移', p2.x > p1.x, `${Math.round(p1.x)} → ${Math.round(p2.x)}`);

console.log('\nC. 发球');
await page.keyboard.press(' ');
await page.waitForTimeout(300);
const s1 = await page.evaluate(() => window.BREAKOUT.state());
ok('进入游戏状态', s1.state === 'play', JSON.stringify(s1));
const ball = await page.evaluate(() => window.BREAKOUT.balls()[0]);
ok('球有速度', ball && Math.abs(ball.vy) > 10, JSON.stringify(ball));

console.log('\nD. 球能撞掉砖 + 得分');
await page.waitForTimeout(2500);
const s2 = await page.evaluate(() => window.BREAKOUT.state());
ok('砖块减少', s2.bricks < s0.bricks, `${s0.bricks} → ${s2.bricks}`);
ok('分数增加', s2.score > 0, 'score=' + s2.score);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/breakout/breakout-play.png' });

console.log('\nE. 球反弹（不能穿墙）');
const inBounds = await page.evaluate(() => {
  const b = window.BREAKOUT.balls()[0];
  return b ? (b.x >= 0 && b.x <= 720 && b.y >= 0) : false;
});
ok('球还在场内', inBounds);

console.log('\nF. 关卡');
const lv = await page.evaluate(() => {
  window.BREAKOUT.loadLevel(3);
  return window.BREAKOUT.state();
});
ok('能切关卡', lv.level === 4, JSON.stringify(lv));
ok('新关卡有砖', lv.bricks > 10, String(lv.bricks));

console.log('\nG. 重开');
await page.click('#btn-new');
await page.waitForTimeout(300);
const rs = await page.evaluate(() => window.BREAKOUT.state());
ok('重开回到第 1 关', rs.level === 1 && rs.lives === 3 && rs.score === 0, JSON.stringify(rs));

console.log('\nH. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
