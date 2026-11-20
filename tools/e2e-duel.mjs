/* ============================================================
 * tools/e2e-duel.mjs —— 联机「弹弹岛对战」双会话端到端回归
 * ------------------------------------------------------------
 * 前置：node server/index.js（8787）
 * 覆盖：八号玩法出现在大厅 → 双会话建房 → 开局 → 两人分左右岸 →
 *       轮流开火有炮弹 → 命中互相扣血 → 走位 → 无 JS 报错。
 * ============================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '内容加厚核验', 'duel');
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8787';
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const section = (t) => console.log('\n=== ' + t + ' ===');

try { const r = await fetch(BASE + '/healthz'); if (!r.ok) throw 0; }
catch { console.log('连不上 ' + BASE + '，先起 server/index.js'); process.exit(2); }

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const errs = [];
async function mk(nm) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(nm + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(nm + ': ' + m.text()); });
  await page.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#party .pp-wrap', { timeout: 12000 });
  return { ctx, page };
}

const probe = (page) => page.evaluate(() => {
  const S = window.PARTY_KIT_STATE;
  if (!S) return { S: null };
  return { S: true, you: S.you, ph: S.g.ph, act: S.g.act, tl: S.g.tl, w: S.g.w,
           p: S.g.p, shots: S.g.s.length, hasIsles: !!S.g.is, bl: S.g.bl.length };
});

try {
  section('A. 大厅出现弹弹岛对战');
  const A = await mk('甲'), B = await mk('乙');
  const cardNames = await A.page.$$eval('.pp-game b', (els) => els.map((e) => e.textContent));
  ok('大厅有「弹弹岛对战」', cardNames.some((n) => n.includes('弹弹岛对战')), JSON.stringify(cardNames));
  const duelIdx = cardNames.findIndex((n) => n.includes('弹弹岛对战'));

  section('B. 双会话建房开局');
  await A.page.evaluate((i) => document.querySelectorAll('.pp-game')[i].click(), duelIdx);
  await A.page.waitForTimeout(140);
  await A.page.locator('.pp-input').first().fill('甲');
  await A.page.getByRole('button', { name: '创建房间' }).click();
  await A.page.waitForSelector('.pp-code b', { timeout: 12000 });
  const code = (await A.page.textContent('.pp-code b')).trim();
  await B.page.locator('.pp-input').first().fill('乙');
  await B.page.locator('.pp-input-code').fill(code);
  await B.page.getByRole('button', { name: '进入房间' }).click();
  await B.page.waitForSelector('.pp-code b', { timeout: 12000 });
  await A.page.waitForFunction(() => document.querySelectorAll('.pp-player:not(.empty)').length >= 2, null, { timeout: 10000 });
  ok('两人进同一房间', code.length > 0, code);
  await A.page.getByRole('button', { name: '开始游戏' }).click();
  await A.page.waitForSelector('#ppStage', { timeout: 15000 });
  await B.page.waitForSelector('#ppStage', { timeout: 15000 });
  await A.page.waitForTimeout(600);

  section('C. 开局状态');
  let sa = await probe(A.page), sb = await probe(B.page);
  ok('两份快照都到齐', sa.S === true && sb.S === true);
  ok('两个玩家都在', sa.p && sa.p.length === 2, JSON.stringify(sa.p));
  ok('地形岛屿已下发', sa.hasIsles === true);
  ok('有巡逻气球', sa.bl >= 1, String(sa.bl));
  /* 一个左岸(dir=1)一个右岸(dir=-1)：真人对轰的关键 */
  ok('两人分处左右岸', sa.p && sa.p.some((u) => u[5] === 1) && sa.p.some((u) => u[5] === -1),
     JSON.stringify(sa.p.map((u) => [u[0], u[5]])));
  ok('双方 you 不同', sa.you !== sb.you);
  ok('当前轮到其中一人', !!sa.act, String(sa.act));

  section('D. 轮流开火 + 命中扣血');
  /* 让轮到的一方用「朝对方、45°、满力」开火。角度够不到时多打几发。 */
  const hpBefore = sa.p.map((u) => u[3]);
  let fired = 0;
  for (let r = 0; r < 18; r++) {
    const s = await probe(A.page);
    if (!s.S || s.ph !== 'aim' || !s.act) { await A.page.waitForTimeout(400); continue; }
    const actor = s.act === s.you ? A.page : B.page;
    /* 用与服务端一致的弹道搜一组能落到对方附近的解，验证「真人真能互相命中」 */
    const sol = await actor.evaluate(() => {
      const S = window.PARTY_KIT_STATE, g = S.g;
      const me = g.p.find((u) => u[0] === S.you);
      const foe = g.p.find((u) => u[0] !== S.you && u[3] > 0);
      if (!me || !foe || !g.is) return null;
      const G = 860, DT = 1 / 120, SPD = 1060, W = 1200, H = 675;
      function solid(x, y) {
        for (const s of g.is) {
          if (x < s[0]-s[2] || x > s[0]+s[2] || y < s[1]) continue;
          const e = Math.abs(x-s[0])/s[2];
          if (y >= s[1]+Math.round(e*e*16)) return true;
        }
        return false;
      }
      let best = null;
      for (let a = 18; a <= 82; a += 2) for (let p = 0.3; p <= 1.001; p += 0.025) {
        const rad = a*Math.PI/180, sp = SPD*p;
        let vx = me[5]*Math.cos(rad)*sp, vy = -Math.sin(rad)*sp;
        let x = me[1]+me[5]*Math.cos(rad)*34, y = me[2]-Math.sin(rad)*34;
        for (let i = 0; i < 600; i++) {
          vx += g.w*DT; vy += G*DT; x += vx*DT; y += vy*DT;
          if (y > H+30 || x < -60 || x > W+60) break;
          if (solid(x, y)) break;
          let hu = false;
          for (const u of g.p) if (u[0] !== S.you && u[3] > 0 && Math.hypot(u[1]-x, u[2]-y) < 24) { hu = true; break; }
          if (hu) break;
        }
        const miss = Math.hypot(x-foe[1], y-foe[2]);
        if (!best || miss < best.miss) best = { a, p: Math.round(p*100)/100, miss };
      }
      return best;
    });
    if (sol) await actor.evaluate((v) => window.PARTY_KIT_STATE.net.input({ angle: v.a, power: v.p }), sol);
    else await actor.evaluate(() => window.PARTY_KIT_STATE.net.input({ angle: 45, power: 0.8 }));
    await actor.waitForTimeout(60);
    await actor.evaluate(() => window.PARTY_KIT_STATE.net.action('fire'));
    fired++;
    /* 等这一发飞完并进入下一回合 */
    await A.page.waitForFunction(() => {
      const g = window.PARTY_KIT_STATE.g;
      return g.ph === 'aim' && (!g.s || g.s.length === 0);
    }, null, { timeout: 15000 }).catch(() => {});
    await A.page.waitForTimeout(200);
  }
  ok('双方都真实开过火', fired >= 2, '开了 ' + fired + ' 发');
  sa = await probe(A.page);
  const hpAfter = sa.p.map((u) => u[3]);
  ok('开火后有玩家掉血', hpAfter.some((h, i) => h < hpBefore[i]),
     JSON.stringify({ hpBefore, hpAfter }));

  section('E. 走位与零报错');
  /* 轮到自己时按 D 走位 */
  let moved = false;
  for (let r = 0; r < 6 && !moved; r++) {
    const s = await probe(A.page);
    if (!s.S || s.ph !== 'aim' || !s.act) { await A.page.waitForTimeout(400); continue; }
    const actor = s.act === s.you ? A.page : B.page;
    const x0 = (await probe(actor)).p.find((u) => u[0] === s.act)[1];
    await actor.keyboard.down('d'); await actor.waitForTimeout(300); await actor.keyboard.up('d');
    await actor.waitForTimeout(150);
    const s2 = await probe(actor);
    const x1 = s2.p.find((u) => u[0] === s.act)[1];
    if (Math.abs(x1 - x0) > 2) moved = true;
  }
  ok('玩家能在岛上走位', moved);
  ok('全程零 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

  await A.page.screenshot({ path: path.join(OUT, 'duel-play.png') });
  await A.ctx.close(); await B.ctx.close();
} catch (e) {
  ok('脚本未中断', false, e.message);
  console.error(e);
} finally {
  await browser.close();
}

console.log('\n===== 结果：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
if (fails.length) { console.log('失败项：' + fails.join('、')); process.exit(1); }
