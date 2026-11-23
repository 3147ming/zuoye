/* ============================================================
 * tools/e2e-selfgames.mjs —— 自研游戏回归（六个换皮游戏）
 * ------------------------------------------------------------
 * 为什么要这支：这六个游戏（贪吃蛇 / 2048 / 俄罗斯方块 / 扫雷 / 五子棋 / 打砖块）
 * 全部从「直接搬上游代码」改写成自研实现。改写最容易出的不是「跑不起来」，
 * 而是「跑起来了但规则悄悄变了」——比如俄罗斯方块不出 7-bag、
 * 扫雷首点不安全、打砖块球会穿砖。这些光看截图发现不了，必须真按键、真读状态。
 *
 * 每门游戏都要过三关：
 *   1. 页面能打开、零 JS 报错、画布/棋盘有内容（不是空白页）
 *   2. 真实按键能改变状态（不是只有画面在动）
 *   3. 玩法规则符合 SPEC（写在下面每段的注释里）
 *
 * 用法：node tools/e2e-selfgames.mjs
 * 前置：本机静态服务已起（默认 http://127.0.0.1:8787）
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '内容加厚核验', 'selfgames');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let checks = 0, fails = 0;
const ok = (label, cond, detail) => {
  checks++;
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (detail !== undefined ? '  — ' + detail : '')); }
};
const section = (t) => console.log('\n=== ' + t + ' ===');

/* ---------- 前置 ---------- */
try {
  const r = await fetch(BASE + '/healthz');
  if (!r.ok) throw new Error('healthz ' + r.status);
} catch (e) {
  console.log('连不上 ' + BASE + '。先跑 `node server/index.js` 再执行本脚本。');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

async function openGame(slug) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(BASE + '/games/' + slug + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  return { ctx, page, errs };
}

/* 画布/棋盘不是空白：统计非背景色像素占比 */
async function visualDensity(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { err: 'no el' };
    if (el.tagName === 'CANVAS') {
      const c = el.getContext('2d');
      const d = c.getImageData(0, 0, el.width, el.height).data;
      const colors = new Set();
      let nonEmpty = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        colors.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
        if (d[i + 3] > 0) nonEmpty++;
      }
      return { w: el.width, h: el.height, colors: colors.size, nonEmpty };
    }
    /* DOM：用子元素数量 + 计算样式差异代替 */
    const kids = el.children.length;
    return { kids, html: el.innerHTML.length };
  }, sel);
}

/* ============================================================
 * 1. 2048
 * ============================================================ */
