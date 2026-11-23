#!/usr/bin/env node
/**
 * 一键开服：本地起联机服务 + Cloudflare 隧道，把公网地址打印出来发给朋友。
 *
 *   node tools/tunnel.mjs              起服务 + 隧道（需要 cloudflared）
 *   node tools/tunnel.mjs --local      只起本地服务（同 WiFi 玩，不需要 cloudflared）
 *   node tools/tunnel.mjs --port 9000  换端口
 *
 * 注意：必须在项目根目录执行（或直接双击 开服.bat，它会自动 cd 进来）。
 *       在 C:\Users\xxx> 下敲 node tools/tunnel.mjs 会报 MODULE_NOT_FOUND，
 *       因为那里没有 tools 目录——不是环境坏了，是站错地方了。
 *       脚本里也做了同样的自检，会直接把正确做法打出来。
 *
 * 退出：Ctrl+C，两个子进程会一起收掉。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs, { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CWD = process.cwd();
const ROOT_OK = existsSync(path.join(ROOT, 'server', 'index.js'));
const CWD_OK = existsSync(path.join(CWD, 'tools', 'tunnel.mjs')) || existsSync(path.join(CWD, 'server', 'index.js'));
const args = process.argv.slice(2);
const LOCAL_ONLY = args.includes('--local');
const portArg = args.indexOf('--port');
const PORT = portArg > -1 ? Number(args[portArg + 1]) : (Number(process.env.PORT) || 8787);

const isWin = process.platform === 'win32';
const C = isWin
  ? { g: '', y: '', c: '', d: '', r: '', b: '' }   /* Windows 控制台对 ANSI 支持不稳，干脆不上色 */
  : { g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', r: '\x1b[31m', b: '\x1b[0m' };
/* Windows 的 cmd 即使 chcp 65001，画框字符也常错位，用 ASCII 更稳 */
const BOX = isWin
  ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }
  : { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };

function line(s = '') { process.stdout.write(s + '\n'); }
function box(lines, color = C.g) {
  const w = Math.max(...lines.map((l) => [...l].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)));
  const pad = (l) => l + ' '.repeat(Math.max(0, w - [...l].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)));
  line(color + '  ' + BOX.tl + BOX.h.repeat(w + 2) + BOX.tr + C.b);
  for (const l of lines) line(color + '  ' + BOX.v + ' ' + pad(l) + ' ' + BOX.v + C.b);
  line(color + '  ' + BOX.bl + BOX.h.repeat(w + 2) + BOX.br + C.b);
}

/* ---------- 找一个可用的内网 IP ---------- */
function lanIP() {
  const nets = os.networkInterfaces();
  const prefer = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (/^169\.254\./.test(ni.address)) continue;
      /* 最常见的家用/办公网段优先 */
      const score = /^192\.168\./.test(ni.address) ? 0 : /^10\./.test(ni.address) ? 1 : 2;
      prefer.push({ ip: ni.address, score, name });
    }
  }
  prefer.sort((a, b) => a.score - b.score);
  return prefer.length ? prefer[0].ip : '127.0.0.1';
}

/* ---------- 等本地服务就绪 ---------- */
function waitReady(port, timeoutMs = 15000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 1200 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - t0 > timeoutMs) return reject(new Error('本地服务启动超时'));
      setTimeout(tick, 300);
    };
    tick();
  });
}

/* ---------- 找 cloudflared ---------- */
function findCloudflared() {
  const names = isWin ? ['cloudflared.exe', 'cloudflared'] : ['cloudflared'];
  for (const n of names) {
    const p = path.join(ROOT, n);
    if (existsSync(p)) return p;
  }
  const which = spawnSync(isWin ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (which.status === 0) {
    const out = (which.stdout || '').split(/\r?\n/).filter(Boolean)[0];
    if (out && existsSync(out.trim())) return out.trim();
  }
  return null;
}

/* ---------- 自动下载 ---------- */
function downloadTo(url, dest, label) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const fail = (e) => { try { out.destroy(); } catch (x) {} reject(e); };
    const go = (u, hop) => {
      if (hop > 5) return fail(new Error('重定向过多'));
      const mod = u.startsWith('https:') ? https : http;
      const req = mod.get(u, { timeout: 20000, headers: { 'User-Agent': 'worldhub-launcher' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, u).toString(), hop + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
        const total = Number(res.headers['content-length'] || 0);
        const tty = !!process.stdout.isTTY;
        let got = 0;
        let last = 0;
        let lastPct = -1;
        res.on('data', (c) => {
          got += c.length;
          const now = Date.now();
          const pct = total ? Math.floor((got / total) * 100) : -1;
          /* 终端里用 \r 原地刷新；重定向到文件时每 10% 打一行，别刷屏 */
          if (tty ? now - last > 200 : pct >= lastPct + 10) {
            last = now;
            lastPct = pct;
            const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
            const tail = total ? mb(got) + ' / ' + mb(total) + '  ' + pct + '%' : mb(got);
            if (tty) process.stdout.write('\r    ' + label + ' ' + tail + '   ');
            else line('    ' + label + ' ' + tail);
          }
        });
        res.pipe(out);
        out.on('finish', () => { process.stdout.write('\n'); out.close(() => resolve(true)); });
        out.on('error', fail);
      });
      req.on('timeout', () => { req.destroy(); fail(new Error('连接超时')); });
      req.on('error', fail);
    };
    go(url, 0);
  });
}

