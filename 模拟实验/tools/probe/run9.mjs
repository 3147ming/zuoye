/**
 * run9.mjs — 指令包 9（元件库完整版）无头 Edge + CDP 探针
 *
 * 覆盖：9 个新类型 + LED/电容扩展的入库/放置/旋转/参数/存档往返、
 * P1–P6 数值标准（浏览器内复算）、继电器/拨码/电位器行为、失败文案、
 * 六档分辨率无横向溢出、console 0。
 */

import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const INSTALL9 = `(() => {
  if (window.__P9) return true;
  const B = () => window.__labBoard;
  const M = () => B().model;
  window.__P9 = {
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
      return { ok: true, id: r.component.id, rotation: r.component.rotation };
    },
    wire(a, ta, b, tb) {
      const r = M().addWire({ componentId: a, terminal: ta }, { componentId: b, terminal: tb });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    params(id, patch) {
      const r = M().updateParams(id, patch);
      B().requestRender();
      return r.ok ? true : String(r.error);
    },
    state() {
      const st = M().getState();
      return { comps: st.components.map((c) => ({ id: c.id, type: c.type, params: c.params, rotation: c.rotation })), wires: st.wires.length };
    },
    rect(id) {
      const c = M().findComponent(id);
      return c ? M().rectOf(c) : null;
    },
    rotate(id) {
      B().setSelection({ type: 'component', id });
      return B().interact.rotate();
    },
    serialize() { return M().serializeCircuit(); },
    load(data) {
      const r = M().loadCircuit(data);
      B().requestRender();
      return r;
    },
    dc() {
      const res = B().simdc.solve('probe9');
      return {
        ok: res.ok,
        error: res.error,
        detail: res.detail,
        iter: res.convergence ? res.convergence.iter : 0,
        nodes: (res.nodeVoltages || []).map((n) => ({ netId: n.netId, v: n.v })),
        elements: (res.elementResults || []).map((e) => ({ id: e.componentId, type: e.type, v: e.v, i: e.i, note: e.note, extra: e.extra })),
      };
    },
    transient(opts) {
      const res = B().simtrans.solve(opts);
      return {
        ok: res.ok,
        error: res.error,
        channels: (res.channels || []).map((c) => ({ netId: c.netId, min: c.min, max: c.max })),
        waveforms: (res.waveforms || []).map((w) => ({ netId: w.netId, samples: w.samples })),
      };
    },
    palette() {
      const items = [...document.querySelectorAll('.palette-item')];
      const groups = [...document.querySelectorAll('.palette-group')].map((g) => {
        const t = g.querySelector('.palette-group-title');
        return t ? t.textContent : '';
      });
      return { count: items.length, types: items.map((el) => el.dataset.partType), groups };
    },
    overflow() {
      const doc = document.documentElement;
      return { scrollW: doc.scrollWidth, clientW: doc.clientWidth, overflow: doc.scrollWidth > doc.clientWidth + 1 };
    },
  };
  return true;
})()`;

