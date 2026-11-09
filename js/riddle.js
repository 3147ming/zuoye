/* ============================================================
 * riddle.js —— 每日一题 + 广场告示牌面板（第八批·新玩法③）
 * ------------------------------------------------------------
 * 按日期种子从题库抽一道题。广场正中的告示牌站过去按 E 打开面板，
 * 输入答案提交；答对当天记入进度，明天换题。
 * 面板是 DOM（#riddle），样式在 main.css「告示牌」一节。
 * ============================================================ */
(function (global) {
  'use strict';

  var BANK = [
    /* —— 字谜 / 物谜 —— */
    { q: '什么东西越洗越脏？', h: ['2709e74a4bfb2802'], hl: 1, hc: '水' },
    { q: '什么路最窄？', h: ['11eb6571c4f0a35d', '01e6b3c4c794353e'], hl: 2, hc: '电' },
    { q: '有面没有口，有脚没有手，虽有四只脚，自己不会走。（打一物）', h: ['18273c7ad4bf2ba9', '0855662f310f2af3'], hl: 2, hc: '桌' },
    { q: '一点一横长，一撇到南洋。（猜一字）', h: ['a01db110794fabe3'], hl: 1, hc: '广' },
    { q: '太阳西边下，月亮东边挂。（猜一字）', h: ['0cd4092d75b272d0'], hl: 1, hc: '明' },
    { q: '一人一张口，下面一颗心。（猜一字）', h: ['105f837ae34c5628'], hl: 1, hc: '您' },
    { q: '什么门永远关不上？', h: ['fda1006e09e75cf9'], hl: 2, hc: '球' },
    { q: '什么牛不会吃草？', h: ['e31772cb94d4dfed'], hl: 2, hc: '蜗' },
    { q: '什么池不能装水？', h: ['db9bb52b13048d80', 'd5850aa74953eb24'], hl: 2, hc: '电' },
    { q: '守灯人最担心的一句话是什么？', h: ['59c395a2376731c6', 'f1e5965b2aa96b62', 'f23798eca7cea681'], hl: 3, hc: '灯' },
    { q: '大厅左右两座门，一边工具一边？', h: ['f206f1b2108cf222', '36e4e0f858770a8c'], hl: 2, hc: '游' },
    { q: '弯弯一座彩桥，挂在雨后天上。（打一物）', h: ['e9b1bf40c03c9ae5', '0f493a6f6fb038c5'], hl: 2, hc: '彩' },
    { q: '白天跟着你走，晚上跟你回家。（打一物）', h: ['69579bfb1719a8e6'], hl: 2, hc: '影' },
    { q: '越分享越多的东西是什么？', h: ['d11a2a742fe9ce21', 'acb56c299c5ffed4', '3b8bd2c8bbed1383'], hl: 2, hc: '快' },
    /* —— 日常物谜 —— */
    { q: '什么布剪不断？', h: ['a77636112b857b9c'], hl: 2, hc: '瀑' },
    { q: '什么蛋不能吃？', h: ['1384b35b1b993971', '4847eaf5284c8bb9', '0483f26c9bca2870'], hl: 2, hc: '脸' },
    { q: '什么书在书店买不到？', h: ['20595601b8ffac39', 'aed9aae5a49b86ea', 'c1c9a4b3d1815a9f'], hl: 2, hc: '秘' },
    { q: '什么车寸步难行？', h: ['3d19aa4ac53f4fd0'], hl: 2, hc: '风' },
    { q: '什么字大家都会念错？', h: ['7559d1999b282157', 'dcd30d46e6b169e7'], hl: 1, hc: '错' },
    { q: '什么东西越生气越大？', h: ['f207496f6b5e97ad'], hl: 2, hc: '脾' },
    { q: '什么东西有风不动，无风动？', h: ['277370b6f692fdad'], hl: 2, hc: '扇' },
    { q: '什么水不能喝？', h: ['204189ddfc3615d3', 'a234bb3011866c18', 'e2562ab1abfcd6db'], hl: 2, hc: '薪' },
    { q: '什么包不能背？', h: ['a773fff29b90acb3'], hl: 2, hc: '面' },
    { q: '什么东西打破了大家都叫好？', h: ['d52070988ce4eee0', '16d8be54707cb74b'], hl: 2, hc: '纪' },
    { q: '什么山最矮？', h: ['d0e870f69c7a4070'], hl: 2, hc: '假' },
    { q: '什么人不用电？', h: ['fe63e74e32d93c98'], hl: 3, hc: '缅' },
    /* —— 动物 —— */
    { q: '什么虎不吃人？', h: ['16496c3fa0ae55a6'], hl: 2, hc: '壁' },
    { q: '什么鸡不会下蛋？', h: ['bb7076dbc31429ed'], hl: 2, hc: '公' },
    { q: '什么鼠不怕猫？', h: ['b6dec8b02bef2782'], hl: 2, hc: '袋' },
    { q: '什么马不会跑？', h: ['7c608d09e6923dd5', '9616d96fd889eebd'], hl: 2, hc: '木' },
    { q: '什么鸟不会飞？', h: ['534c744ddac9c786', '7a082e803f36d56b'], hl: 2, hc: '鸵' },
    { q: '什么鱼不会游？', h: ['d5c822e6dc5c5193'], hl: 2, hc: '木' },
    { q: '什么猫不吃鱼？', h: ['0c4eaf27dd6efc43'], hl: 2, hc: '熊' },
    { q: '什么狗不咬人？', h: ['8a2b26a32cb13779'], hl: 2, hc: '热' },
    { q: '什么羊不吃草？', h: ['1c829605506bfe89'], hl: 2, hc: '海' },
    { q: '什么球不能踢？', h: ['b70dce5a25dec021', '8b06f903329853c9', 'b520c782c165ebbe'], hl: 2, hc: '地' },
    { q: '什么网不能捕鱼？', h: ['489d19f3ed3b3e1d', 'd9e9964a14764712', '5d3e7a800a8f6565', '87175120f328cc9e'], hl: 3, hc: '互' },
    /* —— 感官 / 身体 —— */
    { q: '什么东西越冷越爱出来？', h: ['9d0d5209574cf6e9'], hl: 2, hc: '鼻' },
    { q: '什么杯不能装水？', h: ['1798db8f3856f2af'], hl: 2, hc: '奖' },
    { q: '上面毛下面毛，中间一颗黑葡萄。（打一器官）', h: ['a018e9f87593cfd4'], hl: 2, hc: '眼' },
    { q: '左一片右一片，隔座山头看不见。（打一器官）', h: ['879cf3c770374c25'], hl: 2, hc: '耳' },
    { q: '一座山两个洞，能闻香能闻臭。（打一器官）', h: ['329b9219c58c5c57'], hl: 2, hc: '鼻' },
    { q: '一排白士兵，专咬硬东西。（打一器官）', h: ['d4a5709583601c98'], hl: 2, hc: '牙' },
    { q: '十个兄弟，互相帮忙。（打一器官）', h: ['4f64dd67492df07e', '40fb9c93e49f1eaf'], hl: 1, hc: '手' },
    /* —— 自然 / 抽象 —— */
    { q: '看不见摸不着，吹得树儿摇头。', h: ['97e8ba1cc2b31a9a'], hl: 1, hc: '风' },
    { q: '看不见摸不着，人人离不了。', h: ['58515ec3f260dfc0'], hl: 2, hc: '空' },
    { q: '最长又最短，最快又最慢，是什么？', h: ['9bcd12fffe7eb22b'], hl: 2, hc: '时' },
    { q: '越吹越旺，越浇越小，是什么？', h: ['274e2a1a24b58f82'], hl: 1, hc: '火' },
    { q: '一天翻一页，翻完一年到。', h: ['d223781b1b991f1f'], hl: 2, hc: '日' },
    { q: '有山有水没石头，有路没车走。', h: ['8a51888b11b9fe9c'], hl: 2, hc: '地' },
    /* —— 会动的 —— */
    { q: '你对它笑，它也对你笑。', h: ['d442981517a81670'], hl: 2, hc: '镜' },
    { q: '有脚不走，有嘴不说，到点会响。', h: ['aac0739f9cbac5ac', '8a5a326913f0c31d'], hl: 1, hc: '钟' },
    { q: '上上下下，把人送来送去。', h: ['754a65db01c2756c'], hl: 2, hc: '电' },
    { q: '下雨才开花，晴天就收花。', h: ['5ee86f846af58862', '4fdb81e39447f992'], hl: 2, hc: '雨' },
    { q: '越烧越短，照亮别人。', h: ['14aa64f09fb0ebb3'], hl: 2, hc: '蜡' },
    { q: '越吹越大，一松就飞。', h: ['b520c782c165ebbe'], hl: 2, hc: '气' },
    { q: '方方正正，贴在信封上，带你走天涯。', h: ['d3a4a482c53e033c'], hl: 2, hc: '邮' },
    /* —— 大厅彩蛋 —— */
    { q: '玻璃大厅里，敲一下「O」会打开什么？', h: ['4d154579a2c3811f', 'd88f9cfe5857777d'], hl: 2, hc: '设' },
    { q: '大厅里按哪个键能看操作说明？', h: ['951c16c6121c79f6'], hl: 1, hc: 'H' },
    { q: '广场两座总门，往左是哪一区？', h: ['3408a8fa3bdb5ca0', '43f038c8e4b6a370'], hl: 2, hc: '工' },
    { q: '大厅里带你去别的区块的，是门还是窗？', h: ['866ef2861901a75c'], hl: 1, hc: '门' }
  ];

  var KEY = 'worldhub.riddle.solved.v1';

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function daySeed() {
    var s = todayKey();
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function todayIndex() { return daySeed() % BANK.length; }

  function solvedToday() {
    try { return global.localStorage.getItem(KEY) === todayKey(); } catch (e) { return false; }
  }
  function markSolved() {
    try { global.localStorage.setItem(KEY, todayKey()); } catch (e) {}
    try { global.WH_EMIT && global.WH_EMIT('wh:riddle', {}); } catch (e) {}
  }

  /* ---- 轻量 SHA-256（纯 JS）：file:// / 非安全上下文没有 crypto.subtle ---- */
  var SHA_K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function sha256(str) {
    var bytes = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var l = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push(0, 0, 0, 0, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255);
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
               (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        var s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + w[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & cc) ^ (b & cc);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }
  /* 题库只存哈希（带盐）：看源码拿不到答案；提示单独存长度/首字 */
  var SALT = 'wh-r1';
  function ansHash(s) { return sha256(SALT + '|' + norm(s)).slice(0, 16); }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s。，、！？!?.,;；·「」『』“”"']/g, '');
  }

  function check(ans) {
    var item = BANK[todayIndex()];
    var n = norm(ans);
    if (!n) return false;
    var h = ansHash(n);
    for (var i = 0; i < item.h.length; i++) {
      if (item.h[i] === h) { markSolved(); return true; }
    }
    return false;
  }

  /* ---------------- DOM 面板 ---------------- */
  var Panel = {
    root: null,
    open_: false,
    _key: null,

    mount: function () {
      if (this.root) return true;
      this.root = document.getElementById('riddle');
      if (!this.root) return false;
      var self = this;

      document.getElementById('riddleClose').addEventListener('click', function () { self.close(); });
      document.getElementById('riddleSend').addEventListener('click', function () { self.submit(); });
      document.getElementById('riddleTry').addEventListener('click', function () { self.showHint(); });
      document.getElementById('riddleInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); self.submit(); }
      });

      this._key = function (e) {
        if (!self.open_) return;
        if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); self.close(); }
        e.stopPropagation();          /* 面板开着时大厅不接键 */
      };
      global.addEventListener('keydown', this._key, true);

      this.root.addEventListener('click', function (e) { if (e.target === self.root) self.close(); });
      return true;
    },

    open: function () {
      if (!this.mount()) return false;
      var r = Riddle.today();
      document.getElementById('riddleQ').textContent = r.q;
      var dateEl = document.getElementById('riddleDate');
      if (dateEl) {
        try { dateEl.textContent = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); }
        catch (e) { dateEl.textContent = todayKey(); }
      }
      var state = document.getElementById('riddleState');
      var input = document.getElementById('riddleInput');
      var send = document.getElementById('riddleSend');
      var tryBtn = document.getElementById('riddleTry');
      input.disabled = r.solved;
      send.disabled = r.solved;
      tryBtn.style.display = r.solved ? 'none' : '';
      if (r.solved) {
        state.textContent = '今天的题已经答对了 ✓ 明天再来';
        state.className = 'riddle-state ok';
        input.value = '';
      } else {
        state.textContent = '答案不限字数 · 回车提交';
        state.className = 'riddle-state';
        input.value = '';
      }
      this.open_ = true;
      this.root.classList.add('on');
      this.root.setAttribute('aria-hidden', 'false');
      if (!r.solved) setTimeout(function () { input.focus(); }, 60);
      if (global.Audio && global.Audio.play) global.Audio.play('ui');
      return true;
    },

    close: function () {
      if (!this.open_) return;
      this.open_ = false;
      this.root.classList.remove('on');
      this.root.setAttribute('aria-hidden', 'true');
      if (global.Audio && global.Audio.play) global.Audio.play('ui');
    },

    isOpen: function () { return this.open_; },

    hintLevel: 0,

    submit: function () {
      var input = document.getElementById('riddleInput');
      var state = document.getElementById('riddleState');
      if (!input || input.disabled) return;
      if (Riddle.check(input.value)) {
        state.textContent = '答对了！明天再来一题 ✓';
        state.className = 'riddle-state ok';
        input.disabled = true;
        document.getElementById('riddleSend').disabled = true;
        document.getElementById('riddleTry').style.display = 'none';
        if (global.Audio && global.Audio.play) global.Audio.play('win');
      } else {
        state.textContent = '不太对…再想想（提示：' + this.hint() + '）';
        state.className = 'riddle-state bad';
        if (global.Audio && global.Audio.play) global.Audio.play('miss');
        this.hintLevel = Math.min(2, this.hintLevel + 1);
      }
    },

    showHint: function () {
      var state = document.getElementById('riddleState');
      this.hintLevel = Math.min(2, this.hintLevel + 1);
      state.textContent = '提示：' + this.hint();
      state.className = 'riddle-state';
    },

    hint: function () {
      var item = BANK[todayIndex()];
      if (this.hintLevel >= 2) return '答案首字是「' + item.hc + '」';
      return '答案约 ' + item.hl + ' 个字';
    }
  };

  var Riddle = {
    today: function () {
      return {
        index: todayIndex(),
        q: BANK[todayIndex()].q,
        solved: solvedToday()
      };
    },
    check: check,
    solvedToday: solvedToday,
    Panel: Panel
  };

  global.Riddle = Riddle;
})(window);