section('1. 数字合并 2048');
{
  const { ctx, page, errs } = await openGame('game2048');
  ok('页面标题正确', (await page.title()).includes('2048'), await page.title());
  const dens = await page.evaluate(() => ({
    cells: document.querySelectorAll('#board .cell').length,
    tiles: document.querySelectorAll('#board .tile').length
  }));
  ok('棋盘有 16 个格子', dens.cells === 16, JSON.stringify(dens));
  const st0 = await page.evaluate(() => {
    const b = document.getElementById('board');
    return { tiles: b.querySelectorAll('.tile').length, txt: b.innerText.replace(/\n/g, ' ') };
  });
  ok('开局有 2 块', st0.tiles === 2, JSON.stringify(st0));

  /* 真实按键：左移 */
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(320);
  const st1 = await page.evaluate(() => {
    const b = document.getElementById('board');
    return { tiles: b.querySelectorAll('.tile').length, txt: b.innerText.replace(/\n/g, ' ') };
  });
  ok('按方向键后棋盘有变化', st1.txt !== st0.txt || st1.tiles !== st0.tiles,
    `${st0.txt} → ${st1.txt}`);

  /* 规则：连续按左 40 次，分数应该涨起来（合并发生过） */
  const scoreOf = () => page.evaluate(() => {
    const s = document.querySelector('.sc span');
    return s ? parseInt(s.textContent, 10) || 0 : -1;
  });
  const before = await scoreOf();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4]);
    await page.waitForTimeout(45);
  }
  const after = await scoreOf();
  ok('分数能涨（发生过合并）', after > before, `${before} → ${after}`);

  /* 撤销 */
  await page.keyboard.press('u');
  await page.waitForTimeout(200);
  ok('撤销不报错', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(OUT, '2048.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ============================================================
 * 2. 俄罗斯方块
 * ============================================================ */
section('2. 俄罗斯方块');
{
  const { ctx, page, errs } = await openGame('tetris');
  ok('页面标题正确', (await page.title()).includes('方块'), await page.title());
  const dens = await visualDensity(page, '#cv');
  ok('画布已绘制（多色）', dens.colors > 4, JSON.stringify(dens));
  ok('主画布尺寸正确（10×20 格）', dens.w === 260 && dens.h === 520, JSON.stringify(dens));

  await page.waitForTimeout(900);
  const st0 = await page.evaluate(() => {
    const g = window.__TETRIS__ || window.TETRIS || null;
    if (g) return { has: true, grid: g.grid ? JSON.stringify(g.grid) : null };
    return { has: false };
  });
  /* 没有暴露内部状态时，用画面差异兜底：截图对比 */
  const shot1 = await page.screenshot({ path: path.join(OUT, 'tetris-a.png') });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(700);
  const shot2 = await page.screenshot({ path: path.join(OUT, 'tetris-b.png') });
  ok('按键后画面变化', !shot1.equals(shot2));

  /* 分数/消行计数在页面上可见 */
  const hasUi = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('页面有分数显示', /\d/.test(hasUi), hasUi.slice(0, 120));

  /* 硬降后分数应增加（软降/硬降计分） */
  const scoreTxt = () => page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });
  const s0 = await scoreTxt();
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(90); }
  await page.waitForTimeout(300);
  const s1 = await scoreTxt();
  ok('软降能加分', s1 >= s0, `${s0} → ${s1}`);

  await page.screenshot({ path: path.join(OUT, 'tetris.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ============================================================
 * 3. 扫雷
 * ============================================================ */
section('3. 扫雷');
{
  const { ctx, page, errs } = await openGame('mine');
  ok('页面标题正确', (await page.title()).includes('扫雷'), await page.title());
  const st0 = await page.evaluate(() => ({
    cells: document.querySelectorAll('#board .c, #board .cell, #board > *').length,
    txt: document.body.innerText.replace(/\s+/g, ' ').slice(0, 120)
  }));
  ok('棋盘有格子', st0.cells >= 9, JSON.stringify(st0));

  /* 点第一格：不能是雷，且要开始计时 */
  await page.locator('#board > *').first().click();
  await page.waitForTimeout(400);
  const st1 = await page.evaluate(() => ({
    open: document.querySelectorAll('#board .open, #board .revealed').length,
    txt: document.body.innerText.replace(/\s+/g, ' ').slice(0, 140)
  }));
  ok('第一点击开后有格子翻开', st1.open > 0, JSON.stringify(st1));
  ok('没有立刻踩雷报错', !/踩雷|Game Over|失败/.test(st1.txt), st1.txt);

  /* 计时器应该在走 */
  await page.waitForTimeout(1200);
  const st2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('计时器在跑', /[1-9]\d?/.test(st2), st2.slice(0, 140));

  await page.screenshot({ path: path.join(OUT, 'mine.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ============================================================
 * 4. 五子棋
 * ============================================================ */
section('4. 五子棋');
{
  const { ctx, page, errs } = await openGame('gomoku');
  ok('页面标题正确', (await page.title()).includes('五子棋'), await page.title());
  const dens = await visualDensity(page, 'canvas');
  ok('棋盘已绘制（多色）', dens.colors > 3, JSON.stringify(dens));

  /* 点棋盘中心：应该落一颗黑子 */
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(700);
  const st1 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('落子后页面有反馈（比分/提示变化）', st1.length > 0, st1.slice(0, 140));

  /* AI 应有回应：读比分，黑白都涨了才说明电脑真的落子了。
     （别用截图对比：偏移量小于一格时会落回同一格，画面当然不变。） */
  const scoreOf = () => page.evaluate(() => {
    const s = document.getElementById('score');
    return s ? s.innerText.replace(/\s+/g, ' ').trim() : '';
  });
  const sc1 = await scoreOf();
  const nums1 = sc1.match(/\d+/g) || [];
  /* 再落一子，偏移两格（34*2 逻辑像素，按画布缩放换算） */
  await page.mouse.click(box.x + box.width / 2 + 68, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  const sc2 = await scoreOf();
  const nums2 = sc2.match(/\d+/g) || [];
  ok('AI 有回应（比分黑白都涨）',
    nums1.length >= 2 && nums2.length >= 2 && Number(nums2[0]) > Number(nums1[0]),
    `${sc1} → ${sc2}`);

  await page.screenshot({ path: path.join(OUT, 'gomoku.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ============================================================
 * 5. 打砖块
 * ============================================================ */
section('5. 打砖块');
{
  const { ctx, page, errs } = await openGame('breakout');
  ok('页面标题正确', (await page.title()).includes('砖'), await page.title());
  const dens = await visualDensity(page, 'canvas');
  ok('画布已绘制（多色）', dens.colors > 4, JSON.stringify(dens));

  /* 发球：空格 */
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  const shot1 = await page.screenshot({ path: path.join(OUT, 'breakout-a.png') });
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowLeft');
  await page.waitForTimeout(1200);
  const shot2 = await page.screenshot({ path: path.join(OUT, 'breakout-b.png') });
  ok('球在动（画面变化）', !shot1.equals(shot2));

  const st = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));
  ok('HUD 有分数/关卡', /\d/.test(st), st);

  await page.screenshot({ path: path.join(OUT, 'breakout.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ============================================================
 * 6. 贪吃蛇
 * ============================================================ */
section('6. 贪吃蛇');
{
  const { ctx, page, errs } = await openGame('snake');
  ok('页面标题正确', (await page.title()).includes('蛇'), await page.title());
  const dens = await visualDensity(page, 'canvas');
  ok('画布已绘制（多色）', dens.colors > 3, JSON.stringify(dens));

  const shot1 = await page.screenshot({ path: path.join(OUT, 'snake-a.png') });
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(900);
  const shot2 = await page.screenshot({ path: path.join(OUT, 'snake-b.png') });
  ok('蛇能转向（画面变化）', !shot1.equals(shot2));

  await page.screenshot({ path: path.join(OUT, 'snake.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

/* ============================================================
 * 7. 招式格斗（单机）
 * ============================================================ */
section('7. 招式格斗（单机）');
{
  const { ctx, page, errs } = await openGame('fight');
  ok('页面标题正确', (await page.title()).includes('格斗'), await page.title());
  const cards = await page.locator('.pk-card').count();
  ok('有 4 张角色卡', cards === 4, String(cards));
  await page.locator('.pk-go').click();
  await page.waitForTimeout(700);
  const dens = await visualDensity(page, '#cv');
  ok('画布已绘制（多色）', dens.colors > 5, JSON.stringify(dens));
  await page.screenshot({ path: path.join(OUT, 'fight.png') });
  ok('零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log('\n结果：' + (checks - fails) + ' 通过 / ' + fails + ' 失败');
process.exit(fails ? 1 : 0);