async function run() {
  mkdir(join(ROOT, 'labsim9'), { recursive: true }).catch(() => {});

  const serverProc = await ensureServer();
  let edgeProc = null;

  try {
    const boot = await bootEdge();
    const { cdp } = boot;
    edgeProc = boot.edge;

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
    await evalJs(cdp, INSTALL9);

    /* ============ 元件入库 ============ */
    {
      const palette = await evalJs(cdp, '__P9.palette()');
      const wanted = ['diode', 'zener', 'transistor', 'opamp', 'inductor', 'buzzer', 'relay', 'dip4', 'pot'];
      check('9 个新元件全部入库',
        wanted.every((t) => palette.types.includes(t)),
        wanted.filter((t) => !palette.types.includes(t)).join(','));
      check('元件库出现「半导体 / 无源元件 / 有源器件」分组',
        ['半导体', '无源元件', '有源器件'].every((g) => palette.groups.includes(g)),
        palette.groups.join('/'));
    }

    /* ============ 放置 / 旋转 / 参数 / 存档往返 ============ */
    {
      await evalJs(cdp, '__P9.reset()');
      const ids = {};
      const layout = {
        diode: [2, 2], zener: [5, 2], transistor: [8, 2], opamp: [12, 2],
        inductor: [20, 2], buzzer: [24, 2], relay: [2, 9], dip4: [8, 9], pot: [18, 9],
      };
      for (const [type, [x, y]] of Object.entries(layout)) {
        const r = await evalJs(cdp, `__P9.place('${type}', ${x}, ${y})`);
        check(`9 放置 ${type}`, r && r.ok === true, JSON.stringify(r));
        ids[type] = r && r.id;
      }

      // 旋转：取一个非正方元件（二极管 2×1）
      const before = await evalJs(cdp, `__P9.rect('${ids.diode}')`);
      await evalJs(cdp, `__P9.rotate('${ids.diode}')`);
      const after = await evalJs(cdp, `__P9.rect('${ids.diode}')`);
      check('9 二极管旋转 90° 占位 2×1 → 1×2',
        before && after && before.w === 2 && before.h === 1 && after.w === 1 && after.h === 2,
        `${JSON.stringify(before)} → ${JSON.stringify(after)}`);

      // 参数：二极管型号 / 电位器滑臂
      await evalJs(cdp, `__P9.params('${ids.diode}', { model: '1N4007' })`);
      await evalJs(cdp, `__P9.params('${ids.pot}', { wiper: 25 })`);
      // 存档往返
      const saved = await evalJs(cdp, '__P9.serialize()');
      await evalJs(cdp, '__P9.reset()');
      const loaded2 = await evalJs(cdp, `__P9.load(${JSON.stringify(saved)})`);
      check('9 存档 → 载入成功', loaded2 && loaded2.ok === true, JSON.stringify(loaded2));
      const st = await evalJs(cdp, '__P9.state()');
      const diode = st.comps.find((c) => c.type === 'diode');
      const pot = st.comps.find((c) => c.type === 'pot');
      check('9 存档往返：二极管型号保留', diode && diode.params.model === '1N4007', JSON.stringify(diode && diode.params));
      check('9 存档往返：电位器滑臂保留', pot && Number(pot.params.wiper) === 25, JSON.stringify(pot && pot.params));
    }

    /* ============ P1 二极管 ============ */
    {
      await evalJs(cdp, '__P9.reset()');
      const vs = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r = (await evalJs(cdp, `__P9.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const d = (await evalJs(cdp, `__P9.place('diode', 10, 2, { model: '1N4148' })`)).id;
      await evalJs(cdp, `__P9.wire('${vs}','+','${r}','1')`);
      await evalJs(cdp, `__P9.wire('${r}','2','${d}','A')`);
      await evalJs(cdp, `__P9.wire('${d}','K','${vs}','-')`);
      const res = await evalJs(cdp, '__P9.dc()');
      const e = res.elements.find((x) => x.id === d);
      check('P1 1N4148 Vf=0.68~0.72V / I=4.28~4.32mA',
        res.ok === true && e && e.v >= 0.68 && e.v <= 0.72 && Math.abs(e.i) >= 4.28e-3 && Math.abs(e.i) <= 4.32e-3,
        JSON.stringify(e));

      // 反接：电流 ≈ 0
      await evalJs(cdp, '__P9.reset()');
      const vs2 = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r2 = (await evalJs(cdp, `__P9.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const d2 = (await evalJs(cdp, `__P9.place('diode', 10, 2, { model: '1N4148' })`)).id;
      await evalJs(cdp, `__P9.wire('${vs2}','+','${r2}','1')`);
      await evalJs(cdp, `__P9.wire('${r2}','2','${d2}','K')`);
      await evalJs(cdp, `__P9.wire('${d2}','A','${vs2}','-')`);
      const rev = await evalJs(cdp, '__P9.dc()');
      const er = rev.elements.find((x) => x.id === d2);
      check('9 二极管反接 → 电流 <1µA 且标注反向截止',
        rev.ok === true && er && Math.abs(er.i) < 1e-6 && /反向/.test(er.note || ''),
        JSON.stringify(er));
    }

    /* ============ P2 稳压管 ============ */
    {
      await evalJs(cdp, '__P9.reset()');
      const vs = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 9 })`)).id;
      const r = (await evalJs(cdp, `__P9.place('resistor', 6, 2, { resistance: 1000 })`)).id;
      const z = (await evalJs(cdp, `__P9.place('zener', 10, 2, { vz: 5.1 })`)).id;
      await evalJs(cdp, `__P9.wire('${vs}','+','${r}','1')`);
      await evalJs(cdp, `__P9.wire('${r}','2','${z}','K')`);
      await evalJs(cdp, `__P9.wire('${z}','A','${vs}','-')`);
      const res = await evalJs(cdp, '__P9.dc()');
      const e = res.elements.find((x) => x.id === z);
      check('P2 9V 驱动 5.1V 稳压管 → 钳位 5.1V±5%',
        res.ok === true && e && Math.abs(e.v) >= 5.1 * 0.95 && Math.abs(e.v) <= 5.1 * 1.05,
        JSON.stringify(e));
    }

    /* ============ P3 NPN ============ */
    const buildNpn = async (rb) => {
      await evalJs(cdp, '__P9.reset()');
      const vs = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const rbv = (await evalJs(cdp, `__P9.place('resistor', 6, 2, { resistance: ${rb} })`)).id;
      const rcv = (await evalJs(cdp, `__P9.place('resistor', 10, 2, { resistance: 1000 })`)).id;
      const q = (await evalJs(cdp, `__P9.place('transistor', 16, 2, { model: '2N2222', beta: 100 })`)).id;
      await evalJs(cdp, `__P9.wire('${vs}','+','${rbv}','1')`);
      await evalJs(cdp, `__P9.wire('${rbv}','2','${q}','B')`);
      await evalJs(cdp, `__P9.wire('${vs}','+','${rcv}','1')`);
      await evalJs(cdp, `__P9.wire('${rcv}','2','${q}','C')`);
      await evalJs(cdp, `__P9.wire('${q}','E','${vs}','-')`);
      const res = await evalJs(cdp, '__P9.dc()');
      return { res, e: res.elements.find((x) => x.id === q) };
    };
    {
      const active = await buildNpn(470000);
      check('P3 NPN 活性区 Ic=0.92mA±2% / Vce=4.08V±2%',
        active.res.ok === true && active.e
        && Math.abs(active.e.i - 0.92e-3) / 0.92e-3 <= 0.02
        && Math.abs(active.e.v - 4.08) / 4.08 <= 0.02,
        JSON.stringify(active.e));
      const sat = await buildNpn(47000);
      check('P3 NPN 饱和区（Rb=47k）Ic≈4.8mA±5% 且标注饱和',
        sat.res.ok === true && sat.e && sat.e.note === '饱和'
        && Math.abs(sat.e.i - 4.8e-3) / 4.8e-3 <= 0.05,
        JSON.stringify(sat.e));
      check('P3 牛顿迭代 ≤ 20 次', active.res.iter > 0 && active.res.iter <= 20, String(active.res.iter));
    }

    /* ============ P4 运放 ============ */
    {
      await evalJs(cdp, '__P9.reset()');
      const vs = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const vin = (await evalJs(cdp, `__P9.place('vsource', 2, 8, { voltage: 2 })`)).id;
      const u = (await evalJs(cdp, `__P9.place('opamp', 12, 2, { model: 'LM741' })`)).id;
      await evalJs(cdp, `__P9.wire('${vin}','+','${u}','+')`);
      await evalJs(cdp, `__P9.wire('${vin}','-','${vs}','-')`);
      await evalJs(cdp, `__P9.wire('${u}','V+','${vs}','+')`);
      await evalJs(cdp, `__P9.wire('${u}','V-','${vs}','-')`);
      await evalJs(cdp, `__P9.wire('${u}','OUT','${u}','-')`);
      const res = await evalJs(cdp, '__P9.dc()');
      const outNet = await evalJs(cdp, `window.__labBoard.model.getNetlist().netOf.get('c:${u}:OUT')`);
      const node = res.nodes.find((n) => n.netId === outNet);
      check('P4 LM741 跟随器 Vout=2.00V±0.5%',
        res.ok === true && node && Math.abs(node.v - 2) / 2 <= 0.005, JSON.stringify(node));
    }

    /* ============ P5 / P6 动态元件 ============ */
    {
      await evalJs(cdp, '__P9.reset()');
      const vs = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r = (await evalJs(cdp, `__P9.place('resistor', 6, 2, { resistance: 10000 })`)).id;
      const c = (await evalJs(cdp, `__P9.place('capacitor', 10, 2, { capacitance: 10e-6 })`)).id;
      await evalJs(cdp, `__P9.wire('${vs}','+','${r}','1')`);
      await evalJs(cdp, `__P9.wire('${r}','2','${c}','1')`);
      await evalJs(cdp, `__P9.wire('${c}','2','${vs}','-')`);
      const res = await evalJs(cdp, '__P9.transient({ duration: 0.3, dt: 1e-4 })');
      const wave = res.waveforms ? res.waveforms.find((w) => {
        const ch = res.channels.find((x) => x.netId === w.netId);
        return ch && ch.max > 4.5 && ch.min < 0.5;
      }) : null;
      const at = (t) => {
        const s = wave.samples;
        for (let i = 1; i < s.length; i += 1) {
          if (s[i].t >= t - 1e-12) {
            const k = (t - s[i - 1].t) / (s[i].t - s[i - 1].t || 1);
            return s[i - 1].v + (s[i].v - s[i - 1].v) * k;
          }
        }
        return s[s.length - 1].v;
      };
      const vTau = wave ? at(0.1) : 0;
      check('P5 RC 10k/10µF 在 t=τ 处 3.16V±2%',
        res.ok === true && wave && Math.abs(vTau - 3.16) / 3.16 <= 0.02, `V=${vTau}`);

      await evalJs(cdp, '__P9.reset()');
      const vs2 = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const r2 = (await evalJs(cdp, `__P9.place('resistor', 6, 2, { resistance: 10 })`)).id;
      const l = (await evalJs(cdp, `__P9.place('inductor', 10, 2, { inductance: 0.001 })`)).id;
      await evalJs(cdp, `__P9.wire('${vs2}','+','${r2}','1')`);
      await evalJs(cdp, `__P9.wire('${r2}','2','${l}','1')`);
      await evalJs(cdp, `__P9.wire('${l}','2','${vs2}','-')`);
      const res2 = await evalJs(cdp, '__P9.transient({ duration: 0.001, dt: 1e-6 })');
      const wave2 = res2.waveforms ? res2.waveforms.find((w) => {
        const ch = res2.channels.find((x) => x.netId === w.netId);
        return ch && ch.max > 4.5 && ch.min < 0.5;
      }) : null;
      const at2 = (t) => {
        const s = wave2.samples;
        for (let i = 1; i < s.length; i += 1) {
          if (s[i].t >= t - 1e-15) {
            const k = (t - s[i - 1].t) / (s[i].t - s[i - 1].t || 1);
            return s[i - 1].v + (s[i].v - s[i - 1].v) * k;
          }
        }
        return s[s.length - 1].v;
      };
      const iEnd = wave2 ? (5 - at2(0.001)) / 10 : 0;
      check('P6 电感稳态 0.5A±2% / t=τ 处 0.316A±5%',
        res2.ok === true && wave2 && Math.abs(iEnd - 0.5) / 0.5 <= 0.02
        && Math.abs((5 - at2(1e-4)) / 10 - 0.316) / 0.316 <= 0.05,
        `I=${iEnd}`);
    }

    /* ============ 继电器 / 拨码 / 电位器 ============ */
    {
      await evalJs(cdp, '__P9.reset()');
      const vs = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const k = (await evalJs(cdp, `__P9.place('relay', 10, 2, {})`)).id;
      const load = (await evalJs(cdp, `__P9.place('resistor', 10, 10, { resistance: 1000 })`)).id;
      await evalJs(cdp, `__P9.wire('${vs}','+','${k}','COIL1')`);
      await evalJs(cdp, `__P9.wire('${k}','COIL2','${vs}','-')`);
      await evalJs(cdp, `__P9.wire('${vs}','+','${k}','COM')`);
      await evalJs(cdp, `__P9.wire('${k}','NO','${load}','1')`);
      await evalJs(cdp, `__P9.wire('${load}','2','${vs}','-')`);
      const res = await evalJs(cdp, '__P9.dc()');
      const e = res.elements.find((x) => x.id === k);
      const noNet = await evalJs(cdp, `window.__labBoard.model.getNetlist().netOf.get('c:${k}:NO')`);
      const node = res.nodes.find((n) => n.netId === noNet);
      check('9 继电器线圈 50mA 吸合 → COM-NO 导通（NO≈5V）',
        res.ok === true && e && /吸合/.test(e.note || '') && node && node.v > 4.5,
        JSON.stringify({ note: e && e.note, v: node && node.v }));

      // 线圈电流不足：线圈串 1k → 5mA < 20mA，保持释放
      await evalJs(cdp, '__P9.reset()');
      const vs2 = (await evalJs(cdp, `__P9.place('vsource', 2, 2, { voltage: 5 })`)).id;
      const k2 = (await evalJs(cdp, `__P9.place('relay', 10, 2, {})`)).id;
      const rc = (await evalJs(cdp, `__P9.place('resistor', 2, 8, { resistance: 1000 })`)).id;
      await evalJs(cdp, `__P9.wire('${vs2}','+','${rc}','1')`);
      await evalJs(cdp, `__P9.wire('${rc}','2','${k2}','COIL1')`);
      await evalJs(cdp, `__P9.wire('${k2}','COIL2','${vs2}','-')`);
      const res2 = await evalJs(cdp, '__P9.dc()');
      const e2 = res2.elements.find((x) => x.id === k2);
      check('9 继电器线圈电流不足 → 保持释放（可读文案）',
        res2.ok === true && e2 && /释放/.test(e2.note || ''), e2 && e2.note);
    }

    /* ============ 六档分辨率 + console ============ */
    {
      const sizes = [[1600, 900], [1440, 900], [1366, 768], [1280, 800], [1024, 768], [768, 1024], [480, 800], [375, 667]];
      for (const [w, h] of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await sleep(240);
        const info = await evalJs(cdp, '__P9.overflow()');
        check(`9 无横向溢出 ${w}×${h}`, !info.overflow, `${info.scrollW}>${info.clientW}`);
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
