/* 番茄钟实测：计时、模式切换、任务、设置校验、周统计、猫 SVG */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 820 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror:' + e.message.slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });

await page.goto(BASE + '/tools/pomodoro/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

console.log('\nA. 页面');
ok('标题正确', (await page.title()).includes('番茄钟'));
ok('有计时显示', (await page.locator('#timerDisplay').innerText()) === '25:00', await page.locator('#timerDisplay').innerText());
ok('猫是 SVG 自绘', (await page.locator('#catBox svg').count()) === 1);
ok('有周统计图', (await page.locator('#weeklyChart .col').count()) === 7);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/pomodoro/pomodoro-start.png' });

console.log('\nB. 计时推进');
await page.click('#btnStart');
await page.waitForTimeout(1600);
const t1 = await page.locator('#timerDisplay').innerText();
ok('时间在倒数', t1 !== '25:00', t1);
const st1 = await page.evaluate(() => window.POMODORO.state());
ok('状态是运行中', st1.running === true, JSON.stringify(st1));

console.log('\nC. 暂停');
await page.click('#btnPause');
await page.waitForTimeout(300);
const st2 = await page.evaluate(() => window.POMODORO.state());
ok('能暂停', st2.running === false);
const t2 = await page.locator('#timerDisplay').innerText();
await page.waitForTimeout(1200);
ok('暂停后不走', (await page.locator('#timerDisplay').innerText()) === t2, t2);

console.log('\nD. 任务清单');
await page.fill('#taskInput', '写代码');
await page.click('#btnAddTask');
await page.waitForTimeout(250);
ok('任务加进去了', (await page.locator('#taskList .task').count()) === 1);
await page.locator('#taskList .task .task-name').first().click();
await page.waitForTimeout(200);
const st3 = await page.evaluate(() => window.POMODORO.state());
ok('任务能置顶为本轮任务', st3.task !== '', JSON.stringify(st3.task));
ok('本轮任务显示出来了', (await page.locator('#activeTaskText').innerText()).includes('写代码'));

console.log('\nE. 设置校验');
await page.click('#btnSettings');
await page.waitForTimeout(200);
ok('设置面板打开', await page.locator('#settingsPanel').isVisible());
await page.fill('#inFocus', '0');
await page.click('#btnApply');
await page.waitForTimeout(200);
ok('非法值有报错', (await page.locator('#settingsError').innerText()).length > 0, await page.locator('#settingsError').innerText());
await page.fill('#inFocus', '30');
await page.fill('#inBreak', '5');
await page.fill('#inLong', '15');
await page.fill('#inGoal', '4');
await page.click('#btnApply');
await page.waitForTimeout(300);
const st4 = await page.evaluate(() => window.POMODORO.state());
ok('合法值能应用', st4.cfg.focus === 30 && st4.cfg.goal === 4, JSON.stringify(st4.cfg));
ok('计时按新时长重置', (await page.locator('#timerDisplay').innerText()) === '30:00', await page.locator('#timerDisplay').innerText());

console.log('\nF. 模式切换与完成一轮');
const fin = await page.evaluate(async () => {
  const P = window.POMODORO;
  P.setMode('focus');
  P.start();
  /* 把剩余时间压到 0.4 秒，验证「专注结束 → 进入短休息」 */
  P.setRemain(0.4);
  await new Promise((r) => setTimeout(r, 900));
  return P.state();
});
ok('专注段结束会切到休息', fin.mode === 'short' || fin.mode === 'long', 'mode=' + fin.mode);
ok('完成一轮进历史', Object.keys(fin.history).length === 1, JSON.stringify(fin.history));

console.log('\nG. 猫状态变化');
const catSvg = await page.locator('#catBox svg').count();
ok('猫还在（SVG 重新生成）', catSvg === 1);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/pomodoro/pomodoro-run.png' });

console.log('\nH. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
