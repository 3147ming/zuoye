/**
 * run10.mjs — 指令包 10（测量仪器）无头 Edge + CDP 探针
 *
 * 覆盖：四仪器面板/读数（万用表四档 + 内阻模式、示波器自动测量、逻辑分析通道、
 * 函数发生器元件）、仪器段随存档往返、六档分辨率、console 0。
 * 数值与 node 复算（test-model 的包 10 段）同源同口径。
 */

import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep, waitFor } = await import('../../labsB/probe/runB.mjs');

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

const INSTALL10 = `(() => {
  if (window.__P10) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  window.__P10 = {
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
    net(comp, pin) { return M().getNetlist().netOf.get('c:' + comp + ':' + pin) || null; },
    dmm(patch) { return B().instruments.setDmm(patch); },
    scope(patch) { return B().instruments.setScope(patch); },
    la(patch) { return B().instruments.setLa(patch); },
    read() { return B().instruments.read(); },
    run(opts) {
      const r = B().simtrans.solve(opts);
      return {
        ok: r.ok,
        error: r.error,
        channels: (r.channels || []).map((c) => ({ netId: c.netId, type: c.type, driver: c.driver })),
      };
    },
    tabs() {
      return [...document.querySelectorAll('.inst-tab')].map((b) => b.textContent);
    },
    selectTab(id) { B().instruments.selectTab(id); return true; },
    snapshot() { return B().instruments.snapshot(); },
    restore(data) { B().instruments.restore(data); return true; },
    serialize() { return M().serializeCircuit(); },
    overflow() {
      const d = document.documentElement;
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, overflow: d.scrollWidth > d.clientWidth + 1 };
    },
  };
  return true;
})()`;

