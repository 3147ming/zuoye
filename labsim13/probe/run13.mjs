/**
 * run13.mjs — 指令包 13（实验配置/故障注入/评分）无头 Edge + CDP 探针
 */
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep, waitFor } = await import('../../labsB/probe/runB.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_URL = 'http://127.0.0.1:5360/';

let pass = 0; let fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`OK   ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ' -> ' + detail : ''}`); console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

async function run() {
  mkdir(join(ROOT, 'labsim13'), { recursive: true }).catch(() => {});
  const serverProc = await ensureServer();
  let edgeProc = null;
  try {
    const boot = await bootEdge();
    const { cdp } = boot;
    edgeProc = boot.edge;
    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : String(a.description || a.type || ''))).join(' ');
      if (p.type === 'error' || p.type === 'assert') consoleErrors.push(text);
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails || {};
      consoleErrors.push(d.exception && d.exception.description ? d.exception.description : (d.text || 'uncaught'));
    });
    cdp.on('Log.entryAdded', (p) => { if ((p.entry || {}).level === 'error') consoleErrors.push((p.entry || {}).text || 'log-error'); });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: APP_URL });
    await loaded;
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labSimReady)'), 12000, 'app');
    await evalJs(cdp, `(() => { const c = [...document.querySelectorAll('.exp-card')].find((x) => x.dataset.expId === 'ex-e1-divider'); if (!c) return false; c.click(); return true; })()`);
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard && window.__labBoard.config)'), 12000, 'board+config');
    await sleep(500);

    // 方案应用
    const applied = await evalJs(cdp, `__labBoard.config.apply('S1')`);
    check('13 应用 S1 方案成功', applied && applied.ok === true, JSON.stringify(applied));
    const params = await evalJs(cdp, `(() => { const st = __labBoard.model.getState(); return st.components.filter((c) => c.id === 'r1' || c.id === 'r2').map((c) => c.params.resistance); })()`);
    check('13 方案参数写入元件（1k/1k）', params.every((r) => r === 1000), JSON.stringify(params));

    // 正常评分
    const graded = await evalJs(cdp, `__labBoard.config.grade('S1')`);
    check('13 正常电路评分 100', graded.score === 100 && graded.done === 2, JSON.stringify(graded));

    // 故障：R1 开路 → 中点 0V → 掉分
    await evalJs(cdp, `__labBoard.config.setFaults([{ type: 'open', componentId: 'r1' }])`);
    await sleep(400);
    const mid = await evalJs(cdp, `(() => { const net = __labBoard.model.getNetlist().netOf.get('c:r1:2'); const res = __labBoard.simdc.last(); const n = (res.nodeVoltages || []).find((x) => x.netId === net); return n ? n.v : null; })()`);
    check('13 F1 注入 R1 开路后中点 ≈0V', mid !== null && Math.abs(mid) < 0.05, String(mid));
    const gradedFault = await evalJs(cdp, `__labBoard.config.grade('S1')`);
    check('13 故障场景评分下降并列出疑似故障',
      gradedFault.score < 100 && gradedFault.suspects.length > 0, JSON.stringify(gradedFault));

    // 清除故障 → 恢复
    await evalJs(cdp, `__labBoard.config.setFaults([])`);
    await sleep(400);
    const gradedBack = await evalJs(cdp, `__labBoard.config.grade('S1')`);
    check('13 清除故障后评分恢复 100', gradedBack.score === 100, JSON.stringify(gradedBack));

    // 撤销应用方案
    const undoOk = await evalJs(cdp, `(() => { __labBoard.model.undo(); const c = __labBoard.model.findComponent('r1'); return c ? c.params.resistance : null; })()`);
    check('13 撤销可恢复方案参数', undoOk === null || typeof undoOk === 'number', String(undoOk));

    // 六档分辨率 + console
    const sizes = [[1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [480, 800], [375, 667]];
    for (const [w, h] of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(220);
      const info = await evalJs(cdp, `(() => { const d = document.documentElement; return { s: d.scrollWidth, c: d.clientWidth }; })()`);
      check(`13 无横向溢出 ${w}×${h}`, info.s <= info.c + 1, `${info.s}>${info.c}`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    check('console 错误 0 条', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    if (edgeProc) edgeProc.kill();
    if (serverProc) serverProc.kill();
  }
}

run().catch((err) => {
  console.error('探针运行失败：', err && err.stack ? err.stack : err);
  console.log(`\n=== 探针结果：${pass}/${pass + fail} 通过 ===`);
  process.exitCode = 1;
}).then(() => {
  console.log(`\n=== 探针结果：${pass}/${pass + fail} 通过 ===`);
  if (fail > 0) { console.log('未通过项：'); failures.forEach((f) => console.log(`  × ${f}`)); process.exitCode = 1; }
});
