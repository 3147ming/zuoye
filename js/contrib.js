/* ============================================================
 * contrib.js —— 用户自建内容注册表
 * ------------------------------------------------------------
 * 为什么不是 manifest.json：file:// 下 fetch 被同源策略挡住，
 * 读不了外部 JSON。所以改成「传统 <script> 里调一次函数」：
 *
 *   WorldHub.register({
 *     id: 'my-game',
 *     name: '我的游戏',
 *     cat: 'games',                 // games | tools
 *     src: 'contrib/my-game/index.html',
 *     desc: '一句话说明',
 *     color: '#7fb0ff',
 *     author: '某某'
 *   });
 *
 * 注册进来的条目会出现在对应总门的选单里，传送后走的还是同一套区块逻辑。
 * 注册本身不做「审核」——审核是 tools/check-contrib.mjs 那一步的事；
 * 这里只做「形状校验」，挡掉会把大厅搞崩的脏数据。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'worldhub.contrib.v1';
  var CATS = { games: 1, tools: 1 };
  var ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

  var list = [];
  var seen = Object.create(null);

  function isHttp(src) {
    return /^(https?:)?\/\//i.test(src) || /^data:/i.test(src);
  }

  /* 校验 + 归一化。不合格的条目直接丢，并在控制台留一句话（不是报错，页面不该崩） */
  function normalize(e) {
    if (!e || typeof e !== 'object') return null;
    var id = String(e.id || '').trim();
    var name = String(e.name || '').trim();
    var cat = String(e.cat || '').trim();
    var src = String(e.src || '').trim();

    if (!ID_RE.test(id)) return null;
    if (!name || name.length > 24) return null;
    if (!CATS[cat]) return null;
    if (!src || isHttp(src)) return null;            /* 只收仓库内的相对路径 */
    if (/\.\.(\/|\\)/.test(src)) return null;        /* 不许跳出仓库 */

    return {
      id: id,
      name: name,
      cat: cat,
      src: src,
      desc: String(e.desc || '自建内容').slice(0, 28),
      color: /^#[0-9a-fA-F]{6}$/.test(String(e.color || '')) ? String(e.color) : '#9b8afb',
      glyph: 'gate',
      author: String(e.author || '').slice(0, 20),
      custom: true
    };
  }

  var Contrib = {
    /* 单条或数组都收；返回真正吃进去的条数 */
    register: function (entry) {
      var arr = (Object.prototype.toString.call(entry) === '[object Array]') ? entry : [entry];
      var n = 0;
      for (var i = 0; i < arr.length; i++) {
        var e = normalize(arr[i]);
        if (!e) {
          try { console.warn('[WorldHub] 自建条目不合格，已忽略：', arr[i]); } catch (x) { /* 忽略 */ }
          continue;
        }
        if (seen[e.id]) {
          try { console.warn('[WorldHub] 自建条目 id 重复，已忽略：' + e.id); } catch (x) { /* 忽略 */ }
          continue;
        }
        seen[e.id] = true;
        list.push(e);
        n++;
      }
      return n;
    },

    list: function () {
      return list.slice();
    },

    has: function (id) {
      return !!seen[id];
    },

    /* 默认启用；用户在设置里关掉的记在 disabled 名单里 */
    enabled: function (id) {
      try {
        var raw = global.localStorage.getItem(KEY);
        if (!raw) return true;
        var s = JSON.parse(raw);
        return !(s && s.disabled && s.disabled[id] === true);
      } catch (e) {
        return true;
      }
    },

    setEnabled: function (id, on) {
      var s = { disabled: {} };
      try {
        var raw = global.localStorage.getItem(KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.disabled && typeof parsed.disabled === 'object') s.disabled = parsed.disabled;
        }
      } catch (e) { /* 用默认空表 */ }

      if (on) delete s.disabled[id];
      else s.disabled[id] = true;

      try {
        global.localStorage.setItem(KEY, JSON.stringify(s));
        return true;
      } catch (e) { return false; }
    },

    /* 某个总门里能看到的自建条目（已按启用状态过滤） */
    forCat: function (cat) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].cat === cat && this.enabled(list[i].id)) out.push(list[i]);
      }
      return out;
    },

    count: function () {
      return list.length;
    }
  };

  global.Contrib = Contrib;

  /* 对外的公开接口：自建内容只需要认这一个名字 */
  global.WorldHub = global.WorldHub || {};
  global.WorldHub.register = function (e) { return Contrib.register(e); };
  global.WorldHub.contrib = Contrib;
})(window);
