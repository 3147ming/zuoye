/* 线上同源联机全流程：建房 → 进房 → 开局 → 快照
   用法：node tools/ws-online-smoke.mjs [wss://...] */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const WebSocket = require('/workspace/WorldHub/node_modules/ws');

const URL = process.argv[2] || process.env.WS || 'wss://zuoye-e0c.pages.dev/ws';
let pass = 0, fail = 0;
function ok(n, c, e) { console.log(`  ${c ? '✓' : '✗'} ${n}${e !== undefined ? '  ' + e : ''}`); c ? pass++ : fail++; }

/* 连接并等第一帧消息，避免 open 事件早于监听器挂上 */
function connect(tag) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const st = { ws, tag, joined: null, room: null, snaps: 0, msgs: [] };
    const to = setTimeout(() => reject(new Error(tag + ' 连接超时')), 15000);
    ws.on('message', (m) => {
      const j = JSON.parse(m);
      st.msgs.push(j.t);
      if (j.t === 'joined') {
        st.joined = j.d;
        if (j.d.room) st.room = j.d.room;
        clearTimeout(to);
        resolve(st);
      }
      if (j.t === 'room' && j.d.room) st.room = j.d.room;
      if (j.t === 'snap') st.snaps++;
    });
    ws.on('error', (e) => { clearTimeout(to); reject(new Error(tag + ' 连接失败：' + e.message)); });
  });
}

let A, B;
try {
  A = await connect('甲');
  B = await connect('乙');
} catch (e) {
  console.log('  ✗ ' + e.message);
  console.log(`\n结果：0 通过 / 1 失败`);
  process.exit(1);
}
console.log('两个会话都连上了 ' + URL);
ok('服务端给了玩家身份', !!(A.joined && A.joined.you), A.joined && A.joined.you);

A.ws.send(JSON.stringify({ t: 'create', d: { game: 'fist', name: '甲', pass: '' } }));
await new Promise((r) => setTimeout(r, 1200));
const code = A.room && A.room.code;
ok('甲建房拿到房号', /^[1-9]\d{0,4}$/.test(code || ''), code);

B.ws.send(JSON.stringify({ t: 'join', d: { code, pass: '', name: '乙' } }));
await new Promise((r) => setTimeout(r, 1200));
ok('乙进了同一个房间', !!(B.room && B.room.code === code), (B.room && B.room.code) + ' vs ' + code);

/* A 侧的 player 列表：B 加入后不会立刻再推一条 room 消息给 A，
   要等下一次同步才更新。所以这里不看 A.room.players，
   而是看 B 自己看到的房间里有没有两个人 —— B 是后进的那个，
   它进房时拿到的就是最终人数。 */
const bCount = B.room && B.room.players ? B.room.players.length : 0;
ok('房间里两个人都在', bCount === 2, bCount + ' 人');

A.ws.send(JSON.stringify({ t: 'start', d: {} }));
await new Promise((r) => setTimeout(r, 2500));
ok('开始后双方都收到快照', A.snaps > 0 && B.snaps > 0, 'A=' + A.snaps + ' B=' + B.snaps);
ok('快照是 30Hz 级别的连续推送', A.snaps >= 10, 'A 收到 ' + A.snaps + ' 帧');

A.ws.close(); B.ws.close();
await new Promise((r) => setTimeout(r, 300));
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
