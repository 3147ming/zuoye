# 基于Web的2D横版世界大厅游戏合集设计与实现

一个纯前端的单页游戏合集入口：**19 屏世界**——中间一条可走的走道
`工具总门 ← 中心广场 → 游戏总门`，两端的总门用浮层选单把玩家**传送**到 16 个内容区块
（3 个工具 + 13 个游戏，其中 6 个「脑力街机」是线上直达、1 个「仓库行动」是跨域 FPS 直达）。每个区块都有自己的一位 NPC，
负责讲清「这是什么 / 怎么玩 / 怎么回去」。

本项目为课程大作业，**完全独立**，与任何既有项目无关。

线上地址（Cloudflare Pages，Git 集成自动部署）：<https://zuoye-e0c.pages.dev/>

---

## 一、运行方式

直接双击 `index.html` 即可（`file://` 协议下可用，全部脚本都是传统 `<script>`，没有 ES Module 的跨域限制）。

如需本地静态服务器（可选）：

```bash
cd D:\Projects\WorldHub
python -m http.server 5350
# 浏览器打开 http://127.0.0.1:5350/
```

### 操作

| 按键 | 动作 |
| --- | --- |
| `A` / `←` | 向左移动 |
| `D` / `→` | 向右移动 |
| `空格`（也支持 `W` / `↑`） | 跳跃，长按跳更高 |
| `E` | ① 推进 NPC 对话 ② 打开总门选单 ③ 站在区块门前进入该内容 |
| `H` | 打开 / 关闭操作说明面板 |
| `O` 或右上角齿轮 | 打开设置面板 |
| `Esc` | 依次关闭：帮助 → 对话 / 选单 / 设置；在游戏里回大厅 |
| `↑` `↓` `←` `→` / `1`~`9` / `回车` | 总门选单里选条目、直接按序号传送 |

**走道的三条规则**：

1. 广场往左走出边缘 → 工具总门屏；往右 → 游戏总门屏；两端到头会提示「已到尽头」。
2. 在总门屏按 `E` 打开选单，选一条就**直接传送到那个区块正中**（`x=640`），面朝该区块的门。
3. 从**任何**区块走出左右边缘 → 回到中心广场；工具区落在 `x≈420`，游戏区落在 `x≈860`，
   也就是「从哪边出去的，回来还站在哪边」。

**出游戏**：游戏画面**左上角**有 `← 回上一级`、**右上角**有 `← 回大厅` 两枚按钮——
`← 回上一级` 回到进游戏前的那一屏（原位置），`← 回大厅` 回中心广场；
键盘 `Backspace` = 回上一级、`Esc` = 回大厅（点过游戏画面后焦点交给游戏，此时请用按钮）。

### 手机端触屏操作

检测到触屏设备（含 `pointer: coarse` / `maxTouchPoints>0`）才会出现虚拟按键，桌面端**完全不建 DOM、零改动**。
所有按键都是「按下去派发一次 `keydown`、抬起来派发一次 `keyup`」的合成键盘事件，复用大厅与游戏既有的键盘监听——
所以开源游戏文件一个字都不用改。

| 位置 | 屏幕按键 | 作用 |
| --- | --- | --- |
| 大厅 | 左下 `◀` `▶` | 向左移动 / 向右移动（按住 = 持续移动，抬起 = 停） |
| 大厅 | 右下 `跳` | 跳跃，长按跳更高 |
| 大厅 | 右下 `E` | 站在总门旁开选单；选单里点行即传送 |
| 通用 | 左上 `⤾` | 返回（等同 `Esc`：关面板 / 游戏里回大厅） |
| 俄罗斯方块 | `←` `→` `↻` `▼` | 方向键（`↻`=旋转、`▼`=软降） |
| 格斗 | `A` `D` `W` `S` · `J` `K` `L` `SHIFT` | 左组 A/D 移动、W 跳、S 下蹲；右组 J 拳、K 踢、L 重击、SHIFT 防御；双人对战建议电脑端 |
| 打砖块 | 左右半屏滑动 + `开球` | 手指在左 / 右半屏滑动控制挡板，点 `开球` 发球 |
| 脑力街机（贪吃蛇/小鸟/白块/飞机/泡泡龙/乒乓）+ 仓库行动 | 仅 `⤾` | 线上版自带触屏/鼠标，点屏幕直接玩；WorldHub 不派发按键，提示「本游戏支持触屏直接操作」 |
| 2048 / 五子棋 / 扫雷 / 白噪音 / 番茄钟 / 网址推荐 | 仅 `⤾` | 这些页面原生触摸已可玩，只保留返回键 |

竖屏时顶部会出现「建议横屏获得最佳体验」提示条，横屏自动消失。

> **关于 `file://` 双击直开的限制**：大厅、总门、NPC 等都在父页面里，触屏完全可用；
> 但七门游戏是 `iframe` 加载的**独立页面**，`file://` 下浏览器把 iframe 当成不透明源（cross-origin），
> 父页面无法把合成键盘事件注入其中，因此**直接在 `file://` 双击打开时，游戏内的虚拟方向键不会驱动游戏**。
> 这是浏览器同源策略的固有行为，不是代码缺陷——手机上访问**线上 `https` 站点**（或本地 `http` 静态服务器）时 iframe 同源，
> 触屏方向键、打砖块滑动、开球全部正常。桌面端用物理键盘本来就能直接玩，不受影响。

---

## 二、目录结构

