# WorldHub 1.19.1 部署到 Cloudflare

目标项目：`zuoye-e0c`（线上 https://zuoye-e0c.pages.dev/）

联机房间服务是**另一个 Worker**（`worldhub-ws`），不在 Pages 项目里——因为 Cloudflare Pages 不支持给 Functions 绑定 Durable Objects。静态站与联机服务分开部署，步骤见文末第六节。

---

## 一、前置检查（在项目根目录执行）

```bash
cd D:\Projects\WorldHub          # 换成你的实际路径
node -v                          # 需要 >= 18
cat package.json                 # 确认 version = 1.18.0
```

确认 `assets/` 里已有构建产物（源码包里已带，无需重新构建）：

```bash
ls assets/ | grep -E "app\.|main\.|extra\."
# app.875e2fddd8.js  main.6e2989137e.css  extra.af9188f73b.js
```

> ⚠️ 如果你改过 `js/` 或 `css/` 源码，**必须先构建**，否则线上跑的还是旧的打包产物：
> ```bash
> node tools/build.mjs
> ```
> 构建会算出新的 hash 文件名，并自动改写 `index.html` 与 `sw.js`，产物直接写在根目录（没有 dist 目录）。

---

## 二、部署（二选一）

### 方式 A：wrangler 直传（最快）

```bash
npx wrangler@latest pages deploy . --project-name=zuoye-e0c --branch=main --commit-dirty=true
```

首次执行会弹出浏览器让你登录 Cloudflare 账号授权。成功后终端会输出新的预览地址和 https://zuoye-e0c.pages.dev 的更新结果。

**注意参数含义：**

| 参数 | 说明 |
| --- | --- |
| `.` | 上传当前目录，即项目根。因为构建是原地输出，所以这里不能写 `dist` |
| `--project-name=zuoye-e0c` | 指定已有项目，会**覆盖**当前生产版本 |
| `--branch=main` | 推到生产分支。改成别的名字则会生成一个预览部署，不动线上 |
| `--commit-dirty=true` | 工作区有未提交改动时，允许上传，否则 wrangler 会报错拒绝 |

**关于 `.workbuddy/` 等临时目录**：不用手动清理。wrangler 上传时会跳过所有以点开头的文件和目录（唯一例外是 `.well-known`），并强制忽略 `node_modules`。已核对 wrangler 4.158.0 源码中的 `getFilesInFolder` 逻辑。`.workbuddy/` 虽然占 1.9 MB，但不会被传上去。走 Git 推送时它也已被 `.gitignore` 排除。

### 方式 B：Git 推送（项目 README 里写的方式）

如果 `zuoye-e0c` 已经绑定了 GitHub/GitLab 仓库并开启自动部署：

```bash
git add -A
git commit -m "deploy: WorldHub 1.18.0"
git push origin main
```

Cloudflare 会自动拉取、构建、发布。**需要在 Pages 项目设置里确认：**

- Build command：`node tools/build.mjs`（如果你不打算把打包产物提交进仓库）
- Build output directory：`/`（根目录，**不是** `dist`）

---

## 三、部署后验证清单

```bash
# 1. 版本号应返回 1.18.0
curl -s https://zuoye-e0c.pages.dev/version.json

# 2. 首页应返回 200
curl -s -o /dev/null -w "%{http_code}\n" https://zuoye-e0c.pages.dev/

# 3. 安全响应头是否生效
curl -sI https://zuoye-e0c.pages.dev/ | grep -i "content-security-policy\|x-frame-options"
```

浏览器里还要手动确认（**重要**）：

1. **强制刷新** `Ctrl + Shift + R`，排除 Service Worker 旧缓存干扰
2. 打开 DevTools → Application → Service Workers → 检查缓存名是否为 `worldhub-v1.18.0-875e2fddd8`
3. 如果还是旧版本，点 **Unregister** 注销 SW 再刷新
4. 走一遍主流程：走动 → NPC 对话 → 总门选单 → 进游戏 → 返回

---

## 四、本次源码的自检结论（已在沙箱验证）

| 项目 | 状态 |
| --- | --- |
| 文件总量 | 976 个 / 34 MB（Pages 上限：20,000 个文件、单文件 25 MB） |
| 最大单文件 | 2.3 MB（`games/snake/sounds/game.mp3`），远低于上限 |
| `_headers` | ✅ 存在，CSP / HSTS / 缓存策略齐全 |
| `_redirects` | ✅ 存在，未命中路径正确返回 404 |
| `functions/api/` | ✅ 有两个 Pages Functions（`board.js`、`links.js`），wrangler 直传时会自动识别上传 |
| 构建幂等性 | ✅ 已验证：在副本上跑 `node tools/build.mjs`，产物 hash 与仓库内一致，无额外改动 |
| 入口链一致 | ✅ `index.html` → `assets/app.875e2fddd8.js` + `main.6e2989137e.css`，与仓库内实际文件匹配 |
| sw.js 一致性 | ✅ VERSION = `worldhub-v1.18.0-875e2fddd8`，CORE 清单 27 项全部存在 |
| 上传过滤 | ✅ 已核对 wrangler 源码：`.` 开头目录（含 `.workbuddy/`）与 `node_modules` 自动跳过 |

