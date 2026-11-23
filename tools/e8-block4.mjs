/* ============================================================
 * tools/e8-block4.mjs —— 第八批④：移动端键盘遮挡验收
 * 用法：node tools/e8-block4.mjs
 * 依赖：本地 node server/index.js（8787）
 * 说明：headless 浏览器弹不出真键盘，用 addInitScript 模拟 visualViewport
 *       （__setKeyboard(kb) 把 vv.height 缩小 kb 并派发 resize），验证上推与复位。
 * 产出：内容加厚核验/e8/block4-*.png + 逐项断言
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

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

/* 模拟 visualViewport：所有 frame 都注入（含同源工具 iframe） */
await ctx.addInitScript(() => {
  const listeners = Object.create(null);
  let vh = window.innerHeight;
  const vv = {
    get height() { return vh; },
    get offsetTop() { return 0; },
    addEventListener(t, fn) { (listeners[t] || (listeners[t] = [])).push(fn); },
    removeEventListener(t, fn) {
      const a = listeners[t]; if (!a) return;
      const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    }
  };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get() { return vv; } });
  window.__setKeyboard = function (kb) {
    vh = window.innerHeight - kb;
    (listeners.resize || []).slice().forEach((fn) => fn({}));
  };
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForFunction(() => window.KeyboardFit && window.SceneManager, null, { timeout: 10000 });

let checks = 0, fails = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
async function enter(id, src, ratio) {
  await page.evaluate((p) => window.SceneManager.change('iframe', p), { title: id, src, ratio: ratio || 'auto' });
  await page.waitForFunction(() => {
    const f = document.querySelector('.iframe-scene');
    return f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.readyState === 'complete';
  }, null, { timeout: 10000 });
  await page.waitForTimeout(250);
}
function frameFor(marker) {
  return page.frames().find((f) => f.url().includes(marker));
}
async function checkDoor(marker, sel, opsSel, label, kb) {
  const fr = frameFor(marker);
  ok(!!fr, label + ' iframe 就绪');
  if (!fr) return;
  const installed = await fr.evaluate(() => !!document.__whKeyboardFit);
  ok(installed, label + ' 键盘适配已安装到该文档');

  await fr.focus(sel);
  await fr.evaluate((k) => window.__setKeyboard(k), kb);
  await page.waitForTimeout(650);

  const m = await fr.evaluate((p) => {
    const el = document.querySelector(p.sel);
    const op = p.ops ? document.querySelector(p.ops) : null;
    const er = el.getBoundingClientRect();
    const or = op ? op.getBoundingClientRect() : null;
    return {
      pad: document.body.style.paddingBottom,
      inTop: Math.round(er.top), inBottom: Math.round(er.bottom),
      opTop: or ? Math.round(or.top) : null, opBottom: or ? Math.round(or.bottom) : null,
      vh: Math.round(window.visualViewport.height),
      scroll: window.scrollY
    };
  }, { sel, ops: opsSel });
  ok(m.pad === kb + 'px', label + ' 底部补白 = 键盘高度', m.pad);
  ok(m.inTop >= 0 && m.inBottom <= m.vh, label + ' 输入框完整可见', JSON.stringify(m));
  if (opsSel) ok(m.opTop >= 0 && m.opBottom <= m.vh, label + ' 相邻操作按钮可见', JSON.stringify(m));
  await page.screenshot({ path: path.join(OUT, 'block4-' + marker.replace(/\W/g, '') + '-keyboard.png') });

  await fr.evaluate(() => window.__setKeyboard(0));
  await page.waitForTimeout(500);
  const after = await fr.evaluate(() => ({ pad: document.body.style.paddingBottom, scroll: window.scrollY }));
  ok(!after.pad, label + ' 收起后补白复位', after.pad);
}

console.log('=== 工具页：键盘弹出 / 收起 ===');
await enter('links', 'tools/links/index.html');
await checkDoor('links', '#url', '#add', '网址区-网址框', 260);
await checkDoor('links', '#search', '#next', '网址区-搜索框', 260);

await enter('board', 'tools/board/index.html');
await checkDoor('board', '#text', '#send', '留言板-textarea', 280);
await checkDoor('board', '#alias', '#refresh', '留言板-署名框', 280);

await enter('timer', 'tools/timer/index.html');
await checkDoor('timer', '#mm', '#toggle', '计时器-分钟输入', 240);

await enter('unit', 'tools/unit/index.html');
await checkDoor('unit', '#num', null, '单位换算-数值输入', 240);

console.log('\n=== 大厅：每日一题 / 设置面板 ===');
await page.evaluate(() => window.SceneManager.change('world'));
await page.waitForTimeout(300);
/* 面板平时隐藏（广场告示牌按 E 才弹），先展开再聚焦 */
await page.evaluate(() => {
  const p = document.getElementById('riddle');
  p.classList.add('on'); p.setAttribute('aria-hidden', 'false');
});
await page.focus('#riddleInput');
await page.evaluate(() => window.__setKeyboard(250));
await page.waitForTimeout(650);
const r = await page.evaluate(() => {
  const el = document.querySelector('#riddleInput').getBoundingClientRect();
  return { pad: document.body.style.paddingBottom, top: Math.round(el.top), bottom: Math.round(el.bottom), vh: Math.round(window.visualViewport.height) };
});
ok(r.pad === '250px', '每日一题：底部补白生效', r.pad);
ok(r.top >= 0 && r.bottom <= r.vh, '每日一题：输入框可见', JSON.stringify(r));
await page.screenshot({ path: path.join(OUT, 'block4-riddle-keyboard.png') });
await page.evaluate(() => window.__setKeyboard(0));
await page.waitForTimeout(500);
ok(!(await page.evaluate(() => document.body.style.paddingBottom)), '每日一题：收起后复位');

console.log('\n=== 桌面端零变化 ===');
{
  const dctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const dp = await dctx.newPage();
  await dp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await dp.waitForFunction(() => window.KeyboardFit);
  const before = await dp.evaluate(() => ({ pad: document.body.style.paddingBottom, y: window.scrollY }));
  await dp.focus('#riddleInput');
  await dp.waitForTimeout(400);
  const after = await dp.evaluate(() => ({ pad: document.body.style.paddingBottom, y: window.scrollY }));
  ok(before.pad === after.pad && before.y === after.y, '桌面聚焦不产生补白或滚动');
  await dctx.close();
}

ok(errors.filter((e) => !e.startsWith('console: Failed to load resource')).length === 0, '控制台 0 报错', errors.join(' | '));
await browser.close();
console.log('\n[块④验收] ' + (checks - fails) + '/' + checks + ' 通过' + (fails ? '，失败 ' + fails : '，全绿'));
process.exit(fails ? 1 : 0);
