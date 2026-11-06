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
    { q: '什么东西越洗越脏？', a: ['水'] },
    { q: '什么路最窄？', a: ['电路', '思路'] },
    { q: '有面没有口，有脚没有手，虽有四只脚，自己不会走。（打一物）', a: ['桌子', '桌'] },
    { q: '一点一横长，一撇到南洋。（猜一字）', a: ['广'] },
    { q: '太阳西边下，月亮东边挂。（猜一字）', a: ['明'] },
    { q: '一人一张口，下面一颗心。（猜一字）', a: ['您'] },
    { q: '什么门永远关不上？', a: ['球门'] },
    { q: '什么牛不会吃草？', a: ['蜗牛'] },
    { q: '什么池不能装水？', a: ['电池', '磁带'] },
    { q: '守灯人最担心的一句话是什么？', a: ['灯灭了', '熄灯', '灯灭'] },
    { q: '大厅左右两座门，一边工具一边？', a: ['游戏', '游戏区'] },
    { q: '弯弯一座彩桥，挂在雨后天上。（打一物）', a: ['彩虹', '虹'] },
    { q: '白天跟着你走，晚上跟你回家。（打一物）', a: ['影子'] },
    { q: '越分享越多的东西是什么？', a: ['快乐', '知识', '爱'] },
    /* —— 日常物谜 —— */
    { q: '什么布剪不断？', a: ['瀑布'] },
    { q: '什么蛋不能吃？', a: ['脸蛋', '笨蛋', '混蛋'] },
    { q: '什么书在书店买不到？', a: ['秘书', '遗书', '情书'] },
    { q: '什么车寸步难行？', a: ['风车'] },
    { q: '什么字大家都会念错？', a: ['错', '错字'] },
    { q: '什么东西越生气越大？', a: ['脾气'] },
    { q: '什么东西有风不动，无风动？', a: ['扇子'] },
    { q: '什么水不能喝？', a: ['薪水', '香水', '墨水'] },
    { q: '什么包不能背？', a: ['面包'] },
    { q: '什么东西打破了大家都叫好？', a: ['纪录', '记录'] },
    { q: '什么山最矮？', a: ['假山'] },
    { q: '什么人不用电？', a: ['缅甸人'] },
    /* —— 动物 —— */
    { q: '什么虎不吃人？', a: ['壁虎'] },
    { q: '什么鸡不会下蛋？', a: ['公鸡'] },
    { q: '什么鼠不怕猫？', a: ['袋鼠'] },
    { q: '什么马不会跑？', a: ['木马', '海马'] },
    { q: '什么鸟不会飞？', a: ['鸵鸟', '企鹅'] },
    { q: '什么鱼不会游？', a: ['木鱼'] },
    { q: '什么猫不吃鱼？', a: ['熊猫'] },
    { q: '什么狗不咬人？', a: ['热狗'] },
    { q: '什么羊不吃草？', a: ['海洋'] },
    { q: '什么球不能踢？', a: ['地球', '眼球', '气球'] },
    { q: '什么网不能捕鱼？', a: ['互联网', '电网', '球网', '网'] },
    /* —— 感官 / 身体 —— */
    { q: '什么东西越冷越爱出来？', a: ['鼻涕'] },
    { q: '什么杯不能装水？', a: ['奖杯'] },
    { q: '上面毛下面毛，中间一颗黑葡萄。（打一器官）', a: ['眼睛'] },
    { q: '左一片右一片，隔座山头看不见。（打一器官）', a: ['耳朵'] },
    { q: '一座山两个洞，能闻香能闻臭。（打一器官）', a: ['鼻子'] },
    { q: '一排白士兵，专咬硬东西。（打一器官）', a: ['牙齿'] },
    { q: '十个兄弟，互相帮忙。（打一器官）', a: ['手', '手掌'] },
    /* —— 自然 / 抽象 —— */
    { q: '看不见摸不着，吹得树儿摇头。', a: ['风'] },
    { q: '看不见摸不着，人人离不了。', a: ['空气'] },
    { q: '最长又最短，最快又最慢，是什么？', a: ['时间'] },
    { q: '越吹越旺，越浇越小，是什么？', a: ['火'] },
    { q: '一天翻一页，翻完一年到。', a: ['日历'] },
    { q: '有山有水没石头，有路没车走。', a: ['地图'] },
    /* —— 会动的 —— */
    { q: '你对它笑，它也对你笑。', a: ['镜子'] },
    { q: '有脚不走，有嘴不说，到点会响。', a: ['钟', '闹钟'] },
    { q: '上上下下，把人送来送去。', a: ['电梯'] },
    { q: '下雨才开花，晴天就收花。', a: ['雨伞', '伞'] },
    { q: '越烧越短，照亮别人。', a: ['蜡烛'] },
    { q: '越吹越大，一松就飞。', a: ['气球'] },
    { q: '方方正正，贴在信封上，带你走天涯。', a: ['邮票'] },
    /* —— 大厅彩蛋 —— */
    { q: '玻璃大厅里，敲一下「O」会打开什么？', a: ['设置', '设置面板'] },
    { q: '大厅里按哪个键能看操作说明？', a: ['H'] },
    { q: '广场两座总门，往左是哪一区？', a: ['工具', '工具区'] },
    { q: '大厅里带你去别的区块的，是门还是窗？', a: ['门'] }
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
