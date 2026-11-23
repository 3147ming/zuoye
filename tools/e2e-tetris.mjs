/* 俄罗斯方块实测：方块生成、移动、旋转、消行、计分、结束 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror:' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });

await page.goto(BASE + '/games/tetris/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

console.log('\nA. 页面');
ok('标题正确', (await page.title()).includes('俄罗斯方块'));
const cvBox = await page.locator('#cv').boundingBox();
ok('棋盘有实际尺寸', cvBox.width > 150 && cvBox.height > 300, `${Math.round(cvBox.width)}x${Math.round(cvBox.height)}`);
ok('有下一块预览', await page.locator('#next').isVisible());
ok('HUD 有分数/消行/等级', (await page.locator('#score').innerText()) === '0');
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/tetris/tetris-start.png' });

console.log('\nB. 画布有内容');
const colors = await page.evaluate(() => {
  const c = document.getElementById('cv');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const s = new Set();
  for (let i = 0; i < d.length; i += 4 * 331) s.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
  return s.size;
});
ok('棋盘画了东西（多色）', colors >= 4, `采样 ${colors} 色`);

console.log('\nC. 方向键真实生效（大小写 bug 防线）');
/* 曾经的坑：e.key 是 'ArrowLeft'，代码却拿它和小写 'arrowleft' 比，
   方向键完全失效但测试照样通过。这里必须验证「按了真的动了」。 */
const dirTest = await page.evaluate(async () => {
  const T = window.TETRIS;
  T.reset();
  const before = JSON.stringify(T.current());
  /* 派发真实 KeyboardEvent，走和玩家一样的路径 */
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const afterL = JSON.stringify(T.current());
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
  /* 旋转也测一下 */
  const rotBefore = T.current().rot;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
  return { before, afterL, rotBefore, rotAfter: T.current().rot };
});
ok('方向键会移动当前方块', dirTest.before !== dirTest.afterL, `${dirTest.before} → ${dirTest.afterL}`);
ok('上键会旋转方块', dirTest.rotBefore !== dirTest.rotAfter, `rot ${dirTest.rotBefore} → ${dirTest.rotAfter}`);

/* 真实按键也要生效 */
await page.evaluate(() => window.TETRIS.reset());
const curBefore = await page.evaluate(() => JSON.stringify(window.TETRIS.current()));
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(120);
const curAfter = await page.evaluate(() => JSON.stringify(window.TETRIS.current()));
ok('真实键盘事件也生效', curBefore !== curAfter, `${curBefore} → ${curAfter}`);

console.log('\nC2. 其它操作');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
ok('操作不报错', errs.length === 0, errs.slice(0, 2).join(' | '));

const s1 = await page.evaluate(() => window.TETRIS.state());
ok('状态可读', typeof s1.score === 'number', JSON.stringify(s1));

console.log('\nD. 硬降与消行');
/* 反复硬降，把方块堆起来 */
for (let i = 0; i < 30; i++) {
  await page.keyboard.press(' ');
  await page.waitForTimeout(30);
}
const s2 = await page.evaluate(() => window.TETRIS.state());
ok('硬降能得分', s2.score > 0, 'score=' + s2.score);

console.log('\nE. 消行');
/* 手动填满最底一行再触发消行 */
const cleared = await page.evaluate(async () => {
  const T = window.TETRIS;
  T.reset();
  /* 直接操作 board 填满一行，然后硬降触发检测 */
  const b = T.board();
  for (let x = 0; x < 10; x++) b[19][x] = '#ffffff';
  const before = T.state().lines;
  T.hardDrop();
  await new Promise((r) => setTimeout(r, 60));
  return { before, after: T.state().lines, score: T.state().score };
});
ok('满行被消掉', cleared.after > cleared.before, JSON.stringify(cleared));

console.log('\nF. 结束与重开');
const over = await page.evaluate(async () => {
  const T = window.TETRIS;
  T.reset();
  /* 堆到顶 */
  for (let i = 0; i < 200; i++) T.hardDrop();
  await new Promise((r) => setTimeout(r, 100));
  return T.state();
});
ok('堆满会结束', over.over === true, JSON.stringify(over));
ok('结束有提示', await page.locator('#msg').isVisible());
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/tetris/tetris-over.png' });

await page.keyboard.press('r');
await page.waitForTimeout(200);
const rs = await page.evaluate(() => window.TETRIS.state());
ok('R 重开生效', !rs.over && rs.score === 0, JSON.stringify(rs));

console.log('\nG. 暂停');
await page.keyboard.press('p');
await page.waitForTimeout(150);
ok('能暂停', (await page.evaluate(() => window.TETRIS.state())).paused === true);
await page.keyboard.press('p');

console.log('\nH. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
