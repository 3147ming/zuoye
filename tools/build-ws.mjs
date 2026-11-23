#!/usr/bin/env node
/* ============================================================
 * tools/build-ws.mjs —— 打包联机 Worker（Workers + Durable Object）
 * ------------------------------------------------------------
 * 把 worker/entry.js 及其依赖（functions/api/net.js → server/*）打成一个
 * ESM 文件 dist/ws-worker.js，交给 wrangler 部署。
 *
 * 用法：
 *   node tools/build-ws.mjs            # 输出 dist/ws-worker.js（含 sourcemap）
 *   node tools/build-ws.mjs --no-min   # 不压缩，排错时用
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const MIN = !process.argv.includes('--no-min');

fs.mkdirSync(OUT, { recursive: true });

const args = [
  '--yes', 'esbuild',
  path.join('worker', 'entry.js'),
  '--bundle',
  '--format=esm',
  '--platform=neutral',
  '--target=es2022',
  '--outfile=' + path.join('dist', 'ws-worker.js'),
  '--log-level=warning'
];
if (MIN) args.push('--minify');
args.push('--sourcemap');

const r = spawnSync('npx', args, {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024
});

if (r.status !== 0) {
  console.error('[ws] 打包失败：\n' + (r.stderr || r.stdout || ''));
  process.exit(1);
}
if (r.stderr && r.stderr.trim()) console.warn(r.stderr.trim());

const file = path.join(OUT, 'ws-worker.js');
const kb = (fs.statSync(file).size / 1024).toFixed(1);
const src = fs.readFileSync(file, 'utf8');

/* 自检：入口必须导出 Rooms（DO 类），否则 wrangler 部署会报找不到类 */
const problems = [];
if (!/export\s*\{[^}]*\bRooms\b/.test(src) && !/export\s+(class|default)/.test(src)) {
  problems.push('产物里没找到 Rooms 导出');
}
if (!/fetch\s*\(/.test(src)) problems.push('产物里没找到 fetch 入口');

console.log('[ws] dist/ws-worker.js  ' + kb + ' KB' + (MIN ? '（已压缩）' : '（未压缩）'));
if (problems.length) {
  console.error('[ws] 自检失败：' + problems.join('；'));
  process.exit(1);
}
console.log('[ws] 自检通过：Rooms 导出 + fetch 入口都在');
