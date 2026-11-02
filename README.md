# 基于Web的2D横版世界大厅游戏合集设计与实现

一个纯前端的单页游戏合集入口：**10 个 1280×720 的区块**横向连成一个世界，
玩家操控角色在一屏一屏之间走动，站到传送门前按 `E` 进入对应的小游戏 / 工具（iframe 加载）。
左两屏是「工具区」，中间是「中心广场」，右七屏是「游戏区」。

本项目为课程大作业，**完全独立**，与任何既有项目无关；**只在本地运行，不部署线上**。

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
| `E` | ① 与守灯人对话 ② 站在门前进入该门 |
| `H` | 打开 / 关闭操作说明面板 |
| `Esc` | 关闭帮助或对话；在游戏里回大厅（焦点在游戏内时用右上角按钮） |

**换区块**：走到画面最左 / 最右边缘自动切到相邻区块，没有按键。

**出游戏**：游戏画面**右上角**有一枚 `← 返回大厅` 按钮，点它必定回大厅；
父窗口有焦点时 `Esc` 同样回大厅（点过游戏画面后焦点交给游戏，此时请用按钮）。

---

## 二、目录结构

```
WorldHub/
├── index.html              # 入口：1280×720 canvas、HUD、对话面板、加载脚本
├── css/
│   └── main.css            # 舞台装裱、HUD 文本、底部提示条、对话面板、iframe 壳
├── js/
│   ├── audio.js            # 合成音效：Web Audio 现场合成，零音频素材
│   ├── sceneManager.js     # 场景管理器：注册 / 切换 / 主循环 / DPR 适配
│   ├── player.js           # 输入（Input）、摄像机（Camera）、角色（Player）
│   ├── npc.js              # 守灯人：对话数据 + idle/prompt/talking 状态机 + 面板单例
│   ├── save.js             # 存档模块（localStorage）：区块 + 角色位置
│   ├── world.js            # 大厅场景：区块表、地块烘焙、门、NPC、换区、开场与帮助
│   ├── iframeScene.js      # iframe 壳场景：全屏 iframe + 「← 返回大厅」按钮 + Esc
│   └── games/              # 【历史实现，第四批起不再加载】
│       ├── snake.js        # 贪吃蛇         ┐
│       ├── fireice.js      # 森林冰火人      │ 第三批的五款画布小游戏，
│       ├── fight.js        # 二人格斗        │ 代码保留在仓库里备查，
│       ├── cards.js        # 与 AI 打牌      │ index.html 已不再引入
│       ├── memory.js       # 记忆翻牌        ┘
│       └── README.md       # 小游戏模块契约
├── games/                  # 游戏区七门（开源项目，各自独立 index.html）
│   ├── snake/              # jakesgordon/javascript-snakes
│   ├── game2048/           # gabrielecirulli/2048
│   ├── tetris/             # Aerolab/blockrain.js（另配壳页与皮肤）
│   ├── fight/              # mgechev/mk.js
│   ├── mine/               # michaelbutler/minesweeper
│   ├── gomoku/             # gitee darkwing/Gomoku
│   └── breakout/           # jakesgordon/javascript-breakout
├── tools/                  # 工具区两门
│   ├── noise/              # 自研复刻（上游 Kanso 拿不到源文件，见「开源致谢」）
│   └── pomodoro/           # vv0611/pomodoro-timer-with-game
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

### 3.2 区块化世界（`js/world.js`）

地图不再是「一张 2800px 的长卷 + 跟随摄像机」，而是**一屏一个区块**：
每个区块就是一块 1280×720 的独立画面，摄像机固定，换区靠走出画面边缘。

`world.js` 顶部的 `ZONES` 表就是全部内容，一条配置 = 一屏：

```js
{ id: 'snake', side: 'right', title: '贪吃蛇', themeSeed: 1105,
  doors: [{ id: 'snake', name: '贪吃蛇', src: 'games/snake/index.html',
            color: '#5fd39a', glyph: 'snake', desc: '经典蛇 · 越吃越快' }] }
