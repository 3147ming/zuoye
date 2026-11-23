/* 静态页面根目录：脚本旁边如果有游戏页面（index.html + games/），就顺手托管，
   这样同一个 WiFi 的朋友直接开 http://<内网IP>:端口/games/party/ 就能玩。
   没有页面也不报错：服务端会自己决定怎么回根路径（隧道 302 到线上大厅、
   本机/局域网给说明页），总之不会再让人看到 not found。 */
const WEB_ROOT = [HERE, path.join(HERE, 'dist'), path.join(HERE, '..')].find((d) => {
  try {
    return existsSync(path.join(d, 'index.html')) && existsSync(path.join(d, 'games'));
  } catch (e) { return false; }
});
if (WEB_ROOT) process.env.WH_ROOT = WEB_ROOT;
else process.env.WH_STATIC = 'off';   /* 明确告诉服务端：这次真没有页面 */

/* 把内嵌片段写成一个临时 .cjs（CommonJS）并 require 回来：
   服务端是 require / module.exports 风格，在 ESM 里直接跑会报「require is not defined」。
   原样承载 + 模块表（__M / _req）能完整保留 require 的相对路径语义，服务端源码一个字不用改。 */
const NL = String.fromCharCode(10);
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-server-'));
const TMP_FILE = path.join(TMP_DIR, 'embedded.cjs');
fs.writeFileSync(TMP_FILE, [
  '"use strict";',
  "var __M = Object.create(null);",
  "function _req(k) { if (!(k in __M)) throw new Error('内嵌模块缺失: ' + k); return __M[k]; }",
  SERVER_CHUNKS.join(NL)
].join(NL), 'utf8');
process.on('exit', () => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

/* 加载内嵌模块：入口段在包裹层已经把 { server, games, P, core } 交给外层 module.exports。 */
const S1 = require(TMP_FILE);
const S = (S1 && S1.server) ? S1 : require(TMP_FILE);
const server = S && S.server;
const games = (S && S.games) || { ids: [], list: () => [], CATALOG: [] };

if (!server) {
  line(C.r + '  内嵌的服务端没加载成功（生成脚本可能坏了）。' + C.b);
  process.exit(1);
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    line('');
    line(C.y + '  端口 ' + PORT + ' 被占用了。' + C.b);
    line(C.d + '  多半是上一次开服窗口没关干净（或者别的程序占了 ' + PORT + '）。' + C.b);
    line('');
    line('  两个办法，任选一个：');
    line('  1) 把之前那个黑窗口关掉，再重跑一次');
    line('  2) 换个端口：' + C.c + 'node 开服.mjs --port 9000' + C.b);
    line('');
    process.exit(1);
  }
  line(C.r + '  服务启动失败：' + e.message + C.b);
  process.exit(1);
});

function lanIP() {
  const nets = os.networkInterfaces();
  const prefer = [];
  for (const list of Object.values(nets)) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (/^169\.254\./.test(ni.address)) continue;
      const score = /^192\.168\./.test(ni.address) ? 0 : /^10\./.test(ni.address) ? 1 : 2;
      prefer.push({ ip: ni.address, score });
    }
  }
  prefer.sort((a, b) => a.score - b.score);
  return prefer.length ? prefer[0].ip : '127.0.0.1';
}

/* ---------- 隧道 ---------- */
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

