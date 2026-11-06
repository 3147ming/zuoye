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
    { q: '什么东西越洗越脏？', a: ['水'] },
    { q: '什么路最窄？', a: ['电路', '思路'] },
    { q: '有面没有口，有脚没有手，虽有四只脚，自己不会走。（打一物）', a: ['桌子', '桌'] },
    { q: '一点一横长，一撇到南洋。（猜一字）', a: ['广'] },
    { q: '太阳西边下，月亮东边挂。（猜一字）', a: ['明'] },
    { q: '一人一张口，下面一颗心。（猜一字）', a: ['您'] },
    { q: '什么门永远关不上？', a: ['球门'] },
    { q: '什么牛不会吃草？', a: ['蜗牛'] },
    { q: '什么池不能装水？', a: ['电池', '磁带'] },
    { q: '千言万语，少说一点。（猜一字）', a: ['舌', '乱'] },
    { q: '守灯人最担心的一句话是什么？', a: ['灯灭了', '熄灯', '灯灭'] },
    { q: '大厅左右两座门，一边工具一边？', a: ['游戏', '游戏区'] },
    { q: '弯弯一座彩桥，挂在雨后天上。（打一物）', a: ['彩虹', '虹'] },
    { q: '白天跟着你走，晚上跟你回家。（打一物）', a: ['影子'] },
    { q: '越分享越多的东西是什么？', a: ['快乐', '知识', '爱'] }
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

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s。，、！？!?.,;；·「」『』“”"']/g, '');
  }

  function check(ans) {
    var item = BANK[todayIndex()];
    var n = norm(ans);
    if (!n) return false;
    for (var i = 0; i < item.a.length; i++) {
      if (norm(item.a[i]) === n) { markSolved(); return true; }
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
      var ans = item.a[0];
      if (this.hintLevel >= 2) return '答案首字是「' + ans.charAt(0) + '」';
      return '答案约 ' + ans.length + ' 个字';
    }
  };

  var Riddle = {
    today: function () {
      return {
        index: todayIndex(),
        q: BANK[todayIndex()].q,
        answers: BANK[todayIndex()].a,
        solved: solvedToday()
      };
    },
    check: check,
    solvedToday: solvedToday,
    Panel: Panel
  };

  global.Riddle = Riddle;
})(window);
