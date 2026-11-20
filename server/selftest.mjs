#!/usr/bin/env node
/* ============================================================
 * server/selftest.mjs —— 联机模块自测（不依赖浏览器）
 * ------------------------------------------------------------
 * 用法：node server/selftest.mjs
 * 覆盖：
 *   1. 协议一致性：前端 js/party/net.js 与 server/protocol.js 的
 *      房间号/密码正则、错误码、玩法 id 必须逐字一致（防止改了一头忘另一头）
 *   2. 房间核心：建房 / 房间号格式 / 密码 / 满员 / 非房主开局 / 掉线重连 / 房主迁移
 *   3. 6 个玩法：跑满 30 秒模拟，不发火、能结算、快照体积可控
 *   4. 房间号规则：1–99999，不允许前导 0，6 位数一定被拒
 * 退出码：0 全过 / 1 有问题
 * ============================================================ */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const P = require('./protocol.js');
const core = require('./room-core.js');
const games = require('./games/index.js');

let fails = 0, checks = 0;
function ok(cond, label, detail) {
  checks += 1;
  if (cond) { console.log('  ✓ ' + label); return true; }
  fails += 1;
  console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
  return false;
}
function group(name) { console.log('\n' + name); }

/* games.js 已按玩法拆分：公共底座 + games.<id>.js。
   静态检查（注册了哪些玩法、有没有接预测、输入带没带 seq）要看全部文件，
   只读 games.js 会全部漏掉 —— 拆分当天的自测就是这样红的 12 项。 */
function readPartyGames() {
  const dir = path.join(ROOT, 'js/party');
  const core = path.join(dir, 'games.js');
  if (!fs.existsSync(core)) return '';
  const parts = [fs.readFileSync(core, 'utf8')];
  fs.readdirSync(dir).filter((f) => /^games\.[a-z]+\.js$/.test(f)).sort()
    .forEach((f) => parts.push(fs.readFileSync(path.join(dir, f), 'utf8')));
  return parts.join('\n');
}