> 如果 `_headers` 里 `frame-src` 只放行了 `https://warehouse-strike.pages.dev`（仓库行动那个跨域 FPS），而你换了别的域名，记得同步改这一行，否则「仓库行动」区块会加载失败。

---

## 五、常见报错对照

| 报错 | 原因与处理 |
| --- | --- |
| `More than one account available` | 账号下有多个 Account，加 `CLOUDFLARE_ACCOUNT_ID=xxx` 环境变量 |
| `Project not found` | 项目名拼错，或该 Token 无权访问。先跑 `npx wrangler pages project list` 核对 |
| `Your working directory is dirty` | 去掉 `--commit-dirty=true` 前先提交；或直接加上该参数 |
| 部署成功但页面白屏 | 大概率是 hash 产物没更新。重新 `node tools/build.mjs` 再传 |
| 页面还是旧版 | Service Worker 缓存。强制刷新 + Unregister SW |

---

## 六、联机服务（Workers + Durable Object）

### 为什么要单独一个 Worker

Cloudflare Pages 的 Functions **不支持声明 Durable Objects**：`wrangler.jsonc` 里的
`durable_objects` / `migrations` 放在 Pages 项目里会被拒或忽略。所以联机拆成两块：

```
Pages  zuoye-e0c.pages.dev          静态页面（含联机大厅 UI）
Worker worldhub-ws.<子域>.workers.dev   /ws 房间服务 + DO（房间表）
```

浏览器连的是 Worker 的 `wss://.../ws`，地址写在前端：

```html
<!-- games/party/index.html -->
<meta name="wh-net" content="wss://worldhub-ws.<子域>.workers.dev/ws">
```

> 地址解析顺序：`?ws=` 参数 → `<meta name="wh-net">` → 同源 `/ws`。
> `games/party/index.html` 是**原样上传**的独立页（不进 `assets/app.<hash>.js`），
> 所以改完 meta 只要重新 `node tools/make-deploy.mjs` 再传即可；
> 若动的是 `js/party/*.js`，那属于主包，必须先 `node tools/build.mjs`。

### 部署步骤

```bash
# 1. 打包（esbuild → dist/ws-worker.js，约 34 KB）
node tools/build-ws.mjs

# 2. 首次部署：会自动创建 DO 类 Rooms（migrations v1，SQLite 后端，免费计划可用）
npx wrangler deploy --config wrangler.ws.jsonc

# 3. 记下输出的地址，形如
#    https://worldhub-ws.your-subdomain.workers.dev
#    把它填进 games/party/index.html 的 <meta name="wh-net">，注意换成 wss:// 并带 /ws

# 4. 重新出包 → 部署静态站
node tools/make-deploy.mjs
npx wrangler pages deploy deploy --project-name=zuoye-e0c --branch=main \
  --config tools/wrangler.pages.jsonc
```

### 本地调试（不用账号）

```bash
npx wrangler dev --config wrangler.ws.jsonc   # 本地起 DO，地址 ws://127.0.0.1:8787/ws
node tools/ws-smoke.mjs ws://127.0.0.1:8787/ws
```

`tools/ws-smoke.mjs` 会对目标地址跑 9 项：握手、建房（房号 1–5 位）、错误房号被拒、
进房、人数、非房主开局被拒、开局、快照帧率。本地 Node 服务与 Worker 两端都用它验过。

### 注意事项

| 项 | 说明 |
| --- | --- |
| 免费额度 | Durable Objects 在免费计划按 SQLite 后端可用，有每日请求数上限；房间数上万才需要升付费 |
| 跨域 | WebSocket 不受 CORS 限制，Worker 侧未校验 Origin；若要限制来源，在 `functions/api/net.js` 的 `fetch` 里加白名单 |
| 一个 DO 实例 | 所有房间共用一个 `idFromName('party')` 实例（房间表集中管理），单实例足以撑几万房间 |
| 休眠 | 房间全空后 30 分钟回收，DO 随之休眠，不烧 CPU 时长 |
| 断线重连 | 座位保留 30 分钟，重连靠客户端的 token + 原 pid；超出后按新玩家处理 |
