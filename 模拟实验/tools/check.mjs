/**
 * check.mjs — 语法检查（node --check 的正确用法）
 *
 * 坑：`node --check foo.js` 在 foo.js 里含 `export` 时会按"模块"探测，
 * 但实际走的仍是 .js 的检查路径，`export const a = ;` 这种错误会被**静默放过**。
 * 实测：broken.js 退出码 0，同内容 broken.mjs 退出码 1。
 * 所以这里把每个模块复制成 .mjs 再检查，确保真的解析了模块语法。
 *
 * 运行：node tools/check.mjs
 */

import { readdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SRC = new URL('../js/', import.meta.url);

const files = (await readdir(SRC)).filter((name) => name.endsWith('.js')).sort();
const workDir = await mkdtemp(join(tmpdir(), 'lab-check-'));

let pass = 0;
const failed = [];

for (const name of files) {
  const target = join(workDir, basename(name, '.js') + '.mjs');
  await copyFile(new URL(name, SRC), target);
  try {
    await run(process.execPath, ['--check', target]);
    pass += 1;
    console.log(`OK   ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`FAIL ${name}`);
    console.log(String(err.stderr || err.message).split('\n').slice(0, 4).join('\n'));
  }
}

await rm(workDir, { recursive: true, force: true });

console.log(`\n=== 语法检查：${pass}/${files.length} 通过 ===`);
if (failed.length > 0) process.exitCode = 1;