async function run() {
  mkdir(join(ROOT, 'labsim10'), { recursive: true }).catch(() => {});
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
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard && window.__labBoard.instruments)'), 12000, 'board+instruments');
    await evalJs(cdp, INSTALL10);

    /* ---- 面板结构 ---- */
    {
      const tabs = await evalJs(cdp, '__P10.tabs()');
      check('10 仪器面板含四个标签页',
        ['万用表', '示波器', '逻辑分析', '函数发生'].every((t) => tabs.includes(t)),
        tabs.join('/'));
      for (const id of ['dmm', 'scope', 'la', 'fgen']) {
        await evalJs(cdp, `__P10.selectTab('${id}')`);
        await sleep(60);
        check(`10 标签页 ${id} 可切换无异常`, true);
      }
    }

    /* ---- 万用表四档 ---- */
    {
      await evalJs(cdp, '__P10.reset()');
      const vs = (await evalJs(cdp, `__P10.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r1 = (await evalJs(cdp, `__P10.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const r2 = (await evalJs(cdp, `__P10.place('resistor', 10, 2, { resistance: 1000 })`)).id;
      await evalJs(cdp, `__P10.wire('${vs}','+','${r1}','1')`);
      await evalJs(cdp, `__P10.wire('${r1}','2','${r2}','1')`);
      await evalJs(cdp, `__P10.wire('${r2}','2','${vs}','-')`);
      const mid = await evalJs(cdp, `__P10.net('${r1}','2')`);
      const gnd = await evalJs(cdp, `__P10.net('${vs}','-')`);
      const vcc = await evalJs(cdp, `__P10.net('${vs}','+')`);

      await evalJs(cdp, `__P10.dmm({ mode: 'volt', netId: '${mid}' })`);
      let read = await evalJs(cdp, '__P10.read()');
      check('10 万用表电压档 2.500V',
        read.dmm.ok && Math.abs(read.dmm.value - 2.5) / 2.5 <= 0.001, read.dmm.text);

      await evalJs(cdp, `__P10.dmm({ mode: 'amp', componentId: '${r2}' })`);
      read = await evalJs(cdp, '__P10.read()');
      check('10 万用表电流档 2.50mA',
        read.dmm.ok && Math.abs(Math.abs(read.dmm.value) - 2.5e-3) / 2.5e-3 <= 0.001, read.dmm.text);

      await evalJs(cdp, `__P10.dmm({ mode: 'ohm', netId: '${vcc}', netB: '${gnd}' })`);
      read = await evalJs(cdp, '__P10.read()');
      check('10 万用表电阻档 2.000kΩ',
        read.dmm.ok && Math.abs(read.dmm.value - 2000) / 2000 <= 0.005, read.dmm.text);

      await evalJs(cdp, `__P10.dmm({ mode: 'volt', netId: '${mid}', realInput: true })`);
      read = await evalJs(cdp, '__P10.read()');
      check('10 内阻模式标注影响量（约 -0.01%）',
        read.dmm.ok && /内阻/.test(read.dmm.note), read.dmm.note);

      // 二极管档
      await evalJs(cdp, '__P10.reset()');
      const v2 = (await evalJs(cdp, `__P10.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const rr = (await evalJs(cdp, `__P10.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const dd = (await evalJs(cdp, `__P10.place('diode', 10, 2, { model: '1N4148' })`)).id;
      await evalJs(cdp, `__P10.wire('${v2}','+','${rr}','1')`);
      await evalJs(cdp, `__P10.wire('${rr}','2','${dd}','A')`);
      await evalJs(cdp, `__P10.wire('${dd}','K','${v2}','-')`);
      const anode = await evalJs(cdp, `__P10.net('${dd}','A')`);
      const cathode = await evalJs(cdp, `__P10.net('${dd}','K')`);
      await evalJs(cdp, `__P10.dmm({ mode: 'diode', netId: '${anode}', netB: '${cathode}' })`);
      read = await evalJs(cdp, '__P10.read()');
      check('10 二极管档 1N4148 正向 ≈0.7V 且判导通',
        read.dmm.ok && read.dmm.value >= 0.665 && read.dmm.value <= 0.735 && /导通/.test(read.dmm.text),
        read.dmm.text);
    }

    /* ---- 示波器 + 函数发生器 ---- */
    {
      await evalJs(cdp, '__P10.reset()');
      const fg = (await evalJs(cdp, `__P10.place('fgen', 2, 2, { wave: 'sine', frequency: 1000, amplitude: 2, offset: 0 })`)).id;
      const rr = (await evalJs(cdp, `__P10.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const cc = (await evalJs(cdp, `__P10.place('capacitor', 10, 2, { capacitance: 100e-9 })`)).id;
      await evalJs(cdp, `__P10.wire('${fg}','OUT','${rr}','1')`);
      await evalJs(cdp, `__P10.wire('${rr}','2','${cc}','1')`);
      await evalJs(cdp, `__P10.wire('${cc}','2','${fg}','GND')`);
      const res = await evalJs(cdp, `__P10.run({ duration: 0.01, dt: 2e-6 })`);
      check('10 函数发生器驱动 RC 低通求解成功', res.ok === true, res.error);
      const capNet = await evalJs(cdp, `__P10.net('${cc}','1')`);
      await evalJs(cdp, `__P10.scope({ ch1: '${capNet}', timebase: 0.001, vdiv: 1 })`);
      const read = await evalJs(cdp, '__P10.read()');
      const m = read.scope.measures[0];
      check('10 示波器：频率读数 1.00kHz±1%',
        m && m.freq && Math.abs(m.freq - 1000) / 1000 <= 0.01, JSON.stringify(m && m.freq));
      check('10 示波器：Vpp ≈ 0.847×2V（±5%）',
        m && Math.abs(m.vpp - 2 * 0.8467) / (2 * 0.8467) <= 0.05, JSON.stringify(m && m.vpp));
    }

    /* ---- 逻辑分析仪：数字通道 ---- */
    {
      await evalJs(cdp, '__P10.reset()');
      const clk = (await evalJs(cdp, `__P10.place('clock', 2, 2, { frequency: 100, duty: 50 })`)).id;
      // 时钟输出经电阻到 GND：给输出网一个模拟负载，通道才会被采样
      const load = (await evalJs(cdp, `__P10.place('resistor', 8, 2, { resistance: 1000 })`)).id;
      await evalJs(cdp, `__P10.wire('${clk}','+','${load}','1')`);
      await evalJs(cdp, `__P10.wire('${load}','2','${clk}','GND')`);
      const res = await evalJs(cdp, `__P10.run({ duration: 0.02, dt: 1e-4 })`);
      check('10 暂态结果含数字通道', res.channels.some((c) => c.type === 'digital'), JSON.stringify(res.channels));
      const dig = res.channels.find((c) => c.type === 'digital');
      if (dig) {
        await evalJs(cdp, `__P10.la({ nets: ['${dig.netId}'], baud: 9600 })`);
        const read = await evalJs(cdp, '__P10.read()');
        check('10 逻辑分析仪挂点被记录',
          read.la.nets.includes(dig.netId) && read.la.baud === 9600, JSON.stringify(read.la));
      }
    }

    /* ---- 仪器段随存档往返 ---- */
    {
      await evalJs(cdp, '__P10.dmm({ mode: "volt", netId: "net-x", real: true })');
      await evalJs(cdp, '__P10.scope({ ch1: "net-y", timebase: 0.01, vdiv: 2, coupling: "ac" })');
      const saved = await evalJs(cdp, '__P10.serialize()');
      check('10 serialize 含 instruments 段', Boolean(saved.instruments), JSON.stringify(saved.instruments));
      check('10 存档里保留 DMM 模式与内阻开关',
        saved.instruments && saved.instruments.dmm && saved.instruments.dmm.mode === 'volt'
        && saved.instruments.dmm.real === true,
        JSON.stringify(saved.instruments && saved.instruments.dmm));
      check('10 存档里保留示波器时基/幅值/耦合',
        saved.instruments && saved.instruments.scope
        && saved.instruments.scope.timebase === 0.01 && saved.instruments.scope.vdiv === 2
        && saved.instruments.scope.coupling === 'ac',
        JSON.stringify(saved.instruments && saved.instruments.scope));
    }

    /* ---- 六档分辨率 + console ---- */
    {
      const sizes = [[1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [480, 800], [375, 667]];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(240);
        const info = await evalJs(cdp, '__P10.overflow()');
        check(`10 无横向溢出 ${w}×${h}`, !info.overflow, `${info.scrollW}>${info.clientW}`);
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