```

| # | id | 区块 | side | 门指向 | 主题色 | themeSeed |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `noise` | 白噪音 | left | `tools/noise/index.html` | `#7fd8c8` | 1103 |
| 1 | `pomodoro` | 番茄钟 | left | `tools/pomodoro/index.html` | `#f07167` | 1104 |
| 2 | `plaza` | 中心广场（无门） | center | — | — | 0 |
| 3 | `snake` | 贪吃蛇 | right | `games/snake/index.html` | `#5fd39a` | 1105 |
| 4 | `game2048` | 2048 | right | `games/game2048/index.html` | `#f2cc60` | 1106 |
| 5 | `tetris` | 俄罗斯方块 | right | `games/tetris/index.html` | `#9b8afb` | 1107 |
| 6 | `fight` | 格斗 | right | `games/fight/index.html` | `#e8545f` | 1108 |
| 7 | `mine` | 扫雷 | right | `games/mine/index.html` | `#6fc2ef` | 1109 |
| 8 | `gomoku` | 五子棋 | right | `games/gomoku/index.html` | `#e8b45a` | 1110 |
| 9 | `breakout` | 打砖块 | right | `games/breakout/index.html` | `#f2a0c0` | 1111 |

**换区规则**（`EDGE_L = 40`、`EDGE_R = 1240`、地表 `GROUND_Y = 566`）：

| 条件 | 结果 |
| --- | --- |
| `x < 40` 且面朝左 | 切到上一区块，落在 `x = 1240` |
| `x > 1240` 且面朝右 | 切到下一区块，落在 `x = 40` |
| 已在最左 / 最右仍往外走 | 不切；`x` 夹住，提示条显示「已到尽头」0.6s |

换区时播 `portal` 音效 + 一帧暖光闪白；**同一方向只触发一次**（`edgeLockL/R` 锁，
往回走 60px 才解锁），否则顶住边缘会每帧重播音效刷提示。

**确定性烘焙**：每区块用 `mulberry32(themeSeed)` 生成，把天空 / 星点 / 四道山脊 / 树 /
雾 / 路 / 碎石 / 两层草 / 两盏路灯**整屏预渲染成一张 1280×720 的离屏画布**，
只在 `setZone()` 时重烘一次；逐帧只画星点、灯晕、门、角色、尘埃、前景草。
`themeSeed` 固定，所以同一区块每次刷新长得一模一样，方便截图比对。

**三套主题**：广场黄昏橙 / 工具区青绿 / 游戏区紫蓝，`THEME.left|center|right` 各一组
（6 段天空、4 道山脊色 + 背光边、树/草/路/雾），再按 `(seed % 7 - 3) * 2%` 做明度微调，
让同区的两屏也不完全一样。画面上仍叠剪纸暗角与纸纹，保持第三批的剪纸语言。

**加一个区块 = 往 `ZONES` 里加一条配置**：`x` 按 `side` 自动排（左 320 / 右 960 / 中 640），
路标牌、换区、存档白名单都会跟着走。

### 3.3 角色与手感（`js/player.js`）

普通的「加速度 + 重力」很容易做出塑料感，这里补了四个细节：

| 机制 | 参数 | 作用 |
| --- | --- | --- |
| 加速度 / 摩擦分离 | 加速 2800、摩擦 2400 px/s² | 起步跟手，松手滑一小段但不打滑 |
| 土狼时间（Coyote Time） | 0.10s | 刚离开地面边缘还能起跳，不会「明明按了却没跳」 |
| 跳跃缓冲 | 0.14s | 落地前按空格也算数，落地瞬间自动起跳 |
| 可变跳跃高度 | 松手时 `vy = max(vy, -300)` | 轻点小跳、长按大跳 |

下落时重力额外乘 1.28，让滞空时间更短、落地更「实」；落地按速度触发压缩形变，起跳则纵向拉长。

> 区块模式下画面不滚动，`Camera` 不再参与大厅渲染（类保留在 `player.js` 里，供后续可滚动场景复用）。

### 3.4 传送门（按 E 进入）

每区块一门，门在区块里的横向位置由 `side` 决定：**左区块 x = 320，右区块 x = 960**，
落地底座宽 104、高 190。站在门中心 **±62px**（`DOOR_HIT`）且在地面上：

- 门脚浮出一圈呼吸光环 + 门牌上方冒出一枚 `E` 键帽；
- 底部提示条显示「按 E 进入《门名》」；
- 此时按 `E` → 先 `Save.setPlayer(x, facing, zone.id)` 写档，再 `SceneManager.change('iframe', { title, src })`。

