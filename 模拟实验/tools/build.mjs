/**
 * build.mjs — 打包到 dist/（指令包 15）
 *
 * 原则：
 *   · 只收运行时必需文件；探针/测试脚本不进 dist（体积与源码可读性）；
 *   · 不压缩 JS（教学软件源码可读，便于二次开发；体积本来就 <2MB）；
 *   · 幂等：同一份源码跑两遍，产物逐字节一致（时间戳不写入产物）。
 */
import { cp, mkdir, rm, writeFile, readFile, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const { VERSION } = await import('../js/version.js');

const FILES = ['index.html', 'server.mjs'];
const DIRS = ['js', 'css', 'examples'];

async function exists(path) {
  try { await stat(path); return true; } catch (e) { return false; }
}

// 清空产物，但保留隐藏状态文件（.genie / .workbuddy）：
// 它们记录"这个目录属于哪个已发布应用"，删掉会让下次发布变成新应用、分享链接失效。
await mkdir(DIST, { recursive: true });
for (const entry of await readdir(DIST, { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue;
  await rm(join(DIST, entry.name), { recursive: true, force: true });
}

for (const file of FILES) {
  await cp(join(ROOT, file), join(DIST, file));
}
for (const dir of DIRS) {
  if (!(await exists(join(ROOT, dir)))) continue;
  await cp(join(ROOT, dir), join(DIST, dir), { recursive: true });
}

const readme = `电路实验模拟器 v${VERSION}
================================

启动
----
  双击 run.bat（Windows），或在本目录执行：
      node server.mjs
  然后用浏览器打开 http://127.0.0.1:5360/

目录
----
  index.html      入口
  js/             源码（零依赖纯 ESM，可直接阅读/二次开发）
  css/            样式
  examples/       示例实验模板（JSON）
  server.mjs      本地静态服务器（端口 5360）

说明
----
  · 不需要 npm install，不需要构建；Node 18+ 即可。
  · 必须是 http:// 打开（ESM 模块在 file:// 下会被 CORS 拦截）。
  · 数据保存在浏览器 localStorage；项目文件可导出为 .circuit.json。
`;
await writeFile(join(DIST, 'README.txt'), readme, 'utf8');
await writeFile(join(DIST, 'VERSION'), `${VERSION}\n`, 'utf8');

const runBat = `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\necho 启动电路实验模拟器 http://127.0.0.1:5360/\r\nstart "" http://127.0.0.1:5360/\r\nnode server.mjs\r\npause\r\n`;
await writeFile(join(DIST, 'run.bat'), runBat, 'utf8');

// 产物自检：必须能独立起服务
const { spawn } = await import('node:child_process');
const proc = spawn(process.execPath, ['server.mjs'], { cwd: DIST, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
let ok = false;
try {
  const res = await fetch('http://127.0.0.1:5360/', { signal: AbortSignal.timeout(2000) });
  ok = res.ok;
} catch (e) { /* ignore */ }
proc.kill();

const files = await readFile(join(DIST, 'VERSION'), 'utf8');
console.log(`dist 版本：${files.trim()} · 独立启动：${ok ? 'OK' : '失败'}`);
console.log('产物：index.html / js / css / examples / server.mjs / run.bat / README.txt / VERSION');
process.exitCode = ok ? 0 : 1;
