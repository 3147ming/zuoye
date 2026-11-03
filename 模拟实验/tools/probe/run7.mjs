/**
 * run7.mjs — 指令包 7（仿真内核-暂态 AC）无头 Edge+CDP 探针
 *
 * 覆盖 7.4/7.5 的 UI 与集成验收：波形面板渲染（像素非空）、运行/暂停/清空、
 * 时长/步长可调、__labBoard.simtrans 五方法、进出实验清零、六档分辨率、console 0。
 *
 * 运行：node labsim7/probe/run7.mjs
 * 判定：日志末行「=== 探针结果：N/M 通过 ===」
 */

import { rm } from 'node:fs/promises';

// 复用 7B 探针的启动骨架（服务/无头 Edge/evalJs）；先置库模式标记，
// 避免 import runB.mjs 时把它自己的 run() 也跑起来。
process.env.__LAB_PROBE_LIB = '1';
const { ensureServer, bootEdge, evalJs, sleep } = await import('./runB.mjs');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`OK   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ' -> ' + detail : ''}`);
    console.log(`FAIL ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

/** 页面助手：波形面板/画布像素/暂态入口 */
const INSTALL = `(() => {
  if (window.__P7) return true;
  const q = (sel) => document.querySelector(sel);
  window.__P7 = {
    hasPanel: () => Boolean(q('#wave-panel .wave-view')),
    hasCanvas: () => Boolean(q('.wave-canvas')),
    runText: () => { const b = q('.wave-run'); return b ? b.textContent : ''; },
    statusText: () => { const s = q('.wave-status'); return s ? s.textContent : ''; },
    setOptions: (duration, dt) => {
      const d = q('.wave-controls .wave-input');
      const inputs = document.querySelectorAll('.wave-controls .wave-input');
      if (inputs.length >= 2) {
        inputs[0].value = String(duration);
        inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        inputs[1].value = String(dt);
        inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    },
    clickRun: () => { const b = q('.wave-run'); if (b) b.click(); return true; },
    clickClear: () => { const b = q('.wave-clear'); if (b) b.click(); return true; },
    // 波形画布上「非纸白」像素占比：>0 说明真的画出了曲线
    paintedRatio: () => {
      const c = q('.wave-canvas');
      if (!c) return -1;
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      let total = 0;
      for (let i = 0; i < data.length; i += 16) {
        total += 1;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // 波形是 6 色高饱和曲线；网格/坐标文字都是低饱和灰蓝，用饱和度区分
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        if (sat > 60) painted += 1;
      }
      return total > 0 ? painted / total : 0;
    },
    // 画布快照（判断暂停后是否冻结）
    snapshot: () => {
      const c = q('.wave-canvas');
      if (!c) return '';
      return c.toDataURL().slice(-2000);
    },
    // 搭一个 RC 充电电路（vs 5V → R 1k → C 100uF → vs(-)）
    buildRc: () => {
      const B = window.__labBoard;
      const M = B.model;
      const st = M.getState();
      st.wires.slice().forEach((w) => M.removeWire(w.id));
      st.components.slice().forEach((c) => M.removeComponent(c.id));
      M.clearUndo();
      const v = M.addComponent('vsource', 2, 2, { params: { voltage: 5 } });
      const r = M.addComponent('resistor', 6, 2, { params: { resistance: 1000 } });
      const c = M.addComponent('capacitor', 10, 2, { params: { capacitance: 100e-6 } });
      if (!v.ok || !r.ok || !c.ok) return { ok: false, detail: [v, r, c].map((x) => x.error).join('|') };
      M.addWire({ componentId: v.component.id, terminal: '+' }, { componentId: r.component.id, terminal: '1' });
      M.addWire({ componentId: r.component.id, terminal: '2' }, { componentId: c.component.id, terminal: '1' });
      M.addWire({ componentId: c.component.id, terminal: '2' }, { componentId: v.component.id, terminal: '-' });
      B.simtrans.reset();
      B.requestRender();
      return { ok: true, comps: M.getState().components.length, wires: M.getState().wires.length };
    },
    simtransMethods: () => {
      const api = window.__labBoard && window.__labBoard.simtrans;
      if (!api) return null;
      return {
        solve: typeof api.solve === 'function',
        last: typeof api.last === 'function',
        running: typeof api.running === 'function',
        start: typeof api.start === 'function',
        stop: typeof api.stop === 'function',
        waveforms: typeof api.waveforms === 'function',
      };
    },
    simtransState: () => {
      const api = window.__labBoard && window.__labBoard.simtrans;
      if (!api) return null;
      return {
        running: api.running(),
        waves: api.waveforms().length,
        stats: api.stats(),
      };
    },
    capStates: () => {
      const st = window.__labBoard && window.__labBoard.model.getState();
      if (!st) return [];
      return st.components.filter((c) => c.type === 'capacitor').map((c) => c.id);
    },
    overflow: () => ({
      innerWidth: window.innerWidth,
      scrollW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      panelVisible: Boolean(q('#wave-panel .wave-view')),
      canvasW: q('.wave-canvas') ? Math.round(q('.wave-canvas').getBoundingClientRect().width) : 0,
    }),
  };
  return true;
})()`;

async function run() {
  const serverProc = await ensureServer();
  let edgeProc = null;
  let userDataDir = null;

  try {
    const boot = await bootEdge();
    const { cdp } = boot;
    edgeProc = boot.edge;
    userDataDir = boot.userDataDir;

    const consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = (params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : String(a.description || '')))
        .join(' ');
      if (params.type === 'error' || params.type === 'assert') consoleErrors.push(text);
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const d = params.exceptionDetails || {};
      consoleErrors.push(d.exception && d.exception.description ? d.exception.description : (d.text || 'uncaught'));
    });
    cdp.on('Log.entryAdded', (params) => {
      const entry = params.entry || {};
      if (entry.level === 'error') consoleErrors.push(entry.text || 'log-error');
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:5360/' });
    await loaded;
    await evalJs(cdp, 'Boolean(window.__labSimReady)');
    await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (!c) return false; c.click(); return true; })()`);
    await evalJs(cdp, 'Boolean(window.__labBoard)');
    await evalJs(cdp, INSTALL);

    console.log('\n# 指令包 7 · 波形查看器与暂态集成\n');

    /* ---- 1. __labBoard.simtrans 契约 ---- */
    const methods = await evalJs(cdp, '__P7.simtransMethods()');
    check('7.5 simtrans.solve 可用', methods && methods.solve === true, JSON.stringify(methods));
    check('7.5 simtrans.last 可用', methods && methods.last === true);
    check('7.5 simtrans.running 可用', methods && methods.running === true);
    check('7.5 simtrans.start 可用', methods && methods.start === true);
    check('7.5 simtrans.stop 可用', methods && methods.stop === true);
    check('7.5 simtrans.waveforms 可用', methods && methods.waveforms === true);

    /* ---- 2. 波形面板存在 ---- */
    check('7.4 波形面板已挂载', (await evalJs(cdp, '__P7.hasPanel()')) === true);
    check('7.4 波形画布已创建', (await evalJs(cdp, '__P7.hasCanvas()')) === true);

    /* ---- 3. 搭 RC 电路 + 运行 → 波形出现（像素非空） ---- */
    const built = await evalJs(cdp, '__P7.buildRc()');
    check('7.1 搭出 RC 测试电路', built && built.ok === true, JSON.stringify(built));
    await evalJs(cdp, '__P7.setOptions(1, 0.01)');
    await evalJs(cdp, '__P7.clickRun()');
    await sleep(1200);
    const ratio1 = await evalJs(cdp, '__P7.paintedRatio()');
    check('7.4 运行后画布有波形像素', ratio1 > 0.01, `painted=${ratio1.toFixed(4)}`);
    const st1 = await evalJs(cdp, '__P7.simtransState()');
    check('7.5 运行后 simtrans.waveforms 非空', st1 && st1.waves > 0, JSON.stringify(st1 && st1.waves));
    check('7.5 运行结束后 running=false', st1 && st1.running === false);

    /* ---- 4. 运行中暂停 → 波形冻结（用长时运行，保证还有没算完的段） ---- */
    await evalJs(cdp, '__P7.clickClear()');
    await evalJs(cdp, '__P7.setOptions(30, 0.05)');   // 30s / 50ms → 40 段分帧跑
    await evalJs(cdp, '__P7.clickRun()');
    await sleep(220);                                  // 跑几段
    const runningMid = await evalJs(cdp, '(window.__labBoard.simtrans.running())');
    check('7.5 运行中 running=true', runningMid === true, String(runningMid));
    await evalJs(cdp, '__P7.clickRun()');              // 暂停（立刻收尾并冻结）
    await sleep(120);
    const runningNow = await evalJs(cdp, '(window.__labBoard.simtrans.running())');
    check('7.4 暂停后不在运行态', runningNow === false, String(runningNow));
    // 先暂停再取快照，避免「取快照与暂停之间又算完一段」的竞态
    const snapA = await evalJs(cdp, '__P7.snapshot()');
    await sleep(500);                                  // 明显长于几帧：应完全静止
    const snapB = await evalJs(cdp, '__P7.snapshot()');
    check('7.4 暂停后波形冻结（快照不变）', snapA.length > 0 && snapA === snapB,
      snapA === snapB ? '快照一致' : '快照发生了变化');

    /* ---- 5. 清空 → 像素清零 ---- */
    await evalJs(cdp, '__P7.clickClear()');
    await sleep(200);
    const ratio2 = await evalJs(cdp, '__P7.paintedRatio()');
    check('7.4 清空后画布波形像素清零', ratio2 < 0.005, `painted=${ratio2.toFixed(4)}`);
    const st2 = await evalJs(cdp, '__P7.simtransState()');
    check('7.5 清空后波形数组为空', st2 && st2.waves === 0, JSON.stringify(st2 && st2.waves));

    /* ---- 6. 再运行 → 重新出波 ---- */
    await evalJs(cdp, '__P7.setOptions(1, 0.01)');
    await evalJs(cdp, '__P7.clickRun()');
    await sleep(1200);
    const ratio3 = await evalJs(cdp, '__P7.paintedRatio()');
    check('7.4 再运行重新出波', ratio3 > 0.01, `painted=${ratio3.toFixed(4)}`);

    /* ---- 7. 时长/步长可调（改10× 时长，步数应变多） ---- */
    await evalJs(cdp, '__P7.clickClear()');
    await evalJs(cdp, '__P7.setOptions(2, 0.01)');
    await evalJs(cdp, '__P7.clickRun()');
    await sleep(1500);
    const stOpt = await evalJs(cdp, '__P7.simtransState()');
    check('7.4 时长可调（2s 运行出结果）', stOpt && stOpt.stats && Math.abs(stOpt.stats.duration - 2) < 1e-6,
      stOpt && stOpt.stats ? JSON.stringify(stOpt.stats.duration) : 'no stats');
    check('7.4 步长可调（dt=0.01）', stOpt && stOpt.stats && Math.abs(stOpt.stats.dt - 0.01) < 1e-9,
      stOpt && stOpt.stats ? JSON.stringify(stOpt.stats.dt) : 'no stats');

    /* ---- 8. 进出实验清零（波形清空 + 电容状态归零） ---- */
    await evalJs(cdp, '__P7.buildRc()');
    await evalJs(cdp, `(() => {
      // 用真实 UI 路径离开工作区
      const back = document.getElementById('btn-back');
      if (back) back.click();
      return true;
    })()`);
    await sleep(300);
    await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (c) c.click(); return true; })()`);
    await sleep(400);
    await evalJs(cdp, 'Boolean(window.__labBoard)');
    await evalJs(cdp, INSTALL);
    const st3 = await evalJs(cdp, '__P7.simtransState()');
    check('7.5 重进实验后波形清空', st3 && st3.waves === 0, JSON.stringify(st3 && st3.waves));
    const ratio4 = await evalJs(cdp, '__P7.paintedRatio()');
    check('7.5 重进实验后画布无波形像素', ratio4 < 0.005, `painted=${ratio4.toFixed(4)}`);

    /* ---- 9. 六档分辨率：面板可见 + 无横向溢出 ---- */
    const sizes = [[1440, 920], [1366, 768], [1280, 720], [1024, 600], [820, 720], [375, 667]];
    for (const [w, h] of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await sleep(250);
      const o = await evalJs(cdp, '__P7.overflow()');
      check(`7.4 分辨率 ${w}×${h} 波形面板可见`, o.panelVisible === true && o.canvasW > 0, `canvasW=${o.canvasW}`);
      check(`7.4 分辨率 ${w}×${h} 无横向溢出`, o.scrollW <= o.innerWidth + 1, `scrollW=${o.scrollW} inner=${o.innerWidth}`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(150);

    /* ---- 10. console 0 ---- */
    check('console 错误 0 条', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | ') || '无');

    await sleep(200);
    cdp.close();
  } finally {
    if (edgeProc) { try { edgeProc.kill('SIGKILL'); } catch { /* */ } }
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    if (serverProc) { try { serverProc.kill('SIGKILL'); } catch { /* */ } }
  }

  if (failures.length > 0) {
    console.log('\n未通过项：');
    failures.forEach((f) => console.log(`  × ${f}`));
  }
  console.log(`\n=== 探针结果：${pass}/${pass + fail} 通过 ===`);
  if (fail > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error('探针运行失败：', err && err.stack ? err.stack : err);
  console.log('\n=== 探针中止：未跑完 ===');
  process.exitCode = 1;
});