function cloudflaredSources() {
  const file = isWin
    ? 'cloudflared-windows-amd64.exe'
    : process.platform === 'darwin'
      ? 'cloudflared-darwin-amd64.tgz'
      : 'cloudflared-linux-amd64';
  const official = 'https://github.com/cloudflare/cloudflared/releases/latest/download/' + file;
  return [
    'https://gh-proxy.com/' + official,
    official,
    'https://ghfast.top/' + official
  ];
}

const children = [];
function cleanup(code = 0) {
  for (const ch of children) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(ch.pid), '/T', '/F'], { stdio: 'ignore' });
      else ch.kill('SIGTERM');
    } catch (e) { /* ignore */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => { line('\n  ' + C.d + '已停止。' + C.b); cleanup(0); });
process.on('SIGTERM', () => cleanup(0));

async function main() {
  line('');
  line(C.c + '  WorldHub 联机服务' + C.b + C.d + '  ·  本机开服，朋友用浏览器进来' + C.b);
  line('');

  /* 0. 先自检：必须在项目根目录跑，否则后面会以「找不到某个文件」的形式报错，
        提示词和真正原因对不上，很容易被误判成环境坏了。 */
  if (!ROOT_OK || !CWD_OK) {
    line(C.r + '  这个脚本要在 WorldHub 项目目录里跑。' + C.b);
    line('');
    line('  当前脚本位置：' + path.dirname(fileURLToPath(import.meta.url)));
    line('  应该存在：' + path.join(ROOT, 'server', 'index.js'));
    line('');
    line('  正确做法：');
    line('  1) 先把终端 cd 到项目目录（就是能看到「开服.bat」的那个文件夹）');
    line('     例：' + C.c + 'cd D:\\Projects\\WorldHub' + C.b);
    line('  2) 再执行：' + C.c + 'node tools/tunnel.mjs' + C.b);
    line('');
    line('  更省事：直接双击项目根目录的 ' + C.c + '开服.bat' + C.b + '，它会自己 cd 进去。');
    line('');
    line('  ' + C.d + '注意：node tools/tunnel.mjs 这一行必须在项目目录里执行，' + C.b);
    line('  ' + C.d + '在 C:\\Users\\你的用户名> 下执行会找不到 tools 目录。' + C.b);
    line('');
    cleanup(1);
    return;
  }

  /* 1. 起服务 */
  line('  ' + C.d + '启动房间服务…' + C.b);
  const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(srv);
  srv.stdout.on('data', (b) => {
    const s = String(b);
    if (/已启动|listening/i.test(s)) return;   /* 自己会打印更清楚的地址，别重复 */
    process.stdout.write(C.d + s.replace(/\n+$/, '\n') + C.b);
  });
  let portBusy = false;
  let srvErr = '';
  srv.stderr.on('data', (b) => {
    const s = String(b);
    if (/EADDRINUSE/.test(s)) { portBusy = true; return; }   /* 这条下面会用人话重讲一遍 */
    if (/EACCES|EPERM/.test(s)) { portBusy = true; return; }
    srvErr += s;
  });
  srv.on('exit', (code) => {
    if (!code) return;
    if (portBusy) {
      line('  ' + C.y + '端口 ' + PORT + ' 被占用了。' + C.b);
      line('  ' + C.d + '多半是上一次开服窗口没关干净（或者别的程序占了 8787）。' + C.b);
      line('');
      line('  两个办法，任选一个：');
      line('  1) 把之前那个黑窗口关掉，再重跑一次');
      line('  2) 换个端口：' + C.c + 'node tools/tunnel.mjs --port 9000' + C.b);
      line('     ' + C.d + '（双击 开服.bat 的话，右键编辑最后一行加上 --port 9000）' + C.b);
    } else {
      line(C.r + '  房间服务退出了（code ' + code + '）。' + C.b);
      if (srvErr.trim()) line(C.d + srvErr.trim().split('\n').slice(0, 4).join('\n') + C.b);
    }
    cleanup(1);
  });

  await waitReady(PORT);
  const lan = lanIP();
  const localUrl = 'http://127.0.0.1:' + PORT + '/games/party/';
  const lanUrl = 'http://' + lan + ':' + PORT + '/games/party/';

  line('  ' + C.g + '✓' + C.b + ' 房间服务已就绪');
  line('');

  if (LOCAL_ONLY) {
    box(['本机打开：' + localUrl, '同一个 WiFi 的朋友：' + lanUrl], C.g);
    line('');
    line('  ' + C.d + '（--local 模式：没有公网地址，异地朋友连不上；按 Ctrl+C 停止）' + C.b);
    line('');
    return;
  }

  /* 2. 起隧道 */
  let cfd = findCloudflared();
  if (!cfd) {
    /* 没装就自动下一份（一次性，约 53MB），省掉「去官网下、解压、改名、放对位置」四步 */
    const dest = path.join(ROOT, isWin ? 'cloudflared.exe' : 'cloudflared');
    line(C.y + '  首次运行，正在准备隧道客户端' + C.b + C.d + '（约 53 MB，只需这一次）' + C.b);
    line('');
    for (const src of cloudflaredSources()) {
      const host = (src.match(/^https:\/\/([^/]+)/) || [])[1] || '?';
      try {
        await downloadTo(src, dest, '下载中');
        cfd = dest;
        line('  ' + C.g + '✓' + C.b + ' 已下载（来源 ' + host + '）');
        break;
      } catch (e) {
        try { fs.unlinkSync(dest); } catch (x) { /* ignore */ }
        line('  ' + C.d + '这个源不行（' + host + '：' + e.message + '），换下一个…' + C.b);
      }
    }
    if (cfd) {
      try { fs.chmodSync(dest, 0o755); } catch (e) { /* Windows 不需要 */ }
    }
  }

  if (!cfd) {
    line('');
    line(C.r + '  自动下载没成功。' + C.b);
    line('');
    line('  手动下一个，放到项目根目录（和 开服.bat 同一层），文件名改成 cloudflared.exe：');
    line('');
    if (isWin) {
      line(C.c + '    https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' + C.b);
    } else if (process.platform === 'darwin') {
      line(C.c + '    brew install cloudflared' + C.b);
    } else {
      line(C.c + '    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64' + C.b);
    }
    line('');
    line('  或者先只跟同一个 WiFi 的人玩：' + C.c + 'node tools/tunnel.mjs --local' + C.b);
    line('');
    line('  ' + C.d + '房间服务还在跑，Ctrl+C 结束。' + C.b);
    return;
  }

  line('  ' + C.d + '建立公网隧道…（首次要几秒）' + C.b);
  const tun = spawn(cfd, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(tun);

  let publicUrl = '';
  const onOut = (b) => {
    const s = String(b);
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && !publicUrl) {
      publicUrl = m[0];
      const party = publicUrl + '/games/party/';
      line('');
      box([
        '发给朋友这个地址：',
        '',
        party,
        '',
        '（手机、异地都能打开，不用装任何东西）'
      ], C.g);
      line('');
      line('  ' + C.c + '本机也可以直接开：' + C.b + localUrl);
      line('  ' + C.d + '同一 WiFi 的朋友：' + C.b + lanUrl);
      line('');
      line('  ' + C.d + '地址每次重启都会变，重新跑一次就是新的。按 Ctrl+C 停止。' + C.b);
      line('');
    }
    if (!publicUrl && /ERR|error/i.test(s)) process.stderr.write(C.d + s + C.b);
  };
  tun.stdout.on('data', onOut);
  tun.stderr.on('data', onOut);
  tun.on('exit', (code) => {
    if (code && !publicUrl) {
      line(C.r + '  隧道没能建立（code ' + code + '）。' + C.b);
      line('  ' + C.d + '常见原因：网络挡住了 Cloudflare、或公司网络禁止外连。' + C.b);
      line('  ' + C.d + '退一步用同一个 WiFi 玩：node tools/tunnel.mjs --local' + C.b);
      cleanup(1);
    }
  });
}

main().catch((e) => {
  line(C.r + '  出错：' + e.message + C.b);
  cleanup(1);
});
