# js/games/ —— 小游戏模块目录

每个小游戏一个 `.js` 文件，共用一个场景契约，**互不引用**，
大厅的传送门按 `id` 直接 `SceneManager.change(id)` 切过去。

## 现有游戏

| 传送门 | 场景名 | 文件 | 说明 |
| --- | --- | --- | --- |
| 贪吃蛇 | `snake` | `snake.js` | 31×17 格，速度随分数递进，WASD / 方向键 |
| 森林冰火人 | `fireice` | `fireice.js` | `Tab` 切火人 / 冰人，**6 关**：压力板 + 闸门 → 升降平台 → 锁门 → 传送阵 |
| 二人格斗 | `fight` | `fight.js` | 三局两胜，双人对战 / 挑战 AI，**满能量放必杀** |
| 与 AI 打牌 | `cards` | `cards.js` | 简化斗地主，1 人类 + 2 AI，`F` 提示 |
| 记忆翻牌 | `memory` | `memory.js` | 4×8 共 32 张、16 对，本地最佳用时 |

> 音效统一走 `js/audio.js`（`window.Audio.play(name)` / 简写 `sfx(name)`）：
> Web Audio 现场合成，零音频素材；`AudioContext` 在首次用户手势后才建立，
> 未就绪时 `play()` 静默返回，**不要**在场景里自己 `new AudioContext`。

## 模块契约

```js
/* js/games/xxx.js */
(function (global) {
  'use strict';

  function XxxScene() { /* 纯数据初始化，不碰 DOM / 监听 */ }

  XxxScene.prototype.init = function (ctx, params) { /* 建局 + 挂监听 */ };
  XxxScene.prototype.update = function (dt) { /* 逻辑，dt 单位秒，上限 0.05 */ };
  XxxScene.prototype.render = function (ctx) { /* 绘制，坐标系固定 1280×720 */ };
  XxxScene.prototype.destroy = function () { /* 摘监听 + 释放资源 */ };

  global.SceneManager.register('xxx', function () { return new XxxScene(); });
})(window);
```

## 接入大厅

1. `index.html` 里补一行 `<script src="js/games/xxx.js"></script>`（放在 `world.js` 之后、启动脚本之前）；
2. 文件末尾自己调 `SceneManager.register('xxx', …)`，**不要**改 `index.html` 里的启动脚本；
3. `world.js` 的 `portals` 里该门的 `id` 就是场景名，走进门会自动切换 —— 路由逻辑只写在一处。

## 几条硬约定

- **监听对称**：`init` 里 `addEventListener` 的东西，`destroy` 里必须全部摘掉，
  否则反复进出会叠加触发（`blur` 也要一并处理，防止切窗口后按键卡住）。
- **点击坐标归一化**：`getBoundingClientRect()` 换算到 1280×720 逻辑坐标再判命中，
  不要直接用手写像素；canvas 后备缓冲已按 DPR 放大，直接读 `e.offsetX` 会偏。
- **`Esc` 一律回大厅**：`SceneManager.change('world')`，场景管理器会先 `destroy()` 当前场景。
- **不要监听 `Tab` / 方向键却不 `preventDefault()`**：浏览器会拿去切焦点或滚动页面。
- **只用传统 `<script>`**：`file://` 双击要能跑，禁止 ES Module / `fetch` / 第三方库。
