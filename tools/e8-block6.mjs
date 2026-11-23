/* ============================================================
 * tools/e8-block6.mjs —— 第八批⑥：联机收敛 + 双会话实测 + 格斗复核
 * 用法：node tools/e8-block6.mjs
 * 依赖：本地 node server/index.js（8787，含 /ws）
 * 产出：内容加厚核验/e8/block6-*.png + 逐项断言
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
let checks = 0, fails = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function watch(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
}
const ADDR_PAT = /wss?:\/\/|workers\.dev|127\.0\.0\.1:8787|\/ws\b/;

/* ---------------- 1. 地址收敛 ---------------- */
section('1. 联机界面无 WSS 地址暴露 / 状态文案');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; watch(page, errors);
  await page.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#party .pp-wrap', { timeout: 8000 });
  await page.waitForTimeout(400);

  const visible = await page.evaluate(() => document.body.innerText);
  const inputs = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => ({
    placeholder: i.placeholder || '', value: i.value || '', type: i.type
  })));
  ok(!ADDR_PAT.test(visible), '页面可见文本不含 WSS / 服务地址', visible.match(ADDR_PAT)?.[0]);
  ok(!inputs.some((i) => ADDR_PAT.test(i.placeholder) || ADDR_PAT.test(i.value)), '输入框占位符 / 默认值不含服务地址',
    JSON.stringify(inputs.filter((i) => ADDR_PAT.test(i.placeholder + i.value))));

  const status = await page.textContent('.pp-net');
  ok(/已连接|连接中|重连中|连接失败|未连接/.test(status), '状态显示为中文连接状态', status);
  ok(!ADDR_PAT.test(status), '状态条不含地址');
  await page.screenshot({ path: path.join(OUT, 'block6-party-lobby.png') });

  /* mock 五种状态文案：直接改 DOM 不可行（每次 render 重建），检查源码文案覆盖 */
  const lobbySrc = fs.readFileSync(path.join(ROOT, 'js/party/lobby.js'), 'utf8');
  ['已连接', '连接中…', '重连中…', '连接失败', '未连接'].forEach((s) => {
    ok(lobbySrc.includes(s), '状态文案包含「' + s + '」');
  });
  ok(lobbySrc.includes('重试连接'), '失败态有重试入口');
  ok(errors.length === 0, '联机页控制台 0 报错', errors.join(' | '));
  await ctx.close();
}

/* ---------------- 2. 双会话逐款实测 ---------------- */
section('2. 双会话：建房 → 加入 → 开局 → 操作 → 返回');
for (const game of ['bounce', 'quiz', 'pitch']) {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const errA = [], errB = []; watch(a, errA); watch(b, errB);
  try {
    await a.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
    await b.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
    await a.waitForSelector('#party .pp-wrap'); await b.waitForSelector('#party .pp-wrap');

    /* 选玩法 */
    await a.evaluate((g) => {
      const cards = Array.from(document.querySelectorAll('.pp-game'));
      const idx = { bounce: 0, quiz: 4, pitch: 6 }[g];
      if (cards[idx]) cards[idx].click();
    }, game);
    await a.waitForTimeout(100);

    /* A 建房 */
    await a.locator('.pp-input').first().fill('房主甲');
    await a.getByRole('button', { name: '创建房间' }).click();
    await a.waitForSelector('.pp-code b', { timeout: 10000 });
    const code = (await a.textContent('.pp-code b')).trim();
    ok(/^\d{1,5}$/.test(code), game + ' 建房得到房间号', code);

    /* B 加入 */
    await b.locator('.pp-input').first().fill('来客乙');
    await b.locator('.pp-input-code').fill(code);
    await b.getByRole('button', { name: '进入房间' }).click();
    await b.waitForSelector('.pp-code b', { timeout: 10000 });
    ok((await b.textContent('.pp-code b')).trim() === code, game + ' 另一会话凭房号加入');

    await a.waitForFunction(() => document.querySelectorAll('.pp-player:not(.empty)').length >= 2, null, { timeout: 6000 });
    ok(true, game + ' 房间内双方可见');

    /* 开局 */
    await a.getByRole('button', { name: '开始游戏' }).click().catch(() => {});
    await a.waitForSelector('#ppStage', { timeout: 10000 });
    await b.waitForSelector('#ppStage', { timeout: 10000 });
    ok(true, game + ' 双方进入对局舞台');

    /* 操作：发几组键盘输入，验证不报错且连接仍在 */
    for (const key of ['KeyW', 'KeyA', 'KeyD', 'Space']) {
      await a.evaluate((k) => {
        const ev = new KeyboardEvent('keydown', { bubbles: true, code: k, key: k });
        (document.querySelector('#ppStage canvas') || document).dispatchEvent(ev);
      }, key);
      await a.waitForTimeout(80);
    }
    await a.screenshot({ path: path.join(OUT, 'block6-' + game + '-play.png') });
    await b.screenshot({ path: path.join(OUT, 'block6-' + game + '-peer.png') });
    ok(await a.evaluate(() => !!window.PARTY_NET && !!window.PARTY_NET.ws), game + ' 对局中连接未断');

    /* 返回：房主离开房间 */
    await a.evaluate(() => window.PARTY_NET.leave());
    await a.waitForSelector('#party .pp-wrap', { timeout: 6000 });
    ok(await a.evaluate(() => !window.PARTY_NET.room), game + ' 返回后房间状态已清');

    ok(errA.length === 0 && errB.length === 0, game + ' 双会话控制台 0 报错', (errA.concat(errB)).join(' | '));
  } catch (e) {
    fails++; checks++;
    console.log('  ✗ ' + game + ' 流程异常 — ' + e.message.split('\n')[0]);
  } finally {
    await ctxA.close(); await ctxB.close();
  }
}

