/* ============================================================
 * tools/e8-block3.mjs —— 第八批块③专项验收（统一弹窗 + 加载容错）
 * 用法：
 *   node tools/e8-block3.mjs
 * 依赖：本地 node server/index.js（8787）
 * 产出：内容加厚核验/e8/block3-*.png + 逐项断言
 * 覆盖：WHModal 三件套 / 焦点与键盘 / 正常门 / 404 / error+重试 /
 *       12s 超时 / destroy 无残留 / 同源 iframe alert 与 confirm 桥接 /
 *       桌面与手机尺寸不裁切 / 控制台 0 报错
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '内容加厚核验', 'e8');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { name: 'desktop', w: 1920, h: 1080 };
const PHONE = { name: 'phone', w: 390, h: 844 };

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

let checks = 0, fails = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

async function openHall(size) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.WHModal && window.SceneManager && window.SceneManager.has('iframe'), null, { timeout: 10000 });
  return { ctx, page, errors };
}
async function enter(page, title, src, ratio) {
  await page.evaluate((p) => window.SceneManager.change('iframe', p), { title, src, ratio: ratio || '16/9' });
}
async function waitFrame(page) {
  await page.waitForFunction(() => {
    const f = document.querySelector('.iframe-scene');
    return f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.readyState === 'complete';
  }, null, { timeout: 12000 });
}

/* ---------------- A. WHModal 三件套与键盘语义 ---------------- */
section('A. WHModal 三件套 / 焦点 / 键盘（桌面）');
{
  const { ctx, page, errors } = await openHall(DESKTOP);

  const api = await page.evaluate(() => Object.keys(window.WHModal).filter((k) => ['alert', 'confirm', 'prompt'].includes(k)));
  ok(api.length === 3, 'WHModal 暴露 alert/confirm/prompt');

  /* alert + 焦点归还 */
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.id = '__focusProbe'; document.body.appendChild(b); b.focus();
    window.__p = window.WHModal.alert({ title: '测试标题', message: '测试内容' });
  });
  await page.waitForSelector('.wh-modal-ov');
  const alertTxt = await page.textContent('.wh-modal-card');
  ok(alertTxt.includes('测试标题') && alertTxt.includes('测试内容'), 'alert 标题与文案');
  await page.click('.wh-modal-btn.primary');
  await page.waitForFunction(() => !document.querySelector('.wh-modal-ov'));
  ok(await page.evaluate(() => window.__p instanceof Promise), 'alert 返回 Promise');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === '__focusProbe'), '关闭后焦点归还');
  await page.evaluate(() => document.getElementById('__focusProbe').remove());

  /* confirm：取消 / 确定 */
  await page.evaluate(() => { window.__c1 = window.WHModal.confirm({ title: '确认', message: '确定吗', okText: '好的', cancelText: '算了' }); });
  await page.waitForSelector('.wh-modal-ov');
  await page.click('.wh-modal-btn:not(.primary)');
  ok((await page.evaluate(() => window.__c1)) === false, 'confirm 取消返回 false');

  await page.evaluate(() => { window.__c2 = window.WHModal.confirm({ title: '确认', message: '确定吗', danger: true, okText: '删除' }); });
  await page.waitForSelector('.wh-modal-ov');
  ok(await page.locator('.wh-modal-btn.danger').count() === 1, 'danger 按钮样式');
  await page.click('.wh-modal-btn.danger');
  ok((await page.evaluate(() => window.__c2)) === true, 'confirm 确定返回 true');

  /* prompt：提交 / 取消 */
  await page.evaluate(() => { window.__pr1 = window.WHModal.prompt({ title: '输入', label: '名字', defaultValue: '露娜' }); });
  await page.waitForSelector('.wh-modal-input');
  ok((await page.inputValue('.wh-modal-input')) === '露娜', 'prompt 默认值');
  await page.fill('.wh-modal-input', '小咪');
  await page.click('.wh-modal-btn.primary');
  ok((await page.evaluate(() => window.__pr1)) === '小咪', 'prompt 提交返回文本');

  await page.evaluate(() => { window.__pr2 = window.WHModal.prompt({ message: '再输一次' }); });
  await page.waitForSelector('.wh-modal-input');
  await page.click('.wh-modal-btn:not(.primary)');
  ok((await page.evaluate(() => window.__pr2)) === null, 'prompt 取消返回 null（修复旧 bug）');

  /* Esc：alert 可关，prompt 不误关 */
  await page.evaluate(() => { window.__e1 = window.WHModal.alert({ message: 'esc test' }); });
  await page.waitForSelector('.wh-modal-ov');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.wh-modal-ov'));
  ok(true, 'Esc 关闭 alert');

  await page.evaluate(() => { window.__e2 = window.WHModal.prompt({ message: 'prompt esc' }); });
  await page.waitForSelector('.wh-modal-input');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(await page.locator('.wh-modal-ov').count() === 1, 'prompt 下 Esc 不误关');
  await page.evaluate(() => document.querySelector('.wh-modal-btn:not(.primary)').click());

  /* Tab 圈定 */
  await page.evaluate(() => { window.__tab = window.WHModal.confirm({ message: 'tab trap' }); });
  await page.waitForSelector('.wh-modal-ov');
  await page.keyboard.press('Tab');
  ok(await page.evaluate(() => !!document.activeElement.closest('.wh-modal-card')), 'Tab 焦点圈定在弹窗内');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.wh-modal-ov'));

  const real = errors.filter((e) => !e.includes('favicon'));
  ok(real.length === 0, 'A 段控制台 0 报错', real.join(' | '));
  await ctx.close();
}