```
WorldHub/
├── index.html              # 入口：1280×720 canvas、HUD、总门选单、设置面板、脚本装配
├── version.json            # 版本号与更新说明（http(s) 下由「检查更新」读取）
├── css/
│   └── main.css            # 舞台装裱、HUD、提示条、总门选单、设置面板、iframe 壳
├── js/
│   ├── audio.js            # 合成音效：Web Audio 现场合成，零音频素材；带独立音量/静音
│   ├── sceneManager.js     # 场景管理器：注册 / 切换 / 主循环 / DPR 适配
│   ├── player.js           # 输入（Input，含 reset）、摄像机、角色（Player）
│   ├── npc.js              # 通用 NPC：对话数据 + idle/prompt/talking 状态机 + 面板单例
│   ├── save.js             # 存档（localStorage）：区块 + 位置 + 朝向；含 contrib 白名单
│   ├── config.js           # 全局配置：版本号、背景清单、BGM 曲目表、Prefs、BgStore
│   ├── contrib.js          # 自建内容注册表（WorldHub.register 的实现与校验）
│   ├── bgm.js              # 背景音乐：<audio> 播放，空曲目表时彻底静音
│   ├── gatePanel.js        # 总门选单（DOM 浮层）：↑↓/数字键/回车/Esc
│   ├── settings.js         # 设置面板：背景、音量、全屏、重置、自建内容、版本检测
│   ├── world.js            # 大厅场景：12 屏表、烘焙、门与总门、NPC、走道与传送、开场与帮助
│   ├── iframeScene.js      # iframe 壳：全屏 iframe + 「← 返回大厅」按钮 + Esc
│   ├── touch.js            # 手机端触屏适配：检测到触屏才建虚拟按键，派发合成键盘事件（桌面零改动）
│   └── games/              # 【历史实现，第四批起不再加载】
│       ├── snake.js        # 贪吃蛇         ┐
│       ├── fireice.js      # 森林冰火人      │ 第三批的五款画布小游戏，
│       ├── fight.js        # 二人格斗        │ 代码保留在仓库里备查，
│       ├── cards.js        # 与 AI 打牌      │ index.html 已不再引入
│       ├── memory.js       # 记忆翻牌        ┘
│       └── README.md       # 小游戏模块契约
├── games/                  # 游戏区开源门（本地 iframe；snake 目录保留文件但已不再引用）
│   ├── snake/              # jakesgordon/javascript-snakes（第七批起被脑力街机版替换，见「开源致谢」）
│   ├── game2048/           # gabrielecirulli/2048
│   ├── tetris/             # Aerolab/blockrain.js（另配壳页与皮肤）
│   ├── fight/              # mgechev/mk.js
│   ├── mine/               # michaelbutler/minesweeper
│   ├── gomoku/             # gitee darkwing/Gomoku
│   └── breakout/           # jakesgordon/javascript-breakout
├── tools/                  # 工具区三门 + 一个开发脚本
│   ├── noise/              # 自研复刻（上游 Kanso 拿不到源文件，见「开源致谢」）
│   ├── pomodoro/           # vv0611/pomodoro-timer-with-game
│   ├── links/              # 网址推荐（第七批②：共享存储 + 自动自检）
│   └── check-contrib.mjs   # 自建内容校验（Node，仅开发期用，不参与页面加载）
├── functions/              # Cloudflare Pages Functions（第七批②，线上才生效）
│   └── api/
│       └── links.js        # /api/links：网址推荐共享 KV 存储（GET/POST/DELETE）
├── contrib/                # 用户自建内容（默认空）
│   ├── manifest.js         # 唯一的注册入口，附注释示例
│   └── CONTRACT.md         # 接入约定：字段表、页面硬约束、审核口径
├── assets/
│   └── bg/                 # 可选的场景背景图（放进来的文件名登记到 js/config.js）
└── README.md
```

每个 `games/<id>/` 与 `tools/<id>/` 下都有一份 `SOURCE.txt`，写明名称、仓库、许可与接入改动。

---

## 三、核心设计

### 3.1 场景管理器（`js/sceneManager.js`）

统一场景接口，四个方法缺一不可，切场景时**先 `destroy()` 旧场景，再 `init()` 新场景**：

```js
init(ctx, params)   // 进入场景，准备资源
update(dt)          // 推进逻辑，dt 单位为秒
render(ctx)         // 绘制，坐标系固定 1280×720
destroy()           // 离开场景，释放监听 / 定时器 / 图片
```

- **逻辑分辨率固定 1280×720**，实机像素由 `devicePixelRatio` 决定（上限 2 倍），
  CSS 只负责等比缩放，所以任何窗口尺寸下画面都不变形、不裁切。
- 主循环统一用 `requestAnimationFrame`，`dt` 钳制在 50ms 以内 ——
  切到后台再切回来时不会因为累积时间过大而一帧穿地。
- 场景接口不完整时直接抛错，避免半成品场景混进注册表。

### 3.2 12 屏世界（`js/world.js`）

世界由一张 `SCENES` 表描述，一条配置 = 一屏：

```js
{ id: 'snake', kind: 'zone', cat: 'games', title: '贪吃蛇',
  themeKey: 'right', seed: 1105, item: {...}, npcX: 800, door: { x: 960, ... } }
```

`kind` 只有三种，决定了这一屏怎么玩：

| kind | 屏 | 换屏规则 | 门 |
| --- | --- | --- | --- |
| `gate` | `gate-tools` / `gate-games` | 沿走道 `WALK` 走，两端到头锁住 | 屏幕正中一座**总门**（`isGate`，按 `E` 开选单） |
| `plaza` | `plaza` | 左右各通一座总门屏 | 无门，只有守灯人与路标 |
| `zone` | 9 个内容区块 | **任意**边缘都回广场 | 一扇门（工具 `x=320`，游戏 `x=960`） |

- `WALK = ['gate-tools', 'plaza', 'gate-games']` —— 只有这三屏是「走」过去的，
  9 个区块是「传送」过去的，所以总门屏与区块屏的换屏逻辑是两套，互不干扰。
