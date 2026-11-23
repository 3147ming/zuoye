/* ============================================================
 * tools/e8-block7.mjs —— 第八批⑦：性能懒加载 + P2 细节 + 预置网址验收
 * 用法：node tools/e8-block7.mjs
 * 依赖：本地 node server/index.js（8787）
 * 产出：内容加厚核验/e8/block7-*.png + 逐项断言
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
function newCtx(size) {
  return browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
}
function watch(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
}

/* ---------------- 一、404 兜底页 ---------------- */
console.log('\n=== P2-9：404 主按钮 ===');
{
  const ctx = await newCtx({ w: 390, h: 844 });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE + '/404.html', { waitUntil: 'load', timeout: 10000 });
  ok((await page.textContent('h1')).includes('这条路没有灯'), '保留文艺标题「这条路没有灯」');
  const a = page.locator('a.home');
  ok(await a.count() === 1, '存在 .home 主按钮');
  ok((await a.textContent()).trim() === '回世界大厅', '按钮文案为「回世界大厅」');
  ok(await a.getAttribute('href') === '/', '按钮 href=/');
  const box = await a.boundingBox();
  ok(box && box.height >= 44 && box.width >= 200, '主按钮热区充足（≥44px 高 / ≥200px 宽）', box && JSON.stringify(box));
  const bg = await a.evaluate((el) => getComputedStyle(el).backgroundImage);
  ok(bg && bg.includes('gradient'), '暖金实心渐变背景');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(overflow, '手机竖屏无横向溢出');
  await page.screenshot({ path: path.join(OUT, 'block7-404-mobile.png') });
  ok(errors.length === 0, '404 页控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 二、留言板重复提示 ---------------- */
console.log('\n=== P2-11：留言板重复提示 ===');
{
  const ctx = await newCtx({ w: 1280, h: 800 });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  /* 断网模拟必须在 goto 之前挂上：否则首屏 refresh() 会真发一次 GET /api/board，
     在无 KV 的本地测试服上返回 404，产生与本次改动无关的环境噪音 */
  await page.route('**/api/board**', (r) => r.abort());
  await page.goto(BASE + '/tools/board/index.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(300);
  const modeText = (await page.textContent('#mode')).trim();
  ok(modeText === '离线模式' || modeText === '云端共享', '徽标只表达连接状态', modeText);
  await page.fill('#alias', '验收');
  await page.fill('#text', '这是一条测试留言');
  await page.click('#send');
  await page.waitForTimeout(300);
  const hint = (await page.textContent('#hint')).trim();
  const modeAfter = (await page.textContent('#mode')).trim();
  ok(hint.includes('本机'), '降级提示说明本次结果（本机）', hint);
  ok(!hint.includes('本地模式') && !modeAfter.includes('本地模式'), '徽标/提示不再出现「本地模式」重复语义');
  const errCls = await page.locator('#hint').evaluate((el) => el.className);
  ok(errCls.includes('err'), '失败提示用 err 态（红色）', errCls);
  /* 测试主动 abort 了 /api/board，会产生 net::ERR_FAILED，属预期噪声，单独过滤 */
  const realErrors = errors.filter((e) => !e.includes('ERR_FAILED'));
  ok(realErrors.length === 0, '留言板控制台 0 非预期报错', realErrors.join('|'));
  await ctx.close();
}

/* ---------------- 三、三尺寸：大厅标题不截断 ---------------- */
console.log('\n=== P2-12：大厅标题窄屏完整可见 ===');
for (const size of [{ w: 1920, h: 1080, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }, { w: 768, h: 1024, tag: 'tablet' }]) {
  const ctx = await newCtx(size);
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.SceneManager, null, { timeout: 10000 });
  await page.waitForTimeout(200);
  const info = await page.evaluate(() => {
    const p = document.querySelector('.hud-title p');
    const h1 = document.querySelector('.hud-title h1');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const hr = h1 ? h1.getBoundingClientRect() : null;
    const cs = getComputedStyle(p);
    return {
      text: p.textContent,
      full: p.scrollWidth <= p.clientWidth + 1,
      noOverflow: r.right <= window.innerWidth + 1,
      font: cs.fontSize,
      white: cs.whiteSpace,
      titleRight: hr ? hr.right : 0,
      w: window.innerWidth
    };
  });
  ok(!!info, size.tag + ' 标题元素存在');
  if (info) {
    ok(info.full || info.white === 'normal', size.tag + ' 标题说明完整不截断（允许换行）', JSON.stringify(info));
    ok(info.noOverflow, size.tag + ' 标题不溢出视口');
    ok(/三屏走道.*个区块/.test(info.text), size.tag + ' 标题说明含动态区块数', info.text);
  }
  await page.screenshot({ path: path.join(OUT, 'block7-title-' + size.tag + '.png') });
  ok(errors.length === 0, size.tag + ' 大厅控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 四、结算弹窗热区（口算） ---------------- */
console.log('\n=== P2-13：结算弹窗热区 ===');
{
  const ctx = await newCtx({ w: 390, h: 844 });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.SceneManager, null, { timeout: 10000 });
  await page.evaluate(() => window.SceneManager.change('iframe', { title: '算术挑战', src: 'games/mathdash/index.html', ratio: '16/9' }));
  await page.waitForFunction(() => {
    const f = document.querySelector('.iframe-scene');
    return f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.readyState === 'complete';
  }, null, { timeout: 12000 });
  await page.waitForTimeout(200);
  const fr = page.frames().find((f) => f.url().includes('mathdash'));
  ok(!!fr, '口算 iframe 就绪');
  if (fr) {
    const bb = await fr.locator('#startBtn').boundingBox();
    ok(bb && bb.height >= 44, '结算/开始按钮热区 ≥44px', bb && JSON.stringify(bb));
    /* 关闭后无残留：面板 display 切换，遮罩类名清干净 */
    await fr.click('#startBtn');
    await fr.waitForTimeout(100);
    const overOff = await fr.locator('#over').evaluate((el) => getComputedStyle(el).display);
    ok(overOff === 'none', '开始后结算遮罩关闭（无残影）', overOff);
  }
  ok(errors.length === 0, '结算弹窗控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 五、反复进出无残留 iframe ---------------- */
console.log('\n=== 1.1：iframe 懒挂载 / 反复进出无残留 ===');
{
  const ctx = await newCtx({ w: 1280, h: 800 });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.SceneManager, null, { timeout: 10000 });
  ok(await page.locator('.iframe-scene').count() === 0, '点门前不创建 iframe');
  const doors = [
    { title: '俄罗斯方块', src: 'games/tetris/index.html' },
    { title: '扫雷', src: 'games/mine/index.html' },
    { title: '俄罗斯方块', src: 'games/tetris/index.html' }
  ];
  for (const d of doors) {
    await page.evaluate((p) => window.SceneManager.change('iframe', p), d);
    await page.waitForTimeout(250);
    ok(await page.locator('.iframe-scene').count() === 1, '进入 ' + d.title + ' 恰好 1 个 iframe');
  }
  await page.evaluate(() => window.SceneManager.change('world'));
  await page.waitForTimeout(250);
  ok(await page.locator('.iframe-scene').count() === 0, '回大厅后无残留 iframe');
  ok(await page.locator('.iframe-fit').count() === 0, '回大厅后无残留装裱盒');
  ok(await page.locator('.iframe-back').count() === 0, '回大厅后无残留返回按钮');
  const scene = await page.evaluate(() => document.body.dataset.scene);
  ok(scene === 'world', 'data-scene 复位为 world', scene);
  ok(errors.length === 0, '反复进出控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 六、rAF 后台暂停 ---------------- */
console.log('\n=== 1.3：切后台 rAF 暂停 ===');
{
  const ctx = await newCtx({ w: 1280, h: 800 });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.SceneManager, null, { timeout: 10000 });
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.SceneManager.running === true), '前台主循环运行中');
  const paused = await page.evaluate(() => {
    const sm = window.SceneManager;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    return { paused: sm._hiddenPaused, raf: sm._raf };
  });
  ok(paused.paused === true && paused.raf === 0, 'document.hidden 时 rAF 已停');
  const resumed = await page.evaluate(() => {
    const sm = window.SceneManager;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { paused: sm._hiddenPaused, raf: sm._raf };
  });
  ok(resumed.paused === false && resumed.raf !== 0, '回到前台 rAF 恢复');
  ok(errors.length === 0, 'rAF 切换控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 七、预置网址自检 ---------------- */
console.log('\n=== 三：预置网址 ≥150 + 自检 ===');
{
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'check-links.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  let res = null;
  try { res = JSON.parse(out); } catch {}
  ok(!!res, '自检脚本输出合法 JSON', out.slice(0, 200));
  if (res) {
    ok(res.total >= 150, '预置网址 ≥150 条', '实际 ' + res.total);
    ok(res.unique === res.total, 'URL 去重通过', res.unique + '/' + res.total);
    ok(res.errors.length === 0, '自检全过（格式/伪协议/黑名单/去重/注入/锁定/条数）', res.errors.join('|'));
    ok(res.locked.some((x) => x.includes('ming-games')), 'ming-games 保持锁定');
    ok(Object.keys(res.categories).length >= 12, '分类 ≥12 个', String(Object.keys(res.categories).length));
  }
}

await browser.close();
console.log('\n========================================');
console.log(`块⑦验收：${checks - fails}/${checks} 通过` + (fails === 0 ? '，全绿' : `，${fails} 项失败`));
console.log('========================================');
if (fails > 0) process.exitCode = 1;
