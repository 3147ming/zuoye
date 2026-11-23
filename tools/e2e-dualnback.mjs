/* ============================================================
 * tools/e2e-dualnback.mjs —— 双重 N-Back 复刻专项验收
 * 用法：node tools/e2e-dualnback.mjs
 * 依赖：本地静态服务（8787）
 * 产出：内容加厚核验/dualnback-*.png + 逐项断言
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '内容加厚核验');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
const SRC = 'games/dualnback/index.html';
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

async function openGame(size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/' + SRC, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(() => window.__DNB, null, { timeout: 8000 });
  return { ctx, page, errors };
}

/* ---------------- 一、判定逻辑（纯函数，通过测试钩子） ---------------- */
console.log('=== 判定逻辑：命中 / 漏报 / 误报 / 正确拒绝 ===');
{
  const { ctx, page, errors } = await openGame({ width: 900, height: 900 });
  const r = await page.evaluate(() => {
    const J = window.__DNB.judge;
    return {
      hit:  J(true,  true),
      miss: J(true,  false),
      fa:   J(false, true),
      cr:   J(false, false)
    };
  });
  ok(r.hit === 'hit', '匹配 + 按键 = 命中(hit)', r.hit);
  ok(r.miss === 'miss', '匹配 + 未按 = 漏报(miss)', r.miss);
  ok(r.fa === 'fa', '不匹配 + 按键 = 误报(false alarm)', r.fa);
  ok(r.cr === 'cr', '不匹配 + 未按 = 正确拒绝(cr)', r.cr);
  ok(errors.length === 0, '判定页控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 二、N-back 计分：已知序列 ---------------- */
console.log('=== 计分：forceSequence 驱动已知 2-back 序列 ===');
{
  const { ctx, page, errors } = await openGame({ width: 900, height: 900 });
  const r = await page.evaluate(() => {
    const D = window.__DNB;
    D.setConfig({ n: 2, rounds: 2, speed: 'fast', showLetter: true, voice: false });
    /* 位置流: 0,1,0,2  -> i=2(0)==i=0(0) 匹配; i=3(2)!=i=1(1) 不匹配
       字母流: C,F,C,F  -> i=2(C)==i=0(C) 匹配; i=3(F)==i=1(F) 匹配  */
    const seq = [
      { pos: 0, letter: 'C' },
      { pos: 1, letter: 'F' },
      { pos: 0, letter: 'C' },
      { pos: 2, letter: 'F' }
    ];
    D.start();                       // 先用 start 初始化 stats
    D.forceSequence(seq);            // 4 = n + rounds
    D.state.idx = 0; D.state.stats = { pos:{hit:0,miss:0,fa:0,cr:0}, letter:{hit:0,miss:0,fa:0,cr:0} };
    // trial2 位置按(匹配=>hit)、字母不按(匹配=>miss)
    D.state.trials[2].respPos = true;
    // trial3 字母按(匹配=>hit)、位置不按(不匹配=>cr)
    D.state.trials[3].respLetter = true;
    for (let i = 0; i < 4; i++) D.settle(i);
    return JSON.parse(JSON.stringify(D.state.stats));
  });
  ok(r.pos.hit === 1, '位置：一次匹配且按键 → hit=1', JSON.stringify(r.pos));
  ok(r.pos.miss === 0 && r.pos.fa === 0, '位置：无漏报/误报', JSON.stringify(r.pos));
  ok(r.pos.cr === 1, '位置：一次不匹配未按 → cr=1', JSON.stringify(r.pos));
  ok(r.letter.miss === 1, '字母：一次匹配未按 → miss=1', JSON.stringify(r.letter));
  ok(r.letter.hit === 1, '字母：一次匹配且按键 → hit=1', JSON.stringify(r.letter));
  ok(errors.length === 0, '计分页控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 三、交互：教程 / 开始 / 键盘 / 结算（桌面） ---------------- */
console.log('=== 交互：桌面 1280×800 ===');
{
  const { ctx, page, errors } = await openGame({ width: 1280, height: 800 });
  ok(await page.locator('#ovHelp').evaluate((e) => e.classList.contains('on')), '首次进入显示教程面板');
  ok(await page.locator('.cell').count() === 9, '3×3 网格共 9 格');
  ok(await page.locator('.cell.center').count() === 1, '中心格用于显示字母');

  // 从教程直接进入设置（教程面板会拦截点击，需先关闭）
  await page.click('#helpSet');
  await page.click('#segN .seg[data-v="2"]');
  await page.click('#segRounds .seg[data-v="10"]');
  await page.click('#swVoice');
  await page.click('#setStart');
  await page.waitForTimeout(100);
  const cfg = await page.evaluate(() => ({ ...window.__DNB.cfg }));
  ok(cfg.n === 2, '设置生效：N=2', String(cfg.n));
  ok(cfg.rounds === 10, '设置生效：回合数=10', String(cfg.rounds));
  ok(cfg.voice === false, '设置生效：语音关闭', String(cfg.voice));
  ok(await page.evaluate(() => window.__DNB.state.phase) === 'play', '开始后进入 play 态');

  // 键盘响应：按 A 与 L，应标记当前 trial
  await page.keyboard.press('a');
  await page.keyboard.press('l');
  const armed = await page.evaluate(() => {
    const t = window.__DNB.state.trials[window.__DNB.state.idx];
    return { p: t.respPos, l: t.respLetter };
  });
  ok(armed.p === true, '按 A 标记位置响应', JSON.stringify(armed));
  ok(armed.l === true, '按 L 标记字母响应', JSON.stringify(armed));

  // 亮块在 stimulus on 阶段会出现（强制渲染检查）
  const lit = await page.evaluate(() => {
    const D = window.__DNB;
    const t = D.state.trials[D.state.idx];
    // 直接复现 renderStimulus 的 class 逻辑：确认 t.pos 落在周边格集合
    return [0,1,2,4,5,6,7,8].includes(t.pos);
  });
  ok(lit === true, '亮块位置落在 8 个周边格内', String(lit));

  // 等待自然结算到结算面板（4 回合 + 2 预热，fast 未开故 mid≈1.9s/回合）
  await page.evaluate(() => {
    const D = window.__DNB;
    D.setConfig({ speed: 'fast' });
  });
  await page.evaluate(() => window.__DNB.finish());
  await page.waitForTimeout(80);
  ok(await page.locator('#ovResult').evaluate((e) => e.classList.contains('on')), '结算面板弹出');
  const all = await page.locator('#resAll').textContent();
  ok(/^\d+%$/.test(all.trim()), '结算显示综合准确率', all);
  ok(await page.locator('#resBreak').textContent().then(t => t.includes('命中') && t.includes('漏报') && t.includes('误报')), '结算含命中/漏报/误报明细');
  ok(errors.length === 0, '桌面交互控制台 0 报错', errors.join('|'));
  await page.screenshot({ path: path.join(OUT, 'dualnback-desktop.png') });
  await ctx.close();
}

/* ---------------- 四、手机竖屏：布局 / 按钮热区 / 触屏 ---------------- */
console.log('=== 手机竖屏 390×844 ===');
{
  const { ctx, page, errors } = await openGame({ width: 390, height: 844 });
  await page.click('#helpStart');
  await page.waitForTimeout(100);
  const btnPos = await page.locator('#btnPos').boundingBox();
  const btnSnd = await page.locator('#btnSnd').boundingBox();
  ok(btnPos && btnPos.height >= 44, '位置按钮热区 ≥44px', btnPos && String(btnPos.height));
  ok(btnSnd && btnSnd.height >= 44, '声音按钮热区 ≥44px', btnSnd && String(btnSnd.height));
  const grid = await page.locator('#grid').boundingBox();
  ok(grid && grid.x >= 0 && grid.x + grid.width <= 390, '网格不横向溢出', grid && JSON.stringify(grid));
  // 触屏点击响应
  await page.click('#btnPos');
  const armed = await page.evaluate(() => window.__DNB.state.trials[window.__DNB.state.idx].respPos);
  ok(armed === true, '触屏点击位置按钮 → 标记响应', String(armed));
  // 容器占满竖屏（高度 > 视口 70%）
  const appH = await page.locator('#app').boundingBox().then(b => b.height);
  ok(appH > 844 * 0.7, '容器占满竖屏高度', String(appH));
  ok(errors.length === 0, '手机控制台 0 报错', errors.join('|'));
  await page.screenshot({ path: path.join(OUT, 'dualnback-mobile.png') });
  await ctx.close();
}

/* ---------------- 五、反复进出无残留（同一页面多次 start） ---------------- */
console.log('=== 多次重开：无状态残留 ===');
{
  const { ctx, page, errors } = await openGame({ width: 900, height: 900 });
  await page.evaluate(() => {
    const D = window.__DNB;
    D.setConfig({ n: 1, rounds: 6, speed: 'fast', voice: false });
    D.start(); D.finish(); D.start(); D.finish(); D.start();
  });
  const s = await page.evaluate(() => ({
    phase: window.__DNB.state.phase,
    trials: window.__DNB.state.trials.length,
    hits: window.__DNB.state.stats.pos.hit + window.__DNB.state.stats.letter.hit
  }));
  ok(s.phase === 'play', '连续重开后处于 play 态', s.phase);
  ok(s.trials === 7, '连续重开后 trial 数正确(n+rounds=7)', String(s.trials));
  ok(s.hits === 0, '连续重开后统计已清零', String(s.hits));
  await page.evaluate(() => {
    /* 模拟切后台再回来 */
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  ok(await page.evaluate(() => window.__DNB.state.phase) === 'paused', '切后台 → paused');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  ok(await page.evaluate(() => window.__DNB.state.phase) === 'play', '回前台 → 恢复 play');
  ok(errors.length === 0, '重开流程控制台 0 报错', errors.join('|'));
  await ctx.close();
}

/* ---------------- 六、大厅集成：门存在且可进入 ---------------- */
console.log('=== 大厅集成：dualnback 门 ===');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.ITEMS || (window.WorldHub && window.WorldHub.ITEMS), null, { timeout: 8000 }).catch(() => {});
  // 通过 SceneManager 直接进入门，验证 src 可达
  await page.waitForFunction(() => window.SceneManager, null, { timeout: 8000 });
  await page.evaluate((p) => window.SceneManager.change('iframe', p), { title: '双重 N-Back', src: SRC, ratio: '1/1' });
  await page.waitForFunction(() => {
    const f = document.querySelector('.iframe-scene');
    return f && f.contentWindow && f.contentWindow.__DNB;
  }, null, { timeout: 12000 });
  ok(true, '大厅 iframe 场景可加载 dualnback');
  const fit = await page.locator('.iframe-fit').boundingBox();
  ok(fit && Math.abs(fit.width - fit.height) < 3, '1/1 等比装裱为正方形', fit && JSON.stringify(fit));
  ok(errors.length === 0, '大厅集成控制台 0 报错', errors.join('|'));
  await ctx.close();
}

console.log('\n========================================');
console.log(`验收结果：${checks - fails}/${checks} 通过` + (fails === 0 ? ' · 全绿' : ` · ${fails} 项失败`));
console.log('========================================');
await browser.close();
process.exit(fails === 0 ? 0 : 1);