**不会自动进入**：走进去只是出提示，必须按 `E` —— 这样贴着门走过、或者从门里出来停在门口，
都不会被弹回游戏（第三批那套「预置 near 防重入」的补丁因此整段删掉了）。

每道门由「石框 + 能量腔 + 上升流光 + 图腾 + 名字牌（名字 + 一行说明）」组成，呼吸式明暗，
图腾各不相同（蛇身曲线 / 叠起来的 2048 方块 / 俄罗斯方块 L 形 / 交叉双刃 / 旗帜与格子 /
五连的斜线 / 砖墙与球 / 声波 / 番茄钟）。

### 3.5 NPC 与对话

大厅的「守灯人」站在**中心广场 x = 470**（只有 plaza 区块有他）：

- 靠近 80px 且站在地面 → 角色头顶浮出气泡「按 E 与我说话」，底部提示条同步显示；
- 按 `E` 打开对话面板（DOM 覆盖层），每按一次 `E` 推进一句，最后一句再按关闭；
- 说话中走开 120px 自动关闭；`Esc` 也关；面板不阻塞移动；
- 对话内容写死在 `world.js` 的 `lines` 数组里（8 句），讲的是「欢迎 + 左右分路 + 按 E 进门」，
  `npc.js` 只负责状态机与渲染，换文本不用动逻辑。

`E` 的优先级是固定的：**说话 / 可对话且在地面 → 对话**；否则 **站在门前 → 进门**；都没有 → 什么都不做。

### 3.6 iframe 壳（`js/iframeScene.js`）

游戏本身不放画布里，而是**整屏 iframe** 直接加载各项目的 `index.html`：

- 场景 `init` 建一个 `inset:0; width/height:100%; border:0; background:#000` 的 iframe，
  **不加 `sandbox`**（加了会禁掉 localStorage 与音频，游戏存不了档）；
- 右上角一枚 DOM 按钮 `← 返回大厅`（`.iframe-back`，z-index 高于 iframe），点击 `SceneManager.change('world')`；
- `document.body.dataset.scene = 'iframe-' + title`，CSS 据此隐去大厅的标题与按键提示；
- `window` 上的 `keydown` 监听 `Esc` → 回大厅；
- `destroy()` 移除 iframe、按钮与监听，并把 `data-scene` 复位成 `world`。

> **已知边界**：点过游戏画面后焦点落在 iframe 里，父窗口收不到键盘事件，`Esc` 这时归游戏自己。
> 退出请用右上角按钮（100% 有效）。没有为此改上游页面。

### 3.7 音效（`js/audio.js`）

- **零素材**：不加载任何音频文件，15 个音效全部用 Web Audio 的振荡器 + 增益包络现场合成，
  参数写在 `RECIPES` 表里（波形 / 起止频率 / 时长 / 增益 / 偏移），想调音色只改这张表。
- **浏览器自动播放策略**：`AudioContext` 在**首次用户手势**（keydown / pointerdown / touchstart）时才创建，
  之前所有 `play()` 直接静默返回；不支持的浏览器（或创建失败）会置 `failed` 并永久静默。
- 主增益 0.5，单音 0.03–0.10，连续触发也不会糊成一片。
- 大厅用到 `jump / land / portal / talk / ui / miss`；`portal` 既用于进门，也用于换区块。

### 3.8 开场与帮助

- **开场标题卡**：进入大厅时 `intro = 2.5`，在 `update` 里按 `dt` 递减，**不拦任何逻辑**；
  `render` 末尾叠一层黑幕 + 「世界大厅 World Hub」+「左工具 · 右游戏」+ 底部「按 E / 空格 / 回车 跳过」。
- **换区提示**：换区后底部提示条 1.6s 显示当前区块（广场显示「中心广场 · 左工具 · 右游戏」）。
- **帮助面板**（`H` 开关，纯 canvas 覆盖层）：7 行表列出大厅全部键位与两区分布，
  文案集中在 `world.js` 的 `HELP_ROWS` 里，**和真实键位逐字一致**（改键位请顺手改这里）。
  面板打开时 `Esc` **优先关面板**，不会顺手把角色传出大厅。

### 3.9 HUD

画面里的中文全部走 DOM 覆盖层（`position:absolute` + 容器查询单位 `cqw`），
跟着舞台等比缩放 —— 比画在 canvas 上更清晰，也天然支持 `aria-live` 的提示播报。
左上角是标题 **世界大厅 World Hub**（副标题「区块世界 · 左工具 · 右游戏」），
右上角是键位提示（`A D` / `空格` / `E` / `H`），底部是提示条。

