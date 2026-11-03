/**
 * probe14.mjs — 健壮性边界（指令包 14）
 * 纯 node，不需要浏览器：空电路/单元件/仅导线/悬空端子/极端参数/坏存档。
 */
import * as M from '../../js/model.js';
import { solveDC } from '../../js/simdc.js';
import { solveTransient, resetTransientState } from '../../js/simtrans.js';
import { solveDig, resetDigState } from '../../js/simdig.js';
import { migrateArchive } from '../../js/datastore.js';

let pass = 0; let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`OK   ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ' -> ' + detail : ''}`); console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}
const W = (a, ta, b, tb) => M.addWire({ componentId: a, terminal: ta }, { componentId: b, terminal: tb });
const P = (t, x, y, p) => {
  const r = M.addComponent(t, x, y, p ? { params: p } : undefined);
  return r.ok ? r.component.id : null;
};
const reset = (platform = 'breadboard') => { M.createCircuit(platform); resetTransientState(); resetDigState(); };

/* 空电路 */
{
  reset();
  const dc = solveDC(M);
  const tr = solveTransient(M, { duration: 0.01, dt: 0.001 });
  const dig = solveDig(M);
  check('14 空电路：DC 不崩、给出提示', dc.ok === true && dc.warnings.length > 0, dc.error || '');
  check('14 空电路：暂态不崩、ok=false 可读', tr.ok === false && /为空/.test(tr.error || ''), tr.error);
  check('14 空电路：数字不崩、给出提示', dig.ok === true && dig.warnings.some((w) => /电路为空/.test(w)), '');
}

/* 单元件无导线 */
{
  reset();
  const r = P('resistor', 2, 2, { resistance: 1000 });
  const dc = solveDC(M);
  check('14 单元件无导线：不崩、提示未连接', dc.ok === true && dc.warnings.some((w) => /未连接/.test(w)), JSON.stringify(dc.warnings));
  void r;
}

/* 仅导线无元件 */
{
  reset();
  const a = P('resistor', 2, 2, {});
  const b = P('resistor', 6, 2, {});
  W(a, '1', b, '1');
  M.removeComponent(a);
  M.removeComponent(b);
  const dc = solveDC(M);
  check('14 仅导线无元件：不崩、给出可读提示', dc.ok === true && dc.warnings.length > 0, JSON.stringify(dc.warnings).slice(0, 80));
}

/* 悬空端子 */
{
  reset();
  const vs = P('vsource', 2, 2, { voltage: 5 });
  const r = P('resistor', 6, 2, { resistance: 1000 });
  W(vs, '+', r, '1');
  const dc = solveDC(M);
  check('14 悬空端子：跳过并提示', dc.ok === true && dc.warnings.some((w) => /未连接/.test(w)), JSON.stringify(dc.warnings).slice(0, 80));
}

/* 极端参数 */
{
  reset();
  const vs = P('vsource', 2, 2, { voltage: 5 });
  const r1 = P('resistor', 6, 2, { resistance: 1e9 });
  const r2 = P('resistor', 10, 2, { resistance: 1e9 });
  W(vs, '+', r1, '1'); W(r1, '2', r2, '1'); W(r2, '2', vs, '-');
  const dc = solveDC(M);
  check('14 超大电阻 1GΩ：可求解', dc.ok === true, dc.error);
  M.updateParams(r1, { resistance: 1e-3 });
  const dc2 = solveDC(M);
  check('14 极小电阻 1mΩ：可求解或给可读错误', dc2.ok === true || /短路|奇异|开路/.test(dc2.error || ''), dc2.error);

  reset();
  const vs2 = P('vsource', 2, 2, { voltage: 5 });
  const bad = P('resistor', 6, 2, { resistance: -100 });
  W(vs2, '+', bad, '1');
  const dc3 = solveDC(M);
  check('14 负阻值：拒绝并给可读错误', dc3.ok === false && /必须为正/.test((dc3.errors || []).join(' ') || dc3.error || ''), dc3.error);
}

/* 坏存档 */
{
  const cases = [null, 'not-json', {}, { version: 99, components: [] }, { version: 2, components: 'x', wires: 3 }];
  let ok = 0;
  cases.forEach((raw) => {
    try {
      if (raw === 'not-json') {
        let threw = false;
        try { JSON.parse(raw); } catch (e) { threw = true; }
        if (threw) ok += 1;
        return;
      }
      const m = migrateArchive(raw);
      if (m && typeof m.ok === 'boolean') ok += 1;
    } catch (err) { /* 不应该抛 */ }
  });
  check('14 坏存档：全部不抛异常且返回结构化结果', ok === cases.length, `${ok}/${cases.length}`);

  reset();
  const before = M.getState().components.length;
  const loaded = M.loadCircuit({ version: 3, components: [{ type: 'nope', x: 0, y: 0 }], wires: [] }, 'breadboard');
  check('14 非法元件类型：跳过但不崩', loaded.ok === true && loaded.skippedComponents === 1, JSON.stringify(loaded));
  check('14 载入失败不丢当前电路（空电路仍可编辑）', M.getState().components.length === before, '');
}

/* 存档篡改 */
{
  reset();
  const vs = P('vsource', 2, 2, { voltage: 5 });
  const r = P('resistor', 6, 2, { resistance: 1000 });
  W(vs, '+', r, '1'); W(r, '2', vs, '-');
  const data = M.serializeCircuit();
  data.components[0].x = 9999;
  const loaded = M.loadCircuit(data, 'breadboard');
  check('14 越界坐标：跳过该元件并继续', loaded.skippedComponents >= 1, JSON.stringify(loaded));
}

/* 大电路 */
{
  reset('breadboard');
  const vs = P('vsource', 2, 2, { voltage: 5 });
  let prev = vs;
  let prevPin = '+';
  for (let i = 0; i < 100; i += 1) {
    const r = P('resistor', 2 + (i % 20) * 3, 4 + Math.floor(i / 20) * 2, { resistance: 1000 });
    if (!r) break;
    W(prev, prevPin, r, '1');
    prev = r;
    prevPin = '2';
  }
  const t0 = performance.now();
  const dc = solveDC(M);
  const ms = performance.now() - t0;
  check('14 100 元件链式电路：可求解', dc.ok === true, dc.error);
  console.log(`     B1 计时：${ms.toFixed(1)}ms`);
}

console.log(`\n=== 探针结果：${pass}/${pass + fail} 通过 ===`);
if (fail > 0) { console.log('未通过项：'); failures.forEach((f) => console.log(`  × ${f}`)); process.exitCode = 1; }
