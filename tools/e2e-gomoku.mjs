/* 五子棋实测：落子、AI 应手、连五获胜、悔棋、难度 */
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

await page.goto(BASE + '/games/gomoku/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

console.log('\nA. 页面');
ok('标题正确', (await page.title()).includes('五子棋'));
const cb = await page.locator('#chess').boundingBox();
ok('棋盘有尺寸', cb.width > 200, `${Math.round(cb.width)}x${Math.round(cb.height)}`);
ok('有难度选择', (await page.locator('#diff option').count()) === 3);
ok('有悔棋按钮', await page.locator('#btn-undo').isVisible());
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/gomoku/gomoku-start.png' });

console.log('\nB. 落子（真实点击）');
await page.evaluate(() => window.GOMOKU.reset());
/* 走真实点击：探针调 place() 不会触发 AI（AI 挂在 canvas 的 click 上） */
const cb2 = await page.locator('#chess').boundingBox();
const scale = cb2.width / 534;   /* 画布逻辑宽 534 = 15*34 + 22*2 */
const toPage = (gx, gy) => ({
  x: cb2.x + (22 + gx * 34) * scale,
  y: cb2.y + (22 + gy * 34) * scale
});
let pt = toPage(7, 7);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(200);
const p1 = await page.evaluate(() => window.GOMOKU.state());
ok('落子成功', p1.moves === 1, JSON.stringify(p1));
ok('轮到电脑', p1.turn === 2, String(p1.turn));

console.log('\nC. AI 应手');
await page.waitForTimeout(1000);
const p2 = await page.evaluate(() => window.GOMOKU.state());
ok('电脑应了一手', p2.moves === 2, 'moves=' + p2.moves);
ok('又轮到玩家', p2.turn === 1, String(p2.turn));

console.log('\nD. 连五获胜');
const win = await page.evaluate(() => {
  window.GOMOKU.reset();
  /* 玩家黑棋连五：(0,0)(1,0)(2,0)(3,0)(4,0) */
  window.GOMOKU.place(0, 0, 1);
  window.GOMOKU.place(1, 0, 1);
  window.GOMOKU.place(2, 0, 1);
  window.GOMOKU.place(3, 0, 1);
  const before = window.GOMOKU.state();
  window.GOMOKU.place(4, 0, 1);
  return { before, after: window.GOMOKU.state(), status: document.getElementById('status').textContent };
});
ok('连五后分出胜负', win.after.over === true, JSON.stringify(win.after));
ok('胜负连线被记录', win.after.win >= 5, 'win=' + win.after.win);
ok('有结果文案', win.status.includes('赢'), win.status);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/gomoku/gomoku-win.png' });

console.log('\nE. 悔棋');
await page.evaluate(() => window.GOMOKU.reset());
pt = toPage(5, 5);
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(1000);      /* 等 AI 走完 */
const uBefore = await page.evaluate(() => window.GOMOKU.state());
await page.click('#btn-undo');
await page.waitForTimeout(150);
const undo = { before: uBefore, after: await page.evaluate(() => window.GOMOKU.state()) };
ok('悔棋撤回两步', undo.after.moves === 0, `前 ${undo.before.moves} → 后 ${undo.after.moves}`);
ok('悔棋后轮次归位', undo.after.turn === 1, String(undo.after.turn));

console.log('\nF. 难度切换');
await page.selectOption('#diff', 'hard');
await page.waitForTimeout(200);
ok('难度可切', (await page.locator('#diff').inputValue()) === 'hard');

console.log('\nG. AI 难度行为（困难应会封堵/进攻）');
const ai = await page.evaluate(() => {
  window.GOMOKU.reset();
  /* 摆一个玩家快连五的威胁，AI（困难）应优先封 */
  const b = window.GOMOKU.board();
  window.GOMOKU.place(0, 0, 1);
  window.GOMOKU.place(1, 0, 1);
  window.GOMOKU.place(2, 0, 1);
  window.GOMOKU.place(3, 0, 1);
  window.GOMOKU.aiMove();
  const g = window.GOMOKU.board();
  /* AI 落点是否在玩家的连线上（封堵） */
  let blocked = false;
  for (let x = 0; x < 15; x++) if (g[0][x] === 2) blocked = true;
  return { blocked, g: JSON.stringify(g[0]) };
});
ok('AI 会封堵玩家的连五', ai.blocked, ai.g);

console.log('\nH. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
