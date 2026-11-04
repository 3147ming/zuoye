/**
 * test-chips.mjs — 8 颗 MSI 芯片逻辑模型自测（指令包 16 · 任务 A 验收）
 *
 * 覆盖 74LS138 / 148 / 151 / 283 / 85 / 112 / 160 / 194 共 19 项真值表与
 * 时序行为断言（组合芯片直接调 model.fn，时序芯片单步推进 units[0].fn）。
 *
 * 运行：node tools/test-chips.mjs
 * 判定：日志末尾出现 `=== 芯片模型自测：19/19 通过 ===` 即真跑完。
 */

import { NEW_DIG_MODELS } from '../js/digital-chips.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`OK   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${extra ? ' → ' + extra : ''}`);
    console.log(`FAIL ${name}${extra ? ' → ' + extra : ''}`);
  }
}

const M = NEW_DIG_MODELS;

/* ---- 74LS138 3-8 译码器 ---- */
{
  const fn = M['74LS138'].fn;
  const off = fn({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 });
  ok('LS138 未使能全高', ['7', '9', '10', '11', '12', '13', '14', '15'].every((p) => off[p] === 1), JSON.stringify(off));
  const s0 = fn({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1 });
  ok('LS138 选0 Y0=0', s0['15'] === 0 && s0['14'] === 1 && s0['9'] === 1, JSON.stringify(s0));
  const s5 = fn({ 1: 1, 2: 0, 3: 1, 4: 0, 5: 0, 6: 1 });
  ok('LS138 选5 Y5=0', s5['10'] === 0 && s5['15'] === 1 && s5['7'] === 1, JSON.stringify(s5));
}

/* ---- 74LS148 8-3 优先编码器 ---- */
{
  const fn = M['74LS148'].fn;
  const none = fn({ 4: 1, 3: 1, 2: 1, 1: 1, 13: 1, 12: 1, 11: 1, 10: 1, 5: 0 });
  ok('LS148 无输入 GS=1 EO=0 A=111',
    none['14'] === 1 && none['15'] === 0 && none['6'] === 1 && none['7'] === 1 && none['9'] === 1,
    JSON.stringify(none));
  const in3 = fn({ 4: 1, 3: 1, 2: 1, 1: 0, 13: 1, 12: 1, 11: 1, 10: 1, 5: 0 });
  ok('LS148 IN3 → A=100 GS=0',
    in3['9'] === 1 && in3['7'] === 0 && in3['6'] === 0 && in3['14'] === 0 && in3['15'] === 1,
    JSON.stringify(in3));
  const in7 = fn({ 4: 0, 3: 1, 2: 1, 1: 1, 13: 1, 12: 1, 11: 1, 10: 0, 5: 0 });
  ok('LS148 IN7 优先 → A=000', in7['9'] === 0 && in7['7'] === 0 && in7['6'] === 0, JSON.stringify(in7));
}

/* ---- 74LS151 8 选 1 ---- */
{
  const fn = M['74LS151'].fn;
  const r = fn({ 1: 1, 2: 0, 3: 1, 4: 1, 7: 0, 9: 0, 10: 1, 11: 0, 12: 1, 13: 1, 14: 1, 15: 1 });
  ok('LS151 sel=2 Y=D2=0 W=1', r['5'] === 0 && r['6'] === 1, JSON.stringify(r));
  const dis = fn({ 1: 1, 2: 0, 3: 1, 4: 1, 7: 1, 9: 0, 10: 1, 11: 0, 12: 1, 13: 1, 14: 1, 15: 1 });
  ok('LS151 未使能 Y=0 W=1', dis['5'] === 0 && dis['6'] === 1, JSON.stringify(dis));
}

/* ---- 74LS283 四位全加器 ---- */
{
  const fn = M['74LS283'].fn;
  // 3 + 5 = 8：A=0011 B=0101 C0=0
  const r = fn({ 5: 1, 3: 1, 14: 0, 12: 0, 6: 1, 2: 0, 15: 1, 11: 0, 7: 0 });
  ok('LS283 3+5=8', r['4'] === 0 && r['1'] === 0 && r['13'] === 0 && r['10'] === 1 && r['9'] === 0, JSON.stringify(r));
  // 15 + 1 = 0 进 1
  const c = fn({ 5: 1, 3: 1, 14: 1, 12: 1, 6: 1, 2: 0, 15: 0, 11: 0, 7: 0 });
  ok('LS283 15+1=0 进1', c['4'] === 0 && c['1'] === 0 && c['13'] === 0 && c['10'] === 0 && c['9'] === 1, JSON.stringify(c));
}

