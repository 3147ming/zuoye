/* ============================================================
 * server/games/index.js —— 联机玩法注册表
 * ------------------------------------------------------------
 * 每个玩法模块导出 { meta, create(ctx) }，ctx 提供：
 *   seed / random() / players[] / room / send(type, data, toId)
 * 游戏对象需要实现：
 *   onInput(player, data)   高频输入（每帧可达）
 *   onAction(player, data)  一次性动作（开炮 / 落子 / 答题）
 *   step(dt, tick)          推进逻辑
 *   snapshot(tick)          返回这一帧要广播的增量（返回 null 则跳过）
 *   result(tick)            返回结算对象则本局结束
 *   onLeave(player)         玩家离开（可选）
 * ============================================================ */
'use strict';

var MODULES = {
  bounce: require('./bounce'),
  balloon: require('./balloon'),
  tank: require('./tank'),
  snakebattle: require('./snakebattle'),
  quiz: require('./quiz'),
  draw: require('./draw'),
  pitch: require('./pitch'),
  duel: require('./duel'),
  fist: require('./fist')
};

/* 前端要展示的目录信息（顺序 = 大厅里的排序） */
var CATALOG = [
  { id: 'bounce', name: '咱俩碰碰', tag: '碰撞竞技', players: '2–4 人', glyph: 'bounce',
    desc: '3 张场地 + 4 种道具 + 冲刺，把对手撞下血线', color: '#ff7a7a' },
  { id: 'balloon', name: '泡泡堂', tag: '放泡炸箱', players: '2–4 人', glyph: 'balloon',
    desc: '3 套迷宫，炸箱掉道具，泡泡数与火力越滚越大', color: '#7ec8ff' },
  { id: 'tank', name: '坦克大战', tag: '射击对战', players: '2–4 人', glyph: 'tank',
    desc: '3 张战场，砖墙可打碎，捡补给先拿 5 分', color: '#ffd166' },
  { id: 'snakebattle', name: '贪吃蛇大作战', tag: '长大撞人', players: '2–4 人', glyph: 'snakebattle',
    desc: '金果加三节、加速果冲一段，还能烧身长换爆发', color: '#8ff0b5' },
  { id: 'quiz', name: '抢答赛', tag: '同时开抢', players: '2–4 人', glyph: 'quiz',
    desc: '108 道题 · 10 个分类 · 连对加成', color: '#c0a5ff' },
  { id: 'draw', name: '你画我猜', tag: '画板传话', players: '2–4 人', glyph: 'draw',
    desc: '轮流当画者，96 个词，猜得越快分越高', color: '#ff9f9f' },
  { id: 'pitch', name: '球场 2v2', tag: '带球射门', players: '2–4 人', glyph: 'pitch',
    desc: '推球带球射门，先进 3 球；草地与冰面两种手感 · 全流程客户端预测', color: '#7ee0c0' },
  { id: 'duel', name: '弹弹岛对战', tag: '抛物线对轰', players: '2–4 人', glyph: 'bounce',
    desc: '真人轮流开炮：重力+横风抛物线，炸人扣血、落海出局，3 张场地 + 巡逻气球', color: '#ffd166' },
  { id: 'fist', name: '招式格斗', tag: '轻快对轰', players: '2 人', glyph: 'fight',
    desc: 'Q 版格斗：跳跃+拳脚+三个专属技能，把对手血打空，三局两胜', color: '#ff9f6e' }
];

function get(id) {
  return MODULES[id] || null;
}

function list() {
  return CATALOG.map(function (c) {
    return Object.assign({}, c);
  });
}

module.exports = { get: get, list: list, ids: Object.keys(MODULES), CATALOG: CATALOG };