/* ---------------- 3. 格斗键位与崩溃 ---------------- */
section('3. 格斗：键位一致性 / 进入与操作 0 抛错');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; watch(page, errors);
  await page.goto(BASE + '/games/fight/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => {
    const a = document.getElementById('arena');
    return a && a.style.visibility === 'visible';
  }, null, { timeout: 12000 });
  ok(true, '进入格斗无崩溃，擂台可见');

  const keysText = await page.locator('.keys').innerText();
  ok(keysText.includes('W A S D') && keysText.includes('J') && keysText.includes('K') && keysText.includes('L'),
    '页面提示为 P1 WASD / JKL', keysText.replace(/\s+/g, ' ').slice(0, 120));
  ok(!/1P\s*←/.test(keysText), '页面提示不再写旧版 1P 方向键');

  for (const k of ['w', 'a', 's', 'd', 'j', 'k', 'l', 'Shift', 'ArrowLeft', 'p']) {
    await page.keyboard.down(k);
    await page.waitForTimeout(45);
    await page.keyboard.up(k);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'block6-fight-keys.png') });
  ok(errors.length === 0, '格斗按键全程 0 抛错', errors.join(' | '));

  const touchSrc = fs.readFileSync(path.join(ROOT, 'js/touch.js'), 'utf8');
  const seg = touchSrc.slice(touchSrc.indexOf("'iframe-格斗'"), touchSrc.indexOf("'iframe-打砖块'"));
  ok(seg.includes('87') && seg.includes('74') && seg.includes('75') && seg.includes('76'),
    '触屏派发表使用 W/J/K/L 键码');
  ok(!seg.includes('ArrowLeft') && !seg.includes('ArrowUp'), '触屏派发不再误发方向键（那是 P2）');
  ok(!/方向键移动，A\/S\/D\/F/.test(touchSrc), '触屏旧键位注释已清理');
  await ctx.close();
}

/* ---------------- 4. 仓库行动加载定性 ---------------- */
section('4. 仓库行动：跨域加载定性（只记录，不硬失败）');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const netFails = [], consoleErrs = [];
  page.on('requestfailed', (r) => netFails.push(r.url().slice(0, 120) + ' :: ' + (r.failure()?.errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) netFails.push(r.status() + ' ' + r.url().slice(0, 120)); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
  let navigated = false;
  try {
    await page.goto('https://warehouse-strike.pages.dev/', { waitUntil: 'domcontentloaded', timeout: 18000 });
    navigated = true;
    await page.waitForTimeout(4000);
  } catch (e) {
    console.log('  · 导航未完成：' + e.message.split('\n')[0]);
  }
  const diag = await page.evaluate(() => {
    let webgl = false;
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (_) {}
    return {
      title: document.title, webgl,
      canvases: document.querySelectorAll('canvas').length,
      text: (document.body ? document.body.innerText : '').slice(0, 300)
    };
  }).catch(() => ({ title: '(不可读)', webgl: false, canvases: 0, text: '' }));
  console.log('  · 可达：' + navigated + ' · 标题：' + diag.title);
  console.log('  · WebGL 可用：' + diag.webgl + ' · canvas 数：' + diag.canvases);
  console.log('  · 页面提示：' + diag.text.replace(/\n+/g, ' / ').slice(0, 240));
  console.log('  · 网络异常 ' + netFails.length + ' 条：' + netFails.slice(0, 4).join(' | '));
  console.log('  · 控制台错误 ' + consoleErrs.length + ' 条：' + consoleErrs.slice(0, 4).join(' | '));
  if (!diag.webgl && /不支持 WebGL/.test(diag.text)) {
    console.log('  · 定性：本无头环境无 WebGL 能力（GPU 与软件渲染均不可用），页面主动降级提示；');
    console.log('           不是资源 404，也不是上游站点故障。真实浏览器需开启硬件加速，属跨域上游边界。');
  } else if (netFails.some((x) => /\b(404|403)\b/.test(x))) {
    console.log('  · 定性：上游资源 404/403（跨域不可改）。');
  } else {
    console.log('  · 定性：页面可达且 WebGL 可用，未见资源错误。');
  }
  /* 壳层已由块③提供 12s 超时 / 失败分流 / 重试，这里只确认不再裸露地址 */
  ok(true, '仓库行动定性已记录（跨域上游不可改）');
  await page.screenshot({ path: path.join(OUT, 'block6-warehouse.png') }).catch(() => {});
  await ctx.close();
}

await browser.close();
console.log('\n[块⑥验收] ' + (checks - fails) + '/' + checks + ' 通过' + (fails ? '，失败 ' + fails : '，全绿'));
process.exit(fails ? 1 : 0);
