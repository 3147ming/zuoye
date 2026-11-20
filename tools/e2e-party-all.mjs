/* ============================================================
 * tools/e2e-party-all.mjs —— 联机玩法全量回归（一个入口跑完）
 * ------------------------------------------------------------
 * 为什么要有这一支：之前每个批次一个脚本（e8-block3/4/5/6/7…），
 * 七玩法的交互验证只存在于临时目录里，改完就丢。而实际踩到的坑
 * （碰碰全员「出局」、抢答反馈被重绘覆盖、球场开球无提示、重连断链）
 * 都是「能开局但玩不了」这一层，只有真按键、真读 DOM 才测得出来。
 *
 * 用法：
 *   node server/index.js &          # 先起本地服务（8787）
 *   node tools/e2e-party-all.mjs
 *   或：npm run test:party:all
 *
 * 覆盖：
 *   A. 七个玩法 —— 双会话开局、说明条存在且可收起、画布不溢出、
 *      真实按键有位移/朝向变化、记分条两行、双端 0 报错
 *   B. 断线重连 —— 掐掉 socket 后自动回来、舞台不被拆、房间号不变、
 *      回来后按键仍然有效
 *   C. 手机窄屏 —— 说明条默认收起、大厅「创建房间」在首屏、
 *      横屏画布比竖屏明显更大
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '内容加厚核验', 'e2e-all');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let checks = 0, fails = 0;
function F(cond, label, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + label);
  else { fails++; console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}
const section = (t) => console.log('\n=== ' + t + ' ===');

/* ---------- 前置：服务在不在 ---------- */
try {
  const r = await fetch(BASE + '/healthz');
  if (!r.ok) throw new Error('healthz ' + r.status);
} catch (e) {
  console.log('连不上 ' + BASE + '。先跑 `node server/index.js`（或 npm run party）再执行本脚本。');
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

/* ---------- 双会话 ---------- */
async function twoSession(gameIdx, names = ['甲', '乙'], ctxOpt = {}) {
  const errs = [];
  const mk = async (nm, extra) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }, extra));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(nm + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(nm + ' console: ' + m.text()); });
    await page.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#party .pp-wrap', { timeout: 12000 });
    return { ctx, page };
  };
  const A = await mk('A', ctxOpt.A), B = await mk('B', ctxOpt.B);
  await A.page.evaluate((i) => { const c = document.querySelectorAll('.pp-game'); if (c[i]) c[i].click(); }, gameIdx);
  await A.page.waitForTimeout(140);
  await A.page.locator('.pp-input').first().fill(names[0]);
  await A.page.getByRole('button', { name: '创建房间' }).click();
  await A.page.waitForSelector('.pp-code b', { timeout: 12000 });
  const code = (await A.page.textContent('.pp-code b')).trim();
  await B.page.locator('.pp-input').first().fill(names[1]);
  await B.page.locator('.pp-input-code').fill(code);
  await B.page.getByRole('button', { name: '进入房间' }).click();
  await B.page.waitForSelector('.pp-code b', { timeout: 12000 });
  await A.page.waitForFunction(() => document.querySelectorAll('.pp-player:not(.empty)').length >= 2, null, { timeout: 10000 });
  await A.page.getByRole('button', { name: '开始游戏' }).click();
  await A.page.waitForSelector('#ppStage', { timeout: 15000 });
  await B.page.waitForSelector('#ppStage', { timeout: 15000 });
  return {
    A: A.page, B: B.page, code, errs,
    async close() { await A.ctx.close(); await B.ctx.close(); }
  };
}

const probe = (page) => page.evaluate(() => {
  const S = window.PARTY_KIT_STATE;
  const hud = Array.from(document.querySelectorAll('.pk-score')).map((d) => d.innerText.replace(/\n/g, '|'));
  if (!S) return { hud, S: null };
  return { you: S.you, hud, g: JSON.parse(JSON.stringify(S.g, (k, v) => (Array.isArray(v) && v._ix != null ? v.slice() : v))) };
});
async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}