---

## 四、开源致谢

游戏区七门、工具区两门都来自开源项目或公开文章，**上游代码保持原样**，只做「能离线跑」的最小适配。
每个目录下的 `SOURCE.txt` 记着同样的信息，许可原文随目录一起保留。

| 名称 | 上游 | 许可 | 本地目录 | 接入改动 |
| --- | --- | --- | --- | --- |
| 贪吃蛇 | https://github.com/jakesgordon/javascript-snakes | MIT | `games/snake/` | 补 `fonts/` 与 `s.gif`（消 404）；`play()` 的 rejection 吞掉 |
| 2048 | https://github.com/gabrielecirulli/2048 | MIT | `games/game2048/` | 无 |
| 俄罗斯方块 | https://github.com/Aerolab/blockrain.js | MIT | `games/tetris/` | 新写壳页与皮肤；本地 jQuery 3.7.1 |
| 格斗 | https://github.com/mgechev/mk.js | MIT（仓库无 LICENSE 文件，依据 readme 声明） | `games/fight/` | 删 socket.io、`multiplayer`、单屏版式 |
| 扫雷 | https://github.com/michaelbutler/minesweeper | **GPL-3.0**（`license.txt` 随目录保留） | `games/mine/` | jQuery 本地化、删外链角标、内容居中 |
| 五子棋 | https://gitee.com/darkwing/Gomoku | MIT | `games/gomoku/` | 无 |
| 打砖块 | https://github.com/jakesgordon/javascript-breakout | MIT | `games/breakout/` | 无 |
| 番茄钟 | https://github.com/vv0611/pomodoro-timer-with-game | **未声明许可**（仓库无 LICENSE，仅供学习展示） | `tools/pomodoro/` | 入口壳 `index.html`、去 Google Fonts |
| 白噪音 | 参考 https://dev.to/lnz79d612/…（Kanso，7KB 单文件） | **非上游文件**（上游不可获取，见下） | `tools/noise/` | 本目录为自研复刻 |

**关于「白噪音」**：上游成品只在 Gumroad（Pay-What-You-Want）发放，作者仓库 `lnz79d612/kanso-desk`
只有一个 README，拿不到可直接使用的源文件。为不让最左一屏变成死门，`tools/noise/index.html`
是按该文公开描述的功能**自行实现**的一版（棕噪音积分 + 低通、25/50 分钟计时、本地便签），
文件头与 `SOURCE.txt` 都标明「非上游产物」。若要严格只收上游，删掉 `tools/noise/`
并把 `ZONES` 里 `noise` 一条标注「待补充」即可，其余不受影响。

**许可证提示**：`games/mine/` 是 **GPL-3.0**，与 MIT 的其余各门不同；
若要把本项目整体以其他许可分发，需要先处理这一门的兼容性。课程作业内部演示不受影响。

---

## 五、验收对照

| 验收项 | 实现位置 |
| --- | --- |
| 双击 `index.html` 可运行、0 报错 | 全部传统 `<script>`，无模块、无外链请求 |
| 10 个区块各一屏 | `world.js` → `ZONES`（10 条） |
| 走到边缘换区块、落点在另一端 | `world.js` → `update` 的 `EDGE_L/EDGE_R` 判定 + `trySwitch` |
| 最左 / 最右不越界并提示 | `trySwitch` 的 `edgeLockL/R` + 提示条「已到尽头」 |
| 每区块独立且可复现的画面 | `mulberry32(themeSeed)` + `bakeBg()` 整屏烘焙 |
| 区块内路标牌 / 门位置 | `drawSign`（左 1218 右对齐 / 右 62 左对齐 / 中居中）、`layoutZones`（左 320 右 960） |
| 门必须按 `E` 才进 | `world.js` → `update` 算 `near`、`onKey` 里 `enterDoor` |
| 进门前写档（区块 + 位置 + 朝向） | `save.js` → `setPlayer(x, facing, zoneId)` |
| 刷新回到原区块原位置、停在大厅 | `world.js` → `init` 读 `Save.get()`，`x` 夹在 `[40, 1240]` |
| iframe 全屏加载对应游戏 | `iframeScene.js` → `init` 建 iframe（无 sandbox） |
| 右上角按钮 / `Esc` 回大厅 | `iframeScene.js` → `.iframe-back` + `window` keydown |
| 反复进出无残留 | `iframeScene.destroy()` 移除 iframe / 按钮 / 监听并复位 `data-scene` |
| NPC 只在广场、8 句、E 推进 | `npc.js` 状态机 + `world.js` 的 `onKey` / `update` |
| 帮助面板与真实键位一致 | `world.js` → `HELP_ROWS`（7 行） |
| 五个历史游戏脚本不再加载 | `index.html` 只引 7 个脚本，`js/games/*` 仅留档 |
| 存档坏了不影响运行 | `save.js` 的 `get/set` 全包 `try/catch`，非法 `zone` 回落 `plaza` |
| 音效零素材、禁用时不报错 | `audio.js` → `RECIPES` + `SFX`，ctx 未就绪时静默返回 |
| 九扇门往返 18 次 0 报错 0 残留 | 见交付报告「门验收 55/55」 |