/* ---------------- B. 加载状态机 ---------------- */
section('B. 加载状态机：正常 / 404 / error+重试 / 12s 超时 / 无残留');
{
  const { ctx, page, errors } = await openHall(DESKTOP);

  /* 正常门：快速加载完也应稳定在 loaded（骨架一闪而过属正常） */
  await enter(page, 'tetris', 'games/tetris/index.html', '16/9');
  await waitFrame(page);
  await page.waitForTimeout(200);
  ok(await page.locator('.iframe-result').count() === 0, '正常门进入 loaded，无结果层');

  /* 404：同源 HEAD 预检分流 */
  await enter(page, 'missing', 'games/__e8_missing__.html', '16/9');
  await page.waitForSelector('.iframe-result', { timeout: 8000 });
  const nf = await page.textContent('.iframe-result-card');
  ok(nf.includes('这里没有内容') && nf.includes('回大厅'), '404 判 notfound 且给回大厅');
  await page.screenshot({ path: path.join(OUT, 'block3-notfound-desktop.png') });
  await page.click('.iframe-result-btn:not(.primary)');
  await page.waitForFunction(() => document.body.dataset.scene === 'world', null, { timeout: 8000 });
  ok(await page.locator('.iframe-fit, .iframe-scene, .iframe-result, .iframe-loading').count() === 0, '404 回大厅后无残留');

  /* error + 重试：首次 abort，重试放行 */
  let abort = true;
  const abortPattern = '**/games/__e8_abort__.html*';
  await page.route(abortPattern, async (route) => {
    if (abort) await route.abort('failed');
    else await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' });
  });
  await enter(page, 'abort', 'games/__e8_abort__.html', '16/9');
  await page.waitForSelector('.iframe-result', { timeout: 8000 });
  const er = await page.textContent('.iframe-result-card');
  ok(er.includes('没能加载出来') && er.includes('重试'), 'error 分流且给重试');
  await page.screenshot({ path: path.join(OUT, 'block3-error-desktop.png') });
  abort = false;
  await page.click('.iframe-result-btn.primary');
  await page.waitForFunction(() => {
    const sc = window.SceneManager.current;
    return sc && sc._state === 'loaded';
  }, null, { timeout: 8000 });
  ok(await page.locator('.iframe-loading, .iframe-result').count() === 0, '重试后回到 loaded');
  await page.unroute(abortPattern);

  /* 12s 超时：慢响应，终态单向不被迟到 load 翻回 */
  const slowPattern = '**/games/__e8_slow__.html*';
  await page.route(slowPattern, async (route) => {
    await new Promise((r) => setTimeout(r, 13000));
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>slow</body></html>' });
  });
  await enter(page, 'slow', 'games/__e8_slow__.html', '16/9');
  await page.waitForSelector('.iframe-result', { timeout: 15000 });
  const to = await page.textContent('.iframe-result-card');
  ok(to.includes('加载时间较长') && to.includes('重试') && to.includes('回大厅'), '12s 超时文案与双按钮');
  await page.screenshot({ path: path.join(OUT, 'block3-timeout-desktop.png') });
  await page.waitForTimeout(1400);   /* 等慢响应迟到，验证终态不回弹 */
  ok(await page.locator('.iframe-result').count() === 1, '迟到 load 不把超时态翻回 loaded');
  await page.unroute(slowPattern);

  /* 连续切门无叠加 */
  await enter(page, 'tetris', 'games/tetris/index.html', '16/9');
  await page.waitForTimeout(700);
  ok(await page.locator('.iframe-result').count() === 0 && await page.locator('.iframe-fit').count() === 1, '反复切门无结果层叠加');

  const real = errors.filter((e) => !e.includes('favicon') && !e.startsWith('console: Failed to load resource'));
  ok(real.length === 0, 'B 段控制台 0 报错', real.join(' | '));
  await ctx.close();
}

