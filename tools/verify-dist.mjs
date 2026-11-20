#!/usr/bin/env node
/* ============================================================
 * tools/verify-dist.mjs —— 部署前产物校验（可挂 CI / 发版脚本）
 * ------------------------------------------------------------
 * 校验项：
 *   1. sw.js 的 SHELL / LAZY 两份清单每一项都真实存在（Pages 路由解析）
 *   2. /assets 下的 CORE 条目必须带内容 hash（否则违反 immutable 缓存）
 *   3. index.html 引用的本地资源全部存在（防漏拷产物 / 残留旧 hash）
 *   4. index.html 的 viewport 含 viewport-fit=cover（安全区适配的前提）
 *   5. 补丁层已并回源工程：assets/ 下不再有未 hash 的 fix.* 产物，
 *      index.html 也不再引用它们
 *
 * 用法：node tools/verify-dist.mjs [--dist ./dist]
 * 退出码：0 通过 / 1 有问题
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--dist');
const DIST = path.resolve(ROOT, i > -1 && process.argv[i + 1] ? process.argv[i + 1] : '.');

const problems = [];
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/* Pages 路由解析：/directory 可能对应 directory.html 或 directory/index.html */
function routeExists(u) {
  const clean = u.replace(/^\//, '');
  if (!clean) return isFile(path.join(DIST, 'index.html'));
  return [clean, clean + '.html', path.join(clean, 'index.html')]
    .some((c) => isFile(path.join(DIST, c)));
}

/* ---- 1/2：sw.js 的 SHELL / LAZY 清单 ---- */
const swPath = path.join(DIST, 'sw.js');
let core = [];
if (!isFile(swPath)) {
  problems.push('缺少 sw.js');
} else {
  const sw = fs.readFileSync(swPath, 'utf8');
  const grab = (k) => {
    const m = sw.match(new RegExp('const ' + k + ' = \\[([\\s\\S]*?)\\];'));
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
  };
  const shell = grab('SHELL');
  const lazy = grab('LAZY');
  if (!shell) problems.push('sw.js 未找到 SHELL 清单');
  if (!lazy) problems.push('sw.js 未找到 LAZY 清单');
  if (shell && !shell.length) problems.push('SHELL 清单为空');
  if (lazy && !lazy.length) problems.push('LAZY 清单为空');
  core = (shell || []).concat(lazy || []);
  /* install 只缓存 SHELL：它必须体量可控，否则又回到「首屏抢带宽」 */
  const shellBytes = (shell || []).reduce((a, u) => {
    const p = u === '/' ? 'index.html' : u.replace(/^\//, '');
    try { return a + fs.statSync(path.join(DIST, p)).size; } catch { return a; }
  }, 0);
  if (shellBytes > 400 * 1024) {
    problems.push('SHELL 体积 ' + Math.round(shellBytes / 1024) + 'KB 超出 400KB（install 会拖慢首屏）');
  }
  for (const p of core) {
    if (!routeExists(p)) problems.push('CORE 条目不存在：' + p);
    if (/^\/assets\/.+\.(js|css)$/.test(p) && !/[.-][0-9a-f]{10}\.(js|css)$/.test(p)) {
      problems.push('assets 产物缺少内容 hash（会违反 immutable 缓存）：' + p);
    }
  }
  if (!/const VERSION = 'worldhub-[0-9a-f]{10}';/.test(sw)) {
    problems.push('sw.js 的 VERSION 不是内容摘要格式（应形如 worldhub-xxxxxxxxxx）');
  }
}

/* ---- 3/4：index.html 引用与视口声明 ---- */
const indexPath = path.join(DIST, 'index.html');
if (!isFile(indexPath)) {
  problems.push('缺少 index.html');
} else {
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!/viewport-fit=cover/.test(html)) {
    problems.push('index.html 的 viewport 缺少 viewport-fit=cover（刘海屏安全区不会生效）');
  }
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((x) => x[1])
    .filter((u) => !/^(https?:|data:|mailto:|#|\/\/)/.test(u));
  for (const ref of refs) {
    const clean = ref.split('?')[0];
    if (clean && !routeExists(clean)) problems.push('index.html 引用的资源不存在：' + ref);
  }
  if (/assets\/fix\.[0-9a-f]+\.(css|js)/.test(html)) {
    problems.push('index.html 仍在引用补丁层 fix.*（应已并回源工程）');
  }
}

/* ---- 5：补丁层残留 ---- */
const assetsDir = path.join(DIST, 'assets');
if (fs.existsSync(assetsDir)) {
  for (const f of fs.readdirSync(assetsDir)) {
    if (/^fix\..*\.(css|js)$/.test(f)) problems.push('assets/ 仍有补丁层残留：' + f);
    if (/\.(js|css)$/.test(f) && !/[.-][0-9a-f]{10}\.(js|css)$/.test(f)) {
      problems.push('assets/ 下有未 hash 的产物：' + f);
    }
  }
}

/* ---- 6：联机模块自洽 ---- */
const partyHtml = path.join(DIST, 'games/party/index.html');
if (isFile(partyHtml)) {
  const html = fs.readFileSync(partyHtml, 'utf8');
  /* games.js 拆过：公共底座 + 八个玩法各一个文件。少一个玩法文件就等于少一个玩法，
     而且因为 K.register 没执行，界面上那张卡点了会真的开不出局，所以逐个查。 */
  const PARTY_JS = [
    'js/party/net.js', 'js/party/kit.js', 'js/party/lobby.js',
    'js/party/games.js', 'js/party/games.bounce.js', 'js/party/games.balloon.js',
    'js/party/games.tank.js', 'js/party/games.snake.js', 'js/party/games.quiz.js',
    'js/party/games.draw.js', 'js/party/games.pitch.js', 'js/party/games.duel.js'
  ];
  for (const f of PARTY_JS) {
    if (!html.includes('/' + f)) problems.push('联机页缺少引用：' + f);
    if (!routeExists('/' + f)) problems.push('联机页引用的文件不存在：' + f);
  }
  if (!html.includes('/games/party/party.css')) problems.push('联机页缺少引用：/games/party/party.css');
  if (!routeExists('/games/party/party.css')) problems.push('联机页引用的文件不存在：/games/party/party.css');
  /* 房间号规则必须与 server/protocol.js 一致：1–5 位数字（< 6 位） */
  const netSrc = fs.existsSync(path.join(DIST, 'js/party/net.js')) ? fs.readFileSync(path.join(DIST, 'js/party/net.js'), 'utf8') : '';
  if (netSrc && !/CODE_RE:\s*\/\^\[1-9\]\\d\{0,4\}\$\//.test(netSrc)) {
    problems.push('前端房间号正则不是 1–5 位数字（应与 server/protocol.js 一致）');
  }
  if (netSrc && !/PASS_RE:\s*\/\^\\d\{4\}\$\//.test(netSrc)) {
    problems.push('前端密码正则不是 4 位数字');
  }
  if (!routeExists('/games/party/index.html')) problems.push('缺少联机大厅页 games/party/index.html');
}

if (problems.length) {
  console.error('[verify] 发现 ' + problems.length + ' 个问题：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('[verify] 通过：SHELL+LAZY ' + core.length + ' 项、index.html 引用完整、视口声明正确、无补丁层残留');
