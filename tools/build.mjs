#!/usr/bin/env node
/* ============================================================
 * tools/build.mjs —— 构建脚本（阶段二：打包 + 缓存分层 + 版本单一数据源）
 * ------------------------------------------------------------
 * 用法：node tools/build.mjs
 * 做的事：
 *   1. 版本单一数据源 = package.json `version`；写入 js/config.js、version.json、sw.js、index.html meta
 *   2. 按序拼接核心脚本 → esbuild minify → assets/app.<hash>.js
 *      runner/parkour 切懒加载包 → assets/extra.<hash>.js（index.html 的 data-extra 引用，boot.js 按需注入）
 *   3. css/main.css → esbuild minify → assets/main.<hash>.css
 *   4. 重写 index.html（引用 hash 文件 + preconnect + data-extra），幂等
 *   5. 重写 sw.js 的 VERSION 与 CORE 预缓存清单
 *   6. 清理旧 hash 产物
 * esbuild 不可用时退化为「只拼接不压缩」，构建不失败。
 * 运行期零依赖不变；esbuild 只是构建期工具（npx 缓存一次即可）。
 * ============================================================ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');

/* ---------- 核心脚本顺序（与 index.html 原 defer 顺序一致） ---------- */
const CORE_SCRIPTS = [
  'js/audio.js',
  'js/sceneManager.js',
  'js/player.js',
  'js/gamepad.js',
  'js/npc.js',
  'js/save.js',
  'js/config.js',
  'js/daynight.js',
  'js/weather.js',
  'js/stats.js',
  'js/riddle.js',
  'js/contrib.js',
  'contrib/manifest.js',
  'js/bgm.js',
  'js/gatePanel.js',
  'js/settings.js',
  'js/modal.js',
  'js/world.js',
  'js/iframeScene.js',
  'js/keyboardFit.js',
  'js/gestureGuard.js',
  'js/touch.js',
  'js/directory.js',
  'js/quickRecent.js',
  'js/boot.js'
];
/* 懒加载包：按 P 进跑酷前才取 */
const EXTRA_SCRIPTS = ['js/runner.js', 'js/parkour.js'];

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const hash10 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

/* ---------- 0. 版本单一数据源 ---------- */
const pkg = JSON.parse(read('package.json'));
const VERSION = pkg.version;
/* 构建日期取本地时区：toISOString 是 UTC，晚上 8 点后在中国会写成「昨天」 */
const BUILD_DATE = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
})();

function patchConfig(src) {
  let s = src;
  s = s.replace(/version:\s*'[^']*'/, "version: '" + VERSION + "'");
  s = s.replace(/build:\s*'[^']*'/, "build: '" + BUILD_DATE + "'");
  return s;
}
fs.writeFileSync(path.join(ROOT, 'js/config.js'), patchConfig(read('js/config.js')), 'utf8');

/* version.json：只改 version / build，notes 留给人写 */
{
  const vpath = path.join(ROOT, 'version.json');
  const v = JSON.parse(fs.readFileSync(vpath, 'utf8'));
  v.version = VERSION;
  v.build = BUILD_DATE;
  fs.writeFileSync(vpath, JSON.stringify(v, null, 2) + '\n', 'utf8');
}

/* ---------- 1. esbuild minify（失败退化为不压缩） ---------- */
function minify(code, loader) {
  const r = spawnSync('npx', ['--yes', 'esbuild', '--minify', '--loader=' + loader], {
    input: code,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024
  });
  if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout;
  console.warn('[build] esbuild 不可用（' + (r.stderr || '').split('\n')[0] + '），本次用未压缩输出');
  return code;
}

function concat(files) {
  return files.map(function (f) {
    return '/* ==== ' + f + ' ==== */\n' + read(f);
  }).join('\n;\n');
}

/* ---------- 2. 产出 hash 文件 ---------- */
fs.mkdirSync(ASSETS, { recursive: true });

/* 先清旧产物，避免 assets/ 越积越多 */
for (const f of fs.readdirSync(ASSETS)) {
  if (/^(app|extra|main)\.[0-9a-f]{6,}\.(js|css)$/.test(f)) fs.unlinkSync(path.join(ASSETS, f));
}

const jsCoreRaw = concat(CORE_SCRIPTS);
const jsCore = minify(jsCoreRaw, 'js');
const coreHash = hash10(jsCore);
const coreFile = 'app.' + coreHash + '.js';
fs.writeFileSync(path.join(ASSETS, coreFile), jsCore, 'utf8');

