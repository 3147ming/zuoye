/**
 * run8.mjs — 指令包 8（混合信号内核）无头 Edge + CDP 探针
 *
 * 覆盖：4 个边界元件入库/放置/旋转/参数、H1–H5 数值标准、
 * 混合波形（模拟/数字同轴 + type 标注）、跨域环路报错、状态行"混合仿真"、
 * 六档分辨率无横向溢出、console 0。
 *
 * 运行：node labsim8/probe/run8.mjs
 * 判定：日志末尾出现「=== 探针结果：N/M 通过 ===」即真跑完。
 */

import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 先标记"只当库用"，再动态 import —— 否则 runB 的模块级自运行会一起跑起来
process.env.__LAB_PROBE_LIB = '1';
const {
  ensureServer,
  bootEdge,
  evalJs,
  sleep,
  waitFor,
} = await import('./runB.mjs');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const APP_URL = 'http://127.0.0.1:5360/';

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

const INSTALL8 = `(() => {
  if (window.__P8) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  const S = () => B().simtrans;
  window.__P8 = {
    reset() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const m = M();
      const st = m.getState();
      st.wires.slice().forEach((w) => m.removeWire(w.id));
      st.components.slice().forEach((c) => m.removeComponent(c.id));
      m.clearUndo();
      B().scene.wiring = null;
      B().scene.ghost = null;
      B().scene.pointer = null;
      B().setSelection(null);
      B().simmix.reset();
      B().simtrans.reset();
      B().requestRender();
      return true;
    },
    place(type, x, y, params) {
      const r = M().addComponent(type, x, y, params ? { params } : undefined);
      if (!r.ok) return { ok: false, error: r.error };
      B().requestRender();
      return { ok: true, id: r.component.id, rotation: r.component.rotation };
    },
    wire(a, ta, b, tb) {
      const r = M().addWire({ componentId: a, terminal: ta }, { componentId: b, terminal: tb });
      B().requestRender();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    state() {
      const st = M().getState();
      return {
        comps: st.components.map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, rotation: c.rotation, params: c.params })),
        wires: st.wires.length,
      };
    },
    terms(id) { return B().geometry.terminals(id); },
    rotate(id) {
      B().setSelection({ type: 'component', id });
      const r = B().interact.rotate();
      B().requestRender();
      return r && r.ok ? true : String((r && r.error) || '失败');
    },
    params(id, patch) {
      const r = M().updateParams(id, patch);
      B().requestRender();
      return r.ok ? true : String(r.error);
    },
    run(opts) {
      const res = S().solve(opts || { duration: 0.002, dt: 0.001 });
      const flips = [];
      const dw = (res.waveforms || []).find((w) => w.type === 'digital');
      if (dw) {
        for (let i = 1; i < dw.samples.length; i += 1) {
          if ((dw.samples[i - 1].v > 2.5) !== (dw.samples[i].v > 2.5)) flips.push(dw.samples[i].t);
        }
      }
      return {
        flips,
        ok: res.ok,
        error: res.error,
        detail: res.detail,
        cycle: res.cycle || [],
        stats: res.stats,
        channels: (res.channels || []).map((c) => ({ netId: c.netId, type: c.type, driver: c.driver })),
        waveforms: (res.waveforms || []).map((w) => ({ netId: w.netId, type: w.type, n: w.samples.length, first: w.samples[0], last: w.samples[w.samples.length - 1] })),
      };
    },
    mixState(id) { return B().simmix.stateOf(id); },
    mixStates() { return B().simmix.state(); },
    mixUnits() { return B().simmix.units(); },
    loops() { return B().simmix.loops(); },
    maxIter() { return B().simmix.maxIter(); },
    statusText() {
      const el = document.getElementById('canvas-status');
      return el ? el.textContent : '';
    },
    simulate() { B().simdc.solve('probe8'); return true; },
    palette() {
      const items = [...document.querySelectorAll('.palette-item')];
      const groups = [...document.querySelectorAll('.palette-group')].map((g) => {
        const t = g.querySelector('.palette-group-title');
        return t ? t.textContent : '';
      });
      return { count: items.length, types: items.map((el) => el.dataset.partType), groups };
    },
    wavePanel() {
      const host = document.getElementById('wave-panel');
      return { exists: Boolean(host), hasCanvas: Boolean(host && host.querySelector('canvas')) };
    },
    overflow() {
      const doc = document.documentElement;
      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        overflow: doc.scrollWidth > doc.clientWidth + 1,
      };
    },
  };
  return true;
})()`;

