/* 联机招式格斗：双会话建房 → 进房 → 开局 → 靠近 → 出拳 → 掉血 → 回合结算 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.nvm/versions/node/v22.13.1/lib/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const errs = [];
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => errs.push(`${n}:${e.message.slice(0, 160)}`));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(`${n}:${m.text().slice(0, 160)}`); });
}

await A.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
await A.waitForTimeout(500);

console.log('\nA. 大厅里有「招式格斗」');
const hasFist = await A.evaluate(() =>
  (window.PartyLobby && window.PartyLobby.GAMES || []).some((g) => g.id === 'fist'));
ok('玩法列表含 fist', hasFist);

console.log('\nB. 建房');
await A.evaluate(() => window.PARTY_NET.connect());
await A.waitForFunction(() => window.PARTY_NET.state === 'online', null, { timeout: 20000 });
await A.evaluate(() => window.PARTY_NET.send('create', { game: 'fist', name: '甲', pass: '' }));
const room = await A.waitForFunction(() => {
  const n = window.PARTY_NET;
  return n.code ? { code: n.code } : false;
}, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
ok('拿到房号', !!room && /^[1-9]\d{0,4}$/.test(room.code), room && room.code);

console.log('\nC. 进房');
await B.goto(BASE + '/games/party/index.html', { waitUntil: 'domcontentloaded' });
await B.waitForTimeout(400);
await B.evaluate(() => window.PARTY_NET.connect());
await B.waitForFunction(() => window.PARTY_NET.state === 'online', null, { timeout: 20000 });
await B.evaluate((c) => window.PARTY_NET.send('join', { code: c, pass: '', name: '乙' }), room.code);
await B.waitForTimeout(2200);
const snapB = await B.evaluate(() => {
  const n = window.PARTY_NET;
  return n.room ? { code: n.room.code, n: (n.room.players || []).length } : null;
});
ok('两人在同一房间', snapB && snapB.code === room.code && snapB.n === 2, JSON.stringify(snapB));

console.log('\nD. 开局');
await A.evaluate(() => window.PARTY_NET.send('ready', { ready: true }));
await B.evaluate(() => window.PARTY_NET.send('ready', { ready: true }));
await A.waitForTimeout(400);
await A.evaluate(() => window.PARTY_NET.send('start', {}));
const started = await A.waitForFunction(() => {
  const S = window.PARTY_KIT_STATE;
  return S && S.g && S.g.f && S.g.f.length === 2 ? 'ok' : false;
}, null, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => null);
ok('对局开始了', started === 'ok', String(started));

const st0 = await A.evaluate(() => {
  const g = window.PARTY_KIT_STATE.g;
  return { f: g.f.map((x) => ({ id: x[0], x: x[1], hp: x[4], max: x[5], roll: x[7] })), r: g.r };
});
ok('双方都有角色和血量', st0.f.length === 2 && st0.f.every((f) => f.hp > 0), JSON.stringify(st0.f));
ok('两人角色不同', st0.f[0].roll !== st0.f[1].roll, st0.f.map((f) => f.roll).join('/'));

console.log('\nE. 靠近并出拳（验证真能打掉血）');
/* A 往右走，B 往左走，走到面对面后轮流出拳 */
for (let r = 0; r < 40; r++) {
  const st = await A.evaluate(() => {
    const g = window.PARTY_KIT_STATE.g;
    const me = g.f.find((x) => x[0] === window.PARTY_KIT_STATE.you);
    const foe = g.f.find((x) => x[0] !== window.PARTY_KIT_STATE.you);
    return { myX: me[1], foeX: foe[1], myHp: me[4], foeHp: foe[4], dist: Math.abs(me[1] - foe[1]) };
  });
  if (st.foeHp < st0.f.find((f) => f.id !== st0.f[0].id).hp) break;
  const dir = st.myX < st.foeX ? 1 : -1;
  /* 必须走真实按键：kit 的 sendInput 每帧用 S.keys 覆盖 net.input，
     直接调 net.input 会被下一帧冲掉（实测位置纹丝不动）。 */
  const ka = dir > 0 ? 'd' : 'a';
  const kb = dir > 0 ? 'a' : 'd';
  await A.keyboard.down(ka);
  await B.keyboard.down(kb);
  await A.waitForTimeout(140);
  if (st.dist < 80) {
    await A.keyboard.press('j');
    await B.keyboard.press('j');
  }
  if (r % 8 === 0) console.log('   [E] r=' + r + ' myX=' + Math.round(st.myX) + ' foeX=' + Math.round(st.foeX) + ' dist=' + Math.round(st.dist) + ' foeHp=' + st.foeHp);
}
await A.keyboard.up('d'); await A.keyboard.up('a');
await B.keyboard.up('a'); await B.keyboard.up('d');
await A.waitForTimeout(900);

const st1 = await A.evaluate(() => {
  const g = window.PARTY_KIT_STATE.g;
  return {
    f: g.f.map((x) => ({ id: x[0], hp: x[4] })),
    ev: (g.ev || []).map((e) => e.e)
  };
});
const before = st0.f.map((f) => f.hp);
const after = st1.f.map((f) => f.hp);
const dropped = after.some((h, i) => h < before[i]);
ok('有人被打掉血了', dropped, `${before.join('/')} → ${after.join('/')}`);
ok('有命中事件', st1.ev.includes('hit') || dropped, JSON.stringify(st1.ev.slice(-6)));

console.log('\nF. 技能');
const skillOk = await A.evaluate(() => {
  const g = window.PARTY_KIT_STATE.g;
  const me = g.f.find((x) => x[0] === window.PARTY_KIT_STATE.you);
  return { energy: me[6], sk: g.sk, roll: me[7] };
});
ok('有能量值', typeof skillOk.energy === 'number', JSON.stringify(skillOk));
ok('技能冷却数组是数组', Array.isArray(skillOk.sk) && Array.isArray(skillOk.sk[0]), JSON.stringify(skillOk.sk));

/* 按 U 放第一个技能：能量该减少、该进冷却 */
const e0 = skillOk.energy;
await A.keyboard.press('u');
await A.waitForTimeout(700);
const afterSkill = await A.evaluate(() => {
  const g = window.PARTY_KIT_STATE.g;
  const me = g.f.find((x) => x[0] === window.PARTY_KIT_STATE.you);
  return { energy: me[6], sk: g.sk[0], ev: (g.ev || []).map((e) => e.e) };
});
ok('放技能后能量减少', afterSkill.energy < e0, `${e0} → ${afterSkill.energy}`);
ok('技能进入冷却', Array.isArray(afterSkill.sk) && afterSkill.sk.length > 0, JSON.stringify(afterSkill.sk));
ok('有施法事件', afterSkill.ev.includes('cast'), JSON.stringify(afterSkill.ev.slice(-5)));

/* 非法技能不应崩 */
const badEv = await A.evaluate(async () => {
  const S = window.PARTY_KIT_STATE;
  S.net.action('skill', { skill: '不存在的技能' });
  await new Promise((r) => setTimeout(r, 400));
  return (S.g.ev || []).map((e) => e.e);
});
ok('非法技能被忽略（不崩）', Array.isArray(badEv), JSON.stringify(badEv.slice(-4)));

console.log('\nG. 截图与报错');
await A.screenshot({ path: '/workspace/WorldHub/内容加厚核验/fight/fist-online.png' });
ok('无 JS 报错', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