---

## 六、演示流程（答辩建议顺序，约 3 分钟）

1. **开场（0:00–0:15）** —— 双击 `index.html`。标题卡 2.5 秒淡入「世界大厅 World Hub」/「左工具 · 右游戏」；
   说一句「这段只递减一个 `intro` 计时，不拦逻辑」，顺手按 `E` 跳过。
2. **广场与换区（0:15–0:45）** —— 走到守灯人按 `E` 连推两句（他讲的就是左右分路）。
   往右一直走：广场 → 贪吃蛇 → 2048，指出「每走出一屏就换一个区块，`x` 落在对面 40px」，
   再走到最右端顶住，提示条出「已到尽头」。按 `H` 展示帮助面板，`Esc` 演示**优先关面板**。
3. **进一门看 iframe 壳（0:45–1:10）** —— 回到贪吃蛇那屏，站到门前：`E` 键帽 + 「按 E 进入《贪吃蛇》」。
   按 `E` 进游戏，吃两个果子（`eat` 音效）后撞墙结算，点右上角 `← 返回大厅`，
   强调「出来还站在原地、不会又被弹进去」。
4. **工具区（1:10–1:40）** —— 从广场往左两屏：番茄钟点 `Start` 看倒计时与猫咪换表情，`Pause` / `Reset`；
   白噪音点播放、拖音量与温暖度、写一行便签后刷新页面证明本地保存。
5. **存档主线（1:40–2:20）** —— 在扫雷 / 五子棋任一门前**刷新页面**：角色还在这一屏、这个位置，
   控制台 0 报错。清掉 `localStorage` 再刷新，回到广场。
6. **收尾（2:20–3:00）** —— 走完全部七屏（贪吃蛇→…→打砖块）说明「加区块只要往 `ZONES` 加一条」，
   打开 `games/mine/` 的 `license.txt` 提一句这张致谢表里唯一的 GPL-3.0。

---

## 七、后续扩展

1. **加一屏**：往 `world.js` 的 `ZONES` 里加一条（`id / side / title / themeSeed / doors`），
   把新游戏放到 `games/<id>/index.html`，不用改其它任何文件；
2. **加第二道门**：同一区块的 `doors` 数组里多写一个对象，`x` 会自动按 `side` 排开；
3. **存档**：`save.js` 的 `ZONES` 白名单加一行，`setPlayer` 才会认这个区块。

### 存档

状态存于独立模块 `js/save.js`（localStorage key：`worldhub.save.v1`），不挂在场景对象上：

```js
Save.get()                        // 读整份存档（永远返回合法结构）
Save.setPlayer(x, facing, zone)   // 记录位置与区块，进门前调用
Save.reset()                      // 清空（调试用）
```

- 进门前写入 `{ x, facing, zone }`；回大厅 `init` 时恢复，`x` 夹在 `[40, 1240]`，
  `zone` 必须在白名单里，否则回落 `plaza`；
- 第四批起**不再有「已通关 ✓」吊牌**：游戏改成 iframe 外部项目，进度由各游戏自己存
  （如 2048 的 `localStorage` 最高分、扫雷的最佳时间），大厅不参与统计；
- 所有读写都包在 `try/catch` 里：隐私模式、配额满、存档被写坏（坏 JSON / 越界坐标 / 类型不对）
  都只会回落到默认值，不会影响游戏运行。想重置进度，清掉这条 localStorage 即可。
