/* 贪吃蛇实测：移动、吃食增长、撞墙死、穿墙模式、暂停、计分 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror:' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });

await page.goto(BASE + '/games/snake/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

console.log('\nA. 页面');
ok('标题正确', (await page.title()).includes('贪吃蛇'));
const cb = await page.locator('#cv').boundingBox();
ok('画布有尺寸', cb.width > 200, `${Math.round(cb.width)}x${Math.round(cb.height)}`);
ok('有 HUD', (await page.locator('#score').innerText()) === '0');
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/snake/snake-start.png' });

console.log('\nB. 移动');
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const s1 = await page.evaluate(() => window.SNAKE.state());
ok('蛇在动', s1.len === 4, JSON.stringify(s1));

console.log('\nC. 转向');
/* 曾经的坑：e.key 是 'ArrowDown'，代码却拿它和小写 'arrowdown' 比，
   方向键完全失效。这里必须验证「按了方向真的变了」。 */
const turnInfo = await page.evaluate(async () => {
  const st = window.SNAKE;
  st.reset();
  const before = JSON.stringify(st.snake().slice(0, 2));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', bubbles: true }));
  const after = JSON.stringify(st.snake().slice(0, 2));
  return { before, after };
});
ok('方向键真的改变了蛇', turnInfo.before !== turnInfo.after, `${turnInfo.before} → ${turnInfo.after}`);
const turned = await page.evaluate(() => {
  const s = window.SNAKE.snake();
  return s[0].y !== s[1].y;   /* 头尾 y 不同 = 已经竖着走 */
});
ok('方向键让蛇转向', turned);

/* 真实键盘事件同样要生效 */
await page.evaluate(() => window.SNAKE.reset());
const kbBefore = await page.evaluate(() => JSON.stringify(window.SNAKE.snake().slice(0, 2)));
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(500);
const kbAfter = await page.evaluate(() => JSON.stringify(window.SNAKE.snake().slice(0, 2)));
ok('真实键盘事件也生效', kbBefore !== kbAfter, `${kbBefore} → ${kbAfter}`);

console.log('\nD. 不能直接反向');
const noReverse = await page.evaluate(() => {
  window.SNAKE.reset();
  window.SNAKE.setDir(1, 0);
  window.SNAKE.setDir(-1, 0);   /* 反向，应被忽略 */
  return true;
});
await page.waitForTimeout(300);
const stillRight = await page.evaluate(() => {
  const s = window.SNAKE.snake();
  return s[0].x > s[1].x;       /* 仍然向右 */
});
ok('不能 180° 掉头', stillRight);

console.log('\nE. 吃食增长');
const eat = await page.evaluate(async () => {
  window.SNAKE.reset();
  const st = window.SNAKE;
  const f = st.food();
  /* 必须 await 让游戏帧推进 —— 同步循环里一步也走不了 */
  for (let guard = 0; guard < 120; guard++) {
    const cur = st.snake()[0];
    const ff = st.food();
    if (cur.x === ff.x && cur.y === ff.y) break;
    const dx = ff.x - cur.x, dy = ff.y - cur.y;
    if (Math.abs(dx) >= Math.abs(dy)) st.setDir(Math.sign(dx) || 1, 0);
    else st.setDir(0, Math.sign(dy) || 1);
    await new Promise((r) => setTimeout(r, 40));
  }
  return { len: st.state().len, score: st.state().score, food: f, head: st.snake()[0] };
});
ok('吃到果实会变长', eat.len > 4, JSON.stringify(eat));
ok('吃到果实会加分', eat.score >= 10, 'score=' + eat.score);

console.log('\nF. 撞墙结束');
const dead = await page.evaluate(async () => {
  window.SNAKE.reset();
  const st = window.SNAKE;
  st.setDir(1, 0);
  for (let guard = 0; guard < 120 && !st.state().dead; guard++) {
    await new Promise((r) => setTimeout(r, 40));
  }
  return st.state();
});
ok('会撞墙结束', dead.dead === true, JSON.stringify(dead));
ok('结束有弹层', await page.locator('#msg').isVisible());
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/snake/snake-dead.png' });

console.log('\nG. 穿墙模式');
const wrap = await page.evaluate(async () => {
  window.SNAKE.reset();
  document.getElementById('btn-wrap').click();
  const st = window.SNAKE;
  st.setDir(1, 0);
  for (let guard = 0; guard < 120; guard++) {
    await new Promise((r) => setTimeout(r, 40));
    if (st.snake()[0].x < 3) break;      /* 已经从另一侧绕回来了 */
  }
  return { st: st.state(), head: st.snake()[0] };
});
ok('穿墙开启后不会死', wrap.st.dead === false, JSON.stringify(wrap));
ok('从另一侧出来', wrap.head.x < 3, 'x=' + wrap.head.x);

console.log('\nH. 暂停与重开');
/* 上一步撞墙后弹层还开着，先用它自己的按钮重开（顺便验证弹层按钮有效） */
await page.click('#msg button');
await page.waitForTimeout(300);
ok('弹层按钮能重开', !(await page.evaluate(() => window.SNAKE.state())).dead);
await page.click('#btn-new');
await page.waitForTimeout(300);
await page.keyboard.press(' ');
await page.waitForTimeout(250);
const ps = await page.evaluate(() => window.SNAKE.state());
ok('能暂停', ps.paused === true, JSON.stringify(ps));
await page.keyboard.press('r');
await page.waitForTimeout(200);
const rs = await page.evaluate(() => window.SNAKE.state());
ok('重开清零', rs.score === 0 && !rs.dead, JSON.stringify(rs));

console.log('\nI. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