async function run() {
  mkdir(join(ROOT, 'labsim8'), { recursive: true }).catch(() => {});

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
        .map((a) => (a.value !== undefined ? String(a.value) : String(a.description || a.type || '')))
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    const loaded = new Promise((res) => cdp.on('Page.loadEventFired', res));
    await cdp.send('Page.navigate', { url: APP_URL });
    await loaded;
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labSimReady)'), 12000, 'app 就绪');
    await evalJs(cdp, `(() => { const c = document.querySelector('.exp-card'); if (!c) return false; c.click(); return true; })()`);
    await waitFor(async () => evalJs(cdp, 'Boolean(window.__labBoard)'), 12000, '实验台就绪');
    await evalJs(cdp, INSTALL8);

    /* ============ 2.1 四个边界元件入库 ============ */
    {
      const palette = await evalJs(cdp, '__P8.palette()');
      const wanted = ['comparator', 'buffer74', 'dac8', 'adc8'];
      check('2.1 四个边界元件都在元件库',
        wanted.every((t) => palette.types.includes(t)),
        palette.types.join(','));
      check('2.1 元件库出现「混合信号」分组',
        palette.groups.includes('混合信号'), palette.groups.join('/'));
    }

    /* ============ 2.1 放置 / 端子 / 四向旋转 ============ */
    {
      await evalJs(cdp, '__P8.reset()');
      const placed = {};
      const layout = { comparator: [2, 2], buffer74: [8, 2], dac8: [12, 2], adc8: [24, 2] };
      for (const type of ['comparator', 'buffer74', 'dac8', 'adc8']) {
        const r = await evalJs(cdp, `__P8.place('${type}', ${layout[type][0]}, ${layout[type][1]})`);
        check(`2.1 放置 ${type}`, r && r.ok === true, JSON.stringify(r));
        placed[type] = r && r.id;
      }
      const units = await evalJs(cdp, '__P8.mixUnits()');
      check('2.1 边界元件被 simmix 识别为 4 个单元', units.length === 4, JSON.stringify(units.map((u) => u.kind)));

      // 四向旋转：占位尺寸 0/180 相同、90/270 交换
      const cmpId = placed.comparator;
      const sizes = [];
      const termSeen = [];
      for (const step of [0, 90, 180, 270]) {
        const st = await evalJs(cdp, '__P8.state()');
        const me = st.comps.find((c) => c.id === cmpId);
        const rect = await evalJs(cdp, `(() => { const c = window.__labBoard.model.findComponent('${cmpId}'); return window.__labBoard.model.rectOf(c); })()`);
        const terms = await evalJs(cdp, `__P8.terms('${cmpId}')`);
        termSeen.push(terms.map((t) => `${t.name}@${t.x},${t.y}`).join('|'));
        sizes.push(me && me.rotation === step ? `${rect.w}x${rect.h}` : 'bad');
        if (step !== 270) {
          await evalJs(cdp, `__P8.rotate('${cmpId}')`);
        }
      }
      check('2.1 比较器四向旋转 0→90→180→270', sizes.every((x) => x === '3x3'), sizes.join(','));
      check('2.1 比较器端子随旋转落到不同网格位',
        new Set(termSeen).size === 4, termSeen.join(' / '));

      // DAC 是非正方形：90° 后宽高交换
      const dacId = placed.dac8;
      await evalJs(cdp, `__P8.rotate('${dacId}')`);
      const dacRect = await evalJs(cdp, `(() => { const c = window.__labBoard.model.findComponent('${dacId}'); return window.__labBoard.model.rectOf(c); })()`);
      check('2.1 DAC 旋转 90° 后占位交换为 3×8', dacRect.w === 3 && dacRect.h === 8, JSON.stringify(dacRect));
    }

    /* ============ 2.1 参数可编辑 ============ */
    {
      const st = await evalJs(cdp, '__P8.state()');
      const cmp = st.comps.find((c) => c.type === 'comparator');
      await evalJs(cdp, `__P8.params('${cmp.id}', { threshold: 3.3, hysteresis: 0.5 })`);
      const st2 = await evalJs(cdp, '__P8.state()');
      const cmp2 = st2.comps.find((c) => c.id === cmp.id);
      check('2.1 比较器阈值/滞回可编辑',
        cmp2.params.threshold === 3.3 && cmp2.params.hysteresis === 0.5,
        JSON.stringify(cmp2.params));
      const th = await evalJs(cdp, `window.__labBoard.simmix.threshold({ hysteresis: 0.5 }, 5)`);
      check('2.1 默认阈值 = VCC/2', Math.abs(th - 2.5) < 1e-9, String(th));
    }

    /* ============ H1 分压 → 比较器 ============ */
    const buildH1 = async (mode) => {
      await evalJs(cdp, '__P8.reset()');
      const vs = (await evalJs(cdp, `__P8.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r1 = (await evalJs(cdp, `__P8.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const r2 = (await evalJs(cdp, `__P8.place('resistor', 10, 2, { resistance: 1000 })`)).id;
      const r3 = (await evalJs(cdp, `__P8.place('resistor', 2, 8, { resistance: 1000 })`)).id;
      const r4 = (await evalJs(cdp, `__P8.place('resistor', 6, 8, { resistance: 1000 })`)).id;
      const cmp = (await evalJs(cdp, `__P8.place('comparator', 16, 2, { threshold: 2.5, hysteresis: 0 })`)).id;
      await evalJs(cdp, `__P8.wire('${vs}','+','${r1}','1')`);
      await evalJs(cdp, `__P8.wire('${r1}','2','${r2}','1')`);
      await evalJs(cdp, `__P8.wire('${r2}','2','${vs}','-')`);
      await evalJs(cdp, `__P8.wire('${vs}','+','${r3}','1')`);
      await evalJs(cdp, `__P8.wire('${r3}','2','${r4}','1')`);
      await evalJs(cdp, `__P8.wire('${r4}','2','${vs}','-')`);
      await evalJs(cdp, `__P8.wire('${cmp}','-','${r3}','2')`);
      await evalJs(cdp, `__P8.wire('${cmp}','V+','${vs}','+')`);
      await evalJs(cdp, `__P8.wire('${cmp}','GND','${vs}','-')`);
      if (mode === 'divider') {
        await evalJs(cdp, `__P8.wire('${r1}','2','${cmp}','+')`);
      } else {
        const src = (await evalJs(cdp, `__P8.place('vsource', 2, 14, { voltage: 2.49 })`)).id;
        await evalJs(cdp, `__P8.wire('${src}','+','${cmp}','+')`);
        await evalJs(cdp, `__P8.wire('${src}','-','${vs}','-')`);
      }
      const res = await evalJs(cdp, `__P8.run({ duration: 0.002, dt: 0.001 })`);
      const state = await evalJs(cdp, `__P8.mixState('${cmp}')`);
      return { res, state };
    };

    const h1a = await buildH1('divider');
    check('H1 分压中点 2.5V → 比较器输出 hi',
      h1a.res.ok === true && h1a.state && h1a.state.level === 1,
      JSON.stringify(h1a.state));
    const h1b = await buildH1('low');
    check('H1 输入 2.49V → 比较器输出 lo',
      h1b.res.ok === true && h1b.state && h1b.state.level === 0,
      JSON.stringify(h1b.state));

    /* ============ H2 ADC ============ */
    {
      await evalJs(cdp, '__P8.reset()');
      const vcc = (await evalJs(cdp, `__P8.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const src = (await evalJs(cdp, `__P8.place('vsource', 2, 8, { voltage: 1.25 })`)).id;
      const adc = (await evalJs(cdp, `__P8.place('adc8', 10, 2, { vref: 5 })`)).id;
      await evalJs(cdp, `__P8.wire('${adc}','IN','${src}','+')`);
      await evalJs(cdp, `__P8.wire('${src}','-','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${adc}','VCC','${vcc}','+')`);
      await evalJs(cdp, `__P8.wire('${adc}','GND','${vcc}','-')`);
      const res = await evalJs(cdp, `__P8.run({ duration: 0.002, dt: 0.001 })`);
      const state = await evalJs(cdp, `__P8.mixState('${adc}')`);
      check('H2 ADC Vin=1.25/Vref=5 → D=64（≤1 LSB）',
        res.ok === true && state && Math.abs(state.bits - 64) <= 1,
        JSON.stringify(state));
    }

    /* ============ H3 DAC ============ */
    {
      await evalJs(cdp, '__P8.reset()');
      const vcc = (await evalJs(cdp, `__P8.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const dac = (await evalJs(cdp, `__P8.place('dac8', 10, 2, { vref: 5 })`)).id;
      const r = (await evalJs(cdp, `__P8.place('resistor', 2, 10, { resistance: 1000 })`)).id;
      const sw = (await evalJs(cdp, `__P8.place('logic-switch', 23, 12, { state: 'hi' })`)).id;
      await evalJs(cdp, `__P8.wire('${dac}','VCC','${vcc}','+')`);
      await evalJs(cdp, `__P8.wire('${dac}','GND','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${dac}','OUT','${r}','1')`);
      await evalJs(cdp, `__P8.wire('${r}','2','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${sw}','OUT','${dac}','D7')`);
      const res = await evalJs(cdp, `__P8.run({ duration: 0.02, dt: 0.01 })`);
      const state = await evalJs(cdp, `__P8.mixState('${dac}')`);
      check('H3 DAC 0x80 → Vout=2.5V±1%',
        res.ok === true && state && state.bits === 128 && Math.abs(state.vout - 2.5) / 2.5 <= 0.01,
        JSON.stringify(state));
      const current = state ? state.vout / 1000 : 0;
      check('H3 DAC 0x80 驱动 1k → 电流 2.5mA±1%',
        Math.abs(current - 2.5e-3) / 2.5e-3 <= 0.01, `${(current * 1000).toFixed(4)}mA`);
    }

    /* ============ H4 弛张振荡器 + 混合波形 ============ */
    {
      await evalJs(cdp, '__P8.reset()');
      const vcc = (await evalJs(cdp, `__P8.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r1 = (await evalJs(cdp, `__P8.place('resistor', 2, 8, { resistance: 1000 })`)).id;
      const r2 = (await evalJs(cdp, `__P8.place('resistor', 6, 8, { resistance: 1000 })`)).id;
      const cmp = (await evalJs(cdp, `__P8.place('comparator', 12, 2, { threshold: 2.5, hysteresis: 2.5 })`)).id;
      const rf = (await evalJs(cdp, `__P8.place('resistor', 12, 14, { resistance: 10000 })`)).id;
      const c = (await evalJs(cdp, `__P8.place('capacitor', 18, 14, { capacitance: 10e-6 })`)).id;
      await evalJs(cdp, `__P8.wire('${vcc}','+','${r1}','1')`);
      await evalJs(cdp, `__P8.wire('${r1}','2','${r2}','1')`);
      await evalJs(cdp, `__P8.wire('${r2}','2','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${cmp}','+','${r1}','2')`);
      await evalJs(cdp, `__P8.wire('${cmp}','V+','${vcc}','+')`);
      await evalJs(cdp, `__P8.wire('${cmp}','GND','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${cmp}','OUT','${rf}','1')`);
      await evalJs(cdp, `__P8.wire('${rf}','2','${c}','1')`);
      await evalJs(cdp, `__P8.wire('${c}','2','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${c}','1','${cmp}','-')`);

      const res = await evalJs(cdp, `__P8.run({ duration: 0.8, dt: 0.0005 })`);
      check('H4 弛张振荡器求解成功', res.ok === true, res.error);
      const outWave = res.waveforms.find((w) => w.type === 'digital');
      check('H4 比较器输出被标注为数字通道', Boolean(outWave), JSON.stringify(res.channels));

      const analog = res.channels.filter((ch) => ch.type === 'analog');
      const digital = res.channels.filter((ch) => ch.type === 'digital');
      check('H4 混合波形同时含模拟与数字通道',
        analog.length > 0 && digital.length > 0,
        `analog=${analog.length} digital=${digital.length}`);
      const wAnalog = res.waveforms.find((w) => w.type === 'analog');
      const wDigital = res.waveforms.find((w) => w.type === 'digital');
      check('H4 模拟/数字通道采样点数一致（同时间轴）',
        wAnalog && wDigital && wAnalog.n === wDigital.n,
        `${wAnalog && wAnalog.n} vs ${wDigital && wDigital.n}`);
      check('H4 联合迭代次数 ≤ 20',
        res.stats && res.stats.mix && res.stats.mix.iterationsMax > 0 && res.stats.mix.iterationsMax <= 20,
        JSON.stringify(res.stats && res.stats.mix));
      check('H4 波形类型标注写入 stats.mix.types',
        res.stats && res.stats.mix && res.stats.mix.types.includes('comparator'),
        JSON.stringify(res.stats && res.stats.mix && res.stats.mix.types));

      // 周期：直接看数字通道的阶梯跳变（0.8s / dt=0.5ms）
      const flips = res.flips || [];
      const periods = [];
      for (let i = 2; i < flips.length; i += 2) periods.push(flips[i] - flips[i - 2]);
      const avg = periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : 0;
      const theory = 2 * 0.1 * Math.log(3);
      check('H4 周期与理论 2RC·ln3 一致 ±5%',
        periods.length >= 2 && Math.abs(avg - theory) / theory <= 0.05,
        `${avg.toFixed(4)}s / 理论 ${theory.toFixed(4)}s（${periods.length} 个周期）`);

      /* 波形面板能画出混合波形 */
      const wavePanel = await evalJs(cdp, '__P8.wavePanel()');
      check('2.3 波形面板存在且含画布', wavePanel.exists && wavePanel.hasCanvas, JSON.stringify(wavePanel));
    }

    /* ============ H5 跨域环路 ============ */
    {
      await evalJs(cdp, '__P8.reset()');
      const vcc = (await evalJs(cdp, `__P8.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r1 = (await evalJs(cdp, `__P8.place('resistor', 2, 8, { resistance: 1000 })`)).id;
      const r2 = (await evalJs(cdp, `__P8.place('resistor', 6, 8, { resistance: 1000 })`)).id;
      const cmp = (await evalJs(cdp, `__P8.place('comparator', 12, 2, { threshold: 2.5, hysteresis: 0 })`)).id;
      const ic = (await evalJs(cdp, `__P8.place('ic74xx', 20, 2, { type: '74LS04' })`)).id;
      const dac = (await evalJs(cdp, `__P8.place('dac8', 2, 14, { vref: 5 })`)).id;
      const rf = (await evalJs(cdp, `__P8.place('resistor', 14, 14, { resistance: 1000 })`)).id;
      const placeIds = [vcc, r1, r2, cmp, ic, dac, rf];
      check('H5 7 个元件全部放置成功',
        placeIds.every((id) => typeof id === 'string' && !id.startsWith('ERR') && Boolean(id)),
        JSON.stringify(placeIds));
      await evalJs(cdp, `__P8.wire('${vcc}','+','${r1}','1')`);
      await evalJs(cdp, `__P8.wire('${r1}','2','${r2}','1')`);
      await evalJs(cdp, `__P8.wire('${r2}','2','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${cmp}','+','${r1}','2')`);
      await evalJs(cdp, `__P8.wire('${cmp}','V+','${vcc}','+')`);
      await evalJs(cdp, `__P8.wire('${cmp}','GND','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${cmp}','OUT','${ic}','1')`);
      for (let i = 0; i < 8; i += 1) {
        await evalJs(cdp, `__P8.wire('${ic}','2','${dac}','D${i}')`);
      }
      await evalJs(cdp, `__P8.wire('${dac}','VCC','${vcc}','+')`);
      await evalJs(cdp, `__P8.wire('${dac}','GND','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${dac}','OUT','${rf}','1')`);
      await evalJs(cdp, `__P8.wire('${rf}','2','${cmp}','+')`);

      const res = await evalJs(cdp, `__P8.run({ duration: 0.01, dt: 0.005 })`);
      check('H5 跨域环路求解报错（ok:false）',
        res.ok === false && String(res.error).includes('跨域'), res.error);
      check('H5 报错列出环上 4 类元件',
        ['comparator', 'ic74xx', 'dac8', 'resistor'].every((t) => String(res.detail).includes(t)),
        res.detail);

      // 数字/直流入口同样报错
      const loops = await evalJs(cdp, '__P8.loops()');
      check('H5 数字入口也检出跨域环路', loops && loops.ok === false && loops.mixInCycle === true,
        JSON.stringify(loops && { ok: loops.ok, cycle: loops.cycle }));

      // 状态行应显示错误（走一次直流仿真）
      await evalJs(cdp, '__P8.simulate()');
      const status = await evalJs(cdp, '__P8.statusText()');
      check('2.2 状态行给出跨域环路可读报错',
        status.includes('跨域') || status.includes('混合'), status);
    }

    /* ============ 状态行"混合仿真" ============ */
    {
      await evalJs(cdp, '__P8.reset()');
      const vcc = (await evalJs(cdp, `__P8.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const cmp = (await evalJs(cdp, `__P8.place('comparator', 12, 2, { threshold: 2.5 })`)).id;
      const r1 = (await evalJs(cdp, `__P8.place('resistor', 2, 8, { resistance: 1000 })`)).id;
      const r2 = (await evalJs(cdp, `__P8.place('resistor', 6, 8, { resistance: 1000 })`)).id;
      await evalJs(cdp, `__P8.wire('${vcc}','+','${r1}','1')`);
      await evalJs(cdp, `__P8.wire('${r1}','2','${r2}','1')`);
      await evalJs(cdp, `__P8.wire('${r2}','2','${vcc}','-')`);
      await evalJs(cdp, `__P8.wire('${cmp}','+','${r1}','2')`);
      await evalJs(cdp, `__P8.wire('${cmp}','-','${r2}','2')`);
      await evalJs(cdp, `__P8.wire('${cmp}','V+','${vcc}','+')`);
      await evalJs(cdp, `__P8.wire('${cmp}','GND','${vcc}','-')`);
      await evalJs(cdp, '__P8.simulate()');
      await sleep(400);
      const status = await evalJs(cdp, '__P8.statusText()');
      check('2.2 状态行显示「混合仿真」', status.includes('混合仿真'), status);
    }

    /* ============ 六档分辨率无横向溢出 ============ */
    {
      const sizes = [[1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [480, 800], [375, 667]];
      let bad = [];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(260);
        const info = await evalJs(cdp, '__P8.overflow()');
        if (info.overflow) bad.push(`${w}×${h}`);
        check(`2.12 无横向溢出 ${w}×${h}`, !info.overflow, `${info.scrollW}>${info.clientW}`);
      }
      void bad;
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }

    check('console 错误 0 条', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    if (edgeProc) edgeProc.kill();
    if (serverProc) serverProc.kill();
    if (userDataDir) await new Promise((r) => setTimeout(r, 300)).then(() => userDataDir && null);
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