/* ---- 74LS85 数值比较器 ---- */
{
  const fn = M['74LS85'].fn;
  // A=1010(10) B=0111(7) → A>B
  const r = fn({ 10: 0, 12: 1, 13: 0, 15: 1, 9: 1, 11: 1, 14: 1, 1: 0, 2: 0, 3: 1, 4: 0 });
  ok('LS85 A>B', r['5'] === 1 && r['6'] === 0 && r['7'] === 0, JSON.stringify(r));
  // A=B=5，级联 IA=B=1 → 相等
  const e = fn({ 10: 1, 12: 0, 13: 1, 15: 0, 9: 1, 11: 0, 14: 1, 1: 0, 2: 0, 3: 1, 4: 0 });
  ok('LS85 A=B 级联相等', e['5'] === 0 && e['6'] === 1 && e['7'] === 0, JSON.stringify(e));
}

/* ---- 74LS112 双 JK（下降沿） ---- */
{
  const unit = M['74LS112'].units[0]; // FF1: clk=1,k=2,j=3,pr=4,q=5,qb=6,clr=15
  let state;
  const step = (clk, j, k) => {
    const e = unit.fn({ 1: clk, 2: k, 3: j, 4: 1, 15: 1 }, state);
    state = e.state;
    return e;
  };
  let r = step(1, 1, 0); // 先到高电平
  r = step(0, 1, 0);     // 下降沿
  ok('LS112 J=1,K=0 下降沿置位', r.outputs['5'] === 1, JSON.stringify(r.outputs));
  r = step(1, 1, 1);
  r = step(0, 1, 1);
  ok('LS112 J=K=1 翻转', r.outputs['5'] === 0, JSON.stringify(r.outputs));
  r = unit.fn({ 1: 0, 2: 0, 3: 0, 4: 1, 15: 0 }, state);
  ok('LS112 异步清零', r.outputs['5'] === 0 && r.outputs['6'] === 1, JSON.stringify(r.outputs));
}

/* ---- 74LS160 十进制计数器 ---- */
{
  const unit = M['74LS160'].units[0];
  let state;
  const step = (clk) => {
    const e = unit.fn({ 1: 1, 2: clk, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 9: 1, 10: 1 }, state);
    state = e.state;
    return e;
  };
  const seen = [];
  for (let i = 0; i < 10; i += 1) {
    step(0);
    const q = step(1);
    const val = (q.outputs['14']) + (q.outputs['13']) * 2 + (q.outputs['12']) * 4 + (q.outputs['11']) * 8;
    seen.push(val);
  }
  ok('LS160 计数 1..9 回 0', JSON.stringify(seen) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]), JSON.stringify(seen));
  const r9 = unit.fn({ 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1, 9: 1, 10: 1 }, { count: 8, clk: 0 });
  ok('LS160 计数到9 RCO=1',
    r9.outputs['15'] === 1 && r9.outputs['14'] === 1 && r9.outputs['11'] === 1, JSON.stringify(r9.outputs));
}

/* ---- 74LS194 移位寄存器 ---- */
{
  const unit = M['74LS194'].units[0];
  // S1S0=11 并行置数 0001
  let state = unit.fn({ 1: 1, 2: 0, 9: 1, 10: 1, 11: 0, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0 }, null).state;
  state = unit.fn({ 1: 1, 2: 0, 9: 1, 10: 1, 11: 1, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0 }, state).state;
  let e = unit.fn({ 1: 1, 2: 0, 9: 1, 10: 1, 11: 1, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0 }, state);
  ok('LS194 并行置数 0001',
    JSON.stringify([e.outputs['15'], e.outputs['14'], e.outputs['13'], e.outputs['12']]) === '[1,0,0,0]',
    JSON.stringify(e.outputs));
  // S1S0=01 右移，DSR=1
  state = e.state;
  state = unit.fn({ 1: 1, 2: 1, 9: 1, 10: 0, 11: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }, state).state;
  e = unit.fn({ 1: 1, 2: 1, 9: 1, 10: 0, 11: 1, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }, state);
  ok('LS194 右移 DSR=1 → 1100',
    JSON.stringify([e.outputs['15'], e.outputs['14'], e.outputs['13'], e.outputs['12']]) === '[1,1,0,0]',
    JSON.stringify(e.outputs));
}

console.log('');
if (failures.length > 0) {
  console.log('未通过项：');
  failures.forEach((f) => console.log(`  × ${f}`));
}
console.log(`=== 芯片模型自测：${pass}/${pass + fail} 通过 ===`);
if (fail > 0) process.exitCode = 1;