function findCloudflared() {
  for (const n of (isWin ? ['cloudflared.exe'] : ['cloudflared'])) {
    const p = path.join(HERE, n);
    if (existsSync(p)) return p;
  }
  const r = spawnSync(isWin ? 'where' : 'which', ['cloudflared'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  return '';
}

/* 下载要能看见「在动」。
   以前只在百分比变化时刷新，如果卡在 0 就一直显示「0%」，看着像死掉了。
   现在加一个心跳：每 1.5 秒报一次已下载 MB，卡住超过 12 秒就判定没速度、直接放弃换源。 */
function downloadTo(url, dest, label) {
  return new Promise((resolve, reject) => {
    const go = (u, depth) => {
      if (depth > 5) return reject(new Error('重定向过多'));
      const mod = u.startsWith('https:') ? https : http;
      const req = mod.get(u, { timeout: 60000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return go(new URL(res.headers.location, u).toString(), depth + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let lastGot = 0;
        let stuck = 0;
        const out = fs.createWriteStream(dest);
        const say = (msg) => process.stdout.write('\r  ' + C.d + msg + C.b + '                    ');
        /* 心跳：不靠百分比，直接报字节数，卡住也能看出来 */
        const beat = setInterval(() => {
          const mb = (got / 1048576).toFixed(1);
          const pct = total ? (' / ' + (total / 1048576).toFixed(1) + ' MB  ' + Math.floor((got / total) * 100) + '%') : ' MB';
          say(label + ' ' + mb + pct);
          if (got === lastGot) {
            stuck += 1.5;
            if (stuck >= 12) {
              clearInterval(beat);
              req.destroy(new Error('12 秒没有任何数据'));
            }
          } else { stuck = 0; lastGot = got; }
        }, 1500);
        res.on('data', (c) => { got += c.length; });
        res.pipe(out);
        out.on('finish', () => {
          clearInterval(beat);
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
          resolve(true);
        });
        out.on('error', (e) => { clearInterval(beat); reject(e); });
        req.on('error', (e) => { clearInterval(beat); reject(e); });
        res.on('error', (e) => { clearInterval(beat); reject(e); });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('下载超时')); });
    };
    go(url, 0);
  });
}

/* ---------- 不用下载的隧道：系统自带 ssh ----------
 * Windows 10 1809+ / 11 默认带 OpenSSH 客户端；macOS、Linux 一直都有。
 * localhost.run 提供免费的 ssh -R 反向隧道，不用注册、不用装东西。
 * 取舍：它是纯文本转发，不带 WebSocket 升级，所以只能用来「看页面」，
 * 房间连接仍走 cloudflared 或本机/局域网。够用来先确认地址能通。 */
function hasSsh() {
  const r = spawnSync(isWin ? 'where' : 'which', ['ssh'], { encoding: 'utf8' });
  return !!(r && r.status === 0 && String(r.stdout || '').trim());
}

/* 试 18 秒：拿到 https 地址就返回 true 并保持这个 ssh 进程；
   拿不到就杀掉、返回 false，让上层退回 cloudflared。 */
function trySshTunnel(lan) {
  return new Promise((resolve) => {
    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=' + (isWin ? 'NUL' : '/dev/null'),
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', '80:localhost:' + PORT,
      'nokey@localhost.run'
    ];
    let proc;
    try {
      /* 不要加 -tt：加了之后 localhost.run 会把地址塞进伪终端 UI 里，
         拿不到可解析的 https 链接。直接读 stdout 才行。 */
      proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { return resolve(false); }
    children.push(proc);

    let buf = '';
    let dealt = false;
    const finish = (url) => {
      if (dealt) return;
      dealt = true;
      clearTimeout(timer);
      if (!url) {
        try { proc.kill('SIGTERM'); } catch (e) { /* ignore */ }
        const i = children.indexOf(proc);
        if (i >= 0) children.splice(i, 1);
        return resolve(false);
      }
      line('');
      box([
        '把这个地址发给朋友：',
        '',
        url + '/',
        '',
        '（打开自动进大厅；这个窗口不能关）'
      ], C.g);
      line('');
      line('  ' + C.y + '注意：这条 ssh 隧道只转网页，联机对战要靠下面这条本机地址：' + C.b);
      line('  ' + C.c + 'ws://' + lan + ':' + PORT + '/ws' + C.b + C.d + '（填在页面「联机」栏里）' + C.b);
      line('');
      line('  ' + C.d + '要「一个链接全搞定」，装 cloudflared 即可（下次再说）。地址每次重启都会变。' + C.b);
      line('');
      try {
        fs.writeFileSync(path.join(HERE, '联机地址.txt'),
          url + '/\n\n（窗口关掉即失效。联机对战用 ws://' + lan + ':' + PORT + '/ws）\n', 'utf8');
      } catch (e) { /* ignore */ }
      try { process.title = 'WorldHub 开服 · ' + url.replace('https://', ''); } catch (e) { /* ignore */ }
      proc.on('exit', () => {
        line('');
        line('  ' + C.r + '⚠ ssh 隧道断了。' + C.b + C.d + '重跑一次 node 开服.mjs 即得新地址。' + C.b);
        line('');
      });
      resolve(true);
    };

    const onOut = (b) => {
      if (dealt) return;
      /* 关键：全程累积，绝不截断。
         localhost.run 先刷一大堆带 ANSI 控制符的欢迎横幅（几千字符），
         地址夹在横幅后面才出来。只留尾部几百字符会把地址和横幅一起丢掉。
         清理时连续剥两遍 ANSI，因为横幅是嵌套序列，一遍剥不干净。 */
      buf += String(b);
      const clean = buf.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
      /* localhost.run 的地址形如 https://xxxx.app.lhr.life */
      const m = clean.match(/https:\/\/[a-z0-9-]+\.(?:app\.lhr\.life|lhr\.life)/i);
      if (m) finish(m[0]);
    };
    proc.stdout.on('data', onOut);
    proc.stderr.on('data', onOut);
    proc.on('error', () => finish(null));
    proc.on('exit', () => finish(null));

    const timer = setTimeout(() => finish(null), 18000);
  });
}

async function main() {
  line('');
  line(C.c + '  WorldHub 联机服务' + C.b + C.d + '  ·  本机开服，朋友用浏览器进来' + C.b);
  line('');

  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, () => resolve());
    server.once('error', reject);
  });

  const lan = lanIP();
  process.env.WH_LAN_IP = lan;   /* 说明页要显示「同一个 WiFi 填这个」的地址 */
  line('  ' + C.g + '✓' + C.b + ' 房间服务已就绪  ' + C.d + 'ws://127.0.0.1:' + PORT + '/ws' + C.b);
  line('');

  if (LOCAL_ONLY) {
    if (WEB_ROOT) {
      box([
        '同一个 WiFi 的朋友，浏览器打开：',
        '',
        'http://' + lan + ':' + PORT + '/games/party/',
        '',
        '联机地址填：ws://' + lan + ':' + PORT + '/ws'
      ], C.g);
    } else {
      box([
        '这个文件夹里没有游戏页面，只有联机服务在跑。',
        '',
        '打开 联机-单文件版.html（或完整工程里的页面），',
        '在「联机」栏里填：',
        '',
        'ws://' + lan + ':' + PORT + '/ws'
      ], C.g);
      line('');
      line('  ' + C.d + '想直接发个链接给朋友，就别加 --local：' + C.b + 'node 开服.mjs' + C.b);
    }
    line('');
    line('  ' + C.d + '（--local 模式：没有公网地址，异地朋友连不上；按 Ctrl+C 停止）' + C.b);
    line('');
    return;
  }

  /* ---------- 0. 想完全跳过下载：本机自带 ssh（Windows 10+ 默认就有） ----------
   * cloudflared 要下 53 MB，网不好的时候能卡在 0% 半天。
   * 但 Windows 自带的 OpenSSH 客户端就能建隧道：ssh -R 连 localhost.run，
   * 不用装任何东西、不用下载、不用注册。优先走这条。 */
  if (!NO_CFD && hasSsh()) {
    line('  ' + C.d + '检测到系统自带 ssh —— 试一下不用下载的隧道（几秒）…' + C.b);
    const ok = await trySshTunnel(lan);
    if (ok) return;
    line('  ' + C.d + 'ssh 隧道没成，换 cloudflared。' + C.b);
    line('');
  }

  let cfd = findCloudflared();
  if (!cfd) {
    const dest = path.join(HERE, isWin ? 'cloudflared.exe' : 'cloudflared');
    const ver = isWin ? 'cloudflared-windows-amd64.exe'
      : process.platform === 'darwin' ? 'cloudflared-darwin-amd64.tgz'
        : 'cloudflared-linux-amd64';
    const official = 'https://github.com/cloudflare/cloudflared/releases/latest/download/' + ver;
    const sources = [official, 'https://ghfast.top/' + official, 'https://gh-proxy.com/' + official];
    line(C.y + '  需要下载隧道客户端' + C.b + C.d + '（' + (isWin ? '约 53 MB' : '约 40 MB') + '，只需这一次）' + C.b);
    line('  ' + C.d + '如果一直不动，按 Ctrl+C 停下，改用：' + C.b + 'node 开服.mjs --local' + C.b);
    line('');
    for (const src of sources) {
      const host = (src.match(/^https:\/\/([^/]+)/) || [])[1] || '?';
      try {
        await downloadTo(src, dest, '下载 ' + host);
        cfd = dest;
        line('  ' + C.g + '✓' + C.b + ' 下载完成');
        try { if (!isWin) fs.chmodSync(dest, 0o755); } catch (e) { /* ignore */ }
        break;
      } catch (e) {
        try { fs.unlinkSync(dest); } catch (x) { /* ignore */ }
        line('  ' + C.d + '这个源不行（' + host + '：' + e.message + '），换下一个…' + C.b);
      }
    }
  }

  if (!cfd) {
    line('');
    line(C.r + '  隧道客户端没准备好。' + C.b);
    line('');
    line('  ' + C.y + '两条路，都不用再等这个下载：' + C.b);
    line('');
    line('  ' + C.c + '① 只跟同一个 WiFi 的人玩' + C.b + '（立刻可用，不碰外网）');
    line('     node 开服.mjs --local');
    line('');
    line('  ' + C.c + '② 手动下一次（浏览器下载，能看到进度）' + C.b);
    line('     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
    line('     存到本文件旁边，改名 cloudflared.exe，再跑 node 开服.mjs');
    line('');
    line('  ' + C.d + '房间服务还在跑，Ctrl+C 结束。' + C.b);
    return;
  }

  line('  ' + C.d + '建立公网隧道…（首次几秒）' + C.b);
  const tun = spawn(cfd, ['tunnel', '--url', 'http://127.0.0.1:' + PORT, '--no-autoupdate'], {
    cwd: HERE,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(tun);

  /* 地址的展示时机很关键：cloudflared 会先打印 https 地址，但那一刻公网还没通，
     Cloudflare 侧要再花几秒把它注册进边缘节点。这中间打开就是 Error 1033
     （"unable to resolve tunnel"），看着像服务挂了，实际只是没就绪。
     所以：拿到地址先不报，等日志出现 "Registered tunnel connection" 再说；
     万一这个关键字没等到（版本差异），15 秒后兜底报出来并注明多等几秒。 */
  let publicUrl = '';
  let announced = false;
  let fallbackTimer = null;

  const announce = (ready) => {
    if (!publicUrl || announced) return;
    announced = true;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }

    line('');
    if (WEB_ROOT) {
      box([
        '把这个地址发给朋友：',
        '',
        publicUrl + '/games/party/',
        '',
        '（手机、异地都能打开，不用装任何东西）'
      ], C.g);
    } else {
      /* 没有页面时服务端会把根路径 302 到线上大厅并自带 ?ws=，
         所以给根地址就行，对方打开直接是大厅。 */
      box([
        '把这个地址发给朋友：',
        '',
        publicUrl + '/',
        '',
        '（打开自动进大厅，什么都不用填）'
      ], C.g);
    }
    line('');
    if (!ready) {
      line('  ' + C.y + '隧道刚建好，公网可能还要几秒才通。' + C.b);
      line('  ' + C.d + '如果打开看到 Error 1033，等 5 秒刷新一下就好，不是服务挂了。' + C.b);
      line('');
    }
    line('  ' + C.c + '本机打开：' + C.b + 'http://127.0.0.1:' + PORT + (WEB_ROOT ? '/games/party/' : '/'));
    if (WEB_ROOT) {
      line('  ' + C.d + '同一 WiFi：' + C.b + 'http://' + lan + ':' + PORT + '/games/party/');
    }
    line('');
    line('  ' + C.r + '这个窗口不能关' + C.b + C.d + '：关掉（或 Ctrl+C）隧道立刻断，'
      + '上面那个地址就变成 Error 1033 了。' + C.b);
    line('  ' + C.d + '地址每次重启都会变。' + C.b);
    line('');

    /* 顺手把地址写到旁边，回头找不到窗口也能翻出来 */
    try {
      fs.writeFileSync(path.join(HERE, '联机地址.txt'),
        publicUrl + '/\n\n（这个地址只在开服窗口开着时有效；关掉窗口就失效。）\n', 'utf8');
    } catch (e) { /* 只读目录之类，忽略 */ }
    try { process.title = 'WorldHub 开服 · ' + publicUrl.replace('https://', ''); } catch (e) { /* ignore */ }
  };

  const onOut = (b) => {
    const s = String(b);
    if (!publicUrl) {
      const hit = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (hit) {
        publicUrl = hit[0];
        line('');
        line('  ' + C.d + '地址拿到了，等 Cloudflare 把它挂上边缘节点…（几秒）' + C.b);
        fallbackTimer = setTimeout(() => announce(false), 15000);
      }
    }
    /* 这个才是「真的能访问了」的信号 */
    if (publicUrl && !announced && /registered tunnel connection/i.test(s)) {
      setTimeout(() => announce(true), 500);
    }
    if (!publicUrl && /ERR|error/i.test(s)) process.stderr.write(C.d + s + C.b);
  };
  tun.stdout.on('data', onOut);
  tun.stderr.on('data', onOut);
  tun.on('exit', (code) => {
    if (!publicUrl) {
      line(C.r + '  隧道没能建立（code ' + code + '）。' + C.b);
      line('  ' + C.d + '常见原因：网络挡住 Cloudflare，或公司网络禁止外连。' + C.b);
      line('  ' + C.d + '退一步用同一个 WiFi 玩：node 开服.mjs --local' + C.b);
      cleanup(1);
      return;
    }
    /* 跑了一阵之后断开：最容易被误解成「服务坏了」，其实只是这条隧道没了。
       不主动退出，房间服务还在本机跑着，用户按 Ctrl+C 或重跑都行。 */
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    line('');
    line('  ' + C.r + '⚠ 隧道断了（code ' + code + '）。' + C.b);
    line('  刚才那个地址 ' + C.d + publicUrl.replace('https://', '') + C.b + ' 现在打开会是 Error 1033。');
    line('  ' + C.d + '房间服务还在本机跑；重跑一次 node 开服.mjs 会拿到一个新地址。' + C.b);
    line('');
  });
}

main().catch((e) => {
  line(C.r + '  出错：' + e.message + C.b);
  cleanup(1);
});
