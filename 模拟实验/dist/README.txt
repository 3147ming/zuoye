电路实验模拟器 v1.0.0
================================

启动
----
  双击 run.bat（Windows），或在本目录执行：
      node server.mjs
  然后用浏览器打开 http://127.0.0.1:5360/

目录
----
  index.html      入口
  js/             源码（零依赖纯 ESM，可直接阅读/二次开发）
  css/            样式
  examples/       示例实验模板（JSON）
  server.mjs      本地静态服务器（端口 5360）

说明
----
  · 不需要 npm install，不需要构建；Node 18+ 即可。
  · 必须是 http:// 打开（ESM 模块在 file:// 下会被 CORS 拦截）。
  · 数据保存在浏览器 localStorage；项目文件可导出为 .circuit.json。