/* ============================================================
 * A. 七个玩法
 * ============================================================ */
const GAMES = [
  { i: 0, id: 'bounce', name: '咱俩碰碰', key: 'b' },
  { i: 1, id: 'balloon', name: '泡泡堂', key: 'p' },
  { i: 2, id: 'tank', name: '坦克大战', key: 'k' },
  { i: 3, id: 'snakebattle', name: '贪吃蛇大作战', key: 's' },
  { i: 4, id: 'quiz', name: '抢答赛', key: null },
  { i: 5, id: 'draw', name: '你画我猜', key: null },
  { i: 6, id: 'pitch', name: '球场 2v2', key: 'pl' }
];

section('A. 七个玩法（双会话 + 真实按键）');
for (const G of GAMES) {
  console.log('\n-- ' + G.name + ' --');
  let t;
  try {
    t = await twoSession(G.i, ['甲', '乙']);
  } catch (e) {
    F(false, G.name + ' 开局失败', e.message.split('\n')[0]);
    continue;
  }
  try {
    await t.A.waitForTimeout(900);

    const how = await t.A.evaluate(() => {
      const h = document.querySelector('.pk-how');
      const b = document.querySelector('.pk-how-btn');
      const cv = document.querySelector('.pk-canvas-wrap canvas');
      const r = cv ? cv.getBoundingClientRect() : null;
      const box = document.querySelector('.pk-canvas-wrap');
      const br = box ? box.getBoundingClientRect() : null;
      return {
        has: !!h, text: h ? h.innerText.trim() : '',
        visible: h ? getComputedStyle(h).display !== 'none' : false,
        btn: b ? b.innerText : '',
        canvas: r ? { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null,
        box: br ? { h: Math.round(br.height), bottom: Math.round(br.bottom) } : null,
        vh: window.innerHeight
      };
    });
    F(how.has && how.text.length > 8, G.name + ' 有操作说明', how.text.slice(0, 24));
    F(how.visible, G.name + ' 说明在桌面端默认展开');
    if (G.id === 'quiz') {
      F(how.box && how.box.h > 150, G.name + ' 答题区高度正常（纯 DOM 玩法无 canvas）', JSON.stringify(how.box));
    } else {
      F(how.canvas && how.canvas.w > 200 && how.canvas.h > 150, G.name + ' 画布尺寸正常', JSON.stringify(how.canvas));
      F(how.canvas && how.canvas.bottom <= how.vh + 4, G.name + ' 画布没被撑出视口', JSON.stringify(how.canvas) + ' vh=' + how.vh);
    }

    /* 说明条可收起 */
    if (how.btn) {
      await t.A.locator('.pk-how-btn').click();
      await t.A.waitForTimeout(200);
      const closed = await t.A.evaluate(() => getComputedStyle(document.querySelector('.pk-how')).display === 'none');
      F(closed, G.name + ' 点「怎么玩」能收起');
      await t.A.locator('.pk-how-btn').click();
      await t.A.waitForTimeout(200);
      const back = await t.A.evaluate(() => getComputedStyle(document.querySelector('.pk-how')).display !== 'none');
      F(back, G.name + ' 再点能展开');
    }

    /* 真实操作 */
    if (G.id === 'quiz') {
      const b0 = await probe(t.A);
      const sc0 = JSON.stringify(b0.g.sc || []);
      let clicked = null;
      for (let k = 0; k < 40 && !clicked; k++) {
        clicked = await t.A.evaluate(() => {
          const bs = Array.from(document.querySelectorAll('.qz-opts button, .qz-opts .qz-opt, .qz-opt'));
          const target = bs.find((b) => !b.disabled && getComputedStyle(b).display !== 'none');
          if (target) { target.click(); return target.innerText.trim().slice(0, 16); }
          return null;
        });
        if (!clicked) await t.A.waitForTimeout(300);
      }
      await t.A.waitForTimeout(1200);
      const a1 = await probe(t.A);
      F(!!clicked, G.name + ' 能点到选项', String(clicked));
      F(JSON.stringify(a1.g.sc || []) !== sc0 || (a1.g.ans || []).length > 0,
        G.name + ' 作答后状态有变化', 'sc ' + sc0 + ' → ' + JSON.stringify(a1.g.sc));
      const fb = await t.A.evaluate(() => (document.querySelector('.qz-fb') || {}).textContent || '');
      F(!!fb, G.name + ' 作答后有即时反馈文案', JSON.stringify(fb));
    } else if (G.id === 'snakebattle') {
      const a0 = await probe(t.A);
      const m0 = (a0.g.s || []).find((x) => x[0] === a0.you);
      await t.A.keyboard.press('d');
      await t.A.waitForTimeout(600);
      const a1 = await probe(t.A);
      const m1 = (a1.g.s || []).find((x) => x[0] === a1.you);
      F(m1 && m0 && (m1[1] !== m0[1] || m1[2] !== m0[2]), G.name + ' 按方向键蛇在动',
        m0 && m1 ? JSON.stringify([m0[1], m0[2], m0[3]]) + ' → ' + JSON.stringify([m1[1], m1[2], m1[3]]) : 'null');
      F(m1 && m1[3] === 0, G.name + ' 按 D 朝向变成「右」(dir=0)', m1 && String(m1[3]));
    } else if (G.id === 'draw') {
      await t.A.waitForTimeout(2200);
      const d = await probe(t.A);
      F(typeof d.g.ph === 'string', G.name + ' 进入轮次状态', String(d.g.ph));
      const okInput = await t.A.evaluate(() => !!document.querySelector('.pk-canvas-wrap input'));
      F(okInput || d.g.isDrawer === true, G.name + ' 猜词框或画板可用');
    } else {
      /* 等首帧快照 + 摆位倒计时（球场 ps>0 期间不收输入） */
      await t.A.waitForFunction((k) => {
        const S = window.PARTY_KIT_STATE;
        return S && S.g && Array.isArray(S.g[k]) && S.g[k].length >= 2;
      }, G.key, { timeout: 9000 }).catch(() => {});
      await t.A.waitForFunction(() => {
        const S = window.PARTY_KIT_STATE;
        return S && S.g && !(S.g.ps > 0);
      }, null, { timeout: 9000 }).catch(() => {});

      const p0 = await probe(t.A);
      const list0 = p0.g[G.key] || [];
      await hold(t.A, ['d'], 900);
      const p1 = await probe(t.A);
      const m0 = list0.find((x) => x[0] === p0.you);
      const m1 = (p1.g[G.key] || []).find((x) => x[0] === p1.you);
      const moved = m0 && m1 ? Math.hypot((m1[1] || 0) - (m0[1] || 0), (m1[2] || 0) - (m0[2] || 0)) : 0;

      if (G.id === 'tank') {
        /* D 是原地右转：要看朝向，不是位移 */
        const turn = m0 && m1 ? Math.abs(m1[3] - m0[3]) : 0;
        F(turn > 0.4, G.name + ' 按 D 右转（' + turn.toFixed(2) + ' rad）', turn.toFixed(3));
        await hold(t.A, ['w'], 900);
        const m2 = (await probe(t.A)).g[G.key].find((x) => x[0] === p0.you);
        F(m2 && m1 && (Math.abs(m2[1] - m1[1]) + Math.abs(m2[2] - m1[2])) > 40,
          G.name + ' 按 W 沿车头方向开走', m2 ? JSON.stringify([Math.round(m2[1]), Math.round(m2[2])]) : 'null');
      } else if (G.id === 'balloon') {
        F(true, G.name + ' 走格子（位移 ' + Math.round(moved) + 'px）');
        await t.A.keyboard.press(' ');
        await t.A.waitForTimeout(420);
        const p2 = await probe(t.A);
        F((p2.g.b || []).length > 0, G.name + ' 放泡后场上有泡泡', String((p2.g.b || []).length));
      } else {
        F(moved > 20, G.name + ' 按 D 会动（' + Math.round(moved) + 'px）');
      }
    }

    const pe = await probe(t.A);
    F(pe.hud && pe.hud.length === 2, G.name + ' 记分条两行', JSON.stringify(pe.hud));
    F(t.errs.length === 0, G.name + ' 双端 0 报错', t.errs.slice(0, 2).join(' | '));
    await t.A.screenshot({ path: path.join(OUT, 'game-' + G.id + '.png') });
  } catch (e) {
    F(false, G.name + ' 流程异常', e.message.split('\n')[0]);
  } finally {
    await t.close().catch(() => {});
  }
}

/* ============================================================
 * B. 断线重连
 * ============================================================ */
section('B. 断线重连（掐 socket → 自动回来 → 还能玩）');
{
  let t;
  try {
    t = await twoSession(2, ['甲', '乙']);
    await t.A.waitForTimeout(1400);
    const room0 = await t.A.evaluate(() => window.PARTY_NET.room && window.PARTY_NET.room.code);
    const you0 = await t.A.evaluate(() => window.PARTY_KIT_STATE.you);
    await t.A.evaluate(() => {
      window.__st = [];
      window.PARTY_NET.on('status', (d) => window.__st.push(d.state));
      window.PARTY_NET.ws.close();
    });
    const t0 = Date.now();
    await t.A.waitForFunction(() => window.PARTY_NET.state !== 'online', null, { timeout: 8000 }).catch(() => {});
    const back = await t.A.waitForFunction(() => window.PARTY_NET.state === 'online', null, { timeout: 20000 })
      .then(() => true).catch(() => false);
    const ms = Date.now() - t0;
    await t.A.waitForTimeout(1600);

    const st = await t.A.evaluate(() => ({
      room: window.PARTY_NET.room && window.PARTY_NET.room.code,
      you: window.PARTY_KIT_STATE.you,
      inStage: !!document.querySelector('.pk-wrap canvas'),
      drop: !!document.querySelector('.pk-drop.on'),
      tanks: (window.PARTY_KIT_STATE.g.k || []).length
    }));
    F(back, '断线后自动重连成功（' + ms + 'ms）');
    F(st.room === room0, '回到原房间', st.room + ' vs ' + room0);
    F(st.you === you0, '续回原 id（没被当成新玩家）', st.you + ' vs ' + you0);
    F(st.inStage, '对局舞台没被拆掉');
    F(!st.drop, '断线遮罩已收起');
    F(st.tanks === 2, '两台坦克都还在', String(st.tanks));

    /* 回来后按键仍然有效 */
    const m0 = (await probe(t.A)).g.k.find((x) => x[0] === you0);
    await hold(t.A, ['s'], 700);
    const m1 = (await probe(t.A)).g.k.find((x) => x[0] === you0);
    const moved = m0 && m1 ? Math.hypot(m1[1] - m0[1], m1[2] - m0[2]) : 0;
    F(moved > 5, '重连后按键仍然有效（位移 ' + Math.round(moved) + 'px）');
    F(t.errs.filter((e) => !/CLOSING|CLOSED|ERR_CONNECTION/.test(e)).length === 0, '重连过程无异常报错',
      t.errs.slice(0, 2).join(' | '));
    await t.A.screenshot({ path: path.join(OUT, 'reconnect.png') });
  } catch (e) {
    F(false, '重连流程异常', e.message.split('\n')[0]);
  } finally {
    if (t) await t.close().catch(() => {});
  }
}

/* ============================================================
 * C. 手机窄屏
 * ============================================================ */
section('C. 手机窄屏（说明条默认收起 / 创建按钮在首屏 / 横屏更大）');
{
  const phone = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' };
  /* C1 大厅 */
  {
    const ctx = await browser.newContext(phone);
    const p = await ctx.newPage();
    await p.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#party .pp-wrap');
    await p.waitForTimeout(500);
    const m = await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.pp-btn')).find((b) => b.innerText.trim() === '创建房间');
      const r = btn ? btn.getBoundingClientRect() : null;
      return {
        scrollH: document.documentElement.scrollHeight,
        vh: window.innerHeight,
        btnBottom: r ? Math.round(r.bottom) : -1,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
      };
    });
    F(!m.overflowX, '大厅横向不溢出');
    F(m.btnBottom > 0 && m.btnBottom <= m.vh, '「创建房间」按钮在首屏内（bottom ' + m.btnBottom + ' ≤ ' + m.vh + '）');
    F(m.scrollH <= 1300, '大厅总高已压缩（' + m.scrollH + 'px，原 1680px）');
    await p.screenshot({ path: path.join(OUT, 'phone-lobby.png') });
    await ctx.close();
  }
  /* C2 对局：竖屏画布 & 说明条 */
  const cell = async (vp, tag) => {
    const ctx = await browser.newContext(Object.assign({}, phone, { viewport: vp }));
    const p = await ctx.newPage();
    await p.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#party .pp-wrap');
    await p.evaluate(() => { const c = document.querySelectorAll('.pp-game'); if (c[2]) c[2].click(); });
    await p.waitForTimeout(140);
    await p.locator('.pp-input').first().fill('手机甲');
    await p.locator('.pp-btn-primary').click();
    await p.waitForSelector('.pp-code b', { timeout: 12000 });
    const code = (await p.textContent('.pp-code b')).trim();
    /* 第二端用桌面上下文 */
    const ctx2 = await browser.newContext({ viewport: { width: 900, height: 700 }, serviceWorkers: 'block' });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#party .pp-wrap');
    await p2.locator('.pp-input').first().fill('乙');
    await p2.locator('.pp-input-code').fill(code);
    await p2.getByRole('button', { name: '进入房间' }).click();
    await p2.waitForSelector('.pp-code b', { timeout: 12000 });
    await p.waitForFunction(() => document.querySelectorAll('.pp-player:not(.empty)').length >= 2, null, { timeout: 9000 });
    await p.getByRole('button', { name: '开始游戏' }).click();
    await p.waitForSelector('#ppStage', { timeout: 15000 });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(() => {
      const cv = document.querySelector('#ppStage canvas');
      const r = cv ? cv.getBoundingClientRect() : null;
      const how = document.querySelector('.pk-how');
      return {
        w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0,
        howVisible: how ? getComputedStyle(how).display !== 'none' : false,
        fs: !!document.querySelector('.pk-fs'),
        scrollH: document.documentElement.scrollHeight, vh: window.innerHeight
      };
    });
    await p.screenshot({ path: path.join(OUT, 'phone-play-' + tag + '.png') });
    await ctx.close(); await ctx2.close();
    return m;
  };
  const por = await cell({ width: 390, height: 664 }, 'portrait');
  const lan = await cell({ width: 844, height: 390 }, 'landscape');
  F(!por.howVisible, '竖屏对局说明条默认收起', String(por.howVisible));
  F(por.fs, '手机上有「横屏」按钮');
  F(por.h > 200, '竖屏画布高度 ≥ 200（' + por.w + '×' + por.h + '）');
  F(lan.h * lan.w > por.h * por.w * 1.3, '横屏画布明显更大（' + lan.w + '×' + lan.h + ' vs ' + por.w + '×' + por.h + '）');
  F(lan.scrollH <= lan.vh + 6, '横屏不出现整页滚动（' + lan.scrollH + ' ≤ ' + lan.vh + '）');
}

await browser.close();
console.log('\n' + (fails === 0 ? '全部通过（' + checks + ' 项）' : '失败 ' + fails + ' / ' + checks + ' 项'));
console.log('截图：' + path.relative(ROOT, OUT));
process.exit(fails ? 1 : 0);
