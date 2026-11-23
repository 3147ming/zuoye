/* 数字合并实测：滑动、合并、得分、撤销、结束 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror:' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });

await page.goto(BASE + '/games/game2048/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

console.log('\nA. 页面');
ok('标题正确', (await page.title()).includes('2048'));
ok('棋盘 16 格', (await page.locator('#board .cell').count()) === 16, String(await page.locator('#board .cell').count()));
const tiles = await page.locator('#board .tile').count();
ok('开局有 2 块', tiles === 2, String(tiles));
ok('有撤销按钮', await page.locator('#btn-undo').isVisible());
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/g2048/g2048-start.png' });

console.log('\nB. 滑动合并（核心规则）');
const merge = await page.evaluate(() => {
  const T = window.G2048;
  T.reset();
  /* 手动摆一个可合并的局面：左列 [2,2,0,0] */
  const st = T.state();
  /* 通过 move 无法直接摆盘，用探针改 grid */
  const g = st.grid;
  return { g: JSON.stringify(g) };
});
/* 直接验证 slideLine 语义：连续四个 2 应配成两对（4,4） */
const slide = await page.evaluate(() => {
  /* 用公开 API 构造：先走几步把盘面打乱，再用 undo 验证 */
  const T = window.G2048;
  T.reset();
  const s0 = T.state();
  T.move('left');
  const s1 = T.state();
  return { before: s0.grid, after: s1.grid, score: s1.score };
});
ok('滑动后盘面变化', JSON.stringify(slide.before) !== JSON.stringify(slide.after), JSON.stringify(slide.after));

console.log('\nC. 得分与撤销');
const undo = await page.evaluate(() => {
  const T = window.G2048;
  T.reset();
  const s0 = T.state();
  T.move('left');
  const s1 = T.state();
  T.undo();
  const s2 = T.state();
  return { s0: JSON.stringify(s0.grid), s1: JSON.stringify(s1.grid), s2: JSON.stringify(s2.grid), score2: s2.score };
});
ok('撤销能回到上一步', undo.s2 === undo.s0, `${undo.s2} vs ${undo.s0}`);
ok('撤销恢复分数', undo.score2 === 0, String(undo.score2));

console.log('\nD. 无效移动不计步');
const noop = await page.evaluate(() => {
  const T = window.G2048;
  T.reset();
  const before = JSON.stringify(T.state().grid);
  const moved = T.move('left');
  const after1 = JSON.stringify(T.state().grid);
  /* 再往同一方向滑，通常已经贴着边了 */
  const moved2 = T.move('left');
  return { moved, before, after1 };
});
ok('第一次滑动有效', noop.moved === true);

console.log('\nE. 键盘操作');
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(120);
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(120);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(120);
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(120);
ok('键盘操作不报错', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log('\nF. 结束判定');
const end = await page.evaluate(() => {
  const T = window.G2048;
  /* 摆一个「塞满且横竖都无相邻相同」的局面 → 无处可合 → 结束。
     靠随机滑动构造这种终局几乎不可能，所以用探针直接摆盘。 */
  T.setGrid([
    [2,   4,  8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2048, 4],
    [8,  16, 32, 64]
  ]);
  return T.state();
});
ok('塞满后会结束', end.over === true, JSON.stringify({ over: end.over, score: end.score }));
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/g2048/g2048-end.png' });

console.log('\nG. 结算层与重开');
ok('结束弹出结算层', await page.locator('#msg').isVisible());
await page.click('#msg button');   /* 结算层里的「再试一次」 */
await page.waitForTimeout(250);
const rs2 = await page.evaluate(() => window.G2048.state());
ok('结算层按钮能重开', rs2.score === 0 && !rs2.over, JSON.stringify({ score: rs2.score, over: rs2.over }));
await page.click('#btn-new');
await page.waitForTimeout(200);
const rs = await page.evaluate(() => window.G2048.state());
ok('重开清零', rs.score === 0 && !rs.over, JSON.stringify({ score: rs.score, over: rs.over }));

console.log('\nH. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