- 传送落点 `TELEPORT_X = 640`（区块正中，面朝门）；回广场落点
  `PLAZA_LAND = { tools: 420, games: 860 }`（从哪边出去就从哪边回来）。
- 走道两端锁边用 `edgeLockL / edgeLockR`：撞边出一次「已到尽头」，往回走 60px 才解锁。

画面全部**程序化烘焙**：`mulberry32(seed)` 生成山脊、树线、路灯、星点，
一屏一张 1280×720 的离屏 canvas，进屏时烘一次、之后每帧只贴图。
同一个 `seed` 永远得到同一片景色，所以「哪个区块长什么样」是可复现的。

### 3.3 角色与手感（`js/player.js`）

- 加速度 / 摩擦 / 土狼时间（coyote time）/ 跳跃缓冲（jump buffer）四件套，
  跳起后长按还能再抬高一点，落地有明显 squash。
- `Input.reset()` 在打开浮层时清空按键状态：否则「按住 D 打开选单，关掉后角色还在跑」。
- 摄像机在走道里跟随，在区块里固定（一屏一世界，不需要滚动）。

### 3.4 总门与传送选单（`js/gatePanel.js`）

站到总门前 `near` 命中，按 `E` 调 `GatePanel.open({ cat, items, onPick })`：

- 选单是 **DOM 浮层**（不是画在 canvas 上），所以文字永远清晰、可被读屏，
  也方便用 CSS 做窄屏适配；
- 每行：序号 · 类别色点 · 名称 · 一句说明 · 「传送 →」；
- 键盘：`↑↓` / `←→` 选择，`回车` / `空格` 确认，`1`~`9` 直选，`Esc` 关闭；
  鼠标点行、点空白、点右上角 × 都能关；
- 选中即 `teleportTo(item)`：`setScene` + 角色摆到 `x=640` + 面朝门 + 一次白闪过渡。

浮层与设置面板都用 `position: fixed` 定位到**视口**而不是舞台：
舞台是 16:9 的固定框，竖屏手机上只有 190 来 px 高，跟着舞台走会把选单压成一条缝。

### 3.5 NPC 与对话（`js/npc.js` + `world.js`）

10 位 NPC，每人 4~8 句，都讲「这是什么 / 怎么玩 / 键位 / 怎么回广场」：

| 屏 | NPC | 屏 | NPC |
| --- | --- | --- | --- |
| 广场 | 守灯人 | 贪吃蛇 | 养蛇人 |
| 白噪音 | 听风者 | 2048 | 算盘先生 |
| 番茄钟 | 守钟人 | 俄罗斯方块 | 落石匠 |
| 扫雷 | 排雷兵 | 格斗 | 教头 |
| 五子棋 | 棋博士 | 打砖块 | 球童 |
| 网址推荐 | 引路者 | 仓库行动 | 哨兵 |

- 走近 80px 出「按 E 与我对话」气泡，再按 `E` 一句一句推进；
- 走开 120px 或按 `Esc` 关闭；说话时角色不能移动，避免「边跑边聊」的错位；
- 总门屏没有 NPC（那里用名录板列全部条目）；
- 自建内容若没写 `npc`，自动给一个通用「引路人」。

### 3.6 iframe 壳（`js/iframeScene.js`）

- 全屏 iframe 加载对应 `index.html`，**不能加 `sandbox`**（会禁掉 localStorage 与音频）；
- 两个返回入口：左上「← 回上一级」回到 `from` 场景（原位置）、右上「← 回大厅」回广场；
  键盘 `Backspace` = 回上一级、`Esc` = 回大厅；`world.js` 进 iframe 时把 `{ from, px, pf }` 传给壳，
  回上一级时 `change('world', { sceneId: from, px, pf })` 原路返回；
- 断网 / 加载失败时 iframe 的 `error` 事件触发「需要网络连接」轻量提示，返回按钮仍可用；
- `destroy()` 移除 iframe / 两个按钮 / 监听 / 离线提示并复位 `data-scene`，反复进出不留残留；
- 进游戏前 `BGM.suspend()` 把背景音乐压低到 18%，出来 `resume()` 复原。

### 3.7 音频：音效 + BGM（`js/audio.js` / `js/bgm.js`）

- 音效全部**现场合成**（`RECIPES` 里每条是若干振荡器 + 包络），零音频素材；
- BGM 用 `<audio>` 播本地 mp3，曲目表在 `js/config.js` 的 `bgm` 数组里；
  **当前曲目表为空** —— 此时 `BGM.available()` 为假，一切播放请求静默返回，
  不会报错、不会出现「有控件没声音」的假象；
- 两条音量（BGM / 音效）各自 0~100 与独立静音，落盘在 `worldhub.prefs.v1`，
  进游戏 / 切屏都不会重置。

### 3.8 设置面板（`js/settings.js`）

`O` 键或右上角齿轮打开：

| 分区 | 内容 |
| --- | --- |
| 场景背景 | 上传本地图片（压到 1440×810 JPEG 后存 localStorage）／从 `assets/bg/` 清单选／恢复默认剪纸 |
| 声音 | BGM 音量 + 静音、音效音量 + 静音、**试听音效**、试听音乐（曲目表为空时如实说明） |
| 其它 | 操作说明、全屏、重置存档（二次确认） |
| 自建内容 | 列出 `contrib/` 注册进来的条目，逐条开 / 关 |
| 版本 | 显示 `js/config.js` 的版本与构建日期；`http(s)` 下拉 `version.json` 比对，`file://` 下如实说明「本地文件模式」 |

