/**
 * run12.mjs — 指令包 12（示例实验 + 报告）无头 Edge + CDP 探针
 */
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep, waitFor } = await import('./runB.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_URL = 'http://127.0.0.1:5360/';

let pass = 0; let fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`OK   ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ' -> ' + detail : ''}`); console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

async function run() {
  mkdir(join(ROOT, 'labsim12'), { recursive: true }).catch(() => {});
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

    // 示例卡片
    const cards = await evalJs(cdp, `[...document.querySelectorAll('.exp-card')].map((c) => c.dataset.expId)`);
    check('12 实验列表出现 8 个示例', ['ex-e1-divider','ex-e2-led','ex-e3-rc','ex-e4-diode','ex-e5-npn','ex-e6-opamp','ex-e7-nand','ex-e8-divider74'].every((id) => cards.includes(id)), cards.join(','));

    // 打开 E1
    await evalJs(cdp, `(() => { const c = [...document.querySelectorAll('.exp-card')].find((x) => x.dataset.expId === 'ex-e1-divider'); if (!c) return false; c.click(); return true; })()`);
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard)'), 12000, 'board');
    await sleep(600);
    const state = await evalJs(cdp, `(() => { const st = window.__labBoard.model.getState(); return { comps: st.components.map((c) => c.type), wires: st.wires.length }; })()`);
    check('12 打开 E1 自动装载模板电路（3 元件 3 导线）',
      state.comps.length === 3 && state.wires === 3 && state.comps.includes('vsource'), JSON.stringify(state));

    const guide = await evalJs(cdp, `(() => { const g = document.getElementById('guide-panel'); if (!g) return null; return { hidden: g.hidden, steps: g.querySelectorAll('.guide-steps li').length, lines: g.querySelectorAll('.inst-measure-line').length, hasReportBtn: /生成实验报告/.test(g.textContent) }; })()`);
    check('12 指导书显示步骤/预期值/报告按钮',
      guide && guide.hidden === false && guide.steps === 3 && guide.lines >= 2 && guide.hasReportBtn,
      JSON.stringify(guide));

    // 复算（页面内调用同一模块）
    const measured = await evalJs(cdp, `(async () => {
      const EM = await import('/js/examples-measure.js');
      const EX = await import('/js/examples-data.js');
      const ex = EX.EXAMPLES.find((e) => e.id === 'ex-e1-divider');
      return EM.measureExample(window.__labBoard.model, ex);
    })()`);
    check('12 页面内复算 E1 全部预期通过',
      measured && measured.ok === true && measured.items.every((i) => i.pass), JSON.stringify(measured && measured.items));

    // 报告 HTML
    const html = await evalJs(cdp, `(async () => {
      const EM = await import('/js/examples-measure.js');
      const RP = await import('/js/report.js');
      const EX = await import('/js/examples-data.js');
      const ex = EX.EXAMPLES.find((e) => e.id === 'ex-e1-divider');
      const m = EM.measureExample(window.__labBoard.model, ex);
      const canvas = document.getElementById('breadboard-canvas');
      return RP.buildReportHtml({
        title: ex.title,
        time: '2026-11-03 20:00',
        screenshot: canvas ? canvas.toDataURL('image/png') : '',
        circuit: EM.circuitSummary(window.__labBoard.model),
        items: m.items,
        observations: '探针生成的观察',
      });
    })()`);
    check('12 报告含标题/测量表/结论/观察/截图',
      html.includes('示例 E1') && html.includes('中点电压') && html.includes('结论') && html.includes('探针生成的观察') && html.includes('data:image/png;base64,'),
      html.slice(0, 60));
    check('12 报告单文件可离线打开（A4 打印样式）', html.includes('@page') && !/<script/.test(html), '');

    // 六档分辨率 + console
    const sizes = [[1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [480, 800], [375, 667]];
    for (const [w, h] of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(220);
      const info = await evalJs(cdp, `(() => { const d = document.documentElement; return { s: d.scrollWidth, c: d.clientWidth }; })()`);
      check(`12 无横向溢出 ${w}×${h}`, info.s <= info.c + 1, `${info.s}>${info.c}`);
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
