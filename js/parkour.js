/* ============================================================
 * parkour.js —— 大厅跑酷（玩法突破）
 * ------------------------------------------------------------
 * 在中心广场把三屏走道变成一条浮空平台跳跃关卡：
 *   按 P 进入 / 退出；从起点台跳到最右侧终点台；
 *   掉到地面即失败，回到起点重来；用时最短者记为最佳。
 * 平台只从上方落得住（单向平台），复用 player.js 的跳跃物理。
 * 最佳成绩存 worldhub.parkour.best.v1，纯本地。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'worldhub.parkour.best.v1';
  var GOAL_X = 1190;

  var state = { on: false, t: 0, warmed: 0, fails: 0 };

  function loadBest() {
    try { return parseFloat(global.localStorage.getItem(KEY)) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { global.localStorage.setItem(KEY, String(v)); } catch (e) {}
  }

  /* 平台：[起点 … 终点]，y 是台面（脚踩的线），越靠右越高一点 */
  function buildCourse(G) {
    var P = [];
    function pad(x, up, w) { P.push({ x: x, y: G - up, w: w || 120 }); }
    pad(30, 44, 160);    /* 起点 */
    pad(240, 96, 108);
    pad(410, 152, 100);
    pad(575, 90, 128);
    pad(760, 166, 110);
    pad(935, 108, 120);
    pad(1115, 62, 165);  /* 终点 */
    return P;
  }

  function resetPlayer(world, P) {
    var p = world.player;
    if (!p) return;
    p.x = P[0].x + P[0].w / 2;
    p.y = P[0].y;
    p.vx = 0;
    p.vy = 0;
    p.onGround = true;
    state.t = 0;
    state.warmed = 0;
  }

  var Parkour = {
    state: state,
    GOAL_X: GOAL_X,
    best: loadBest,

    toggle: function (world) {
      if (!world || !world.player) return;
      if (state.on) this.stop(world);
      else this.start(world);
    },

    start: function (world) {
      if (state.on) return;
      var G = world.groundY || 566;
      state.on = true;
      state.t = 0;
      state.warmed = 0;
      state.fails = 0;
      world.platforms = buildCourse(G);
      world.parkourOn = true;
      /* 暂时收走门与 NPC，免得跑酷途中弹提示、画面里站着人 */
      world._pkDoor = world.scene ? world.scene.door : null;
      world._pkNpc = world.npc;
      if (world.scene) world.scene.door = null;
      world.npc = null;
      resetPlayer(world, world.platforms);
      if (world.cam) world.cam.snap(world.player);
      if (global.HUD) global.HUD.toast('跑酷开始 · 跳到最右终点台 · 按 P 退出');
      if (global.Stats && global.Stats.count) global.Stats.count('parkour');
    },

    stop: function (world) {
      state.on = false;
      world.platforms = null;
      world.parkourOn = false;
      if (world.scene && world._pkDoor !== undefined) world.scene.door = world._pkDoor;
      world.npc = world._pkNpc || world.npc;
      world._pkDoor = undefined;
      world._pkNpc = null;
      if (world.player) {
        world.player.y = world.groundY || 566;
        world.player.vy = 0;
        world.player.onGround = true;
      }
      if (global.HUD) global.HUD.toast('已退出跑酷');
    },

    update: function (dt, world) {
      if (!state.on) return;
      state.t += dt;
      state.warmed += dt;
      var p = world.player;
      var G = world.groundY || 566;
      if (!p) return;
      /* 掉到地面（起点台之外）→ 失败重来 */
      if (state.warmed > 0.25 && p.y >= G - 2) { this.fail(world); return; }
      /* 到达终点台 */
      if (p.x >= GOAL_X && p.onGround) this.win(world);
    },

    fail: function (world) {
      state.fails++;
      resetPlayer(world, world.platforms);
      if (world.cam) world.cam.snap(world.player);
      if (global.Audio) global.Audio.play('miss');
      if (global.HUD) global.HUD.toast('掉下去了 · 重来');
    },

    win: function (world) {
      var t = state.t;
      var b = loadBest();
      state.on = false;
      world.platforms = null;
      world.parkourOn = false;
      if (world.scene && world._pkDoor !== undefined) world.scene.door = world._pkDoor;
      world.npc = world._pkNpc || world.npc;
      world._pkDoor = undefined;
      world._pkNpc = null;
      var isNew = !b || t < b;
      if (isNew) saveBest(t);
      if (global.Audio) global.Audio.play('win');
      if (global.HUD) {
        global.HUD.toast('跑酷完成！用时 ' + t.toFixed(2) + ' 秒' +
          (isNew ? ' · 新纪录' : ' · 最佳 ' + b.toFixed(2) + ' 秒'));
      }
      if (world.player) { world.player.y = world.groundY || 566; world.player.vy = 0; }
    }
  };

  global.Parkour = Parkour;
})(window);