/* ---------------- C. 同源 iframe 弹窗桥接 ---------------- */
section('C. 同源 iframe 的 alert / confirm 桥接');
{
  const { ctx, page, errors } = await openHall(DESKTOP);

  await enter(page, 'mine', 'games/mine/index.html', '4/3');
  await waitFrame(page);
  await page.evaluate(() => { document.querySelector('.iframe-scene').contentWindow.alert('桥接测试弹窗'); });
  await page.waitForSelector('.wh-modal-ov', { timeout: 3000 });
  const bt = await page.textContent('.wh-modal-card');
  ok(bt.includes('桥接测试弹窗'), '扫雷所在 iframe 的 alert 走站内弹窗');
  await page.click('.wh-modal-btn.primary');

  await enter(page, 'plane', 'games/brain-gym/index.html?game=plane', '9/16');
  /* 入口壳会 location.replace 到 arcade 分片，等跳完再验桥接 */
  await page.waitForFunction(() => {
    const f = document.querySelector('.iframe-scene');
    return f && f.contentWindow && f.contentWindow.location &&
      f.contentWindow.location.href.includes('arcade/plane') &&
      typeof f.contentWindow.__whConfirm === 'function';
  }, null, { timeout: 12000 });
  const hasBridge = true;
  ok(hasBridge, 'brain-gym 分片含站内确认桥接');
  await page.evaluate(() => { window.__bc = document.querySelector('.iframe-scene').contentWindow.__whConfirm('确认测试'); });
  await page.waitForSelector('.wh-modal-ov', { timeout: 3000 });
  await page.click('.wh-modal-btn:not(.primary)');
  ok((await page.evaluate(() => window.__bc)) === false, 'brain-gym 返回确认取消返回 false');

  const real = errors.filter((e) => !e.includes('favicon'));
  ok(real.length === 0, 'C 段控制台 0 报错', real.join(' | '));
  await ctx.close();
}

/* ---------------- D. 桌面与手机尺寸 ---------------- */
section('D. 弹窗在桌面 / 手机下不裁切，热区 ≥44px');
for (const size of [DESKTOP, PHONE]) {
  const { ctx, page, errors } = await openHall(size);
  await page.evaluate(() => { window.__m = window.WHModal.alert({ title: '尺寸测试', message: '居中检查' }); });
  await page.waitForSelector('.wh-modal-ov');
  const m = await page.evaluate(() => {
    const c = document.querySelector('.wh-modal-card').getBoundingClientRect();
    const b = document.querySelector('.wh-modal-btn').getBoundingClientRect();
    return { left: c.left, right: c.right, top: c.top, bottom: c.bottom, bh: document.querySelector('.wh-modal-btn').offsetHeight, w: innerWidth, h: innerHeight };
  });
  ok(m.left >= 0 && m.right <= m.w && m.top >= 0 && m.bottom <= m.h, size.name + ' 弹窗不裁切');
  ok(m.bh >= 44, size.name + ' 按钮热区 ≥44', String(m.bh));
  await page.screenshot({ path: path.join(OUT, 'block3-modal-' + size.name + '.png') });
  await page.click('.wh-modal-btn.primary');
  ok(await page.locator('.wh-modal-ov').count() === 0, size.name + ' 关闭后遮罩不残留');
  const real = errors.filter((e) => !e.includes('favicon'));
  ok(real.length === 0, size.name + ' 控制台 0 报错', real.join(' | '));
  await ctx.close();
}

await browser.close();
console.log('\n[块③验收] ' + (checks - fails) + '/' + checks + ' 通过' + (fails ? '，失败 ' + fails : '，全绿'));
process.exit(fails ? 1 : 0);
