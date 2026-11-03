/**
 * gen-examples.mjs — 示例实验模板生成与复算（指令包 12）
 *
 * 做两件事：
 *   1. 把 js/examples-data.js 的每个示例电路装进真实 model，用真实求解器复算；
 *   2. 把复算值与模板里的 target 对比（容差内），然后把"电路 + 指导 + 预期值"
 *      写成 examples/<id>.json，并生成 examples/index.json 清单。
 *
 * 任何一项超出容差 → 退出码 1，不写文件（防止把错值固化进模板）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as M from '../js/model.js';
import { solveDC } from '../js/simdc.js';
import { solveTransient, resetTransientState } from '../js/simtrans.js';
import { solveDig, resetDigState } from '../js/simdig.js';
import { EXAMPLES } from '../js/examples-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function loadCircuitOf(example) {
  M.createCircuit(example.circuit.platform || example.platform || 'breadboard');
  resetTransientState();
  resetDigState();
  const report = M.loadCircuit(example.circuit, example.circuit.platform);
  if (report.skippedComponents > 0) {
    throw new Error(`${example.id}：${report.skippedComponents} 个元件装载失败`);
  }
  return report;
}

const netOf = (componentId, terminal) => M.getNetlist().netOf.get(`c:${componentId}:${terminal}`) || null;

function dcValue(measure) {
  const res = solveDC(M);
  if (!res.ok) throw new Error(`直流求解失败：${res.error}`);
  const net = netOf(measure.probe.componentId, measure.probe.terminal);
  const gnd = netOf(measure.ground.componentId, measure.ground.terminal);
  const node = (res.nodeVoltages || []).find((n) => n.netId === net);
  const g = (res.nodeVoltages || []).find((n) => n.netId === gnd);
  if (!node || node.v === null) throw new Error('探针网没有电压');
  const v = node.v - (g && g.v !== null ? g.v : 0);
  let i = null;
  if (measure.currentOf) {
    const el = (res.elementResults || []).find((e) => e.componentId === measure.currentOf);
    i = el ? el.i : null;
  }
  return { v, i, res };
}

function sampleAt(samples, t) {
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].t >= t - 1e-12) {
      const k = (t - samples[i - 1].t) / (samples[i].t - samples[i - 1].t || 1);
      return samples[i - 1].v + (samples[i].v - samples[i - 1].v) * k;
    }
  }
  return samples[samples.length - 1].v;
}

function transientValue(measure) {
  const res = solveTransient(M, measure.opts || { duration: 0.01, dt: 1e-4 });
  if (!res.ok) throw new Error(`暂态求解失败：${res.error}`);
  const net = netOf(measure.probe.componentId, measure.probe.terminal);
  const wave = (res.waveforms || []).find((w) => w.netId === net);
  if (!wave) throw new Error('探针网没有波形');
  if (measure.digital) {
    // 数字量：统计翻转次数换算频率
    const flips = [];
    for (let i = 1; i < wave.samples.length; i += 1) {
      if ((wave.samples[i - 1].v > 2.5) !== (wave.samples[i].v > 2.5)) flips.push(wave.samples[i].t);
    }
    // 用相邻翻转间隔的均值算频率：flips/span 会被"窗口首尾各少一个沿"带偏
    // （10ms 窗口里 1kHz 时钟只有 9 个上升沿，算出来 450Hz 而不是 500Hz）
    const gaps = [];
    for (let i = 1; i < flips.length; i += 1) gaps.push(flips[i] - flips[i - 1]);
    const meanGap = gaps.length > 0 ? gaps.reduce((x, y) => x + y, 0) / gaps.length : 0;
    return { freq: meanGap > 0 ? 0.5 / meanGap : 0, flips: flips.length, res };
  }
  if (measure.at !== undefined) return { v: sampleAt(wave.samples, measure.at), res, wave };
  const values = wave.samples.map((s) => s.v);
  return { vpp: Math.max(...values) - Math.min(...values), res, wave };
}

function digitalTruth(example, measure) {
  const rows = [];
  const switches = M.getState().components.filter((c) => c.type === 'logic-switch');
  for (let a = 0; a < 2; a += 1) {
    for (let b = 0; b < 2; b += 1) {
      if (switches[0]) M.updateParams(switches[0].id, { state: a ? 'hi' : 'lo' });
      if (switches[1]) M.updateParams(switches[1].id, { state: b ? 'hi' : 'lo' });
      const dig = solveDig(M);
      const state = (dig.compStates || []).find((c) => c.componentId === measure.unit);
      const y = state ? state.outputs[measure.pins[2]] : null;
      rows.push(`${a}${b}→${y === 1 ? 1 : 0}`);
    }
  }
  return rows.join(',');
}

/* ---------------------------------------------------------------- 主流程 */

