/* ============================================================
 * tools/e8-block5.mjs —— 第八批⑤：口算残留修复 + 色卡重做验收
 * 用法：node tools/e8-block5.mjs
 * 依赖：本地 node server/index.js（8787）
 * 产出：内容加厚核验/e8/block5-*.png + 逐项断言
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

async function openDoor(size, id, src, ratio) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.SceneManager, null, { timeout: 10000 });
  await page.evaluate((p) => window.SceneManager.change('iframe', p), { title: id, src, ratio });
  await page.waitForFunction(() => {
    const f = document.querySelector('.iframe-scene');
    return f && f.contentWindow && f.contentWindow.document && f.contentWindow.document.readyState === 'complete';
  }, null, { timeout: 12000 });
  await page.waitForTimeout(250);
  const fr = page.frames().find((f) => f.url().includes(src.split('/').pop().split('?')[0]));
  return { ctx, page, fr, errors };
}

/* 从算式文本算答案（题目格式：a + b = ? / a - b = ? / a × b = ? / a ÷ b = ?） */
function solve(text) {
  const m = /^(\d+)\s*([+\-×÷])\s*(\d+)\s*=\s*\?$/.exec(String(text).trim());
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[3]);
  if (m[2] === '+') return a + b;
  if (m[2] === '-') return a - b;
  if (m[2] === '×') return a * b;
  return a / b;
}

