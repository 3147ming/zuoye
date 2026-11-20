/* ============================================================
 * tools/e2e-dandandao.mjs —— 单机「弹弹岛」端到端回归
 * ------------------------------------------------------------
 * 自包含：脚本自己起一个静态服务器，不依赖外部服务。
 * 覆盖：菜单解锁 → 键盘/拖拽瞄准 → 真炮弹命中 → 敌我回合轮换 →
 *       通关解锁下一关 → 重来重置 → 手机竖屏布局 → 全程零报错。
 *
 *   node tools/e2e-dandandao.mjs
 * ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_PATH = '/games/dandandao/index.html';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('页面异常：' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('控制台：' + m.text()); });
const snap = () => page.evaluate(() => ({
  phase: WH_DANDADAO.phase, level: WH_DANDADAO.level, turn: WH_DANDADAO.turn,
  wind: WH_DANDADAO.wind, hp: WH_DANDADAO.hp, foes: WH_DANDADAO.foes, shots: WH_DANDADAO.shots
}));
async function waitPhase(list, ms) {
  await page.waitForFunction((p) => p.indexOf(window.WH_DANDADAO.phase) >= 0, list, { timeout: ms || 20000 });
  return snap();
}

try {
  await page.goto(BASE + URL_PATH, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  console.log('\nA. 菜单与解锁');
  ok('标题与六关都在', (await page.locator('#levels .lv').count()) === 6);
  ok('只有第一关可点', (await page.locator('#levels .lv:not(.lock)').count()) === 1);
  ok('初始 phase=menu', (await snap()).phase === 'menu');
  const box = await page.locator('#box').boundingBox();
  ok('菜单弹层在视口内', !!box && box.x >= 0 && box.y >= 0 && box.width <= 1280 && box.height <= 720);

  console.log('\nB. 进第一关');
  await page.click('#levels .lv:first-child');
  await page.waitForTimeout(250);
  let s = await snap();
  ok('phase=aim', s.phase === 'aim', s.phase);
  ok('满血 100', s.hp === 100, String(s.hp));
  ok('一个敌人', s.foes.length === 1 && s.foes[0].alive);
  ok('风力在关卡上限内', Math.abs(s.wind) <= 20 + 0.01, String(s.wind));
  ok('菜单已关闭', !(await page.locator('#ov').evaluate((e) => e.classList.contains('on'))));

  console.log('\nC. 键盘瞄准与换弹');
  const a0 = parseFloat(await page.locator('#ang').innerText());
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(280); await page.keyboard.up('ArrowUp');
  const a1 = parseFloat(await page.locator('#ang').innerText());
  ok('↑ 增大角度', a1 > a0 + 3, a0 + '→' + a1);
  const p0 = parseFloat(await page.locator('#pow').innerText());
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(220); await page.keyboard.up('ArrowRight');
  const p1 = parseFloat(await page.locator('#pow').innerText());
  ok('→ 增大力度', p1 > p0 + 2, p0 + '→' + p1);
  await page.keyboard.press('3');
  ok('数字键切到重弹', (await page.locator('.wp.sel').getAttribute('data-w')) === '2');
  await page.keyboard.press('1');
  ok('数字键切回标准弹', (await page.locator('.wp.sel').getAttribute('data-w')) === '0');

  console.log('\nD. 拖拽开火、回合轮换与弹药');
  /* 故意往右下拖：低平弹打不到远处敌人，保证后面几段不会被提前通关跳过 */
  const cvBox = await page.locator('#cv').boundingBox();
  const sx = cvBox.x + cvBox.width * (170 / 1280), sy = cvBox.y + cvBox.height * (460 / 720);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 130, sy + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  ok('拖拽松手即开火', (await snap()).shots > 0);
  s = await waitPhase(['aim', 'win', 'lose'], 25000);
  ok('回合顺利走完没卡死', s.phase === 'aim', s.phase);
  ok('进入第 2 回合', s.turn >= 2, String(s.turn));
  await page.keyboard.press('2');
  const ammoBefore = Number(await page.locator('#a1').innerText());
  await page.click('#fire');
  await page.waitForTimeout(120);
  const ammoAfter = Number(await page.locator('#a1').innerText());
  ok('三连散消耗一发弹药', ammoAfter === ammoBefore - 1, ammoBefore + '→' + ammoAfter);
  s = await waitPhase(['aim', 'win', 'lose'], 25000);
  ok('特殊弹药不每回合回满', Number(await page.locator('#a1').innerText()) === ammoAfter);

  console.log('\nE. 真炮弹命中与地形破坏');
  /* 前面几发可能已把敌人打伤，固定重开一局再测命中，避免状态串味 */
  await page.evaluate(() => WH_DANDADAO.start(0));
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({ hp: WH_DANDADAO.foes[0].hp, y: WH_DANDADAO.foes[0].y }));
  const sol = await page.evaluate(() => WH_DANDADAO.suggest());
  ok('能算出接近的解', !!sol && sol.miss < 60, sol && String(sol.miss));
  await page.evaluate((v) => WH_DANDADAO.aim(v.a, v.p), sol);
  await page.click('#fire');
  await page.waitForTimeout(120);
  ok('炮弹已生成', (await snap()).shots > 0);
  let landed = true;
  try {
    await page.waitForFunction((b) => {
      const f = WH_DANDADAO.foes[0];
      return f.hp < b.hp - 5 || f.y > b.y + 10;
    }, before, { timeout: 8000 });
  } catch (e) { landed = false; }
  const after = await page.evaluate(() => ({ hp: WH_DANDADAO.foes[0].hp, y: WH_DANDADAO.foes[0].y }));
  ok('敌人掉血或塌方位移', landed, JSON.stringify({ before, after }));
  const holed = await page.evaluate(() => !WH_DANDADAO.solid(1070, 440) || !WH_DANDADAO.solid(1070, 450));
  ok('岛顶被炸出缺口', holed);

  console.log('\nG. 通关与解锁');
  s = await waitPhase(['aim', 'win', 'lose'], 25000);
  await page.click('.wp[data-w="0"]');   /* 特殊弹药现在是整关总量，通关回归统一用无限的标准弹 */
  for (let i = 0; i < 14 && (await snap()).phase === 'aim'; i++) {
    const v = await page.evaluate(() => WH_DANDADAO.suggest());
    if (!v) break;
    await page.evaluate((x) => WH_DANDADAO.aim(x.a, x.p), v);
    await page.click('#fire');
    await waitPhase(['aim', 'win', 'lose'], 25000);
  }
  s = await snap();
  ok('第一关能打通', s.phase === 'win', s.phase + ' hp=' + s.hp);
  await page.waitForFunction(() => document.getElementById('box').innerText.indexOf('拿下了') >= 0,
                             null, { timeout: 4000 });
  ok('过关弹层出现', true);
  const unlocked = await page.evaluate(() => JSON.parse(localStorage.getItem('worldhub.dandandao.save')).unlocked);
  ok('解锁第二关并已存档', unlocked >= 2, String(unlocked));
  await page.click('#backMenu');
  await page.waitForTimeout(120);
  ok('关卡页显示两关可选', (await page.locator('#levels .lv:not(.lock)').count()) >= 2);

  console.log('\nH. 重来重置');
  await page.evaluate(() => WH_DANDADAO.start(0));
  await page.waitForTimeout(150);
  s = await snap();
  ok('重来后满血', s.hp === 100, String(s.hp));
  ok('重来后回合归 1', s.turn === 1, String(s.turn));
  ok('重来后敌人复活', s.foes.length === 1 && s.foes[0].hp === 60);

  console.log('\nI. 后几关敌人走位与 AI 不自伤');
  await page.evaluate(() => WH_DANDADAO.start(2));
  await page.waitForTimeout(200);
  let x0 = (await snap()).foes[0].x, moved = false;
  for (let r = 0; r < 2 && !moved; r++) {
    await page.evaluate(() => WH_DANDADAO.aim(12, 0.32));
    await page.click('#fire');
    s = await waitPhase(['aim', 'win', 'lose'], 25000);
    const x1 = (await snap()).foes[0].x;
    if (Math.abs(x1 - x0) > 8) moved = true;
    x0 = x1;
    if (s.phase !== 'aim') break;
  }
  ok('第三关敌人会挪窝', moved);
  ok('敌人没把自己炸死', (await snap()).foes[0].alive, JSON.stringify((await snap()).foes[0]));

  console.log('\nJ. 手机竖屏');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('手机页面异常：' + e.message));
  await mp.goto(BASE + URL_PATH, { waitUntil: 'load' });
  await mp.waitForTimeout(250);
  const appBox = await mp.locator('#app').boundingBox();
  ok('画布不超出屏宽', appBox.width <= 391, String(appBox.width));
  ok('画布按 16:9 装裱', Math.abs(appBox.width / appBox.height - 16 / 9) < 0.02,
     (appBox.width / appBox.height).toFixed(3));
  const fireBox = await mp.locator('#fire').boundingBox();
  ok('开火按钮在首屏内', !!fireBox && fireBox.y + fireBox.height <= 844);
  ok('竖屏出现横屏入口', await mp.locator('#rotate').isVisible());
  const rotBox = await mp.locator('#rotBtn').boundingBox();
  ok('横屏入口不遮挡画布', rotBox.y >= appBox.y + appBox.height - 1,
     JSON.stringify({ btn: rotBox.y, canvasBottom: appBox.y + appBox.height }));
  const hitRot = await mp.evaluate((b) => {
    const node = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return !!node && (node.id === 'rotBtn' || !!node.closest('#rotate'));
  }, rotBox);
  ok('横屏按钮真的可点（没被父级裁掉）', hitRot);
  await mp.tap('#levels .lv:first-child');
  await mp.waitForTimeout(200);
  ok('手机能进关', (await mp.evaluate(() => WH_DANDADAO.phase)) === 'aim');
  await m.close();

  console.log('\nK. 运行期报错');
  ok('全程零报错', errors.length === 0, errors.join(' | '));
} catch (e) {
  fails.push('脚本中断：' + (e && e.stack || e));
  console.log('\n脚本中断：', e);
} finally {
  await browser.close();
  server.close();
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exitCode = 1; }