const report = [];
let failed = 0;

for (const example of EXAMPLES) {
  const load = loadCircuitOf(example);
  const measure = example.measure;
  const expected = [];
  let computed = null;

  if (measure.type === 'dc') {
    const { v, i } = dcValue(measure);
    computed = { v, i };
    example.guide.expected.forEach((item) => {
      let value = null;
      if (item.unit === 'V') value = v;
      else if (item.unit === 'A') value = i === null ? null : Math.abs(i);
      else if (item.unit === 'Ω') {
        const comp = item.component
          ? M.getState().components.find((c) => c.id === item.component)
          : null;
        value = comp ? Number(comp.params.resistance) : null;
      }
      expected.push({ ...item, measured: value });
    });
  } else if (measure.type === 'transient') {
    const out = transientValue(measure);
    computed = out;
    example.guide.expected.forEach((item) => {
      let value = null;
      if (measure.digital) value = out.freq;
      else if (item.unit === 's') value = 0.1;
      else value = out.v;
      expected.push({ ...item, measured: value });
    });
  } else if (measure.type === 'digital') {
    computed = digitalTruth(example, measure);
    expected.push({ ...example.guide.expected[0], measured: computed });
  }

  // 容差校验：数值项 |measured − target| ≤ tol × target；字符串项必须完全一致
  expected.forEach((item) => {
    const target = Number(item.target);
    const ok = Number.isFinite(target) && item.measured !== null && item.measured !== undefined
      ? Math.abs(item.measured - target) <= Math.abs(target) * (item.tolerance || 0) + 1e-12
      : String(item.measured) === String(item.target);
    if (!ok) {
      failed += 1;
      report.push(`FAIL ${example.id} / ${item.label}: 实测 ${item.measured}, 目标 ${item.target} (±${(item.tolerance * 100).toFixed(1)}%)`);
    } else {
      report.push(`OK   ${example.id} / ${item.label}: ${typeof item.measured === 'number' ? item.measured.toPrecision(5) : item.measured}`);
    }
  });

  // 写模板（保留 circuit / guide，附复算快照）
  const payload = {
    id: example.id,
    title: example.title,
    desc: example.desc,
    platform: example.platform,
    difficulty: example.difficulty,
    durationMin: example.durationMin,
    tags: example.tags,
    equipment: example.equipment,
    circuit: example.circuit,
    guide: {
      steps: example.guide.steps,
      expected: expected.map((item) => ({
        label: item.label,
        target: item.target,
        unit: item.unit,
        tolerance: item.tolerance,
        measured: typeof item.measured === 'number' ? Number(item.measured.toPrecision(6)) : item.measured,
      })),
    },
    recomputedAt: new Date().toISOString(),
  };
  await mkdir(join(ROOT, 'examples'), { recursive: true });
  await writeFile(join(ROOT, 'examples', `${example.id}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  void load;
}

await writeFile(
  join(ROOT, 'examples', 'index.json'),
  `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), items: EXAMPLES.map((e) => ({ id: e.id, title: e.title, file: `${e.id}.json` })) }, null, 2)}\n`,
  'utf8',
);

console.log(report.join('\n'));
console.log(`\n=== 示例复算：${report.filter((r) => r.startsWith('OK')).length}/${report.length} 通过 ===`);
process.exitCode = failed > 0 ? 1 : 0;
