#!/usr/bin/env node
/* ============================================================
 * tools/make-standalone-server.mjs —— 生成「零依赖单文件开服脚本」
 * ------------------------------------------------------------
 * 产物：开服.mjs（项目根目录）
 *
 * 为什么：`node tools/tunnel.mjs` 前提是本地有完整的 tools/ 目录。
 * 实际交付里很多人拿到的是散落文件，本地没有 tools，于是永远卡在
 * `Cannot find module ...\tools\tunnel.mjs`，看着像环境坏了。
 * 把「房间服务 + 隧道」压成一个 .mjs：放哪都能 `node 开服.mjs`。
 *
 * 不另写一份服务端：内嵌的就是 server/ 下的真实实现（含 7 个玩法的
 * 服务端物理），保证单文件版与 `node server/index.js` 行为一致。
 *
 * 拼接方式（关键）：
 *   1. 每个模块包成独立 IIFE，末尾用 __M[路径] = module.exports 登记导出；
 *      require('./x') 改写成 _req('server/x.js')，从 __M 里取。
 *      相对路径语义被完整保留，服务端源码一个字不用改。
 *   2. 所有片段用 JSON.stringify 变成字符串数组，避免注释 / 引号 / ASI 踩坑。
 *   3. 末尾写一个临时 .cjs 承载全部片段，再 require 回来。
 *
 * 用法：node tools/make-standalone-server.mjs
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '开服.mjs');

const PARTS = [
  /* 顺序 = 依赖拓扑序：内嵌是顺序执行的，被依赖的模块必须先登记进 __M。
     protocol 是最底层；各玩法要在游戏注册表之前；注册表又要在 room-core 之前。 */
  'server/protocol.js',
  'server/games/bounce.js',
  'server/games/balloon.js',
  'server/games/tank.js',
  'server/games/snakebattle.js',
  'server/games/quiz.js',
  'server/games/draw.js',
  'server/games/pitch.js',
  'server/games/duel.js',
  'server/games/fist.js',
  'server/games/index.js',
  'server/room-core.js',
  'server/index.js'
];

/* require('./x') → _req('server/x.js')：把相对路径补成从项目根起算的键 */
function rewriteRequires(src, file) {
  return src.replace(/require\(\s*'(\.[^']*)'\s*\)/g, (m, rel) => {
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(file), rel));
    /* 解析成实际存在的文件：有 <p>.js 用 <p>.js，否则用 <p>/index.js */
    const asFile = abs + '.js';
    const hit = PARTS.includes(asFile) ? asFile
      : PARTS.includes(abs + '/index.js') ? abs + '/index.js'
        : asFile;
    return "_req('" + hit + "')";
  });
}

function asLiteral(file) {
  let s = fs.readFileSync(path.join(ROOT, file), 'utf8');
  s = s.replace(/^#![^\n]*\n/, '');
  s = rewriteRequires(s, file);
  if (file === 'server/index.js') {
    /* 单文件版强制用内置 WS 实现（不依赖 ws 包），并去掉自动 listen */
    s = s.replace(/\/\* 优先用 ws 包[\s\S]*?catch \(e\) \{ WSImpl = null; \}/,
      'var WSImpl = null;   /* 单文件版：强制内置实现，零依赖 */');
    const idx = s.indexOf('server.listen(PORT, HOST,');
    if (idx < 0) throw new Error('server/index.js 结构变了：找不到 listen');
    s = s.slice(0, idx);
    s = s.replace(/\/\* 每分钟扫一次空房 \*\/[\s\S]*?if \(sweep\.unref\) sweep\.unref\(\);\n?/, '');
    s = s.replace(/\s*$/, '') +
      '\n\nmodule.exports = { server: server, games: games, P: P, core: core };\n';
  }
  /* 外层用 __mod 承载模块对象，内层把同一个对象当 module/exports 传进去。
     必须写成 (function(){ var __mod = ...; ... })() —— 参数位置不能引用
     还没声明的变量。 */
  return JSON.stringify(
    '\n/* ---- ' + file + ' ---- */\n' +
    ';(function () {\n' +
    'var __mod = { exports: {} };\n' +
    '(function (module, exports) {\n' + s + '\n})(__mod, __mod.exports);\n' +
    '__M[' + JSON.stringify(file) + '] = __mod.exports;\n' +
    'if (__M[' + JSON.stringify(file) + '] && __M[' + JSON.stringify(file) + '].server) {\n' +
    '  module.exports = __M[' + JSON.stringify(file) + '];   /* 入口段：把 server 交给外层 */\n' +
    '}\n' +
    '})();\n'
  );
}

function main() {
  const head = fs.readFileSync(path.join(ROOT, 'tools/_standalone-head.mjs'), 'utf8');
  const tail = fs.readFileSync(path.join(ROOT, 'tools/_standalone-tail.mjs'), 'utf8');
  const chunks = PARTS.map(asLiteral);
  const out = head + chunks.join(',\n') + '\n];\n\n' + tail;
  fs.writeFileSync(OUT, out, 'utf8');
  console.log('[standalone] 产出：开服.mjs  ' + (Buffer.byteLength(out) / 1024).toFixed(1) + ' KB');
  console.log('[standalone] 内嵌：' + PARTS.length + ' 个服务端文件');
}

main();