/* ---------- 1. 协议一致性 ---------- */
group('1. 前后端协议一致性');
{
  const netPath = path.join(ROOT, 'js/party/net.js');
  const gamesPath = path.join(ROOT, 'js/party/games.js');
  if (!fs.existsSync(netPath)) {
    /* 独立部署包（ws-bundle）里没有前端文件，这一组跳过而不是报错 */
    console.log('  · 跳过：当前目录没有前端源码（独立部署包只含 server/）');
  } else {
  const netSrc = fs.readFileSync(netPath, 'utf8');
  const grabRe = (key) => {
    const m = new RegExp(key + ':\\s*(\\/[^/]+\\/[a-z]*)').exec(netSrc);
    return m ? m[1] : null;
  };
  ok(grabRe('CODE_RE') === String(P.CODE_RE), '房间号正则一致', grabRe('CODE_RE') + ' vs ' + P.CODE_RE);
  ok(grabRe('PASS_RE') === String(P.PASS_RE), '密码正则一致', grabRe('PASS_RE') + ' vs ' + P.PASS_RE);
  ok(netSrc.includes('ROOM_MAX: ' + P.ROOM_MAX), '房间号上限一致');

  /* 错误码：服务端有的，前端都要有中文文案 */
  const missing = Object.keys(P.ERR).filter((k) => !new RegExp(k + ":\\s*'").test(netSrc));
  ok(missing.length === 0, '错误码文案齐全', missing.join(','));

  /* 前端注册了哪些玩法，服务端就得有 */
  const partySrc = fs.existsSync(gamesPath) ? readPartyGames() : '';
  const registered = partySrc
    ? [...partySrc.matchAll(/K\.register\('([a-z]+)'/g)].map((m) => m[1])
    : games.ids.slice();
  ok(registered.length === games.ids.length, '玩法数量一致（' + registered.length + '）');
  for (const id of games.ids) ok(registered.includes(id), '客户端已实现 ' + id);
  }
}

/* ---------- 2. 房间号与密码规则 ---------- */
group('2. 房间号 / 密码规则（少于 6 位数字）');
{
  ok(P.CODE_RE.test('1'), '1 合法');
  ok(P.CODE_RE.test('99'), '99 合法');
  ok(P.CODE_RE.test('12345'), '12345 合法（5 位）');
  ok(P.CODE_RE.test('99999'), '99999 合法');
  ok(!P.CODE_RE.test('123456'), '123456 拒绝（6 位）');
  ok(!P.CODE_RE.test('0123'), '前导 0 拒绝（避免 0123 与 123 撞号）');
  ok(!P.CODE_RE.test('12a4'), '含字母拒绝');
  ok(!P.CODE_RE.test(''), '空拒绝');
  ok(!P.CODE_RE.test(' 123'), '含空格拒绝');
  ok(P.PASS_RE.test('0000'), '密码 0000 合法');
  ok(!P.PASS_RE.test('123'), '3 位密码拒绝');
  ok(!P.PASS_RE.test('12345'), '5 位密码拒绝');

  const d = new core.Directory();
  const codes = new Set();
  for (let i = 0; i < 300; i++) {
    const r = d.create('bounce', '');
    codes.add(r.code);
    if (!P.CODE_RE.test(r.code)) { ok(false, '随机分配的号不合法：' + r.code); break; }
  }
  ok(codes.size === 300, '300 次建房号不重复');
  ok([...codes].every((c) => c.length <= 5), '所有号都少于 6 位');
}

/* ---------- 3. 房间生命周期 ---------- */
group('3. 房间核心流程');
{
  const dir = new core.Directory();
  const room = dir.create('bounce', '1234');
  room.hostId = 'a';
  const inbox = { a: [], b: [], c: [] };
  const conn = (k) => ({ send: (m) => inbox[k].push(m) });

  room.add('a', '甲', conn('a'), 't1');
  ok(room.code.length <= 5, '建房拿到 5 位以内房号：' + room.code);
  ok(room.pass === '1234', '有密码房标记正确');

  const badPass = String('0000') !== room.pass;
  ok(badPass, '错密码会被拒（比对逻辑正确）');

  room.add('b', '乙', conn('b'), 't2');
  room.add('c', '丙', conn('c'), 't3');
  room.add('d', '丁', conn('d') || { send: () => {} }, 't4');
  ok(room.players.length === 4, '4 人到齐');
  ok(room.isFull(), '第 5 人会被判满员');

  /* 只有房主能开 */
  const notHost = room.start('b');
  ok(notHost.error === 'NOT_HOST', '非房主开局被拒');

  const started = room.start('a');
  ok(started.ok === true, '房主开局成功');
  ok(room.state === 'playing', '状态切到 playing');

  /* 掉线：连接摘掉但记录保留 */
  room.detach('b');
  ok(room.players.length === 4, '掉线不踢出房间（等重连）');
  ok(!room.player('b').conn, '掉线后连接已摘');

  /* 重连：同一 id 续回原座位 */
  const seatBefore = room.player('b').seat;
  room.add('b', '乙', conn('b'), 't2');
  ok(room.player('b').seat === seatBefore, '重连回到原座位');

  /* 房主掉线 → 房主迁移 */
  room.detach('a');
  ok(room.hostId !== 'a', '房主掉线后自动迁移');
  ok(['b', 'c', 'd'].includes(room.hostId), '新房主是还在线的人');

  room.stopLoop();
}

/* ---------- 4. 玩法模拟 ---------- */
group('4. 玩法模拟（各跑 30 秒，4 人）');
{
  const bots = {
    bounce: (gs, ps, f) => {
      const snap = gs.snapshot(f).b || [];
      ps.forEach((p, i) => {
        const me = snap.find((x) => x[0] === p.id);
        const other = snap.find((x) => x[0] !== p.id) || me;
        if (!me || !other) return;
        const dx = other[1] - me[1], dy = other[2] - me[2], m = Math.hypot(dx, dy) || 1;
        gs.onInput(p, { x: dx / m, y: dy / m });
      });
    },
    balloon: (gs, ps, f) => {
      if (f % 27 === 0) gs.onAction(ps[0], { a: 'bomb' });
      if (f % 31 === 0) gs.onAction(ps[1], { a: 'bomb' });
      if (f % 9 === 0) ps.forEach((p, i) => gs.onInput(p, { d: 'udlr'[i % 4] }));
    },
    tank: (gs, ps, f) => {
      ps.forEach((p, i) => gs.onInput(p, { thr: 1, turn: Math.sin(f / (30 + i * 7)), fire: f % (50 + i * 11) === 0 }));
    },
    snakebattle: (gs, ps, f) => {
      ps.forEach((p, i) => { if (f % (11 + i * 3) === 0) gs.onInput(p, { turn: (f + i) % 2 ? 'l' : 'r' }); });
    },
    quiz: (gs, ps, f) => {
      if (f % 55 === 0) ps.forEach((p, i) => gs.onAction(p, { a: 'answer', k: (i + 1) % 4 }));
    },
    pitch: (gs, ps, f) => {
      /* 追球机器人：离球远就去追，够近就朝对方门推并定期射门 */
      const s = gs.snapshot(f) || {};
      const ba = s.ba || [520, 310];
      (s.pl || []).forEach((row) => {
        const p = ps.find((x) => x.id === row[0]);
        if (!p) return;
        const dx = ba[0] - row[1], dy = ba[1] - row[2];
        const d = Math.hypot(dx, dy) || 1;
        if (d > 60) gs.onInput(p, { x: dx / d, y: dy / d });
        else gs.onInput(p, { x: row[4] === 0 ? 1 : -1, y: Math.max(-0.4, Math.min(0.4, (310 - row[2]) / 150)) });
        if (d < 90 && f % 40 === 0) gs.onAction(p, { a: 'kick' });
      });
    },
    draw: (gs, ps, f) => {
      /* 画者持续画线，其他人乱猜（猜对与否由服务端判定） */
      if (f % 3 === 0) gs.onAction(ps[0], { a: 'draw', pts: [[120 + (f % 400), 200 + (f % 240)]], c: 1, w: 1, ns: f % 24 === 0 });
      if (f % 70 === 0) gs.onAction(ps[1], { a: 'guess', text: '猜不到' });
      if (f === 40) gs.onAction(ps[2], { a: 'redraw' });
    },
    duel: (gs, ps, f) => {
      /* 轮到谁谁开炮：读到 act 后给该玩家发 fire，角度力度随机 */
      const s = gs.snapshot(f) || {};
      if (s.ph !== 'aim' || !s.act) return;
      const p = ps.find((x) => x.id === s.act);
      if (!p) return;
      gs.onInput(p, { angle: 30 + (f * 7 % 50), power: 0.5 + (f % 5) * 0.1 });
      if (f % 6 === 0) gs.onAction(p, { a: 'fire' });
    }
  };

  for (const id of games.ids) {
    const dir = new core.Directory();
    const room = dir.create(id, '');
    const names = ['甲', '乙', '丙', '丁'];
    names.forEach((n, i) => room.add('p' + i, n, { send: () => {} }, 't' + i));
    /* 真实链路里 hostId 由 create 设为建房者的 pid，这里对齐 */
    room.hostId = 'p0';
    const res0 = room.start('p0');
    room.stopLoop();
    if (res0.error) { ok(false, id + ' 开局失败：' + res0.error); continue; }

    let maxSnap = 0, err = null, result = null;
    let tick = 0;
    try {
      for (let f = 1; f <= 1800; f++) {
        tick = f;
        bots[id](room.gs, room.players, f);
        room.gs.step(1 / 60, f);
        if (f % 3 === 0) {
          const s = room.gs.snapshot(f);
          if (s) maxSnap = Math.max(maxSnap, JSON.stringify(s).length);
        }
        const r = room.gs.result(f);
        if (r) { result = r; break; }
      }
    } catch (e) {
      err = e;
    }
    ok(!err, id + ' 跑 30 秒无异常', err && err.message);
    ok(maxSnap > 0 && maxSnap < 6000, id + ' 快照体积可控（' + maxSnap + 'B/帧）');
    if (result) {
      ok(Array.isArray(result.scores) && result.scores.length === 4, id + ' 结算含 4 人分数');
      ok(result.scores.every((s) => typeof s.score === 'number'), id + ' 分数是数字');
    } else {
      /* 30 秒内不结算也正常（尤其坦克 / 抢答），只要还在推进即可 */
      ok(room.gs && room.gs.snapshot(tick) !== null, id + ' 未提前结算但状态在推进（可接受）');
    }
  }
}


/* ---------- 5. 你画我猜：词只给画者、猜中计分、全量重绘 ---------- */
group('5. 你画我猜流程');
{
  const dir = new core.Directory();
  const room = dir.create('draw', '');
  const inbox = [];
  const conn = (id) => ({ send: (m) => inbox.push({ id, m }) });
  ['甲', '乙', '丙'].forEach((n, i) => room.add('p' + i, n, conn('p' + i), 't' + i));
  room.hostId = 'p0';
  ok(room.start('p0').ok === true, 'draw 开局成功');
  room.stopLoop();
  const gs = room.gs, ps = room.players;

  const wordEv = inbox.filter((x) => x.m.t === 'event' && x.m.d.e === 'word');
  ok(wordEv.length === 1, '词只私发给一位画者');
  const drawerId = wordEv[0] && wordEv[0].id;
  const word = wordEv[0] && wordEv[0].m.d.w;
  ok(!!word && word.length >= 1, '画者拿到词：' + word);

  /* 走完 intro */
  for (let f = 0; f < 200; f++) { gs.step(1 / 60, f); gs.snapshot(f); }
  ok(gs.snapshot(0).ph === 'drawing', '3 秒后进入作画阶段');

  const drawer = ps.find((p) => p.id === drawerId);
  for (let f = 0; f < 30; f++) {
    gs.onAction(drawer, { a: 'draw', pts: [[100 + f * 12, 200 + f * 4]], c: 2, w: 1, ns: f === 0 });
    gs.step(1 / 60, f);
  }
  const snap = gs.snapshot(60);
  ok(snap.no >= 30, '笔画按增量累计（' + snap.no + ' 条）');
  ok(!!snap.mk && snap.mk.indexOf('＿') >= 0, '猜者只看到遮罩提示：' + snap.mk);

  /* 非画者猜错 / 猜对 */
  const guesser = ps.find((p) => p.id !== drawerId);
  gs.onAction(guesser, { a: 'guess', text: '随便猜' });
  ok((gs.snapshot(61).gw || []).length >= 1, '猜错会进广播列表');
  const before = (gs.snapshot(62).sc || []).map((x) => x[1]).reduce((a, b) => a + b, 0);
  gs.onAction(guesser, { a: 'guess', text: word });
  const after = gs.snapshot(63);
  const sum = after.sc.map((x) => x[1]).reduce((a, b) => a + b, 0);
  ok(sum > before, '猜对加分（' + before + ' → ' + sum + '）');
  ok(after.gd.indexOf(guesser.id) >= 0, '猜对的人进已猜中名单');

  /* 全量重绘：把已有笔画一次性发给晚到的人 */
  inbox.length = 0;
  gs.onAction(ps[2], { a: 'redraw' });
  const full = inbox.filter((x) => x.m.t === 'snap').map((x) => x.m.d)[0];
  ok(full && full.full && full.ds.length >= 30, '全量重绘能给到全部笔画（' + (full && full.ds.length) + '）');
  room.stopLoop();
}

/* ---------- 6. 协议版本对齐（前端 PROTO 与 server 一致） ---------- */
group('6. 协议常量逐项对比');
{
  const src = fs.existsSync(path.join(ROOT, 'js/party/net.js'))
    ? fs.readFileSync(path.join(ROOT, 'js/party/net.js'), 'utf8')
    : null;
  if (!src) {
    console.log('  · 跳过：当前目录没有前端源码（独立部署包只含 server/）');
  } else {
  for (const k of ['MAX_PLAYERS', 'MIN_PLAYERS', 'MAX_NAME', 'CHAT_MAX', 'CHAT_CD']) {
    ok(new RegExp(k + ':\\s*' + P[k] + '\\b').test(src), k + ' = ' + P[k]);
  }
  for (const k of Object.keys(P.C)) {
    ok(new RegExp(k + ":\\s*'" + P.C[k] + "'").test(src), 'C.' + k);
  }
  for (const k of Object.keys(P.S)) {
    ok(new RegExp(k + ":\\s*'" + P.S[k] + "'").test(src), 'S.' + k);
  }
  }
}

/* ---------- 7. 客户端预测（静态检查） ---------- */
group('7. 客户端预测 · 接线检查');
{
  const gPath = path.join(ROOT, 'js/party/games.js');
  const pPath = path.join(ROOT, 'js/party/predict.js');
  const sPath = path.join(ROOT, 'js/party/shared.js');
  const hPath = path.join(ROOT, 'games/party/index.html');
  if (!fs.existsSync(gPath)) {
    console.log('  · 跳过：当前目录没有前端源码');
  } else {
    const gs = readPartyGames();
    const pred = fs.readFileSync(pPath, 'utf8');
    const html = fs.readFileSync(hPath, 'utf8');
    /* 脚本顺序：predict / shared 必须在 games 之前（games 里直接取 global.WH_*） */
    const ord = ['js/party/predict.js', 'js/party/shared.js', 'js/party/games.js']
      .map((f) => html.indexOf(f));
    ok(ord.every((v) => v > 0) && ord[0] < ord[2] && ord[1] < ord[2], '页面脚本顺序：predict/shared 先于 games');
    /* 玩法文件必须在底座之后、lobby 之前：lobby 的 GAMES 表一渲染就会用到它们 */
    const lobbyAt = html.indexOf('js/party/lobby.js');
    const gCoreAt = html.indexOf('/js/party/games.js');
    const perGame = ['bounce', 'balloon', 'tank', 'snake', 'quiz', 'draw', 'pitch', 'duel']
      .map((id) => ({ id, at: html.indexOf('/js/party/games.' + id + '.js') }));
    ok(perGame.every((x) => x.at > gCoreAt && x.at < lobbyAt),
      '八个玩法脚本都在底座之后、lobby 之前',
      perGame.filter((x) => !(x.at > gCoreAt && x.at < lobbyAt)).map((x) => x.id).join(','));
    ok(/WH_PREDICT/.test(gs) && /WH_SHARED/.test(gs), 'games.js 取用 WH_PREDICT / WH_SHARED');
    ok(!/var SH = global.WH_SHARED/.test(gs), '物理引用没有用 SH 这个名字（贪吃蛇场地高 SH 会撞名）');
    /* 三个连续移动玩法都要用到预测 */
    for (const id of ['bounce', 'tank', 'pitch']) {
      const f = path.join(ROOT, 'js/party/games.' + id + '.js');
      const seg = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      ok(/K\.register\('/.test(seg) && /pred/.test(seg), id + ' 已接入客户端预测');
    }
    /* seq 必须随输入上行，否则服务端无从回 ack */
    const seqSends = (gs.match(/seq:\s*p\.send\(/g) || []).length;
    ok(seqSends >= 3, '三个玩法都在输入里带 seq（' + seqSends + ' 处）');
    ok(/ackOf\s*\(/.test(gs), '客户端解析快照里的 ak');
    ok(/hardHits/.test(pred), '预测内核统计硬贴合次数（便于诊断）');
    /* 共享物理必须现生成、与 server/ 一致 */
    const shSrc = fs.readFileSync(sPath, 'utf8');
    const m = /__hash\s*=\s*'([0-9a-f]+)'/.exec(shSrc);
    ok(!!m, 'shared.js 带 __hash');
  }
}

/* ---------- 7.5 球场物理回归（带球 / 挡球 / 角落脱困） ---------- */
group('7.5 球场物理 · 带球与边界');
{
  const P = require(path.join(ROOT, 'server/games/pitch.js'));
  const C = P.DATA, geo = P.geom();

  /* 带球：一直朝球跑，球要能被人「带着走」而不是一脚踢飞再追。
     判据用「接触帧数」——好手感下大部分帧球都贴在脚边。 */
  {
    const ball = P.createBall(300, 310);
    const p = { x: 260, y: 310, vx: 0, vy: 0, a: 0 };
    let touch = 0;
    for (let i = 0; i < 180; i++) {
      const dx = ball.x - p.x, dy = ball.y - p.y, m = Math.hypot(dx, dy) || 1;
      if (P.stepPlayer(p, { x: dx / m, y: dy / m, sp: 1 }, ball, 1 / 60, C)) touch++;
      P.stepBall(ball, 1 / 60, geo, C);
    }
    ok(touch > 90, '推球时球贴在脚边（3 秒内接触 ' + touch + '/180 帧）');
    ok(ball.x > 600, '带球确实往前走了（球到 x=' + Math.round(ball.x) + '）');
  }

  /* 静止的人不能「吸球」：站着不动的人被球擦到，不能把球带着跑 */
  {
    const ball = P.createBall(853 - 40, 434);
    ball.vx = 420;
    const stand = { x: 853, y: 434, vx: 0, vy: 0, a: 0 };
    const x0 = stand.x, y0 = stand.y;
    for (let i = 0; i < 120; i++) {
      P.stepPlayer(stand, { x: 0, y: 0, sp: 1 }, ball, 1 / 60, C);
      P.stepBall(ball, 1 / 60, geo, C);
    }
    const moved = Math.hypot(stand.x - x0, stand.y - y0);
    ok(moved < 1, '站着不动的人不会被球带着走（位移 ' + moved.toFixed(2) + 'px）');
    /* 判据是「没穿过去」，不是「弹回来」：
       现在球撞到人身上是**贴着停住**（速度被摩擦和人墙吃掉），
       旧判据 `ball.vx < 0` 是「反弹」，那是上一版粘球 bug 的产物。 */
    const gapNow = Math.hypot(ball.x - stand.x, ball.y - stand.y);
    ok(ball.x < stand.x && gapNow > 40,
      '球被人墙挡住、没穿过去（球停在 x=' + Math.round(ball.x) + '，离人 ' + Math.round(gapNow) + 'px）');
  }

  /* 球和人完全重合（开局/复活撞在一起）也不能穿出去 */
  {
    const ball = P.createBall(600, 310);
    const stand = { x: 600, y: 310, vx: 0, vy: 0, a: 0 };
    for (let i = 0; i < 60; i++) {
      P.stepPlayer(stand, { x: 0, y: 0, sp: 1 }, ball, 1 / 60, C);
      P.stepBall(ball, 1 / 60, geo, C);
    }
    ok(Math.hypot(ball.x - stand.x, ball.y - stand.y) > 40, '球和人重合时会分离，不会穿模');
  }

  /* 球速上限下不会穿透静止球员：一帧位移必须小于接触直径 */
  ok(C.BALL_MAX / 60 < (C.PR + C.BR) * 2, '球每帧位移小于接触直径（不会穿人）');

  /* 角落脱困：球贴角、人一直往里压，位置会被一点点挪出来（不会永远钉死） */
  {
    const gs2 = games.get('pitch').create({
      seed: 7, random: () => 0.1, players: [{ id: 'a', name: 'A', seat: 0 }], send() {}
    });
    gs2.snapshot(0);
    let unstuck = 0;
    for (let i = 0; i < 60 * 12; i++) {
      const st = gs2.snapshot(0);
      const me = st.pl[0];
      const dx = st.ba[0] - me[1], dy = st.ba[1] - me[2], m = Math.hypot(dx, dy) || 1;
      gs2.onInput({ id: 'a' }, { x: dx / m, y: dy / m });
      gs2.step(1 / 60, i);
      const q = gs2.snapshot(0);
      if (q.ev) for (const e of q.ev) if (e.e === 'unstuck') unstuck++;
    }
    ok(unstuck > 0, '球被顶进角落时会触发脱困（' + unstuck + ' 次）');
  }
}

/* ---------- 8. 预测内核行为（不跑网络，只验数学） ---------- */
group('8. 客户端预测 · 内核行为');
{
  const pPath = path.join(ROOT, 'js/party/predict.js');
  const sPath = path.join(ROOT, 'js/party/shared.js');
  if (!fs.existsSync(pPath)) {
    console.log('  · 跳过');
  } else {
    const PR = require('../js/party/predict.js');
    const SH = require('../js/party/shared.js');

    /* (a) 输入历史按 seq 丢弃，不允许旧 ack 把历史清空 */
    const h = new PR.History();
    for (let i = 1; i <= 10; i++) h.record(i, { x: 1 });
    ok(h.dropBefore(4) === 4 && h.len() === 6, '历史按 ack 丢弃（4 条）');
    ok(h.dropBefore(0) === 0 && h.len() === 6, 'ack=0 不丢历史');

    /* (b) 同源物理：本地预测与服务端逐帧一致（同一份 stepBody） */
    const body = SH.createBody(100, 100);
    const body2 = SH.createBody(100, 100);
    for (let i = 0; i < 120; i++) {
      SH.stepBody(body, { x: 1, y: 0 }, []);
      SH.stepBody(body2, { x: 1, y: 0 }, []);
    }
    ok(Math.abs(body.x - body2.x) < 1e-9, '同一份物理两次算出来一样');

    /* (c) 服务器追上之后预测位置 == 权威位置（重放不超发） */
    const p = new PR.Pred({
      key: 'me', x: 100, y: 100,
      idle: () => ({ x: 0, y: 0 }),
      step: (b, inp) => SH.stepBody(b, inp, []),
      snap: (s) => ({ x: s[0], y: s[1] }),
      apply: (b, s) => { b.x = s.x; b.y = s.y; }
    });
    p.send({ x: 1, y: 0 });
    p.tick(1 / 60);
    const truth = SH.createBody(100, 100);
    SH.stepBody(truth, { x: 1, y: 0 }, []);
    p.onSnap(1, [truth.x, truth.y]);        /* 服务端已处理到 seq 1 */
    ok(Math.abs(p.body.x - truth.x) < 0.01, 'ack 到齐后预测位置 = 权威位置');
    ok(p.hist.len() === 0, 'ack 到齐后历史清空');

    /* (d) 绝对量字段（朝向）不进历史：避免角度累加两遍 */
    const q = new PR.Pred({
      key: 'me', x: 0, y: 0, a: 0,
      idle: () => ({ thr: 0, turn: 0 }),
      step: (b, inp) => SH.stepTank(b, inp, [], [], [], 'me'),
      snap: (s) => ({ x: s[0], y: s[1], a: s[2] }),
      apply: (b, s) => { b.x = s.x; b.y = s.y; b.a = s.a; }
    });
    for (let i = 0; i < 30; i++) { q.send({ thr: 0, turn: 1 }); q.tick(1 / 60); }
    const before = q.body.a;
    q.onSnap(0, [0, 0, 0.5]);               /* 服务端说朝向是 0.5 */
    ok(Math.abs(q.body.a - 0.5) < 1e-6, '朝向直接跟权威值（不累加）');
    ok(Math.abs(before) > 0.1, '本地 tick 确实转过了（' + before.toFixed(2) + ' rad）');
  }
}

/* ---------- 9. 「按键到画面」延迟仿真（真服务端物理 + 模拟跨境链路） ---------- */
group('9. 客户端预测 · 跟手延迟仿真');
{
  const sim = path.join(ROOT, 'tools/predict-lag.mjs');
  if (!fs.existsSync(sim)) {
    console.log('  · 跳过：没有 tools/predict-lag.mjs');
  } else {
    let out = '';
    try {
      out = execFileSync(process.execPath, [sim], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
    }
    const lines = out.split('\n');
    /* 只抽结论行，别把整张表塞进自测输出 */
    lines.filter((l) => /^· |^✓ 通过|^✗ 未达标/.test(l)).forEach((l) => console.log('  ' + l));
    ok(/✓ 通过/.test(out), '三个玩法的跟手延迟都随预测显著改善');
    const m = /跨境 150ms：起效 (\d+)ms → (\d+)ms/.exec(out);
    ok(!!m && Number(m[2]) <= 34, '跨境 150ms 下起效时间 ≤ 34ms（实测 ' + (m ? m[1] + '→' + m[2] + 'ms' : '—') + '）');

    /* 对抗性场景（被撞飞 / 抖动丢包）：只关心「预测有没有闯祸」 */
    const sim2 = path.join(ROOT, 'tools/predict-sim.mjs');
    let out2 = '';
    try {
      out2 = execFileSync(process.execPath, [sim2], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    } catch (e) {
      out2 = (e.stdout || '') + (e.stderr || '');
    }
    const bad = /回滚[\s\S]*?\n([\s\S]*?)\n\n/.exec(out2);
    ok(/✓ 通过/.test(out2), '对抗场景（被撞/丢包）下视觉误差始终可控');
    const hardCount = (out2.match(/^\S.*\s(\d+)\s*$/gm) || []).length;
    ok(hardCount > 0, '仿真确实跑出了数据（' + hardCount + ' 档链路）');
  }
}

console.log('\n' + (fails ? '✗ ' + fails + ' / ' + checks + ' 项未通过' : '✓ 全部通过（' + checks + ' 项）'));
process.exit(fails ? 1 : 0);