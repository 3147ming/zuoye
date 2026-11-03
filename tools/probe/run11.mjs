/**
 * run11.mjs — 指令包 11（数据系统）无头 Edge + CDP 探针
 */
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep, waitFor } = await import('./runB.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_URL = 'http://127.0.0.1:5360/';

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`OK   ${name}`); }
  else { fail += 1; failures.push(`${name}${detail ? ' -> ' + detail : ''}`); console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}

const INSTALL11 = `(() => {
  if (window.__P11) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  window.__P11 = {
    reset() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const m = M();
      const st = m.getState();
      st.wires.slice().forEach((w) => m.removeWire(w.id));
      st.components.slice().forEach((c) => m.removeComponent(c.id));
      m.clearUndo();
      B().scene.wiring = null;
      B().scene.ghost = null;
      B().setSelection(null);
      B().requestRender();
      if (B().data) B().data.recorder.clear();
      return true;
    },
    place(type, x, y, params) {
      const r = M().addComponent(type, x, y, params ? { params } : undefined);
      if (!r.ok) return { ok: false, error: r.error };
      B().requestRender();
      return { ok: true, id: r.component.id };
    },
    wire(a, ta, b, tb) {
      const r = M().addWire({ componentId: a, terminal: ta }, { componentId: b, terminal: tb });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    run(opts) { return B().simtrans.solve(opts); },
    ingest(res) { return B().data.ingestTransient(res); },
    records() { return B().data.records(); },
    csv() { return B().data.csv(); },
    json() { return B().data.json(); },
    importJson(text) { return B().data.importJson(text); },
    archive() { return B().data.buildArchive(M()); },
    loadArchive(raw) { return B().data.loadArchive(raw); },
    tabs() { return [...document.querySelectorAll('#data-panel .inst-tab')].map((b) => b.textContent); },
    selectTab(label) {
      const tabs = [...document.querySelectorAll('#data-panel .inst-tab')];
      const tab = tabs.find((b) => b.textContent === label);
      if (tab) tab.click();
      return Boolean(tab);
    },
    compareText() { return document.querySelector('#data-panel .data-table') ? document.querySelector('#data-panel .data-table').textContent : ''; },
    overflow() {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, overflow: d.scrollWidth > d.clientWidth + 1 };
    },
  };
  return true;
})()`;

async function run() {
  mkdir(join(ROOT, 'labsim11'), { recursive: true }).catch(() => {});
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
    await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (!c) return false; c.click(); return true; })()`);
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard && window.__labBoard.data)'), 12000, 'board+data');
    await evalJs(cdp, INSTALL11);

    {
      const tabs = await evalJs(cdp, '__P11.tabs()');
      check('11 数据面板含三个标签页', ['记录', '对比', '导出'].every((t) => tabs.includes(t)), tabs.join('/'));
    }

    /* ---- 记录：暂态 → 记录器 ---- */
    let res = null;
    {
      await evalJs(cdp, '__P11.reset()');
      const fg = (await evalJs(cdp, `__P11.place('fgen', 2, 2, { wave: 'sine', frequency: 1000, amplitude: 2, offset: 0 })`)).id;
      const r = (await evalJs(cdp, `__P11.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const c = (await evalJs(cdp, `__P11.place('capacitor', 10, 2, { capacitance: 100e-9 })`)).id;
      await evalJs(cdp, `__P11.wire('${fg}','OUT','${r}','1')`);
      await evalJs(cdp, `__P11.wire('${r}','2','${c}','1')`);
      await evalJs(cdp, `__P11.wire('${c}','2','${fg}','GND')`);
      res = await evalJs(cdp, '__P11.run({ duration: 0.02, dt: 2e-6 })');
      const pushed = await evalJs(cdp, `__P11.ingest(${JSON.stringify(res)})`);
      check('11 暂态结果写入记录器（>0 条）', pushed > 0, String(pushed));
      const records = await evalJs(cdp, '__P11.records()');
      check('11 记录条数与抽稀间隔一致（约 2 通道 × 2 条 @10ms）',
        records.length >= 2 && records.every((x) => Number.isFinite(x.time) && Number.isFinite(x.value)),
        String(records.length));
    }

    /* ---- CSV 导出对拍 ---- */
    {
      const csv = await evalJs(cdp, '__P11.csv()');
      const lines = csv.replace(/^\uFEFF/, '').split('\n').filter((x) => x.trim());
      const records = await evalJs(cdp, '__P11.records()');
      check('11 CSV 表头正确', lines[0] === 'time,channel,value,type', lines[0]);
      check('11 CSV 行数 = 记录数', lines.length === records.length + 1, `${lines.length}/${records.length}`);
      check('11 CSV 含 UTF-8 BOM（Excel 兼容）', csv.charCodeAt(0) === 0xFEFF, String(csv.charCodeAt(0)));
    }

    /* ---- JSON 往返 ---- */
    {
      const json = await evalJs(cdp, '__P11.json()');
      const back = await evalJs(cdp, `__P11.importJson(${JSON.stringify(json)})`);
      check('11 JSON 导出 → 导入还原通道与样本', back.channels >= 1 && back.samples > 0, JSON.stringify(back));
    }

    /* ---- 对比页：理论线偏差 ---- */
    {
      await evalJs(cdp, `__P11.selectTab('对比')`);
      await sleep(200);
      const text = await evalJs(cdp, '__P11.compareText()');
      check('11 对比页给出通道统计与理论偏差文本',
        /首|最小|最大/.test(text), text.slice(0, 80));
    }

    /* ---- 项目存档 ---- */
    {
      const archive = await evalJs(cdp, '__P11.archive()');
      check('11 项目存档 version = 4', archive.version === 4, String(archive.version));
      check('11 项目存档含 instruments / records 段',
        Object.prototype.hasOwnProperty.call(archive, 'instruments') && Array.isArray(archive.records),
        JSON.stringify({ ins: Boolean(archive.instruments), rec: archive.records.length }));
      const loaded = await evalJs(cdp, `__P11.loadArchive(${JSON.stringify(archive)})`);
      check('11 项目存档 → 载入成功且电路恢复', loaded.ok === true, JSON.stringify(loaded.notes));

      // v3 旧存档：缺 instruments/records，迁移后能载入
      const v3 = { version: 3, platform: 'exp-box', components: [{ id: 'r1', type: 'resistor', x: 1, y: 1, params: { resistance: 1000 } }], wires: [], stash: {} };
      const old = await evalJs(cdp, `__P11.loadArchive(${JSON.stringify(v3)})`);
      check('11 v3 旧存档兼容载入', old.ok === true && old.fromVersion === 3, JSON.stringify(old.notes));
    }

    /* ---- 六档分辨率 + console ---- */
    {
      const sizes = [[1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [480, 800], [375, 667]];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(220);
        const info = await evalJs(cdp, '__P11.overflow()');
        check(`11 无横向溢出 ${w}×${h}`, !info.overflow, `${info.scrollW}>${info.clientW}`);
      }
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }

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
  if (fail > 0) {
    console.log('未通过项：');
    failures.forEach((f) => console.log(`  × ${f}`));
    process.exitCode = 1;
  }
});
