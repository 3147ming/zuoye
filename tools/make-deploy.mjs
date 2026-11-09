#!/usr/bin/env node
/* ============================================================
 * tools/make-deploy.mjs —— 生成 Cloudflare Pages 用的上传包
 * ------------------------------------------------------------
 * 用法：node tools/make-deploy.mjs
 *
 * 做的事：
 *   1) 清空并重建 deploy/；
 *   2) 只拷「页面真正会加载的东西」（白名单），
 *      历史留档 js/games/、开发脚本 tools/check-contrib.mjs、探针、.workbuddy 都不进包；
 *   3) 顺手校验 version.json 存在且能被 JSON.parse，并统计体积。
 *
 * deploy/ 不进 git（体积约 28MB，且可由本脚本随时重建）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'deploy');

/* 白名单：目录以 / 结尾，其余按文件 */
const COPY = [
  'index.html',
  'directory.html',
  'sitemap.xml',
  'robots.txt',
  'version.json',
  '404.html',
  'manifest.webmanifest',
  'sw.js',
  '_headers',
  '_redirects',
  'css/',
  'js/',
  'games/',
  'tools/noise/',
  'tools/pomodoro/',
  'tools/board/',
  'tools/links/',
  'tools/timer/',
  'tools/unit/',
  'tools/color/',
  'contrib/',
  'assets/'
];

/* 即使在白名单目录内也要跳过的东西 */
const SKIP = [
  path.join('js', 'games'),          // 历史实现，index.html 已不加载
  path.join('tools', 'check-contrib.mjs')
];

const skipAbs = SKIP.map((p) => path.resolve(ROOT, p));

function isSkipped(abs) {
  return skipAbs.some((s) => abs === s || abs.startsWith(s + path.sep));
}

function countTree(dir) {
  let files = 0, bytes = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (isSkipped(p)) continue;
    if (ent.isDirectory()) {
      const sub = countTree(p);
      files += sub.files; bytes += sub.bytes;
    } else {
      files += 1; bytes += fs.statSync(p).size;
    }
  }
  return { files, bytes };
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (isSkipped(from)) continue;
    if (ent.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

let bad = 0;
const fail = (m) => { bad++; console.log('  ✗ ' + m); };

console.log('=== 生成 deploy/ ===\n');

/* 1. 清场 */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* 2. 拷白名单 */
for (const rel of COPY) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { fail('白名单里有不存在的东西：' + rel); continue; }
  const dest = path.join(OUT, rel);
  if (fs.statSync(src).isDirectory()) copyTree(src, dest);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  console.log('  + ' + rel);
}

/* 3. 校验 version.json */
const vj = path.join(OUT, 'version.json');
if (!fs.existsSync(vj)) fail('deploy/version.json 不在，「检查更新」会报读不到');
else {
  try {
    const v = JSON.parse(fs.readFileSync(vj, 'utf8'));
    if (!v.version) fail('version.json 没有 version 字段');
    else console.log('  · 版本 v' + v.version + ' · ' + (v.build || '无日期'));
  } catch (e) {
    fail('version.json 不是合法 JSON：' + e.message);
  }
}

/* 4. 页面里引用的脚本/样式是否都在包里 */
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [];
const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
let m;
while ((m = re.exec(html))) {
  const v = m[1].trim();
  if (/^(https?:)?\/\//i.test(v) || /^(data:|#|mailto:)/i.test(v)) continue;
  refs.push(v);
}
for (const r of refs) {
  const rel = r.startsWith('/') ? r.slice(1) : r;          /* 处理绝对路径引用，如 /assets/icon.svg */
  const abs = path.resolve(OUT, rel.split('?')[0]);
  if (!fs.existsSync(abs)) fail('index.html 引用了包里没有的文件：' + r);
}
console.log('  · index.html 引用的 ' + refs.length + ' 个本地资源全部在包内');

/* 5. 统计 */
const tot = countTree(OUT);
console.log('\n文件 ' + tot.files + ' 个，合计 ' + (tot.bytes / 1024 / 1024).toFixed(1) + 'MB');
console.log(bad ? '\n=== 结果：' + bad + ' 处问题 ===' : '\n=== 结果：deploy/ 可以上传 ===');
process.exit(bad ? 1 : 0);
