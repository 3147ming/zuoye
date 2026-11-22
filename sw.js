/* ============================================================
 * 世界大厅 Service Worker —— 构建产物（请勿手改）
 * ------------------------------------------------------------
 * 本文件由 `node tools/gen-sw.mjs` 从 sw.template.js 生成：
 *   VERSION —— 由「预缓存清单 + 未 hash 源文件内容」摘要生成，
 *              内容不变则版本不变，内容一变就自动换版本并清理旧缓存
 *   SHELL   —— 首屏必须（首页 + 打包产物），install 时立刻缓存
 *   LAZY    —— 区块入口页，activate 后空闲低并发预取，不抢首屏带宽
 * 改缓存策略请改模板，直接改这里下次构建会被覆盖。
 *
 * 策略：
 *   - 导航请求：network-first（+ 导航预加载），失败回退缓存的首页
 *   - 带内容 hash 的 /assets/*.js|css：cache-first（文件名即版本，永不变）
 *   - /games /tools 入口页：stale-while-revalidate（先给缓存、后台更新）
 *     → 二次进入游戏零等待，更新延后一次生效
 *   - 其余 /js /css /contrib /assets：network-first（在线必取新，断网回缓存）
 *   - /api：放行，不缓存
 *
 * 为什么 SHELL / LAZY 要分开：
 *   过去 install 一次并发拉 25 项（含 555KB 的脑力街机聚合页），正撞上
 *   用户首屏后第一次点游戏，两者抢同一条带宽，越点越慢。现在 install
 *   只拿首屏必需的 4 项，区块页放到空闲队列串行取。
 * ============================================================ */
const VERSION = 'worldhub-0a2300602f';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.0d071801bd.js',
  '/assets/extra.af9188f73b.js',
  '/assets/main.f0130d185b.css'
];
const LAZY = [
  '/games/gomoku/index.html',
  '/tools/pomodoro/index.html',
  '/games/mine/index.html',
  '/games/breakout/index.html',
  '/games/tetris/index.html',
  '/games/party/index.html',
  '/games/game2048/index.html',
  '/games/brain-gym/index.html',
  '/games/snake/index.html',
  '/tools/unit/index.html',
  '/games/fight/index.html',
  '/games/ff/cps-test/index.html',
  '/tools/pomodoro/pet.html',
  '/tools/timer/index.html',
  '/games/ff/spacebar-clicker/index.html',
  '/games/ff/challenge-10-seconds/index.html',
  '/games/ff/stroop-effect/index.html',
  '/games/ff/short-term-memory/index.html',
  '/games/ff/f1-reaction/index.html',
  '/games/ff/larger-number/index.html',
  '/games/ff/flanker-test/index.html',
  '/games/ff/schulte-table/index.html',
  '/games/ff/counting-boxes/index.html',
  '/games/ff/pvt/index.html',
  '/games/ff/fish-trace/index.html',
  '/games/ff/sequence-memory/index.html',
  '/games/ff/frog-memory-leap/index.html',
  '/games/ff/digit-span/index.html',
  '/games/ff/rotating-schulte/index.html',
  '/games/ff/bamboo-cicada/index.html',
  '/games/ff/478-breathing/index.html',
  '/games/ff/box-breathing/index.html',
  '/games/ff/resonance-breathing/index.html',
  '/games/ff/trail-making/index.html',
  '/games/ff/focus-sudoku/index.html',
  '/games/reaction/index.html',
  '/games/ff/double-decision/index.html',
  '/games/ff/sbti-test/index.html',
  '/tools/pomodoro/timer.html',
  '/tools/color/index.html',
  '/tools/focus/index.html',
  '/tools/board/index.html',
  '/games/dandandao/index.html',
  '/games/memory/index.html',
  '/games/mathdash/index.html',
  '/tools/noise/index.html',
  '/games/dualnback/index.html',
  '/tools/links/index.html'
];

/* 体积大或很少用的入口页不自动预取，交给「目录悬停预热」和首次访问 */
const LAZY_SKIP_BYTES = 256 * 1024;
const LAZY_MAX = 14;          /* 只预取最小的若干项，别把冷门页也塞给用户 */

