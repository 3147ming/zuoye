/* ============================================================
 * world.js —— 世界大厅（总门 + 传送区块）
 * ------------------------------------------------------------
 * 场景接口：init(ctx) / update(dt) / render(ctx) / destroy()
 *
 * 第五批（第四批优化）改造：
 *   1) 能走的只有三屏：工具总门 ←→ 中心广场 ←→ 游戏总门。
 *      中间的「区块」不再串成一条路，只能从总门传送进去。
 *   2) 每座总门按 E 弹出选单，选一项就把人送到对应区块的中央；
 *      区块里走出任意一侧边缘 → 回到广场（工具落偏左、游戏落偏右）。
 *   3) 每个区块常驻一位 NPC，负责讲「这是什么 / 怎么玩 / 怎么回去」。
 *   4) 每个场景都可以在设置里换一张自定义背景图（存 localStorage 或 assets/bg/）。
 *   5) 自建内容通过 WorldHub.register 注册进来，会出现在对应总门的选单里。
 *
 * 一屏仍是 1280×720 本地坐标，GROUND_Y = 566。
 * 第五批①：镜头跟随 + 拉近一倍 —— 摄像机窗口 640×360，纵向固定 [206, 566]（地面贴屏幕底边），
 *   render 里 scale(2) 把 640×360 的窗口铺满 1280×720 画布；玩法坐标与区块结构一概不动。
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 常量 ---------------- */
  var VIEW_W = 1280;
  var VIEW_H = 720;
  var GROUND_Y = 566;

  /* 走出这个范围就换屏；回来时从另一侧 40 / 1240 进入 */
  var EDGE_L = 40;
  var EDGE_R = 1240;
  var DOOR_HIT = 62;
  var NPC_RANGE = 80;

  /* 传送落点：区块正中央 */
  var TELEPORT_X = 640;
  /* 从区块回广场的落点：按类别分左右，保留空间连续感 */
  var PLAZA_LAND = { tools: 420, games: 860 };

  /* ---- 镜头（第五批①）：窗口 640×360，拉近一倍；纵向固定，地面贴屏幕底边 ---- */
  var CAM_W = 640;
  var CAM_H = 360;
  var CAM_SCALE = 2;                 // 世界层放大倍数 = VIEW_W / CAM_W
  var CAM_Y = GROUND_Y - CAM_H;      // 206：窗口上沿，下沿正好落在 GROUND_Y
  var BG_SCALE = 2;                  // 背景按 2 倍烘焙，放大后不糊

  var SERIF = '"Songti SC", "STSong", "Source Han Serif SC", "SimSun", serif';
  var SANS = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  var CAT_NAME = { tools: '工具区', games: '游戏区' };
  var CAT_COLOR = { tools: '#7fd8c8', games: '#9b8afb' };

  /* ---------------- 工具 ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sfx(name) {
    try {
      if (global.Audio && global.Audio.play) global.Audio.play(name);
    } catch (e) { /* 音效失败不影响玩法 */ }
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 900 + 1200;
  }

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* k < 1 压暗、k > 1 提亮，用来按 seed 做「同主题不同区块」的轻微色偏 */
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = clamp(Math.round(((n >> 16) & 255) * k), 0, 255);
    var g = clamp(Math.round(((n >> 8) & 255) * k), 0, 255);
    var b = clamp(Math.round((n & 255) * k), 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /* 拱门：直边 + 顶部半圆 */
  function archPath(ctx, x, y, w, h) {
    var r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  /* 白色径向光斑，按需着色后作为 sprite 复用（比逐帧建渐变便宜得多） */
  function makeGlow(color, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var r = size / 2;
    var grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, rgba(color, 0.90));
    grd.addColorStop(0.32, rgba(color, 0.38));
    grd.addColorStop(0.66, rgba(color, 0.11));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /* ============================================================
   * 1. 内容表：内置条目（数量随下方数组增减，文案不再写死）
   * ------------------------------------------------------------
   * 加一款游戏 = 往这里加一条 + 把页面放到 games/ 或 tools/ 下。
   * cat 决定它归哪座总门、用哪套配色。
   * ============================================================ */
  var ITEMS = [
    { id: 'noise', cat: 'tools', name: '白噪音', src: 'tools/noise/index.html',
      color: '#7fd8c8', glyph: 'noise', desc: '棕噪音 · 计时 · 便签', seed: 1103 },
    { id: 'pomodoro', cat: 'tools', name: '番茄钟', src: 'tools/pomodoro/index.html',
      color: '#f07167', glyph: 'pomodoro', desc: '专注计时 · 陪伴小猫', seed: 1104 },
    { id: 'links', cat: 'tools', name: '网址推荐', src: 'tools/links/index.html',
      color: '#f6c177', glyph: 'links', desc: '大家分享的好网站', seed: 1117 },
    { id: 'board', cat: 'tools', name: '留言板', src: 'tools/board/index.html',
      color: '#c8a5ff', glyph: 'links', desc: '给路过的人留句话', seed: 1121 },
    /* ---- 🎮 脑力街机（brain 直达，需联网；手机直接触屏玩，WorldHub 不派发按键） ---- */
    { id: 'snake', cat: 'games', group: '🎮 脑力街机', name: '贪吃蛇',
      src: 'https://ming-games.pages.dev/brain-gym/?game=snake',
      color: '#5fd39a', glyph: 'snake', desc: '人机蛇 · 经验豆 · 无限地图', cross: true, seed: 1105 },
    { id: 'flappy', cat: 'games', group: '🎮 脑力街机', name: '飞扬的小鸟',
      src: 'https://ming-games.pages.dev/brain-gym/?game=flappy',
      color: '#ffd166', glyph: 'arcade', desc: '点触飞行 · 穿水管', cross: true, seed: 1112 },
    { id: 'tiles', cat: 'games', group: '🎮 脑力街机', name: '别踩白块儿',
      src: 'https://ming-games.pages.dev/brain-gym/?game=tiles',
      color: '#a5b4fc', glyph: 'arcade', desc: '踩白块 · 别踩黑', cross: true, seed: 1113 },
    { id: 'plane', cat: 'games', group: '🎮 脑力街机', name: '飞机大战',
      src: 'https://ming-games.pages.dev/brain-gym/?game=plane',
      color: '#7ec8ff', glyph: 'arcade', desc: '射击弹幕 · 躲避', cross: true, seed: 1114 },
    { id: 'bubble', cat: 'games', group: '🎮 脑力街机', name: '泡泡龙',
      src: 'https://ming-games.pages.dev/brain-gym/?game=bubble',
      color: '#d0a5ff', glyph: 'arcade', desc: '同色消除 · 连击', cross: true, seed: 1115 },
    { id: 'pong', cat: 'games', group: '🎮 脑力街机', name: '乒乓',
      src: 'https://ming-games.pages.dev/brain-gym/?game=pong',
      color: '#ff9f9f', glyph: 'arcade', desc: '挡板对拍 · 接球', cross: true, seed: 1116 },
    /* ---- 🕹 开源小游戏（本地，可离线） ---- */
    { id: 'game2048', cat: 'games', group: '🕹 开源小游戏', name: '2048', src: 'games/game2048/index.html',
      color: '#f2cc60', glyph: 'n2048', desc: '数字合璧', seed: 1106 },
    { id: 'tetris', cat: 'games', group: '🕹 开源小游戏', name: '俄罗斯方块', src: 'games/tetris/index.html',
      color: '#9b8afb', glyph: 'tetris', desc: '方块下落 · 消行', seed: 1107 },
    { id: 'fight', cat: 'games', group: '🕹 开源小游戏', name: '格斗', src: 'games/fight/index.html',
      color: '#e8545f', glyph: 'fight', desc: '本地双人 · 出招掉血', seed: 1108 },
    { id: 'mine', cat: 'games', group: '🕹 开源小游戏', name: '扫雷', src: 'games/mine/index.html',
      color: '#6fc2ef', glyph: 'mine', desc: '翻格子 · 插旗', seed: 1109 },
    { id: 'gomoku', cat: 'games', group: '🕹 开源小游戏', name: '五子棋', src: 'games/gomoku/index.html',
      color: '#e8b45a', glyph: 'gomoku', desc: '人机对弈 · 五连', seed: 1110 },
    { id: 'breakout', cat: 'games', group: '🕹 开源小游戏', name: '打砖块', src: 'games/breakout/index.html',
      color: '#f2a0c0', glyph: 'breakout', desc: '反弹消砖 · 逐关', seed: 1111 },
    { id: 'warehouse', cat: 'games', group: '🕹 开源小游戏', name: '仓库行动',
      src: 'https://warehouse-strike.pages.dev/',
      color: '#ff6b6b', glyph: 'arcade', desc: '第一人称 · 仓库枪战',
      cross: true, seed: 1201 },
    /* ---- ✨ 大厅新玩（自研，可离线） ---- */
    { id: 'memory', cat: 'games', group: '✨ 大厅新玩', name: '记忆翻牌', src: 'games/memory/index.html',
      color: '#f2a0c0', glyph: 'cards', desc: '配对消除 · 三档棋盘', seed: 1211 },
    { id: 'reaction', cat: 'games', group: '✨ 大厅新玩', name: '反应速度', src: 'games/reaction/index.html',
      color: '#5fd39a', glyph: 'arcade', desc: '变绿就点 · 五轮定级', seed: 1212 },
    { id: 'mathdash', cat: 'games', group: '✨ 大厅新玩', name: '算术挑战', src: 'games/mathdash/index.html',
      color: '#7ec8ff', glyph: 'n2048', desc: '60 秒口算 · 连击加分', seed: 1213 }
  ];

  /* 动态计数：避免文案把数字写死（区块/游戏数量随内容增减） */
  var ZONE_COUNT = ITEMS.length;                                                    // 16 个区块
  var GAME_COUNT = ITEMS.filter(function (i) { return i.cat === 'games'; }).length; // 13 款小游戏

  /* HUD 标题里的区块数随内容走（首屏 HTML 里是兜底值） */
  var _hudP = document.querySelector('.hud-title p');
  if (_hudP) _hudP.textContent = '三屏走道 · 两座总门 · ' + ZONE_COUNT + ' 个区块';

  /* 每个场景的 NPC 台词：line1 是头顶气泡的第一行（要短），lines 是面板里的全文 */
  var NPC_LINES = {
    plaza: {
      name: '守灯人',
      line1: '……又一位旅行者。',
      lines: [
        '……又一位旅行者。欢迎来到中心广场。',
        '这里不再是一条直路。左右各有一座总门，路只留着三屏。',
        '往左走，是工具总门：听风、计时、找网站、留句话。',
        '往右走，是游戏总门：' + GAME_COUNT + ' 款小游戏都在那后面。',
        '站到门前按 E，会列出那一整排区块，选一个就能直接传过去。',
        '每个区块里都有人等着给你讲怎么用——先听，再按 E 进门。',
        '想回来？在区块里往任意一边走出画面就行。',
        '灯会一直为你亮着。'
      ]
    },
    noise: {
      name: '听风者',
      line1: '嘘——听风。',
      lines: [
        '嘘——我在听这一屏的风。',
        '这是白噪音：棕噪音打底，声音厚实，不刺耳，写东西的时候开它就对了。',
        '中间那个大按钮点开就响；下面两条滑条，一条调音量，一条调「温暖度」，往右越闷。',
        '旁边还有 25 / 50 分钟的计时和一张便签，便签关掉浏览器也还在。',
        '想走？往左往右走出画面，就回广场了。'
      ]
    },
    pomodoro: {
      name: '守钟人',
      line1: '别催，钟在走。',
      lines: [
        '别催，钟在走。',
        '这是番茄钟：25 分钟专注，5 分钟休息，一轮一轮来。',
        '点 Start 开始，Pause 暂停，Reset 归零；右上角那几只猫会一直陪着你。',
        '想听点雨声，就把下面的环境音打开。',
        '走出画面边缘，就回广场了。'
      ]
    },
    links: {
      name: '引路者',
      line1: '好网站，一起攒。',
      lines: [
        '这里收录大家推荐的好网站，谁都能加、谁都能看。',
        '网址推荐：点名称在新标签打开；你也可以提交自己的收藏。',
        '添加时会自动检查格式和内容，通过就直接上墙，不用等审核。',
        '走出画面边缘，就回广场了。'
      ]
    },
    snake: {
      name: '养蛇人',
      line1: '这条蛇通了灵。',
      lines: [
        '这条蛇通了灵——会吃经验豆长本事，还有人机对手追着你咬。',
        '贪吃蛇（脑力街机版）：地图没有边界，吃掉经验豆升级，别被人机蛇咬到。',
        '手机上直接点屏幕或滑方向键就能玩，不用额外按键；需要联网才能进。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    flappy: {
      name: '飞鸟使',
      line1: '点一下，飞一下。',
      lines: [
        '点一下，鸟就往上飞一下；不点就往下坠。',
        '飞扬的小鸟：穿过一根根水管，撞上就结束。',
        '手机上点屏幕就能玩，需要联网。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    tiles: {
      name: '琴键师',
      line1: '别踩黑块。',
      lines: [
        '只有白块能踩，黑块一碰就断。',
        '别踩白块儿：跟着节奏往下踩白块，越快分越高。',
        '手机上点屏幕就能玩，需要联网。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    plane: {
      name: '王牌',
      line1: '敌机来了。',
      lines: [
        '你的飞机要边躲弹幕边开火。',
        '飞机大战：左右移动，自动开火，打掉敌机攒分。',
        '手机上滑动屏幕控制飞机，需要联网。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    bubble: {
      name: '泡泡龙',
      line1: '瞄准，同色。',
      lines: [
        '发射泡泡，三个同色就连消。',
        '泡泡龙：把泡泡射到同色的旁边，连成三个就消除。',
        '手机上点屏幕瞄准发射，需要联网。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    pong: {
      name: '球手',
      line1: '别让球落地。',
      lines: [
        '挡板接住球，别让它落地。',
        '乒乓：左右移动挡板，把球顶回对手那边。',
        '手机上滑屏幕控制挡板，需要联网。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    game2048: {
      name: '算盘先生',
      line1: '你算得比我快？',
      lines: [
        '一、二、四、八……你算得比我的算盘快吗？',
        '2048：四个方向推，数字相同的两块撞在一起就翻倍。',
        '方向键或 WASD 都行，目标是把 2048 那块拼出来。',
        '边缘一走，回广场。'
      ]
    },
    tetris: {
      name: '落石匠',
      line1: '石头要掉了。',
      lines: [
        '石头从上头掉，我一块一块摆。',
        '俄罗斯方块：方块堆到顶就结束，消一行得一行分。',
        '左右移动，上键旋转，下键加速，空格直落，P 暂停。',
        '走出边缘回广场。'
      ]
    },
    fight: {
      name: '教头',
      line1: '站稳了。',
      lines: [
        '站好了，这里是擂台。',
        '格斗：两个人一台键盘，谁的血条先空谁输。',
        '1P 用 W A S D 走跳，J 高拳、K 低拳、L 踢，Shift 防御；2P 用方向键加方括号那一排。',
        '打完了从画面边缘走回去。'
      ]
    },
    mine: {
      name: '排雷兵',
      line1: '脚步轻点。',
      lines: [
        '这片地底下埋着东西，脚步轻点。',
        '扫雷：左键翻格，右键插旗，格子上的数字是周围八格的地雷数。',
        '第一次点不会踩雷；把所有不是雷的格子翻完就算赢。',
        '边缘一走，回广场。'
      ]
    },
    gomoku: {
      name: '棋博士',
      line1: '来一盘？',
      lines: [
        '来一盘？我执白，你执黑。',
        '五子棋：横、竖、斜，先连成五个的赢。',
        '点交叉点落子，想清楚了再点，落子无悔。',
        '从画面边缘走回去，别在这儿站太久。'
      ]
    },
    breakout: {
      name: '球童',
      line1: '球别掉。',
      lines: [
        '球掉了我可捡不过来。',
        '打砖块：挡板接住球，把上面的砖全敲掉就过关。',
        '左右移动挡板，空格开始或者发球。',
        '打累了就从边缘走出去。'
      ]
    },
    warehouse: {
      name: '哨兵',
      line1: '仓库里不太平。',
      lines: [
        '仓库里进了人，拿好枪清场。',
        '仓库行动：网页 FPS，瞄准射击，把仓库里的敌人清干净。',
        '鼠标瞄准、点击射击，手机上直接触屏操作；需要联网才能进。',
        '从画面边缘走出去，就回广场了。'
      ]
    },
    board: {
      name: '守石人',
      line1: '石板闲着也是闲着。',
      lines: [
        '这块石板空了几百年了。',
        '留言板：谁路过都能刻一句话，所有人都看得见。',
        '署名最多十个字，留言一百二十个字，别写隐私。',
        '联网时写进云端，断了网先替你刻在本机。'
      ]
    },
    memory: {
      name: '洗牌人',
      line1: '图案都朝下，看你记性。',
      lines: [
        '这是我压箱底的牌。',
        '记忆翻牌：一次翻两张，一样的就配对，全配完算过关。',
        '三档棋盘越翻越多；步数越少、时间越短，纪录就越漂亮。',
        '手机上也能玩，点牌就行。'
      ]
    },
    reaction: {
      name: '闪电使',
      line1: '快，比想更快。',
      lines: [
        '这里测的不是聪明，是手。',
        '反应速度：红圆变绿的瞬间点它，五轮取平均定级。',
        '绿之前就点算抢跑，那一轮作废重来。',
        '平均 180 毫秒以内，就算得上是闪电了。'
      ]
    },
    mathdash: {
      name: '算盘先生',
      line1: '心里打算盘，别怕。',
      lines: [
        '六十秒，能算几题算几题。',
        '算术挑战：加减乘除轮流上，连对越多题越难、分越高。',
        '连对五个开始翻倍，答错降一档。',
        '手机上用下面那个小键盘，点着比打字快。'
      ]
    }
  };

  /* ---------------- 大厅皮肤（只改氛围：色相/饱和度/昼夜强度） ---------------- */
  var SKINS = {
    paper: { name: '剪纸', hue: 1.00, sat: 1.00 },
    ink:   { name: '水墨', hue: 0.92, sat: 0.55 },
    dusk:  { name: '琥珀暮色', hue: 1.06, sat: 1.12 }
  };
  var SKIN_KEY = 'worldhub.skin.v1';
  function skinId() {
    try { var v = global.localStorage.getItem(SKIN_KEY); return SKINS[v] ? v : 'paper'; }
    catch (e) { return 'paper'; }
  }
  function skinData() { return SKINS[skinId()]; }
  function desat(hex, satK) {
    if (satK === 1) return hex;
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g0 = (n >> 8) & 255, b = n & 255;
    var lum = (r * 299 + g0 * 587 + b * 114) / 1000;
    r = Math.round(lum + (r - lum) * satK);
    g0 = Math.round(lum + (g0 - lum) * satK);
    b = Math.round(lum + (b - lum) * satK);
    return '#' + ((1 << 24) + (clamp(r, 0, 255) << 16) + (clamp(g0, 0, 255) << 8) + clamp(b, 0, 255)).toString(16).slice(1);
  }

  /* ============================================================
   * 2. 场景表
   * ------------------------------------------------------------
   * kind: 'gate'（总门）/ 'plaza'（广场）/ 'zone'（区块）
   * 能走的只有 WALK 里那三屏，其余靠传送。
   * ============================================================ */
  var SCENES = [];
  var WALK = ['gate-tools', 'plaza', 'gate-games'];

  /* 某个总门里能看到什么：内置在前，自建在后 */
  function catalog(cat) {
    var out = [], i;
    for (i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].cat === cat) out.push(ITEMS[i]);
    }
    if (global.Contrib && global.Contrib.forCat) {
      var extra = global.Contrib.forCat(cat);
      for (i = 0; i < extra.length; i++) out.push(extra[i]);
    }
    return out;
  }

  function gateScene(cat, seed) {
    return {
      id: cat === 'tools' ? 'gate-tools' : 'gate-games',
      kind: 'gate',
      cat: cat,
      title: cat === 'tools' ? '工具总门' : '游戏总门',
      themeKey: cat === 'tools' ? 'left' : 'right',
      seed: seed,
      item: null,
      npcX: 0,
      door: {
        x: 640, w: 136, h: 224,
        isGate: true, cat: cat,
        name: cat === 'tools' ? '工具总门' : '游戏总门',
        desc: cat === 'tools' ? '按 E 选一个工具区块' : '按 E 选一个游戏区块',
        color: CAT_COLOR[cat], glyph: 'gate', src: ''
      }
    };
  }

  function rebuildScenes() {
    var arr = [];
    arr.push(gateScene('tools', 1091));
    arr.push({
      id: 'plaza', kind: 'plaza', cat: '', title: '中心广场',
      themeKey: 'center', seed: 0, item: null, npcX: 470,
      door: {
        x: 960, w: 150, h: 150,
        isNotice: true, isGate: false, cat: '',
        name: '每日一题', desc: '站过来按 E 看今天的题',
        color: '#f0a76e', glyph: 'gate', src: ''
      }
    });
    arr.push(gateScene('games', 1092));

    var cats = ['tools', 'games'];
    for (var c = 0; c < cats.length; c++) {
      var cat = cats[c];
      var list = catalog(cat);
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        arr.push({
          id: it.id,
          kind: 'zone',
          cat: cat,
          title: it.name,
          themeKey: cat === 'tools' ? 'left' : 'right',
          seed: it.seed || hashStr(it.id),
          item: it,
          npcX: cat === 'tools' ? 470 : 800,
          door: {
            x: cat === 'tools' ? 320 : 960,
            w: 104, h: 190,
            isGate: false, cat: cat,
            name: it.name, desc: it.desc,
            color: it.color, glyph: it.glyph, src: it.src
          }
        });
      }
    }

    SCENES.length = 0;
    for (var k = 0; k < arr.length; k++) SCENES.push(arr[k]);
    return SCENES;
  }

  function sceneIndexById(id) {
    for (var i = 0; i < SCENES.length; i++) {
      if (SCENES[i].id === id) return i;
    }
    return -1;
  }

  /* 三套配色：广场黄昏橙、工具区偏青绿、游戏区偏紫蓝 */
  var THEME = {
    left: {
      sky: ['#03121a', '#082530', '#0f3a42', '#1c5750', '#3b7d6b', '#7cb79b'],
      ridge: [
        { c: '#1b3a3c', rim: 'rgba(122, 186, 166, 0.50)' },
        { c: '#15302f', rim: 'rgba(96, 154, 138, 0.40)' },
        { c: '#0f2624', rim: 'rgba(76, 128, 114, 0.34)' },
        { c: '#081715', rim: 'rgba(58, 102, 90, 0.30)' }
      ],
      tree: ['#0c201f', '#061312'],
      grass: '#04100f',
      road: '#12211f',
      roadDark: '#07100f',
      edge: 'rgba(150, 220, 190, 0.58)',
      mist: 'rgba(96, 168, 148, 0.10)'
    },
    center: {
      sky: ['#0a0c1e', '#1a1634', '#372244', '#65334a', '#a05940', '#dd9a5f'],
      ridge: [
        { c: '#3b3059', rim: 'rgba(122, 100, 158, 0.55)' },
        { c: '#2f2749', rim: 'rgba(96, 80, 130, 0.45)' },
        { c: '#241d3b', rim: 'rgba(74, 62, 105, 0.40)' },
        { c: '#171325', rim: 'rgba(58, 49, 80, 0.40)' }
      ],
      tree: ['#1d1733', '#120f1e'],
      grass: '#0a0713',
      road: '#1a1527',
      roadDark: '#0c0916',
      edge: 'rgba(240, 167, 110, 0.62)',
      mist: 'rgba(146, 112, 114, 0.11)'
    },
    right: {
      sky: ['#06081d', '#141140', '#28205a', '#44296a', '#6d4278', '#a2668e'],
      ridge: [
        { c: '#2b2454', rim: 'rgba(150, 118, 190, 0.52)' },
        { c: '#221c46', rim: 'rgba(126, 98, 164, 0.44)' },
        { c: '#191436', rim: 'rgba(100, 78, 136, 0.40)' },
        { c: '#0e0b26', rim: 'rgba(78, 60, 110, 0.36)' }
      ],
      tree: ['#191335', '#0e0b1f'],
      grass: '#080613',
      road: '#1b1630',
      roadDark: '#0b0918',
      edge: 'rgba(196, 150, 220, 0.55)',
      mist: 'rgba(130, 100, 156, 0.12)'
    }
  };

  /* 帮助面板内容：必须和真实键位逐字一致，改键位请同步改这里 */
  var HELP_ROWS = [
    ['大厅', 'A / D 移动 · 空格 跳跃 · E 交互 · H 帮助 · O 设置'],
    ['总门', '广场往左 / 往右各有一座总门，站过去按 E 选区块'],
    ['传送', '选完直接落到那个区块中央，先听 NPC 讲，再按 E 进门'],
    ['区块', '任意一侧边缘走出去，就回中心广场'],
    ['告示牌', '广场正中那块牌：按 E 答今天的每日一题'],
    ['游戏 / 工具', '左上「← 回上一级」回到进门前那屏，右上「← 回大厅」回广场'],
    ['设置', '顶栏齿轮或 O 键：场景背景 / 音量 / 全屏 / 重置存档'],
    ['通用', 'Esc 关闭面板 · H 关掉这块面板']
  ];

  /* ---------------- 静态图层：纸纹 / 暗角 ---------------- */
  function buildGrain() {
    var s = 128;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var img = g.createImageData(s, s);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = (Math.random() * 255) | 0;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 8 + ((Math.random() * 16) | 0);
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function buildVignette() {
    var c = document.createElement('canvas');
    c.width = VIEW_W;
    c.height = VIEW_H;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(VIEW_W * 0.5, VIEW_H * 0.48, VIEW_H * 0.32,
                                     VIEW_W * 0.5, VIEW_H * 0.5, VIEW_H * 0.95);
    grd.addColorStop(0, 'rgba(6, 4, 12, 0)');
    grd.addColorStop(0.72, 'rgba(6, 4, 12, 0.20)');
    grd.addColorStop(1, 'rgba(4, 3, 8, 0.64)');
    g.fillStyle = grd;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    return c;
  }

  /* ---------------- 山脊 / 装饰件 ---------------- */
  function makeRidge(rng, width, baseY, amp, minStep, maxStep) {
    var pts = [{ x: -260, y: baseY }];
    var x = -200;
    var y = baseY;
    while (x < width + 260) {
      x += minStep + rng() * (maxStep - minStep);
      var t = rng();
      if (t < 0.22) y = baseY - amp * (0.02 + rng() * 0.1);
      else y = baseY - amp * (0.28 + rng() * 0.72);
      pts.push({ x: x, y: y });
    }
    pts.push({ x: width + 300, y: baseY });
    return pts;
  }

  function traceTop(ctx, pts, smooth) {
    var i, last;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (smooth) {
      for (i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(
          pts[i].x, pts[i].y,
          (pts[i].x + pts[i + 1].x) / 2,
          (pts[i].y + pts[i + 1].y) / 2
        );
      }
      last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
    } else {
      for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    }
  }

  function drawRidge(ctx, pts, color, rim, bottom, smooth) {
    ctx.beginPath();
    traceTop(ctx, pts, smooth);
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.beginPath();
    traceTop(ctx, pts, smooth);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  function drawPine(ctx, x, baseY, h, w, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 3; i++) {
      var by = baseY - h * i * 0.22;
      var ww = w * (1 - i * 0.22);
      var top = by - h * 0.46;
      ctx.moveTo(x, top);
      ctx.lineTo(x + ww / 2, by);
      ctx.lineTo(x - ww / 2, by);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillRect(x - 1.6, baseY - h * 0.2, 3.2, h * 0.2 + 3);
  }

  function drawGrass(ctx, x, y, h, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 2, y - h * 0.6, x - 5, y - h);
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 1, y - h * 0.7, x + 3, y - h * 1.08);
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 4, y - h * 0.5, x + 8, y - h * 0.78);
    ctx.stroke();
  }

  function drawLamp(ctx, x, baseY, h) {
    ctx.fillStyle = '#0c0916';
    ctx.fillRect(x - 2, baseY - h, 4, h);
    ctx.beginPath();
    ctx.moveTo(x - 13, baseY - h + 2);
    ctx.lineTo(x + 13, baseY - h + 2);
    ctx.lineTo(x + 8, baseY - h - 20);
    ctx.lineTo(x - 8, baseY - h - 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 158, 0.95)';
    ctx.beginPath();
    ctx.moveTo(x - 8, baseY - h + 1);
    ctx.lineTo(x + 8, baseY - h + 1);
    ctx.lineTo(x + 5, baseY - h - 15);
    ctx.lineTo(x - 5, baseY - h - 15);
    ctx.closePath();
    ctx.fill();
  }

  /* ---------------- 门里的图腾 ---------------- */
  function drawGlyph(ctx, kind, cx, cy, t) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.86)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, a, x, y;

    if (kind === 'gate') {
      /* 门中门：一个拱 + 三道向内的裂纹 */
      ctx.beginPath();
      ctx.moveTo(cx - 21, cy + 26);
      ctx.lineTo(cx - 21, cy - 2);
      ctx.arc(cx, cy - 2, 21, Math.PI, 0);
      ctx.lineTo(cx + 21, cy + 26);
      ctx.closePath();
      ctx.stroke();

      for (i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.62 - i * 0.16;
        ctx.beginPath();
        ctx.moveTo(cx - 11 + i * 2.5, cy + 16 - i * 11);
        ctx.lineTo(cx, cy + 3 - i * 11);
        ctx.lineTo(cx + 11 - i * 2.5, cy + 16 - i * 11);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.moveTo(cx - 30, cy + 31);
      ctx.lineTo(cx + 30, cy + 31);
      ctx.stroke();

    } else if (kind === 'snake') {
      var px = [], py = [];
      for (i = 0; i < 7; i++) {
        a = i * 0.85 + t * 0.9;
        px.push(cx + Math.sin(a) * 15);
        py.push(cy - 30 + i * 9.5);
      }
      ctx.beginPath();
      ctx.moveTo(px[0], py[0]);
      for (i = 1; i < px.length; i++) ctx.lineTo(px[i], py[i]);
      ctx.stroke();
      for (i = 0; i < px.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(px[i], py[i], 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(px[6], py[6], 5.2, 0, Math.PI * 2);
      ctx.fill();

    } else if (kind === 'n2048') {
      var nums = ['2', '0', '4', '8'];
      ctx.font = '600 17px ' + SANS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (i = 0; i < 4; i++) {
        x = cx + (i % 2 ? 13 : -13);
        y = cy + (i < 2 ? -13 : 13);
        roundRect(ctx, x - 11, y - 11, 22, 22, 5);
        ctx.stroke();
        ctx.fillText(nums[i], x, y + 1);
      }

    } else if (kind === 'tetris') {
      var blocks = [[-18, -18], [-18, 0], [0, 0], [0, 18], [18, 18], [18, 36],
                    [18, -12], [36, -12], [36, 6], [54, 6]];
      for (i = 0; i < blocks.length; i++) {
        roundRect(ctx, cx - 26 + blocks[i][0], cy - 26 + blocks[i][1], 15, 15, 2.5);
        ctx.stroke();
      }

    } else if (kind === 'fight') {
      for (i = 0; i < 2; i++) {
        var s = i === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx - s * 20, cy + 22);
        ctx.lineTo(cx + s * 16, cy - 24);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + s * 10, cy - 14);
        ctx.lineTo(cx + s * 20, cy - 4 + s * 4);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();

    } else if (kind === 'mine') {
      ctx.lineWidth = 1.1;
      for (i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy - 24 + i * 12);
        ctx.lineTo(cx + 6, cy - 24 + i * 12);
        ctx.moveTo(cx - 30 + i * 9, cy - 24);
        ctx.lineTo(cx - 30 + i * 9, cy + 24);
        ctx.stroke();
      }
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx + 22, cy + 4, 9, 0, Math.PI * 2);
      ctx.stroke();
      for (i = 0; i < 8; i++) {
        a = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(cx + 22 + Math.cos(a) * 9, cy + 4 + Math.sin(a) * 9);
        ctx.lineTo(cx + 22 + Math.cos(a) * 14, cy + 4 + Math.sin(a) * 14);
        ctx.stroke();
      }

    } else if (kind === 'gomoku') {
      ctx.lineWidth = 1;
      for (i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 30 + i * 20, cy - 30);
        ctx.lineTo(cx - 30 + i * 20, cy + 30);
        ctx.moveTo(cx - 30, cy - 30 + i * 20);
        ctx.lineTo(cx + 30, cy - 30 + i * 20);
        ctx.stroke();
      }
      ctx.lineWidth = 1.8;
      for (i = 0; i < 5; i++) {
        x = cx - 20 + i * 10;
        y = cy + 20 - i * 10;
        ctx.beginPath();
        ctx.arc(x, y, 6.5, 0, Math.PI * 2);
        if (i % 2 === 0) ctx.fill(); else ctx.stroke();
      }

    } else if (kind === 'breakout') {
      for (i = 0; i < 3; i++) {
        roundRect(ctx, cx - 28 + i * 20, cy - 26, 17, 10, 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx + 8, cy + 0, 5, 0, Math.PI * 2);
      ctx.fill();
      roundRect(ctx, cx - 22, cy + 22, 40, 8, 4);
      ctx.stroke();

    } else if (kind === 'noise') {
      ctx.beginPath();
      for (i = 0; i <= 40; i++) {
        x = cx - 30 + i * 1.5;
        var amp = 6 + Math.sin(i * 0.42 + t * 1.6) * 4 + Math.sin(i * 0.13) * 3;
        y = cy + Math.sin(i * 0.62 + t * 2.2) * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 30, cy);
      ctx.lineTo(cx + 30, cy);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
      ctx.stroke();

    } else if (kind === 'arcade') {
      /* 街机手柄：机身 + 十字键 + 两粒按键 */
      roundRect(ctx, cx - 30, cy - 18, 60, 36, 18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 20, cy); ctx.lineTo(cx - 6, cy);
      ctx.moveTo(cx - 13, cy - 7); ctx.lineTo(cx - 13, cy + 7);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 8, cy - 3, 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + 18, cy + 3, 3.4, 0, Math.PI * 2); ctx.fill();

    } else if (kind === 'links') {
      /* 网址推荐：两节相连的链环 */
      for (i = 0; i < 2; i++) {
        x = cx + (i ? 14 : -14);
        ctx.beginPath();
        ctx.arc(x, cy, 13, Math.PI * 0.75, Math.PI * 1.75);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, cy, 13, -Math.PI * 0.25, Math.PI * 0.25);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy + 2); ctx.lineTo(cx + 22, cy + 2);
      ctx.stroke();

    } else if (kind === 'cards') {
      /* 记忆翻牌：两张错位的牌 + 一颗星 */
      ctx.save();
      ctx.translate(cx - 8, cy);
      ctx.rotate(-0.14);
      roundRect(ctx, -11, -16, 22, 32, 4);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(cx + 9, cy + 2);
      ctx.rotate(0.12);
      roundRect(ctx, -11, -16, 22, 32, 4);
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (i = 0; i < 5; i++) {
        a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        x = Math.cos(a) * 7;
        y = 0 + Math.sin(a) * 7;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        a += Math.PI * 2 / 10;
        ctx.lineTo(Math.cos(a) * 3, Math.sin(a) * 3);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

    } else {
      /* pomodoro：番茄 + 指针 */
      ctx.beginPath();
      ctx.arc(cx, cy + 4, 21, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 18);
      ctx.quadraticCurveTo(cx, cy - 28, cx + 8, cy - 19);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx, cy - 8);
      ctx.moveTo(cx, cy + 4);
      ctx.lineTo(cx + 9, cy + 7);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ============================================================
   * WorldScene
   * ============================================================ */
  function WorldScene() {
    this.t = 0;
    this.ctx = null;

    this.sceneIdx = 1;
    this.scene = null;

    this.player = null;
    this.npc = null;
    this.near = null;
    this.npcNear = false;

    this._onKey = null;
    this._onClick = null;
    this._onBg = null;
    this._onHelp = null;
    this._onContrib = null;

    this.intro = 0;
    this.help = false;
    this.veil = 0;
    this.zoneT = 0;
    this.edgeT = 0;
    this.edgeLockL = false;
    this.edgeLockR = false;
    this._frozen = false;

    this.prevGround = true;
    this.prevVy = 0;

    this.stars = [];
    this.motes = [];
    this.lamps = [];
    this.trees = [];

    this.bg = null;
    this.bgScene = '';
    this.grain = null;
    this.vignette = null;
    this.grainPattern = null;
    this.lampGlow = null;

    this._photo = null;
    this._photoSrc = '';
    this._photoFail = '';
    this.staticLayer = null;
    this.staticCanvas = null;

    /* 镜头：横向跟随玩家，纵向固定在 CAM_Y（地面贴屏幕底边） */
    this.cam = global.Camera ? new global.Camera(CAM_W, CAM_H, VIEW_W, VIEW_H) : null;
    if (this.cam) this.cam.y = CAM_Y;

    this.groundY = GROUND_Y;
    this.fgPhase = 0;
    this.hueK = 1;
  }

  /* ---------------- 场景 ---------------- */
  WorldScene.prototype.setScene = function (idx, opts) {
    opts = opts || {};

    if (this.npc && this.npc.state === 'talking') this.npc.closeDialog();

    this.sceneIdx = clamp(idx, 0, SCENES.length - 1);
    this.scene = SCENES[this.sceneIdx];

    var seed = this.scene.seed || 1;
    this.hueK = 1 + (((seed % 7) - 3) * 0.02);

    this.npc = makeNpc(this.scene);
    this.near = null;
    this.npcNear = false;

    this.bakeStatic();
    if (!opts.keepBg) this.bakeBg();
  };

  function makeNpc(z) {
    if (z.kind === 'gate') return null;
    if (!global.NPC) return null;

    var t = NPC_LINES[z.id];
    if (!t) {
      /* 自建内容：没有专属台词时给一段通用介绍 */
      var it = z.item || {};
      var lines = ['这一屏是别人做的东西：《' + z.title + '》。'];
      if (it.desc) lines.push('他自己的说法是：' + it.desc + '。');
      if (it.author) lines.push('作者署名：' + it.author + '。');
      lines.push('站到门边按 E 就能进去。');
      lines.push('想回广场，从画面边缘走出去。');
      t = { name: '引路人', line1: '这一屏是自建的。', lines: lines };
    }

    return new global.NPC(z.npcX, GROUND_Y, {
      name: t.name,
      line1: t.line1,
      line2: '按 E 与我说话',
      lines: t.lines
    });
  }

  /* 预渲染整张背景：有自定义图就用图，否则程序化烘焙 */
  WorldScene.prototype.bakeBg = function () {
    var z = this.scene;
    var custom = (global.BgStore && global.BgStore.get) ? global.BgStore.get(z.id) : '';
    if (custom && custom !== this._photoFail) this.bakePhoto(custom);
    else this.bakeProcedural();
    this.bgScene = z.id;
  };

  /* 自定义背景：cover 铺满 + 压暗 + 底部路面，保证角色有「地」可站 */
  WorldScene.prototype.bakePhoto = function (src) {
    var self = this;
    var z = this.scene;

    if (!this.bg) {
      this.bg = document.createElement('canvas');
      this.bg.width = VIEW_W;
      this.bg.height = VIEW_H;
    }
    var g = this.bg.getContext('2d');
    g.clearRect(0, 0, VIEW_W, VIEW_H);

    var img = this._photo;
    if (!img || this._photoSrc !== src) {
      img = new Image();
      this._photo = img;
      this._photoSrc = src;
      img.onload = function () {
        if (self.scene && self.scene.id === z.id) self.bakeBg();
      };
      img.onerror = function () {
        self._photoFail = src;          /* 坏图只失败一次，之后回落程序化 */
        if (self.scene && self.scene.id === z.id) self.bakeBg();
      };
      img.src = src;
    }

    g.fillStyle = '#0a0814';
    g.fillRect(0, 0, VIEW_W, VIEW_H);

    if (img && img.complete && img.naturalWidth) {
      var s = Math.max(VIEW_W / img.naturalWidth, VIEW_H / img.naturalHeight);
      var w = img.naturalWidth * s;
      var h = img.naturalHeight * s;
      g.drawImage(img, (VIEW_W - w) / 2, (VIEW_H - h) / 2, w, h);

      /* 压一层暗，文字与门才压得住照片 */
      g.fillStyle = 'rgba(8, 6, 16, 0.26)';
      g.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    /* 地面：照片里未必有地平线，自己补一条，角色才不会浮着 */
    var grd = g.createLinearGradient(0, GROUND_Y - 10, 0, VIEW_H);
    grd.addColorStop(0, 'rgba(8, 6, 14, 0)');
    grd.addColorStop(0.18, 'rgba(8, 6, 14, 0.72)');
    grd.addColorStop(1, 'rgba(5, 4, 10, 0.94)');
    g.fillStyle = grd;
    g.fillRect(0, GROUND_Y - 10, VIEW_W, VIEW_H - GROUND_Y + 10);
    g.fillStyle = 'rgba(255, 217, 168, 0.22)';
    g.fillRect(0, GROUND_Y, VIEW_W, 2);

    this.stars.length = 0;
    this.trees.length = 0;
    this.lamps = [];
    this.fgPhase = 700;
  };

  WorldScene.prototype.bakeProcedural = function () {
    var z = this.scene;
    var theme = THEME[z.themeKey] || THEME.center;
    var rng = mulberry32(z.seed || 1);
    var sk = skinData();
    var k = this.hueK * sk.hue;
    var i;
    function SC(hex, mul) { return shade(desat(hex, sk.sat), k * (mul || 1)); }

    if (!this.bg) {
      this.bg = document.createElement('canvas');
      this.bg.width = VIEW_W;
      this.bg.height = VIEW_H;
    }
    var g = this.bg.getContext('2d');
    g.clearRect(0, 0, VIEW_W, VIEW_H);

    /* --- 天空 --- */
    var sky = g.createLinearGradient(0, 0, 0, GROUND_Y);
    var stops = [0, 0.24, 0.46, 0.66, 0.83, 1];
    for (i = 0; i < stops.length; i++) {
      sky.addColorStop(stops[i], SC(theme.sky[i]));
    }
    g.fillStyle = sky;
    g.fillRect(0, 0, VIEW_W, GROUND_Y);

    /* --- 太阳 / 月亮（夜里烘月；位置随主题确定性偏移） --- */
    var night = global.DayNight && global.DayNight.phase() === 'night';
    var sx;
    if (z.kind === 'gate') sx = 200 + rng() * 170;
    else if (z.themeKey === 'left') sx = 240 + rng() * 160;
    else if (z.themeKey === 'right') sx = 940 + rng() * 140;
    else sx = 940 + rng() * 100;
    var sy = 300 + rng() * 80;
    var sr = 58 + rng() * 18;
    if (!night) {
      var halo = g.createRadialGradient(sx, sy, sr * 0.7, sx, sy, sr * 5.2);
      halo.addColorStop(0, 'rgba(255, 205, 145, 0.30)');
      halo.addColorStop(0.42, 'rgba(255, 165, 100, 0.11)');
      halo.addColorStop(1, 'rgba(255, 140, 80, 0)');
      g.fillStyle = halo;
      g.fillRect(0, 0, VIEW_W, GROUND_Y);

      g.beginPath();
      g.arc(sx, sy, sr, 0, Math.PI * 2);
      var disc = g.createLinearGradient(0, sy - sr, 0, sy + sr);
      disc.addColorStop(0, '#ffefd0');
      disc.addColorStop(0.55, '#ffd09a');
      disc.addColorStop(1, '#f0a066');
      g.fillStyle = disc;
      g.fill();
    } else {
      var mx = sx, my = Math.max(240, Math.min(380, sy - 40)), mr = 40 + rng() * 10;
      var mhalo = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.6);
      mhalo.addColorStop(0, 'rgba(200, 215, 255, 0.20)');
      mhalo.addColorStop(1, 'rgba(160, 180, 255, 0)');
      g.fillStyle = mhalo;
      g.fillRect(0, 0, VIEW_W, GROUND_Y);

      g.beginPath();
      g.arc(mx, my, mr, 0, Math.PI * 2);
      g.fillStyle = '#e8ecff';
      g.fill();
      g.beginPath();
      g.arc(mx + mr * 0.55, my - mr * 0.25, mr * 0.92, 0, Math.PI * 2);
      g.fillStyle = SC(theme.sky[2]);
      g.fill();
      g.fillStyle = 'rgba(150, 160, 200, 0.35)';
      g.beginPath(); g.arc(mx - mr * 0.3, my + mr * 0.15, mr * 0.16, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(mx - mr * 0.05, my + mr * 0.45, mr * 0.10, 0, Math.PI * 2); g.fill();
    }

    /* --- 剪纸云带 --- */
    if ('filter' in g) g.filter = 'blur(5px)';
    for (i = 0; i < 5; i++) {
      var bw = 180 + rng() * 300;
      var bx = rng() * (VIEW_W - bw);
      var by = 150 + rng() * 240;
      g.fillStyle = 'rgba(255, 222, 180, ' + (0.05 + rng() * 0.045).toFixed(3) + ')';
      roundRect(g, bx, by, bw, 6 + rng() * 5, 5);
      g.fill();
    }
    if ('filter' in g) g.filter = 'none';

    /* --- 星 --- */
    this.stars.length = 0;
    for (i = 0; i < 56; i++) {
      this.stars.push({
        x: rng() * VIEW_W,
        y: 210 + rng() * 90,          /* 落在可见天区 [206,566]；旧值 20+200 有 ≈93% 在视野外 */
        r: 0.6 + rng() * 1.5,
        p: rng() * Math.PI * 2,
        s: 0.5 + rng() * 1.4
      });
    }

    /* --- 山脊：远景到近景 --- */
    var ridgeBase = [470, 508, 540, 560];
    var ridgeAmp = [176, 140, 92, 58];
    for (i = 0; i < 4; i++) {
      var pts = makeRidge(rng, VIEW_W, ridgeBase[i], ridgeAmp[i], 110 + i * 4, 190 + i * 20);
      drawRidge(g, pts, SC(theme.ridge[i].c), theme.ridge[i].rim, VIEW_H, i > 0);
    }

    /* --- 林：挂在后两层山脊上 --- */
    this.trees.length = 0;
    for (i = 0; i < 62; i++) {
      var layer = i < 44 ? 2 : 3;
      var th = layer === 2 ? 30 + rng() * 24 : 52 + rng() * 44;
      this.trees.push({
        layer: layer,
        x: -80 + rng() * (VIEW_W + 220),
        y: layer === 2 ? 534 + rng() * 8 : 556 + rng() * 5,
        h: th,
        w: th * (0.52 + rng() * 0.16),
        color: SC(theme.tree[layer - 2])
      });
    }
    for (i = 0; i < this.trees.length; i++) {
      var tr = this.trees[i];
      drawPine(g, tr.x, tr.y, tr.h, tr.w, tr.color);
    }

    /* --- 层间雾 --- */
    var mist = g.createLinearGradient(0, 400, 0, 600);
    mist.addColorStop(0, 'rgba(128, 100, 112, 0)');
    mist.addColorStop(0.45, theme.mist);
    mist.addColorStop(1, 'rgba(120, 90, 96, 0)');
    g.fillStyle = mist;
    g.fillRect(0, 400, VIEW_W, 200);

    /* --- 地面 --- */
    var PATH_H = 40;
    g.fillStyle = SC(theme.road);
    g.fillRect(0, GROUND_Y, VIEW_W, PATH_H);
    g.fillStyle = SC(theme.roadDark);
    g.fillRect(0, GROUND_Y + PATH_H, VIEW_W, VIEW_H - GROUND_Y - PATH_H);

    g.fillStyle = theme.edge;
    g.fillRect(0, GROUND_Y, VIEW_W, 2.5);
    g.fillStyle = 'rgba(255, 217, 168, 0.18)';
    g.fillRect(0, GROUND_Y + 2.5, VIEW_W, 1);
    g.fillStyle = 'rgba(255, 217, 168, 0.07)';
    g.fillRect(0, GROUND_Y + PATH_H, VIEW_W, 1);

    /* 路面碎石 */
    for (i = 0; i < 64; i++) {
      var rx = rng() * VIEW_W;
      var ry = GROUND_Y + 10 + rng() * 25;
      var rr = 2.5 + rng() * 7;
      g.fillStyle = SC(theme.road, 1.25);
      g.beginPath();
      g.ellipse(rx, ry, rr, rr * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255, 214, 170, 0.10)';
      g.beginPath();
      g.ellipse(rx, ry - rr * 0.18, rr * 0.74, rr * 0.28, 0, Math.PI, Math.PI * 2);
      g.fill();
    }

    /* 草丛 */
    for (i = 0; i < 120; i++) {
      drawGrass(g, rng() * VIEW_W, GROUND_Y + 1, 9 + rng() * 15, SC(theme.grass));
    }

    /* --- 路灯：每屏两盏，位置由 seed 决定 --- */
    this.lamps = [
      { x: 140 + rng() * 130, h: 158 + rng() * 20 },
      { x: 1010 + rng() * 130, h: 158 + rng() * 20 }
    ];

    this.fgPhase = Math.floor(rng() * 2048);
  };

  /* ---------------- init ---------------- */
  WorldScene.prototype.init = function (ctx, opts) {
    var self = this;
    opts = opts || {};
    this.ctx = ctx;
    this.t = 0;
    /* 尊重系统「减少动态效果」：星光呼吸 / 尘埃飘动改为静态 */
    this.reduceMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

    this.grain = buildGrain();
    this.vignette = buildVignette();
    this.grainPattern = ctx.createPattern(this.grain, 'repeat');
    this.lampGlow = makeGlow('#ffca8a', 256);

    rebuildScenes();

    /* 自建内容也要能存进存档：把它们的 id 补进白名单 */
    if (global.Save && global.Save.allow) {
      var ids = [];
      for (var s = 0; s < SCENES.length; s++) ids.push(SCENES[s].id);
      global.Save.allow(ids);
    }

    var saved = (global.Save && global.Save.get) ? global.Save.get() : null;
    var idx = -1;
    /* 双返回「回上一级」：从 iframe 壳回来时指定 sceneId，优先于存档落点 */
    if (opts.sceneId) idx = sceneIndexById(opts.sceneId);
    if (idx < 0) idx = (saved && saved.zone) ? sceneIndexById(saved.zone) : -1;
    if (idx < 0) idx = sceneIndexById('plaza');

    this.setScene(idx);

    this.player = new global.Player(300, GROUND_Y);
    this.player.groundY = GROUND_Y;
    /* 允许走出 [40,1240]：越界那一帧会被 update 抓去做换屏 */
    this.player.bounds = { min: 0, max: VIEW_W };

    this.seedMotes();

    /* ---- 读档：回到上次的屏与位置（「回上一级」时优先用 opts 里的 px/pf） ---- */
    if (opts.sceneId && isFinite(opts.px)) {
      this.player.x = clamp(opts.px, EDGE_L, EDGE_R);
      this.player.facing = opts.pf === -1 ? -1 : 1;
      this.player.y = GROUND_Y;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.onGround = true;
    } else if (saved && saved.player) {
      this.player.x = clamp(saved.player.x, EDGE_L, EDGE_R);
      this.player.facing = saved.player.facing;
      this.player.y = GROUND_Y;
      this.player.vx = 0;
      this.player.vy = 0;
      this.player.onGround = true;
    } else {
      this.player.x = this.scene.kind === 'plaza' ? 640 : 300;
    }

    /* 首帧就把镜头放到位，别从 x=0 滑过来 */
    if (this.cam) this.cam.snap(this.player);

    this.near = null;
    this.npcNear = false;

    this._onKey = function (e) { self.onKey(e); };
    this._onClick = function () {
      if (self.intro > 0) self.intro = 0;
    };
    global.addEventListener('keydown', this._onKey);
    if (global.SceneManager && global.SceneManager.canvas) {
      global.SceneManager.canvas.addEventListener('pointerdown', this._onClick);
    }

    /* 设置面板改完背景 / 打开帮助 / 自建内容开关 —— 都用自定义事件串起来 */
    this._onBg = function (e) {
      var id = e && e.detail && e.detail.sceneId;
      if (!id || (self.scene && id === self.scene.id)) {
        self._photoFail = '';
        self.bakeBg();
      }
    };
    this._onHelp = function () { self.help = true; };
    this._onContrib = function () { self.refreshScenes(); };

    global.addEventListener('wh:bg', this._onBg);
    global.addEventListener('wh:help', this._onHelp);
    global.addEventListener('wh:contrib', this._onContrib);

    this.intro = 2.5;
    this.help = false;
    this.veil = 0;
    this.zoneT = 1.6;
    this.edgeT = 0;
    this.edgeLockL = false;
    this.edgeLockR = false;
    this._frozen = false;
    this.prevGround = this.player.onGround;
    this.prevVy = this.player.vy;

    if (global.HUD) global.HUD.toast('');
  };

  WorldScene.prototype.seedMotes = function () {
    this.motes.length = 0;
    var rng = mulberry32((this.scene.seed || 1) + 77);
    for (var i = 0; i < 46; i++) {
      this.motes.push({
        x: rng() * VIEW_W,
        y: 150 + rng() * 420,
        r: 1 + rng() * 2.1,
        v: 6 + rng() * 20,
        p: rng() * Math.PI * 2,
        amp: 12 + rng() * 34,
        s: 0.4 + rng() * 0.9
      });
    }
  };

  /* 自建内容开关后重排场景表，并尽量停在原来那屏 */
  WorldScene.prototype.refreshScenes = function () {
    var curId = this.scene ? this.scene.id : 'plaza';
    rebuildScenes();
    if (global.Save && global.Save.allow) {
      var ids = [];
      for (var i = 0; i < SCENES.length; i++) ids.push(SCENES[i].id);
      global.Save.allow(ids);
    }
    var idx = sceneIndexById(curId);
    if (idx < 0) idx = sceneIndexById('plaza');
    this.setScene(idx);
    if (this.player) {
      this.player.x = clamp(this.player.x, EDGE_L, EDGE_R);
      this.player.vx = 0;
      if (this.cam) this.cam.snap(this.player);
    }
    if (global.HUD) global.HUD.toast('');
  };

  WorldScene.prototype.openSettings = function () {
    if (!global.Settings) return;
    global.Settings.open(this.scene.id, this.scene.title);
    if (global.Input && global.Input.reset) global.Input.reset();
    sfx('ui');
  };

  /* ---------------- 键盘 ---------------- */
  WorldScene.prototype.onKey = function (e) {
    /* 任何浮层开着，键盘全归它，这里不接 */
    if ((global.GatePanel && global.GatePanel.isOpen()) ||
        (global.Settings && global.Settings.isOpen()) ||
        (global.Riddle && global.Riddle.Panel && global.Riddle.Panel.isOpen())) return;

    var npc = this.npc;

    if (e.code === 'KeyH') {
      e.preventDefault();
      this.help = !this.help;
      sfx('ui');
      return;
    }

    if (e.code === 'KeyO') {
      e.preventDefault();
      this.openSettings();
      return;
    }

    if (e.code === 'Escape') {
      if (this.help) { e.preventDefault(); this.help = false; sfx('ui'); return; }
      if (npc && npc.state === 'talking') { e.preventDefault(); npc.closeDialog(); sfx('ui'); }
      return;
    }

    /* 开场还没走完：E / 空格 / 回车 先把它跳掉（不 return，空格该跳还是得跳） */
    if (this.intro > 0 &&
        (e.code === 'KeyE' || e.code === 'Space' ||
         e.code === 'Enter' || e.code === 'NumpadEnter')) {
      this.intro = 0;
      sfx('ui');
    }

    if (e.code !== 'KeyE') return;
    e.preventDefault();

    /* E 的优先级写死：对话 > 总门 > 进门 */
    if (npc && npc.state === 'talking') {
      npc.advance();
      sfx('talk');
      return;
    }
    if (npc && this.npcNear) {
      npc.openDialog();
      sfx('talk');
      return;
    }
    if (this.near) this.useDoor(this.near);
  };

  /* ---------------- 门 / 总门 ---------------- */
  WorldScene.prototype.useDoor = function (d) {
    if (!d) return;
    if (d.isGate) { this.openGate(d.cat); return; }
    if (d.isNotice) {
      if (global.Riddle && global.Riddle.Panel) {
        global.Riddle.Panel.open();
      } else if (global.HUD) {
        global.HUD.toast('每日一题模块没加载');
      }
      return;
    }
    this.enterDoor(d);
  };

  WorldScene.prototype.enterDoor = function (d) {
    if (!d || !d.src) return;
    this.remember();
    if (global.Stats && global.Stats.count) global.Stats.count('door');
    sfx('portal');
    if (global.HUD) global.HUD.toast('');
    if (global.SceneManager && global.SceneManager.has('iframe')) {
      global.SceneManager.change('iframe', {
        title: d.name, src: d.src,
        from: this.scene ? this.scene.id : 'plaza',
        px: this.player ? this.player.x : 0,
        pf: this.player ? this.player.facing : 1,
        cross: d.cross === true
      });
    } else if (global.HUD) {
      global.HUD.toast('场景壳（iframeScene.js）没加载，进不去');
    }
  };

  WorldScene.prototype.openGate = function (cat) {
    var self = this;
    if (!global.GatePanel) return;
    var items = catalog(cat);
    if (!items.length) {
      if (global.HUD) global.HUD.toast(CAT_NAME[cat] + '还没有内容');
      return;
    }
    global.GatePanel.open({
      cat: cat,
      items: items,
      onPick: function (it) { self.teleportTo(it); },
      onClose: function () { sfx('ui'); }
    });
    sfx('ui');
  };

  /* 传送：落到区块正中，面朝门 */
  WorldScene.prototype.teleportTo = function (it) {
    var idx = sceneIndexById(it.id);
    if (idx < 0) return;

    if (global.Stats && global.Stats.count) global.Stats.count('teleport');
    this.setScene(idx);

    this.player.x = TELEPORT_X;
    this.player.y = GROUND_Y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = true;
    this.player.facing = it.cat === 'tools' ? -1 : 1;

    /* 传送是瞬移：镜头直接归位，不要横穿整屏 */
    if (this.cam) this.cam.snap(this.player);

    this.near = null;
    this.npcNear = false;
    this.edgeT = 0;
    this.zoneT = 2.0;
    this.veil = 1;
    this.edgeLockL = false;
    this.edgeLockR = false;

    this.remember();
    sfx('portal');
  };

  /* 从区块回广场：按类别落偏左 / 偏右 */
  WorldScene.prototype.enterPlaza = function () {
    var cat = this.scene.cat;
    var idx = sceneIndexById('plaza');
    if (idx < 0) return;

    this.setScene(idx);

    this.player.x = PLAZA_LAND[cat] || 640;
    this.player.y = GROUND_Y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = true;
    this.player.facing = cat === 'tools' ? 1 : -1;

    if (this.cam) this.cam.snap(this.player);

    this.near = null;
    this.npcNear = false;
    this.edgeT = 0;
    this.zoneT = 1.8;
    this.veil = 1;
    this.edgeLockL = false;
    this.edgeLockR = false;

    this.remember();
    sfx('portal');
  };

  WorldScene.prototype.remember = function () {
    if (!this.player || !this.scene) return;
    if (global.Save && global.Save.setPlayer) {
      global.Save.setPlayer(this.player.x, this.player.facing, this.scene.id);
    }
    if (global.Stats && global.Stats.hit) global.Stats.hit(this.scene.id);
  };

  /* ---------------- 换屏 ----------------
   * 区块：任意一侧出去都回广场。
   * 走道（三屏）：按 WALK 前后走，到头就夹住并提示「已到尽头」。
   * 方向锁防止「按住方向键 → 每帧都触发」的提示与音效风暴，回走 60px 解锁。
   */
  WorldScene.prototype.tryEdge = function (dir) {
    if (this.scene.kind === 'zone') {
      this.enterPlaza();
      return;
    }

    var wi = WALK.indexOf(this.scene.id);
    var ni = wi + dir;

    if (wi < 0 || ni < 0 || ni >= WALK.length) {
      this.player.x = dir < 0 ? EDGE_L : EDGE_R;
      this.player.vx = 0;
      this.edgeT = 0.6;
      if (dir < 0) this.edgeLockL = true; else this.edgeLockR = true;
      sfx('miss');
      return;
    }

    var target = sceneIndexById(WALK[ni]);
    if (target < 0) return;

    this.setScene(target);

    this.player.x = dir < 0 ? EDGE_R : EDGE_L;
    this.player.y = GROUND_Y;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.onGround = true;

    if (this.cam) this.cam.snap(this.player);

    this.near = null;
    this.npcNear = false;
    this.edgeT = 0;
    this.zoneT = 1.8;
    this.veil = 1;
    this.edgeLockL = false;
    this.edgeLockR = false;

    this.remember();
    sfx('portal');
  };

  /* ---------------- update ---------------- */
  WorldScene.prototype.update = function (dt) {
    this.t += dt;

    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt);
    if (this.veil > 0) this.veil = Math.max(0, this.veil - dt * 2.6);
    if (this.zoneT > 0) this.zoneT = Math.max(0, this.zoneT - dt);
    if (this.edgeT > 0) this.edgeT = Math.max(0, this.edgeT - dt);

    /* 浮层打开：角色冻结，提示条清空，只留动画时间在走 */
    var frozen = (global.GatePanel && global.GatePanel.isOpen()) ||
                 (global.Settings && global.Settings.isOpen()) ||
                 (global.Riddle && global.Riddle.Panel && global.Riddle.Panel.isOpen());
    if (frozen) {
      if (!this._frozen) {
        this._frozen = true;
        if (global.Input && global.Input.reset) global.Input.reset();
      }
      this.near = null;
      this.npcNear = false;
      if (this.npc && this.npc.state === 'talking') this.npc.closeDialog();
      if (global.HUD) global.HUD.toast('');
      return;
    }
    this._frozen = false;

    if (global.Stats && global.Stats.seeTime) global.Stats.seeTime(dt);

    var prevGround = this.prevGround;

    this.player.update(dt, this);

    /* 镜头跟随：指数平滑，帧率无关；换屏 / 传送处会 snap 直接归位 */
    if (this.cam) this.cam.follow(this.player, dt);

    if (prevGround && this.player.vy < -60) {
      sfx('jump');
      if (global.Stats && global.Stats.count) global.Stats.count('jump');
    }
    if (!prevGround && this.player.onGround) sfx('land');
    this.prevGround = this.player.onGround;
    this.prevVy = this.player.vy;

    /* ---- 屏幕边界 ---- */
    if (this.edgeLockL && this.player.x > EDGE_L + 60) this.edgeLockL = false;
    if (this.edgeLockR && this.player.x < EDGE_R - 60) this.edgeLockR = false;

    if (!this.edgeLockL && this.player.x <= EDGE_L && this.player.facing < 0) {
      this.tryEdge(-1);
    } else if (!this.edgeLockR && this.player.x >= EDGE_R && this.player.facing > 0) {
      this.tryEdge(1);
    }

    /* 尘埃漂浮 */
    var m, i;
    for (i = 0; i < this.motes.length; i++) {
      m = this.motes[i];
      m.y -= m.v * dt;
      m.x += Math.sin(this.t * m.s + m.p) * m.amp * dt;
      if (m.y < 120) { m.y = 600; m.x = Math.random() * VIEW_W; }
      if (m.x < -20) m.x = VIEW_W + 20;
      if (m.x > VIEW_W + 20) m.x = -20;
    }

    /* ---- NPC ---- */
    var npc = this.npc;
    var npcNear = false;
    if (npc) {
      npc.update(dt);
      npcNear = Math.abs(this.player.x - npc.x) <= NPC_RANGE && this.player.onGround;

      if (npc.state === 'talking') {
        if (Math.abs(this.player.x - npc.x) > 120) npc.closeDialog();
      } else if (npcNear) {
        npc.state = 'prompt';
      } else if (npc.state === 'prompt') {
        npc.state = 'idle';
      }
      this.npcNear = npcNear;
    }

    /* ---- 门 / 总门：只标记 near，不自动进 ---- */
    var hit = null;
    var d = this.scene.door;
    if (d && Math.abs(this.player.x - d.x) < DOOR_HIT) hit = d;
    this.near = hit;

    /* ---- 底部提示条 ---- */
    if (global.HUD) {
      var msg = '';
      if (npc && npc.state === 'talking') {
        msg = '';
      } else if (npcNear) {
        msg = '按 E 与' + npc.name + '说话';
      } else if (hit) {
        msg = hit.isNotice ? '按 E 看今天的题'
          : hit.isGate ? '按 E 打开《' + hit.name + '》列表' : '按 E 进入《' + hit.name + '》';
      } else if (this.edgeT > 0) {
        msg = this.scene.kind === 'zone'
          ? '已到尽头'
          : (this.scene.id === 'gate-tools' ? '已到尽头 · 左边没有路了' : '已到尽头 · 右边没有路了');
      } else if (this.zoneT > 0) {
        if (this.scene.kind === 'plaza') msg = '中心广场 · 左工具 · 右游戏';
        else if (this.scene.kind === 'gate') {
          msg = this.scene.title + ' · 走出' + (this.scene.cat === 'tools' ? '右' : '左') + '边缘回广场';
        } else {
          msg = CAT_NAME[this.scene.cat] + ' · ' + this.scene.title;
        }
      } else if (this.scene.kind === 'zone') {
        msg = '走出画面边缘回广场 · 站到门边按 E 进入';
      }
      global.HUD.toast(msg);
    }
  };

  /* ---------------- render ---------------- */
  WorldScene.prototype.render = function (ctx) {
    var i;

    /* ================= 世界层：拉近一倍 + 镜头平移 =================
       scale 叠在 SceneManager 的 DPR 变换之上；窗口 640×360 → 画布 1280×720。
       窗口纵向 [206, 566]：地面线正好落在屏幕底边（屏内 y=720）。 */
    ctx.save();
    ctx.scale(CAM_SCALE, CAM_SCALE);
    if (this.cam) this.cam.begin(ctx);
    else ctx.translate(0, -CAM_Y);

    if (this.bg) ctx.drawImage(this.bg, 0, 0, VIEW_W, VIEW_H);
    else {
      ctx.fillStyle = '#0a0814';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    var dn = global.DayNight ? global.DayNight.state() : null;

    /* 星（会呼吸，夜里更亮） */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      if (s.y < CAM_Y - 8 || s.y > GROUND_Y + 8) continue;   /* 视野外不画 */
      var a = (this.reduceMotion ? 0.42 : (0.18 + 0.5 * Math.abs(Math.sin(this.t * s.s + s.p)))) * (dn ? dn.star : 1);
      if (a < 0.03) continue;
      ctx.fillStyle = 'rgba(255, 236, 210, ' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* 路灯 + 光晕（白天熄灯） */
    if (dn && dn.lamp) {
      for (i = 0; i < this.lamps.length; i++) {
        drawLamp(ctx, this.lamps[i].x, GROUND_Y + 4, this.lamps[i].h);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < this.lamps.length; i++) {
        var lq = this.lamps[i];
        var flicker = 0.82 + Math.sin(this.t * 2.3 + lq.x) * 0.06;
        ctx.globalAlpha = 0.5 * flicker;
        ctx.drawImage(this.lampGlow, lq.x - 130, GROUND_Y + 4 - lq.h - 132, 260, 260);
      }
      ctx.restore();
    }

    /* 静态层：路标牌 / 走道口 / 名录板（换屏时一次性烘焙） */
    if (this.staticLayer) ctx.drawImage(this.staticLayer, 0, 0, VIEW_W, VIEW_H);

    /* 告示牌（每日一题，微微呼吸） */
    if (this.scene.door && this.scene.door.isNotice) this.drawNotice(ctx);

    /* 门 */
    if (this.scene.door && !this.scene.door.isNotice) this.drawPortal(ctx, this.scene.door);

    /* NPC + 角色 */
    if (this.npc) this.npc.render(ctx);
    if (this.player) this.player.render(ctx);

    /* 尘埃（减少动态时整层不画，省一次 lighter 合成） */
    if (!this.reduceMotion) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < this.motes.length; i++) {
        var mo = this.motes[i];
        var ma = 0.10 + 0.30 * Math.abs(Math.sin(this.t * mo.s + mo.p));
        ctx.fillStyle = 'rgba(255, 206, 140, ' + ma.toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(mo.x, mo.y, mo.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /* 前景草叶 */
    this.drawForeground(ctx);

    /* ================= 世界层结束：撤掉镜头与放大 ================= */
    if (this.cam) this.cam.end(ctx);
    ctx.restore();

    /* ---- 覆盖层：按 1280×720 原尺寸画，不放大、不随镜头 ---- */
    /* 暗角 + 纸纹 */
    ctx.drawImage(this.vignette, 0, 0);
    if (this.grainPattern) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    /* 昼夜色调 */
    if (dn && dn.tint) {
      ctx.save();
      ctx.globalAlpha = dn.alpha;
      ctx.fillStyle = dn.tint;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    /* 切换时的一层暖光 */
    if (this.veil > 0) {
      ctx.save();
      ctx.globalAlpha = 0.34 * this.veil;
      ctx.fillStyle = '#f6dcc0';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    /* 覆盖层 */
    if (this.intro > 0) this.drawIntro(ctx);
    if (this.help) this.drawHelp(ctx);
  };

  /* ---------------- 静态层烘焙 ---------------- */
  WorldScene.prototype.bakeStatic = function () {
    if (!this.staticCanvas) {
      this.staticCanvas = document.createElement('canvas');
      this.staticCanvas.width = VIEW_W;
      this.staticCanvas.height = VIEW_H;
    }
    var g = this.staticCanvas.getContext('2d');
    g.clearRect(0, 0, VIEW_W, VIEW_H);
    this.drawSign(g);
    this.drawEdgeCues(g);
    this.drawRoster(g);
    this.staticLayer = this.staticCanvas;
  };

  /* ---------------- 告示牌（每日一题） ---------------- */
  WorldScene.prototype.drawNotice = function (ctx) {
    var d = this.scene.door;
    var x = d.x, base = GROUND_Y + 4;
    var w = d.w || 150, h = d.h || 150;
    var top = base - h;
    var pulse = 0.62 + 0.38 * Math.sin(this.t * 2.0);

    ctx.save();
    /* 支柱 */
    ctx.fillStyle = 'rgba(32, 20, 12, 0.95)';
    ctx.fillRect(x - w / 2 + 8, top - 10, 9, h + 14);
    ctx.fillRect(x + w / 2 - 17, top - 10, 9, h + 14);
    /* 板面 */
    ctx.fillStyle = 'rgba(42, 27, 16, 0.96)';
    roundRect(ctx, x - w / 2, top, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.25)';
    ctx.lineWidth = 1;
    roundRect(ctx, x - w / 2 + 9, top + 9, w - 18, h - 18, 7);
    ctx.stroke();
    /* 挂环 */
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, top - 2, 6, 0, Math.PI * 2);
    ctx.stroke();
    /* 标题 */
    ctx.fillStyle = '#f6dcc0';
    ctx.font = '700 24px ' + SANS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('每日一题', x, top + 44);
    ctx.fillStyle = 'rgba(240, 200, 160, ' + pulse.toFixed(3) + ')';
    ctx.font = '400 15px ' + SANS;
    ctx.fillText('按 E 挑战', x, top + 78);
    ctx.restore();
  };

  /* ---------------- 路标牌 ---------------- */
  WorldScene.prototype.drawSign = function (ctx) {
    var z = this.scene;
    /* 只有广场挂路标：区块屏的门口已经有门牌，总门屏有名录板。
       拉近后一屏只剩 640 宽，再叠一块牌子只会互相挤。 */
    if (z.kind !== 'plaza') return;

    var text = '中心广场 · 左工具 · 右游戏';
    var align = 'center';
    var anchorX = VIEW_W / 2;

    var accent = '#e8b45a';

    ctx.save();
    ctx.font = '600 17px ' + SERIF;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var tw = ctx.measureText(text).width;
    var w = tw + 40;
    var h = 40;
    var bx = align === 'left' ? anchorX : (align === 'right' ? anchorX - w : anchorX - w / 2);
    var by = GROUND_Y - 300;

    ctx.fillStyle = 'rgba(24, 18, 34, 0.96)';
    ctx.fillRect(anchorX - 2.5, by + h, 5, GROUND_Y - by - h + 4);
    /* 杆子对着深色山影几乎是黑的，补一条高光，否则牌子看着像浮在空中 */
    ctx.fillStyle = 'rgba(255, 226, 190, 0.10)';
    ctx.fillRect(anchorX - 2.5, by + h, 1, GROUND_Y - by - h + 4);

    roundRect(ctx, bx, by, w, h, 7);
    ctx.fillStyle = 'rgba(14, 11, 24, 0.9)';
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.45);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 226, 190, 0.35)';
    ctx.beginPath();
    ctx.arc(bx + 9, by + h / 2, 2, 0, Math.PI * 2);
    ctx.arc(bx + w - 9, by + h / 2, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(253, 243, 228, 0.92)';
    ctx.fillText(text, bx + w / 2, by + h / 2 + 1);
    ctx.restore();
  };

  /* ---------------- 广场两端的走道口（只做视觉指引，不是门） ---------------- */
  WorldScene.prototype.drawEdgeCues = function (ctx) {
    if (this.scene.kind !== 'plaza') return;

    var sides = [
      { x: EDGE_L + 30, cat: 'tools', text: '工具区', arrow: 'left' },
      { x: EDGE_R - 30, cat: 'games', text: '游戏区', arrow: 'right' }
    ];

    for (var i = 0; i < sides.length; i++) {
      var s = sides[i];
      var col = CAT_COLOR[s.cat];
      var top = GROUND_Y - 176;

      /* 竖光缝：告诉玩家「这边能走出去」 */
      var seam = ctx.createLinearGradient(0, top, 0, GROUND_Y + 5);
      seam.addColorStop(0, rgba(col, 0));
      seam.addColorStop(0.45, rgba(col, 0.30));
      seam.addColorStop(1, rgba(col, 0.05));
      ctx.fillStyle = seam;
      ctx.fillRect(s.x - 2, top, 4, GROUND_Y + 5 - top);

      /* 脚下的地面亮带 */
      ctx.fillStyle = rgba(col, 0.16);
      ctx.beginPath();
      ctx.ellipse(s.x, GROUND_Y + 3, 40, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      /* 小牌：←工具区 / 游戏区→ */
      ctx.save();
      ctx.font = '600 15px ' + SANS;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var label = s.arrow === 'left' ? '← ' + s.text : s.text + ' →';
      var tw = ctx.measureText(label).width;
      var w = tw + 26;
      var h = 30;
      var bx = Math.max(12, Math.min(VIEW_W - 12 - w, s.x - w / 2));
      var by = top - h - 12;

      roundRect(ctx, bx, by, w, h, 8);
      ctx.fillStyle = 'rgba(10, 8, 18, 0.9)';
      ctx.fill();
      ctx.strokeStyle = rgba(col, 0.42);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = rgba(col, 0.95);
      ctx.fillText(label, bx + w / 2, by + h / 2 + 1);
      ctx.restore();
    }
  };

  /* ---------------- 名录板（总门屏） ---------------- */
  WorldScene.prototype.drawRoster = function (ctx) {
    var z = this.scene;
    if (z.kind !== 'gate') return;

    var items = catalog(z.cat);
    if (!items.length) return;

    var w = 300;
    var rowH = 30;
    var head = 56;
    var padB = 16;
    var h = head + items.length * rowH + padB;
    var x = 850;
    /* 板底抬到角色头顶之上：否则玩家站进板子范围会被压在字上 */
    var bottom = GROUND_Y - 96;
    var y = bottom - h;
    var i;

    /* 两根立柱，一直落到地面 */
    ctx.fillStyle = 'rgba(10, 8, 18, 0.92)';
    ctx.fillRect(x + 26, bottom - 6, 7, GROUND_Y - bottom + 8);
    ctx.fillRect(x + w - 33, bottom - 6, 7, GROUND_Y - bottom + 8);

    /* 板面：不透明度给足，否则背后的落日会把小字吃掉 */
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = 'rgba(11, 8, 18, 0.93)';
    ctx.fill();
    ctx.strokeStyle = rgba(CAT_COLOR[z.cat], 0.38);
    ctx.lineWidth = 1.2;
    ctx.stroke();

    /* 标题 */
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 16px ' + SERIF;
    ctx.fillStyle = 'rgba(253, 243, 228, 0.92)';
    ctx.fillText(CAT_NAME[z.cat], x + 18, y + 26);

    ctx.textAlign = 'right';
    ctx.font = '400 12px ' + SANS;
    ctx.fillStyle = rgba(CAT_COLOR[z.cat], 0.86);
    ctx.fillText(items.length + ' 个区块', x + w - 18, y + 26);

    ctx.strokeStyle = 'rgba(255, 220, 180, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 16, y + 42);
    ctx.lineTo(x + w - 16, y + 42);
    ctx.stroke();

    /* 行 */
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var ry = y + head + i * rowH + rowH / 2;

      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 235, 210, 0.035)';
        ctx.fillRect(x + 8, ry - rowH / 2, w - 16, rowH);
      }

      ctx.textAlign = 'left';
      ctx.font = '400 12px ' + SANS;
      ctx.fillStyle = rgba(it.color || '#9b8afb', 0.95);
      ctx.fillText(String(i + 1), x + 20, ry + 1);

      ctx.font = '500 15px ' + SANS;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.90)';
      ctx.fillText(it.name, x + 40, ry + 1);

      ctx.textAlign = 'right';
      ctx.font = '400 11px ' + SANS;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.54)';
      ctx.fillText(it.desc, x + w - 16, ry + 1);
    }

    ctx.restore();
  };

  /* ---------------- 门 ---------------- */
  WorldScene.prototype.drawPortal = function (ctx, p) {
    var cx = p.x;
    var top = GROUND_Y - p.h;
    var left = cx - p.w / 2;
    var pulse = 0.5 + 0.5 * Math.sin(this.t * 1.6 + (p.x % 7));
    var near = this.near === p;

    if (!p.glow) p.glow = makeGlow(p.color, 256);

    /* 光晕 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.40 + pulse * 0.24 + (near ? 0.26 : 0);
    var gs = (p.isGate ? 380 : 300) + pulse * 24;
    ctx.drawImage(p.glow, cx - gs / 2, GROUND_Y - p.h * 0.5 - gs / 2, gs, gs);
    ctx.restore();

    /* 底座 */
    ctx.fillStyle = '#171226';
    roundRect(ctx, left - (p.isGate ? 24 : 16), GROUND_Y - 12, p.w + (p.isGate ? 48 : 32), 16, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 210, 160, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    /* 总门多两根侧石，把体量撑起来 */
    if (p.isGate) {
      ctx.fillStyle = '#130f20';
      roundRect(ctx, left - 26, top + 42, 14, p.h - 42, 4);
      ctx.fill();
      roundRect(ctx, left + p.w + 12, top + 42, 14, p.h - 42, 4);
      ctx.fill();
      ctx.strokeStyle = rgba(p.color, 0.24);
      ctx.lineWidth = 1;
      roundRect(ctx, left - 26, top + 42, 14, p.h - 42, 4);
      ctx.stroke();
      roundRect(ctx, left + p.w + 12, top + 42, 14, p.h - 42, 4);
      ctx.stroke();
    }

    /* 门框石 */
    archPath(ctx, left, top, p.w, p.h);
    ctx.fillStyle = '#100c1c';
    ctx.fill();

    /* 能量腔 */
    var vx = left + 8;
    var vy = top + 8;
    var vw = p.w - 16;
    var vh = p.h - 8;

    ctx.save();
    archPath(ctx, vx, vy, vw, vh);
    ctx.clip();

    var grd = ctx.createLinearGradient(0, vy, 0, vy + vh);
    grd.addColorStop(0, rgba(p.color, 0.10));
    grd.addColorStop(0.5, rgba(p.color, 0.40));
    grd.addColorStop(1, rgba(p.color, 0.14));
    ctx.fillStyle = grd;
    ctx.fillRect(vx, vy, vw, vh);

    for (var k = 0; k < 6; k++) {
      var yy = vy + vh - ((this.t * 30 + k * 40 + p.x * 0.3) % (vh + 60));
      ctx.fillStyle = rgba(p.color, 0.13);
      ctx.fillRect(vx, yy, vw, 5);
    }

    var core = ctx.createRadialGradient(cx, vy + vh * 0.55, 0, cx, vy + vh * 0.55, vw * 0.8);
    core.addColorStop(0, 'rgba(255, 255, 255, ' + (0.10 + pulse * 0.10).toFixed(3) + ')');
    core.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(vx, vy, vw, vh);

    ctx.restore();

    /* 图腾 */
    drawGlyph(ctx, p.glyph, cx, top + (p.isGate ? 118 : 104), this.t);

    /* 边框 */
    archPath(ctx, left, top, p.w, p.h);
    ctx.strokeStyle = 'rgba(255, 226, 190, 0.18)';
    ctx.lineWidth = 3;
    ctx.stroke();

    archPath(ctx, vx, vy, vw, vh);
    ctx.strokeStyle = rgba(p.color, near ? 0.95 : 0.5 + pulse * 0.28);
    ctx.lineWidth = 2;
    ctx.stroke();

    /* 名牌：名字 + 说明合成一块卡片 */
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '600 21px ' + SERIF;
    var nw = ctx.measureText(p.name).width;
    ctx.font = '400 12px ' + SANS;
    var dw = ctx.measureText(p.desc).width;
    var cw = Math.max(nw, dw) + 36;
    var ch = 56;
    var cy0 = top - 30 - ch;

    roundRect(ctx, cx - cw / 2, cy0, cw, ch, 12);
    // 0.78 太透：落日正好落在门上方时，说明文字会被亮圆冲成一片糊，这里转实底
    ctx.fillStyle = 'rgba(10, 8, 18, 0.94)';
    ctx.fill();
    ctx.strokeStyle = rgba(p.color, 0.40);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#fdf3e4';
    ctx.font = '600 21px ' + SERIF;
    ctx.fillText(p.name, cx, cy0 + 20);

    ctx.font = '400 12px ' + SANS;
    ctx.fillStyle = rgba(p.color, 0.92);
    ctx.fillText(p.desc, cx, cy0 + 42);
    ctx.restore();

    /* 站在门前：地面提示环 + 一枚 E 键帽 */
    if (near) {
      ctx.save();
      ctx.strokeStyle = rgba(p.color, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, GROUND_Y + 2, 52 + Math.sin(this.t * 4) * 3, 11, 0, 0, Math.PI * 2);
      ctx.stroke();

      var capY = top - 30 - 56 - 14 - 15;
      roundRect(ctx, cx - 15, capY - 15, 30, 30, 8);
      ctx.fillStyle = 'rgba(9, 7, 16, 0.86)';
      ctx.fill();
      ctx.strokeStyle = rgba(p.color, 0.85);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 16px ' + SANS;
      ctx.fillStyle = p.color;
      ctx.fillText('E', cx, capY + 1);
      ctx.restore();
    }
  };

  /* ---------------- 前景草叶 ----------------
   * 拉近后窗口下沿就是地面线（566），原来画在地面以下的草叶会整个跑到画面外，
   * 所以草根统一压到地面线上，只留一窄条剪影；视差改成跟镜头走。
   */
  WorldScene.prototype.drawForeground = function (ctx) {
    var layers = [
      { f: 1.12, base: 570, h0: 8, h1: 22, step: 47, skip: 6 },
      { f: 1.34, base: 574, h0: 14, h1: 40, step: 133, skip: 9 }
    ];
    var span = 2048;
    var theme = THEME[this.scene.themeKey] || THEME.center;
    var camX = this.cam ? this.cam.x : 0;

    for (var li = 0; li < layers.length; li++) {
      var L = layers[li];
      var off = -(((camX * L.f + this.fgPhase * 0.35) % span + span) % span);
      ctx.fillStyle = li === 0 ? shade(theme.grass, 0.9) : '#050309';
      ctx.beginPath();
      for (var i = 0; i < 52; i++) {
        if ((i * 7 + li * 3) % L.skip === 0) continue;
        var jitter = ((i * 29) % 41) - 20;
        var bx = ((i * L.step + jitter + off) % span + span) % span - 300;
        if (bx < -70 || bx > VIEW_W + 70) continue;
        var h = L.h0 + ((i * 37 + li * 23) % Math.max(1, L.h1 - L.h0));
        var lean = ((i * 13) % 9) - 4;
        ctx.moveTo(bx - 10, L.base);
        ctx.quadraticCurveTo(bx - 3 + lean * 0.5, L.base - h * 0.6, bx + lean, L.base - h);
        ctx.quadraticCurveTo(bx + 6 + lean * 0.4, L.base - h * 0.45, bx + 11, L.base);
        ctx.closePath();
        if (i % 4 === 0) {
          ctx.moveTo(bx + 8, L.base);
          ctx.quadraticCurveTo(bx + 5, L.base - h * 0.3, bx - 2, L.base - h * 0.5);
          ctx.quadraticCurveTo(bx + 2, L.base - h * 0.28, bx + 1, L.base);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
  };

  /* ---------------- 开场标题卡 ---------------- */
  WorldScene.prototype.drawIntro = function (ctx) {
    var k = this.intro;
    var p = 1 - k / 2.5;
    var a = Math.min(1, p / 0.2) * Math.min(1, k / 0.6);
    if (a <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = a;

    var veil = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 40, VIEW_W / 2, VIEW_H / 2, 760);
    veil.addColorStop(0, 'rgba(5, 4, 11, 0.94)');
    veil.addColorStop(0.62, 'rgba(5, 4, 11, 0.86)');
    veil.addColorStop(1, 'rgba(5, 4, 11, 0.52)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    var cx = VIEW_W / 2;
    var cy = VIEW_H / 2 - 10;

    ctx.strokeStyle = 'rgba(240, 167, 110, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 210, cy - 74);
    ctx.lineTo(cx + 210, cy - 74);
    ctx.moveTo(cx - 210, cy + 74);
    ctx.lineTo(cx + 210, cy + 74);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(255, 217, 168, 0.62)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('游 戏 合 集', cx, cy - 100);

    ctx.fillStyle = '#fdf3e4';
    ctx.font = '600 62px ' + SERIF;
    ctx.shadowColor = 'rgba(240, 167, 110, 0.30)';
    ctx.shadowBlur = 42;
    ctx.fillText('世界大厅', cx, cy - 24);
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(253, 243, 228, 0.62)';
    ctx.font = '400 17px ' + SANS;
    ctx.fillText('广场左右各一座总门 · ' + ZONE_COUNT + ' 个区块传送抵达', cx, cy + 30);

    ctx.globalAlpha = a * Math.min(1, k / 0.6);
    ctx.fillStyle = 'rgba(255, 217, 168, 0.72)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('按 E / 空格 / 回车 跳过', cx, VIEW_H - 74);

    ctx.restore();
  };

  /* ---------------- 帮助面板 ---------------- */
  WorldScene.prototype.drawHelp = function (ctx) {
    var w = 860;
    var rowH = 44;
    var h = 116 + HELP_ROWS.length * rowH + 44;
    var x = (VIEW_W - w) / 2;
    var y = (VIEW_H - h) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(5, 4, 11, 0.74)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.shadowColor = 'rgba(3, 2, 7, 0.72)';
    ctx.shadowBlur = 44;
    ctx.shadowOffsetY = 20;
    roundRect(ctx, x, y, w, h, 20);
    ctx.fillStyle = 'rgba(19, 14, 32, 0.96)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    roundRect(ctx, x, y, w, h, 20);
    ctx.strokeStyle = 'rgba(240, 167, 110, 0.46)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    var cx = VIEW_W / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fdf3e4';
    ctx.font = '600 32px ' + SERIF;
    ctx.fillText('操作说明', cx, y + 48);

    ctx.fillStyle = 'rgba(253, 243, 228, 0.34)';
    ctx.font = '400 13px ' + SANS;
    ctx.fillText('全部按键一览', cx, y + 78);

    ctx.strokeStyle = 'rgba(240, 167, 110, 0.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 56, y + 98);
    ctx.lineTo(x + w - 56, y + 98);
    ctx.stroke();

    var top = y + 98 + rowH * 0.5 + 8;
    for (var i = 0; i < HELP_ROWS.length; i++) {
      var ry = top + i * rowH;
      var label = HELP_ROWS[i][0];

      ctx.textAlign = 'right';
      ctx.font = '600 16px ' + SANS;
      ctx.fillStyle = label ? 'rgba(255, 217, 168, 0.92)' : 'rgba(255, 217, 168, 0.28)';
      ctx.fillText(label || '·', x + 176, ry);

      ctx.textAlign = 'left';
      ctx.font = '400 15px ' + SANS;
      ctx.fillStyle = 'rgba(253, 243, 228, 0.78)';
      ctx.fillText(HELP_ROWS[i][1], x + 200, ry);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(253, 243, 228, 0.42)';
    ctx.font = '400 14px ' + SANS;
    ctx.fillText('H 或 Esc 关闭', cx, y + h - 30);

    ctx.restore();
  };

  /* ---------------- destroy ---------------- */
  WorldScene.prototype.destroy = function () {
    if (this._onKey) global.removeEventListener('keydown', this._onKey);
    if (this._onClick && global.SceneManager && global.SceneManager.canvas) {
      global.SceneManager.canvas.removeEventListener('pointerdown', this._onClick);
    }
    if (this._onBg) global.removeEventListener('wh:bg', this._onBg);
    if (this._onHelp) global.removeEventListener('wh:help', this._onHelp);
    if (this._onContrib) global.removeEventListener('wh:contrib', this._onContrib);

    this._onKey = null;
    this._onClick = null;
    this._onBg = null;
    this._onHelp = null;
    this._onContrib = null;

    this.intro = 0;
    this.help = false;

    if (this.npc) this.npc.reset();

    this.stars.length = 0;
    this.motes.length = 0;
    this.trees.length = 0;
    this.lamps.length = 0;
    this.player = null;
    this.npc = null;
    this.near = null;
    this.bg = null;
    this.bgScene = '';
    this._photo = null;
    this._photoSrc = '';
    if (global.HUD) global.HUD.toast('');
  };

  /* 供外部（探针 / 设置 / README）读取的入口 */
  rebuildScenes();
  WorldScene.ITEMS = ITEMS;
  WorldScene.SCENES = SCENES;
  WorldScene.WALK = WALK;
  WorldScene.NPC_LINES = NPC_LINES;
  WorldScene.EDGE_L = EDGE_L;
  WorldScene.EDGE_R = EDGE_R;
  WorldScene.GROUND_Y = GROUND_Y;
  WorldScene.catalog = catalog;
  WorldScene.rebuild = rebuildScenes;
  WorldScene.indexOf = sceneIndexById;

  global.WorldScene = WorldScene;
})(window);
