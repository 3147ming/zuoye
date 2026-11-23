/* ============================================================
 * js/party/lobby.js —— 联机大厅（建房 / 进房 / 房间面板）
 * ------------------------------------------------------------
 * 一个页面同时是「大厅」和「房间」：状态机自己切，避免跳页丢连接。
 * 房间号输入框按 1–5 位数字强校验（输入时就把非数字剥掉，超长截断），
 * 密码 4 位数字，提交前给出人话提示，不把错误甩给服务端再回来。
 * ============================================================ */
(function (global) {
  'use strict';

  var GAMES = [
    { id: 'bounce', name: '咱俩碰碰', tag: '碰撞竞技', desc: '3 张场地 · 4 种道具 · 冲刺撞人', color: '#ff7a7a', keys: 'WASD / 摇杆推方向 · 空格冲刺' },
    { id: 'balloon', name: '泡泡堂', tag: '放泡炸箱', desc: '炸箱掉道具，泡泡数与火力越滚越大', color: '#7ec8ff', keys: '方向键按住走 · 空格放泡' },
    { id: 'tank', name: '坦克大战', tag: '射击对战', desc: '3 张战场 · 砖墙可打碎 · 捡补给', color: '#ffd166', keys: '↑↓ 前后 · ←→ 转向 · 空格开炮' },
    { id: 'snakebattle', name: '贪吃蛇大作战', tag: '长大撞人', desc: '金果加三节 · 加速果 · 烧身长冲刺', color: '#8ff0b5', keys: '←→ 转向 · 空格冲刺' },
    { id: 'quiz', name: '抢答赛', tag: '同时开抢', desc: '108 道题 · 10 个分类 · 连对加成', color: '#c0a5ff', keys: '点选项 / 按 1234' },
    { id: 'draw', name: '你画我猜', tag: '画板传话', desc: '轮流当画者，96 个词，越快分越高', color: '#ff9f9f', keys: '轮到你时直接在画板上画 · 其余人打字抢猜' },
    { id: 'pitch', name: '球场 2v2', tag: '带球射门', desc: '推球 · 带球 · 射门，先进 3 球 · 草地/冰面两种手感', color: '#7ee0c0', keys: 'WASD / 摇杆跑动 · 空格射门' },
    { id: 'duel', name: '弹弹岛对战', tag: '抛物线对轰', desc: '真人轮流开炮 · 重力+横风 · 炸人落海 · 巡逻气球', color: '#ffd166', keys: '↑↓ 角度 · ←→ 力度 · A/D 走位 · 空格开火' },
    { id: 'fist', name: '招式格斗', tag: '轻快对轰', desc: 'Q 版格斗 · 跳跃+拳脚+三个技能 · 三局两胜', color: '#ff9f6e', keys: 'A D 移动 · W 跳 · J 拳 · K 踢 · U I O 技能' }
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function $(id) { return document.getElementById(id); }

  global.PartyLobby = {
    GAMES: GAMES,
    boot: function () {
      var net = new global.WH_PARTY_NET();
      global.PARTY_NET = net;

      var app = $('party');
      if (!app) return;

      var state = { view: 'lobby', game: 'bounce', pass: '', name: '', err: '', busy: false, over: null };

      /* ---------- 名字：记在 localStorage，第二次来不用再填 ---------- */
      try { state.name = localStorage.getItem('wh.party.name') || ''; } catch (e) { state.name = ''; }

      function saveName(n) {
        state.name = n;
        try { localStorage.setItem('wh.party.name', n); } catch (e) { /* ignore */ }
      }

      /* ---------- 渲染 ---------- */
      function render() {
        app.innerHTML = '';
        if (!net.room) renderLobby();
        else if (net.room.state === 'waiting') renderRoom();
        else renderGame();
      }

      /* ---------- 连接状态：只显示业务状态，绝不渲染服务地址 ---------- */
      function netStatusText() {
        if (net.state === 'online') return '已连接 · ' + net.latency + 'ms';
        if (net.state === 'connecting') return net._retry > 0 ? '重连中…' : '连接中…';
        /* offline 分两种：连上过又断了 = 还在自动重试；从没连上 = 真连不上 */
        if (net.state === 'offline') return net._everOnline ? '重连中…' : '连接失败';
        return '未连接';
      }
      function buildNetTag() {
        var cls = 'pp-net';
        if (net.state === 'online') cls += ' on';
        else if (net.state === 'connecting') cls += (net._retry > 0 ? ' retry' : ' wait');
        else if (net.state === 'offline') cls += (net._everOnline ? ' retry' : ' err');
        var tag = el('div', cls);
        tag.innerHTML = '<i></i>' + netStatusText();
        return tag;
      }

      /* ---------- 大厅 ---------- */
      function renderLobby() {
        var wrap = el('div', 'pp-wrap');
        var head = el('header', 'pp-head');
        head.appendChild(el('h1', 'pp-title', '联机大厅'));
        head.appendChild(el('p', 'pp-sub', '建房拿一个 5 位数字房号，发给朋友就能一起玩。房间号 1–5 位数字，密码可选 4 位。'));
        head.appendChild(buildNetTag());
        wrap.appendChild(head);

        /* 昵称 */
        var row = el('div', 'pp-row');
        var nameWrap = el('label', 'pp-field');
        nameWrap.appendChild(el('span', 'pp-label', '你的昵称'));
        var nameIn = el('input', 'pp-input');
        nameIn.maxLength = 10;
        nameIn.placeholder = '最多 10 个字';
        nameIn.value = state.name;
        nameIn.oninput = function () { saveName(nameIn.value.trim()); };
        nameWrap.appendChild(nameIn);
        row.appendChild(nameWrap);
        wrap.appendChild(row);

        /* 第八批⑥：服务地址不再出现在 UI。连接状态见顶部状态条；
           自建服务通过部署配置 / 网址参数指定，不作为可见信息。 */

        /* 游戏选择 */
        var grid = el('div', 'pp-games');
        GAMES.forEach(function (g) {
          var card = el('button', 'pp-game' + (state.game === g.id ? ' on' : ''));
          card.type = 'button';
          card.style.setProperty('--c', g.color);
          card.innerHTML =
            '<span class="pp-game-dot"></span>' +
            '<b>' + g.name + '</b>' +
            '<em>' + g.tag + ' · 2–4 人</em>' +
            '<span class="pp-game-desc">' + g.desc + '</span>';
          card.onclick = function () { state.game = g.id; render(); };
          grid.appendChild(card);
        });
        wrap.appendChild(grid);

        /* 建房 / 进房 */
        var acts = el('div', 'pp-acts');

        var createBox = el('div', 'pp-panel');
        createBox.appendChild(el('h3', '', '创建房间'));
        var passField = el('label', 'pp-field');
        passField.appendChild(el('span', 'pp-label', '房间密码（可留空）'));
        var passIn = el('input', 'pp-input');
        passIn.inputMode = 'numeric';
        passIn.maxLength = 4;
        passIn.placeholder = '4 位数字';
        passIn.oninput = function () {
          passIn.value = passIn.value.replace(/\D/g, '').slice(0, 4);
          state.pass = passIn.value;
        };
        passField.appendChild(passIn);
        createBox.appendChild(passField);
        var createBtn = el('button', 'pp-btn pp-btn-primary', '创建房间');
        createBtn.type = 'button';
        createBtn.onclick = function () {
          if (!state.name) { state.err = '先填个昵称吧'; return render(); }
          if (state.pass && state.pass.length !== 4) { state.err = '密码要么不设，要么 4 位数字'; return render(); }
          state.err = '';
          state.busy = true;
          createBtn.disabled = true;
          createBtn.textContent = '创建中…';
          if (!net.ws) net.connect();
          setTimeout(function () { net.createRoom(state.game, state.pass, state.name); }, net.state === 'online' ? 0 : 380);
        };
        createBox.appendChild(createBtn);
        acts.appendChild(createBox);

        var joinBox = el('div', 'pp-panel');
        joinBox.appendChild(el('h3', '', '进入房间'));
        var codeField = el('label', 'pp-field');
        codeField.appendChild(el('span', 'pp-label', '房间号（1–5 位数字）'));
        var codeIn = el('input', 'pp-input pp-input-code');
        codeIn.inputMode = 'numeric';
        codeIn.maxLength = 5;
        codeIn.placeholder = '例如 13824';
        codeIn.oninput = function () { codeIn.value = codeIn.value.replace(/\D/g, '').slice(0, 5); };
        codeField.appendChild(codeIn);
        joinBox.appendChild(codeField);
        var jpassField = el('label', 'pp-field');
        jpassField.appendChild(el('span', 'pp-label', '密码（房间没设就留空）'));
        var jpassIn = el('input', 'pp-input');
        jpassIn.inputMode = 'numeric';
        jpassIn.maxLength = 4;
        jpassIn.placeholder = '4 位数字';
        jpassIn.oninput = function () { jpassIn.value = jpassIn.value.replace(/\D/g, '').slice(0, 4); };
        jpassField.appendChild(jpassIn);
        joinBox.appendChild(jpassField);
        var joinBtn = el('button', 'pp-btn', '进入房间');
        joinBtn.type = 'button';
        joinBtn.onclick = function () {
          if (!state.name) { state.err = '先填个昵称吧'; return render(); }
          var code = codeIn.value.trim();
          if (!/^[1-9]\d{0,4}$/.test(code)) { state.err = '房间号必须是 1–5 位数字'; return render(); }
          state.err = '';
          state.busy = true;
          joinBtn.disabled = true;
          joinBtn.textContent = '进入中…';
          if (!net.ws) net.connect();
          setTimeout(function () { net.joinRoom(code, jpassIn.value, state.name); }, net.state === 'online' ? 0 : 380);
        };
        joinBox.appendChild(joinBtn);
        acts.appendChild(joinBox);

        wrap.appendChild(acts);

        if (state.err) {
          var e = el('div', 'pp-err', state.err);
          wrap.appendChild(e);
        }

        var tips = el('div', 'pp-tips');
        tips.innerHTML =
          '<b>怎么玩：</b>房主建房 → 把 5 位房号发给朋友 → 朋友在大厅填房号进入 → 房主点「开始游戏」。<br>' +
          '<b>网络：</b>房间由云端同步，连不上会自动重试；多次失败可点「重试连接」。' +
          '自建服务的配置方式见部署说明。';
        wrap.appendChild(tips);

        /* 真的连不上（从没连上过，或退避 60 次用完）：给一个明确的重试入口，不暴露地址 */
        if (net.state === 'offline' && (!net._everOnline || net._retry >= 60)) {
          var retryBtn = el('button', 'pp-btn pp-btn-sm', '重试连接');
          retryBtn.type = 'button';
          retryBtn.onclick = function () { net._retry = 0; state.err = ''; net.connect(); render(); };
          wrap.appendChild(retryBtn);
        }

        app.appendChild(wrap);
      }

      /* ---------- 房间 ---------- */
      function renderRoom() {
        var room = net.room;
        var g = null;
        for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === room.game) g = GAMES[i];
        var wrap = el('div', 'pp-wrap pp-wrap-room');

        var head = el('header', 'pp-head');
        head.appendChild(el('h1', 'pp-title', g ? g.name : '房间'));
        var codeLine = el('div', 'pp-code');
        codeLine.innerHTML = '<span>房间号</span><b>' + room.code + '</b>' +
          (room.pass ? '<em>有密码</em>' : '<em>无密码</em>');
        head.appendChild(codeLine);
        var copyBtn = el('button', 'pp-btn pp-btn-sm', '复制邀请');
        copyBtn.type = 'button';
        copyBtn.onclick = function () {
          var text = '来一起玩「' + (g ? g.name : '联机游戏') + '」！\n网址：' + location.origin + '/games/party/\n房间号：' + room.code + (room.pass ? '（有密码，我另发你）' : '');
          if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () {
            copyBtn.textContent = '已复制';
            setTimeout(function () { copyBtn.textContent = '复制邀请'; }, 1500);
          });
        };
        head.appendChild(copyBtn);
        wrap.appendChild(head);

        /* 玩家列表 */
        var list = el('div', 'pp-players');
        room.players.forEach(function (p) {
          var row = el('div', 'pp-player' + (p.id === net.you ? ' me' : ''));
          row.style.setProperty('--c', (g && g.color) || '#ffd166');
          row.innerHTML =
            '<span class="pp-seat">P' + (p.seat + 1) + '</span>' +
            '<b>' + escapeHtml(p.name) + '</b>' +
            (p.id === room.hostId ? '<em class="pp-badge">房主</em>' : '') +
            (p.id === net.you ? '<em class="pp-badge me">你</em>' : '') +
            (p.online ? '' : '<em class="pp-badge off">掉线</em>');
          list.appendChild(row);
        });
        for (var k = room.players.length; k < 4; k++) {
          list.appendChild(el('div', 'pp-player empty', '空位 · 等一个朋友'));
        }
        wrap.appendChild(list);

        /* 操作 */
        var bar = el('div', 'pp-bar');
        if (net.isHost()) {
          var startBtn = el('button', 'pp-btn pp-btn-primary', room.players.length < 2 ? '等人来（至少 2 人）' : '开始游戏');
          startBtn.type = 'button';
          startBtn.disabled = room.players.length < 2;
          startBtn.onclick = function () { net.send('start', {}); };
          bar.appendChild(startBtn);
        } else {
          bar.appendChild(el('span', 'pp-wait', '等房主开局…'));
        }
        var leaveBtn = el('button', 'pp-btn pp-btn-ghost', '离开房间');
        leaveBtn.type = 'button';
        leaveBtn.onclick = function () { net.leave(); state.err = ''; render(); };
        bar.appendChild(leaveBtn);
        wrap.appendChild(bar);

        var hint = el('div', 'pp-hint');
        hint.innerHTML = g ? '<b>操作：</b>' + g.keys : '';
        wrap.appendChild(hint);

        if (state.err) wrap.appendChild(el('div', 'pp-err', state.err));
        app.appendChild(wrap);
      }

      /* ---------- 对局中：交给具体游戏渲染 ---------- */
      function renderGame() {
        var wrap = el('div', 'pp-wrap pp-wrap-game');
        var stage = el('div', 'pp-stage');
        stage.id = 'ppStage';
        wrap.appendChild(stage);
        app.appendChild(wrap);
        global.PartyKit.open(stage, net, {
          onExit: function () {
            net.leave();
            state.over = null;
            render();
          },
          onAgain: function () {
            state.over = null;
            render();
          }
        });
      }

      /* ---------- 连接事件 ---------- */
      net.on('status', function (s) {
        var st = (s && s.state) || net.state;
        /* 对局中掉线：绝对不能 render()。
           render() 第一句就是 app.innerHTML = ''，会把整个对局舞台（画布、
           摇杆、记分条）拆掉重建 —— 玩家看到的就是「一断线这局就没了」。
           这里只更新顶栏那个延迟标签，剩下的交给 net 自己退避重连，
           连上后 autoRejoin 会用 token 续回原房间，舞台一直没动过。 */
        var inStage = !!app.querySelector('.pk-wrap');
        if (inStage && st !== 'online') {
          var tag = app.querySelector('.pk-ping');
          if (tag) {
            tag.textContent = st === 'connecting'
              ? (net._retry > 0 ? '重连中 ' + net._retry + '…' : '连接中…')
              : '已断开';
            tag.setAttribute('data-warn', s && s.failed ? 'giveup' : 'retry');
          }
          return;
        }
        if (st === 'offline' && state.busy) {
          /* 点了「创建房间」但没连上：不能一直停在「创建中…」，要说清楚断在哪 */
          state.busy = false;
          if (s && s.code === 'ALLFAILED') {
            /* 所有候选地址都握手失败，多半是网络把联机域名挡了 */
            state.err = '连不上联机服务：当前网络可能限制了联机域名。可换网络、开热点，或稍后点「重试连接」。';
          } else if (s && (s.code === 1006 || s.code === 'TIMEOUT')) {
            state.err = '连不上联机服务，可能是当前网络受限。换个网络或稍后再试。';
          } else {
            state.err = '与联机服务断开（' + ((s && s.code) || '连接失败') + '），正在自动重试…';
          }
          render();
          return;
        }
        if (st === 'online') {
          /* 连上后把刚才那次建房/进房补发出去——由 net 的 onopen 统一负责，
             这里只管清掉错误文案。以前这里也补发一次，结果连得慢时
             一次点击会建出两个房间（前一个变孤儿占房号）。 */
          state.err = '';
        }
        render();
      });
      net.on('joined', function (d) {
        if (!d || !d.room) return;
        state.err = ''; state.busy = false;
        /* 断线续房会把 JOINED 再发一遍（resumed:true）。这时舞台还活着，
           render() 会把它拆掉重建，而旧舞台的渲染循环不会自己停 ——
           两个循环同时往 net.input 塞数据，后到的 thr:0 把真实输入盖掉。
           实测现象：重连后按住 S，axis 明明是 1，服务端收到的全是 thr:0，
           坦克一动不动。 */
        if (d.resumed && app.querySelector('.pk-wrap')) return;
        render();
      });
      net.on('room', function () {
        if (!net.room) return;
        /* 对局中也要 render：状态机据此切到「对局舞台」；
           已在对局舞台时不重建（否则每帧快照都会把 canvas 撕掉重来）。
           注意：对局舞台的根节点是 .pp-wrap-game 里的 .pp-stage，
           上面挂的是 PartyKit 的 .pk-wrap，所以必须两者都认。 */
        var inGame = !!app.querySelector('.pk-wrap, .pp-stage');
        if (net.room.state === 'waiting' || !inGame) render();
      });
      net.on('start', function (d) {
        /* 重连时服务端会补发一条 start（d.rejoin=true），这里千万别 render()。
           render() 第一句就是 app.innerHTML=''，会把画布、预测历史、记分条
           全部拆掉重建 —— 玩家看到的就是「一重连这局就没了」。
           舞台本来就活着，接下来的快照会让它自己追上进度。 */
        if (d && d.rejoin && app.querySelector('.pk-wrap')) return;
        render();
      });
      net.on('error', function (d) {
        state.busy = false;
        state.err = net.errText(d && d.code);
        /* 续房失败：房间真的没了（服务端重启，或闲置 30 分钟被回收）。
           这时 net.room 还留着旧房间对象，render() 会照着它继续画对局舞台，
           玩家盯着一块永远不动的画面，还以为在「重连中」。
           必须把房间清掉回大厅，并说清楚原因。
           注意只在「本来有房间」时走这条：首次进错房号不算。 */
        if (d && (d.code === 'NO_ROOM' || d.code === 'CLOSED') && net.room) {
          var wasGame = !!(net.room && net.room.state !== 'waiting');
          net.autoRejoin = null;
          net.clearRoom();
          state.over = null;
          state.err = wasGame
            ? '房间已经关闭了（服务端重启或闲置太久），回大厅重新开一局吧。'
            : '这个房间已经不在了，回大厅重新进吧。';
        }
        render();
      });
      net.on('left', function () {
        state.over = null;
        render();
      });
      net.on('latency', function () {
        var t = app.querySelector('.pp-net');
        if (t && t.parentNode) t.parentNode.replaceChild(buildNetTag(), t);
      });

      render();

      /* 从大厅条目带 ?game=xxx 进来时，预选对应玩法 */
      try {
        var want = new URLSearchParams(location.search).get('game');
        if (want) { state.game = want; render(); }
      } catch (e) { /* ignore */ }
    }
  };

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