背景图按屏存：`worldhub.bg.v1` 是 `{ 屏 id: dataURL 或 assets/bg/x.jpg }`。
换背景时派发 `wh:bg` 事件，`world.js` 收到后只重烘当前这一屏。

### 3.9 自建内容（`contrib/`）

用户把自己做的页面丢进 `contrib/<目录>/`，在 `contrib/manifest.js` 里注册一次：

```js
WorldHub.register({
  id: 'hello', name: '示例小游戏', cat: 'games',
  src: 'contrib/hello/index.html', desc: '一句话说明', color: '#7fb0ff'
});
```

- 注册后立刻出现在对应总门的选单末尾，并自动获得一屏（含门、NPC、存档白名单）；
- 交上去之前跑 `node tools/check-contrib.mjs`：查字段合法性、`src` 是否越界、
  入口页有没有外链 / `type="module"`、目录体积；
- 详细约定与审核口径见 `contrib/CONTRACT.md`；
- 停用不删文件：设置面板里逐条开关，存 `worldhub.contrib.v1`。

### 3.10 开场与帮助

- 开场标题卡只递减一个 `intro` 计时（2.5 秒），按 `E` / `空格` / `回车` 跳过，不拦任何逻辑；
- 帮助面板 `H` 打开，7 行键位与真实实现一一对应（`HELP_ROWS` 是唯一来源）。

### 3.11 HUD

HUD 文字全部走 DOM（不画在 canvas 上），任意缩放下都清晰；
右上角常驻键位提示与齿轮按钮，底部提示条按优先级显示
`对话 > NPC 提示 > 门提示 > 边缘提示 > 传送提示 > 区块说明`。

### 3.12 镜头跟随与放大（第五批①）

复用 `js/player.js` 里既有的 `Camera` 类，不改游戏逻辑，只改「取景框 + 渲染缩放」两处：

- 取景框 `640×360`，贴在地图 `1280×720` 中间；渲染时整层 `ctx.scale(2, 2)` 再 `cam.begin()`，
  等于把画面**放大 2 倍**跟随角色——手机小屏也能看清细节；
- 镜头只横向跟随，`camX` 钳制在 `[0, 640]`，不会拍到地图外；
- 关键数值（已用探针逐条核对）：显示窗口纵向范围 `[206, 566]`（地面正好压在屏幕底），
  地面屏内 `y = 720`、角色屏高 ≈ `236px`、门宽 `128`；`camY = GROUND_Y − CAM_H = 566 − 360 = 206`；
- 切换区块 / 传送 / 进门前用 `cam.snap()` 瞬移到位（不滑入），避免穿帮；
- 前景草带改用视差跟随镜头（之前固定在屏幕底部，放大后会跑出画面），已相应下沉到屏底。

### 3.13 手机端触屏适配（第五批②）

新增 `js/touch.js`，桌面端 `if (!TOUCH) return;` 直接退出，**对桌面零影响**：

- 虚拟按键按场景切换：大厅给 `◀ ▶ 跳 E`，各游戏按 `data-scene`（= `iframe-<游戏名>`）反查键位表；
- 按键「按下 = `keydown` / 抬起 = `keyup`」派发合成 `KeyboardEvent`，`keyCode` 用各游戏源码实测值
  （俄方块读 `keyCode`，打砖块 `Space=32`，格斗按本体 `mk.js` 的 `controllers.keys` 映射——
  标签 `A/D/W/S/J/K/L/SHIFT` 分别派发 `65/68/87/83/74/75/76/16`——本体 `mk.js` 的 P1(Sub-Zero) 键位
  已改为 `WASD` 移动、`JKL` 攻击、`Shift` 防御（移动键就是 `A/D/W/S`，而**不是**箭头键，
  箭头键是 P2/Kano 的），`keyCode` 通过
  `Object.defineProperty` 强制覆盖以确保游戏读到正确值；
- iframe 游戏把事件派发到 `iframe.contentDocument`（需同源，见上方「手机端触屏操作」的 `file://` 说明）；
- 打砖块单独走「左右半屏滑动」模式：手指落点 `x < 屏宽/2` 发 `←`、否则发 `→`，`开球` 单独一个按钮；
- 监听 `body[data-scene]` 的 `MutationObserver` 自动重建按键集并释放上一屏的残留按键；
- 总门 `E` 开门用 DOM 浮层，但浮层是整屏覆盖，开门后**松手那一下的 `pointerup` 会被浮层接到并误点首行**——
  已在 `gatePanel.js` 里加「开门瞬间若有手指按着则吞掉这一击」的逻辑，避免「一开门就瞬移到第一项」；
- 触屏设备隐藏 HUD 键位提示条（`.hud-keys { display:none }`），改用屏上虚拟键；
- 跨域脑力街机（线上 https 直达）不派发任何按键：`data-scene` 命中 `cross:true` 配置时只留返回键，
  并提示「本游戏支持触屏直接操作」（第七批①）。

### 3.14 脑力街机九门（第七批①）

游戏总门里多了一个「🎮 脑力街机」分组，游戏是脑力训练场·扩展版的街机小游戏，
通过 `?game=<id>` 直达参数在线上 `https://ming-games.pages.dev/brain-gym/` 打开（6 门）：

| id | 名称 | 直达 URL |
| --- | --- | --- |
| `snake` | 贪吃蛇（人机蛇 + 经验豆 + 无限地图） | `https://ming-games.pages.dev/brain-gym/?game=snake` |
| `flappy` | 飞扬的小鸟 | `…?game=flappy` |
| `tiles` | 别踩白块儿 | `…?game=tiles` |
| `plane` | 飞机大战 | `…?game=plane` |
| `bubble` | 泡泡龙 | `…?game=bubble` |
| `pong` | 乒乓 | `…?game=pong` |

