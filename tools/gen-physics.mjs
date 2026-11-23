#!/usr/bin/env node
/* ============================================================
 * tools/gen-physics.mjs —— 把服务端玩法里的「一帧物理」原样搬到浏览器
 * ------------------------------------------------------------
 * 为什么需要它：
 *   客户端预测必须和服务端算得一模一样。两份代码各写一遍迟早会分叉
 *   （改一个常量忘了另一个，预测就会一直往错的地方飘）。
 *   所以这里直接从 server/games/*.js 里把标记好的代码块抽出来，
 *   原样拼成 js/party/shared.js —— 服务端与客户端读的是同一段源码。
 *
 * 做法：
 *   · 只抽 // #shared-begin <name> 与 // #shared-end 之间的行；
 *   · 抽之前做「纯函数体检」：块内出现 Math.random / Date.now / setInterval
 *     之类不确定调用就直接失败（否则两边每帧都会分叉）；
 *   · 生成的文件带 hash 头，重复运行结果一致（幂等）。
 *
 * 用法：node tools/gen-physics.mjs [--check]
 *   --check 只比对不写盘（构建流程里用来防止忘记重新生成）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'js/party/shared.js');

/* 参与共享的玩法与顺序（顺序决定文件里的排列，改动会让 hash 变） */
const SOURCES = ['bounce.js', 'tank.js', 'pitch.js'];   /* 文件不存在时自动跳过 */

/* 共享块里定义的、需要给客户端用的名字（漏了会在浏览器里 undefined） */
const EXPORT_NAMES = [
  'createBody', 'stepBody', 'solidBody',
  'stepTank', 'tankBlocked', 'stepShell', 'newShell',
  'PT_C', 'pitchGeom', 'createBall', 'stepBall', 'stepPlayer', 'kickBall'
];

const FORBID = [
  [/Math\.random/, 'Math.random（客户端与服务端会算出不同结果）'],
  [/Date\.now|performance\.now/, 'Date.now / performance.now（时间不可复现）'],
  [/setTimeout|setInterval/, '定时器（帧边界不再对齐）'],
  [/require\(/, 'require（浏览器里没有）'],
  [/process\./, 'process 全局'],
  [/\bexports\./, 'exports（块内不能直接挂导出，改用块外的包装）']
];

function check(block, file, lines) {
  const bad = [];
  for (const [re, why] of FORBID) if (re.test(block)) bad.push(why);
  if (bad.length) {
    console.error(`✗ ${file} 的共享块不纯：` + bad.join('；'));
    console.error(lines.slice(0, 3).join('\n'));
    process.exit(1);
  }
}

export function build() {
  const parts = [];
  const manifest = [];
  for (const file of SOURCES) {
    const abs = path.join(ROOT, 'server/games', file);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8').split('\n');
    let i = 0;
    while (i < src.length) {
      const m = /#shared-begin\s+([\w.-]+)/.exec(src[i]);
      if (!m) { i += 1; continue; }
      const name = m[1];
      const start = i;
      let j = i + 1;
      while (j < src.length && !/#shared-end/.test(src[j])) j += 1;
      if (j >= src.length) {
        console.error(`✗ ${file} 里 #shared-begin ${name} 没有对应的 #shared-end`);
        process.exit(1);
      }
      const body = src.slice(start + 1, j);
      check(body.join('\n'), file + ' :: ' + name, body);
      parts.push(
        `/* ---- ${file} :: ${name} ---- */\n` + body.join('\n')
      );
      manifest.push(file + ':' + name + ' (' + body.length + ' 行)');
      i = j + 1;
    }
  }

  const body = parts.join('\n\n');
  /* 导出块：把共享块里定义的函数/常量挂出来，客户端按名字取用 */
  /* 只导出「在共享块里真的定义了」的名字，避免导出一堆 undefined */
  const defined = new Set();
  for (const m of body.matchAll(/^(?:function\s+([A-Za-z_$\w]+)|var\s+([A-Za-z_$\w]+))/gm)) {
    defined.add(m[1] || m[2]);
  }
  const names = EXPORT_NAMES.filter((n) => defined.has(n));
  const exports = names.map((n) => ` ${n}: ${n}`).join(',');
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 10);

  const out = `/* ============================================================
 * js/party/shared.js —— 与服务端同源的「一帧物理」（自动生成，别手改）
 * ------------------------------------------------------------
 * 由 tools/gen-physics.mjs 从下列代码块原样抽取：
 *   ${manifest.join('\n *   ') || '（无）'}
 * 源码指纹：${hash}
 * 改动玩法物理后执行 node tools/gen-physics.mjs 重新生成；
 * 构建脚本会检查这里和源码是否同步（不同步直接报错）。
 * ============================================================ */
(function (global) {
  'use strict';
  var SHARED = {};

${body.split('\n').map((l) => (l ? '  ' + l : '')).join('\n')}

  var EXPORTS = {${exports}};
  for (var k in EXPORTS) if (Object.prototype.hasOwnProperty.call(EXPORTS, k)) SHARED[k] = EXPORTS[k];
  SHARED.__hash = '${hash}';
  global.WH_SHARED = SHARED;
  if (typeof module === 'object' && module.exports) module.exports = SHARED;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

  return { text: out, hash, manifest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { text, hash, manifest } = build();
  const checkOnly = process.argv.includes('--check');
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old === text) {
    console.log('· 无需更新，js/party/shared.js 已是最新（' + hash + '）');
    console.log('  ' + manifest.join('\n  '));
  } else if (checkOnly) {
    console.error('✗ js/party/shared.js 与 server/games 源码不同步，请运行 node tools/gen-physics.mjs');
    process.exit(1);
  } else {
    fs.writeFileSync(OUT, text);
    console.log('✓ 已生成 js/party/shared.js（' + hash + '）');
    console.log('  ' + manifest.join('\n  '));
  }
}
