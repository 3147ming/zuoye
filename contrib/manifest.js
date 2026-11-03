/* ============================================================
 * contrib/manifest.js —— 自建内容注册入口
 * ------------------------------------------------------------
 * 这里是唯一需要改的文件：把做好的页面放进 contrib/<你的目录>/index.html，
 * 然后在下面调一次 WorldHub.register()，它就会出现在对应总门的选单里。
 *
 * 字段说明与校验规则见 contrib/CONTRACT.md，
 * 交上去之前跑一次 `node tools/check-contrib.mjs`。
 * ============================================================ */
(function (global) {
  'use strict';

  var W = global.WorldHub;
  if (!W || typeof W.register !== 'function') return;

  /* 示例（去掉注释、改好路径就能用）：

  W.register({
    id: 'hello',                     // 小写字母/数字/连字符，2~32 位，全站唯一
    name: '示例小游戏',               // 显示名，≤ 24 字
    cat: 'games',                    // games（游戏总门）或 tools（工具总门）
    src: 'contrib/hello/index.html', // 只收仓库内的相对路径
    desc: '一句话说明',               // 选单里那行小字，≤ 28 字
    color: '#7fb0ff',                // 门与徽点的颜色，#rrggbb
    author: '你的名字'                // 可选，≤ 20 字
  });

  */
})(window);