**同名择优**（tetris / mines / breaker 三组，逐项对比玩法深度 / 难度档位 / 触摸支持 / 附加 / 稳定性）：
本地开源版核心体验与脑力街机版相当，且**可离线、iframe 同源（WorldHub 触屏方向键可用）**，
故按「相当则保留开源版」的规则**保留本地开源门**，只有贪吃蛇按用户拍板换成脑力街机新版（人机蛇 + 经验豆）。
被替换的 `games/snake/` 目录文件保留、不再引用。

**已知边界**：脑力街机门是跨域 `https` 直达，**需要联网**；断网时壳内提示「需要网络连接」。
这些游戏自带触屏控制，WorldHub 不向其中派发按键。

### 3.15 网址推荐（第七批②）

工具总门新增「网址推荐」（`tools/links/index.html`），一个谁都能加、谁都能看的网址墙：

- **列表**：卡片 = 名称 + URL，点名称在新标签打开；预置 `https://ming-games.pages.dev/`（「我的游戏合集 · ming-games」）；
- **添加自动自检**（通过即上墙，无人工审核）：① URL 能被 `new URL()` 解析且协议 http/https；② 连通性 `fetch` 探测，
  失败标记「待验证」仍可加入；③ 违禁词黑名单（赌博/博彩/赌场/彩票/色情/成人/诈骗/刷单/外挂/代练/私服/恶意软件/钓鱼 等）命中即拒；
  ④ 与现有 URL 去重；⑤ 通过直接入库；
- **安全**：名称/URL 一律 `textContent` 输出，协议白名单拒 `javascript:`/`data:` 伪协议；
- **存储（主案 Cloudflare Pages Functions + KV）**：`functions/api/links.js` 提供 `GET/POST/DELETE`，
  KV namespace 变量名 `LINKS`；**未绑 KV 时前端自动降级 localStorage（页面标「本地模式」，换设备不带走）**。

**KV 绑定 6 步**（需在 Cloudflare 后台操作一次）：
1. 打开 Cloudflare 控制台 → Workers & Pages → 找到 `zuoye` 的 Pages 项目；
2. 进入 Settings → Functions → KV namespace bindings；
3. 创建（或选择）一个 KV namespace；
4. 绑定变量名填 `LINKS`；
5. 保存；推送一次代码触发重新部署（Functions 会自动读到 `env.LINKS`）；
6. 验证：`curl https://zuoye-e0c.pages.dev/api/links` 返回 `{"items":[{"name":"我的游戏合集 · ming-games",…}]}`。

**已知边界**：① 纯前端无法可靠判定所有站点连通性，探测失败只标「待验证」不拒绝；
② 删除接口默认**开放**（课程演示，任何人可删任意条目，README 注明风险）；预置条目锁死不可删。

### 3.16 仓库行动（第七批⑤）

游戏总门新增「仓库行动」（`https://warehouse-strike.pages.dev/`），网页 FPS 射击游戏，跨域 `https` 直达：

- `cross: true`：跨域 iframe，WorldHub 不派发按键（游戏自带鼠标/触屏操作）；
- 需要联网；断网时壳内提示「需要网络连接」；
- 双返回按钮（回上一级/回大厅）与其它 iframe 门一致。

### 3.17 屏幕自适应（第七批④）

- **画布缩放**：舞台固定 16:9（`aspect-ratio: 16/9`），按视口自动适配——横屏按宽度撑满、竖屏按宽度居中，
  上下/左右留黑边（body 背景色填充）。三种尺寸实测（390×844 / 768×1024 / 1920×1080）舞台比例恒为 1.778，无溢出。
- **UI 等比缩放**：HUD、GatePanel、按钮文字全部用 `cqw`（容器查询宽度单位），随舞台宽度等比缩放。
- **竖屏触屏按钮**：`@media (orientation: portrait) and (hover: none)` 下 `.touch-ui` 改 `position: fixed`
  逃出舞台 `overflow: hidden`，按钮组移到视口底部黑边区，不遮挡游戏画面。
- **网址推荐响应式**：`tools/links/` 的 `.wrap` 设 `container-type: inline-size` 保证 `cqw` 正确解析；
  列表用 CSS Grid——手机（<500px）单列、平板（500-900px）双列、桌面（>900px）三列；表单手机竖排、其它横排。
- **中文化**：界面所有英文文案改中文（标题、画布文本、帮助面板等），专有名词（HTML/CSS/JavaScript/URL/API/KV 等）保留。

---

## 四、开源致谢

游戏区七门、工具区两门都来自开源项目或公开文章，**上游代码保持原样**，只做「能离线跑」的最小适配。
每个目录下的 `SOURCE.txt` 记着同样的信息，许可原文随目录一起保留。

| 名称 | 上游 | 许可 | 本地目录 | 接入改动 |
| --- | --- | --- | --- | --- |
| 贪吃蛇 | https://github.com/jakesgordon/javascript-snakes | MIT | `games/snake/`（**第七批起不再引用**） | 第七批换成「脑力街机」贪吃蛇（人机蛇 + 经验豆），本目录文件保留备查 |
| 2048 | https://github.com/gabrielecirulli/2048 | MIT | `games/game2048/` | 无 |
| 俄罗斯方块 | https://github.com/Aerolab/blockrain.js | MIT | `games/tetris/` | 新写壳页与皮肤；本地 jQuery 3.7.1 |
| 格斗 | https://github.com/mgechev/mk.js | MIT（仓库无 LICENSE 文件，依据 readme 声明） | `games/fight/` | 删 socket.io、`multiplayer`、单屏版式 |
| 扫雷 | https://github.com/michaelbutler/minesweeper | **GPL-3.0**（`license.txt` 随目录保留） | `games/mine/` | jQuery 本地化、删外链角标、内容居中、**`file://` 下 Worker 兜底** |
| 五子棋 | https://gitee.com/darkwing/Gomoku | MIT | `games/gomoku/` | 无 |
| 打砖块 | https://github.com/jakesgordon/javascript-breakout | MIT | `games/breakout/` | 无 |
| 番茄钟 | https://github.com/vv0611/pomodoro-timer-with-game | **未声明许可**（仓库无 LICENSE，仅供学习展示） | `tools/pomodoro/` | 入口壳 `index.html`、去 Google Fonts、去 PWA `manifest`（`file://` 下必然 CORS 报错） |
| 白噪音 | 参考 https://dev.to/lnz79d612/…（Kanso，7KB 单文件） | **非上游文件**（上游不可获取，见下） | `tools/noise/` | 本目录为自研复刻 |

