#!/usr/bin/env node
/* ============================================================
 * tools/gen-sw.mjs —— 从工程现状生成 sw.js（CORE 清单 + 版本号）
 * ------------------------------------------------------------
 * 解决的问题：sw.js 过去把 app.<hash>.js 这类文件名写死，重新构建后
 * 预缓存会静默 404，离线能力悄悄失效且没有任何报错。
 *
 * 做法：扫描工程里真实存在的产物，生成 SHELL / LAZY 两份清单；版本号 = 清单摘要 +
 *      未 hash 源文件内容摘要，所以
 *        · 产物没变 → 版本号不变（不会无意义地让用户重下缓存）
 *        · 产物变了 → 版本号自动变（activate 时清理旧缓存）
 *
 * 用法：
 *   node tools/gen-sw.mjs                        # 写回 ./sw.js
 *   node tools/gen-sw.mjs --dist ./dist          # 生成到指定目录（部署包）
 *   node tools/gen-sw.mjs --check                # 只校验不写盘（CI / 发版前）
 * 可选：--template <path>（默认 ./sw.template.js）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argOf(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const CHECK_ONLY = process.argv.includes('--check');
const DIST = path.resolve(ROOT, argOf('dist', '.'));
const TEMPLATE = path.resolve(ROOT, argOf('template', 'sw.template.js'));

const walk = (dir, base = dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
};

if (!fs.existsSync(DIST)) { console.error('[gen-sw] 目录不存在：' + DIST); process.exit(1); }
const files = walk(DIST).sort();

/* 只收：带 hash 的打包产物 + 区块入口页 + 必要入口文件 */
const hashed = files.filter((f) => /^assets\/.+[.-][0-9a-f]{10}\.(js|css)$/.test(f));
const pages = files.filter((f) => /^(games|tools)\/.+\/(index|timer|pet)\.html$/.test(f));
const NEED = ['/index.html', '/manifest.webmanifest'];

const present = new Set(files.map((f) => '/' + f));

/* SHELL：首屏必须，install 时立刻拿（约 225KB） */
const shell = ['/'];
for (const p of NEED) {
  if (present.has(p)) shell.push(p);
  else console.warn('[gen-sw] 警告：缺少 ' + p + '，已跳过');
}
for (const f of hashed) shell.push('/' + f);

/* LAZY：区块入口页（含 tools/pomodoro/timer.html 这类二级页），
   按体积升序排——轻的先缓存，重的留给「目录悬停预热」和首次访问。
   字体 demo 页（games/snake/fonts/*.html）不属于入口，排除。 */
const lazy = Array.from(new Set(pages
  .filter((f) => !/\/fonts\//.test(f))
  .map((f) => '/' + f)
  .concat(['/tools/pomodoro/timer.html', '/tools/pomodoro/pet.html'].filter((p) => present.has(p)))))
  .sort((a, b) => {
    const size = (p) => { try { return fs.statSync(path.join(DIST, p.slice(1))).size; } catch (e) { return 0; } };
    return size(a) - size(b);
  });

const core = shell.concat(lazy);   /* 版本号覆盖两份清单 */

/* 版本 = CORE 清单 + 未 hash 源文件的内容摘要：
   光看文件名抓不到 games/*.js、tools/*.js 这类同名的源码改动 */
const extra = ['index.html', 'sw.template.js', 'css/main.css', 'games/party/party.css']
  .filter((f) => fs.existsSync(path.join(DIST, f)))
  .concat(files.filter((f) => /^js\/[^/]+\.js$/.test(f) || /^js\/party\/.+\.js$/.test(f) || /^contrib\//.test(f) || /^server\/protocol\.js$/.test(f)).sort());
const h = crypto.createHash('sha256').update(core.join('|'));
for (const f of extra) {
  const p = path.join(DIST, f);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) h.update(f).update(fs.readFileSync(p));
}
const digest = h.digest('hex').slice(0, 10);
const version = 'worldhub-' + digest;

if (!fs.existsSync(TEMPLATE)) { console.error('[gen-sw] 模板不存在：' + TEMPLATE); process.exit(1); }
const tpl = fs.readFileSync(TEMPLATE, 'utf8');
for (const ph of ['/*__VERSION__*/', '/*__SHELL__*/', '/*__LAZY__*/']) {
  if (!tpl.includes(ph)) { console.error('[gen-sw] 模板缺少占位符 ' + ph); process.exit(1); }
}
const lit = (arr) => '[\n' + arr.map((p) => "  '" + p + "'").join(',\n') + '\n]';
const output = tpl
  .replace('/*__VERSION__*/', "'" + version + "'")
  .replace('/*__SHELL__*/', lit(shell))
  .replace('/*__LAZY__*/', lit(lazy));

const outPath = path.join(DIST, 'sw.js');

if (CHECK_ONLY) {
  const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  const m = cur.match(/const VERSION = '([^']+)'/);
  const ok = m && m[1] === version;
  console.log('[gen-sw] check：期望 ' + version + '，实际 ' + (m ? m[1] : '无 sw.js') + ' → ' + (ok ? '一致' : '不一致'));
  process.exit(ok ? 0 : 1);
}

fs.writeFileSync(outPath, output, 'utf8');
console.log('[gen-sw] 版本：' + version + '（内容未变则不变）');
console.log('[gen-sw] SHELL ' + shell.length + ' 项（首页 + assets ' + hashed.length + '）· LAZY ' + lazy.length + ' 项（区块入口页）+ 源文件摘要 ' + extra.length + ' 个');
console.log('[gen-sw] 已写入：' + path.relative(ROOT, outPath));
