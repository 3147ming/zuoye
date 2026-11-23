#!/usr/bin/env node
/* ============================================================
 * tools/make-ws-bundle.mjs —— 生成「只含联机服务」的独立部署包
 * ------------------------------------------------------------
 * 为什么单独出一个包：
 *   Render / Koyeb / Fly 这类免费 Node 托管要求仓库根目录就是一个可运行的应用，
 *   而本项目根目录是前端工程（构建脚本 + 30MB 页面）。直接把整站推上去既慢又乱。
 *
 * 产出：ws-bundle/（可直接作为仓库根目录上传）
 *   ├── server/          联机服务（protocol / room-core / games / index）
 *   ├── package.json     只依赖 ws
 *   ├── render.yaml      Render 蓝图（可选）
 *   ├── Dockerfile       容器部署（可选）
 *   └── README-DEPLOY.md 部署步骤
 * 用法：node tools/make-ws-bundle.mjs
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'ws-bundle');

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

/* 1. 服务端代码（不含 selftest，那个依赖测试脚本上下文，进包无意义但也没坏处——保留方便自检） */
copyDir(path.join(ROOT, 'server'), path.join(OUT, 'server'));

/* 2. package.json：用精简版覆盖（根目录那份带 build 脚本与 esbuild 工具链） */
fs.copyFileSync(path.join(ROOT, 'server-package.json'), path.join(OUT, 'package.json'));

/* 3. 可选部署描述 */
for (const f of ['render.yaml', 'Dockerfile']) {
  if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
}
fs.writeFileSync(path.join(OUT, '.dockerignore'), 'node_modules\n*.log\n', 'utf8');
fs.writeFileSync(path.join(OUT, '.gitignore'), 'node_modules\n*.log\n', 'utf8');

/* 4. 部署说明 */
const deployMd = `# 世界大厅 · 联机房间服务（独立部署包）

这是从主工程 \`WorldHub/\` 抽出来的**只含联机服务**的最小工程：一个 Node 进程，
监听一个端口，提供 \`/ws\`（WebSocket 房间服务）与 \`/healthz\`（探活）。

前端页面不需要在这里，继续放在 Cloudflare Pages；这里只负责"房间里的事"。

## 一、Render（免费，最简单）

1. 把这个目录推到一个 GitHub 仓库（或直接用 Render 的 "Public Git repository" 填地址）
2. Render 控制台 → **New** → **Web Service** → 选这个仓库
3. 配置照着填：
   - Runtime：**Node**
   - Build Command：\`npm install --omit=dev\`
   - Start Command：\`node server/index.js\`
   - Plan：**Free**
   - Health Check Path：\`/healthz\`
4. 创建后等首次构建，拿到地址形如 \`https://worldhub-ws-xxxx.onrender.com\`
5. 联机地址就是 \`wss://worldhub-ws-xxxx.onrender.com/ws\`

> 免费实例会在 15 分钟无人访问后休眠，下次请求需要约 30–60 秒冷启动。
> 建议开玩前先在浏览器打开一次 \`https://你的地址/healthz\` 把它唤醒。

## 二、Koyeb / Fly.io / Railway（同类，免费额度各家不同）

三者都认 \`Dockerfile\`，直接选 "Deploy from Dockerfile" 即可；端口读环境变量 \`PORT\`。

## 三、自己验证

\`\`\`bash
npm install --omit=dev
node server/index.js            # 默认 0.0.0.0:8787
node server/selftest.mjs        # 80 项自测
\`\`\`

本地通了再去部署，能省掉一大半排错时间。

## 四、把前端指过来

在 \`games/party/index.html\` 里改这一行（主工程里）：

\`\`\`html
<meta name="wh-net" content="wss://你的地址/ws">
\`\`\`

然后重新 \`node tools/make-deploy.mjs\` 并推送 Pages。也可以不改文件，
直接在页面「联机服务器」输入框里填地址，临时连一次。

## 五、注意事项

- 免费实例是**单实例**，房间表在内存里；平台重启会让进行中的房间失效（页面会自动提示重连）
- 只要一个人在线就够用：4 人一房、快照 20Hz、上行 50ms 节流，带宽约 20KB/s/人
- 不要把它当成公网大流量服务：免费额度通常是每月 750 小时，够小圈子玩
`;
fs.writeFileSync(path.join(OUT, 'README-DEPLOY.md'), deployMd, 'utf8');

/* 5. 汇总 */
let files = 0, bytes = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);

console.log('[ws-bundle] 输出：' + path.relative(ROOT, OUT) + '/');
console.log('[ws-bundle] ' + files + ' 个文件，' + (bytes / 1024).toFixed(1) + ' KB');
console.log('[ws-bundle] 含：server/、package.json、render.yaml、Dockerfile、README-DEPLOY.md');
console.log('[ws-bundle] 下一步：把这个目录推到 GitHub，在 Render 新建 Web Service 即可');