**关于「扫雷的 Worker 兜底」**：上游把棋盘展开算法放在 Web Worker 里。
`file://` 直开时页面是不透明源（origin `null`），浏览器拒绝 Worker 加载本地脚本
（`SecurityError: Failed to construct 'Worker'`），整局会抛未捕获异常。
`js/MineSweeper.js` 的 `initWorkers()` 因此加了一段兜底：构造失败时退到
主线程里的等价实现（算法逐行对应 `js/cell_toucher.js`），`http(s)` 下仍然用真 Worker。

**关于「白噪音」**：上游成品只在 Gumroad（Pay-What-You-Want）发放，作者仓库 `lnz79d612/kanso-desk`
只有一个 README，拿不到可直接使用的源文件。为不让工具区只剩一门，`tools/noise/index.html`
是按该文公开描述的功能**自行实现**的一版（棕噪音积分 + 低通、25/50 分钟计时、本地便签），
文件头与 `SOURCE.txt` 都标明「非上游产物」。若要严格只收上游，删掉 `tools/noise/`
并从 `ITEMS` 里去掉 `noise` 一条即可，其余不受影响。

**许可证提示**：`games/mine/` 是 **GPL-3.0**，与 MIT 的其余各门不同；
若要把本项目整体以其他许可分发，需要先处理这一门的兼容性。课程作业内部演示不受影响。

---

## 五、验收对照

| 验收项 | 实现位置 |
| --- | --- |
| 双击 `index.html` 可运行、0 报错 | 全部传统 `<script>`，无模块、无外链请求 |
| 12 屏 = 3 屏走道 + 9 个区块 | `world.js` → `SCENES`（`rebuildScenes()` 生成） |
| 走道三屏互相连通、两端锁边 | `WALK` + `tryEdge` 的 `edgeLockL/R` + 提示「已到尽头」 |
| 区块任意边缘回广场、落点分左右 | `tryEdge` 判 `kind === 'zone'` + `PLAZA_LAND` |
| 总门交互开浮层、选中即传送 | `useDoor → openGate` → `GatePanel.open` → `teleportTo` |
| 选单键盘 / 鼠标 / 数字键全可用 | `gatePanel.js` 的 `onKey` + 行点击 + `Digit1-9` |
| 传送落到区块正中且面朝门 | `teleportTo`：`x=640`，`facing` 按类别取 ±1 |
| 每区块一位 NPC、≥4 句 | `NPC_LINES`（10 条） + `makeNpc` |
| 对话 E 逐句推进、走开 / Esc 关闭 | `npc.js` 状态机 + `NPC_RANGE` / 120px 关窗 |
| 每区块一扇门，按 E 才进 | `update` 算 `near`、`onKey` 里 `enterDoor` |
| 门位置：工具左 / 游戏右 | `rebuildScenes`：`door.x` 320 / 960 |
| 进门前写档（区块 + 位置 + 朝向） | `save.js` → `setPlayer(x, facing, zoneId)` |
| 刷新回到原区块原位置、停在大厅 | `world.js` → `init` 读 `Save.get()`，`x` 夹在 `[40, 1240]` |
| iframe 全屏加载对应游戏 | `iframeScene.js` → `init` 建 iframe（无 sandbox） |
| 右上角按钮 / `Esc` 回大厅 | `.iframe-back` + `window` keydown（测 Esc 前需 `window.focus()`） |
| 反复进出无残留 | `iframeScene.destroy()` 移除 iframe / 按钮 / 监听并复位 `data-scene` |
| 帮助面板与真实键位一致 | `HELP_ROWS`（7 行，含 `O` 设置） |
| 设置：背景 / 音量 / 全屏 / 重置 | `settings.js` 五个 bind 段 + `Prefs` / `BgStore` |
| 设置：试听音效真的出声 | `#sfxTry` → `Audio.init()` + `play('play'/'match'/'win')` |
| 自建内容注册即成一屏、可停用 | `contrib.js` + `refreshScenes()`（停用回落到广场） |
| 版本检测：`http(s)` 读 `version.json`，`file://` 如实说明 | `settings.js` → `checkUpdate` |
| 存档坏了不影响运行 | `save.js` 的 `get/set` 全包 `try/catch`，非法 `zone` 回落 `plaza` |
| 音效零素材、禁用时不报错 | `audio.js` → `RECIPES` + `SFX`，ctx 未就绪时静默返回 |
| 九扇门往返 18 次 0 报错 0 残留 | 见交付报告「门验收 55/55」 |
| 镜头跟随 + ×2 放大，`camX∈[0,640]`、地面屏内 `y=720` | `world.js` 渲染层 `scale(2)` + `player.js` 的 `Camera`（`cam.snap` 瞬移） |
| 镜头数值全部命中（窗口纵向 `[206,566]`、角色屏高 ≈236、门宽 128） | 探针 7/7（`_probe_cam.mjs`） |
| 触屏模块仅在触屏设备激活，桌面零 DOM | `touch.js` 顶部 `if (!TOUCH) return` |
| 虚拟键：◀/▶ 按住→移动、跳、E 开门；返回无残留 | `touch.js` `bindHold` + `releaseAll` |
| iframe 游戏收到正确 `keyCode`（贪吃蛇/俄方块 37、格斗 65、打砖块 32） | 探针 18/18 + 多游戏 3/3（`_probe_touch.mjs` / `_probe_games.mjs`） |
| 打砖块左右半屏滑动控制挡板 + 开球 | `touch.js` `setSwipe` + `.t-swipe` 层（z-index 低于按钮） |
| 站总门旁点 E 开选单、选单里点行传送、返回无残留键 | `gatePanel.js` + `touch.js` 重建释放 |
| 横屏提示条竖屏显/横屏隐，按钮不重叠 | `touch.js` `updateRotate` + CSS `@media` |
| 脑力街机 9 门（6 直达 + 3 本地）分组展示、snake 指向 brain 新版 | `world.js` ITEMS（`group`/`cross`/绝对 URL）+ `gatePanel.js` 分组表头 |
| 双返回：回上一级回原屏原位置、回大厅回广场、Backspace/Esc | `world.js` `enterDoor` 传 `from/px/pf` + `init` 优先 `opts.sceneId` + `iframeScene.js` 双按钮 |
| 跨域街机不派发按键、提示自带触屏；同源仍正常 | `touch.js` `cross:true` 分支 |
| 断网提示「需要网络连接」、返回可用 | `iframeScene.js` iframe `error` 事件 → `.iframe-offline` |
| 格斗本体 P1 键位改为 WASD JKL + 触屏同步 + 防崩溃 | `games/fight/src/mk.js` `controllers.keys.p1`（`65/68/87/83/74/75/76/16`）、`js/touch.js` 格斗配置同、`setMove` 抛错改忽略 |
| 网址推荐：预置/自检/黑名单/去重/伪协议/XSS 安全 | `tools/links/index.html` + `functions/api/links.js` |
| 全界面中文化（英文文案→中文，专有名词保留） | `index.html` / `js/world.js` 画布文本 |
| 屏幕自适应：竖屏触屏按钮移到舞台下方、links 页 1/2/3 列响应式 | `css/main.css` 竖屏媒体查询 + `tools/links/index.html` 断点 |
| 仓库行动门（跨域 FPS 直达） | `js/world.js` ITEMS + `js/touch.js` cross |

