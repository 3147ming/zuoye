/**
 * test-all.mjs — 全量回归（指令包 14）
 *
 * 串行跑：静态检查 → model 自测 → 各包验收探针（tools/probe/run*.mjs）。
 * 每个探针独立端口/独立浏览器实例；失败默认继续（--fail-fast 可改为立即停）。
 * 结果写 tools/probe/log/test-all-result.json，退出码非 0 表示有失败。
 *
 * 用法：
 *   node tools/test-all.mjs
 *   node tools/test-all.mjs --fail-fast
 *   node tools/test-all.mjs --only run8,run9
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PROBE_DIR = join(__dirname, 'probe');
const LOG_DIR = join(PROBE_DIR, 'log');

const args = process.argv.slice(2);
const failFast = args.includes('--fail-fast');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg ? (onlyArg.split('=')[1] || args[args.indexOf(onlyArg) + 1] || '').split(',').filter(Boolean) : null;

function run(cmd, cmdArgs, label) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      const ms = Date.now() - started;
      // 探针结果行：=== 探针结果：N/M 通过 === / === 示例复算：N/M 通过 ===
      const m = out.match(/===\s*([^=]*?)：(\d+)\/(\d+)\s*通过\s*===/);
      const passed = m ? Number(m[2]) : (code === 0 ? 1 : 0);
      const total = m ? Number(m[3]) : 1;
      resolve({ label, code, ms, passed, total, ok: code === 0 && passed === total, tail: out.trim().split('\n').slice(-4).join('\n') });
    });
  });
}

async function main() {
  await mkdir(LOG_DIR, { recursive: true });
  const results = [];

  const staticStep = await run(process.execPath, ['tools/check.mjs'], '静态检查');
  results.push(staticStep);
  if (failFast && !staticStep.ok) return finish(results);

  const modelStep = await run(process.execPath, ['tools/test-model.mjs'], 'model 自测');
  results.push(modelStep);
  if (failFast && !modelStep.ok) return finish(results);

  // 指令包 16：8 颗 MSI 芯片真值表 / 时序行为自测
  const chipsStep = await run(process.execPath, ['tools/test-chips.mjs'], '芯片模型');
  results.push(chipsStep);
  if (failFast && !chipsStep.ok) return finish(results);

  const files = (await readdir(PROBE_DIR)).filter((f) => /^(run|probe).*\.mjs$/.test(f)).sort();
  for (const file of files) {
    const name = basename(file, '.mjs');
    if (only && !only.includes(name)) continue;
    console.log(`\n# ${name} …`);
    const step = await run(process.execPath, [join('tools', 'probe', file)], name);
    results.push(step);
    console.log(`${step.ok ? 'OK  ' : 'FAIL'} ${name}：${step.passed}/${step.total}（${(step.ms / 1000).toFixed(1)}s）`);
    if (failFast && !step.ok) break;
  }

  finish(results);
}

async function finish(results) {
  const payload = {
    at: new Date().toISOString(),
    ok: results.every((r) => r.ok),
    totalChecks: results.reduce((a, r) => a + r.total, 0),
    passedChecks: results.reduce((a, r) => a + r.passed, 0),
    steps: results.map(({ tail, ...rest }) => ({ ...rest, tail })),
  };
  await writeFile(join(LOG_DIR, 'test-all-result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log('\n=== 全量回归汇总 ===');
  results.forEach((r) => {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(12)} ${String(r.passed).padStart(4)}/${String(r.total).padEnd(4)} ${(r.ms / 1000).toFixed(1)}s`);
  });
  console.log(`\n合计：${payload.passedChecks}/${payload.totalChecks} 项检查，结论 ${payload.ok ? '全绿' : '有失败'}`);
  console.log(`汇总 JSON：tools/probe/log/test-all-result.json`);
  process.exitCode = payload.ok ? 0 : 1;
}

main().catch((err) => {
  console.error('test-all 运行失败：', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
