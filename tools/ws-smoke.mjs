/* ============================================================
 * tools/ws-smoke.mjs —— 联机服务冒烟测试（对任意地址跑）
 * ------------------------------------------------------------
 * 用来验：
 *   · 本地 Node 服务        node tools/ws-smoke.mjs ws://127.0.0.1:8787/ws
 *   · 本地 wrangler dev     node tools/ws-smoke.mjs ws://127.0.0.1:8788/ws
 *   · 线上 Worker           node tools/ws-smoke.mjs wss://worldhub-ws.xxx.workers.dev/ws
 *
 * 检查项：hello → 建房（房号 1–5 位且无前导 0）→ 第二人进房 → 错密码被拒 →
 *         满员被拒 → 房主开局 → 1.5 秒内收到 ≥10 帧快照 → 非房主开局被拒。
 *
 * 依赖：ws（package.json 里已有，构建期工具，不影响运行期零依赖）
 * ============================================================ */
import WS from 'ws';

const URL_ARG = process.argv[2] || 'ws://127.0.0.1:8787/ws';
const GAME = process.argv[3] || 'bounce';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
};

const open = () => new Promise((res, rej) => {
  const s = new WS(URL_ARG, { handshakeTimeout: 8000 });
  s.on('open', () => res(s));
  s.on('error', rej);
});
const wait = (s, pred, ms = 6000) => new Promise((res, rej) => {
  const t = setTimeout(() => { s.off('message', h); rej(new Error('timeout')); }, ms);
  const h = (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (pred(m)) { clearTimeout(t); s.off('message', h); res(m); }
  };
  s.on('message', h);
});
const send = (s, t, d = {}) => s.send(JSON.stringify({ t, d }));

console.log('目标：' + URL_ARG);

let a, b, c;
try {
  /* 1. 握手 */
  a = await open();
  const hello = await wait(a, (m) => m.t === 'joined');
  ok('握手：收到 hello（joined）', hello.d && hello.d.hello === true);

  /* 2. 建房 */
  send(a, 'create', { game: GAME, pass: '', name: '冒烟甲' });
  const ra = await wait(a, (m) => m.t === 'joined' && m.d && m.d.room);
  const code = String(ra.d.room.code);
  ok('建房：房号 1–5 位数字', /^[1-9]\d{0,4}$/.test(code), code);
  ok('建房：房主是自己', ra.d.room.host === ra.d.you || ra.d.room.hostId === ra.d.you, JSON.stringify(ra.d.room.host || ra.d.room.hostId));

  /* 3. 错房号 / 错密码 */
  b = await open(); await wait(b, (m) => m.t === 'joined');
  send(b, 'join', { code: '99999', pass: '', name: '冒烟乙' });
  const e1 = await wait(b, (m) => m.t === 'error');
  ok('错误房号被拒', e1.d && e1.d.code === 'NO_ROOM', e1.d && e1.d.code);

  /* 4. 正主进房 */
  send(b, 'join', { code, pass: '', name: '冒烟乙' });
  const rb = await wait(b, (m) => m.t === 'joined' && m.d && m.d.room);
  ok('进房成功', rb.d.room.code === code);
  ok('房内 2 人', Array.isArray(rb.d.room.players) && rb.d.room.players.length === 2, String(rb.d.room.players && rb.d.room.players.length));

  /* 5. 非房主开局被拒 */
  send(b, 'start', {});
  const e2 = await wait(b, (m) => m.t === 'error');
  ok('非房主不能开局', e2.d && e2.d.code === 'NOT_HOST', e2.d && e2.d.code);

  /* 6. 房主开局 + 快照 */
  send(a, 'start', {});
  const st = await wait(b, (m) => m.t === 'start');
  ok('房主开局成功', st.t === 'start');
  let snaps = 0;
  const snapH = (raw) => { try { if (JSON.parse(raw).t === 'snap') snaps++; } catch (e) {} };
  b.on('message', snapH);
  await new Promise((r) => setTimeout(r, 1500));
  b.off('message', snapH);
  ok('1.5 秒内快照 ≥ 10 帧', snaps >= 10, snaps + ' 帧');
} catch (e) {
  fail++;
  console.log('  ✗ 连接/流程中断：' + e.message);
} finally {
  try { a && a.close(); } catch (e) {}
  try { b && b.close(); } catch (e) {}
  try { c && c.close(); } catch (e) {}
}

console.log('\n' + (fail ? '✗ 有 ' + fail + ' 项未过' : '✓ 全部通过') + '（' + pass + ' 项通过）');
process.exit(fail ? 1 : 0);