**本轮实测**：桌面启动 + 总门分组 + 双返回 + 仓库行动门 14/14、手机模拟（格斗 8 键派发 + 移动键映射 P1 的 WASD +
跨域街机不派发）9/9、网址推荐自检 7/8（唯一「失败」是本地静态服务器没有 `/api/links` Function 而返回 404
的**预期降级路径**，线上绑 KV 后即 200）、脑力训练场 `?game=` 直达 7/7、三种尺寸截图检查布局无溢出；
全程 0 报错（除上述预期降级 404）。

### 3.17 格斗本体键位改 WASD JKL + 防崩溃（第七批⑦）

- `games/fight/src/mk.js` 的 `mk.controllers.keys.p1` 改为 **WASD 移动 + JKL 攻击 + Shift 防御**：
  `RIGHT:68(D) / LEFT:65(A) / UP:87(W) / DOWN:83(S) / BLOCK:16(Shift) / HP:74(J) / LP:75(K) / LK:76(L) / HK:76(L)`。
  P2（Kano）保持箭头键 + `P/[ / ]` 不变，双人对战互不影响。
- `js/touch.js` 格斗配置同步：标签 `A/D/W/S/J/K/L/SHIFT` 派发 `65/68/87/83/74/75/76/16`，移动键就是 P1 的 `WASD`，
  不再映射到旧的 `G/J/Y/H`；触屏 4 键一组 2×2 网格布局。
- **防崩溃**：`Fighter.prototype.setMove` 原有一处 `throw 'This player does not has the move'`——任何键位组合若产出
  不在招式表中的 move 会直接抛错卡死游戏；改为「打印一次告警并忽略」，使「按一下键就崩溃」不再发生。
  （经 CDP 无头实测：单键 / 组合键 / 持续按键 / 28 个招式逐一 `setMove` 均不抛错，崩溃为真实浏览器特定焦点/边界场景，
  已通过消除唯一抛错点兜底。）
- 验证：无头浏览器确认 P1 按 `D` 右移、`A` 左移、`W` 起跳、`J/K/L` 出招均生效、0 报错；P2 箭头键不受影响。

---

## 六、演示流程（答辩建议顺序，约 3 分钟）

1. **开场（0:00–0:15）** —— 双击 `index.html`。标题卡 2.5 秒淡入，说一句「这段只递减一个 `intro` 计时」，
   顺手按 `E` 跳过。
2. **走道与总门（0:15–0:50）** —— 站在广场：左「← 工具区」右「游戏区 →」两块牌子指方向。
   往右走到头 → 游戏总门屏，按 `E` 出选单，按 `5` 直接传送到扫雷，强调「落点是区块正中」。
   再走出左边缘 → 回到广场（落在 `x≈860`，从哪儿来回哪儿去）。
3. **区块与 NPC（0:50–1:20）** —— 在扫雷区块按 `E` 跟排雷兵聊两句（他讲怎么翻格、怎么插旗、
   怎么回广场），走开 120px 自动收气泡。说明「9 个区块各有一位 NPC，台词都在 `NPC_LINES` 里」。
4. **进一门看 iframe 壳（1:20–1:50）** —— 站到门前按 `E` 进游戏，翻两格后点右上角 `← 返回大厅`，
   强调「出来还站在原地、不会又被弹进去」。
