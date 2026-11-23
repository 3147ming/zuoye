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
  '_routes.json',
  'functions/',
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
  path.join('tools', 'check-contrib.mjs'),
  /* 联机（Durable Object）不进 Pages 包：Pages 不支持给 Functions 绑 DO，
     且本文件 import 了 ../../server/*，不带 server/ 会让 Functions 构建解析失败。
     线上联机走独立 Node 服务（node server/index.js），源码仍留在 functions/api/net.js 备查。 */
  path.join('functions', 'api', 'net.js')
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

/* 3. 注入线上联机地址
   ------------------------------------------------------------
   源码里的 games/party/index.html 保持 <meta name="wh-net" content="">（空），
   本地开发/自建服务走同源 /ws。线上静态站没有 /ws（Pages 不支持给 Functions
   绑 Durable Object），联机实际跑在独立 Worker 上，所以打包时把地址写进 meta。
   meta 只在部署包里出现，界面从不显示它——符合「UI 不暴露服务地址」的口径。
   多个地址用空格分隔，前端会按顺序尝试，第一个能用就留下。
   覆盖方式：环境变量 WH_NET_ENDPOINTS="wss://a/ws wss://b/ws" */
const NET_ENDPOINTS = (process.env.WH_NET_ENDPOINTS ||
  'wss://worldhub-ws.3147456217.workers.dev/ws').trim();
{
  const partyPath = path.join(OUT, 'games', 'party', 'index.html');
  if (!fs.existsSync(partyPath)) {
    fail('deploy 包里没有 games/party/index.html，联机地址无处注入');
  } else {
    const src = fs.readFileSync(partyPath, 'utf8');
    const tag = '<meta name="wh-net" content="';
    if (!src.includes(tag)) {
      fail('games/party/index.html 缺少 <meta name="wh-net">，联机地址无法注入');
    } else {
      let hit = 0;
      const out = src.replace(/<meta name="wh-net" content="[^"]*">/, () => {
        hit += 1;
        return '<meta name="wh-net" content="' + NET_ENDPOINTS + '">';
      });
      if (hit !== 1) fail('games/party/index.html 里 wh-net meta 数量异常：' + hit);
      else {
        fs.writeFileSync(partyPath, out);
        console.log('  · 联机地址已注入 → ' + NET_ENDPOINTS);
      }
    }
  }
}

/* 4. 校验 version.json */
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

/* 5. 页面里引用的脚本/样式是否都在包里 */
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
  const clean = rel.split('?')[0];
  const abs = path.resolve(OUT, clean);
  /* Cloudflare Pages 的 HTML 美容：/directory → /directory.html、/foo/ → /foo/index.html */
  const ok = fs.existsSync(abs) ||
    (/\/$/.test(clean) ? fs.existsSync(path.join(abs, 'index.html'))
                       : fs.existsSync(abs + '.html'));
  if (!ok) fail('index.html 引用了包里没有的文件：' + r);
}
console.log('  · index.html 引用的 ' + refs.length + ' 个本地资源全部在包内');

/* 6. 统计 */
const tot = countTree(OUT);
console.log('\n文件 ' + tot.files + ' 个，合计 ' + (tot.bytes / 1024 / 1024).toFixed(1) + 'MB');
console.log(bad ? '\n=== 结果：' + bad + ' 处问题 ===' : '\n=== 结果：deploy/ 可以上传 ===');
process.exit(bad ? 1 : 0);
