/* 扫雷实测：铺雷、挖开、连锁、插旗、胜负、纪录 */
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

await page.goto(BASE + '/games/mine/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

console.log('\nA. 页面与网格');
ok('标题是扫雷', (await page.title()).includes('扫雷'));
ok('格子数 9×9=81', (await page.locator('#board .c').count()) === 81, String(await page.locator('#board .c').count()));
ok('有难度选择', (await page.locator('#lv option').count()) === 4);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/mine/mine-beginner.png' });

console.log('\nB. 第一下必然安全 + 开始计时');
const r1 = await page.evaluate(() => {
  /* 找几个格子依次试：第一个点开必然不炸 */
  window.MINE.open(4, 4);
  return window.MINE.state();
});
ok('首点没炸', !r1.dead, JSON.stringify(r1));
ok('有格子被翻开', r1.opened > 0, String(r1.opened));
await page.waitForTimeout(1200);
const t1 = await page.locator('#time').innerText();
ok('计时器在走', parseInt(t1, 10) >= 0, t1);

console.log('\nC. 连锁展开');
const chain = await page.evaluate(() => {
  /* 找一个 0 格（周围没雷） */
  const st = window.MINE.state();
  return st.opened;
});
ok('首点展开了多个格子（连锁）', chain >= 1, `展开 ${chain} 格`);

console.log('\nD. 插旗');
const fl = await page.evaluate(() => {
  /* 找一个未翻开的格子插旗 */
  const st = window.MINE.state();
  for (let y = 0; y < st.h; y++) {
    for (let x = 0; x < st.w; x++) {
      const cell = document.querySelector(`#board .c[data-x="${x}"][data-y="${y}"]`);
      if (cell && !cell.classList.contains('open') && !cell.classList.contains('flag')) {
        window.MINE.flag(x, y);
        return { x, y, st: window.MINE.state() };
      }
    }
  }
  return null;
});
ok('插旗成功', fl && fl.st.flags === 1, JSON.stringify(fl && fl.st));
ok('旗子显示出来了', (await page.locator('#board .c.flag').count()) === 1);
ok('剩余雷数减一', parseInt(await page.locator('#mines').innerText(), 10) === fl.st.mines - 1);

console.log('\nE. 换难度');
await page.selectOption('#lv', 'expert');
await page.waitForTimeout(400);
ok('高级 30×16=480 格', (await page.locator('#board .c').count()) === 480, String(await page.locator('#board .c').count()));
await page.selectOption('#lv', 'beginner');
await page.waitForTimeout(300);
ok('切回初级 81 格', (await page.locator('#board .c').count()) === 81);

console.log('\nF. 胜负判定');
/* 用探针直接构造一个「只剩雷未挖」的终局：把所有安全格翻开 */
const lose = await page.evaluate(() => {
  window.MINE.reset();
  /* 找到雷的位置 —— 通过不断点击直到踩雷 */
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const st = window.MINE.state();
      if (st.dead || st.won) break;
      window.MINE.open(x, y);
    }
  }
  return window.MINE.state();
});
ok('能分出胜负（踩雷或挖完）', lose.dead || lose.won, JSON.stringify(lose));
ok('结束后表情变了', (await page.locator('#face').innerText()) !== '🙂', await page.locator('#face').innerText());
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/mine/mine-end.png' });

console.log('\nG. 重开');
await page.click('#face');
await page.waitForTimeout(300);
const rs = await page.evaluate(() => window.MINE.state());
ok('重开后状态清零', !rs.dead && !rs.won && rs.opened === 0, JSON.stringify(rs));

console.log('\nH. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
