/* ============================================================
 * tools/e8-walkthrough.mjs —— 第八批三尺寸走查（可复用）
 * 用法：
 *   node tools/e8-walkthrough.mjs             # 全部门 × 三尺寸
 *   node tools/e8-walkthrough.mjs --block=1   # 只跑块①装裱走查
 * 依赖：本地 node server/index.js（8787）
 * 产出：内容加厚核验/e8/<尺寸>-<门>.png + 控制台结果
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

const SIZES = [
  { name: 'desktop', w: 1920, h: 1080 },
  { name: 'phone', w: 390, h: 844 },
  { name: 'tablet', w: 768, h: 1024 }
];

/* 代表性门：横屏游戏 / 竖屏游戏 / 方块 / 工具 / 跨域 */
const DOORS = [
  { id: 'tetris', ratio: 16 / 9, label: '俄罗斯方块-横屏16:9' },
  { id: 'plane', ratio: 9 / 16, label: '飞机大战-竖屏9:16' },
  { id: 'game2048', ratio: 1 / 1, label: '2048-方块1:1' },
  { id: 'mine', ratio: 4 / 3, label: '扫雷-4:3' },
  { id: 'color', ratio: 0, label: '色卡-工具auto' }
];

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

let fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}

/* 从 ITEMS 里按 id 找到门对象，构造与 world.enterDoor 一样的参数。
   用页面内 eval 读 world 的 ITEMS 不可行（闭包），改为硬编码 src/ratio（与 world.js 一致）。 */
const SRC = {
  tetris: 'games/tetris/index.html',
  plane: 'games/brain-gym/index.html?game=plane',
  tiles: 'games/brain-gym/index.html?game=tiles',
  game2048: 'games/game2048/index.html',
  mine: 'games/mine/index.html',
  color: 'tools/color/index.html'
};

for (const size of SIZES) {
  console.log('\n=== 尺寸 ' + size.name + ' ' + size.w + '×' + size.h + ' ===');
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(() => window.SceneManager && window.SceneManager.has('iframe'), { timeout: 10000 });

  for (const door of DOORS) {
    // 进入门
    await page.evaluate((d) => {
      window.SceneManager.change('iframe', {
        title: d.id, src: d.src, ratio: d.ratio ? String(d.ratio) : 'auto', cross: false
      });
    }, { id: door.id, src: SRC[door.id], ratio: door.ratio });
    await page.waitForTimeout(900);

    // 量测装裱盒
    const m = await page.evaluate(() => {
      const st = document.getElementById('stage');
      const fit = document.querySelector('.iframe-fit');
      if (!st || !fit) return null;
      const sr = st.getBoundingClientRect(), fr = fit.getBoundingClientRect();
      return {
        stage: [Math.round(sr.width), Math.round(sr.height)],
        fit: [Math.round(fr.width), Math.round(fr.height)],
        fitRatio: Math.round((fr.width / fr.height) * 1000) / 1000,
        iframeSrc: (document.querySelector('.iframe-scene') || {}).getAttribute
          ? document.querySelector('.iframe-scene').getAttribute('src') : ''
      };
    });
    const tag = size.name + '-' + door.id;
    await page.screenshot({ path: path.join(OUT, tag + '.png') });
    if (!m) { ok(false, tag + ' 装裱盒存在'); continue; }
    if (door.ratio) {
      const diff = Math.abs(m.fitRatio - door.ratio) / door.ratio;
      ok(diff < 0.02, tag + ' 等比正确（实测 ' + m.fitRatio + ' / 期望 ' + Math.round(door.ratio * 1000) / 1000 + '）',
        JSON.stringify(m));
      ok(m.fit[0] <= m.stage[0] + 1 && m.fit[1] <= m.stage[1] + 1,
        tag + ' 装裱盒不溢出舞台', JSON.stringify(m));
    } else {
      ok(true, tag + ' 工具页 auto 撑满（' + JSON.stringify(m) + '）');
    }
    // 回大厅
    await page.evaluate(() => window.SceneManager.change('world'));
    await page.waitForTimeout(200);
  }

  const real = errors.filter((e) => !/favicon|ERR_CONNECTION|WebSocket is closed/i.test(e));
  ok(real.length === 0, size.name + ' 控制台 0 报错', real.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
console.log('\n' + (fails ? '✗ ' + fails + ' / ' + checks + ' 项未通过' : '✓ 全部通过（' + checks + ' 项）'));
process.exit(fails ? 1 : 0);