self.addEventListener('install', function (e) {
  /* 逐个缓存：任何一个文件失败不至于让整个 install 挂掉（addAll 是全或无） */
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return fetch(u).then(function (r) {
          return r && r.ok ? c.put(u, r) : null;
        }).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* 空闲预取：串行、带间隔、弱网/省流直接放弃。
   目的不是「缓存所有东西」，而是「别影响用户当前这一下操作」。 */
function lazyPrefetch() {
  var conn = self.navigator && self.navigator.connection;
  if (conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType || ''))) return;

  var i = 0;
  function next() {
    if (i >= LAZY.length || i >= LAZY_MAX) return;
    var url = LAZY[i++];
    caches.open(VERSION).then(function (c) {
      return c.match(url).then(function (hit) {
        if (hit) return null;
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
          if (!r || !r.ok) return null;
          var len = Number(r.headers.get('content-length') || 0);
          if (len > LAZY_SKIP_BYTES) return null;      /* 大页不自动预取 */
          return c.put(url, r.clone());
        }).catch(function () { return null; });
      });
    }).then(function () {
      setTimeout(next, 1200);
    });
  }
  setTimeout(next, 2500);      /* 让首屏与首次交互先跑完 */
}

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () {
      /* 导航预加载：SW 启动期间浏览器已并行发出导航请求，首屏少等一个 SW 启动时间 */
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable().catch(function () {});
      }
    }).then(function () { return self.clients.claim(); })
      .then(function () { lazyPrefetch(); })
  );
});

/* 页面侧「目录悬停预热」：postMessage({type:'prefetch', urls:[...]}) */
self.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d.type !== 'prefetch' || !Array.isArray(d.urls)) return;
  if (d.urls.length > 4) d.urls = d.urls.slice(0, 4);
  var job = Promise.all(d.urls.map(function (u) {
    return fetch(u, { cache: 'no-cache' }).then(function (r) {
      if (!r || !r.ok) return null;
      var copy = r.clone();
      return caches.open(VERSION).then(function (c) { return c.put(u, copy); });
    }).catch(function () { return null; });
  }));
  if (e.waitUntil) e.waitUntil(job);
});

function assetPath(url) {
  var p = url.pathname;
  return /^\/(js|css|contrib|games|tools|assets)\//.test(p);
}

/* 区块入口页：不带 hash，但改动频率低 → 先给缓存、后台更新 */
function entryPage(url) {
  return /^\/(games|tools)\/.+\.html$/.test(url.pathname);
}

/* 区块内的静态资源（图片 / 音频 / 字体 / 脚本）：同样不带 hash、同样很少变。
   过去走 network-first，弱网下第二次进游戏仍要等一个 RTT 逐个确认；
   改 SWR 后第二次起直接出画面。整站构建会换 VERSION 清缓存，不会长期吃到旧资源。 */
function blockAsset(url) {
  return /^\/(games|tools)\//.test(url.pathname);
}

/* 带内容 hash 的打包产物：文件名即版本，内容永不变 → cache-first */
function hashedAsset(url) {
  return /^\/assets\/[a-z0-9.-]+\.[0-9a-f]{10}\.(js|css)$/.test(url.pathname);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 跨域（开源游戏等）放过
  if (url.pathname.indexOf('/api/') === 0) return;        // 接口放过

  if (req.mode === 'navigate') {
    e.respondWith(
      /* 优先用导航预加载的响应（SW 启动期间已并行发起），否则正常走网络 */
      Promise.resolve(e.preloadResponse).then(function (preloaded) {
        return preloaded || fetch(req);
      }).catch(function () {
        return caches.match('/index.html');
      })
    );
    return;
  }

  /* cache-first：hash 文件名即版本，命中缓存即终态；未命中才走网络并回填。
     与 HTTP 层 immutable 策略一致，二次访问零网络往返。 */
  if (hashedAsset(url)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (r) {
          if (r && r.status === 200) {
            var copy = r.clone();
            caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
          }
          return r;
        });
      })
    );
    return;
  }

  /* stale-while-revalidate：游戏 / 工具入口页。
     有缓存就立刻返回（点击即开），同时在后台拉新版本写回缓存。
     代价是「更新后第一次进来还是旧版」，下次生效——相对每次进游戏都等
     一个 RTT 换 500KB 页面，这个交换值得。 */
  if (entryPage(url) || blockAsset(url)) {
    e.respondWith(
      caches.open(VERSION).then(function (c) {
        return c.match(req).then(function (hit) {
          var net = fetch(req).then(function (r) {
            if (r && r.status === 200) {
              var copy = r.clone();
              c.put(req, copy).catch(function () {});
            }
            return r;
          }).catch(function () { return null; });
          if (hit) { net.catch(function () {}); return hit; }   /* 后台更新，不等它 */
          return net.then(function (r) { return r || Response.error(); });
        });
      })
    );
    return;
  }

  /* network-first：在线永远拿新文件；断网才回缓存。拿到响应后顺手更新缓存。 */
  if (assetPath(url)) {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return r;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || Response.error(); });
      })
    );
  }
});