const jsExtraRaw = concat(EXTRA_SCRIPTS);
const jsExtra = minify(jsExtraRaw, 'js');
const extraHash = hash10(jsExtra);
const extraFile = 'extra.' + extraHash + '.js';
fs.writeFileSync(path.join(ASSETS, extraFile), jsExtra, 'utf8');

const cssRaw = read('css/main.css');
const cssMin = minify(cssRaw, 'css');
const cssHash = hash10(cssMin);
const cssFile = 'main.' + cssHash + '.css';
fs.writeFileSync(path.join(ASSETS, cssFile), cssMin, 'utf8');

/* ---------- 3. 重写 index.html（幂等） ---------- */
{
  let h = read('index.html');

  /* html 标签挂 data-extra（boot.js 读它做懒加载） */
  if (/<html[^>]*\sdata-extra="[^"]*"/.test(h)) {
    h = h.replace(/data-extra="[^"]*"/, 'data-extra="assets/' + extraFile + '"');
  } else {
    h = h.replace(/<html([^>]*)>/, '<html$1 data-extra="assets/' + extraFile + '">');
  }

  /* CSS：css/main.css 或旧 hash → 新 hash */
  if (/<link rel="stylesheet" href="assets\/main\.[0-9a-f]+\.css">/.test(h)) {
    h = h.replace(/<link rel="stylesheet" href="assets\/main\.[0-9a-f]+\.css">/,
      '<link rel="stylesheet" href="assets/' + cssFile + '">');
  } else {
    h = h.replace(/<link rel="stylesheet" href="css\/main\.css">/,
      '<link rel="stylesheet" href="assets/' + cssFile + '">');
  }

  /* 脚本：清掉 js/*、contrib/manifest.js、旧 app hash，收成一条 */
  h = h.replace(/[ \t]*<script src="(?:js\/[^"]+|contrib\/manifest\.js|assets\/app\.[0-9a-f]+\.js)" defer><\/script>\r?\n/g, '');
  h = h.replace(/<\/body>/, '  <script src="assets/' + coreFile + '" defer></script>\n</body>');

  /* 预加载：必须跟着 app 的 hash 一起换，否则旧 hash 404 */
  h = h.replace(/<link rel="preload" href="assets\/app\.[0-9a-f]+\.js" as="script">/,
    '<link rel="preload" href="assets/' + coreFile + '" as="script">');

  /* preconnect：跨域游戏域名（幂等） */
  if (h.indexOf('rel="preconnect"') < 0) {
    h = h.replace(/<link rel="manifest" href="manifest.webmanifest">/,
      '<link rel="preconnect" href="https://ming-games.pages.dev" crossorigin>\n' +
      '<link rel="preconnect" href="https://warehouse-strike.pages.dev" crossorigin>\n' +
      '<link rel="manifest" href="manifest.webmanifest">');
  }

  /* 版本 meta（幂等） */
  const meta = '<meta name="wh-version" content="' + VERSION + '">';
  if (/<meta name="wh-version"/.test(h)) {
    h = h.replace(/<meta name="wh-version" content="[^"]*">/, meta);
  } else {
    h = h.replace(/<meta name="theme-color" content="[^"]*">/, (m) => m + '\n' + meta);
  }

  fs.writeFileSync(path.join(ROOT, 'index.html'), h, 'utf8');
}

/* ---------- 4. 生成 sw.js：交给 tools/gen-sw.mjs（CORE 清单 + 内容摘要版本号） ---------- */
/* 不再在这里手拼清单：清单与版本由工程现状扫描得出，产物不变版本不变 */
try {
  spawnSync(process.execPath, [path.join(ROOT, 'tools/gen-sw.mjs')], { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
  console.error('[build] gen-sw 失败，sw.js 未更新：' + e.message);
}

/* ---------- 5. 摘要 ---------- */
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('[build] version ' + VERSION + ' (' + BUILD_DATE + ')');
console.log('[build] ' + coreFile + '  ' + kb(jsCore.length) + '（源 ' + kb(jsCoreRaw.length) + '）');
console.log('[build] ' + extraFile + '  ' + kb(jsExtra.length) + '（懒加载）');
console.log('[build] ' + cssFile + '  ' + kb(cssMin.length) + '（源 ' + kb(cssRaw.length) + '）');
console.log('[build] 首屏引用：index.html + ' + coreFile + ' + ' + cssFile + ' + manifest/icon（+ data-extra 懒加载）');