5. **设置面板（1:50–2:20）** —— `O` 打开：拖两条音量 → 点「试听音效」听三声；
   上传一张图当背景，再点「恢复默认」；说明背景按屏存、存在本机。
6. **自建内容与版本（2:20–2:45）** —— 打开 `contrib/manifest.js` 讲三行注册即可成一屏，
   跑一次 `node tools/check-contrib.mjs` 演示校验；点「检查更新」说明 `file://` 与 `http(s)` 的差别。
7. **收尾（2:45–3:00）** —— 打开 `games/mine/license.txt` 提一句这是致谢表里唯一的 GPL-3.0，
   以及 `file://` 下 Worker 兜底的那段补丁。

---

## 七、后续扩展

1. **加一个内容区块**：把页面放进 `games/<id>/`，往 `world.js` 的 `ITEMS` 加一条
   （`id / cat / name / src / color / glyph / desc / seed`），`rebuildScenes()` 会自动多生成一屏；
2. **加一位 NPC**：`NPC_LINES` 里加同 id 的条目（4~8 句），没有就落到通用「引路人」；
3. **加一条 BGM**：mp3 放进 `audio/bgm/`，在 `js/config.js` 的 `bgm` 数组里登记文件名；
4. **加一张可选背景**：图片放进 `assets/bg/`，文件名写进 `js/config.js` 的 `bgFiles`；
5. **换版本号**：`js/config.js` 的 `version` / `build` 与 `version.json` 一起改。

### 存档

状态存于独立模块 `js/save.js`（localStorage key：`worldhub.save.v1`），不挂在场景对象上：

```js
Save.get()                        // 读整份存档（永远返回合法结构）
Save.setPlayer(x, facing, zone)   // 记录位置与区块，进门前调用
Save.allow(ids)                   // 把自建内容的屏 id 加进白名单
Save.reset()                      // 清空（调试用）
```

- 进门前写入 `{ x, facing, zone }`；回大厅 `init` 时恢复，`x` 夹在 `[40, 1240]`，
  `zone` 必须在白名单里（含 `gate-tools` / `gate-games` / 9 个区块 / 已注册的 contrib），否则回落 `plaza`；
- 第四批起**不再有「已通关 ✓」吊牌**：游戏改成 iframe 外部项目，进度由各游戏自己存
  （如 2048 的 `localStorage` 最高分、扫雷的最佳时间），大厅不参与统计；
- 所有读写都包在 `try/catch` 里：隐私模式、配额满、存档被写坏（坏 JSON / 越界坐标 / 类型不对）
  都只会回落到默认值，不会影响游戏运行。想重置进度，用设置面板的「重置存档」或清掉这几条 localStorage。

### 部署

线上 <https://zuoye-e0c.pages.dev/> 是 **Cloudflare Pages + GitHub 集成**：仓库
`3147ming/zuoye` 的 `master` 分支一推，Cloudflare 自动构建上线。项目里**没有「上传资产」入口**，
也不需要——推代码就是发布。

```bash
git push origin master        # 推完等 1~2 分钟；构建进度会挂在这个提交的 check 上
```

- 构建配置是「无构建命令 + 输出目录 = 仓库根」，所以根目录的 `index.html` 就是站点入口，
  子目录（`games/`、`tools/`、`模拟实验/`）原样可访问；
- 这个仓库被**多个作业共用**：`模拟实验/` 是另一个项目的目录，别删别覆盖；
- 构建偶发失败：第一次推第五批时卡了 20 多分钟然后 `Build failed`，同一份内容补一个空提交重推，
  1 分钟就过。遇到失败先看是不是这种偶发，再怀疑内容；
- 验证：打开 `<域名>/version.json`，返回 `{"version":"1.1.0",...}` 才算上线成功；
  返回 HTML 说明还在跑旧版本（Pages 会把未知路径回落到 `index.html`）。

`tools/make-deploy.mjs` 仍然保留，用途变成**生成离线/备用静态包**（比如要拷给别人、或临时挂到别处）：

```bash
node tools/make-deploy.mjs       # → deploy/：891 文件、约 26MB，白名单拷贝 + 自检
```

- 只拷页面真正加载的东西：`index.html`、`version.json`、`css/`、`js/`（不含历史留档
  `js/games/`）、`games/`、`tools/noise|pomodoro`、`contrib/`、`assets/`；
  探针、`.workbuddy/`、`tools/*.mjs` 都不进包；
- `deploy/` 与 `deploy-upload.zip` 都在 `.gitignore` 里，随时可由源码重建；
- 若真要手动传，注意 Windows 上 `Compress-Archive` 打出的 zip 路径分隔符是反斜杠，
  解压会得到一堆名字里带 `\` 的垃圾文件——用 `python -m zipfile` 或 bsdtar 重打。

### 只在 `http(s)` 下才会暴露的坑

本地 `file://` 直开全绿，不代表线上全绿。已经踩过三个：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Failed to construct 'Worker'…origin 'null'` | `file://` 是不透明源，不能读本地 worker 脚本 | 扫雷 `initWorkers()` 加 try/catch，退回主线程等价实现 |
| `unsupported MIME type ('text/html')` | 引用了仓库里不存在的脚本，Pages 用 `index.html` 兜底（200, text/html） | 番茄钟的 `sw.js` 注册已整段移除 |
| 页面白屏但控制台无报错 | 缺图被兜底成 HTML，`<img>` 静默失败 | 逐页查 `document.images` 的 `naturalWidth === 0` |

另外 Pages 对**大小写敏感**：`Images/x.png` 在 Windows 上能读到，线上 404。改资源路径后务必在线上再点一遍。
