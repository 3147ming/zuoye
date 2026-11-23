import { createRequire } from 'node:module';
const require = createRequire('/workspace/WorldHub/server/');
const core = require('./room-core.js');
const games = require('./games/index.js');

const bots = {
  bounce: (gs, ps, f) => {
    const snap = gs.snapshot(f).b || [];
    ps.forEach((p) => {
      const me = snap.find((x) => x[0] === p.id);
      const other = snap.find((x) => x[0] !== p.id) || me;
      if (!me || !other) return;
      const dx = other[1] - me[1], dy = other[2] - me[2], m = Math.hypot(dx, dy) || 1;
      gs.onInput(p, { x: dx / m, y: dy / m });
      if (f % 90 === 0) gs.onAction(p, { a: 'dash' });
    });
  },
  balloon: (gs, ps, f) => {
    if (f % 27 === 0) gs.onAction(ps[0], { a: 'bomb' });
    if (f % 31 === 0) gs.onAction(ps[1], { a: 'bomb' });
    if (f % 5 === 0) ps.forEach((p, i) => gs.onInput(p, { d: 'udlr'[(Math.floor(f / 5) + i) % 4] }));
    else if (f % 5 === 1) ps.forEach((p) => gs.onInput(p, { d: '' }));
  },
  tank: (gs, ps, f) => {
    ps.forEach((p, i) => gs.onInput(p, { thr: 1, turn: Math.sin(f / (30 + i * 7)), fire: f % (50 + i * 11) === 0 }));
  },
  snakebattle: (gs, ps, f) => {
    ps.forEach((p, i) => {
      if (f % (11 + i * 3) === 0) gs.onInput(p, { turn: (f + i) % 2 ? 'l' : 'r' });
      if (f % 150 === 0) gs.onAction(p, { a: 'boost' });
    });
  },
  quiz: (gs, ps, f) => {
    if (f % 55 === 0) ps.forEach((p, i) => gs.onAction(p, { a: 'answer', k: (i + 1) % 4 }));
  },
  pitch: (gs, ps, f) => {
    const snap = gs.snapshot(f);
    const ball = snap.ba;
    snap.pl.forEach((p, i) => {
      const side = p[4];
      const gx = side === 0 ? 1040 : 0, gy = 310;
      /* 先追球，靠近了就朝对方球门方向推 */
      const near = Math.hypot(ball[0] - p[1], ball[1] - p[2]) < 120;
      const tx = near ? gx : ball[0], ty = near ? gy : ball[1];
      const dx = tx - p[1], dy = ty - p[2], m = Math.hypot(dx, dy) || 1;
      gs.onInput(ps[i], { x: dx / m, y: dy / m });
      if (f % 23 === 0) gs.onAction(ps[i], { a: 'kick' });
    });
  },
  draw: (gs, ps, f) => {
    const drawer = ps[0];
    if (f % 3 === 0) gs.onAction(drawer, { a: 'draw', pts: [[100 + (f % 300), 200 + (f % 200)]], c: 1, w: 1, ns: f % 30 === 0 });
  }
};

for (const id of games.ids) {
  const dir = new core.Directory();
  const room = dir.create(id, '');
  const names = ['甲', '乙', '丙', '丁'];
  names.forEach((n, i) => room.add('p' + i, n, { send: () => {} }, 't' + i));
  room.hostId = 'p0';
  const r = room.start('p0');
  room.stopLoop();
  if (r.error) { console.log(id, 'START FAIL', r.error); continue; }

  let maxSnap = 0, err = null, result = null, snaps = 0;
  try {
    for (let f = 1; f <= 7200; f++) {
      bots[id](room.gs, room.players, f);
      room.gs.step(1 / 60, f);
      if (f % 2 === 0) {
        const s = room.gs.snapshot(f);
        if (s) { maxSnap = Math.max(maxSnap, JSON.stringify(s).length); snaps++; }
      }
      const res = room.gs.result(f);
      if (res) { result = res; break; }
    }
  } catch (e) { err = e; }
  console.log(
    id.padEnd(12),
    err ? 'ERR ' + err.message : 'ok',
    '| maxSnap', maxSnap + 'B',
    '| snaps', snaps,
    '| result', result ? (result.reason + ' winner=' + result.winner) : 'none',
    '| state', room.state
  );
  if (id === 'draw') {
    console.log('  draw snap:', JSON.stringify(room.gs.snapshot(1)).slice(0, 400));
  }
}