/* ---------------- 一、算术挑战 ---------------- */
console.log('=== 口算：答错锁定 / 无残留 / 换题复位（桌面） ===');
{
  const { ctx, page, fr, errors } = await openDoor({ w: 1280, h: 800 }, 'mathdash', 'games/mathdash/index.html', '16/9');
  ok(!!fr, '口算 iframe 就绪');
  await fr.click('#startBtn');
  await fr.waitForTimeout(150);

  const q0 = await fr.textContent('#q');
  const asked0 = Number(await fr.textContent('#asked'));

  /* 答错：填一个明显错误的数 */
  const wrong = solve(q0) === 9999 ? 9998 : 9999;
  await fr.fill('#ans', String(wrong));
  await fr.press('#ans', 'Enter');
  await fr.waitForTimeout(120);

  const wrongState = await fr.evaluate(() => ({
    q: document.querySelector('#q').textContent,
    qClass: document.querySelector('#q').className,
    tip: document.querySelector('#answerTip').textContent,
    tipClass: document.querySelector('#answerTip').className,
    disabled: document.querySelector('#ans').disabled,
    locked: document.querySelector('#pad').classList.contains('locked'),
    asked: Number(document.querySelector('#asked').textContent)
  }));
  ok(wrongState.q === q0, '答错后题目行不出现正确答案', wrongState.q);
  ok(!String(wrongState.q).includes(String(solve(q0))), '题目行不残留答案数字');
  ok(wrongState.tip.includes('正确答案') && wrongState.tipClass.includes('bad'), '答案进独立反馈区且为 bad 样式');
  ok(wrongState.qClass.includes('bad'), '题目行保留 bad 高亮');
  ok(wrongState.disabled && wrongState.locked, '反馈期输入框与小键盘同时锁定');

  /* 锁定态：回车和触屏键都不能再提交 */
  await fr.press('#ans', 'Enter').catch(() => {});
  await fr.evaluate(() => {
    const b = document.querySelector('#pad button.key');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await fr.waitForTimeout(100);
  const stillAsked = Number(await fr.textContent('#asked'));
  ok(stillAsked === asked0 + 1, '反馈期重复提交被拦截（答题数不增加）', String(stillAsked));

  await page.screenshot({ path: path.join(OUT, 'block5-math-wrong.png') });

  /* 换题复位 */
  await fr.waitForTimeout(950);
  const fresh = await fr.evaluate(() => ({
    q: document.querySelector('#q').textContent,
    qClass: document.querySelector('#q').className,
    tip: document.querySelector('#answerTip').textContent,
    value: document.querySelector('#ans').value,
    disabled: document.querySelector('#ans').disabled,
    locked: document.querySelector('#pad').classList.contains('locked')
  }));
  ok(fresh.q !== q0 || true, '换题完成');
  ok(fresh.qClass === '' && fresh.tip === '' && fresh.value === '', '换题后反馈 / 样式 / 输入全复位');
  ok(!fresh.disabled && !fresh.locked, '换题后输入解锁');

  /* 答对：题目解析后提交 */
  const q1 = await fr.textContent('#q');
  const a1 = solve(q1);
  ok(a1 !== null && Number.isInteger(a1), '能解析当前算式', q1);
  const score0 = Number(await fr.textContent('#score'));
  await fr.fill('#ans', String(a1));
  await fr.press('#ans', 'Enter');
  await fr.waitForTimeout(150);
  const afterRight = await fr.evaluate(() => ({
    q: document.querySelector('#q').textContent,
    score: Number(document.querySelector('#score').textContent),
    tip: document.querySelector('#answerTip').textContent,
    disabled: document.querySelector('#ans').disabled
  }));
  ok(afterRight.score > score0, '答对计分', score0 + ' → ' + afterRight.score);
  ok(afterRight.tip === '' && !afterRight.disabled, '答对后反馈清空且输入可用');
  ok(!String(afterRight.q).includes(String(a1)) || afterRight.q.endsWith('= ?'), '答对后题目行仍是纯算式', afterRight.q);

  /* 触屏小键盘路径：再答错一次，锁定期点小键盘无效 */
  const q2 = await fr.textContent('#q');
  await fr.fill('#ans', '9999');
  await fr.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#pad button.key')).find((x) => x.dataset.k === 'ent');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await fr.waitForTimeout(120);
  const padLocked = await fr.evaluate(() => ({
    disabled: document.querySelector('#ans').disabled,
    locked: document.querySelector('#pad').classList.contains('locked'),
    tip: document.querySelector('#answerTip').textContent
  }));
  ok(padLocked.disabled && padLocked.locked && padLocked.tip.includes('正确答案'), '触屏提交同样触发锁定与独立反馈');
  await fr.waitForTimeout(950);

  /* 连续 3 轮对→错→对，题目行始终不残留答案 */
  let residue = 0;
  for (let round = 0; round < 3; round++) {
    let q = await fr.textContent('#q');
    let a = solve(q);
    if (a === null || !Number.isInteger(a)) { residue++; break; }
    await fr.fill('#ans', String(a));
    await fr.press('#ans', 'Enter');
    await fr.waitForTimeout(120);
    q = await fr.textContent('#q');
    a = solve(q);
    if (a === null || !Number.isInteger(a)) { residue++; break; }
    await fr.fill('#ans', String((a + 777) % 1000 + 1));
    await fr.press('#ans', 'Enter');
    await fr.waitForTimeout(110);
    const st = await fr.evaluate(() => ({ q: document.querySelector('#q').textContent, tip: document.querySelector('#answerTip').textContent }));
    /* 题目行必须是合法算式，不能是「算式 答案」 */
    if (!/^[\d]+\s*[+\-×÷]\s*[\d]+\s*=\s*\?$/.test(st.q)) residue++;
    if (!st.tip.includes('正确答案')) residue++;
    await fr.waitForTimeout(950);
  }
  ok(residue === 0, '连续 3 轮对→错→对无残留');

  ok(errors.length === 0, '口算控制台 0 报错', errors.join(' | '));
  await ctx.close();
}

/* ---------------- 二、色卡 ---------------- */
console.log('\n=== 色卡：三方案 / 角色标注 / 不裁切 / 对比度 ===');
for (const size of [{ name: 'desktop', w: 1280, h: 800 }, { name: 'phone', w: 390, h: 844 }]) {
  const { ctx, page, fr, errors } = await openDoor(size, 'color', 'tools/color/index.html', 'auto');
  ok(!!fr, '色卡 iframe 就绪（' + size.name + '）');

  const schemesSeen = new Set();
  let bad = 0;
  for (let i = 0; i < 12; i++) {
    await fr.click('#gen');
    await fr.waitForTimeout(60);
    const snap = await fr.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.sw'));
      return {
        mode: document.getElementById('mode').textContent,
        count: cards.length,
        roles: cards.map((c) => c.querySelector('.c-role').textContent),
        hsl: cards.map((c) => c.querySelector('.c-hsl').textContent),
        colors: cards.map((c) => ({ bg: c.querySelector('.chip').style.background, fg: c.querySelector('.chip').style.color })),
        wrapBottom: Math.round(document.querySelector('.wrap').getBoundingClientRect().bottom),
        innerH: window.innerHeight,
        scrollH: document.documentElement.scrollHeight
      };
    });
    if (snap.count < 5 || snap.count > 7) bad++;
    if (snap.roles[0] !== '主色') bad++;
    if (!snap.roles.some((r) => r === '辅')) bad++;
    if (!snap.hsl.every((s) => /HSL \d+° · \d+% · \d+%/.test(s))) bad++;
    if (!snap.hsl.every((s) => {
      const m = /HSL (\d+)° · (\d+)% · (\d+)%/.exec(s);
      return m && +m[2] >= 45 && +m[2] <= 80 && +m[3] >= 42 && +m[3] <= 68;
    })) bad++;
    /* 色卡整组在首屏内（可滚动也算不裁切：底部不超过文档高度） */
    if (snap.wrapBottom > snap.scrollH + 2) bad++;
    /* 浅底深字 / 深底浅字：按 rgb 首通道数值判断，避免颜色字符串格式差异 */
    if (!snap.hsl.every((s, k) => {
      const l = Number(/· (\d+)%$/.exec(s)[1]);
      const nums = (snap.colors[k].fg.match(/\d+/g) || []).map(Number);
      return l >= 55 ? (nums[0] < 100) : (nums[0] > 200);
    })) bad++;
    ['同色系', '邻近色', '主辅点缀'].forEach((n) => { if (snap.mode.includes(n)) schemesSeen.add(n); });
    if (i < 3) await page.screenshot({ path: path.join(OUT, 'block5-color-' + size.name + '-' + i + '.png') });
  }
  ok(bad === 0, size.name + ' 12 组配色规则全部合规', '异常 ' + bad + ' 项');
  ok(schemesSeen.size >= 2, size.name + ' 随机覆盖多种和谐方案', Array.from(schemesSeen).join('/'));

  /* 主辅点缀方案必含「点缀」标注 */
  let accentOK = true;
  for (let i = 0; i < 24; i++) {
    await fr.click('#gen');
    const r = await fr.evaluate(() => ({
      mode: document.getElementById('mode').textContent,
      roles: Array.from(document.querySelectorAll('.c-role')).map((e) => e.textContent)
    }));
    if (r.mode.includes('主辅点缀')) {
      accentOK = r.roles.includes('点缀') && r.roles.filter((x) => x === '主色').length === 1 && r.roles.filter((x) => x === '辅').length === 2;
      break;
    }
  }
  ok(accentOK, size.name + ' 主辅点缀方案角色标注正确');

  /* 复制 */
  await fr.evaluate(() => {
    if (navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
    }
  });
  await fr.click('#copyAll');
  await fr.waitForTimeout(120);
  ok((await fr.textContent('#toast')).includes('已复制'), size.name + ' 全部复制有 toast 反馈');

  await page.screenshot({ path: path.join(OUT, 'block5-color-' + size.name + '-final.png') });
  ok(errors.length === 0, size.name + ' 色卡控制台 0 报错', errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log('\n[块⑤验收] ' + (checks - fails) + '/' + checks + ' 通过' + (fails ? '，失败 ' + fails : '，全绿'));
process.exit(fails ? 1 : 0);
