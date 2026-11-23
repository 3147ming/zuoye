/* 格斗游戏实测：选角 → 开战 → 出招 → 命中 → 技能 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror:' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text().slice(0, 200)); });

await page.goto(BASE + '/games/fight/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

console.log('\nA. 选角界面');
ok('标题是自研名', (await page.title()).includes('招式格斗'));
ok('有 4 张角色卡', (await page.locator('.pk-card').count()) === 4);
const names = await page.locator('.pk-name').allInnerTexts();
ok('角色名正确', JSON.stringify(names) === JSON.stringify(['面条', '豆芽', '石子', '小火星']), JSON.stringify(names));
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/fight/fight-pick.png' });

console.log('\nB. 选角交互');
await page.locator('.pk-card').nth(2).click();   /* 选石子 */
await page.locator('.pk-card').nth(3).click();   /* 选小火星 */
await page.waitForTimeout(200);
const marked = await page.locator('.pk-card.p1, .pk-card.p2').count();
ok('两张卡被标记', marked >= 2, String(marked));

console.log('\nC. 开战');
await page.locator('.pk-go').first().click();
await page.waitForTimeout(600);
ok('舞台显示', await page.locator('#stage').isVisible());
const st = await page.evaluate(() => window.FightMain.state());
ok('状态是 fight', st === 'fight' || st === 'fightend', st);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/fight/fight-fight.png' });

console.log('\nD. 移动与出招');
const before = await page.evaluate(() => {
  const c = document.getElementById('cv');
  const r = c.getBoundingClientRect();
  /* 采样画布内容：不能是一张白/空图 */
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) {
    seen.add((d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4));
  }
  return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height), colors: seen.size };
});
ok('画布内部分辨率 960x540', before.w === 960 && before.h === 540, JSON.stringify(before));
ok('画布在页面上有实际尺寸', before.cssW > 300 && before.cssH > 150, `${before.cssW}x${before.cssH}`);
ok('画布有实际内容（多色）', before.colors > 8, `采样到 ${before.colors} 种颜色`);

await page.keyboard.down('d');
await page.waitForTimeout(400);
await page.keyboard.up('d');
await page.keyboard.press('j');
await page.waitForTimeout(250);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/fight/fight-punch.png' });

console.log('\nE. 技能与冷却');
await page.keyboard.press('u');
await page.waitForTimeout(300);
await page.screenshot({ path: '/workspace/WorldHub/内容加厚核验/fight/fight-skill.png' });

console.log('\nF. 内部状态自检');
const info = await page.evaluate(() => ({
  rolls: window.FightArena.ROLLS.map((r) => r.id),
  skills: Object.keys(window.FightArena.SKILLS).length,
  hasRender: !!window.FightRender,
  hasMain: !!window.FightMain
}));
ok('4 个角色', info.rolls.length === 4, JSON.stringify(info.rolls));
ok('技能表 14 项', info.skills === 14, String(info.skills));
ok('渲染层就绪', info.hasRender && info.hasMain);

console.log('\nG. 无报错');
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
