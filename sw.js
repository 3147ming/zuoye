/* 世界大厅 Service Worker —— 离线兜底 + 二次访问加速
 * 策略：
 *   - 导航请求：network-first，失败回退缓存的 index.html
 *   - /js /css /contrib /games /tools /assets：network-first（在线必取新，断网回缓存）
 *     1.5.0 用 stale-while-revalidate：坏 JS 会被反复命中、修复要多刷一次才生效 → 改 network-first。
 *   - /api：放行，不缓存
 * 缓存以版本号命名，发新版本时旧缓存自动失效。
 */
const VERSION = 'worldhub-v1.5.1';
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/main.css',
  '/js/audio.js',
  '/js/sceneManager.js',
  '/js/player.js',
  '/js/npc.js',
  '/js/save.js',
  '/js/config.js',
  '/js/contrib.js',
  '/contrib/manifest.js',
  '/js/bgm.js',
  '/js/gatePanel.js',
  '/js/settings.js',
  '/js/world.js',
  '/js/iframeScene.js',
  '/js/touch.js',
  '/js/boot.js'
];

self.addEventListener('install', function (e) {
  /* 逐个缓存：任何一个文件失败不至于让整个 install 挂掉（addAll 是全或无） */
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(CORE.map(function (u) {
        return fetch(u).then(function (r) {
          return r && r.ok ? c.put(u, r) : null;
        }).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function assetPath(url) {
  var p = url.pathname;
  return /^\/(js|css|contrib|games|tools|assets)\//.test(p);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 跨域（开源游戏等）放过
  if (url.pathname.indexOf('/api/') === 0) return;        // 接口放过

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) { return r; }).catch(function () {
        return caches.match('/index.html');
      })
    );
    return;
  }

  if (assetPath(url)) {
    /* network-first：在线永远拿新文件；断网才回缓存。拿到响应后顺手更新缓存。 */
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
